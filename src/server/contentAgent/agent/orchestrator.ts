// Ponto de entrada único do FlashMind Content Agent.
// Execução protegida por lease distribuído no Firestore para impedir que
// dois workers/schedulers processem o banco simultaneamente.

import { agentConfig } from '../config/agentConfig';
import { getAdminFirestore } from '../../firebaseAdmin';
import { RunTracker, persistRunSummary, AgentRunSummary } from '../monitoring/runLogger';
import { discoverTopicsJob } from '../jobs/discoverTopicsJob';
import { generateCardsJob } from '../jobs/generateCardsJob';
import { analyzeFeedbackJob } from '../jobs/analyzeFeedbackJob';
import { reviewFlaggedTopicsJob } from '../jobs/reviewFlaggedTopicsJob';
import { processContentRequestsJob } from '../requests/contentRequestJob';

const LOCK_ID = 'global';
const LOCK_COLLECTION = 'agentLocks';
const LOCK_TTL_MS = 35 * 60 * 1000;

async function acquireAgentLease(runId: string): Promise<boolean> {
  const db = getAdminFirestore();
  if (!db) {
    if (process.env.CONTENT_AGENT_PRODUCTION_STRICT === 'true') {
      throw new Error('Firebase Admin é obrigatório em produção; não foi possível adquirir o lease do Agent.');
    }
    return true;
  }
  const ref = db.collection(LOCK_COLLECTION).doc(LOCK_ID);
  const now = Date.now();
  return db.runTransaction(async transaction => {
    const snap = await transaction.get(ref);
    const current = snap.exists ? snap.data() || {} : {};
    const currentExpiry = Number(current.expiresAt || 0);
    const currentRunId = String(current.runId || '');
    if (currentRunId && currentExpiry > now && currentRunId !== runId) return false;
    transaction.set(ref, { runId, status: 'running', acquiredAt: new Date(now).toISOString(), heartbeatAt: new Date(now).toISOString(), expiresAt: now + LOCK_TTL_MS }, { merge: true });
    return true;
  });
}

async function releaseAgentLease(runId: string): Promise<void> {
  const db = getAdminFirestore();
  if (!db) return;
  const ref = db.collection(LOCK_COLLECTION).doc(LOCK_ID);
  await db.runTransaction(async transaction => {
    const snap = await transaction.get(ref);
    if (snap.exists && String(snap.data()?.runId || '') === runId) {
      transaction.set(ref, { status: 'idle', releasedAt: new Date().toISOString(), expiresAt: Date.now() }, { merge: true });
    }
  });
}

export async function runContentAgent(): Promise<AgentRunSummary> {
  if (!agentConfig.enabled) {
    const tracker = new RunTracker();
    tracker.stoppedReason = 'Agente desativado via CONTENT_AGENT_ENABLED=false';
    return tracker.toSummary('aborted');
  }

  const tracker = new RunTracker();
  const acquired = await acquireAgentLease(tracker.runId);
  if (!acquired) {
    tracker.stoppedReason = 'Outro worker possui o lease global do Agent.';
    return tracker.toSummary('aborted');
  }

  tracker.log({ action: '[agent] iniciando execução', detail: tracker.runId });
  try {
    tracker.log({ action: '[agent] processando pedidos de novas matérias/assuntos' });
    await processContentRequestsJob(tracker);
    tracker.log({ action: '[agent] analisando feedback recente' });
    await analyzeFeedbackJob(tracker);
    tracker.log({ action: '[agent] revisando tópicos sinalizados' });
    await reviewFlaggedTopicsJob(tracker);

    const plan = await discoverTopicsJob(tracker);
    tracker.subjectsProcessed = plan.subjectsProcessed;
    tracker.curriculaCreated = plan.curriculaCreated;
    tracker.log({ action: '[planner] plano pronto', detail: `${plan.needs.length} folha(s) precisam de conteúdo (${plan.curriculaCreated} currículo(s) novos)` });

    if (plan.needs.length === 0) tracker.log({ action: '[agent] nada a fazer neste ciclo automático' });
    else await generateCardsJob(plan, tracker);

    const summary = tracker.toSummary('completed');
    await persistRunSummary(summary);
    tracker.log({ action: '[agent] execução concluída', detail: `${summary.cardsGenerated} cards gerados, ${summary.cardsReviewed} removidos, ${summary.topicsProcessed} folhas, ${summary.feedbackAnalyzed} feedbacks, ${summary.adaptationsApplied} adaptações, ${summary.aiCalls} chamadas de IA, ${summary.errors} erro(s)` });
    return summary;
  } catch (err: any) {
    tracker.errors++;
    tracker.log({ action: '[agent] falha não tratada', detail: err?.message || String(err) });
    const summary = tracker.toSummary('failed');
    await persistRunSummary(summary);
    return summary;
  } finally {
    try { await releaseAgentLease(tracker.runId); }
    catch (err: any) { console.error('[agent] Falha ao liberar lease:', err?.message || err); }
  }
}
