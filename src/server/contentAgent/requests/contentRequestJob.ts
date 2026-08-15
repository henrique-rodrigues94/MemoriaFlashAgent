import { getAdminFirestore } from '../../firebaseAdmin';
import { identifySubjectLevelsTask } from '../../ai/tasks/identifySubjectLevels';
import { generateCurriculumTask } from '../../ai/tasks/generateCurriculum';
import { analyzeSubjectLevel, TopicNeed } from '../curriculum/topicAnalyzer';
import { generateForTopicNeed } from '../cards/cardGenerator';
import { agentConfig } from '../config/agentConfig';
import { RunTracker } from '../monitoring/runLogger';
import type { EducationLevel } from '../../db/firestoreSchema';

export type ContentRequestStatus = 'pending' | 'processing' | 'completed' | 'failed';

export interface ContentRequestDoc {
  subject: string;
  educationLevel?: EducationLevel;
  status: ContentRequestStatus;
  requestedAt: string;
  updatedAt: string;
  requestedBy?: string;
  error?: string;
  progress?: {
    levels: number;
    curriculaReady: number;
    leavesDiscovered: number;
    cardsGenerated: number;
  };
}

/**
 * Processa pedidos originados no app.
 * Contrato para o backend do FlashMind: criar contentRequests/{id} com
 * { subject, educationLevel?, status:'pending', requestedAt, updatedAt }.
 * Nenhum dado pessoal é necessário para o agente.
 */
export async function processContentRequestsJob(tracker: RunTracker): Promise<void> {
  const db = getAdminFirestore();
  if (!db) return;

  const maxRequests = agentConfig.limits.maxContentRequestsPerRun;
  const snap = await db.collection('contentRequests')
    .where('status', '==', 'pending')
    .orderBy('requestedAt', 'asc')
    .limit(maxRequests)
    .get();

  for (const request of snap.docs) {
    if (tracker.elapsedMinutes() >= agentConfig.limits.maxRuntimeMinutes) {
      tracker.stoppedReason = tracker.stoppedReason || 'maxRuntimeMinutes atingido durante pedidos de usuários';
      break;
    }
    if (tracker.aiCalls >= agentConfig.limits.maxAiCallsPerRun) {
      tracker.stoppedReason = tracker.stoppedReason || 'maxAiCallsPerRun atingido durante pedidos de usuários';
      break;
    }

    const data = request.data() as ContentRequestDoc;
    const subject = typeof data.subject === 'string' ? data.subject.trim() : '';
    if (!subject) {
      await request.ref.set({ status: 'failed', updatedAt: new Date().toISOString(), error: 'subject vazio' }, { merge: true });
      continue;
    }

    await request.ref.set({ status: 'processing', updatedAt: new Date().toISOString() }, { merge: true });
    tracker.log({ action: '[request] processando matéria/assunto solicitado', subject, detail: request.id });

    try {
      const levelResult = data.educationLevel
        ? { levels: [{ level: data.educationLevel }] }
        : await identifySubjectLevelsTask(subject);
      if (!data.educationLevel) tracker.aiCalls++;

      const levels = levelResult.levels
        .map((item: any) => item.level as EducationLevel)
        .filter(Boolean)
        .slice(0, 5);

      let curriculaReady = 0;
      let leavesDiscovered = 0;
      let cardsGenerated = 0;

      for (const level of levels) {
        if (tracker.elapsedMinutes() >= agentConfig.limits.maxRuntimeMinutes) break;
        if (tracker.aiCalls >= agentConfig.limits.maxAiCallsPerRun) break;

        const curriculum = await generateCurriculumTask({
          subject,
          educationLevel: level,
          language: agentConfig.defaultLanguage,
        });
        if (!curriculum.cacheHit) tracker.aiCalls++;
        curriculaReady++;

        const needs = await analyzeSubjectLevel(subject, level);
        leavesDiscovered += needs.length;

        // O mesmo planner/limite de IA usado no ciclo normal evita que um
        // pedido de usuário consuma a cota inteira de uma vez.
        for (const need of needs.slice(0, agentConfig.limits.maxRequestTopicsPerRun)) {
          if (tracker.aiCalls >= agentConfig.limits.maxAiCallsPerRun) break;
          if (tracker.cardsGenerated >= agentConfig.limits.maxCardsPerRun) break;
          const outcome = await generateForTopicNeed(need, tracker);
          cardsGenerated += outcome.cardsGenerated;
          tracker.topicsProcessed++;
          if (outcome.stoppedByLimits) break;
        }
      }

      const complete = levels.length > 0 && curriculaReady === levels.length;
      const progress = {
        levels: levels.length,
        curriculaReady,
        leavesDiscovered,
        cardsGenerated,
      };

      await request.ref.set({
        status: complete ? 'completed' : 'processing',
        updatedAt: new Date().toISOString(),
        progress,
      }, { merge: true });

      tracker.log({
        action: complete ? '[request] conteúdo disponibilizado' : '[request] conteúdo em processamento',
        subject,
        detail: `${curriculaReady} grade(s), ${leavesDiscovered} folhas, +${cardsGenerated} cards`,
      });
    } catch (err: any) {
      tracker.errors++;
      await request.ref.set({
        status: 'failed',
        updatedAt: new Date().toISOString(),
        error: String(err?.message || err).slice(0, 500),
      }, { merge: true });
      tracker.log({ action: '[request] falha ao processar matéria', subject, detail: err?.message || String(err) });
    }
  }
}
