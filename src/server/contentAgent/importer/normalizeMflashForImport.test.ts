import { describe, expect, it } from 'vitest';
import { normalizeMflashForImport } from './normalizeMflashForImport';

describe('normalizeMflashForImport', () => {
  it('normalizes a legacy flat level package', () => {
    const result = normalizeMflashForImport({
      format: 'memoriaflash',
      version: '1.0',
      contentVersion: '1.0.0',
      package: 'nivel',
      level: 'fundamental',
      subject: 'Português',
      cards: [
        {
          id: 'pt-001',
          question: 'O que é um substantivo?',
          answer: 'É uma palavra que nomeia seres, objetos, lugares, sentimentos ou conceitos.',
          explanation: 'Substantivos dão nome a elementos concretos ou abstratos.',
          curiosity: 'Nomes próprios são substantivos próprios.',
          difficulty: 'medium',
          topic: 'Gramática',
          subtopic: 'Substantivo',
        },
      ],
    });

    expect(result.manifest.format).toBe('memoriaflash');
    expect(result.manifest.formatVersion).toBe('1.0');
    expect(result.manifest.package).toBe('nivel');
    expect(result.manifest.contentVersion).toBe('1.0.0');
    expect(result.manifest.levels).toEqual(['fundamental']);
    expect(result.levels).toHaveLength(1);
    expect(result.levels[0].id).toBe('fundamental');
    expect(result.levels[0].subjects[0].name).toBe('Português');
    expect(result.levels[0].subjects[0].curricula[0].topics[0].name).toBe('Gramática');
    expect(result.levels[0].subjects[0].curricula[0].topics[0].subtopics[0].cards[0].id).toBe('pt-001');
  });

  it('keeps an already valid level package compatible', () => {
    const input = {
      manifest: {
        format: 'memoriaflash',
        formatVersion: '1.0',
        package: 'nivel',
        contentVersion: '1.0.0',
        language: 'pt-BR',
        levels: ['fundamental'],
      },
      levels: [
        {
          id: 'fundamental',
          name: 'FUNDAMENTAL',
          subjects: [],
        },
      ],
    };

    const result = normalizeMflashForImport(input);
    expect(result.manifest.package).toBe('nivel');
    expect(result.manifest.levels).toEqual(['fundamental']);
    expect(result.levels[0].id).toBe('fundamental');
  });
});
