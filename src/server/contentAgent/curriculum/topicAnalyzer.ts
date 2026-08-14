// 📁 flashmind-ai/src/server/contentAgent/curriculum/topicAnalyzer.ts
//
// Decide, para cada tópico de um currículo já existente, se ele precisa de
// geração de cards — e com qual prioridade. Reaproveita getBucketStats/
// getCurriculum de src/server/db/db.ts (nenhuma leitura direta ao Firestore
// aqui).

import { getCurriculum, getBucketStats } from '../../db/db';
import type { EducationLevel, CardContentType } from '../../db/firestoreSchema';
import { agentConfig } from '../config/agentConfig';

export type PlanPriority = 'P2_NO_CONTENT' | 'P3_BELOW_MINIMUM' | 'P7_EXPANSION';

export interface TopicNeed {
  subject: string;
  level: EducationLevel;
  cardType: CardContentType;
  topic: string;
  category: string;
  currentCount: number;
  stale: boolean;
  shortfall: number; // quantos cards gerar agora
  priority: PlanPriority;
}

function priorityFor(currentCount: number): { priority: PlanPriority; target: number } {
  const { minimumCards, targetCards, maximumCards } = agentConfig.cardTargets;

  if (currentCount <= 0) return { priority: 'P2_NO_CONTENT', target: minimumCards };
  if (currentCount < minimumCards) return { priority: 'P3_BELOW_MINIMUM', target: minimumCards };
  if (currentCount < targetCards) return { priority: 'P7_EXPANSION', target: targetCards };
  // Entre target e maximum: não expande automaticamente (regra da Seção 7);
  // isso só mudaria com sinal do Learning Engine (Etapa 7, ainda não conectado).
  return { priority: 'P7_EXPANSION', target: Math.min(currentCount, maximumCards) };
}

/**
 * Retorna as necessidades de conteúdo de subject+level para os tipos de
 * card ativos, ordenadas por prioridade (conteúdo ausente primeiro).
 * Não chama IA — apenas leitura do banco (barato).
 */
export async function analyzeSubjectLevel(
  subject: string,
  level: EducationLevel,
): Promise<TopicNeed[]> {
  const curriculumResult = await getCurriculum(subject, level);
  if (!curriculumResult) return []; // currículo ainda não existe — o Planner cuida disso antes

  const { categories } = curriculumResult.data;
  const needs: TopicNeed[] = [];

  for (const cat of categories) {
    for (const cardType of agentConfig.activeCardTypes) {
      const stats = await getBucketStats(subject, cat.topics, level, cardType);
      for (const stat of stats) {
        const { priority, target } = priorityFor(stat.cardCount);
        const shortfall = Math.max(0, target - stat.cardCount);
        if (shortfall <= 0 && !stat.stale) continue;

        needs.push({
          subject,
          level,
          cardType,
          topic: stat.topic,
          category: cat.category,
          currentCount: stat.cardCount,
          stale: stat.stale,
          shortfall: stat.stale && shortfall === 0 ? agentConfig.limits.batchSize : shortfall,
          priority,
        });
      }
    }
  }

  const rank: Record<PlanPriority, number> = { P2_NO_CONTENT: 0, P3_BELOW_MINIMUM: 1, P7_EXPANSION: 2 };
  return needs.sort((a, b) => rank[a.priority] - rank[b.priority]);
}
