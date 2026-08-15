import { Type } from '@google/genai';
import { aiOrchestrator } from '../index';
import { getCurriculum, saveCurriculum } from '../../db/db';
import { hasRealSubtopics, toHierarchy } from '../../contentAgent/curriculum/curriculumHierarchy';

export type EducationLevel = 'fundamental' | 'medio' | 'faculdade' | 'concurso' | 'tecnico';

export interface CurriculumCategory {
  category: string;
  topics: string[];
  subtopics: Record<string, string[]>;
}

const LEVEL_RULES: Record<EducationLevel, string> = {
  fundamental: 'Alinhado à BNCC do 1º ao 9º ano; linguagem simples e progressão por faixa escolar.',
  medio: 'Alinhado à BNCC do Ensino Médio, ENEM e vestibulares; linguagem formal e acessível.',
  faculdade: 'Nível de graduação; inclua fundamentos, métodos, aplicações e vocabulário técnico.',
  tecnico: 'Foco profissional e aplicado; procedimentos, normas, equipamentos e situações reais.',
  concurso: 'Foco em concursos brasileiros; priorize edital, lei seca, jurisprudência consolidada, conceitos cobrados e pegadinhas de banca.',
};

function normalizeText(text: string): string {
  return (text || '').trim().replace(/\s+/g, ' ');
}

