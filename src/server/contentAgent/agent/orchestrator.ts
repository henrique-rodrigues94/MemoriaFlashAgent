// Ponto de entrada único do FlashMind Content Agent.
//
// Ciclo:
// PEDIDOS DOS USUÁRIOS → FEEDBACK → REVISÃO → DESCOBRIR/ORGANIZAR →
// GERAR/VALIDAR/PUBLICAR → REGISTRAR.

import { agentConfig } from '../config/agentConfig';
import { RunTracker, persistRunSummary, AgentRunSummary } from '../monitoring/runLogger';
import { discoverTopicsJob } from '../jobs/discoverTopicsJob';
import { generateCardsJob } from '../jobs/generateCardsJob';
import { analyzeFeedbackJob } from '../jobs/analyzeFeedbackJob';
import { reviewFlaggedTopicsJob } from '../jobs/reviewFlaggedTopicsJob';
import { processContentRequestsJob } from '../requests/contentRequestJob';

export async function runContentAgent(): Promise<AgentRunSummary> {
  if (!agentConfig.enabled) {
    const tracker = new RunTracker();
    tracker.stoppedReason = 'Agente desativado via CONTENT_AGENT_ENABLED=false';
    const summary = tracker.toSummary('aborted');
    console.warn('[agent] Execução abortada — agente desativado.');
    return summary;
  }

  const tracker = new RunTracker();
  tracker.log({ action: '[agent] iniciando execução', detail: tracker.runId });

  try {
    // Pedido explícito de usuário tem prioridade sobre manutenção automática.
    tracker.log({ action: '[agent] processando pedidos de novas matérias/assuntos' });
    await processContentRequestsJob(tracker);

    tracker.log({ action: '[agent] analisando feedback recente' });
    await analyzeFeedbackJob(tracker);

    tracker.log({ action: '[agent] revisando tópicos sinalizados' });
    await reviewFlaggedTopicsJob(tracker);

    const plan = await discoverTopicsJob(tracker);
    tracker.subjectsProcessed = plan.subjectsProcessed;
    tracker.curriculaCreated = plan.curriculaCreated;

    tracker.log({
      action: '[planner] plano pronto',
      detail: `${plan.needs.length} folha(s) precisam de conteúdo (${plan.curriculaCreated} currículo(s) novos)`,
    });

    if (plan.needs.length === 0) {
      tracker.log({ action: '[agent] nada a fazer neste ciclo automático' });
    } else {
      await generateCardsJob(plan, tracker);
    }

    const summary = tracker.toSummary('completed');
    await persistRunSummary(summary);
    tracker.log({
      action: '[agent] execução concluída',
      detail: `${summary.cardsGenerated} cards gerados, ${summary.cardsReviewed} removidos, ${summary.topicsProcessed} folhas, ${summary.feedbackAnalyzed} feedbacks, ${summary.adaptationsApplied} adaptações, ${summary.aiCalls} chamadas de IA, ${summary.errors} erro(s)`,
    });
    return summary;
  } catch (err: any) {
    tracker.errors++;
    tracker.log({ action: '[agent] falha não tratada', detail: err?.message || String(err) });
    const summary = tracker.toSummary('failed');
    await persistRunSummary(summary);
    return summary;
  }
}
