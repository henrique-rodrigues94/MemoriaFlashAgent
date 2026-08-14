// 📁 flashmind-ai/src/server/db/db.ts
//
// Camada de acesso ao Firestore para o MemoriaFlash.
// Centraliza todas as leituras/escritas — nenhum outro arquivo deve
// importar `getAdminFirestore()` diretamente.
//
// REGRA DE OURO: a IA só é chamada quando não há dado válido no banco.
// Cada função pública retorna { data, fromCache: boolean } para que o
// servidor possa logar e monitorar a taxa de economia de chamadas à IA.

import { getAdminFirestore } from '../firebaseAdmin';
import {
  SubjectDoc, CurriculumDoc, CardBucketDoc, BankCard,
  EducationLevel, CardContentType,
  subjectId, curriculumId, bucketId,
  normalizeText, shortHash,
  makeTtl, isExpired, TTL_DAYS,
} from './firestoreSchema';

// ─── Re-exporta tipos públicos ────────────────────────────────────────────────

export type { BankCard, EducationLevel, CardContentType };
export type { SubjectDoc, CurriculumDoc, CardBucketDoc };

// ═══════════════════════════════════════════════════════════════════════════
//  SUBJECTS — níveis de uma matéria
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Busca os níveis detectados para uma matéria.
 * Retorna null se não existe ou expirou → servidor deve gerar via IA e salvar.
 */
export async function getSubjectLevels(
  subject: string,
): Promise<{ data: SubjectDoc; fromCache: true } | null> {
  const db = getAdminFirestore();
  if (!db) return null;

  try {
    const ref = db.collection('subjects').doc(subjectId(subject));
    const snap = await ref.get();
    if (!snap.exists) return null;
    const doc = snap.data() as SubjectDoc;
    if (isExpired(doc.ttlAt)) return null;
    return { data: doc, fromCache: true };
  } catch (err: any) {
    console.warn('[db] getSubjectLevels error:', err?.message);
    return null;
  }
}

export async function saveSubjectLevels(
  subject: string,
  levels: SubjectDoc['levels'],
  providerUsed: string,
): Promise<void> {
  const db = getAdminFirestore();
  if (!db) return;
  try {
    const doc: SubjectDoc = {
      subject: subject.trim(),
      normalized: normalizeText(subject),
      levels,
      updatedAt: new Date().toISOString(),
      ttlAt: makeTtl(TTL_DAYS.SUBJECT_LEVELS),
      providerUsed,
    };
    await db.collection('subjects').doc(subjectId(subject)).set(doc);
  } catch (err: any) {
    console.warn('[db] saveSubjectLevels error:', err?.message);
  }
}

// ═══════════════════════════════════════════════════════════════════════════
//  CURRICULA — grade curricular por matéria + nível
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Busca a grade curricular. Retorna null se não existe ou expirou.
 * CUSTO: 1 read do Firestore (doc inline com todas as categorias).
 */
export async function getCurriculum(
  subject: string,
  level: EducationLevel,
): Promise<{ data: CurriculumDoc; fromCache: true } | null> {
  const db = getAdminFirestore();
  if (!db) return null;

  try {
    const ref = db.collection('curricula').doc(curriculumId(subject, level));
    const snap = await ref.get();
    if (!snap.exists) return null;
    const doc = snap.data() as CurriculumDoc;
    if (isExpired(doc.ttlAt)) return null;
    return { data: doc, fromCache: true };
  } catch (err: any) {
    console.warn('[db] getCurriculum error:', err?.message);
    return null;
  }
}

export async function saveCurriculum(
  subject: string,
  level: EducationLevel,
  categories: CurriculumDoc['categories'],
  providerUsed: string,
): Promise<void> {
  const db = getAdminFirestore();
  if (!db) return;
  try {
    const totalTopics = categories.reduce((s, c) => s + c.topics.length, 0);
    const doc: CurriculumDoc = {
      subject: subject.trim(),
      level,
      categories,
      totalTopics,
      updatedAt: new Date().toISOString(),
      ttlAt: makeTtl(TTL_DAYS.CURRICULUM),
      providerUsed,
    };
    await db.collection('curricula').doc(curriculumId(subject, level)).set(doc);
  } catch (err: any) {
    console.warn('[db] saveCurriculum error:', err?.message);
  }
}

// ═══════════════════════════════════════════════════════════════════════════
//  CARD BUCKETS — cards agrupados por (subject + topic + level + cardType)
// ═══════════════════════════════════════════════════════════════════════════
//
//  PRINCIPAL OTIMIZAÇÃO:
//  Todos os cards de um balde ficam INLINE em um único documento.
//  - Antes: buscar 50 cards = 51 reads (1 meta + 50 sub-docs)
//  - Agora: buscar qualquer quantidade = 1 read sempre
//
//  Firestore doc limit: 1 MB. Com ~600 bytes/card cabe ~1600 cards/balde.
//  Na prática usamos max 200 cards/balde — muito seguro.

/**
 * Busca cards de um balde.
 * Retorna { cards, stale } — stale=true quando expirado (deve re-gerar).
 * CUSTO: sempre 1 read, independente de quantos cards tem.
 */
