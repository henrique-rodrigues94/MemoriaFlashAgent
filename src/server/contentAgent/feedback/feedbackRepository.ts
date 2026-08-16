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
