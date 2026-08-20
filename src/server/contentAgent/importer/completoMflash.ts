import { createHash } from 'crypto';
import { getAdminFirestore } from '../../firebaseAdmin';
import { EducationLevel, BankCard, CardContentType, contentHash, curriculumId, bucketId, normalizeText, shortHash, makeTtl, TTL_DAYS } from '../../db/firestoreSchema';
import { parseMflash } from './parseMflashXml';

export const OFFICIAL_LEVELS: readonly EducationLevel[] = ['fundamental', 'medio', 'faculdade', 'concurso', 'tecnico'] as const;
export const MFLASH_FORMAT = 'memoriaflash';
export const MFLASH_VERSION = '1.0';
const STAGING_CHUNK_BYTES = 700_000;
const FIRESTORE_DOC_SAFE_BYTES = 900_000;
const DEFAULT_FREE_STORAGE_BYTES = 1024 * 1024 * 1024;
const IMPORT_BATCH_SIZE = 400;

export interface MflashCardInput { id?: string; question?: string; front?: string; answer?: string; back?: string; explanation?: string; curiosity?: string; difficulty?: string; tags?: string[]; curriculumPriority?: number; source?: Record<string, unknown>; }
export interface MflashSubtopicInput { id?: string; name: string; cards: MflashCardInput[]; }
export interface MflashTopicInput { id?: string; name: string; subtopics: MflashSubtopicInput[]; }
export interface MflashCurriculumInput { id?: string; name: string; topics: MflashTopicInput[]; }
export interface MflashSubjectInput { id?: string; name: string; curricula: MflashCurriculumInput[]; }
export interface MflashLevelInput { id: EducationLevel; name: string; subjects: MflashSubjectInput[]; }
export interface MflashManifest { format: string; formatVersion: string; package: string; contentVersion: string; language?: string; levels: string[]; statistics?: Record<string, number>; generator?: Record<string, string>; }
export interface MflashPackage { manifest: MflashManifest; levels: MflashLevelInput[]; }
export interface ValidationIssue { severity: 'error' | 'warning'; code: string; path: string; message: string; }
export interface ImportStats { levels: number; subjects: number; curricula: number; topics: number; subtopics: number; cards: number; newCards: number; existingCards: number; updatedCards: number; duplicateCards: number; rejectedCards: number; conflicts: number; estimatedBytes: number; }
export interface ImportPlan { jobId?: string; packageHash: string; manifest: MflashManifest; stats: ImportStats; issues: ValidationIssue[]; operations: Array<{ action: 'create' | 'update' | 'skip' | 'conflict'; cardId: string; subject: string; level: EducationLevel; topic: string; subtopic: string; contentHash: string }>; createdAt: string; }

function text(v: unknown): string { return typeof v === 'string' ? v.trim() : ''; }
function levelLabel(level: EducationLevel): string { return level.toUpperCase(); }
function bytes(v: unknown): number { return Buffer.byteLength(JSON.stringify(v), 'utf8'); }
function hashPackage(raw: string): string { return createHash('sha256').update(raw).digest('hex'); }
function canonicalCard(card: MflashCardInput): { front: string; back: string; explanation: string; curiosity: string; difficulty: string } {
  return { front: text(card.front || card.question), back: text(card.back || card.answer), explanation: text(card.explanation), curiosity: text(card.curiosity), difficulty: text(card.difficulty || 'medium').toLowerCase() };
}
function normalizeDifficulty(value: string): string { const v = normalizeText(value); if (['easy', 'facil', 'fácil'].includes(v)) return 'easy'; if (['hard', 'dificil', 'difícil'].includes(v)) return 'hard'; if (['specialist', 'especialista'].includes(v)) return 'specialist'; return 'medium'; }
function qualityScore(card: ReturnType<typeof canonicalCard>, hierarchyOk: boolean): number { let score = 0; if (card.front.length >= 10) score += 20; if (card.back.length >= 15) score += 20; if (card.explanation.length >= 15) score += 20; if (card.curiosity.length >= 10) score += 10; if (hierarchyOk) score += 15; if (card.front.length <= 600 && card.back.length <= 3000) score += 15; return score; }
function validLevel(value: unknown): value is EducationLevel { return OFFICIAL_LEVELS.includes(value as EducationLevel); }
function path(...parts: string[]): string { return parts.join('.'); }

