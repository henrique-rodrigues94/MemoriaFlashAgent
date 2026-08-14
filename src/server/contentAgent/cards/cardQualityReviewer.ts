// 📁 flashmind-ai/src/server/contentAgent/cards/cardQualityReviewer.ts
//
// Seção 20 do briefing (CardUpdater), com um desenho deliberadamente
// simples: em vez de pedir pra IA "revisar e substituir" um card (uma nova
// task inteira, mais uma superfície de erro), o CardUpdater REMOVE os
// piores cards de um tópico flagado e deixa o ciclo normal
// (topicAnalyzer → cardGenerator, que já rodam logo depois no orchestrator)
// preencher o shortfall criado — reaproveitando 100% da validação/dedup
// que já existe em vez de duplicá-la numa rota de "edição" separada.
//
// Só entra em ação em tópicos com `flaggedForReview` no Learning Engine —
// nunca examina o banco inteiro a cada execução (custo controlado).

import { agentConfig } from '../config/agentConfig';
import { loadAdaptations, clearReviewFlag } from '../feedback/adaptationRepository';
import { queryFeedback } from '../feedback/feedbackRepository';
import { aggregateFeedbackByCard } from '../feedback/feedbackAnalyzer';
import { loadBucket, removeCardsFromBucket } from './cardBucketRepository';
import { RunTracker } from '../monitoring/runLogger';
import type { EducationLevel, CardContentType } from '../../db/firestoreSchema';

export interface ReviewOutcome {
  topicsReviewed: number;
  cardsRemoved: number;
}

/**
 * Revisa todos os tópicos flagados para review de uma matéria+nível.
 * Para cada um: busca o feedback do tópico, agrega por card individual,
 * seleciona os cards que cruzam `cardReviewThresholds` (evidência própria,
 * não herdada do agregado do tópico), remove até
 * `limits.maxCardsReviewedPerTopic` deles e limpa o flag.
 */
export async function reviewFlaggedTopics(
  subject: string,
  level: EducationLevel,
  tracker: RunTracker,
): Promise<ReviewOutcome> {
  const adaptations = await loadAdaptations(subject, level);
  if (!adaptations) return { topicsReviewed: 0, cardsRemoved: 0 };

  const flagged = Object.values(adaptations.topics).filter(t => t.flaggedForReview);
  if (flagged.length === 0) return { topicsReviewed: 0, cardsRemoved: 0 };

  const { minFeedbackCount, minNegativeRate } = agentConfig.cardReviewThresholds;
  const { maxCardsReviewedPerTopic } = agentConfig.limits;

  let topicsReviewed = 0;
  let cardsRemoved = 0;

  for (const flag of flagged) {
    if (tracker.elapsedMinutes() >= agentConfig.limits.maxRuntimeMinutes) {
      tracker.stoppedReason = tracker.stoppedReason || 'maxRuntimeMinutes atingido durante revisão de qualidade';
      break;
    }

    try {
      const feedback = await queryFeedback({
        subject, level, topic: flag.topic, cardType: flag.cardType as CardContentType,
      });
      const perCard = aggregateFeedbackByCard(feedback)
        .filter(c => c.total >= minFeedbackCount && c.negativeRate >= minNegativeRate)
        .slice(0, maxCardsReviewedPerTopic);

      if (perCard.length === 0) {
        // Tópico foi flagado pelo agregado, mas nenhum card individual tem
        // evidência própria suficiente ainda — não remove nada às cegas;
        // mantém o flag para reavaliar quando houver mais feedback por card.
        continue;
      }

      const bucket = await loadBucket(subject, flag.topic, level, flag.cardType as CardContentType);
      if (!bucket) continue;

      const topicAvgNegativeRate =
        perCard.reduce((sum, c) => sum + c.negativeRate, 0) / perCard.length;
      const qualityScore = Math.max(0, 1 - topicAvgNegativeRate);

      const result = await removeCardsFromBucket(
        subject, flag.topic, level, flag.cardType as CardContentType,
        perCard.map(c => c.cardId),
        qualityScore,
      );

      if (result && result.removed > 0) {
        cardsRemoved += result.removed;
        topicsReviewed++;
        tracker.log({
          action: '[cards] revisão removeu cards de baixa qualidade',
          subject,
          topic: flag.topic,
          detail: `${result.removed} card(s) removido(s) de ${flag.cardType} (qualityScore: ${qualityScore.toFixed(2)}) — shortfall será preenchido no ciclo normal de geração`,
        });
      }

      // Reseta o flag independentemente de ter removido algo ou não — se
      // não havia evidência por card ainda, um novo flag só volta quando
      // feedback NOVO cruzar os limiares de tópico de novo.
      await clearReviewFlag(subject, level, flag.topic, flag.cardType as CardContentType);
    } catch (err: any) {
      tracker.errors++;
      tracker.log({
        action: '[cards] falha na revisão de qualidade',
        subject,
        topic: flag.topic,
        detail: err?.message || String(err),
      });
    }
  }

  return { topicsReviewed, cardsRemoved };
}
