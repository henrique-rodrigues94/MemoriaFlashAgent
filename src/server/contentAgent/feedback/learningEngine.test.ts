import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('./adaptationRepository', async () => {
  const actual = await vi.importActual<typeof import('./adaptationRepository')>('./adaptationRepository');
  return {
    ...actual,
    loadAdaptations: vi.fn(),
    saveAdaptations: vi.fn(),
  };
});

import { loadAdaptations, saveAdaptations, resolveAdaptedDifficulty } from './adaptationRepository';
import { applyLearning, applyTypeDistributionLearning } from './learningEngine';
import { RunTracker } from '../monitoring/runLogger';
import type { FeedbackAggregate, CardTypeAggregate } from './feedbackAnalyzer';

function mkAggregate(overrides: Partial<FeedbackAggregate> = {}): FeedbackAggregate {
  return {
    subject: 'Português',
    level: 'medio',
    topic: 'Regência',
    cardType: 'definition',
    total: 25,
    positive: 10,
    negative: 15,
    negativeRate: 0.6,
    reasonCounts: {},
    hasSufficientEvidence: true,
    ...overrides,
  };
}

describe('applyLearning', () => {
  beforeEach(() => vi.resetAllMocks());

  it('ignora agregados sem evidência suficiente', async () => {
    (loadAdaptations as any).mockResolvedValue(null);
    const tracker = new RunTracker();
    const changed = await applyLearning('Português', 'medio', [mkAggregate({ hasSufficientEvidence: false })], tracker);
    expect(changed).toBe(0);
    expect(saveAdaptations).not.toHaveBeenCalled();
  });

  it('aumenta dificuldade em +1 quando motivo dominante é "muito fácil"', async () => {
    (loadAdaptations as any).mockResolvedValue(null);
    const tracker = new RunTracker();
    const changed = await applyLearning('Português', 'medio', [mkAggregate({ dominantReason: 'too_easy' })], tracker);

    expect(changed).toBe(1);
    const savedDoc = (saveAdaptations as any).mock.calls[0][0];
    expect(savedDoc.topics['Regência::definition'].difficultyStepOffset).toBe(1);
    expect(savedDoc.topics['Regência::definition'].flaggedForReview).toBe(false);
  });

  it('nunca ultrapassa o offset máximo (±2) mesmo com adaptação prévia extrema', async () => {
    (loadAdaptations as any).mockResolvedValue({
      subject: 'Português', level: 'medio',
      topics: { 'Regência::definition': { topic: 'Regência', cardType: 'definition', difficultyStepOffset: 2, flaggedForReview: false, basedOnFeedbackCount: 20, updatedAt: '' } },
      updatedAt: '',
    });
    const tracker = new RunTracker();
    await applyLearning('Português', 'medio', [mkAggregate({ dominantReason: 'too_easy' })], tracker);

    const savedDoc = (saveAdaptations as any).mock.calls[0][0];
    expect(savedDoc.topics['Regência::definition'].difficultyStepOffset).toBe(2); // clamp, não 3
  });

  it('sinaliza para revisão (não mexe em dificuldade) quando motivo não é dificuldade', async () => {
    (loadAdaptations as any).mockResolvedValue(null);
    const tracker = new RunTracker();
    await applyLearning('Português', 'medio', [mkAggregate({ dominantReason: 'bad_explanation' })], tracker);

    const savedDoc = (saveAdaptations as any).mock.calls[0][0];
    expect(savedDoc.topics['Regência::definition'].difficultyStepOffset).toBe(0);
    expect(savedDoc.topics['Regência::definition'].flaggedForReview).toBe(true);
  });
});

function mkTypeAggregate(overrides: Partial<CardTypeAggregate> = {}): CardTypeAggregate {
  return {
    cardType: 'definition',
    total: 30,
    negative: 10,
    negativeRate: 0.33,
    hasSufficientEvidence: true,
    ...overrides,
  };
}

describe('applyTypeDistributionLearning', () => {
  beforeEach(() => vi.resetAllMocks());

  it('não ajusta com menos de 2 tipos com evidência suficiente', async () => {
    const tracker = new RunTracker();
    const changed = await applyTypeDistributionLearning(
      'Português', 'medio', [mkTypeAggregate({ cardType: 'definition' })], tracker,
    );
    expect(changed).toBe(false);
    expect(saveAdaptations).not.toHaveBeenCalled();
  });

  it('aumenta o peso do tipo com melhor desempenho e reduz o do pior', async () => {
    (loadAdaptations as any).mockResolvedValue(null);
    const tracker = new RunTracker();

    const changed = await applyTypeDistributionLearning('Português', 'medio', [
      mkTypeAggregate({ cardType: 'applied', negativeRate: 0.05 }), // muito bom
      mkTypeAggregate({ cardType: 'gap', negativeRate: 0.60 }),      // muito ruim
    ], tracker);

    expect(changed).toBe(true);
    const savedDoc = (saveAdaptations as any).mock.calls[0][0];
    expect(savedDoc.typeDistribution.applied).toBeGreaterThan(savedDoc.typeDistribution.gap);
  });

  it('a distribuição resultante sempre soma ~100', async () => {
    (loadAdaptations as any).mockResolvedValue(null);
    const tracker = new RunTracker();

    await applyTypeDistributionLearning('Português', 'medio', [
      mkTypeAggregate({ cardType: 'applied', negativeRate: 0.05 }),
      mkTypeAggregate({ cardType: 'gap', negativeRate: 0.60 }),
    ], tracker);

    const savedDoc = (saveAdaptations as any).mock.calls[0][0];
    const total = Object.values(savedDoc.typeDistribution as Record<string, number>)
      .reduce((s: number, v: number) => s + v, 0);
    expect(total).toBeCloseTo(100, 0);
  });

  it('nunca deixa um tipo cair abaixo do peso mínimo mesmo com desempenho péssimo repetido', async () => {
    (loadAdaptations as any).mockResolvedValue({
      subject: 'Português', level: 'medio', topics: {},
      typeDistribution: { gap: 6, applied: 45, definition: 20, quiz: 15, comparison: 9, review: 5 },
      updatedAt: '',
    });
    const tracker = new RunTracker();

    await applyTypeDistributionLearning('Português', 'medio', [
      mkTypeAggregate({ cardType: 'applied', negativeRate: 0.02 }),
      mkTypeAggregate({ cardType: 'gap', negativeRate: 0.90 }),
    ], tracker);

    const savedDoc = (saveAdaptations as any).mock.calls[0][0];
    expect(savedDoc.typeDistribution.gap).toBeGreaterThanOrEqual(4); // ~MIN_TYPE_WEIGHT após renormalização
  });
});

describe('resolveAdaptedDifficulty', () => {
  it('sobe/desce na escada easy→medium→hard→expert conforme o offset', () => {
    expect(resolveAdaptedDifficulty('medium', 1)).toBe('hard');
    expect(resolveAdaptedDifficulty('medium', -1)).toBe('easy');
    expect(resolveAdaptedDifficulty('medium', 0)).toBe('medium');
  });

  it('nunca sai da escada (clampa nas pontas)', () => {
    expect(resolveAdaptedDifficulty('expert', 2)).toBe('expert');
    expect(resolveAdaptedDifficulty('easy', -2)).toBe('easy');
  });

  it('dificuldade fora da escala conhecida não é alterada', () => {
    expect(resolveAdaptedDifficulty('impossivel', 1)).toBe('impossivel');
  });
});
