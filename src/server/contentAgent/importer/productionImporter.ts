import { getAdminFirestore } from '../../firebaseAdmin';
import { CardContentType, BankCard, EducationLevel, bucketId, contentHash, curriculumId, makeTtl, normalizeText, shortHash, TTL_DAYS } from '../../db/firestoreSchema';
import { buildImportPlan, loadStagedPackage, validateMflashPackage, ImportPlan, MflashPackage } from './completoMflash';

const BATCH_SIZE = 200;
const LOCK_ID = 'completo-mflash';
const LOCK_TTL_MS = 30 * 60 * 1000;
const SAFE_DOC_BYTES = 900_000;

interface WriteOp { collection: string; id: string; data: any; merge: boolean; }
interface BackupDoc { collection: string; id: string; existed: boolean; data?: any; }

async function acquireLock(jobId: string): Promise<void> {
  const db = getAdminFirestore(); if (!db) throw new Error('Firebase Admin não configurado.');
  const ref = db.collection('contentImportLocks').doc(LOCK_ID); const now = Date.now();
  const ok = await db.runTransaction(async tx => {
    const snap = await tx.get(ref); const d = snap.exists ? snap.data() || {} : {};
    if (String(d.jobId || '') && Number(d.expiresAt || 0) > now && String(d.jobId) !== jobId) return false;
    tx.set(ref, { jobId, status: 'running', acquiredAt: new Date(now).toISOString(), expiresAt: now + LOCK_TTL_MS }, { merge: true }); return true;
  });
  if (!ok) throw new Error('Outra importação de conteúdo está em execução.');
}
async function releaseLock(jobId: string): Promise<void> {
  const db = getAdminFirestore(); if (!db) return;
  const ref = db.collection('contentImportLocks').doc(LOCK_ID);
  await db.runTransaction(async tx => { const snap = await tx.get(ref); if (snap.exists && String(snap.data()?.jobId || '') === jobId) tx.set(ref, { status: 'idle', jobId: '', expiresAt: Date.now(), releasedAt: new Date().toISOString() }, { merge: true }); });
}

async function backupRefs(jobId: string, refs: Array<{ collection: string; id: string }>): Promise<void> {
  const db = getAdminFirestore(); if (!db) throw new Error('Firebase Admin não configurado.');
  const backupRef = db.collection('contentImportJobs').doc(jobId).collection('backup');
  for (let i = 0; i < refs.length; i += BATCH_SIZE) {
    const batch = db.batch();
    for (const item of refs.slice(i, i + BATCH_SIZE)) {
      const ref = db.collection(item.collection).doc(item.id); const snap = await ref.get();
      const data = snap.exists ? snap.data() : undefined;
      if (data !== undefined && Buffer.byteLength(JSON.stringify(data), 'utf8') > SAFE_DOC_BYTES) throw new Error(`Documento ${item.collection}/${item.id} é grande demais para backup seguro.`);
      const id = shortHash(`${item.collection}|${item.id}`, 24);
      batch.set(backupRef.doc(id), { collection: item.collection, documentId: item.id, existed: snap.exists, data: data || null, backedUpAt: new Date().toISOString() });
    }
    await batch.commit();
  }
}

function buildWrites(pkg: MflashPackage): WriteOp[] {
  const writes: WriteOp[] = [];
  const subjectLevels = new Map<string, Array<{ level: EducationLevel; label: string; icon: string; reason: string; priority: number }>>();
  for (const level of pkg.levels) {
    for (const subject of level.subjects) {
      const levels = subjectLevels.get(subject.name) || [];
      if (!levels.some(x => x.level === level.id)) levels.push({ level: level.id, label: level.id.toUpperCase(), icon: 'book', reason: 'Importado do pacote editorial completo.mflash', priority: 5 });
      subjectLevels.set(subject.name, levels);
      for (const curriculum of subject.curricula) {
        const categories = curriculum.topics.map(t => ({ category: t.name, topics: t.subtopics.map(s => s.name) }));
        const topicTree = curriculum.topics.map(t => ({ topic: t.name, subtopics: t.subtopics.map(s => s.name) }));
        writes.push({ collection: 'curricula', id: curriculumId(subject.name, level.id), merge: true, data: { subject: subject.name, level: level.id, categories, topicTree, topicCount: curriculum.topics.length, subtopicCount: curriculum.topics.reduce((n, t) => n + t.subtopics.length, 0), totalTopics: curriculum.topics.length, totalSubtopics: curriculum.topics.reduce((n, t) => n + t.subtopics.length, 0), contentVersion: pkg.manifest.contentVersion, version: 1, updatedAt: new Date().toISOString(), ttlAt: makeTtl(TTL_DAYS.CURRICULUM), providerUsed: 'mflash-import' } });
        for (const topic of curriculum.topics) for (const subtopic of topic.subtopics) {
          const refId = bucketId(subject.name, topic.name, level.id, 'definition' as CardContentType, subtopic.name);
          writes.push({ collection: 'cardBuckets', id: refId, merge: true, data: { __mflashBucket: true, subject: subject.name, topic: topic.name, subtopic: subtopic.name, level: level.id, cardType: 'definition', incomingCards: subtopic.cards, contentVersion: pkg.manifest.contentVersion } });
        }
      }
    }
  }
  for (const [subject, levels] of subjectLevels) {
    writes.push({ collection: 'subjects', id: shortHash(normalizeText(subject)), merge: true, data: { subject, normalized: normalizeText(subject), levels, updatedAt: new Date().toISOString(), ttlAt: makeTtl(TTL_DAYS.SUBJECT_LEVELS), providerUsed: 'mflash-import', version: 1 } });
    writes.push({ collection: 'contentIndex', id: normalizeText(subject).replace(/\s+/g, '-'), merge: true, data: { subjectId: shortHash(normalizeText(subject)), subject, normalized: normalizeText(subject), aliases: [normalizeText(subject)], status: 'ready', version: 1, updatedAt: new Date().toISOString() } });
  }
  return writes;
}

