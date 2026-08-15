import { getAdminFirestore } from '../../firebaseAdmin';

const MAX_CHUNK_CHARS = 12000;
const MAX_CHUNKS = 80;

export interface DocumentSourceMeta {
  fileName: string;
  mimeType: 'application/pdf' | 'text/plain';
  totalChars: number;
  chunkCount: number;
  createdAt: string;
}

function normalizeChunk(value: string): string {
  return String(value || '').replace(/\u0000/g, '').replace(/\r\n/g, '\n').replace(/[ \t]+\n/g, '\n').replace(/\n{4,}/g, '\n\n').trim();
}

export async function saveDocumentSource(requestId: string, fileName: string, mimeType: 'application/pdf' | 'text/plain', sourceText: string): Promise<DocumentSourceMeta> {
  const db = getAdminFirestore();
  if (!db) throw new Error('Firebase Admin indisponível para armazenar a fonte do documento.');

  const normalized = normalizeChunk(sourceText);
  if (!normalized) throw new Error('O documento não possui texto extraído.');

  const chunks: string[] = [];
  for (let start = 0; start < normalized.length && chunks.length < MAX_CHUNKS; start += MAX_CHUNK_CHARS) {
    chunks.push(normalized.slice(start, start + MAX_CHUNK_CHARS));
  }
  if (normalized.length > MAX_CHUNK_CHARS * MAX_CHUNKS) {
    throw new Error(`Documento excede o limite de conteúdo da V1 (${MAX_CHUNK_CHARS * MAX_CHUNKS} caracteres).`);
  }

  const ref = db.collection('contentRequests').doc(requestId);
  const batch = db.batch();
  const sourceRef = ref.collection('sourceChunks');
  const old = await sourceRef.get();
  old.docs.forEach(doc => batch.delete(doc.ref));
  chunks.forEach((text, index) => batch.set(sourceRef.doc(String(index + 1).padStart(4, '0')), {
    index,
    text,
    chars: text.length,
    createdAt: new Date().toISOString(),
  }));
  await batch.commit();

  const meta: DocumentSourceMeta = {
    fileName: fileName.trim().slice(0, 180) || 'documento',
    mimeType,
    totalChars: normalized.length,
    chunkCount: chunks.length,
    createdAt: new Date().toISOString(),
  };
  await ref.set({ source: meta }, { merge: true });
  return meta;
}

export async function loadDocumentSource(requestId: string): Promise<string> {
  const db = getAdminFirestore();
  if (!db) return '';
  const snap = await db.collection('contentRequests').doc(requestId).collection('sourceChunks').orderBy('index', 'asc').get();
  return snap.docs.map(doc => String(doc.data()?.text || '')).filter(Boolean).join('\n\n');
}
