import { describe, expect, it } from 'vitest';
import { normalizeMflashForImport } from './normalizeMflashForImport';

describe('normalizeMflashForImport', () => {
  it('normalizes a legacy flat level package', () => {
    const result = normalizeMflashForImport({
      format: 'memoriaflash', version: '1.0', contentVersion: '1.0.0', package: 'nivel', level: 'fundamental', subject: 'Português',
      cards: [{ id: 'pt-001', question: 'O que é um substantivo?', answer: 'É uma palavra que nomeia seres, objetos, lugares, sentimentos ou conceitos.', explanation: 'Substantivos dão nome a elementos concretos ou abstratos.', curiosity: 'Nomes próprios são substantivos próprios.', difficulty: 'medium', topic: 'Gramática', subtopic: 'Substantivo' }],
    });
    expect(result.manifest.format).toBe('memoriaflash');
    expect(result.manifest.formatVersion).toBe('1.0');
    expect(result.manifest.package).toBe('nivel');
    expect(result.manifest.contentVersion).toBe('1.0.0');
    expect(result.manifest.levels).toEqual(['fundamental']);
    expect(result.levels[0].id).toBe('fundamental');
    expect(result.levels[0].subjects[0].name).toBe('Português');
    expect(result.levels[0].subjects[0].curricula[0].topics[0].name).toBe('Gramática');
    expect(result.levels[0].subjects[0].curricula[0].topics[0].subtopics[0].cards[0].id).toBe('pt-001');
  });

  it('normalizes the Content Builder levelsData nested format', () => {
    const result = normalizeMflashForImport({
      format: 'memoriaflash', version: '1.0', contentVersion: '1.0.0', package: 'nivel', levels: ['fundamental'],
      levelsData: [{
        id: 'fundamental', name: 'FUNDAMENTAL',
        subjects: [{ id: 'pt', name: 'Português', curricula: [{ id: 'g1', name: 'Gramática', topics: [{ id: 't1', name: 'Morfologia', subtopics: [{ id: 'st1', name: 'Substantivo', cards: [{ id: 'pt-001', question: 'O que é substantivo?', answer: 'Palavra que nomeia seres.', explanation: 'É uma classe gramatical.' }] }] }] }] }],
      }],
    });
    const level = result.levels[0];
    expect(level.id).toBe('fundamental');
    expect(level.subjects).toHaveLength(1);
    expect(level.subjects[0].curricula[0].topics[0].subtopics[0].cards).toHaveLength(1);
    expect(level.subjects[0].curricula[0].topics[0].subtopics[0].cards[0].id).toBe('pt-001');
  });

  it('normalizes a relational levelsData package', () => {
    const result = normalizeMflashForImport({
      format: 'memoriaflash', version: '1.0', contentVersion: '1.0.0', package: 'nivel', levels: ['fundamental'],
      levelsData: [{
        id: 'fundamental', name: 'FUNDAMENTAL',
        subjects: [{ id: 's1', name: 'Português' }],
        curricula: [{ id: 'c1', name: 'Grade Geral', subjectId: 's1' }],
        topics: [{ id: 't1', name: 'Morfologia', curriculumId: 'c1' }],
        subtopics: [{ id: 'st1', name: 'Substantivo', topicId: 't1' }],
        cards: [{ id: 'pt-001', subtopicId: 'st1', question: 'O que é substantivo?', answer: 'Palavra que nomeia seres.' }],
      }],
    });
    const subtopic = result.levels[0].subjects[0].curricula[0].topics[0].subtopics[0];
    expect(subtopic.name).toBe('Substantivo');
    expect(subtopic.cards).toHaveLength(1);
    expect(subtopic.cards[0].id).toBe('pt-001');
  });

  it('preserves flat cards stored directly in levelsData', () => {
    const result = normalizeMflashForImport({
      manifest: { format: 'memoriaflash', formatVersion: '1.0', package: 'nivel', contentVersion: '1.0.0', levels: ['medio'], statistics: { cards: 2 } },
      levelsData: [{
        id: 'medio',
        name: 'MÉDIO',
        subject: 'Português',
        cards: [
          { id: 'pt-001', topic: 'Morfologia', subtopic: 'Substantivo', question: 'O que é substantivo?', answer: 'Palavra que nomeia seres.' },
          { id: 'pt-002', topic: 'Morfologia', subtopic: 'Adjetivo', question: 'O que é adjetivo?', answer: 'Palavra que caracteriza um substantivo.' },
        ],
      }],
    });
    const level = result.levels[0];
    const subtopics = level.subjects[0].curricula[0].topics.flatMap(topic => topic.subtopics);
    expect(subtopics).toHaveLength(2);
    expect(subtopics.reduce((sum, subtopic) => sum + subtopic.cards.length, 0)).toBe(2);
    expect(subtopics.map(subtopic => subtopic.cards[0].id)).toEqual(['pt-001', 'pt-002']);
  });

  it('keeps an already valid level package compatible', () => {
    const result = normalizeMflashForImport({
      manifest: { format: 'memoriaflash', formatVersion: '1.0', package: 'nivel', contentVersion: '1.0.0', language: 'pt-BR', levels: ['fundamental'] },
      levels: [{ id: 'fundamental', name: 'FUNDAMENTAL', subjects: [] }],
    });
    expect(result.manifest.package).toBe('nivel');
    expect(result.manifest.levels).toEqual(['fundamental']);
    expect(result.levels[0].id).toBe('fundamental');
  });
});
