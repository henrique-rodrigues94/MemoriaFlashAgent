import { describe, expect, it } from 'vitest';
import { normalizeRootCardsIntoHierarchy } from './normalizeRootCards';
import type { MflashPackage } from './completoMflash';

const basePackage = (): MflashPackage => ({
  manifest: {
    format: 'memoriaflash', formatVersion: '1.0', package: 'nivel', contentVersion: '1.0.0', language: 'pt-BR', levels: ['fundamental'],
  },
  levels: [{ id: 'fundamental', name: 'Fundamental', subjects: [{ id: 'portugues', name: 'Português', curricula: [{ id: 'grade-1', name: 'Grade', topics: [{ id: 'gramatica', name: 'Gramática', subtopics: [{ id: 'substantivo', name: 'Substantivo', cards: [] }] }] }] }] }],
});

describe('normalizeRootCardsIntoHierarchy', () => {
  it('distributes root cards into the matching subtopic', () => {
    const pkg = basePackage();
    const result = normalizeRootCardsIntoHierarchy(pkg, {
      cards: [{ id: 'pt-001', level: 'fundamental', subject: 'Português', curriculum: 'Grade', topic: 'Gramática', subtopic: 'Substantivo', front: 'O que é substantivo?', back: 'Palavra que nomeia.' }],
    });
    expect(result.injectedCards).toBe(1);
    expect(result.unresolvedCards).toBe(0);
    expect(pkg.levels[0].subjects[0].curricula[0].topics[0].subtopics[0].cards).toHaveLength(1);
  });

  it('blocks inconsistent root and hierarchy counts', () => {
    const pkg = basePackage();
    pkg.levels[0].subjects[0].curricula[0].topics[0].subtopics[0].cards.push({ id: 'pt-001', question: 'Pergunta', answer: 'Resposta' });
    const result = normalizeRootCardsIntoHierarchy(pkg, { cards: [] });
    expect(result.consistencyError).toBeUndefined();

    const mismatch = normalizeRootCardsIntoHierarchy(pkg, { cards: [{ id: 'pt-001' }, { id: 'pt-002' }] });
    expect(mismatch.consistencyError).toContain('possui 2');
  });
});
