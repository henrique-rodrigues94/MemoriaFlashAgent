import { createHash } from 'crypto';

export type EducationLevel = 'fundamental' | 'medio' | 'faculdade' | 'concurso' | 'tecnico';
export type CardContentType = 'definition' | 'quiz' | 'gap' | 'comparison' | 'applied' | 'review';
export const TTL_DAYS = { SUBJECT_LEVELS: 90, CURRICULUM: 90, CARD_BUCKET: 60, AI_CACHE: 30 } as const;

export function normalizeText(text: string): string {
  return (text || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^\w\s-]/g, '').replace(/\s+/g, ' ').trim();
}
export function slugify(text: string): string { return normalizeText(text).replace(/\s+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, ''); }
export function shortHash(text: string, len = 16): string { return createHash('sha1').update(text).digest('hex').slice(0, len); }
export function sha256Hash(text: string, len = 32): string { return createHash('sha256').update(text).digest('hex').slice(0, len); }
export function subjectId(subject: string): string { return shortHash(normalizeText(subject)); }
export function curriculumId(subject: string, level: EducationLevel): string { return shortHash(`${normalizeText(subject)}|${level}`); }
export function bucketId(subject: string, topic: string, level: EducationLevel, cardType: CardContentType = 'definition', subtopic = ''): string { return shortHash(`${normalizeText(subject)}|${normalizeText(topic)}|${normalizeText(subtopic)}|${level}|${cardType}`); }
export function contentIndexId(subject: string): string { return slugify(subject) || shortHash(normalizeText(subject)); }
export function contentHash(front: string, back: string, scope = ''): string { return sha256Hash(`${normalizeText(scope)}|${normalizeText(front)}|${normalizeText(back)}`); }

export interface SubjectDoc { subject: string; normalized: string; levels: Array<{ level: EducationLevel; label: string; icon: string; reason: string; priority: number }>; updatedAt: string; ttlAt: number; providerUsed: string; version?: number; totalCurricula?: number; totalTopics?: number; totalSubtopics?: number; totalCards?: number; }
export interface CurriculumTopic { topic: string; subtopics: string[]; }
export interface CurriculumDoc { subject: string; level: EducationLevel; categories: Array<{ category: string; topics: string[] }>; topicTree?: CurriculumTopic[]; topicCount?: number; subtopicCount?: number; totalTopics: number; totalSubtopics?: number; totalCards?: number; version?: number; contentVersion?: string; updatedAt: string; ttlAt: number; providerUsed: string; }
export interface BankCard { id: string; front: string; back: string; explanation: string; topic: string; subtopic?: string; difficulty: string; contentHash?: string; version?: number; }
export interface CardBucketDoc { subject: string; topic: string; subtopic?: string; level: EducationLevel; cardType: CardContentType; cards: BankCard[]; cardCount: number; version?: number; qualityScore?: number; reviewVersion?: number; lastReviewedAt?: string; updatedAt: string; ttlAt: number; providerUsed: string; }

export type FeedbackRating = 'positive' | 'negative';
export type FeedbackReason = 'confusing_question' | 'wrong_answer' | 'bad_explanation' | 'too_easy' | 'too_hard' | 'duplicate_content' | 'outdated_content' | 'other';
export interface CardFeedbackDoc { cardId: string; bucketId: string; subject: string; topic: string; subtopic?: string; level: EducationLevel; cardType: CardContentType; difficulty: string; rating: FeedbackRating; reason?: FeedbackReason; comment?: string; createdAt: string; }
export interface ContentIndexDoc { subjectId: string; subject: string; normalized: string; aliases: string[]; status: 'pending' | 'building' | 'ready' | 'error'; version: number; totalTopics: number; totalSubtopics: number; totalCards: number; updatedAt: string; }

export type ContentRequestStatus = 'pending' | 'processing' | 'completed' | 'failed' | 'building' | 'error';
export interface ContentRequestSourceMeta { fileName: string; mimeType: 'application/pdf' | 'text/plain'; totalChars: number; chunkCount: number; createdAt: string; }
export interface ContentRequestDoc {
  subject?: string;
  requestedSubject?: string;
  normalizedSubject?: string;
  subjectId: string;
  educationLevel?: EducationLevel;
  status: ContentRequestStatus;
  priority: number;
  requestCount: number;
  attempts: number;
  createdAt: string;
  requestedAt?: string;
  updatedAt: string;
  requestedBy?: string;
  lastError?: string;
  error?: string;
  source?: ContentRequestSourceMeta;
  progress?: { levels: number; curriculaReady: number; leavesDiscovered: number; cardsGenerated: number };
}
export interface AgentMetricDoc { date: string; runs: number; aiCalls: number; geminiCalls: number; deepseekCalls: number; openaiCalls: number; cardsGenerated: number; tokensInput: number; tokensOutput: number; cacheHits: number; cacheMisses: number; estimatedAiCostUsd: number; duplicates: number; errors: number; updatedAt: string; }

export function makeTtl(days: number): number { return Date.now() + days * 86400000; }
export function isExpired(ttlAt: number | undefined): boolean { return !ttlAt || Date.now() > ttlAt; }
