import 'dotenv/config';
import { createHash } from 'crypto';
import { mkdir, readFile, rename, unlink, writeFile } from 'fs/promises';
import { dirname, join } from 'path';
import { getCurriculum } from '../../db/db';
import { EducationLevel, generateFlashcardsTask } from './generateFlashcards';
import { MflashPackage, MflashLevelInput, MFLASH_FORMAT, MFLASH_VERSION } from '../../contentAgent/importer/completoMflash';

const OFFICIAL_LEVELS: EducationLevel[] = ['fundamental', 'medio', 'faculdade', 'concurso', 'tecnico'];
const DEFAULT_CARDS_PER_SUBTOPIC = 50;
const DEFAULT_OUTPUT_DIR = './generated-mflash';
const STATE_VERSION = 1;

type CurriculumRow = { category: string; topic: string; subtopic: string };
type GeneratedCard = {
  front: string;
  back: string;
  explanation?: string;
  difficulty: string;
  tags: string[];
  curriculumPriority: number;
  source: Record<string, unknown>;
};

type GenerationState = {
  stateVersion: number;
  subject: string;
  level: EducationLevel;
  cardsPerSubtopic: number;
  curriculumFingerprint: string;
  totalSubtopics: number;
  completed: Record<string, GeneratedCard[]>;
  updatedAt: string;
};

function usage(): never {
  console.error('Uso: npm run content:generate-level -- <materia> <nivel> [cardsPorSubtopico] [saida]');
  console.error('Exemplo: npm run content:generate-level -- "Português" fundamental 50 ./generated-mflash');
  console.error('A geração é retomável automaticamente usando um checkpoint .state.json.');
  process.exit(2);
}

function slug(value: string): string {
  return value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-zA-Z0-9]+/g, '_').replace(/^_+|_+$/g, '');
}

function safeString(value: unknown): string { return typeof value === 'string' ? value.trim() : ''; }

function rowKey(row: CurriculumRow): string {
  return `${row.category}::${row.topic}::${row.subtopic}`.toLocaleLowerCase();
}

function flattenCurriculum(data: any): CurriculumRow[] {
  const rows: CurriculumRow[] = [];
  const categories = Array.isArray(data?.categories) ? data.categories : [];
  for (const category of categories) {
    const categoryName = safeString(category?.category);
    for (const topic of Array.isArray(category?.topics) ? category.topics : []) {
      const topicName = typeof topic === 'string' ? safeString(topic) : safeString(topic?.topic);
      const subtopics = typeof topic === 'object' && Array.isArray(topic?.subtopics) ? topic.subtopics : [];
      for (const subtopic of subtopics) {
        const subtopicName = safeString(subtopic);
        if (categoryName && topicName && subtopicName) rows.push({ category: categoryName, topic: topicName, subtopic: subtopicName });
      }
    }
  }
  return rows;
}

function curriculumFingerprint(rows: CurriculumRow[]): string {
  return createHash('sha256').update(JSON.stringify(rows.map(rowKey))).digest('hex');
}

async function atomicWrite(path: string, content: string): Promise<void> {
  const tempPath = `${path}.tmp`;
  await writeFile(tempPath, content, 'utf8');
  await rename(tempPath, path);
}

async function loadState(statePath: string, expected: Omit<GenerationState, 'completed' | 'updatedAt'>): Promise<GenerationState | null> {
  try {
    const parsed = JSON.parse(await readFile(statePath, 'utf8')) as GenerationState;
    if (parsed.stateVersion !== STATE_VERSION) return null;
    if (parsed.subject !== expected.subject || parsed.level !== expected.level) return null;
    if (parsed.cardsPerSubtopic !== expected.cardsPerSubtopic) return null;
    if (parsed.curriculumFingerprint !== expected.curriculumFingerprint) return null;
    if (parsed.totalSubtopics !== expected.totalSubtopics) return null;
    return { ...parsed, completed: parsed.completed && typeof parsed.completed === 'object' ? parsed.completed : {} };
  } catch {
    return null;
  }
}

async function saveState(statePath: string, state: GenerationState): Promise<void> {
  state.updatedAt = new Date().toISOString();
  await atomicWrite(statePath, JSON.stringify(state));
}

function normalizeFront(value: string): string {
  return value.toLocaleLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/\s+/g, ' ').trim();
}

