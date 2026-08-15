// Decide quais folhas da grade curricular precisam de cards.
// A unidade real de geração agora é o SUBTÓPICO; currículos antigos continuam
// funcionando porque o próprio tópico vira a folha.

import { getCurriculum, getBucketStats } from '../../db/db';
import type { EducationLevel, CardContentType } from '../../db/firestoreSchema';
import { agentConfig } from '../config/agentConfig';
import { flattenCurriculum } from './curriculumHierarchy';

export type PlanPriority = 'P2_NO_CONTENT' | 'P3_BELOW_MINIMUM' | 'P7_EXPANSION';

export interface TopicNeed {
  subject: string;
  level: EducationLevel;
  cardType: CardContentType;
  /** Chave única da folha: "Tópico > Subtópico" quando há hierarquia. */
  topic: string;
  parentTopic?: string;
  subtopic?: string;
  category: string;
  currentCount: number;
  stale: boolean;
  shortfall: number;
  priority: PlanPriority;
}

function priorityFor(currentCount: number): { priority: PlanPriority; target: number } {
  const { minimumCards, targetCards, maximumCards } = agentConfig.cardTargets;
  if (currentCount <= 0) return { priority: 'P2_NO_CONTENT', target: minimumCards };
  if (currentCount < minimumCards) return { priority: 'P3_BELOW_MINIMUM', target: minimumCards };
  if (currentCount < targetCards) return { priority: 'P7_EXPANSION', target: targetCards };
  return { priority: 'P7_EXPANSION', target: Math.min(currentCount, maximumCards) };
}

export async function analyzeSubjectLevel(
  subject: string,
  level: EducationLevel,
): Promise<TopicNeed[]> {
  const curriculumResult = await getCurriculum(subject, level);
  if (!curriculumResult) return [];

  const leaves = flattenCurriculum(curriculumResult.data).map(leaf => ({
    ...leaf,
    bucketTopic: leaf.topic.toLocaleLowerCase() === leaf.subtopic.toLocaleLowerCase()
      ? leaf.subtopic
      : `${leaf.topic} > ${leaf.subtopic}`,
  }));

  const needs: TopicNeed[] = [];
  const leafByBucket = new Map(leaves.map(leaf => [leaf.bucketTopic, leaf]));

  for (const cardType of agentConfig.activeCardTypes) {
    const uniqueBucketTopics = [...new Set(leaves.map(leaf => leaf.bucketTopic))];
    const stats = await getBucketStats(subject, uniqueBucketTopics, level, cardType);

    for (const stat of stats) {
      const leaf = leafByBucket.get(stat.topic);
      const { priority, target } = priorityFor(stat.cardCount);
      const shortfall = Math.max(0, target - stat.cardCount);
      if (shortfall <= 0 && !stat.stale) continue;

      needs.push({
        subject,
        level,
        cardType,
        topic: stat.topic,
        parentTopic: leaf?.topic,
        subtopic: leaf?.subtopic,
        category: leaf?.category ?? '',
        currentCount: stat.cardCount,
        stale: stat.stale,
        shortfall: stat.stale && shortfall === 0 ? agentConfig.limits.batchSize : shortfall,
        priority,
      });
    }
  }

  const rank: Record<PlanPriority, number> = { P2_NO_CONTENT: 0, P3_BELOW_MINIMUM: 1, P7_EXPANSION: 2 };
  return needs.sort((a, b) => rank[a.priority] - rank[b.priority]);
}
