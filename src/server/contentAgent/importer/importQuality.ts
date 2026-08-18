import { createHash } from 'crypto';
import { MflashPackage, OFFICIAL_LEVELS } from './completoMflash';

export interface ImportQualityReport {
  totalTopics: number;
  totalSubtopics: number;
  subtopicsWithoutCards: Array<{ level: string; subject: string; topic: string; subtopic: string }>;
  subtopicsBelowMinimum: Array<{ level: string; subject: string; topic: string; subtopic: string; cards: number; minimum: number }>;
  exactDuplicateCards: number;
  similarDuplicateCandidates: Array<{ first: string; second: string; similarity: number; path: string }>;
  levelCoverage: Record<string, { subjects: number; topics: number; subtopics: number; cards: number }>;
  contentHash: string;
}

const MIN_CARDS_PER_SUBTOPIC = Number(process.env.CONTENT_IMPORT_MIN_CARDS_PER_SUBTOPIC || 1);
const SIMILARITY_THRESHOLD = Number(process.env.CONTENT_IMPORT_SIMILARITY_THRESHOLD || 0.92);
const MAX_SIMILARITY_CANDIDATES = Number(process.env.CONTENT_IMPORT_MAX_SIMILARITY_CANDIDATES || 200);

function normalize(value: string): string {
  return value.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();
}
function tokenSet(value: string): Set<string> { return new Set(normalize(value).split(' ').filter(token => token.length > 2)); }
function similarity(a: string, b: string): number {
  const aa = tokenSet(a); const bb = tokenSet(b);
  if (!aa.size || !bb.size) return 0;
  let intersection = 0; for (const token of aa) if (bb.has(token)) intersection++;
  return intersection / (aa.size + bb.size - intersection);
}

export function analyzeImportQuality(pkg: MflashPackage): ImportQualityReport {
  const levelCoverage: ImportQualityReport['levelCoverage'] = {};
  for (const level of OFFICIAL_LEVELS) levelCoverage[level] = { subjects: 0, topics: 0, subtopics: 0, cards: 0 };
  const without: ImportQualityReport['subtopicsWithoutCards'] = [];
  const below: ImportQualityReport['subtopicsBelowMinimum'] = [];
  const fingerprints = new Map<string, { front: string; path: string }>();
  const candidates: ImportQualityReport['similarDuplicateCandidates'] = [];
  let totalTopics = 0; let totalSubtopics = 0; let exactDuplicateCards = 0;

  for (const level of pkg.levels) {
    const coverage = levelCoverage[level.id]; if (!coverage) continue;
    coverage.subjects += level.subjects.length;
    for (const subject of level.subjects) for (const curriculum of subject.curricula) for (const topic of curriculum.topics) {
      totalTopics++; coverage.topics++;
      for (const subtopic of topic.subtopics) {
        totalSubtopics++; coverage.subtopics++;
        const cards = Array.isArray(subtopic.cards) ? subtopic.cards : [];
        coverage.cards += cards.length;
        if (!cards.length) without.push({ level: level.id, subject: subject.name, topic: topic.name, subtopic: subtopic.name });
        if (cards.length < MIN_CARDS_PER_SUBTOPIC) below.push({ level: level.id, subject: subject.name, topic: topic.name, subtopic: subtopic.name, cards: cards.length, minimum: MIN_CARDS_PER_SUBTOPIC });
        for (const card of cards) {
          const front = String(card.front || card.question || '').trim();
          const back = String(card.back || card.answer || '').trim();
          const fp = normalize(`${front}|${back}|${subject.name}|${topic.name}|${subtopic.name}|${level.id}`);
          const hash = createHash('sha256').update(fp).digest('hex');
          if (fingerprints.has(hash)) { exactDuplicateCards++; continue; }
          const path = `${level.id}/${subject.name}/${topic.name}/${subtopic.name}/${card.id || hash.slice(0, 10)}`;
          if (candidates.length < MAX_SIMILARITY_CANDIDATES) {
            for (const [otherHash, previous] of [...fingerprints.entries()].slice(-80)) {
              const score = similarity(front, previous.front);
              if (score >= SIMILARITY_THRESHOLD) {
                candidates.push({ first: otherHash.slice(0, 12), second: hash.slice(0, 12), similarity: Number(score.toFixed(3)), path: `${previous.path} ↔ ${path}` });
                if (candidates.length >= MAX_SIMILARITY_CANDIDATES) break;
              }
            }
          }
          fingerprints.set(hash, { front, path });
        }
      }
    }
  }
  const contentHash = createHash('sha256').update(JSON.stringify({ levelCoverage, totalTopics, totalSubtopics, exactDuplicateCards })).digest('hex');
  return { totalTopics, totalSubtopics, subtopicsWithoutCards: without, subtopicsBelowMinimum: below, exactDuplicateCards, similarDuplicateCandidates: candidates, levelCoverage, contentHash };
}
