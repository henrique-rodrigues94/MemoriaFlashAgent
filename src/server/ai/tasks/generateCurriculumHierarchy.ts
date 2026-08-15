import { Type } from '@google/genai';
import { aiOrchestrator } from '../index';
import { getCurriculum, saveCurriculum } from '../../db/db';
import { hasRealSubtopics, toHierarchy } from '../../contentAgent/curriculum/curriculumHierarchy';

export type EducationLevel = 'fundamental' | 'medio' | 'faculdade' | 'concurso' | 'tecnico';

export interface CurriculumCategory { category: string; topics: string[]; subtopics: Record<string, string[]>; }

const LEVEL_RULES: Record<EducationLevel, string> = {
  fundamental: 'Alinhado à BNCC do 1º ao 9º ano; linguagem simples e progressão por faixa escolar.',
  medio: 'Alinhado à BNCC do Ensino Médio, ENEM e vestibulares; linguagem formal e acessível.',
  faculdade: 'Nível de graduação; inclua fundamentos, métodos, aplicações e vocabulário técnico.',
  tecnico: 'Foco profissional e aplicado; procedimentos, normas, equipamentos e situações reais.',
  concurso: 'Foco em concursos brasileiros; priorize edital, lei seca, jurisprudência consolidada, conceitos cobrados e pegadinhas de banca.',
};

function concursoContext(subject: string): string {
  const s = subject.toLocaleLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  if (/perito|criminalistica|pericia/.test(s)) return 'Se for Perito/Criminalística, considere criminalística geral, local de crime, cadeia de custódia, documentoscopia, balística, toxicologia, medicina legal, informática forense, química/biologia forense, legislação e laudo pericial, ajustando ao cargo informado.';
  if (/delegado|agente|escrivao|investigador/.test(s)) return 'Se for carreira policial, considere Direito Penal, Processo Penal, Constitucional, Administrativo, legislação especial, direitos humanos, criminalística e demais matérias recorrentes do cargo.';
  if (/auditor|fiscal|receita|tribut/.test(s)) return 'Se for área fiscal, considere Direito Tributário, legislação tributária, contabilidade, auditoria, administração pública e TI quando pertinente ao cargo.';
  if (/judici|tribunal|trf|trt|tre|stj|stf|tjsp/.test(s)) return 'Se for área judiciária, considere Constitucional, Administrativo, Processo Civil/Penal, legislação/regimento e Português/Raciocínio quando pertinentes ao cargo.';
  return `Use como referência os conteúdos efetivamente cobrados em editais recentes da área "${subject}" e não invente disciplinas específicas sem relação com o cargo.`;
}

function normalizeText(text: string): string { return (text || '').trim().replace(/\s+/g, ' '); }
function unique(values: string[]): string[] { const seen = new Set<string>(); return values.filter(value => { const key = normalizeText(value).toLocaleLowerCase(); if (!key || seen.has(key)) return false; seen.add(key); return true; }); }

function normalizeCategories(raw: any): CurriculumCategory[] {
  const result: CurriculumCategory[] = [];
  for (const item of Array.isArray(raw?.categories) ? raw.categories : []) {
    const category = normalizeText(item?.category); if (!category) continue;
    const topics: string[] = []; const subtopics: Record<string, string[]> = {};
    if (Array.isArray(item?.topics)) for (const rawTopic of item.topics) {
      const topic = typeof rawTopic === 'string' ? normalizeText(rawTopic) : normalizeText(rawTopic?.topic);
      const leaves = unique((Array.isArray(rawTopic?.subtopics) ? rawTopic.subtopics : []).map((value: unknown) => normalizeText(String(value ?? ''))));
      if (topic) { topics.push(topic); subtopics[topic] = leaves.length > 0 ? leaves : [topic]; }
    }
    if (item?.subtopics && typeof item.subtopics === 'object') for (const topic of topics) {
      const leaves = Array.isArray(item.subtopics[topic]) ? unique(item.subtopics[topic].map((value: unknown) => normalizeText(String(value ?? '')))) : [];
      if (leaves.length > 0) subtopics[topic] = leaves;
    }
    const finalTopics = unique(topics).slice(0, 10); if (finalTopics.length === 0) continue;
    for (const topic of finalTopics) subtopics[topic] = unique(subtopics[topic] ?? [topic]).slice(0, 8);
    result.push({ category, topics: finalTopics, subtopics }); if (result.length >= 12) break;
  }
  return result;
}

