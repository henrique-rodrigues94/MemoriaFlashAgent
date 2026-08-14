// 📁 flashmind-ai/src/server/contentAgent/feedback/feedbackAnalyzer.ts
//
// Seções 15–16 do briefing: agrega feedback e SÓ sinaliza um problema
// quando há evidência suficiente (thresholds configuráveis) — uma única
// avaliação negativa nunca altera nada sozinha.

import type { CardFeedbackDoc, FeedbackReason } from '../../db/firestoreSchema';
import { agentConfig } from '../config/agentConfig';

export interface FeedbackAggregate {
  subject: string;
  level: string;
  topic: string;
  cardType: string;
  total: number;
  positive: number;
  negative: number;
  negativeRate: number;
  reasonCounts: Partial<Record<FeedbackReason, number>>;
  /** true somente quando total/negative/rate ultrapassam os limiares
   *  configurados — é o sinal que o Learning Engine pode agir sobre. */
  hasSufficientEvidence: boolean;
  dominantReason?: FeedbackReason;
}

export interface CardFeedbackAggregate {
  cardId: string;
  total: number;
  negative: number;
  negativeRate: number;
  dominantReason?: FeedbackReason;
}

/** Agrega feedback POR CARD individual (não por tópico) — usado pelo
 *  CardUpdater para decidir quais cards específicos remover de um balde
 *  já sinalizado para revisão. Limiares separados de
 *  `agentConfig.cardReviewThresholds`, tipicamente mais baixos que os de
 *  tópico porque um único card recebe muito menos avaliações. */
export function aggregateFeedbackByCard(feedback: CardFeedbackDoc[]): CardFeedbackAggregate[] {
  const groups = new Map<string, CardFeedbackDoc[]>();
  for (const f of feedback) {
    if (!groups.has(f.cardId)) groups.set(f.cardId, []);
    groups.get(f.cardId)!.push(f);
  }

  const results: CardFeedbackAggregate[] = [];
  for (const [cardId, items] of groups) {
    const total = items.length;
    const negative = items.filter(i => i.rating === 'negative').length;
    const negativeRate = total > 0 ? negative / total : 0;

    const reasonCounts = new Map<FeedbackReason, number>();
    for (const item of items) {
      if (item.rating === 'negative' && item.reason) {
        reasonCounts.set(item.reason, (reasonCounts.get(item.reason) ?? 0) + 1);
      }
    }
    const dominantReason = [...reasonCounts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];

    results.push({ cardId, total, negative, negativeRate, dominantReason });
  }

  return results.sort((a, b) => b.negativeRate - a.negativeRate);
}

/** Agrupa feedback bruto por (topic, cardType) e calcula as métricas. */
export function aggregateFeedback(
  subject: string,
  level: string,
  feedback: CardFeedbackDoc[],
): FeedbackAggregate[] {
  const groups = new Map<string, CardFeedbackDoc[]>();

  for (const f of feedback) {
    const key = `${f.topic}::${f.cardType}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(f);
  }

  const { minFeedbackCount, minNegativeCount, minNegativeRate } = agentConfig.feedbackThresholds;

  const aggregates: FeedbackAggregate[] = [];
  for (const [key, items] of groups) {
    const [topic, cardType] = key.split('::');
    const total = items.length;
    const negative = items.filter(i => i.rating === 'negative').length;
    const positive = total - negative;
    const negativeRate = total > 0 ? negative / total : 0;

    const reasonCounts: Partial<Record<FeedbackReason, number>> = {};
    for (const item of items) {
      if (item.rating === 'negative' && item.reason) {
        reasonCounts[item.reason] = (reasonCounts[item.reason] ?? 0) + 1;
      }
    }
    const dominantReason = (Object.entries(reasonCounts) as [FeedbackReason, number][])
      .sort((a, b) => b[1] - a[1])[0]?.[0];

    const hasSufficientEvidence =
      total >= minFeedbackCount &&
      negative >= minNegativeCount &&
      negativeRate >= minNegativeRate;

    aggregates.push({
      subject, level, topic, cardType,
      total, positive, negative, negativeRate,
      reasonCounts, hasSufficientEvidence, dominantReason,
    });
  }

  return aggregates.sort((a, b) => b.negativeRate - a.negativeRate);
}

export interface CardTypeAggregate {
  cardType: string;
  total: number;
  negative: number;
  negativeRate: number;
  hasSufficientEvidence: boolean;
}

/**
 * Agrega feedback POR TIPO DE CARD, cruzando todos os tópicos de uma
 * matéria+nível — é o sinal global usado pelo Learning Engine para ajustar
 * a distribuição entre `definition`/`quiz`/`gap`/etc. (Seção 18). Diferente
 * de `aggregateFeedback`, que separa por tópico — aqui queremos saber "os
 * cards do tipo `gap` performam pior que `applied` NESTA MATÉRIA como um
 * todo", não por tópico individual.
 */
export function aggregateFeedbackByType(feedback: CardFeedbackDoc[]): CardTypeAggregate[] {
  const groups = new Map<string, CardFeedbackDoc[]>();
  for (const f of feedback) {
    if (!groups.has(f.cardType)) groups.set(f.cardType, []);
    groups.get(f.cardType)!.push(f);
  }

  const { minFeedbackCount } = agentConfig.feedbackThresholds;

  const results: CardTypeAggregate[] = [];
  for (const [cardType, items] of groups) {
    const total = items.length;
    const negative = items.filter(i => i.rating === 'negative').length;
    const negativeRate = total > 0 ? negative / total : 0;
    // Só o limiar de volume importa aqui — "avaliações negativas mínimas"
    // (pensado para um tópico específico) faz menos sentido agregando o
    // tipo de card inteiro, que naturalmente já acumula muito mais dados.
    const hasSufficientEvidence = total >= minFeedbackCount;
    results.push({ cardType, total, negative, negativeRate, hasSufficientEvidence });
  }

  return results.sort((a, b) => a.negativeRate - b.negativeRate);
}
