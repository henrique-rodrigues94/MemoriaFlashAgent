import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../db/db', () => ({
  getCurriculum: vi.fn(),
  getBucketStats: vi.fn(),
}));

import { getCurriculum, getBucketStats } from '../../db/db';
import { analyzeSubjectLevel } from './topicAnalyzer';

describe('analyzeSubjectLevel', () => {
  beforeEach(() => vi.resetAllMocks());

  it('retorna vazio quando não há currículo salvo', async () => {
    (getCurriculum as any).mockResolvedValue(null);
    const needs = await analyzeSubjectLevel('Biologia', 'medio');
    expect(needs).toEqual([]);
  });

  it('prioriza tópicos sem nenhum card (P2) antes de abaixo-do-mínimo (P3)', async () => {
    (getCurriculum as any).mockResolvedValue({
      data: { categories: [{ category: 'Citologia', topics: ['Mitocôndria', 'Núcleo'] }] },
    });
    (getBucketStats as any).mockResolvedValue([
      { topic: 'Mitocôndria', cardCount: 5, stale: false, bucketId: 'a' },  // abaixo do mínimo (20)
      { topic: 'Núcleo', cardCount: 0, stale: true, bucketId: 'b' },        // sem conteúdo
    ]);

    const needs = await analyzeSubjectLevel('Biologia', 'medio');

    // agentConfig.activeCardTypes tem 2 tipos ('definition','quiz') por
    // padrão, então cada tópico aparece uma vez por tipo — o que importa é
    // que TODO item P2 vem antes de qualquer item P3 na ordenação final.
    const firstP3Index = needs.findIndex(n => n.priority === 'P3_BELOW_MINIMUM');
    const lastP2Index = needs.reduce((last, n, i) => (n.priority === 'P2_NO_CONTENT' ? i : last), -1);
    expect(lastP2Index).toBeLessThan(firstP3Index);
    expect(needs.every(n => n.topic === 'Núcleo' || n.topic === 'Mitocôndria')).toBe(true);
  });

  it('não gera necessidade quando já atingiu o target e não está stale', async () => {
    (getCurriculum as any).mockResolvedValue({
      data: { categories: [{ category: 'Citologia', topics: ['Mitocôndria'] }] },
    });
    (getBucketStats as any).mockResolvedValue([
      { topic: 'Mitocôndria', cardCount: 60, stale: false, bucketId: 'a' }, // == targetCards padrão
    ]);

    const needs = await analyzeSubjectLevel('Biologia', 'medio');
    expect(needs).toEqual([]);
  });
});
