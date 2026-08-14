// 📁 flashmind-ai/src/server/contentAgent/jobs/analyzeFeedbackJob.ts
//
// Roda ANTES da geração (Seção 37: ...RECEBER FEEDBACK → ANALISAR →
// APRENDER → REVISAR → MELHORAR → GERAR NOVAMENTE). Barato — só leituras —
// então roda em toda execução, mesmo que não haja feedback novo (aggregates
// vazios são um no-op rápido).

import { agentConfig } from '../config/agentConfig';
import { queryFeedback } from '../feedback/feedbackRepository';
import { aggregateFeedback, aggregateFeedbackByType } from '../feedback/feedbackAnalyzer';
import { applyLearning, applyTypeDistributionLearning } from '../feedback/learningEngine';
import { RunTracker } from '../monitoring/runLogger';

export async function analyzeFeedbackJob(tracker: RunTracker): Promise<void> {
  for (const managed of agentConfig.managedSubjects) {
    if (tracker.elapsedMinutes() >= agentConfig.limits.maxRuntimeMinutes) {
      tracker.stoppedReason = tracker.stoppedReason || 'maxRuntimeMinutes atingido durante análise de feedback';
      return;
    }

    for (const level of managed.levels) {
      try {
        const feedback = await queryFeedback({ subject: managed.subject, level });
        if (feedback.length === 0) continue;

        const aggregates = aggregateFeedback(managed.subject, level, feedback);
        const changed = await applyLearning(managed.subject, level, aggregates, tracker);

        const typeAggregates = aggregateFeedbackByType(feedback);
        const distributionChanged = await applyTypeDistributionLearning(managed.subject, level, typeAggregates, tracker);

        tracker.feedbackAnalyzed += feedback.length;
        tracker.adaptationsApplied += changed + (distributionChanged ? 1 : 0);

        tracker.log({
          action: '[feedback] análise concluída',
          subject: managed.subject,
          detail: `${level}: ${feedback.length} avaliações, ${aggregates.length} tópico(s)/tipo(s), ${changed} adaptação(ões) de dificuldade${distributionChanged ? ', distribuição de tipos ajustada' : ''}`,
        });
      } catch (err: any) {
        tracker.errors++;
        tracker.log({
          action: '[feedback] falha ao analisar',
          subject: managed.subject,
          detail: err?.message || String(err),
        });
      }
    }
  }
}
