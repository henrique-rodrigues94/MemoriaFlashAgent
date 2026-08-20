import { getAdminFirestore } from '../../firebaseAdmin';
import type { CardFeedbackDoc, EducationLevel, CardContentType } from '../../db/firestoreSchema';

export interface FeedbackQuery { subject: string; level: EducationLevel; topic?: string; cardType?: CardContentType; limit?: number; }
export type CorrectionFeedbackDoc = CardFeedbackDoc & { feedbackId: string };

export async function queryFeedback(q: FeedbackQuery): Promise<CardFeedbackDoc[]> {
  const db = getAdminFirestore();
  if (!db) return [];
  let ref = db.collection('cardFeedback').where('subject', '==', q.subject).where('level', '==', q.level) as FirebaseFirestore.Query;
  if (q.topic) ref = ref.where('topic', '==', q.topic);
  if (q.cardType) ref = ref.where('cardType', '==', q.cardType);
  const snap = await ref.limit(q.limit ?? 1000).get();
  return snap.docs.map(d => d.data() as CardFeedbackDoc);
}

/** Feedback novo entra com status=pending. O Agent só consome essa fila.
 * O filtro de status é feito em memória para evitar exigir índice composto. */
export async function queryNegativeFeedbackForCorrection(limit = 500): Promise<CorrectionFeedbackDoc[]> {
  const db = getAdminFirestore();
  if (!db) return [];
  const snap = await db.collection('cardFeedback').where('rating', '==', 'negative').limit(Math.max(limit * 2, limit)).get();
  return snap.docs
    .filter(d => String(d.data()?.status || '') === 'pending')
    .slice(0, limit)
    .map(d => ({ ...(d.data() as CardFeedbackDoc), feedbackId: d.id }));
}

export async function markFeedbackProcessed(feedbackIds: string[]): Promise<void> {
  const db = getAdminFirestore();
  if (!db || feedbackIds.length === 0) return;
  const batch = db.batch();
  const now = new Date().toISOString();
  for (const id of feedbackIds.slice(0, 500)) {
    batch.update(db.collection('cardFeedback').doc(id), { status: 'processed', processedAt: now });
  }
  await batch.commit();
}

/** Marca feedback como "falhou" (não "processed") após esgotar as tentativas
 * de correção — tira o item da fila de `pending` (evitando que ele trave a
 * fila para sempre, já que ela é ordenada por taxa de negativos e um item
 * "impossível de corrigir" ficaria sempre no topo, bloqueando os demais),
 * mas mantém rastreável no Firestore para revisão manual, diferente de um
 * item corrigido com sucesso. */
export async function markFeedbackFailed(feedbackIds: string[], reason: string): Promise<void> {
  const db = getAdminFirestore();
  if (!db || feedbackIds.length === 0) return;
  const batch = db.batch();
  const now = new Date().toISOString();
  for (const id of feedbackIds.slice(0, 500)) {
    batch.update(db.collection('cardFeedback').doc(id), { status: 'failed', processedAt: now, failureReason: reason.slice(0, 500) });
  }
  await batch.commit();
}

/** Incrementa a contagem de tentativas de correção sem alterar o status —
 * usado para permitir algumas tentativas antes de desistir de vez de um
 * card (ver `markFeedbackFailed`). Retorna a maior contagem de tentativas
 * entre os itens atualizados, para o job decidir se já pode desistir. */
export async function incrementCorrectionAttempts(feedbackIds: string[]): Promise<number> {
  const db = getAdminFirestore();
  if (!db || feedbackIds.length === 0) return 0;
  const refs = feedbackIds.slice(0, 500).map(id => db.collection('cardFeedback').doc(id));
  const snaps = await db.getAll(...refs);
  const batch = db.batch();
  let maxAttempts = 0;
  for (const snap of snaps) {
    const current = Number(snap.data()?.correctionAttempts || 0) + 1;
    maxAttempts = Math.max(maxAttempts, current);
    batch.update(snap.ref, { correctionAttempts: current });
  }
  await batch.commit();
  return maxAttempts;
}
