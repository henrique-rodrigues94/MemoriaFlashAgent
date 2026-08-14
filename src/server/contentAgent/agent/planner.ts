// 📁 flashmind-ai/src/server/contentAgent/agent/planner.ts
//
// DESCOBRIR + ORGANIZAR do ciclo do agente (Seção 37 do briefing).
// 1. Garante que subject-levels e currículo existem para cada matéria
//    gerenciada (reaproveita identifySubjectLevelsTask/generateCurriculumTask
//    — que já fazem "verificar banco antes de chamar IA").
// 2. Roda o topicAnalyzer sobre cada currículo e agrega tudo em um plano
//    único, respeitando maxTopicsPerRun.

import { identifySubjectLevelsTask } from '../../ai/tasks/identifySubjectLevels';
import { generateCurriculumTask } from '../../ai/tasks/generateCurriculum';
import { getSubjectLevels, getCurriculum } from '../../db/db';
import type { EducationLevel, CardContentType } from '../../db/firestoreSchema';
import { agentConfig, DEFAULT_CARD_TYPE_DISTRIBUTION } from '../config/agentConfig';
import { analyzeSubjectLevel, TopicNeed } from '../curriculum/topicAnalyzer';
import { RunTracker } from '../monitoring/runLogger';
import { loadAdaptations } from '../feedback/adaptationRepository';

export interface AgentPlan {
  needs: TopicNeed[];
  curriculaCreated: number;
  subjectsProcessed: number;
}

/** Garante subject-levels + currículo prontos para subject/level. Não força
 *  re-geração se já existe e não expirou (isExpired já é checado dentro de
 *  getSubjectLevels/getCurriculum). */
async function ensureCurriculumReady(
  subject: string,
  level: EducationLevel,
  tracker: RunTracker,
): Promise<boolean> {
  try {
    let levelsOk = await getSubjectLevels(subject);
    if (!levelsOk) {
      tracker.log({ action: '[curriculum] identificando níveis', subject, detail: 'não estava no banco' });
      await identifySubjectLevelsTask(subject);
      tracker.aiCalls++;
    }

    const existing = await getCurriculum(subject, level);
    if (existing) return false; // já pronto, nada criado agora

    tracker.log({ action: '[curriculum] gerando grade curricular', subject, detail: level });
    await generateCurriculumTask({ subject, educationLevel: level, language: agentConfig.defaultLanguage });
    tracker.aiCalls++;
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
  // cache por "subject::level" — evita recarregar a mesma adaptação várias
  // vezes ao ponderar cada TopicNeed individual logo abaixo.
  const distributionCache = new Map<string, Partial<Record<CardContentType, number>>>();

  for (const managed of agentConfig.managedSubjects) {
    if (tracker.elapsedMinutes() >= agentConfig.limits.maxRuntimeMinutes) {
      tracker.stoppedReason = 'maxRuntimeMinutes atingido durante o planejamento';
      break;
    }

    for (const level of managed.levels) {
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

  // Prioridade já vem ordenada por matéria (P2 > P3 > P7); dentro do mesmo
  // nível de prioridade, tipos de card com peso aprendido maior (Seção 18 —
  // Learning Engine) entram primeiro no orçamento limitado da execução.
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
    tracker.log({
      action: '[planner] plano truncado por maxTopicsPerRun',
      detail: `${limited.length}/${allNeeds.length} tópicos entrarão nesta execução`,
    });
  }

  return { needs: limited, curriculaCreated, subjectsProcessed };
}
