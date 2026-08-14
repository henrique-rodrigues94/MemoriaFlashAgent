import { describe, it, expect } from 'vitest';
import { aggregateFeedbackByType } from './feedbackAnalyzer';
import type { CardFeedbackDoc } from '../../db/firestoreSchema';

function mkFeedback(cardType: string, rating: 'positive' | 'negative'): CardFeedbackDoc {
  return {
    cardId: 'c1', bucketId: 'b1', subject: 'Português', topic: 'Regência',
    level: 'medio', cardType: cardType as any, difficulty: 'medium',
    rating, createdAt: new Date().toISOString(),
  };
}

describe('aggregateFeedbackByType', () => {
  it('agrupa por tipo de card cruzando tópicos diferentes', () => {
    const feedback = [
      mkFeedback('definition', 'negative'),
      mkFeedback('definition', 'positive'),
      mkFeedback('quiz', 'positive'),
      mkFeedback('quiz', 'positive'),
    ];
    const aggs = aggregateFeedbackByType(feedback);
    expect(aggs).toHaveLength(2);

    const definition = aggs.find(a => a.cardType === 'definition')!;
    expect(definition.total).toBe(2);
    expect(definition.negativeRate).toBe(0.5);

    const quiz = aggs.find(a => a.cardType === 'quiz')!;
    expect(quiz.negativeRate).toBe(0);
  });

  it('ordena do melhor desempenho (menor negativeRate) para o pior', () => {
    const feedback = [
      ...Array.from({ length: 5 }, () => mkFeedback('gap', 'negative')),
      ...Array.from({ length: 5 }, () => mkFeedback('applied', 'positive')),
    ];
    const [best] = aggregateFeedbackByType(feedback);
    expect(best.cardType).toBe('applied');
  });

  it('sinaliza hasSufficientEvidence só com volume mínimo de dados', () => {
    const feedback = [mkFeedback('definition', 'negative')];
    const [agg] = aggregateFeedbackByType(feedback);
    expect(agg.hasSufficientEvidence).toBe(false); // default minFeedbackCount = 20
  });
});
