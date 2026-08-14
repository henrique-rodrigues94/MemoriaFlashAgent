import { describe, it, expect } from 'vitest';
import { aggregateFeedbackByCard } from './feedbackAnalyzer';
import type { CardFeedbackDoc } from '../../db/firestoreSchema';

function mkFeedback(overrides: Partial<CardFeedbackDoc> = {}): CardFeedbackDoc {
  return {
    cardId: 'card-a',
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

describe('aggregateFeedbackByCard', () => {
  it('agrupa corretamente por cardId, não por tópico inteiro', () => {
    const feedback = [
      mkFeedback({ cardId: 'card-a', rating: 'negative' }),
      mkFeedback({ cardId: 'card-a', rating: 'negative' }),
      mkFeedback({ cardId: 'card-b', rating: 'positive' }),
    ];
    const aggs = aggregateFeedbackByCard(feedback);
    expect(aggs).toHaveLength(2);

    const cardA = aggs.find(a => a.cardId === 'card-a')!;
    expect(cardA.total).toBe(2);
    expect(cardA.negativeRate).toBe(1);

    const cardB = aggs.find(a => a.cardId === 'card-b')!;
    expect(cardB.negativeRate).toBe(0);
  });

  it('ordena do pior card (maior negativeRate) para o melhor', () => {
    const feedback = [
      mkFeedback({ cardId: 'good', rating: 'positive' }),
      mkFeedback({ cardId: 'good', rating: 'positive' }),
      mkFeedback({ cardId: 'bad', rating: 'negative' }),
      mkFeedback({ cardId: 'bad', rating: 'negative' }),
    ];
    const [first] = aggregateFeedbackByCard(feedback);
    expect(first.cardId).toBe('bad');
  });

  it('identifica o motivo dominante por card', () => {
    const feedback = [
      mkFeedback({ cardId: 'card-a', rating: 'negative', reason: 'wrong_answer' }),
      mkFeedback({ cardId: 'card-a', rating: 'negative', reason: 'wrong_answer' }),
      mkFeedback({ cardId: 'card-a', rating: 'negative', reason: 'bad_explanation' }),
    ];
    const [agg] = aggregateFeedbackByCard(feedback);
    expect(agg.dominantReason).toBe('wrong_answer');
  });
});
