// 📁 flashmind-ai/src/server/contentAgent/cards/cardBucketRepository.ts
//
// Fora de src/server/db/db.ts de propósito: "remover cards de um balde" é
// uma operação exclusiva do CardUpdater do agente, não algo que o app
// precisa (o app só lê/adiciona via getCardBucket/saveCardBucket). Mesma
// coleção (`cardBuckets`), acesso direto por Admin SDK.

import { getAdminFirestore } from '../../firebaseAdmin';
import { bucketId } from '../../db/firestoreSchema';
import type { CardBucketDoc, EducationLevel, CardContentType, BankCard } from '../../db/firestoreSchema';

export async function loadBucket(
  subject: string,
  topic: string,
  level: EducationLevel,
  cardType: CardContentType,
): Promise<CardBucketDoc | null> {
  const db = getAdminFirestore();
  if (!db) return null;
  const id = bucketId(subject, topic, level, cardType);
  const snap = await db.collection('cardBuckets').doc(id).get();
  return snap.exists ? (snap.data() as CardBucketDoc) : null;
}

export interface CardRevisionHistoryEntry {
  bucketId: string;
  subject: string;
  topic: string;
  level: EducationLevel;
  cardType: CardContentType;
  reviewVersion: number;
  removedCards: BankCard[];
  qualityScore: number;
  removedAt: string;
  restoredAt?: string; // presente depois de um rollback
}

/**
 * Remove os cards indicados (por id) do balde, bumpa `reviewVersion` e
 * `lastReviewedAt`, grava `qualityScore`. NÃO regenera nada — o shortfall
 * criado pela remoção é resolvido no ciclo normal
 * (topicAnalyzer → cardGenerator), que já roda logo depois no orchestrator.
 * Isso evita duplicar a lógica de geração/validação/dedup dentro do
 * CardUpdater.
 *
 * Os cards removidos NÃO são apagados de fato — são copiados para
 * `cardRevisionHistory/{bucketId}_v{reviewVersion}` antes da remoção
 * (Seção 21: "manter histórico de versões para permitir rollback"). Ver
 * `rollbackLastReview` abaixo.
 */
export async function removeCardsFromBucket(
  subject: string,
  topic: string,
  level: EducationLevel,
  cardType: CardContentType,
  cardIdsToRemove: string[],
  qualityScore: number,
): Promise<{ removed: number } | null> {
  const db = getAdminFirestore();
  if (!db || cardIdsToRemove.length === 0) return null;

  const id = bucketId(subject, topic, level, cardType);
  const ref = db.collection('cardBuckets').doc(id);
  const snap = await ref.get();
  if (!snap.exists) return null;

  const doc = snap.data() as CardBucketDoc;
  const toRemove = new Set(cardIdsToRemove);
  const removedCards = (doc.cards || []).filter(c => toRemove.has(c.id));
  const remaining: BankCard[] = (doc.cards || []).filter(c => !toRemove.has(c.id));
  const removed = removedCards.length;
  if (removed === 0) return { removed: 0 };

  const nextVersion = (doc.reviewVersion ?? 0) + 1;
  const now = new Date().toISOString();

  const updated: CardBucketDoc = {
    ...doc,
    cards: remaining,
    cardCount: remaining.length,
    qualityScore,
    reviewVersion: nextVersion,
    lastReviewedAt: now,
    updatedAt: now,
  };

  const historyEntry: CardRevisionHistoryEntry = {
    bucketId: id, subject, topic, level, cardType,
    reviewVersion: nextVersion, removedCards, qualityScore, removedAt: now,
  };

  // Grava o histórico ANTES do balde — se a escrita do balde falhar depois,
  // o pior cenário é um histórico órfão (inofensivo), nunca perder os cards
  // sem deixar rastro.
  await db.collection('cardRevisionHistory').doc(`${id}_v${nextVersion}`).set(historyEntry);
  await ref.set(updated);

  return { removed };
}

/**
 * Reverte a última revisão automática que removeu cards de um balde —
 * devolve os cards ao balde e marca o histórico como restaurado. Não é
 * chamado pelo orchestrator automaticamente: é uma ferramenta operacional
 * para quando o CardUpdater removeu cards que, na prática, eram bons (falso
 * positivo do feedback agregado). Ver `src/server/contentAgent/rollback.ts`.
 */
export async function rollbackLastReview(
  subject: string,
  topic: string,
  level: EducationLevel,
  cardType: CardContentType,
): Promise<{ restored: number; reviewVersion: number } | null> {
  const db = getAdminFirestore();
  if (!db) return null;

  const id = bucketId(subject, topic, level, cardType);
  const historyRef = db.collection('cardRevisionHistory');
  const snap = await historyRef
    .where('bucketId', '==', id)
    .orderBy('reviewVersion', 'desc')
    .limit(1)
    .get();

  if (snap.empty) return null;
  const entryDoc = snap.docs[0];
  const entry = entryDoc.data() as CardRevisionHistoryEntry;
  if (entry.restoredAt) return { restored: 0, reviewVersion: entry.reviewVersion }; // já restaurado antes

  const bucketRef = db.collection('cardBuckets').doc(id);
  const bucketSnap = await bucketRef.get();
  if (!bucketSnap.exists) return null;

  const doc = bucketSnap.data() as CardBucketDoc;
  const existingIds = new Set((doc.cards || []).map(c => c.id));
  const toRestore = entry.removedCards.filter(c => !existingIds.has(c.id)); // evita duplicar se algum já foi regenerado
  const restoredCards = [...(doc.cards || []), ...toRestore];

  await bucketRef.set({
    ...doc,
    cards: restoredCards,
    cardCount: restoredCards.length,
    updatedAt: new Date().toISOString(),
  });
  await entryDoc.ref.set({ ...entry, restoredAt: new Date().toISOString() });

  return { restored: toRestore.length, reviewVersion: entry.reviewVersion };
}