function unique(values: string[]): string[] {
  const seen = new Set<string>();
  return values.filter(value => {
    const key = normalizeText(value).toLocaleLowerCase();
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function normalizeCategories(raw: any): CurriculumCategory[] {
  const result: CurriculumCategory[] = [];
  for (const item of Array.isArray(raw?.categories) ? raw.categories : []) {
    const category = normalizeText(item?.category);
    if (!category) continue;

    const topics: string[] = [];
    const subtopics: Record<string, string[]> = {};

    // Formato novo: topics=[{topic,subtopics:[...]}]
    if (Array.isArray(item?.topics)) {
      for (const rawTopic of item.topics) {
        if (typeof rawTopic === 'string') {
          const topic = normalizeText(rawTopic);
          if (topic) {
            topics.push(topic);
            subtopics[topic] = [topic];
          }
        } else {
          const topic = normalizeText(rawTopic?.topic);
          const leaves = unique((Array.isArray(rawTopic?.subtopics) ? rawTopic.subtopics : [])
            .map((value: unknown) => normalizeText(String(value ?? ''))));
          if (topic) {
            topics.push(topic);
            subtopics[topic] = leaves.length > 0 ? leaves : [topic];
          }
        }
      }
    }

    // Formato alternativo: subtopics é um mapa e topics são strings.
    if (item?.subtopics && typeof item.subtopics === 'object') {
      for (const topic of topics) {
        const leaves = Array.isArray(item.subtopics[topic])
          ? unique(item.subtopics[topic].map((value: unknown) => normalizeText(String(value ?? ''))))
          : [];
        if (leaves.length > 0) subtopics[topic] = leaves;
      }
    }

    const finalTopics = unique(topics).slice(0, 10);
    if (finalTopics.length === 0) continue;
    for (const topic of finalTopics) subtopics[topic] = unique(subtopics[topic] ?? [topic]).slice(0, 8);
    result.push({ category, topics: finalTopics, subtopics });
    if (result.length >= 12) break;
  }
  return result;
}

function schema() {
  return {
    type: Type.OBJECT,
    properties: {
      categories: {
        type: Type.ARRAY,
        minItems: 4,
        maxItems: 12,
        items: {
          type: Type.OBJECT,
          properties: {
            category: { type: Type.STRING },
            topics: {
              type: Type.ARRAY,
              minItems: 3,
              maxItems: 10,
              items: {
                type: Type.OBJECT,
                properties: {
                  topic: { type: Type.STRING },
                  subtopics: {
                    type: Type.ARRAY,
                    minItems: 3,
                    maxItems: 8,
                    items: { type: Type.STRING },
                  },
                },
                required: ['topic', 'subtopics'],
              },
            },
          },
          required: ['category', 'topics'],
        },
      },
    },
    required: ['categories'],
  };
}

/**
 * Gera uma grade curricular em três níveis:
 * matéria/assunto → categoria → tópico → subtópico.
 * O documento continua compatível com o app antigo porque `topics` permanece
 * como array de strings e o mapa `subtopics` é adicionado ao lado.
 */
export async function generateCurriculumHierarchyTask(args: {
  subject: string;
  educationLevel: EducationLevel;
  language?: string;
}): Promise<{ categories: CurriculumCategory[]; providerUsed: string; cacheHit?: boolean; enriched?: boolean }> {
  const { subject, educationLevel, language = 'pt' } = args;
  const cached = await getCurriculum(subject, educationLevel);

  if (cached && hasRealSubtopics(cached.data)) {
    return {
      categories: toHierarchy(cached.data).categories,
      providerUsed: 'db-cache',
      cacheHit: true,
    };
  }

  const oldTopics = cached
    ? toHierarchy(cached.data).categories.flatMap(category => category.topics.map(topic => `${category.category} → ${topic}`))
    : [];

  const systemPrompt = `Você é o arquiteto curricular do MemoriaFlash.
Crie uma grade de estudo completa, coerente e progressiva para a matéria/assunto informado.

NÍVEL: ${LEVEL_RULES[educationLevel]}

HIERARQUIA OBRIGATÓRIA:
1. Categoria = grande área da matéria.
2. Tópico = unidade de estudo principal dentro da categoria.
3. Subtópico = conceito específico que o aluno consegue estudar e que merece seus próprios flashcards.

REGRAS:
- Gere 4–12 categorias.
- Gere 3–10 tópicos por categoria.
- Gere 3–8 subtópicos REAIS por tópico.
- Cubra do fundamento ao conteúdo avançado adequado ao nível.
- Evite "outros", "revisão geral", "introdução" e nomes vagos.
- Não duplique tópicos ou subtópicos.
- Não invente leis, normas, autores, datas ou conteúdos que não façam sentido para a matéria.
- Para concurso, organize como um edital de alto nível e priorize conteúdo efetivamente cobrado.
- A grade deve servir como mapa mestre para depois gerar flashcards automaticamente.
- Responda somente JSON.`;

  const userPrompt = `Matéria/assunto: "${subject}"
Nível: "${educationLevel}"
${oldTopics.length > 0 ? `
Existe uma grade antiga que precisa ser enriquecida. Preserve os tópicos válidos e transforme cada um em uma unidade com subtópicos:
${oldTopics.slice(0, 80).join('\n')}` : ''}

Retorne:
{
  "categories": [
    {
      "category": "Nome da área",
      "topics": [
        {
          "topic": "Tópico principal",
          "subtopics": ["Subtópico 1", "Subtópico 2", "Subtópico 3"]
        }
      ]
    }
  ]
}`;

  const { data, providerUsed } = await aiOrchestrator.generateJSON({
    systemPrompt,
    userPrompt,
    schemaHint: '{ "categories": [{ "category": string, "topics": [{ "topic": string, "subtopics": string[] }] }] }',
    geminiSchema: schema(),
    maxOutputTokens: 12000,
  });

  const categories = normalizeCategories(data);
  if (categories.length === 0) throw new Error(`IA não retornou uma grade curricular válida para "${subject}".`);

  // Mantém `topics: string[]` para compatibilidade e adiciona `subtopics` como
  // campo extra no mesmo documento. O Firestore aceita mapas/arrays inline;
  // a grade é pequena o suficiente para permanecer muito abaixo do limite.
  await saveCurriculum(subject, educationLevel, categories as any, providerUsed);

  return {
    categories,
    providerUsed,
    cacheHit: false,
    enriched: Boolean(cached),
  };
}
