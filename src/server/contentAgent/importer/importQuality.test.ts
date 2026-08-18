import { describe, expect, it } from 'vitest';
import { analyzeImportQuality } from './importQuality';
import type { MflashPackage } from './completoMflash';

function fixture(): MflashPackage {
  return {
    manifest: { format: 'memoriaflash', formatVersion: '1.0', package: 'completo', contentVersion: '1.0.0', levels: ['fundamental', 'medio', 'faculdade', 'concurso', 'tecnico'] },
    levels: [
      { id: 'fundamental', name: 'FUNDAMENTAL', subjects: [{ id: 'portugues-fundamental', name: 'Português', curricula: [{ id: 'pt', name: 'Grade', topics: [{ id: 'gram', name: 'Gramática', subtopics: [{ id: 'sub', name: 'Substantivo', cards: [{ id: '1', question: 'O que é substantivo?', answer: 'É uma palavra que nomeia seres.' }, { id: '2', question: 'O que é substantivo?', answer: 'É uma palavra que nomeia seres.' }] }, { id: 'empty', name: 'Subtópico vazio', cards: [] }] }] }] },
      { id: 'medio', name: 'MÉDIO', subjects: [] },
      { id: 'faculdade', name: 'FACULDADE', subjects: [] },
      { id: 'concurso', name: 'CONCURSO', subjects: [] },
      { id: 'tecnico', name: 'TÉCNICO', subjects: [] },
    ],
  };
}

describe('analyzeImportQuality', () => {
  it('detecta cobertura, subtópicos vazios e duplicados exatos', () => {
    const report = analyzeImportQuality(fixture());
    expect(report.totalTopics).toBe(1);
    expect(report.totalSubtopics).toBe(2);
    expect(report.subtopicsWithoutCards).toHaveLength(1);
    expect(report.exactDuplicateCards).toBe(1);
    expect(report.levelCoverage.fundamental.cards).toBe(2);
  });
});