async function materializeBucket(op: WriteOp): Promise<any> {
  const db = getAdminFirestore(); if (!db) throw new Error('Firebase Admin não configurado.');
  const ref = db.collection(op.collection).doc(op.id); const snap = await ref.get(); const old = snap.exists ? snap.data() as any : undefined;
  if (!op.data.__mflashBucket) return { ...op, data: { ...(op.data || {}), version: Number(old?.version || 0) + 1 } };
  const incoming = Array.isArray(op.data.incomingCards) ? op.data.incomingCards : [];
  const existingCards: BankCard[] = Array.isArray(old?.cards) ? old.cards : [];
  const map = new Map<string, BankCard>();
  for (const c of existingCards) map.set(c.contentHash || contentHash(c.front, c.back, `${op.data.subject}|${op.data.topic}|${c.subtopic || op.data.subtopic}`), c);
  for (const raw of incoming) {
    const front = String(raw.front || raw.question || '').trim(); const back = String(raw.back || raw.answer || '').trim(); if (!front || !back) continue;
    const h = contentHash(front, back, `${op.data.subject}|${op.data.topic}|${op.data.subtopic}|${op.data.level}`);
    const oldCard = map.get(h);
    const card: BankCard = { id: oldCard?.id || String(raw.id || shortHash(h)), front, back, explanation: String(raw.explanation || ''), topic: op.data.topic, subtopic: op.data.subtopic, difficulty: String(raw.difficulty || 'medium'), contentHash: h, version: Number(oldCard?.version || 0) + 1, qualityScore: Number(raw.qualityScore || 80), relevanceScore: Number(raw.curriculumPriority || 3), sourceHash: op.data.contentVersion };
    map.set(h, card);
  }
  const cards = [...map.values()]; const data = { subject: op.data.subject, topic: op.data.topic, subtopic: op.data.subtopic, level: op.data.level, cardType: 'definition', cards, cardCount: cards.length, version: Number(old?.version || 0) + 1, qualityScore: cards.length ? Math.round(cards.reduce((n, c) => n + Number(c.qualityScore || 0), 0) / cards.length) : 0, updatedAt: new Date().toISOString(), ttlAt: makeTtl(TTL_DAYS.CARD_BUCKET), providerUsed: 'mflash-import' };
  if (Buffer.byteLength(JSON.stringify(data), 'utf8') > SAFE_DOC_BYTES) throw new Error(`Bucket excede o tamanho seguro do Firestore: ${op.data.subject}/${op.data.level}/${op.data.topic}/${op.data.subtopic}.`);
  return { collection: op.collection, id: op.id, merge: true, data };
}

