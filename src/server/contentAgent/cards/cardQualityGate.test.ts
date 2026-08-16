import { describe, expect, it } from 'vitest';
import { evaluateCard, filterQualityCards } from './cardQualityGate';

describe('card quality gate', () => {
  const source = 'A Constituição Federal de 1988 foi promulgada em 5 de outubro de 1988.';

  it('aprova card fundamentado na fonte', () => {
    const result = evaluateCard({ front: 'Em que data foi promulgada a Constituição Federal de 1988?', back: '5 de outubro de 1988', explanation: 'A data consta na fonte.', topic: 'Constituição Federal' }, source);
    expect(result.approved).toBe(true);
    expect(result.groundingScore).toBeGreaterThan(0.18);
  });

  it('rejeita resposta vazia', () => {
    const result = evaluateCard({ front: 'O que é Constituição Federal?', back: '', topic: 'Constituição Federal' }, source);
    expect(result.approved).toBe(false);
    expect(result.reasons).toContain('resposta vazia');
  });

  it('detecta pergunta duplicada', () => {
    const result = evaluateCard({ front: 'Em que data foi promulgada a Constituição Federal de 1988?', back: '5 de outubro de 1988', topic: 'Constituição Federal' }, source, [{ front: 'Em que data foi promulgada a Constituição Federal de 1988?', back: '5 de outubro de 1988' }]);
    expect(result.duplicateScore).toBeGreaterThanOrEqual(0.85);
    expect(result.approved).toBe(false);
  });

  it('separa aprovados e rejeitados', () => {
    const result = filterQualityCards([
      { front: 'Em que data foi promulgada a Constituição Federal de 1988?', back: '5 de outubro de 1988', topic: 'Constituição Federal' },
      { front: 'X', back: '', topic: 'Constituição Federal' },
    ], source);
    expect(result.approved.length).toBe(1);
    expect(result.rejected.length).toBe(1);
  });
});
