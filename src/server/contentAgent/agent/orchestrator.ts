// 📁 flashmind-ai/src/server/contentAgent/agent/orchestrator.ts
//
// Ponto de entrada único do FlashMind Content Agent. Roda o ciclo completo
// da Seção 37 do briefing:
//
//   RECEBER FEEDBACK → ANALISAR → APRENDER   (jobs/analyzeFeedbackJob)
//     → REVISAR                              (jobs/reviewFlaggedTopicsJob — CardUpdater)
//     → DESCOBRIR → ORGANIZAR                (jobs/discoverTopicsJob → planner)
//     → GERAR → VALIDAR → PUBLICAR           (jobs/generateCardsJob → generateFlashcardsTask)
//     → REGISTRAR                            (agentRuns)
//
// O CardUpdater (Seção 20) remove os cards individuais mais mal avaliados
// de tópicos já flagados pelo Learning Engine; o shortfall que isso cria é
// preenchido no MESMO run pelo passo GERAR logo em seguida — não existe uma
// rota separada de "edição de card", é sempre remover + deixar o pipeline
// normal repor. Não há ainda versionamento completo de histórico (só
// `reviewVersion`/`qualityScore`/`lastReviewedAt` no doc do balde) nem
// rollback. Ver docs/content-agent.md, seção "Roadmap".

import { agentConfig } from '../config/agentConfig';
import { RunTracker, persistRunSummary, AgentRunSummary } from '../monitoring/runLogger';
import { discoverTopicsJob } from '../jobs/discoverTopicsJob';
import { generateCardsJob } from '../jobs/generateCardsJob';
import { analyzeFeedbackJob } from '../jobs/analyzeFeedbackJob';
import { reviewFlaggedTopicsJob } from '../jobs/reviewFlaggedTopicsJob';

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
    tracker.log({ action: '[agent] analisando feedback recente' });
    await analyzeFeedbackJob(tracker);

    tracker.log({ action: '[agent] revisando tópicos sinalizados' });
    await reviewFlaggedTopicsJob(tracker);

    const plan = await discoverTopicsJob(tracker);
    tracker.subjectsProcessed = plan.subjectsProcessed;
    tracker.curriculaCreated = plan.curriculaCreated;

    tracker.log({
      action: '[planner] plano pronto',
      detail: `${plan.needs.length} tópico(s) precisam de conteúdo (${plan.curriculaCreated} currículo(s) novos)`,
    });

    if (plan.needs.length === 0) {
      tracker.log({ action: '[agent] nada a fazer neste ciclo' });
    } else {
      await generateCardsJob(plan, tracker);
    }

    const summary = tracker.toSummary('completed');
    await persistRunSummary(summary);
    tracker.log({
      action: '[agent] execução concluída',
      detail: `${summary.cardsGenerated} cards gerados, ${summary.cardsReviewed} removidos por revisão, ${summary.topicsProcessed} tópicos, ${summary.feedbackAnalyzed} feedbacks analisados, ${summary.adaptationsApplied} adaptações, ${summary.aiCalls} chamadas de IA, ${summary.errors} erro(s)`,
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