export function validateMflashPackage(pkg: unknown): { package?: MflashPackage; issues: ValidationIssue[] } {
  const issues: ValidationIssue[] = [];
  const root = pkg as any;
  if (!root || typeof root !== 'object') return { issues: [{ severity: 'error', code: 'ROOT_INVALID', path: '$', message: 'O arquivo precisa conter um objeto de pacote.' }] };
  const manifest = root.manifest;
  if (!manifest || manifest.format !== MFLASH_FORMAT) issues.push({ severity: 'error', code: 'FORMAT_INVALID', path: 'manifest.format', message: `Formato inválido. Esperado ${MFLASH_FORMAT}.` });
  if (manifest?.formatVersion !== MFLASH_VERSION) issues.push({ severity: 'error', code: 'FORMAT_VERSION_INVALID', path: 'manifest.formatVersion', message: `Versão de formato incompatível. Esperado ${MFLASH_VERSION}.` });
  const packageType = manifest?.package;
  if (!['completo', 'nivel'].includes(packageType)) issues.push({ severity: 'error', code: 'PACKAGE_INVALID', path: 'manifest.package', message: 'O pacote deve ser "completo" ou "nivel".' });
  if (!text(manifest?.contentVersion)) issues.push({ severity: 'error', code: 'CONTENT_VERSION_MISSING', path: 'manifest.contentVersion', message: 'contentVersion é obrigatório.' });
  const levels = Array.isArray(root.levels) ? root.levels : [];
  const found = new Set<string>();
  for (const level of levels) {
    if (!validLevel(level?.id)) { issues.push({ severity: 'error', code: 'LEVEL_INVALID', path: 'levels', message: `Nível inválido: ${String(level?.id || level?.name)}. Permitidos: ${OFFICIAL_LEVELS.join(', ')}.` }); continue; }
    found.add(level.id);
  }
  if (packageType === 'completo') {
    for (const level of OFFICIAL_LEVELS) if (!found.has(level)) issues.push({ severity: 'error', code: 'LEVEL_MISSING', path: `levels.${level}`, message: `O pacote completo deve conter o nível ${levelLabel(level)}.` });
    if (!Array.isArray(manifest?.levels) || OFFICIAL_LEVELS.some(level => !manifest.levels.includes(level))) issues.push({ severity: 'error', code: 'MANIFEST_LEVELS_INCOMPLETE', path: 'manifest.levels', message: 'O manifesto do pacote completo precisa declarar os cinco níveis oficiais.' });
  } else if (packageType === 'nivel') {
    if (found.size !== 1) issues.push({ severity: 'error', code: 'LEVEL_PACKAGE_MULTIPLE_LEVELS', path: 'levels', message: 'Um pacote por nível deve conter exatamente um nível.' });
    const declared = Array.isArray(manifest?.levels) ? manifest.levels.filter((x: unknown) => OFFICIAL_LEVELS.includes(x as EducationLevel)) : [];
    if (declared.length !== 1 || !found.has(declared[0])) issues.push({ severity: 'error', code: 'LEVEL_PACKAGE_DECLARATION_INVALID', path: 'manifest.levels', message: 'O manifesto do pacote por nível deve declarar exatamente o nível presente no arquivo.' });
  }
  const seenIds = new Set<string>();
  const seenHashes = new Set<string>();
  let totalCards = 0;
  for (const level of levels) {
    if (!validLevel(level?.id)) continue;
    if (!Array.isArray(level.subjects)) { issues.push({ severity: 'error', code: 'SUBJECTS_INVALID', path: path('levels', level.id), message: 'subjects precisa ser uma lista.' }); continue; }
    for (const subject of level.subjects) {
      if (!text(subject?.name)) { issues.push({ severity: 'error', code: 'SUBJECT_MISSING', path: path('levels', level.id, 'subjects'), message: 'Matéria sem nome.' }); continue; }
      if (!Array.isArray(subject.curricula)) { issues.push({ severity: 'error', code: 'CURRICULA_INVALID', path: path('levels', level.id, subject.name), message: 'curricula precisa ser uma lista.' }); continue; }
      for (const curriculum of subject.curricula) {
        if (!text(curriculum?.name)) { issues.push({ severity: 'error', code: 'CURRICULUM_MISSING', path: path(level.id, subject.name, 'curricula'), message: 'Grade sem nome.' }); continue; }
        if (!Array.isArray(curriculum.topics)) { issues.push({ severity: 'error', code: 'TOPICS_INVALID', path: path(level.id, subject.name, curriculum.name), message: 'topics precisa ser uma lista.' }); continue; }
        for (const topic of curriculum.topics) {
          if (!text(topic?.name)) { issues.push({ severity: 'error', code: 'TOPIC_MISSING', path: path(level.id, subject.name, curriculum.name, 'topics'), message: 'Tópico sem nome.' }); continue; }
          if (!Array.isArray(topic.subtopics)) { issues.push({ severity: 'error', code: 'SUBTOPICS_INVALID', path: path(level.id, subject.name, curriculum.name, topic.name), message: 'subtopics precisa ser uma lista.' }); continue; }
          for (const subtopic of topic.subtopics) {
            if (!text(subtopic?.name)) { issues.push({ severity: 'error', code: 'SUBTOPIC_MISSING', path: path(level.id, subject.name, curriculum.name, topic.name), message: 'Subtópico sem nome.' }); continue; }
            if (!Array.isArray(subtopic.cards)) { issues.push({ severity: 'error', code: 'CARDS_INVALID', path: path(level.id, subject.name, curriculum.name, topic.name, subtopic.name), message: 'cards precisa ser uma lista.' }); continue; }
            for (let i = 0; i < subtopic.cards.length; i++) {
              totalCards++;
              const card = canonicalCard(subtopic.cards[i]);
              const cardPath = path(level.id, subject.name, curriculum.name, topic.name, subtopic.name, `cards[${i}]`);
              if (!card.front || !card.back) { issues.push({ severity: 'error', code: 'CARD_REQUIRED_FIELD', path: cardPath, message: 'Todo card precisa de pergunta/front e resposta/back.' }); continue; }
              const h = contentHash(card.front, card.back, `${subject.name}|${topic.name}|${subtopic.name}|${level.id}`);
              const id = text(subtopic.cards[i].id) || shortHash(h);
              if (seenIds.has(id)) issues.push({ severity: 'error', code: 'CARD_ID_DUPLICATE', path: cardPath, message: `ID de card duplicado: ${id}.` });
              seenIds.add(id);
              if (seenHashes.has(h)) issues.push({ severity: 'warning', code: 'CARD_DUPLICATE_CONTENT', path: cardPath, message: 'Conteúdo duplicado dentro do pacote.' });
              seenHashes.add(h);
              const score = qualityScore(card, true);
              if (score < 60) issues.push({ severity: 'error', code: 'CARD_QUALITY_LOW', path: cardPath, message: `Card rejeitado por qualidade baixa (${score}/100).` });
            }
          }
        }
      }
    }
  }
  if (manifest?.statistics?.cards !== undefined && Number(manifest.statistics.cards) !== totalCards) issues.push({ severity: 'error', code: 'MANIFEST_COUNT_MISMATCH', path: 'manifest.statistics.cards', message: `Manifesto declara ${manifest.statistics.cards} cards, mas foram encontrados ${totalCards}.` });
  return issues.some(i => i.severity === 'error') ? { issues } : { package: root as MflashPackage, issues };
}

