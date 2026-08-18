import { describe, expect, it } from 'vitest';
import { OFFICIAL_LEVELS, validateMflashPackage } from './completoMflash';

const makePackage = () => ({
  manifest: {
    format: 'memoriaflash',
    formatVersion: '1.0',
    package: 'completo',
    contentVersion: '1.0.0',
    language: 'pt-BR',
    levels: [...OFFICIAL_LEVELS],
    statistics: { cards: 5 },
  },
  levels: OFFICIAL_LEVELS.map(level => ({
    id: level,
    name: level.toUpperCase(),
    subjects: [{
      id: `subject-${level}`,
      name: 'Português',
      curricula: [{
        id: `curriculum-${level}`,
        name: 'Grade completa',
        topics: [{
          id: `topic-${level}`,
          name: 'Gramática',
          subtopics: [{
            id: `subtopic-${level}`,
            name: 'Substantivo',
            cards: [{
              id: `card-${level}`,
              question: 'O que é um substantivo?',
              answer: 'É a palavra que nomeia seres, objetos, lugares, sentimentos e conceitos.',
              explanation: 'A classificação é feita conforme a função de nomear.',
              curiosity: 'Nomes próprios são uma categoria de substantivos.',
              difficulty: 'medium',
            }],
          }],
        }],
      }],
    }],
  })),
});

describe('completo.mflash', () => {
  it('aceita exatamente os cinco níveis oficiais', () => {
    const result = validateMflashPackage(makePackage());
    expect(result.package).toBeTruthy();
    expect(result.issues.filter(x => x.severity === 'error')).toHaveLength(0);
  });

  it('bloqueia pacote sem um nível oficial', () => {
    const pkg = makePackage();
    pkg.levels = pkg.levels.filter(x => x.id !== 'concurso');
    pkg.manifest.levels = pkg.manifest.levels.filter(x => x !== 'concurso');
    const result = validateMflashPackage(pkg);
    expect(result.issues.some(x => x.code === 'LEVEL_MISSING')).toBe(true);
  });

  it('bloqueia nível inventado', () => {
    const pkg = makePackage();
    pkg.levels.push({ id: 'enem' as never, name: 'ENEM', subjects: [] });
    const result = validateMflashPackage(pkg);
    expect(result.issues.some(x => x.code === 'LEVEL_INVALID')).toBe(true);
  });

  it('bloqueia card sem pergunta ou resposta', () => {
    const pkg = makePackage();
    pkg.levels[0].subjects[0].curricula[0].topics[0].subtopics[0].cards[0].answer = '';
    const result = validateMflashPackage(pkg);
    expect(result.issues.some(x => x.code === 'CARD_REQUIRED_FIELD')).toBe(true);
  });

  it('detecta IDs duplicados no pacote', () => {
    const pkg = makePackage();
    pkg.levels[1].subjects[0].curricula[0].topics[0].subtopics[0].cards[0].id = 'card-fundamental';
    const result = validateMflashPackage(pkg);
    expect(result.issues.some(x => x.code === 'CARD_ID_DUPLICATE')).toBe(true);
  });
});
