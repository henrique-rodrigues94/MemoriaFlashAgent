import 'dotenv/config';
import { mkdir, writeFile } from 'fs/promises';
import { dirname, join } from 'path';
import { getCurriculum } from '../../db/db';
import { EducationLevel } from './generateFlashcards';
import { generateFlashcardsTask } from './generateFlashcards';
import { MflashPackage, MflashLevelInput, MFLASH_FORMAT, MFLASH_VERSION } from '../../contentAgent/importer/completoMflash';

const OFFICIAL_LEVELS: EducationLevel[] = ['fundamental', 'medio', 'faculdade', 'concurso', 'tecnico'];
const DEFAULT_CARDS_PER_SUBTOPIC = 50;
const DEFAULT_OUTPUT_DIR = './generated-mflash';

function usage(): never {
  console.error('Uso: npm run content:generate-level -- <materia> <nivel> [cardsPorSubtopico] [saida]');
  console.error('Exemplo: npm run content:generate-level -- "Português" fundamental 50 ./generated-mflash');
  process.exit(2);
}

function slug(value: string): string {
  return value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-zA-Z0-9]+/g, '_').replace(/^_+|_+$/g, '');
}

function safeString(value: unknown): string { return typeof value === 'string' ? value.trim() : ''; }

function flattenCurriculum(data: any): Array<{ category: string; topic: string; subtopic: string }> {
  const rows: Array<{ category: string; topic: string; subtopic: string }> = [];
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

async function generateExactly(subject: string, level: EducationLevel, topic: string, subtopic: string, count: number) {
  const cards: any[] = [];
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
    } as any);
    for (const card of result.cards) {
      const front = safeString(card.front);
      if (!front) continue;
      const key = front.toLocaleLowerCase();
      if (existingFronts.some(x => x.toLocaleLowerCase() === key)) continue;
      existingFronts.push(front);
      cards.push({
        front,
        back: safeString(card.back),
        explanation: safeString(card.explanation),
        difficulty: safeString(card.difficulty || 'medium'),
        tags: [subject, level, topic, subtopic],
        curriculumPriority: 5,
        source: { type: 'ai', generator: 'memoriaflash-agent', topic, subtopic, educationLevel: level },
      });
      if (cards.length >= count) break;
    }
  }
  if (cards.length !== count) throw new Error(`Não foi possível gerar exatamente ${count} cards para "${subtopic}". Gerados: ${cards.length}.`);
  return cards;
}

export async function generateLevelMflash(args: { subject: string; educationLevel: EducationLevel; cardsPerSubtopic?: number; outputDir?: string }): Promise<{ outputPath: string; package: MflashPackage; totalCards: number; totalSubtopics: number }> {
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

  const categories = new Map<string, Map<string, Array<{ name: string; cards: any[] }>>>();
  let totalCards = 0;
  for (let index = 0; index < rows.length; index++) {
    const row = rows[index];
    console.log(`[level-mflash] ${index + 1}/${rows.length} — ${row.category} → ${row.topic} → ${row.subtopic}`);
    const cards = await generateExactly(subject, level, row.topic, row.subtopic, cardsPerSubtopic);
    if (!categories.has(row.category)) categories.set(row.category, new Map());
    const topics = categories.get(row.category)!;
    if (!topics.has(row.topic)) topics.set(row.topic, []);
    topics.get(row.topic)!.push({ name: row.subtopic, cards });
    totalCards += cards.length;
    console.log(`[level-mflash] OK: ${cards.length} cards`);
  }

  const levelPackage: MflashLevelInput = {
    id: level,
    name: level,
    subjects: [{
      id: slug(subject),
      name: subject,
      curricula: [{
        id: `${slug(subject)}_${level}`,
        name: `${subject} — ${level}`,
        topics: Array.from(categories.values()).flatMap(topicMap => Array.from(topicMap.entries()).map(([topic, subtopics]) => ({
          id: slug(topic),
          name: topic,
          subtopics: subtopics.map(item => ({ id: slug(item.name), name: item.name, cards: item.cards })),
        }))),
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
      statistics: { levels: 1, subjects: 1, curricula: 1, topics: levelPackage.subjects[0].curricula[0].topics.length, subtopics: rows.length, cards: totalCards, cardsPerSubtopic },
      generator: { name: 'MemoriaFlashAgent', mode: 'level', modelPolicy: 'configured-provider', target: `${subject}_${level}` },
    },
    levels: [levelPackage],
  };

  const outputPath = join(outputDir, `${slug(subject)}_${level}.mflash`);
  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(outputPath, JSON.stringify(packageData, null, 2), 'utf8');
  return { outputPath, package: packageData, totalCards, totalSubtopics: rows.length };
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
    console.log(JSON.stringify({ ok: true, outputPath: result.outputPath, totalSubtopics: result.totalSubtopics, totalCards: result.totalCards }, null, 2));
  }).catch(error => {
    console.error(`[level-mflash] ERRO: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  });
}
