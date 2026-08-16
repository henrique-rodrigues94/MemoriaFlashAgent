import { normalizeText } from '../../db/firestoreSchema';

export interface QualityResult {
  approved: boolean;
  qualityScore: number;
  accuracyScore: number;
  relevanceScore: number;
  groundingScore: number;
  duplicateScore: number;
  reasons: string[];
}

function tokens(text: string): Set<string> {
  return new Set(normalizeText(text).split(/\s+/).filter(t => t.length >= 4));
}

function overlap(a: string, b: string): number {
  const aa = tokens(a); const bb = tokens(b);
  if (!aa.size || !bb.size) return 0;
  let common = 0; for (const t of aa) if (bb.has(t)) common++;
  return common / Math.max(1, Math.min(aa.size, bb.size));
}

export function evaluateCard(card: { front?: string; back?: string; explanation?: string; topic?: string }, sourceContext = '', existingCards: Array<{ front?: string; back?: string }> = []): QualityResult {
  const front = String(card.front || '').trim();
  const back = String(card.back || '').trim();
  const explanation = String(card.explanation || '').trim();
  const reasons: string[] = [];
  if (front.length < 10) reasons.push('pergunta curta demais');
  if (back.length < 2) reasons.push('resposta vazia');
  if (front.length > 500) reasons.push('pergunta excessivamente longa');
  if (back.length > 1800) reasons.push('resposta excessivamente longa');
  if (/^(não sei|n[aã]o informado|unknown|n\/a)$/i.test(back)) reasons.push('resposta não informativa');

  const source = normalizeText(sourceContext);
  const answer = normalizeText(`${front} ${back} ${explanation}`);
  const sourceTokens = tokens(source);
  const answerTokens = tokens(answer);
  let groundingScore = source ? 0 : 0.65;
  if (sourceTokens.size && answerTokens.size) {
    let common = 0; for (const t of answerTokens) if (sourceTokens.has(t)) common++;
    groundingScore = Math.min(1, common / Math.max(6, Math.min(answerTokens.size, 30)));
  }
  if (source && groundingScore < 0.12) reasons.push('baixa evidência textual na fonte');

  let duplicateScore = 0;
  for (const existing of existingCards) duplicateScore = Math.max(duplicateScore, overlap(front, String(existing.front || '')));
  if (duplicateScore >= 0.85) reasons.push('pergunta muito semelhante a card existente');

  const relevanceScore = card.topic ? Math.min(1, Math.max(0.25, overlap(`${front} ${back}`, String(card.topic)))) : 0.7;
  const accuracyScore = reasons.includes('resposta vazia') || reasons.includes('resposta não informativa') ? 0.2 : Math.min(1, 0.65 + (back.length >= 8 ? 0.2 : 0) + (explanation ? 0.1 : 0));
  const qualityScore = Math.max(0, Math.min(1, accuracyScore * 0.35 + relevanceScore * 0.2 + groundingScore * 0.35 + (1 - duplicateScore) * 0.1));
  const approved = reasons.length === 0 && qualityScore >= 0.72 && groundingScore >= (source ? 0.18 : 0);
  return { approved, qualityScore, accuracyScore, relevanceScore, groundingScore, duplicateScore, reasons };
}

export function filterQualityCards<T extends { front?: string; back?: string; explanation?: string; topic?: string }>(cards: T[], sourceContext = '', threshold = 0.72): { approved: T[]; rejected: Array<T & { quality: QualityResult }> } {
  const approved: T[] = [];
  const rejected: Array<T & { quality: QualityResult }> = [];
  for (const card of cards) {
    const quality = evaluateCard(card, sourceContext, approved);
    if (quality.approved && quality.qualityScore >= threshold) approved.push(card);
    else rejected.push({ ...card, quality });
  }
  return { approved, rejected };
}