interface ExistingCardIndex { byHash: Map<string, BankCard>; byId: Map<string, BankCard>; }
async function loadExistingCards(subject: string): Promise<ExistingCardIndex> {
  const db = getAdminFirestore();
  const byHash = new Map<string, BankCard>();
  const byId = new Map<string, BankCard>();
  if (!db) return { byHash, byId };
  const snap = await db.collection('cardBuckets').where('subject', '==', subject).get();
  for (const doc of snap.docs) {
    const data = doc.data() as any;
    for (const card of Array.isArray(data.cards) ? data.cards : []) {
      const c = card as BankCard;
      const h = c.contentHash || contentHash(c.front, c.back, `${subject}|${data.topic || ''}|${c.subtopic || data.subtopic || ''}`);
      byHash.set(h, c);
      if (c.id) byId.set(c.id, c);
    }
  }
  return { byHash, byId };
}

export async function buildImportPlan(pkg: MflashPackage, packageHash: string): Promise<ImportPlan> {
  const issues: ValidationIssue[] = [];
  const operations: ImportPlan['operations'] = [];
  const stats: ImportStats = { levels: pkg.levels.length, subjects: 0, curricula: 0, topics: 0, subtopics: 0, cards: 0, newCards: 0, existingCards: 0, updatedCards: 0, duplicateCards: 0, rejectedCards: 0, conflicts: 0, estimatedBytes: 0 };
  const subjectCache = new Map<string, ExistingCardIndex>();
  for (const level of pkg.levels) {
    if (!validLevel(level.id)) continue;
    stats.subjects += level.subjects.length;
    for (const subject of level.subjects) {
      const cacheKey = subject.name;
      if (!subjectCache.has(cacheKey)) subjectCache.set(cacheKey, await loadExistingCards(subject.name));
      const existing = subjectCache.get(cacheKey)!;
      stats.curricula += subject.curricula.length;
      for (const curriculum of subject.curricula) {
        stats.topics += curriculum.topics.length;
        for (const topic of curriculum.topics) {
          stats.subtopics += topic.subtopics.length;
          for (const subtopic of topic.subtopics) {
            for (const raw of subtopic.cards) {
              const card = canonicalCard(raw);
              const h = contentHash(card.front, card.back, `${subject.name}|${topic.name}|${subtopic.name}|${level.id}`);
              const id = text(raw.id) || shortHash(h);
              stats.cards++;
              const old = existing.byHash.get(h) || existing.byId.get(id);
              if (!old) { stats.newCards++; operations.push({ action: 'create', cardId: id, subject: subject.name, level: level.id, topic: topic.name, subtopic: subtopic.name, contentHash: h }); continue; }
              if ((old.contentHash || '') === h) { stats.existingCards++; operations.push({ action: 'skip', cardId: id, subject: subject.name, level: level.id, topic: topic.name, subtopic: subtopic.name, contentHash: h }); continue; }
              if (old.id === id) { stats.updatedCards++; operations.push({ action: 'update', cardId: id, subject: subject.name, level: level.id, topic: topic.name, subtopic: subtopic.name, contentHash: h }); }
              else { stats.conflicts++; operations.push({ action: 'conflict', cardId: id, subject: subject.name, level: level.id, topic: topic.name, subtopic: subtopic.name, contentHash: h }); }
            }
          }
        }
      }
    }
  }
  stats.estimatedBytes = bytes(pkg);
  const maxImportBytes = Number(process.env.CONTENT_IMPORT_MAX_BYTES || 50 * 1024 * 1024);
  if (stats.estimatedBytes > maxImportBytes) issues.push({ severity: 'error', code: 'PACKAGE_TOO_LARGE', path: '$', message: `Pacote excede o limite configurado de ${Math.round(maxImportBytes / 1024 / 1024)} MB.` });
  if (stats.conflicts > 0) issues.push({ severity: 'error', code: 'CONFLICTS_FOUND', path: '$', message: `${stats.conflicts} conflito(s) de ID/conteúdo precisam de resolução.` });
  return { packageHash, manifest: pkg.manifest, stats, issues, operations, createdAt: new Date().toISOString() };
}

