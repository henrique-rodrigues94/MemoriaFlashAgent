import type { CurriculumDoc } from '../../db/firestoreSchema';

/**
 * Hierarquia curricular compartilhada pelo agente.
 * `topics` continua sendo mantido como array de strings para compatibilidade
 * com o app atual; `subtopics` relaciona cada tópico aos seus subtemas.
 */
export interface CurriculumCategoryHierarchy {
  category: string;
  topics: string[];
  subtopics: Record<string, string[]>;
}

export interface HierarchicalCurriculum {
  categories: CurriculumCategoryHierarchy[];
  totalTopics: number;
  totalSubtopics: number;
}

function clean(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function unique(values: string[]): string[] {
  const seen = new Set<string>();
  return values.filter(value => {
    const key = value.toLocaleLowerCase();
    if (!value || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/**
 * Normaliza currículos novos e antigos.
 * Currículos antigos só possuem topics; nesse caso cada topic vira uma folha
 * temporária para o pipeline não quebrar durante a migração.
 */
export function toHierarchy(data: CurriculumDoc | any): HierarchicalCurriculum {
  const categories: CurriculumCategoryHierarchy[] = [];

  for (const rawCategory of Array.isArray(data?.categories) ? data.categories : []) {
    const category = clean(rawCategory?.category);
    if (!category) continue;

    const topics = unique((Array.isArray(rawCategory?.topics) ? rawCategory.topics : [])
      .map(clean));
    const rawSubtopics = rawCategory?.subtopics && typeof rawCategory.subtopics === 'object'
      ? rawCategory.subtopics as Record<string, unknown>
      : {};

    const subtopics: Record<string, string[]> = {};
    for (const topic of topics) {
      const values = Array.isArray(rawSubtopics[topic])
        ? rawSubtopics[topic] as unknown[]
        : [];
      const normalized = unique(values.map(clean));
      // Currículo antigo: usa o próprio tópico como folha até ser enriquecido.
      subtopics[topic] = normalized.length > 0 ? normalized : [topic];
    }

    categories.push({ category, topics, subtopics });
  }

  return {
    categories,
    totalTopics: categories.reduce((sum, category) => sum + category.topics.length, 0),
    totalSubtopics: categories.reduce(
      (sum, category) => sum + Object.values(category.subtopics).reduce((n, values) => n + values.length, 0),
      0,
    ),
  };
}

export function hasRealSubtopics(data: CurriculumDoc | any): boolean {
  const hierarchy = toHierarchy(data);
  return hierarchy.categories.some(category =>
    category.topics.some(topic => {
      const leaves = category.subtopics[topic] ?? [];
      return leaves.some(leaf => leaf.toLocaleLowerCase() !== topic.toLocaleLowerCase());
    }),
  );
}

/** Retorna todas as folhas da grade com seu caminho completo. */
export function flattenCurriculum(data: CurriculumDoc | any): Array<{
  category: string;
  topic: string;
  subtopic: string;
}> {
  const hierarchy = toHierarchy(data);
  return hierarchy.categories.flatMap(category =>
    category.topics.flatMap(topic =>
      (category.subtopics[topic] ?? [topic]).map(subtopic => ({ category: category.category, topic, subtopic })),
    ),
  );
}