async function postValidate(jobId: string, pkg: MflashPackage): Promise<{ ok: boolean; missing: string[] }> {
  const db = getAdminFirestore(); if (!db) throw new Error('Firebase Admin não configurado.');
  const missing: string[] = [];
  for (const level of pkg.levels) for (const subject of level.subjects) for (const curriculum of subject.curricula) for (const topic of curriculum.topics) for (const subtopic of topic.subtopics) {
    const ref = db.collection('cardBuckets').doc(bucketId(subject.name, topic.name, level.id, 'definition' as CardContentType, subtopic.name)); const snap = await ref.get(); const cards = snap.exists && Array.isArray(snap.data()?.cards) ? snap.data()?.cards as BankCard[] : [];
    const hashes = new Set(cards.map(c => c.contentHash));
    for (const raw of subtopic.cards) { const front = String(raw.front || raw.question || '').trim(); const back = String(raw.back || raw.answer || '').trim(); const h = contentHash(front, back, `${subject.name}|${topic.name}|${subtopic.name}|${level.id}`); if (!hashes.has(h)) missing.push(`${level.id}/${subject.name}/${topic.name}/${subtopic.name}/${raw.id || h}`); }
  }
  const dbJob = db.collection('contentImportJobs').doc(jobId); await dbJob.set({ postValidation: { ok: missing.length === 0, missingCount: missing.length, missing: missing.slice(0, 100), checkedAt: new Date().toISOString() } }, { merge: true });
  return { ok: missing.length === 0, missing };
}

export async function publishStagedImportProduction(jobId: string): Promise<ImportPlan> {
  const db = getAdminFirestore(); if (!db) throw new Error('Firebase Admin não configurado.');
  await acquireLock(jobId);
  try {
    const { job, rawText } = await loadStagedPackage(jobId);
    if (job.status === 'completed' && job.plan) return job.plan as ImportPlan;
    const parsed = JSON.parse(rawText); const validated = validateMflashPackage(parsed); if (!validated.package) throw new Error('Staging inválido.');
    const plan = await buildImportPlan(validated.package, String(job.packageHash)); plan.jobId = jobId;
    const errors = [...validated.issues, ...plan.issues].filter(x => x.severity === 'error');
    if (errors.length) throw new Error(`Publicação bloqueada: ${errors.map(x => x.message).join(' | ')}`);
    const writes = buildWrites(validated.package);
    await backupRefs(jobId, writes.map(w => ({ collection: w.collection, id: w.id })));
    await db.collection('contentImportJobs').doc(jobId).set({ status: 'importing', approvedAt: new Date().toISOString(), startedAt: new Date().toISOString(), totalOperations: writes.length, completedOperations: 0 }, { merge: true });
    const start = Number(job.completedOperations || 0);
    for (let i = start; i < writes.length; i += BATCH_SIZE) {
      const rawBatch = writes.slice(i, i + BATCH_SIZE);
      const materialized: WriteOp[] = [];
      for (const op of rawBatch) materialized.push(await materializeBucket(op));
      const batch = db.batch(); for (const op of materialized) batch.set(db.collection(op.collection).doc(op.id), op.data, { merge: op.merge });
      await batch.commit();
      await db.collection('contentImportJobs').doc(jobId).set({ completedOperations: Math.min(i + rawBatch.length, writes.length), lastBatchAt: new Date().toISOString(), lastBatchIndex: Math.floor(i / BATCH_SIZE) }, { merge: true });
    }
    const check = await postValidate(jobId, validated.package);
    if (!check.ok) throw new Error(`Pós-validação falhou: ${check.missing.length} cards não foram encontrados após a publicação.`);
    await db.collection('contentImportJobs').doc(jobId).set({ status: 'completed', plan, completedAt: new Date().toISOString(), updatedAt: new Date().toISOString() }, { merge: true });
    return plan;
  } catch (err) {
    await db.collection('contentImportJobs').doc(jobId).set({ status: 'failed', lastError: err instanceof Error ? err.message : String(err), failedAt: new Date().toISOString(), updatedAt: new Date().toISOString() }, { merge: true }).catch(() => undefined);
    throw err;
  } finally { await releaseLock(jobId); }
}

export async function rollbackImportJob(jobId: string): Promise<void> {
  const db = getAdminFirestore(); if (!db) throw new Error('Firebase Admin não configurado.');
  await acquireLock(`rollback:${jobId}`);
  try {
    const jobRef = db.collection('contentImportJobs').doc(jobId); const snap = await jobRef.get(); if (!snap.exists) throw new Error('Importação não encontrada.');
    const backups = await jobRef.collection('backup').get();
    for (let i = 0; i < backups.docs.length; i += BATCH_SIZE) {
      const batch = db.batch();
      for (const doc of backups.docs.slice(i, i + BATCH_SIZE)) {
        const b = doc.data() as BackupDoc; const ref = db.collection(b.collection).doc(b.id);
        if (b.existed) batch.set(ref, b.data || {}, { merge: false }); else batch.delete(ref);
      }
      await batch.commit();
    }
    await jobRef.set({ status: 'rolled_back', rolledBackAt: new Date().toISOString(), updatedAt: new Date().toISOString() }, { merge: true });
  } finally { await releaseLock(`rollback:${jobId}`); }
}