export async function estimateStorageAfterImport(plan: ImportPlan): Promise<{ currentBytes: number; estimatedAdditionalBytes: number; estimatedAfterBytes: number; freeReferenceBytes: number; currentPercent: number; afterPercent: number }> {
  const db = getAdminFirestore();
  let currentBytes = 0;
  if (db) {
    for (const ref of await db.listCollections()) {
      const snap = await ref.get();
      for (const doc of snap.docs) currentBytes += Buffer.byteLength(doc.id, 'utf8') + Buffer.byteLength(JSON.stringify(doc.data()), 'utf8') + 32;
    }
  }
  const freeReferenceBytes = Number(process.env.FIRESTORE_FREE_STORAGE_BYTES || DEFAULT_FREE_STORAGE_BYTES);
  const estimatedAdditionalBytes = plan.stats.estimatedBytes;
  const estimatedAfterBytes = currentBytes + estimatedAdditionalBytes;
  return { currentBytes, estimatedAdditionalBytes, estimatedAfterBytes, freeReferenceBytes, currentPercent: Number((currentBytes / freeReferenceBytes * 100).toFixed(2)), afterPercent: Number((estimatedAfterBytes / freeReferenceBytes * 100).toFixed(2)) };
}

function makeCard(raw: MflashCardInput, subject: string, topic: string, subtopic: string, level: EducationLevel, source: MflashManifest): Omit<BankCard, 'id'> {
  const c = canonicalCard(raw);
  const h = contentHash(c.front, c.back, `${subject}|${topic}|${subtopic}|${level}`);
  return { front: c.front, back: c.back, explanation: c.explanation, topic, subtopic, difficulty: normalizeDifficulty(c.difficulty), contentHash: h, version: 1, qualityScore: qualityScore(c, true), relevanceScore: Number(raw.curriculumPriority || 3), sourceHash: hashPackage(JSON.stringify(source)), agentVersion: 'content-importer/1.0', promptVersion: 'mflash-format/1.0', model: 'external-file' };
}

