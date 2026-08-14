import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../feedback/adaptationRepository', () => ({
  loadAdaptations: vi.fn(),
  clearReviewFlag: vi.fn(),
}));
vi.mock('../feedback/feedbackRepository', () => ({
  queryFeedback: vi.fn(),
}));
vi.mock('./cardBucketRepository', () => ({
  loadBucket: vi.fn(),
  removeCardsFromBucket: vi.fn(),
}));

import { loadAdaptations, clearReviewFlag } from '../feedback/adaptationRepository';
import { queryFeedback } from '../feedback/feedbackRepository';
import { loadBucket, removeCardsFromBucket } from './cardBucketRepository';
import { reviewFlaggedTopics } from './cardQualityReviewer';
import { RunTracker } from '../monitoring/runLogger';
import type { CardFeedbackDoc } from '../../db/firestoreSchema';

function mkFeedback(cardId: string, rating: 'positive' | 'negative'): CardFeedbackDoc {
  return {
    cardId, bucketId: 'b1', subject: 'Português', topic: 'Regência',
    level: 'medio', cardType: 'definition', difficulty: 'medium',
    rating, createdAt: new Date().toISOString(),
  };
}

describe('reviewFlaggedTopics', () => {
  beforeEach(() => vi.resetAllMocks());

  it('não faz nada quando não há tópicos flagados', async () => {
    (loadAdaptations as any).mockResolvedValue({
      subject: 'Português', level: 'medio', topics: {}, updatedAt: '',
    });
    const tracker = new RunTracker();
    const outcome = await reviewFlaggedTopics('Português', 'medio', tracker);
    expect(outcome).toEqual({ topicsReviewed: 0, cardsRemoved: 0 });
    expect(queryFeedback).not.toHaveBeenCalled();
  });

  it('não remove cards sem evidência individual suficiente (mesmo com tópico flagado)', async () => {
    (loadAdaptations as any).mockResolvedValue({
      subject: 'Português', level: 'medio',
      topics: { 'Regência::definition': { topic: 'Regência', cardType: 'definition', difficultyStepOffset: 0, flaggedForReview: true, basedOnFeedbackCount: 25, updatedAt: '' } },
      updatedAt: '',
    });
    // Feedback espalhado entre muitos cards diferentes — nenhum cruza o
    // limiar por card (default: 5 avaliações mínimas por card)
    (queryFeedback as any).mockResolvedValue([
      mkFeedback('card-1', 'negative'),
      mkFeedback('card-2', 'negative'),
      mkFeedback('card-3', 'negative'),
    ]);

    const tracker = new RunTracker();
    const outcome = await reviewFlaggedTopics('Português', 'medio', tracker);

    expect(outcome.cardsRemoved).toBe(0);
    expect(removeCardsFromBucket).not.toHaveBeenCalled();
    // Flag mantido para reavaliar depois — clearReviewFlag não deve ser chamado
    expect(clearReviewFlag).not.toHaveBeenCalled();
  });

  it('remove cards com evidência própria suficiente e limpa o flag', async () => {
    (loadAdaptations as any).mockResolvedValue({
      subject: 'Português', level: 'medio',
      topics: { 'Regência::definition': { topic: 'Regência', cardType: 'definition', difficultyStepOffset: 0, flaggedForReview: true, basedOnFeedbackCount: 25, updatedAt: '' } },
      updatedAt: '',
    });
    const badCardFeedback = Array.from({ length: 6 }, () => mkFeedback('card-ruim', 'negative'));
    (queryFeedback as any).mockResolvedValue(badCardFeedback);
    (loadBucket as any).mockResolvedValue({ subject: 'Português', topic: 'Regência', level: 'medio', cardType: 'definition', cards: [], cardCount: 10, updatedAt: '', ttlAt: 0, providerUsed: 'gemini' });
    (removeCardsFromBucket as any).mockResolvedValue({ removed: 1 });

    const tracker = new RunTracker();
    const outcome = await reviewFlaggedTopics('Português', 'medio', tracker);

    expect(removeCardsFromBucket).toHaveBeenCalledWith(
      'Português', 'Regência', 'medio', 'definition', ['card-ruim'], expect.any(Number),
    );
    expect(outcome.cardsRemoved).toBe(1);
    expect(outcome.topicsReviewed).toBe(1);
    expect(clearReviewFlag).toHaveBeenCalledWith('Português', 'medio', 'Regência', 'definition');
  });

  it('respeita maxCardsReviewedPerTopic mesmo com mais cards ruins disponíveis', async () => {
    (loadAdaptations as any).mockResolvedValue({
      subject: 'Português', level: 'medio',
      topics: { 'Regência::definition': { topic: 'Regência', cardType: 'definition', difficultyStepOffset: 0, flaggedForReview: true, basedOnFeedbackCount: 25, updatedAt: '' } },
      updatedAt: '',
    });
    // 10 cards diferentes, cada um com 5 avaliações negativas (todos cruzam o limiar)
    const feedback: CardFeedbackDoc[] = [];
    for (let i = 0; i < 10; i++) {
      for (let j = 0; j < 5; j++) feedback.push(mkFeedback(`card-${i}`, 'negative'));
    }
    (queryFeedback as any).mockResolvedValue(feedback);
    (loadBucket as any).mockResolvedValue({ subject: 'Português', topic: 'Regência', level: 'medio', cardType: 'definition', cards: [], cardCount: 20, updatedAt: '', ttlAt: 0, providerUsed: 'gemini' });
    (removeCardsFromBucket as any).mockResolvedValue({ removed: 5 }); // default maxCardsReviewedPerTopic = 5

    const tracker = new RunTracker();
    await reviewFlaggedTopics('Português', 'medio', tracker);

    const calledWith = (removeCardsFromBucket as any).mock.calls[0];
    const idsPassed: string[] = calledWith[4];
    expect(idsPassed.length).toBeLessThanOrEqual(5);
  });
});
