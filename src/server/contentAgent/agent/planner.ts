// DESCOBRIR + ORGANIZAR do ciclo do agente.
// Currículos antigos sem subtópicos são enriquecidos automaticamente antes
// de o planner distribuir geração de cards pelas folhas da grade.

import { identifySubjectLevelsTask } from '../../ai/tasks/identifySubjectLevels';
import { generateCurriculumTask } from '../../ai/tasks/generateCurriculum';
import { getSubjectLevels, getCurriculum } from '../../db/db';
import type { EducationLevel, CardContentType } from '../../db/firestoreSchema';
import { agentConfig, DEFAULT_CARD_TYPE_DISTRIBUTION } from '../config/agentConfig';
import { analyzeSubjectLevel, TopicNeed } from '../curriculum/topicAnalyzer';
import { hasRealSubtopics } from '../curriculum/curriculumHierarchy';
import { RunTracker } from '../monitoring/runLogger';
import { loadAdaptations } from '../feedback/adaptationRepository';

export interface AgentPlan {
  needs: TopicNeed[];
  curriculaCreated: number;
  subjectsProcessed: number;
}

async function ensureCurriculumReady(
  subject: string,
  level: EducationLevel,
  tracker: RunTracker,
): Promise<boolean> {
  try {
    let levelsOk = await getSubjectLevels(subject);
    if (!levelsOk) {
      if (tracker.aiCalls >= agentConfig.limits.maxAiCallsPerRun) {
        tracker.stoppedReason = tracker.stoppedReason || 'maxAiCallsPerRun atingido durante o planejamento';
        return false;
      }
      tracker.log({ action: '[curriculum] identificando níveis', subject, detail: 'não estava no banco' });
      await identifySubjectLevelsTask(subject);
      tracker.aiCalls++;
      levelsOk = await getSubjectLevels(subject);
      if (!levelsOk) {
        tracker.errors++;
        tracker.log({ action: '[curriculum] níveis não foram persistidos após identificação', subject });
        return false;
      }
    }

    const existing = await getCurriculum(subject, level);
    // Currículo novo: não chama IA.
    // Currículo legado: uma chamada de IA enriquece topics → subtopics.
    if (existing && hasRealSubtopics(existing.data)) return false;

    if (tracker.aiCalls >= agentConfig.limits.maxAiCallsPerRun) {
      tracker.stoppedReason = tracker.stoppedReason || 'maxAiCallsPerRun atingido durante o planejamento';
      return false;
    }

    tracker.log({
      action: existing ? '[curriculum] enriquecendo grade legada' : '[curriculum] gerando grade hierárquica',
      subject,
      detail: level,
    });
    const result = await generateCurriculumTask({ subject, educationLevel: level, language: agentConfig.defaultLanguage });
    if (!result.cacheHit) tracker.aiCalls++;
    tracker.curriculaCreated++;
    return true;
  } catch (err: any) {
    tracker.errors++;
    tracker.log({ action: '[curriculum] falha ao preparar currículo', subject, detail: err?.message || String(err) });
    return false;
  }
}

export async function buildPlan(tracker: RunTracker): Promise<AgentPlan> {
  const allNeeds: TopicNeed[] = [];
  let curriculaCreated = 0;
  let subjectsProcessed = 0;
  const distributionCache = new Map<string, Partial<Record<CardContentType, number>>>();

  for (const managed of agentConfig.managedSubjects) {
    if (tracker.elapsedMinutes() >= agentConfig.limits.maxRuntimeMinutes) {
      tracker.stoppedReason = 'maxRuntimeMinutes atingido durante o planejamento';
      break;
    }
    if (tracker.aiCalls >= agentConfig.limits.maxAiCallsPerRun) {
      tracker.stoppedReason = tracker.stoppedReason || 'maxAiCallsPerRun atingido durante o planejamento';
      break;
    }

    for (const level of managed.levels) {
      if (tracker.elapsedMinutes() >= agentConfig.limits.maxRuntimeMinutes) {
        tracker.stoppedReason = 'maxRuntimeMinutes atingido durante o planejamento';
        break;
      }
      if (tracker.aiCalls >= agentConfig.limits.maxAiCallsPerRun) {
        tracker.stoppedReason = tracker.stoppedReason || 'maxAiCallsPerRun atingido durante o planejamento';
        break;
      }

      const created = await ensureCurriculumReady(managed.subject, level, tracker);
      if (created) curriculaCreated++;

      const needs = await analyzeSubjectLevel(managed.subject, level);
      allNeeds.push(...needs);

      const cacheKey = `${managed.subject}::${level}`;
      if (!distributionCache.has(cacheKey)) {
        const adaptations = await loadAdaptations(managed.subject, level);
        distributionCache.set(cacheKey, adaptations?.typeDistribution ?? DEFAULT_CARD_TYPE_DISTRIBUTION);
      }
    }
    subjectsProcessed++;
  }

  const rank = { P2_NO_CONTENT: 0, P3_BELOW_MINIMUM: 1, P7_EXPANSION: 2 } as const;
  allNeeds.sort((a, b) => {
    const rankDiff = rank[a.priority] - rank[b.priority];
    if (rankDiff !== 0) return rankDiff;
    const distA = distributionCache.get(`${a.subject}::${a.level}`) ?? DEFAULT_CARD_TYPE_DISTRIBUTION;
    const distB = distributionCache.get(`${b.subject}::${b.level}`) ?? DEFAULT_CARD_TYPE_DISTRIBUTION;
    const weightA = distA[a.cardType] ?? DEFAULT_CARD_TYPE_DISTRIBUTION[a.cardType] ?? 0;
    const weightB = distB[b.cardType] ?? DEFAULT_CARD_TYPE_DISTRIBUTION[b.cardType] ?? 0;
    return weightB - weightA;
  });

  const limited = allNeeds.slice(0, agentConfig.limits.maxTopicsPerRun);
  if (allNeeds.length > limited.length) {
    tracker.log({ action: '[planner] plano truncado por maxTopicsPerRun', detail: `${limited.length}/${allNeeds.length} folhas` });
  }

  return { needs: limited, curriculaCreated, subjectsProcessed };
}