async function writeInBatches(items: Array<{ ref: FirebaseFirestore.DocumentReference; data: any; merge?: boolean }>): Promise<void> {
  const db = getAdminFirestore(); if (!db) throw new Error('Firebase Admin não configurado.');
  for (let i = 0; i < items.length; i += IMPORT_BATCH_SIZE) {
    const batch = db.batch();
    for (const item of items.slice(i, i + IMPORT_BATCH_SIZE)) batch.set(item.ref, item.data, item.merge ? { merge: true } : undefined);
    await batch.commit();
  }
}

export async function stageImport(rawText: string): Promise<{ jobId: string; plan: ImportPlan; storage: Awaited<ReturnType<typeof estimateStorageAfterImport>> }> {
  const parsed = parseMflash(rawText);
  const validated = validateMflashPackage(parsed.package);
  if (!validated.package) throw new Error(`Arquivo .mflash inválido (${parsed.format}): ${validated.issues.filter(i => i.severity === 'error').map(i => i.message).join(' | ')}`);
  const packageHash = hashPackage(rawText);
  const plan = await buildImportPlan(validated.package, packageHash);
  plan.issues.push(...validated.issues);
  const storage = await estimateStorageAfterImport(plan);
  const storageLimit = Number(process.env.CONTENT_IMPORT_MAX_STORAGE_PERCENT || 95);
  if (storage.afterPercent > storageLimit) plan.issues.push({ severity: 'error', code: 'STORAGE_LIMIT', path: '$', message: `Importação levaria o uso estimado para ${storage.afterPercent}%, acima do limite de segurança ${storageLimit}%.` });
  const db = getAdminFirestore(); if (!db) throw new Error('Firebase Admin não configurado.');
  const jobRef = db.collection('contentImportJobs').doc(shortHash(`${packageHash}|${Date.now()}`));
  const jobId = jobRef.id;
  const chunkCount = Math.ceil(Buffer.byteLength(rawText, 'utf8') / STAGING_CHUNK_BYTES);
  await jobRef.set({ jobId, status: 'staged', inputFormat: parsed.format, package: validated.package.manifest.package, packageHash, manifest: plan.manifest, stats: plan.stats, issues: plan.issues, storage, chunkCount, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() });
  for (let i = 0; i < chunkCount; i++) {
    const chunk = Buffer.from(rawText, 'utf8').subarray(i * STAGING_CHUNK_BYTES, (i + 1) * STAGING_CHUNK_BYTES).toString('utf8');
    await jobRef.collection('chunks').doc(String(i).padStart(6, '0')).set({ index: i, data: chunk });
  }
  return { jobId, plan, storage };
}

