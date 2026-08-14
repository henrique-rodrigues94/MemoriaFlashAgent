// 📁 flashmind-ai/src/server/contentAgent/monitoring/dashboardQueries.ts
//
// Leituras agregadas SÓ PARA o dashboard administrativo (Seção 33) — nunca
// chamadas pelo próprio agente. Diferente da execução do agente (que roda
// como serviço separado, ver docs/content-agent-deployment.md), essas
// consultas são leves e ficam expostas via endpoint admin-protegido no
// server.ts do app — o app é o que está sempre no ar para um humano
// consultar, a execução pesada continua isolada.

import { getAdminFirestore } from '../../firebaseAdmin';
import type { AgentRunSummary } from './runLogger';
import type { SubjectAdaptationDoc } from '../feedback/adaptationRepository';

export interface DashboardOverview {
  recentRuns: number;
  cardsGeneratedRecent: number;
  cardsReviewedRecent: number;
  feedbackAnalyzedRecent: number;
  adaptationsAppliedRecent: number;
  errorsRecent: number;
  lastRunAt?: string;
  lastRunStatus?: AgentRunSummary['status'];
}

export interface CriticalTopic {
  subject: string;
  level: string;
  topic: string;
  cardType: string;
  reason?: string;
  basedOnFeedbackCount: number;
}

/** Últimas N execuções (mais recente primeiro). */
export async function getRecentRuns(limit = 20): Promise<AgentRunSummary[]> {
  const db = getAdminFirestore();
  if (!db) return [];
  const snap = await db.collection('agentRuns')
    .orderBy('startedAt', 'desc')
    .limit(limit)
    .get();
  return snap.docs.map(d => d.data() as AgentRunSummary);
}

/** Agrega as últimas N execuções num resumo único para o topo do dashboard. */
export async function getOverview(limit = 20): Promise<DashboardOverview> {
  const runs = await getRecentRuns(limit);
  const overview: DashboardOverview = {
    recentRuns: runs.length,
    cardsGeneratedRecent: 0,
    cardsReviewedRecent: 0,
    feedbackAnalyzedRecent: 0,
    adaptationsAppliedRecent: 0,
    errorsRecent: 0,
  };

  for (const run of runs) {
    overview.cardsGeneratedRecent += run.cardsGenerated ?? 0;
    overview.cardsReviewedRecent += run.cardsReviewed ?? 0;
    overview.feedbackAnalyzedRecent += run.feedbackAnalyzed ?? 0;
    overview.adaptationsAppliedRecent += run.adaptationsApplied ?? 0;
    overview.errorsRecent += run.errors ?? 0;
  }
  if (runs.length > 0) {
    overview.lastRunAt = runs[0].startedAt;
    overview.lastRunStatus = runs[0].status;
  }
  return overview;
}

/**
 * Todos os tópicos atualmente `flaggedForReview` em qualquer matéria/nível
 * — a lista "🔴 conteúdos críticos" do mockup da Seção 33. Varre a coleção
 * inteira de `contentAdaptations`, mas ela tem no máximo 1 doc por
 * matéria+nível gerenciada (dezenas, não milhares) — leitura barata.
 */
export async function getCriticalTopics(): Promise<CriticalTopic[]> {
  const db = getAdminFirestore();
  if (!db) return [];
  const snap = await db.collection('contentAdaptations').get();

  const critical: CriticalTopic[] = [];
  for (const doc of snap.docs) {
    const data = doc.data() as SubjectAdaptationDoc;
    for (const adaptation of Object.values(data.topics || {})) {
      if (adaptation.flaggedForReview) {
        critical.push({
          subject: data.subject,
          level: data.level,
          topic: adaptation.topic,
          cardType: adaptation.cardType,
          reason: adaptation.lastReason,
          basedOnFeedbackCount: adaptation.basedOnFeedbackCount,
        });
      }
    }
  }
  return critical.sort((a, b) => b.basedOnFeedbackCount - a.basedOnFeedbackCount);
}
