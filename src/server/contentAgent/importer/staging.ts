import { getAdminFirestore } from '../../firebaseAdmin';
import { buildImportPlan, estimateStorageAfterImport, validateMflashPackage } from './completoMflash';
import { analyzeImportQuality } from './importQuality';
import { createHash } from 'crypto';

const CHUNK_CHARS = 800_000;
const MAX_BYTES = Number(process.env.CONTENT_IMPORT_MAX_BYTES || 50 * 1024 * 1024);
const DEFAULT_DAILY_WRITES = 20_000;
const DEFAULT_MAX_WRITES_PER_RUN = 15_000;

function hash(raw: string): string { return createHash('sha256').update(raw).digest('hex'); }
function estimateWrites(pkg: any, chunkCount: number): number {
  let curricula = 0; let buckets = 0; let subjects = 0;
  for (const level of Array.isArray(pkg.levels) ? pkg.levels : []) for (const subject of Array.isArray(level.subjects) ? level.subjects : []) {
    subjects++;
    for (const curriculum of Array.isArray(subject.curricula) ? subject.curricula : []) { curricula++; buckets += (Array.isArray(curriculum.topics) ? curriculum.topics : []).reduce((n: number, t: any) => n + (Array.isArray(t.subtopics) ? t.subtopics.length : 0), 0); }
  }
  return chunkCount + curricula + buckets + subjects * 2 + 2;
}

export async function stageMflashProduction(rawText: string) {
  if (Buffer.byteLength(rawText, 'utf8') > MAX_BYTES) throw new Error('Arquivo excede o limite configurado para importação.');
  let parsed: unknown;
  try { parsed = JSON.parse(rawText); } catch (err: any) { throw new Error(`JSON inválido: ${err?.message || String(err)}`); }
  const validation = validateMflashPackage(parsed);
  if (!validation.package) throw new Error(`Arquivo inválido: ${validation.issues.filter(x => x.severity === 'error').map(x => x.message).join(' | ')}`);
  const packageHash = hash(rawText);
  const plan = await buildImportPlan(validation.package, packageHash);
  plan.issues.push(...validation.issues);
  const quality = analyzeImportQuality(validation.package);
  if (quality.exactDuplicateCards > 0) plan.issues.push({ severity: 'warning', code: 'QUALITY_EXACT_DUPLICATES', path: '$', message: `${quality.exactDuplicateCards} card(s) duplicado(s) foram encontrados na auditoria de qualidade.` });
  if (quality.similarDuplicateCandidates.length > 0) plan.issues.push({ severity: 'warning', code: 'QUALITY_SIMILAR_DUPLICATES', path: '$', message: `${quality.similarDuplicateCandidates.length} possível(is) duplicação(ões) por similaridade foram detectadas. A publicação não é bloqueada automaticamente.` });
  if (quality.subtopicsWithoutCards.length > 0) plan.issues.push({ severity: 'warning', code: 'QUALITY_EMPTY_SUBTOPICS', path: '$', message: `${quality.subtopicsWithoutCards.length} subtópico(s) não possuem cards.` });
  const storage = await estimateStorageAfterImport(plan);
  const maxStorage = Number(process.env.CONTENT_IMPORT_MAX_STORAGE_PERCENT || 95);
  if (storage.afterPercent > maxStorage) plan.issues.push({ severity: 'error', code: 'STORAGE_LIMIT', path: '$', message: `Importação levaria o uso estimado para ${storage.afterPercent}%, acima do limite de segurança ${maxStorage}%.` });
  const chunkCount = Math.ceil(rawText.length / CHUNK_CHARS);
  const estimatedWrites = estimateWrites(validation.package, chunkCount);
  const dailyWrites = Number(process.env.FIRESTORE_FREE_WRITES_PER_DAY || DEFAULT_DAILY_WRITES);
  const maxWritesPerRun = Number(process.env.CONTENT_IMPORT_MAX_WRITES_PER_RUN || DEFAULT_MAX_WRITES_PER_RUN);
  if (estimatedWrites > maxWritesPerRun) plan.issues.push({ severity: 'error', code: 'WRITE_QUOTA_LIMIT', path: '$', message: `Importação estima ${estimatedWrites} escritas, acima do limite seguro por execução de ${maxWritesPerRun}.` });
  if (estimatedWrites > dailyWrites) plan.issues.push({ severity: 'error', code: 'DAILY_WRITE_QUOTA', path: '$', message: `Importação estima ${estimatedWrites} escritas, acima da referência diária gratuita de ${dailyWrites}.` });
  const db = getAdminFirestore(); if (!db) throw new Error('Firebase Admin não configurado.');
  const jobId = hash(`${packageHash}|${Date.now()}`).slice(0, 24);
  const jobRef = db.collection('contentImportJobs').doc(jobId);
  await jobRef.set({ jobId, status: 'staged', package: 'completo', packageHash, manifest: plan.manifest, stats: plan.stats, issues: plan.issues, quality, storage, quota: { estimatedWrites, dailyFreeReference: dailyWrites, maxWritesPerRun }, chunkCount, importStrategy: process.env.CONTENT_IMPORT_STRATEGY || 'sync', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() });
  for (let i = 0; i < chunkCount; i++) {
    const data = rawText.slice(i * CHUNK_CHARS, (i + 1) * CHUNK_CHARS);
    await jobRef.collection('chunks').doc(String(i).padStart(6, '0')).set({ index: i, encoding: 'utf8', data });
  }
  return { jobId, plan, quality, storage, quota: { estimatedWrites, dailyFreeReference: dailyWrites, maxWritesPerRun } };
}

export async function loadMflashProduction(jobId: string): Promise<{ job: any; rawText: string }> {
  const db = getAdminFirestore(); if (!db) throw new Error('Firebase Admin não configurado.');
  const ref = db.collection('contentImportJobs').doc(jobId); const snap = await ref.get(); if (!snap.exists) throw new Error('Importação não encontrada.');
  const chunks = await ref.collection('chunks').orderBy('index').get();
  const rawText = chunks.docs.map(d => String(d.data().data || '')).join('');
  const expectedHash = String(snap.data()?.packageHash || '');
  if (expectedHash && hash(rawText) !== expectedHash) throw new Error('Integridade do staging inválida: SHA-256 do arquivo não confere.');
  return { job: snap.data(), rawText };
}

export async function deleteStagedChunks(jobId: string): Promise<void> {
  const db = getAdminFirestore(); if (!db) return;
  const ref = db.collection('contentImportJobs').doc(jobId).collection('chunks'); const snap = await ref.get();
  for (let i = 0; i < snap.docs.length; i += 400) { const batch = db.batch(); for (const doc of snap.docs.slice(i, i + 400)) batch.delete(doc.ref); await batch.commit(); }
}