export async function loadStagedPackage(jobId: string): Promise<{ job: any; rawText: string }> {
  const db = getAdminFirestore(); if (!db) throw new Error('Firebase Admin não configurado.');
  const ref = db.collection('contentImportJobs').doc(jobId); const snap = await ref.get(); if (!snap.exists) throw new Error('Importação não encontrada.');
  const chunks = await ref.collection('chunks').orderBy('index').get();
  return { job: snap.data(), rawText: chunks.docs.map(d => String(d.data().data || '')).join('') };
}

export async function publishStagedImport(jobId: string): Promise<ImportPlan> {
  const db = getAdminFirestore(); if (!db) throw new Error('Firebase Admin não configurado.');
  const { job, rawText } = await loadStagedPackage(jobId);
  if (job.status === 'completed') return job.plan as ImportPlan;
  const parsed = parseMflash(rawText); const validated = validateMflashPackage(parsed.package); if (!validated.package) throw new Error('Staging inválido.');
  const plan = await buildImportPlan(validated.package, String(job.packageHash));
  plan.jobId = jobId;
  if (plan.issues.some(i => i.severity === 'error') || validated.issues.some(i => i.severity === 'error')) throw new Error(`Publicação bloqueada: ${[...plan.issues, ...validated.issues].filter(i => i.severity === 'error').map(i => i.message).join(' | ')}`);
  await db.collection('contentImportJobs').doc(jobId).set({ status: 'importing', updatedAt: new Date().toISOString(), startedAt: new Date().toISOString() }, { merge: true });
  const writeItems: Array<{ ref: FirebaseFirestore.DocumentReference; data: any; merge?: boolean }> = [];
  const subjectLevels = new Map<string, Array<{ level: EducationLevel; label: string; icon: string; reason: string; priority: number }>>();
  for (const level of validated.package.levels) {
    for (const subject of level.subjects) {
      const arr = subjectLevels.get(subject.name) || [];
      if (!arr.some(x => x.level === level.id)) arr.push({ level: level.id, label: levelLabel(level.id), icon: 'book', reason: 'Importado do pacote editorial .mflash', priority: 5 });
      subjectLevels.set(subject.name, arr);
      for (const curriculum of subject.curricula) {
        const categories = curriculum.topics.map(t => ({ category: t.name, topics: t.subtopics.map(s => s.name) }));
        const topicTree = curriculum.topics.map(t => ({ topic: t.name, subtopics: t.subtopics.map(s => s.name) }));
        const currRef = db.collection('curricula').doc(curriculumId(subject.name, level.id));
        writeItems.push({ ref: currRef, merge: true, data: { subject: subject.name, level: level.id, categories, topicTree, topicCount: curriculum.topics.length, subtopicCount: curriculum.topics.reduce((n, t) => n + t.subtopics.length, 0), totalTopics: curriculum.topics.length, totalSubtopics: curriculum.topics.reduce((n, t) => n + t.subtopics.length, 0), contentVersion: validated.package.manifest.contentVersion, version: Number(job?.manifest?.contentVersion === validated.package.manifest.contentVersion ? (job?.stats?.curriculaVersion || 1) : 1), updatedAt: new Date().toISOString(), ttlAt: makeTtl(TTL_DAYS.CURRICULUM), providerUsed: 'mflash-import' } });
        for (const topic of curriculum.topics) for (const subtopic of topic.subtopics) {
          const cards = subtopic.cards.map(raw => makeCard(raw, subject.name, topic.name, subtopic.name, level.id, validated.package!.manifest));
          const bucketRef = db.collection('cardBuckets').doc(bucketId(subject.name, topic.name, level.id, 'definition' as CardContentType, subtopic.name));
          const oldSnap = await bucketRef.get(); const old = oldSnap.exists ? oldSnap.data() as any : undefined;
          const oldCards = Array.isArray(old?.cards) ? old.cards as BankCard[] : [];
          const map = new Map<string, BankCard>(); for (const c of oldCards) map.set(c.contentHash || contentHash(c.front, c.back, `${subject.name}|${topic.name}|${c.subtopic || subtopic.name}`), c);
          for (const c of cards) { const existing = map.get(c.contentHash!); if (existing) { if (existing.id && existing.front === c.front && existing.back === c.back && existing.explanation === c.explanation) continue; map.set(c.contentHash!, { ...c, id: existing.id, version: Number(existing.version || 1) + 1 } as BankCard); } else map.set(c.contentHash!, { ...c, id: shortHash(c.contentHash!) } as BankCard); }
          const all = [...map.values()];
          const projected = bytes({ cards: all, subject: subject.name, topic: topic.name, subtopic: subtopic.name });
          if (projected > FIRESTORE_DOC_SAFE_BYTES) throw new Error(`Bucket excede o tamanho seguro do Firestore: ${subject.name}/${level.id}/${topic.name}/${subtopic.name}. Reduza a quantidade por subtópico.`);
          writeItems.push({ ref: bucketRef, merge: true, data: { subject: subject.name, topic: topic.name, subtopic: subtopic.name, level: level.id, cardType: 'definition', cards: all, cardCount: all.length, version: Number(old?.version || 0) + 1, qualityScore: all.length ? Math.round(all.reduce((n, c) => n + Number(c.qualityScore || 0), 0) / all.length) : 0, updatedAt: new Date().toISOString(), ttlAt: makeTtl(TTL_DAYS.CARD_BUCKET), providerUsed: 'mflash-import' } });
        }
      }
    }
  }
  for (const [subject, levels] of subjectLevels) {
    const ref = db.collection('subjects').doc(shortHash(normalizeText(subject)));
    writeItems.push({ ref, merge: true, data: { subject, normalized: normalizeText(subject), levels, updatedAt: new Date().toISOString(), ttlAt: makeTtl(TTL_DAYS.SUBJECT_LEVELS), providerUsed: 'mflash-import', version: 1 } });
    writeItems.push({ ref: db.collection('contentIndex').doc(normalizeText(subject).replace(/\s+/g, '-')), merge: true, data: { subjectId: shortHash(normalizeText(subject)), subject, normalized: normalizeText(subject), aliases: [normalizeText(subject)], status: 'ready', version: 1, updatedAt: new Date().toISOString() } });
  }
  await writeInBatches(writeItems);
  await db.collection('contentImportJobs').doc(jobId).set({ status: 'completed', plan: { ...plan, jobId }, completedAt: new Date().toISOString(), updatedAt: new Date().toISOString() }, { merge: true });
  return { ...plan, jobId };
}

export async function cancelStagedImport(jobId: string): Promise<void> {
  const db = getAdminFirestore(); if (!db) throw new Error('Firebase Admin não configurado.');
  const ref = db.collection('contentImportJobs').doc(jobId); const snap = await ref.get(); if (!snap.exists) throw new Error('Importação não encontrada.');
  if (snap.data()?.status === 'completed') throw new Error('Não é possível cancelar uma importação concluída.');
  await ref.set({ status: 'cancelled', cancelledAt: new Date().toISOString(), updatedAt: new Date().toISOString() }, { merge: true });
}