async function generateExactly(subject: string, level: EducationLevel, topic: string, subtopic: string, count: number) {
  const cards: GeneratedCard[] = [];
  const existingFronts: string[] = [];
  let attempts = 0;

  while (cards.length < count && attempts < 4) {
    attempts++;
    const remaining = count - cards.length;
    const result = await generateFlashcardsTask({
      prompt: subject,
      count: remaining,
      language: 'pt',
      difficulty: 'medium',
      selectedTopics: [subtopic],
      educationLevel: level,
      sourceType: 'subject',
      existingFronts,
      cardContentType: 'definition',
      forceAi: true,
      generationMode: 'level-mflash',
    });

    for (const card of result.cards) {
      const front = safeString(card.front);
      const back = safeString(card.back);
      if (!front || !back) continue;
      const key = normalizeFront(front);
      if (existingFronts.some(existing => normalizeFront(existing) === key)) continue;
      existingFronts.push(front);
      cards.push({
        front,
        back,
        explanation: safeString(card.explanation),
        difficulty: safeString(card.difficulty || 'medium'),
        tags: [subject, level, topic, subtopic],
        curriculumPriority: 5,
        source: { type: 'ai', generator: 'memoriaflash-agent', mode: 'level-mflash', topic, subtopic, educationLevel: level },
      });
      if (cards.length >= count) break;
    }
  }

  if (cards.length !== count) {
    throw new Error(`Não foi possível gerar exatamente ${count} cards para "${subtopic}". Gerados: ${cards.length}. O checkpoint será mantido para retomar sem perder os subtópicos concluídos.`);
  }
  return cards;
}

function buildPackage(subject: string, level: EducationLevel, rows: CurriculumRow[], completed: Record<string, GeneratedCard[]>, cardsPerSubtopic: number): { packageData: MflashPackage; totalCards: number; totalTopics: number } {
  const categories = new Map<string, Map<string, Array<{ name: string; cards: GeneratedCard[] }>>>();
  let totalCards = 0;

  for (const row of rows) {
    const cards = completed[rowKey(row)];
    if (!Array.isArray(cards) || cards.length !== cardsPerSubtopic) {
      throw new Error(`Pacote incompleto: ${row.category} → ${row.topic} → ${row.subtopic} possui ${Array.isArray(cards) ? cards.length : 0}/${cardsPerSubtopic} cards.`);
    }
    if (!categories.has(row.category)) categories.set(row.category, new Map());
    const topics = categories.get(row.category)!;
    if (!topics.has(row.topic)) topics.set(row.topic, []);
    topics.get(row.topic)!.push({ name: row.subtopic, cards });
    totalCards += cards.length;
  }

  const topics = Array.from(categories.values()).flatMap(topicMap => Array.from(topicMap.entries()).map(([topic, subtopics]) => ({
    id: slug(topic),
    name: topic,
    subtopics: subtopics.map(item => ({ id: slug(item.name), name: item.name, cards: item.cards })),
  })));

  const levelPackage: MflashLevelInput = {
    id: level,
    name: level,
    subjects: [{
      id: slug(subject),
      name: subject,
      curricula: [{
        id: `${slug(subject)}_${level}`,
        name: `${subject} — ${level}`,
        topics,
      }],
    }],
  };

  const packageData: MflashPackage = {
    manifest: {
      format: MFLASH_FORMAT,
      formatVersion: MFLASH_VERSION,
      package: 'nivel',
      contentVersion: new Date().toISOString().slice(0, 10),
      language: 'pt-BR',
      levels: [level],
      statistics: {
        levels: 1,
        subjects: 1,
        curricula: 1,
        topics: topics.length,
        subtopics: rows.length,
        cards: totalCards,
        cardsPerSubtopic,
        minimumCardsRequired: rows.length * cardsPerSubtopic,
        coveredSubtopics: rows.length,
        incompleteSubtopics: 0,
      },
      generator: {
        name: 'MemoriaFlashAgent',
        mode: 'level',
        modelPolicy: 'configured-provider',
        target: `${subject}_${level}`,
        generationStrategy: 'curriculum-first-incremental-subtopic-checkpoints',
      },
    },
    levels: [levelPackage],
  };

  return { packageData, totalCards, totalTopics: topics.length };
}

