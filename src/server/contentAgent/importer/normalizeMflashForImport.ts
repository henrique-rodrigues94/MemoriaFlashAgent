import { MflashPackage, MflashLevelInput, MflashManifest, MflashSubjectInput, MflashCurriculumInput, MflashTopicInput, MflashSubtopicInput, MflashCardInput, OFFICIAL_LEVELS } from './completoMflash';

function text(value: unknown): string { return typeof value === 'string' ? value.trim() : ''; }
function slug(value: string): string { return value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, ''); }
function levelId(value: unknown): string {
  const normalized = slug(text(value));
  const aliases: Record<string, string> = {
    fundamental: 'fundamental', 'ensino-fundamental': 'fundamental',
    medio: 'medio', 'ensino-medio': 'medio', 'ensino-médio': 'medio',
    faculdade: 'faculdade', superior: 'faculdade,', concurso: 'concurso',
    tecnico: 'tecnico', 'ensino-tecnico': 'tecnico',
  };
  return aliases[normalized] || normalized;
}

function normalizeCard(raw: any): MflashCardInput { return {
  id: text(raw?.id || raw?.cardId || raw?.codigo) || undefined,
  question: text(raw?.question || raw?.pergunta || raw?.front) || undefined,
  answer: text(raw?.answer || raw?.resposta || raw?.back) || undefined,
  explanation: text(raw?.explanation || raw?.explicacao || raw?.explicação) || undefined,
  curiosity: text(raw?.curiosity || raw?.curiosidade) || undefined,
  difficulty: text(raw?.difficulty || raw?.dificuldade) || undefined,
  tags: Array.isArray(raw?.tags) ? raw.tags : undefined,
  curriculumPriority: Number.isFinite(Number(raw?.curriculumPriority || raw?.prioridade)) ? Number(raw?.curriculumPriority || raw?.prioridade) : undefined,
  source: raw?.source,
}; }

function normalizeSubtopic(raw: any): MflashSubtopicInput {
  const source = raw?.cards || raw?.cardsData || raw?.flashcards || [];
  return { id: text(raw?.id || raw?.subtopicId || raw?.codigo) || undefined, name: text(raw?.name || raw?.nome || raw?.subtopic || raw?.subtopico || raw?.subtópico) || 'Subtópico', cards: Array.isArray(source) ? source.map(normalizeCard) : [] };
}
function normalizeTopic(raw: any): MflashTopicInput {
  const source = raw?.subtopics || raw?.subtopicos || raw?.subtópicos || [];
  if (Array.isArray(source) && source.length) return { id: text(raw?.id || raw?.topicId || raw?.codigo) || undefined, name: text(raw?.name || raw?.nome || raw?.topic || raw?.topico || raw?.tópico) || 'Tópico', subtopics: source.map(normalizeSubtopic) };
  const cards = raw?.cards || raw?.cardsData || raw?.flashcards || [];
  return { id: text(raw?.id || raw?.topicId || raw?.codigo) || undefined, name: text(raw?.name || raw?.nome || raw?.topic || raw?.topico || raw?.tópico) || 'Tópico', subtopics: [{ name: 'Conteúdo geral', cards: Array.isArray(cards) ? cards.map(normalizeCard) : [] }] };
}
function normalizeCurriculum(raw: any): MflashCurriculumInput {
  const source = raw?.topics || raw?.topicos || raw?.tópicos || [];
  return { id: text(raw?.id || raw?.curriculumId || raw?.codigo) || undefined, name: text(raw?.name || raw?.nome || raw?.title) || 'Grade completa', topics: Array.isArray(source) ? source.map(normalizeTopic) : [] };
}
function normalizeSubject(raw: any): MflashSubjectInput {
  const source = raw?.curricula || raw?.grades || raw?.gradesCurriculares || raw?.curriculos || [];
  if (Array.isArray(source) && source.length) return { id: text(raw?.id || raw?.subjectId || raw?.codigo) || undefined, name: text(raw?.name || raw?.nome || raw?.subject || raw?.materia || raw?.matéria) || 'Português', curricula: source.map(normalizeCurriculum) };
  const topics = raw?.topics || raw?.topicos || raw?.tópicos || [];
  return { id: text(raw?.id || raw?.subjectId || raw?.codigo) || undefined, name: text(raw?.name || raw?.nome || raw?.subject || raw?.materia || raw?.matéria) || 'Português', curricula: [{ name: 'Grade completa', topics: Array.isArray(topics) ? topics.map(normalizeTopic) : [] }] };
}

