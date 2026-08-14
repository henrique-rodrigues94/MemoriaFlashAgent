// 📁 flashmind-ai/src/server/contentAgent/feedback/learningEngine.ts
//
// Seções 17–19 do briefing: transforma feedback (já filtrado por evidência
// suficiente pelo feedbackAnalyzer) em ajuste de estratégia. Regra de ouro:
// aprendizado GRADUAL — no máximo 1 passo de dificuldade por execução, nunca
// pula direto para o extremo (Seção 18: "nunca permitir que o agente altere
// a estratégia de forma extrema em uma única execução").

import type { EducationLevel, CardContentType } from '../../db/firestoreSchema';
import type { FeedbackAggregate, CardTypeAggregate } from './feedbackAnalyzer';
import {
  loadAdaptations,
  saveAdaptations,
  SubjectAdaptationDoc,
  TopicAdaptation,
} from './adaptationRepository';
import { RunTracker } from '../monitoring/runLogger';
import { DEFAULT_CARD_TYPE_DISTRIBUTION } from '../config/agentConfig';

const MAX_ABS_OFFSET = 2; // trava dura — ver resolveAdaptedDifficulty

function stepFor(reason: string | undefined): number {
  if (reason === 'too_easy') return +1;  // aumenta dificuldade
  if (reason === 'too_hard') return -1;  // reduz dificuldade
  return 0; // outros motivos não mexem em dificuldade, só sinalizam revisão
}

/**
 * Aplica os agregados com evidência suficiente sobre o estado de adaptação
 * já salvo (se houver), persiste o novo estado e retorna quantos tópicos
 * foram efetivamente ajustados nesta execução.
 */
export async function applyLearning(
  subject: string,
  level: EducationLevel,
  aggregates: FeedbackAggregate[],
  tracker: RunTracker,
): Promise<number> {
  const actionable = aggregates.filter(a => a.hasSufficientEvidence);
  if (actionable.length === 0) return 0;

  const existing = await loadAdaptations(subject, level);
  const topics: Record<string, TopicAdaptation> = existing?.topics ? { ...existing.topics } : {};
  let changed = 0;

  for (const agg of actionable) {
    const key = `${agg.topic}::${agg.cardType}`;
    const prev = topics[key];
    const step = stepFor(agg.dominantReason);
    const prevOffset = prev?.difficultyStepOffset ?? 0;
    const nextOffset = Math.max(-MAX_ABS_OFFSET, Math.min(MAX_ABS_OFFSET, prevOffset + step));

    const flaggedForReview = step === 0; // motivo não é dificuldade → precisa de revisão de conteúdo

    topics[key] = {
      topic: agg.topic,
      cardType: agg.cardType as CardContentType,
      difficultyStepOffset: nextOffset,
      flaggedForReview,
      basedOnFeedbackCount: agg.total,
      lastReason: agg.dominantReason,
      updatedAt: new Date().toISOString(),
    };

    if (step !== 0 || flaggedForReview) {
      changed++;
      tracker.log({
        action: '[learning] adaptação aplicada',
        subject,
        topic: agg.topic,
        detail: step !== 0
          ? `dificuldade ${step > 0 ? '+1' : '-1'} (offset final: ${nextOffset}), motivo: ${agg.dominantReason}`
          : `sinalizado para revisão — motivo: ${agg.dominantReason ?? 'desconhecido'} (${Math.round(agg.negativeRate * 100)}% negativo em ${agg.total} avaliações)`,
      });
    }
  }

  const doc: SubjectAdaptationDoc = {
    subject,
    level,
    topics,
    typeDistribution: existing?.typeDistribution,
    updatedAt: new Date().toISOString(),
  };
  await saveAdaptations(doc);

  return changed;
}

const MAX_DISTRIBUTION_STEP = 5; // pontos percentuais por execução — gradual, nunca extremo
const MIN_TYPE_WEIGHT = 5;       // nenhum tipo cai a ponto de sumir da rotação
const MAX_TYPE_WEIGHT = 50;      // nenhum tipo domina sozinho

/**
 * Seção 18: ajusta a distribuição entre tipos de card (`definition`,
 * `quiz`, `gap`...) com base em qual tipo performa melhor/pior — sempre em
 * passos pequenos (`MAX_DISTRIBUTION_STEP` pontos percentuais por run) e
 * nunca deixando um tipo sumir ou dominar completamente.
 *
 * Só ajusta quando há pelo menos 2 tipos com evidência suficiente — sem
 * isso não existe base de comparação (não dá pra dizer que "gap" performa
 * pior que "applied" tendo dados só de um dos dois).
 */
export async function applyTypeDistributionLearning(
  subject: string,
  level: EducationLevel,
  typeAggregates: CardTypeAggregate[],
  tracker: RunTracker,
): Promise<boolean> {
  const withEvidence = typeAggregates.filter(a => a.hasSufficientEvidence);
  if (withEvidence.length < 2) return false;

  const existing = await loadAdaptations(subject, level);
  const current: Partial<Record<CardContentType, number>> =
    existing?.typeDistribution ?? { ...DEFAULT_CARD_TYPE_DISTRIBUTION };

  const avgNegativeRate =
    withEvidence.reduce((sum, a) => sum + a.negativeRate, 0) / withEvidence.length;

  const next: Partial<Record<CardContentType, number>> = { ...current };
  for (const agg of withEvidence) {
    const type = agg.cardType as CardContentType;
    const base = current[type] ?? DEFAULT_CARD_TYPE_DISTRIBUTION[type] ?? 0;
    // Performa melhor que a média (negativeRate menor) → delta positivo (ganha peso)
    const rawDelta = (avgNegativeRate - agg.negativeRate) * 20; // escala: 0.05 de diferença ≈ 1pp
    const delta = Math.max(-MAX_DISTRIBUTION_STEP, Math.min(MAX_DISTRIBUTION_STEP, rawDelta));
    next[type] = Math.max(MIN_TYPE_WEIGHT, Math.min(MAX_TYPE_WEIGHT, base + delta));
  }

  // Renormaliza para somar 100 sem distorcer as proporções relativas.
  const total = Object.values(next).reduce((s, v) => s + (v ?? 0), 0);
  if (total > 0) {
    for (const key of Object.keys(next) as CardContentType[]) {
      next[key] = Math.round(((next[key] ?? 0) / total) * 100 * 10) / 10; // 1 casa decimal
    }
  }

  await saveAdaptations({
    subject,
    level,
    topics: existing?.topics ?? {},
    typeDistribution: next,
    updatedAt: new Date().toISOString(),
  });

  tracker.log({
    action: '[learning] distribuição de tipos ajustada',
    subject,
    detail: withEvidence.map(a => `${a.cardType}: ${Math.round(a.negativeRate * 100)}% negativo`).join(', '),
  });

  return true;
}