export async function getCardBucket(
  subject: string,
  topic: string,
  level: EducationLevel,
  cardType: CardContentType,
  limit: number,
): Promise<{ cards: BankCard[]; stale: boolean }> {
  const db = getAdminFirestore();
  if (!db || limit <= 0) return { cards: [], stale: true };

  try {
    const id = bucketId(subject, topic, level, cardType);
    const snap = await db.collection('cardBuckets').doc(id).get();

    if (!snap.exists) return { cards: [], stale: true };

    const doc = snap.data() as CardBucketDoc;
    const stale = isExpired(doc.ttlAt);

    const cards: BankCard[] = Array.isArray(doc.cards) ? doc.cards : [];

    // Fisher-Yates shuffle para variedade
    for (let i = cards.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [cards[i], cards[j]] = [cards[j], cards[i]];
    }

    return { cards: cards.slice(0, limit), stale };
  } catch (err: any) {
    console.warn('[db] getCardBucket error:', err?.message);
    return { cards: [], stale: true };
  }
}

/**
 * Salva cards no balde (upsert).
 * Cards novos são adicionados; cards com mesmo front são ignorados (dedup).
 * CUSTO: 1 read (buscar doc atual) + 1 write (set doc atualizado).
 */
export async function saveCardBucket(
  subject: string,
  topic: string,
  level: EducationLevel,
  cardType: CardContentType,
  newCards: Omit<BankCard, 'id'>[],
  providerUsed: string,
): Promise<void> {
  const db = getAdminFirestore();
  if (!db || newCards.length === 0) return;

  try {
    const id = bucketId(subject, topic, level, cardType);
    const ref = db.collection('cardBuckets').doc(id);
    const snap = await ref.get();

    // Indexa os cards existentes por id para dedup em O(1)
    const existing = new Map<string, BankCard>();
    if (snap.exists) {
      const doc = snap.data() as CardBucketDoc;
      (doc.cards || []).forEach(c => existing.set(c.id, c));
    }

    // Adiciona apenas cards com front único
    let added = 0;
    for (const card of newCards) {
      const front = (card.front || '').trim();
      if (!front) continue;
      const cardId = shortHash(normalizeText(front));
      if (!existing.has(cardId)) {
        existing.set(cardId, { ...card, id: cardId });
        added++;
      }
    }

    if (added === 0 && snap.exists) return; // nada de novo

    const allCards = Array.from(existing.values());
    const now = new Date().toISOString();

    const doc: CardBucketDoc = {
      subject: subject.trim(),
      topic: topic.trim(),
      level,
      cardType,
      cards: allCards,
      cardCount: allCards.length,
      updatedAt: now,
      ttlAt: makeTtl(TTL_DAYS.CARD_BUCKET),
      providerUsed,
    };

    await ref.set(doc);
    console.info(`[db] cardBucket ${id}: +${added} cards (total: ${allCards.length})`);
  } catch (err: any) {
    console.warn('[db] saveCardBucket error:', err?.message);
  }
}

/**
 * Verifica disponibilidade de cards em múltiplos baldes em paralelo.
 * CUSTO: N reads em paralelo (1 por tópico).
 */
export async function getBucketStats(
  subject: string,
  topics: string[],
  level: EducationLevel,
  cardType: CardContentType = 'definition',
): Promise<Array<{
  topic: string;
  cardCount: number;
  stale: boolean;
  bucketId: string;
}>> {
  const db = getAdminFirestore();
  if (!db || topics.length === 0) return [];

  const results = await Promise.all(
    topics.map(async topic => {
      try {
        const id = bucketId(subject, topic, level, cardType);
        const snap = await db.collection('cardBuckets').doc(id).get();
        if (!snap.exists) return { topic, cardCount: 0, stale: true, bucketId: id };
        const doc = snap.data() as CardBucketDoc;
        return {
          topic,
          cardCount: doc.cardCount ?? (doc.cards?.length ?? 0),
          stale: isExpired(doc.ttlAt),
          bucketId: id,
        };
      } catch {
        return { topic, cardCount: 0, stale: true, bucketId: '' };
      }
    }),
  );

  return results;
}

// ═══════════════════════════════════════════════════════════════════════════
//  BATCH PREFETCH — pré-carrega múltiplos buckets em paralelo
// ═══════════════════════════════════════════════════════════════════════════
//
//  Usado quando o usuário seleciona vários tópicos de uma vez.
//  Em vez de fazer reads sequenciais (um por slot no loop), faz todos
//  em paralelo e retorna um Map para acesso em O(1) por bucketId.
//
//  CUSTO: N reads em paralelo (vs N reads sequenciais antes).
//  GANHO: tempo de resposta ~= 1 read em vez de N × latência.

export async function prefetchCardBuckets(
  subject: string,
  topics: string[],
  level: EducationLevel,
  cardType: CardContentType,
): Promise<Map<string, { cards: BankCard[]; stale: boolean }>> {
  const db = getAdminFirestore();
  const result = new Map<string, { cards: BankCard[]; stale: boolean }>();
  if (!db || topics.length === 0) return result;

  await Promise.all(
    topics.map(async topic => {
      const id = bucketId(subject, topic, level, cardType);
      try {
        const snap = await db.collection('cardBuckets').doc(id).get();
        if (!snap.exists) {
          result.set(id, { cards: [], stale: true });
          return;
        }
        const doc = snap.data() as CardBucketDoc;
        result.set(id, {
          cards: Array.isArray(doc.cards) ? doc.cards : [],
          stale: isExpired(doc.ttlAt),
        });
      } catch {
        result.set(id, { cards: [], stale: true });
      }
    }),
  );

  return result;
}