function buildFlatLegacyLevel(root: any, id: string): MflashLevelInput {
  const subjectName = text(root?.subject || root?.materia || root?.matéria) || 'Português';
  const rootTopics = root?.topics || root?.topicos || root?.tópicos || [];
  const rootSubtopics = root?.subtopics || root?.subtopicos || root?.subtópicos || [];
  const rootCards = root?.cards || root?.cardsData || root?.flashcards || [];
  let topics: MflashTopicInput[] = [];
  if (Array.isArray(rootTopics) && rootTopics.length) topics = rootTopics.map(normalizeTopic);
  else if (Array.isArray(rootSubtopics) && rootSubtopics.length) topics = [{ name: 'Conteúdo geral', subtopics: rootSubtopics.map(normalizeSubtopic) }];
  else if (Array.isArray(rootCards) && rootCards.length) {
    const topicMap = new Map<string, Map<string, MflashCardInput[]>>();
    for (const raw of rootCards) {
      const topic = text(raw?.topic || raw?.topico || raw?.tópico) || 'Conteúdo geral';
      const subtopic = text(raw?.subtopic || raw?.subtopico || raw?.subtópico) || 'Conteúdo geral';
      if (!topicMap.has(topic)) topicMap.set(topic, new Map());
      const subs = topicMap.get(topic)!;
      if (!subs.has(subtopic)) subs.set(subtopic, []);
      subs.get(subtopic)!.push(normalizeCard(raw));
    }
    topics = [...topicMap.entries()].map(([topic, subs]) => ({ name: topic, subtopics: [...subs.entries()].map(([subtopic, cards]) => ({ name: subtopic, cards })) }));
  }
  return { id, name: text(root?.levelName || root?.nivelNome || root?.nívelNome) || id.toUpperCase(), subjects: [{ name: subjectName, curricula: [{ name: 'Grade completa', topics }] }] };
}

function normalizeLevel(raw: any, root: any): MflashLevelInput {
  // Compatibilidade com manifest.levels: ["fundamental"] e levels: ["FUNDAMENTAL"].
  if (typeof raw === 'string') {
    const id = levelId(raw);
    return buildFlatLegacyLevel(root, id);
  }
  const id = levelId(raw?.id || raw?.level || raw?.nivel || raw?.nível || raw?.educationLevel || raw?.name);
  const source = raw?.subjects || raw?.materias || raw?.matérias || [];
  return { id: id as MflashLevelInput['id'], name: text(raw?.name || raw?.nome) || id.toUpperCase(), subjects: Array.isArray(source) ? source.map(normalizeSubject) : [] };
}

function buildManifest(root: any, packageType: 'completo' | 'nivel', levels: string[]): MflashManifest {
  return {
    format: text(root?.manifest?.format || root?.format || root?.formato) || 'memoriaflash',
    formatVersion: text(root?.manifest?.formatVersion || root?.formatVersion || root?.version || root?.versao) || '1.0',
    package: packageType,
    contentVersion: text(root?.manifest?.contentVersion || root?.contentVersion || root?.content_version || root?.versaoConteudo) || '1.0.0',
    language: text(root?.manifest?.language || root?.language || root?.idioma) || 'pt-BR',
    levels,
    statistics: root?.manifest?.statistics || root?.statistics,
    generator: { ...(root?.manifest?.generator || {}), normalizedFrom: root?.manifest ? 'legacy-manifest' : 'legacy' },
  };
}

export function normalizeMflashForImport(input: unknown): MflashPackage {
  const root = input as any;
  if (!root || typeof root !== 'object') throw new Error('Arquivo .mflash precisa conter um objeto JSON.');
  const rawLevels = Array.isArray(root.levels) ? root.levels : [];
  let levels: MflashLevelInput[] = rawLevels.map((raw: any) => normalizeLevel(raw, root));
  const declaredLevel = levelId(root?.manifest?.levels?.[0] || root?.level || root?.nivel || root?.nível || root?.educationLevel);
  if (!levels.length && OFFICIAL_LEVELS.includes(declaredLevel as any)) levels = [buildFlatLegacyLevel(root, declaredLevel)];
  if (!levels.length) throw new Error(`Não foi possível identificar o nível do arquivo .mflash. Níveis permitidos: ${OFFICIAL_LEVELS.join(', ')}.`);
  const validLevels = levels.filter(level => OFFICIAL_LEVELS.includes(level.id));
  if (validLevels.length !== levels.length) throw new Error(`Nível inválido no .mflash. Permitidos: ${OFFICIAL_LEVELS.join(', ')}.`);
  const unique = [...new Map(validLevels.map((level: MflashLevelInput) => [level.id, level])).values()];
  const packageType: 'completo' | 'nivel' = unique.length === 1 ? 'nivel' : 'completo';
  const manifest = buildManifest(root, packageType, packageType === 'nivel' ? [unique[0].id] : [...OFFICIAL_LEVELS]);
  if (packageType === 'completo') {
    const byId = new Map<string, MflashLevelInput>(unique.map((level: MflashLevelInput) => [level.id, level]));
    levels = OFFICIAL_LEVELS.map(id => byId.get(id) || { id, name: id.toUpperCase(), subjects: [] });
  } else levels = [unique[0]];
  return { manifest, levels };
}

export function detectMflashPackageType(input: unknown): 'completo' | 'nivel' {
  const root = input as any;
  const type = root?.manifest?.package || root?.package || root?.tipoPacote;
  if (type === 'nivel') return 'nivel';
  if (type === 'completo') return 'completo';
  if (Array.isArray(root?.levels) && root.levels.length === 1) return 'nivel';
  throw new Error('Tipo de pacote .mflash inválido. Use package="completo" ou package="nivel".');
}
