// 📁 flashmind-ai/src/server/contentAgent/monitoring/runLogger.ts
//
// Registra cada execução do Content Agent em agentRuns/{runId}. Coleção nova
// (não existia antes) — escrita exclusiva do backend, leitura negada ao
// cliente por padrão (não está nas regras públicas do firestore.rules).

import { getAdminFirestore } from '../../firebaseAdmin';

export interface AgentRunLogEntry {
  action: string;
  subject?: string;
  topic?: string;
  level?: string;
  detail?: string;
}

export interface AgentRunSummary {
  runId: string;
  startedAt: string;
  finishedAt: string;
  durationMs: number;
  status: 'completed' | 'aborted' | 'failed';
  cardsGenerated: number;
  cardsRejected: number;
  topicsProcessed: number;
  subjectsProcessed: number;
  curriculaCreated: number;
  aiCalls: number;
  errors: number;
  feedbackAnalyzed: number;
  adaptationsApplied: number;
  cardsReviewed: number;
  stoppedReason?: string;
  logs: AgentRunLogEntry[];
}

/** Acumulador em memória de uma execução — repassado entre jobs. */
export class RunTracker {
  readonly runId: string;
  readonly startedAt = Date.now();
  cardsGenerated = 0;
  cardsRejected = 0;
  topicsProcessed = 0;
  subjectsProcessed = 0;
  curriculaCreated = 0;
  aiCalls = 0;
  errors = 0;
  feedbackAnalyzed = 0;
  adaptationsApplied = 0;
  cardsReviewed = 0;
  stoppedReason?: string;
  private logs: AgentRunLogEntry[] = [];

  constructor() {
    this.runId = `run_${new Date(this.startedAt).toISOString().replace(/[:.]/g, '-')}`;
  }

  log(entry: AgentRunLogEntry) {
    this.logs.push(entry);
    const parts = [entry.subject, entry.topic].filter(Boolean).join(' / ');
    console.info(`[agent] ${entry.action}${parts ? ` (${parts})` : ''}${entry.detail ? ` — ${entry.detail}` : ''}`);
  }

  elapsedMinutes(): number {
    return (Date.now() - this.startedAt) / 60000;
  }

  toSummary(status: AgentRunSummary['status']): AgentRunSummary {
    const finishedAt = Date.now();
    return {
      runId: this.runId,
      startedAt: new Date(this.startedAt).toISOString(),
      finishedAt: new Date(finishedAt).toISOString(),
      durationMs: finishedAt - this.startedAt,
      status,
      cardsGenerated: this.cardsGenerated,
      cardsRejected: this.cardsRejected,
      topicsProcessed: this.topicsProcessed,
      subjectsProcessed: this.subjectsProcessed,
      curriculaCreated: this.curriculaCreated,
      aiCalls: this.aiCalls,
      errors: this.errors,
      feedbackAnalyzed: this.feedbackAnalyzed,
      adaptationsApplied: this.adaptationsApplied,
      cardsReviewed: this.cardsReviewed,
      stoppedReason: this.stoppedReason,
      logs: this.logs.slice(-200), // evita doc gigante; log completo já foi pro console/stdout
    };
  }
}

export async function persistRunSummary(summary: AgentRunSummary): Promise<void> {
  const db = getAdminFirestore();
  if (!db) {
    console.warn('[agentRuns] Firebase Admin não configurado — resumo da execução não foi persistido.');
    return;
  }
  try {
    await db.collection('agentRuns').doc(summary.runId).set(summary);
  } catch (err: any) {
    console.error('[agentRuns] Falha ao salvar resumo da execução:', err?.message || err);
  }
}