export async function generateLevelMflash(args: { subject: string; educationLevel: EducationLevel; cardsPerSubtopic?: number; outputDir?: string }): Promise<{ outputPath: string; package: MflashPackage; totalCards: number; totalSubtopics: number; resumed: boolean }> {
  const subject = args.subject.trim();
  const level = args.educationLevel;
  const cardsPerSubtopic = Math.max(1, Math.floor(args.cardsPerSubtopic ?? DEFAULT_CARDS_PER_SUBTOPIC));
  const outputDir = args.outputDir || DEFAULT_OUTPUT_DIR;
  if (!subject) throw new Error('Matéria obrigatória.');
  if (!OFFICIAL_LEVELS.includes(level)) throw new Error(`Nível inválido: ${level}. Use: ${OFFICIAL_LEVELS.join(', ')}.`);

  const curriculum = await getCurriculum(subject, level);
  if (!curriculum) throw new Error(`Grade curricular não encontrada para ${subject}/${level}. Gere a grade antes de gerar o .mflash.`);
  const rows = flattenCurriculum(curriculum.data);
  if (!rows.length) throw new Error(`A grade de ${subject}/${level} não possui subtópicos reais.`);

  const uniqueRows = Array.from(new Map(rows.map(row => [rowKey(row), row])).values());
  const fingerprint = curriculumFingerprint(uniqueRows);
  const outputPath = join(outputDir, `${slug(subject)}_${level}.mflash`);
  const statePath = `${outputPath}.state.json`;
  await mkdir(dirname(outputPath), { recursive: true });

  const expected = { stateVersion: STATE_VERSION, subject, level, cardsPerSubtopic, curriculumFingerprint: fingerprint, totalSubtopics: uniqueRows.length } as const;
  const loaded = await loadState(statePath, expected);
  const state: GenerationState = loaded ?? { ...expected, completed: {}, updatedAt: new Date().toISOString() };
  const resumed = Boolean(loaded && Object.keys(loaded.completed).length > 0);
  const alreadyCompleted = uniqueRows.filter(row => Array.isArray(state.completed[rowKey(row)]) && state.completed[rowKey(row)].length === cardsPerSubtopic).length;

  console.log(`[level-mflash] FASE 1 concluída: ${uniqueRows.length} subtópicos válidos encontrados na grade ${subject}/${level}.`);
  console.log(`[level-mflash] FASE 2: ${cardsPerSubtopic} cards por subtópico; checkpoint ${resumed ? 'retomado' : 'novo'}.`);
  if (alreadyCompleted) console.log(`[level-mflash] Retomando: ${alreadyCompleted}/${uniqueRows.length} subtópicos já concluídos.`);

  for (let index = 0; index < uniqueRows.length; index++) {
    const row = uniqueRows[index];
    const key = rowKey(row);
    if (Array.isArray(state.completed[key]) && state.completed[key].length === cardsPerSubtopic) {
      console.log(`[level-mflash] ${index + 1}/${uniqueRows.length} — SKIP já concluído: ${row.category} → ${row.topic} → ${row.subtopic}`);
      continue;
    }

    console.log(`[level-mflash] ${index + 1}/${uniqueRows.length} — ${row.category} → ${row.topic} → ${row.subtopic}`);
    const cards = await generateExactly(subject, level, row.topic, row.subtopic, cardsPerSubtopic);
    state.completed[key] = cards;
    await saveState(statePath, state);
    console.log(`[level-mflash] CHECKPOINT salvo: ${cards.length}/${cardsPerSubtopic} cards — ${row.subtopic}`);
  }

  const { packageData, totalCards } = buildPackage(subject, level, uniqueRows, state.completed, cardsPerSubtopic);
  await atomicWrite(outputPath, JSON.stringify(packageData, null, 2));
  await unlink(statePath).catch(() => undefined);

  console.log(`[level-mflash] FASE 3 concluída: arquivo final validado com ${totalCards} cards reais e ${uniqueRows.length} subtópicos.`);
  return { outputPath, package: packageData, totalCards, totalSubtopics: uniqueRows.length, resumed };
}

if (require.main === module) {
  const [, , subjectArg, levelArg, countArg, outputArg] = process.argv;
  if (!subjectArg || !levelArg) usage();
  generateLevelMflash({
    subject: subjectArg,
    educationLevel: levelArg as EducationLevel,
    cardsPerSubtopic: countArg ? Number(countArg) : DEFAULT_CARDS_PER_SUBTOPIC,
    outputDir: outputArg || DEFAULT_OUTPUT_DIR,
  }).then(result => {
    console.log(JSON.stringify({ ok: true, outputPath: result.outputPath, totalSubtopics: result.totalSubtopics, totalCards: result.totalCards, resumed: result.resumed }, null, 2));
  }).catch(error => {
    console.error(`[level-mflash] ERRO: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  });
}
