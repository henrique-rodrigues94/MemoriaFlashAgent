import { getAdminFirestore } from '../../firebaseAdmin';
import { identifySubjectLevelsTask } from '../../ai/tasks/identifySubjectLevels';
import { generateCurriculumTask } from '../../ai/tasks/generateCurriculum';
import { analyzeSubjectLevel } from '../curriculum/topicAnalyzer';
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
 * Contrato: criar contentRequests/{id} com
 * { subject, educationLevel?, status:'pending', requestedAt, updatedAt }.
 */
export async function processContentRequestsJob(tracker: RunTracker): Promise<void> {
  const db = getAdminFirestore();
  if (!db) return;

  // Não usamos orderBy para não exigir índice composto. Ordenamos em memória
  // depois de buscar apenas a pequena quantidade de pedidos do ciclo.
  const snap = await db.collection('contentRequests')
    .where('status', '==', 'pending')
    .limit(agentConfig.limits.maxContentRequestsPerRun)
    .get();

  const requests = [...snap.docs].sort((a, b) => {
    const at = String((a.data() as ContentRequestDoc).requestedAt || '');
    const bt = String((b.data() as ContentRequestDoc).requestedAt || '');
    return at.localeCompare(bt);
  });

  for (const request of requests) {
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
      if (levels.length === 0) throw new Error('Não foi possível identificar o nível educacional do assunto.');

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

        for (const need of needs.slice(0, agentConfig.limits.maxRequestTopicsPerRun)) {
          if (tracker.aiCalls >= agentConfig.limits.maxAiCallsPerRun) break;
          if (tracker.cardsGenerated >= agentConfig.limits.maxCardsPerRun) break;
          const outcome = await generateForTopicNeed(need, tracker);
          cardsGenerated += outcome.cardsGenerated;
          tracker.topicsProcessed++;
          if (outcome.stoppedByLimits) break;
        }
      }

      let remainingNeeds = 0;
      for (const level of levels) {
        remainingNeeds += (await analyzeSubjectLevel(subject, level)).length;
      }

      const complete = curriculaReady === levels.length && remainingNeeds === 0;
      const progress = { levels: levels.length, curriculaReady, leavesDiscovered, cardsGenerated };

      await request.ref.set({
        status: complete ? 'completed' : 'processing',
        updatedAt: new Date().toISOString(),
        progress,
      }, { merge: true });

      tracker.log({
        action: complete ? '[request] conteúdo disponibilizado' : '[request] conteúdo em processamento',
        subject,
        detail: `${curriculaReady} grade(s), ${leavesDiscovered} folhas analisadas, +${cardsGenerated} cards, ${remainingNeeds} necessidades restantes`,
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
