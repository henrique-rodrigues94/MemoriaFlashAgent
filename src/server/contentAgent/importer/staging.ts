import { getAdminFirestore } from '../../firebaseAdmin';
import { buildImportPlan, estimateStorageAfterImport, validateMflashPackage, MflashPackage } from './completoMflash';
import { createHash } from 'crypto';

const CHUNK_CHARS = 800_000;
const MAX_BYTES = Number(process.env.CONTENT_IMPORT_MAX_BYTES || 50 * 1024 * 1024);

function hash(raw: string): string { return createHash('sha256').update(raw).digest('hex'); }

export async function stageMflashProduction(rawText: string) {
  if (Buffer.byteLength(rawText, 'utf8') > MAX_BYTES) throw new Error('Arquivo excede o limite configurado para importação.');
  let parsed: unknown;
  try { parsed = JSON.parse(rawText); } catch (err: any) { throw new Error(`JSON inválido: ${err?.message || String(err)}`); }
  const validation = validateMflashPackage(parsed);
  if (!validation.package) throw new Error(`Arquivo inválido: ${validation.issues.filter(x => x.severity === 'error').map(x => x.message).join(' | ')}`);
  const packageHash = hash(rawText);
  const plan = await buildImportPlan(validation.package, packageHash);
  plan.issues.push(...validation.issues);
  const storage = await estimateStorageAfterImport(plan);
  const maxStorage = Number(process.env.CONTENT_IMPORT_MAX_STORAGE_PERCENT || 95);
  if (storage.afterPercent > maxStorage) plan.issues.push({ severity: 'error', code: 'STORAGE_LIMIT', path: '$', message: `Importação levaria o uso estimado para ${storage.afterPercent}%, acima do limite de segurança ${maxStorage}%.` });
  const db = getAdminFirestore(); if (!db) throw new Error('Firebase Admin não configurado.');
  const jobId = hash(`${packageHash}|${Date.now()}`).slice(0, 24);
  const jobRef = db.collection('contentImportJobs').doc(jobId);
  const chunkCount = Math.ceil(rawText.length / CHUNK_CHARS);
  await jobRef.set({ jobId, status: 'staged', package: 'completo', packageHash, manifest: plan.manifest, stats: plan.stats, issues: plan.issues, storage, chunkCount, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() });
  for (let i = 0; i < chunkCount; i++) {
    const data = rawText.slice(i * CHUNK_CHARS, (i + 1) * CHUNK_CHARS);
    await jobRef.collection('chunks').doc(String(i).padStart(6, '0')).set({ index: i, encoding: 'utf8', data });
  }
  return { jobId, plan, storage };
}

export async function loadMflashProduction(jobId: string): Promise<{ job: any; rawText: string }> {
  const db = getAdminFirestore(); if (!db) throw new Error('Firebase Admin não configurado.');
  const ref = db.collection('contentImportJobs').doc(jobId); const snap = await ref.get(); if (!snap.exists) throw new Error('Importação não encontrada.');
  const chunks = await ref.collection('chunks').orderBy('index').get();
  const rawText = chunks.docs.map(d => String(d.data().data || '')).join('');
  return { job: snap.data(), rawText };
}

export async function deleteStagedChunks(jobId: string): Promise<void> {
  const db = getAdminFirestore(); if (!db) return;
  const ref = db.collection('contentImportJobs').doc(jobId).collection('chunks'); const snap = await ref.get();
  for (let i = 0; i < snap.docs.length; i += 400) { const batch = db.batch(); for (const doc of snap.docs.slice(i, i + 400)) batch.delete(doc.ref); await batch.commit(); }
}
