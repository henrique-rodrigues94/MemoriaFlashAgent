import { MflashPackage, MflashCardInput } from './completoMflash';

type AnyRecord = Record<string, any>;
function text(value: unknown): string { return typeof value === 'string' ? value.trim() : ''; }
function slug(value: unknown): string { return text(value).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, ''); }
function cardValue(card: AnyRecord, ...keys: string[]): string { for (const key of keys) { const value = text(card?.[key]); if (value) return value; } return ''; }
function cardId(card: AnyRecord): string { return cardValue(card, 'id', 'cardId', 'codigo', 'code'); }
function hierarchyValue(card: AnyRecord, kind: string): string {
  const aliases: Record<string, string[]> = { level: ['level', 'nivel', 'educationLevel'], subject: ['subject', 'materia', 'matéria', 'subjectName'], curriculum: ['curriculum', 'curriculo', 'currículo', 'grade', 'curriculumName', 'gradeName'], topic: ['topic', 'topico', 'tópico', 'topicName'], subtopic: ['subtopic', 'subtopico', 'subtópico', 'subtopicName'] };
  return cardValue(card, ...(aliases[kind] || []));
}
function normalizeCard(card: AnyRecord): MflashCardInput { return { id: cardValue(card, 'id', 'cardId', 'codigo', 'code') || undefined, question: cardValue(card, 'question', 'pergunta', 'front') || undefined, answer: cardValue(card, 'answer', 'resposta', 'back') || undefined, explanation: cardValue(card, 'explanation', 'explicacao', 'explicação') || undefined, curiosity: cardValue(card, 'curiosity', 'curiosidade') || undefined, difficulty: cardValue(card, 'difficulty', 'dificuldade') || undefined, tags: Array.isArray(card?.tags) ? card.tags : undefined, source: card?.source }; }
function sameCard(a: MflashCardInput, b: MflashCardInput): boolean { const aid = text(a.id); const bid = text(b.id); if (aid && bid && aid === bid) return true; return text(a.question || a.front) === text(b.question || b.front) && text(a.answer || a.back) === text(b.answer || b.back); }
function findLevel(pkg: MflashPackage, card: AnyRecord): any | undefined { const wanted = slug(hierarchyValue(card, 'level')); return pkg.levels.find(level => slug(level.id) === wanted || slug(level.name) === wanted) || (pkg.levels.length === 1 ? pkg.levels[0] : undefined); }
function findSubject(level: any, card: AnyRecord): any | undefined { const wanted = slug(hierarchyValue(card, 'subject')); return level.subjects.find((x: any) => slug(x.id) === wanted || slug(x.name) === wanted) || (level.subjects.length === 1 ? level.subjects[0] : undefined); }
function findCurriculum(subject: any, card: AnyRecord): any | undefined { const wanted = slug(hierarchyValue(card, 'curriculum')); return subject.curricula.find((x: any) => slug(x.id) === wanted || slug(x.name) === wanted) || (subject.curricula.length === 1 ? subject.curricula[0] : undefined); }
function findTopic(curriculum: any, card: AnyRecord): any | undefined { const wanted = slug(hierarchyValue(card, 'topic')); return curriculum.topics.find((x: any) => slug(x.id) === wanted || slug(x.name) === wanted) || (curriculum.topics.length === 1 ? curriculum.topics[0] : undefined); }
function findSubtopic(topic: any, card: AnyRecord): any | undefined { const wanted = slug(hierarchyValue(card, 'subtopic')); return topic.subtopics.find((x: any) => slug(x.id) === wanted || slug(x.name) === wanted) || (topic.subtopics.length === 1 ? topic.subtopics[0] : undefined); }
function hierarchyCards(pkg: MflashPackage): MflashCardInput[] { const result: MflashCardInput[] = []; for (const level of pkg.levels) for (const subject of level.subjects) for (const curriculum of subject.curricula) for (const topic of curriculum.topics) for (const subtopic of topic.subtopics) result.push(...(Array.isArray(subtopic.cards) ? subtopic.cards : [])); return result; }

export interface RootCardNormalizationResult { package: MflashPackage; rootCards: number; injectedCards: number; unresolvedCards: number; consistencyError?: string; }

/**
 * Compatibilidade com o novo contrato do prompt: cards[] na raiz.
 * Se a hierarquia já contém cards, a raiz é tratada como cópia de integridade.
 * Se a hierarquia não contém cards, cards[] é distribuído pela hierarquia.
 */
export function normalizeRootCardsIntoHierarchy(pkg: MflashPackage, root: AnyRecord): RootCardNormalizationResult {
  const rawCards = Array.isArray(root?.cards) ? root.cards : [];
  if (!rawCards.length) return { package: pkg, rootCards: 0, injectedCards: 0, unresolvedCards: 0 };

  const existing = hierarchyCards(pkg);
  if (existing.length > 0) {
    if (existing.length !== rawCards.length) return { package: pkg, rootCards: rawCards.length, injectedCards: 0, unresolvedCards: 0, consistencyError: `cards[] na raiz possui ${rawCards.length}, mas a hierarquia possui ${existing.length}.` };
    const ids = new Set(existing.map(card => text(card.id)).filter(Boolean));
    const rootIds = rawCards.map(cardId).filter(Boolean);
    if (ids.size && rootIds.length === rawCards.length && rootIds.some(id => !ids.has(id))) return { package: pkg, rootCards: rawCards.length, injectedCards: 0, unresolvedCards: 0, consistencyError: 'cards[] da raiz não corresponde aos IDs dos cards da hierarquia.' };
    return { package: pkg, rootCards: rawCards.length, injectedCards: 0, unresolvedCards: 0 };
  }

  let injectedCards = 0; let unresolvedCards = 0;
  for (const raw of rawCards) {
    const level = findLevel(pkg, raw); const subject = level && findSubject(level, raw); const curriculum = subject && findCurriculum(subject, raw); const topic = curriculum && findTopic(curriculum, raw); const subtopic = topic && findSubtopic(topic, raw);
    if (!subtopic) { unresolvedCards++; continue; }
    const normalized = normalizeCard(raw);
    if (!subtopic.cards.some(existingCard => sameCard(existingCard, normalized))) { subtopic.cards.push(normalized); injectedCards++; }
  }
  return { package: pkg, rootCards: rawCards.length, injectedCards, unresolvedCards, consistencyError: unresolvedCards ? `${unresolvedCards} card(s) da lista raiz não puderam ser associados à hierarquia.` : undefined };
}