function schema() {
  return { type: Type.OBJECT, properties: { categories: { type: Type.ARRAY, minItems: 4, maxItems: 12, items: { type: Type.OBJECT, properties: { category: { type: Type.STRING }, topics: { type: Type.ARRAY, minItems: 3, maxItems: 10, items: { type: Type.OBJECT, properties: { topic: { type: Type.STRING }, subtopics: { type: Type.ARRAY, minItems: 3, maxItems: 8, items: { type: Type.STRING } } }, required: ['topic', 'subtopics'] } } }, required: ['category', 'topics'] } } }, required: ['categories'] };
}

function compactSource(sourceContext: string): string {
  const source = normalizeText(sourceContext);
  if (source.length <= 30000) return source;
  const head = source.slice(0, 10000); const middleStart = Math.max(10000, Math.floor(source.length / 2) - 5000); const middle = source.slice(middleStart, middleStart + 10000); const tail = source.slice(-10000);
  return `${head}\n\n[...trecho central... ]\n\n${middle}\n\n[...final do documento...]\n\n${tail}`;
}

export async function generateCurriculumHierarchyTask(args: { subject: string; educationLevel: EducationLevel; language?: string; sourceContext?: string; }): Promise<{ categories: CurriculumCategory[]; providerUsed: string; cacheHit?: boolean; enriched?: boolean }> {
  const { subject, educationLevel, sourceContext = '' } = args;
  const cached = await getCurriculum(subject, educationLevel);
  if (cached && hasRealSubtopics(cached.data) && !sourceContext.trim()) return { categories: toHierarchy(cached.data).categories, providerUsed: 'db-cache', cacheHit: true };

  const oldTopics = cached ? toHierarchy(cached.data).categories.flatMap(category => category.topics.map(topic => `${category.category} → ${topic}`)) : [];
  const contestHint = educationLevel === 'concurso' ? `\nCONTEXTO DE CONCURSO: ${concursoContext(subject)}` : '';
  const sourceBlock = sourceContext.trim() ? `\n\nFONTE DO DOCUMENTO (use como fonte principal; não invente conteúdo que não esteja sustentado por ela):\n${compactSource(sourceContext)}` : '';
  const sourceRules = sourceContext.trim() ? '\n- Quando houver fonte do documento, priorize os assuntos efetivamente presentes nela. Não force a grade completa de uma matéria genérica se o documento cobre apenas parte dela.\n- Preserve termos e nomenclatura relevantes encontrados na fonte.' : '';

  const systemPrompt = `Você é o arquiteto curricular do MemoriaFlash. Crie uma grade de estudo completa, coerente e progressiva para a matéria/assunto informado.\n\nNÍVEL: ${LEVEL_RULES[educationLevel]}${contestHint}\n\nHIERARQUIA OBRIGATÓRIA:\n1. Categoria = grande área da matéria.\n2. Tópico = unidade de estudo principal dentro da categoria.\n3. Subtópico = conceito específico que o aluno consegue estudar e que merece seus próprios flashcards.\n\nREGRAS:\n- Gere 4–12 categorias.\n- Gere 3–10 tópicos por categoria.\n- Gere 3–8 subtópicos reais por tópico.\n- Cubra do fundamento ao conteúdo avançado adequado ao nível.\n- Evite "outros", "revisão geral", "introdução" e nomes vagos.\n- Não duplique tópicos ou subtópicos.\n- Não invente leis, normas, autores, datas ou conteúdos que não façam sentido para a matéria.${sourceRules}\n- Para concurso, organize como um edital de alto nível e priorize conteúdo efetivamente cobrado.\n- A grade será usada como mapa mestre para gerar flashcards automaticamente.\n- Responda somente JSON.`;
  const userPrompt = `Matéria/assunto: "${subject}"\nNível: "${educationLevel}"${oldTopics.length > 0 ? `\n\nGrade existente: preserve tópicos válidos, mas enriqueça com subtópicos:\n${oldTopics.slice(0, 80).join('\n')}` : ''}${sourceBlock}\n\nRetorne: { "categories": [{ "category": "Nome da área", "topics": [{ "topic": "Tópico principal", "subtopics": ["Subtópico 1", "Subtópico 2", "Subtópico 3"] }] }] }`;

  const { data, providerUsed } = await aiOrchestrator.generateJSON({ systemPrompt, userPrompt, schemaHint: '{ "categories": [{ "category": string, "topics": [{ "topic": string, "subtopics": string[] }] }] }', geminiSchema: schema(), maxOutputTokens: 12000 });
  const categories = normalizeCategories(data); if (categories.length === 0) throw new Error(`IA não retornou uma grade curricular válida para "${subject}".`);
  await saveCurriculum(subject, educationLevel, categories as any, providerUsed);
  return { categories, providerUsed, cacheHit: false, enriched: Boolean(cached) };
}
