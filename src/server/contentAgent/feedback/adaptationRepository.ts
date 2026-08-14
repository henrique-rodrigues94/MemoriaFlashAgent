// 📁 flashmind-ai/src/server/contentAgent/feedback/adaptationRepository.ts
//
// contentAdaptations/{subject|level} — estado aprendido pelo Learning
// Engine: ajuste de dificuldade por (tópico, tipo de card) e sinalização de
// tópicos para revisão. Escrito/lido só pelo Content Agent via Admin SDK.
// Não está nas regras públicas de firestore.rules → negado ao cliente por
// padrão, como as demais coleções do agente.

import { getAdminFirestore } from '../../firebaseAdmin';
import { subjectId, normalizeText, shortHash } from '../../db/firestoreSchema';
import type { EducationLevel, CardContentType } from '../../db/firestoreSchema';

export interface TopicAdaptation {
  topic: string;
  cardType: CardContentType;
  /** Passos de dificuldade acumulados: -1 = reduziu 1 nível, +1 = aumentou.
   *  Clampado em [-2, +2] — nunca deixa o Learning Engine "fugir" da
   *  dificuldade original de forma extrema (Seção 18/19 do briefing). */
  difficultyStepOffset: number;
  /** true quando negativeRate cruzou o limiar por um motivo que NÃO é
   *  dificuldade (pergunta confusa, explicação ruim, etc.) — sinaliza para
   *  uma futura revisão de conteúdo (CardUpdater, ainda não implementado). */
  flaggedForReview: boolean;
  basedOnFeedbackCount: number;
  lastReason?: string;
  updatedAt: string;
}

export interface SubjectAdaptationDoc {
  subject: string;
  level: EducationLevel;
  topics: Record<string, TopicAdaptation>; // key = `${topic}::${cardType}`
  /** Distribuição de tipos de card aprendida (Seção 18) — % por tipo,
   *  soma 100. Ausente = usa DEFAULT_CARD_TYPE_DISTRIBUTION sem ajuste. */
  typeDistribution?: Partial<Record<CardContentType, number>>;
  updatedAt: string;
}

function adaptationDocId(subject: string, level: EducationLevel): string {
  return shortHash(`${normalizeText(subject)}|${level}`);
}

export async function loadAdaptations(
  subject: string,
  level: EducationLevel,
): Promise<SubjectAdaptationDoc | null> {
  const db = getAdminFirestore();
  if (!db) return null;
  const snap = await db.collection('contentAdaptations').doc(adaptationDocId(subject, level)).get();
  return snap.exists ? (snap.data() as SubjectAdaptationDoc) : null;
}

export async function saveAdaptations(doc: SubjectAdaptationDoc): Promise<void> {
  const db = getAdminFirestore();
  if (!db) return;
  await db.collection('contentAdaptations').doc(adaptationDocId(doc.subject, doc.level)).set(doc);
}

/**
 * Limpa `flaggedForReview` depois que o CardUpdater já agiu sobre o tópico
 * — evita remover cards do mesmo balde toda execução; um novo flag só
 * aparece quando feedback NOVO cruzar os limiares de novo (Seção 16: sinal,
 * não veredito permanente).
 */
export async function clearReviewFlag(
  subject: string,
  level: EducationLevel,
  topic: string,
  cardType: CardContentType,
): Promise<void> {
  const doc = await loadAdaptations(subject, level);
  if (!doc) return;
  const key = `${topic}::${cardType}`;
  const entry = doc.topics[key];
  if (!entry) return;
  doc.topics[key] = { ...entry, flaggedForReview: false, updatedAt: new Date().toISOString() };
  doc.updatedAt = new Date().toISOString();
  await saveAdaptations(doc);
}

/** Atalho para o cardGenerator: dificuldade já ajustada para um tópico
 *  específico, ou null se não há adaptação aprendida ainda. */
export function resolveAdaptedDifficulty(
  baseDifficulty: string,
  offset: number,
): string {
  const ladder = ['easy', 'medium', 'hard', 'expert'];
  const currentIndex = ladder.indexOf(baseDifficulty);
  if (currentIndex === -1) return baseDifficulty; // dificuldade fora da escala conhecida — não mexe
  const clamped = Math.max(-2, Math.min(2, offset));
  const newIndex = Math.max(0, Math.min(ladder.length - 1, currentIndex + clamped));
  return ladder[newIndex];
}

// re-exportado para conveniência de quem só precisa do id determinístico
export { subjectId };
