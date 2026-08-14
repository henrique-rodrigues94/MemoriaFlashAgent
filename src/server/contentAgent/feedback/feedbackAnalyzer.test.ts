import { describe, it, expect } from 'vitest';
import { aggregateFeedback } from './feedbackAnalyzer';
import type { CardFeedbackDoc } from '../../db/firestoreSchema';

function mkFeedback(overrides: Partial<CardFeedbackDoc> = {}): CardFeedbackDoc {
  return {
    cardId: 'c1',
    bucketId: 'b1',
    subject: 'Português',
    topic: 'Regência',
    level: 'medio',
    cardType: 'definition',
    difficulty: 'medium',
    rating: 'negative',
    createdAt: new Date().toISOString(),
    ...overrides,
  };
}

describe('aggregateFeedback', () => {
  it('não marca evidência suficiente com poucas avaliações (< minFeedbackCount)', () => {
    const feedback = Array.from({ length: 10 }, () => mkFeedback({ rating: 'negative', reason: 'too_hard' }));
    const [agg] = aggregateFeedback('Português', 'medio', feedback);
    expect(agg.total).toBe(10);
    expect(agg.hasSufficientEvidence).toBe(false); // default minFeedbackCount = 20
  });

  it('marca evidência suficiente quando total/negativas/taxa cruzam os limiares', () => {
    const feedback = [
      ...Array.from({ length: 15 }, () => mkFeedback({ rating: 'negative', reason: 'too_hard' })),
      ...Array.from({ length: 10 }, () => mkFeedback({ rating: 'positive' })),
    ];
    const [agg] = aggregateFeedback('Português', 'medio', feedback);
    expect(agg.total).toBe(25);
    expect(agg.negative).toBe(15);
    expect(agg.negativeRate).toBeCloseTo(0.6);
    expect(agg.hasSufficientEvidence).toBe(true);
    expect(agg.dominantReason).toBe('too_hard');
  });

  it('agrupa separadamente por tópico e por tipo de card', () => {
    const feedback = [
      mkFeedback({ topic: 'Regência', cardType: 'definition' }),
      mkFeedback({ topic: 'Regência', cardType: 'quiz' }),
      mkFeedback({ topic: 'Crase', cardType: 'definition' }),
    ];
    const aggs = aggregateFeedback('Português', 'medio', feedback);
    expect(aggs).toHaveLength(3);
  });

  it('não deixa uma única avaliação negativa virar sinal de problema', () => {
    const feedback = [mkFeedback({ rating: 'negative', reason: 'confusing_question' })];
    const [agg] = aggregateFeedback('Português', 'medio', feedback);
    expect(agg.hasSufficientEvidence).toBe(false);
  });
});
