// 📁 flashmind-ai/src/server/contentAgent/feedback/feedbackRepository.ts
//
// Único ponto de leitura de `cardFeedback` no Content Agent — mesmo padrão
// de src/server/db/db.ts (mas feedback é exclusivo do agente, então não
// entra no db.ts compartilhado com o app).

import { getAdminFirestore } from '../../firebaseAdmin';
import type { CardFeedbackDoc, EducationLevel, CardContentType } from '../../db/firestoreSchema';

export interface FeedbackQuery {
  subject: string;
  level: EducationLevel;
  topic?: string;
  cardType?: CardContentType;
  /** Limite de docs lidos por consulta — protege contra tópicos com histórico
   *  gigante de feedback custando uma leitura cara demais numa única execução. */
  limit?: number;
}

/**
 * Busca feedback bruto para agregação. Usa apenas Admin SDK — nunca chamado
 * pelo app, só pelo Content Agent.
 */
export async function queryFeedback(q: FeedbackQuery): Promise<CardFeedbackDoc[]> {
  const db = getAdminFirestore();
  if (!db) return [];

  let ref = db.collection('cardFeedback')
    .where('subject', '==', q.subject)
    .where('level', '==', q.level) as FirebaseFirestore.Query;

  if (q.topic) ref = ref.where('topic', '==', q.topic);
  if (q.cardType) ref = ref.where('cardType', '==', q.cardType);

  const snap = await ref.limit(q.limit ?? 1000).get();
  return snap.docs.map(d => d.data() as CardFeedbackDoc);
}
