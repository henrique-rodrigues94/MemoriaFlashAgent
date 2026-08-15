import { describe, expect, it } from 'vitest';
import { flattenCurriculum, hasRealSubtopics, toHierarchy } from './curriculumHierarchy';

describe('curriculumHierarchy', () => {
  it('mantém compatibilidade com currículo antigo', () => {
    const result = toHierarchy({
      categories: [{ category: 'Citologia', topics: ['Mitocôndria', 'Núcleo'] }],
    });

    expect(result.totalTopics).toBe(2);
    expect(result.totalSubtopics).toBe(2);
    expect(result.categories[0].subtopics['Mitocôndria']).toEqual(['Mitocôndria']);
    expect(hasRealSubtopics({ categories: [{ category: 'X', topics: ['Y'] }] })).toBe(false);
  });

  it('achata categoria → tópico → subtópico', () => {
    const result = flattenCurriculum({
      categories: [{
        category: 'Álgebra',
        topics: ['Equações'],
        subtopics: {
          Equações: ['1º grau', '2º grau'],
        },
      }],
    });

    expect(result).toEqual([
      { category: 'Álgebra', topic: 'Equações', subtopic: '1º grau' },
      { category: 'Álgebra', topic: 'Equações', subtopic: '2º grau' },
    ]);
    expect(hasRealSubtopics({
      categories: [{ category: 'Álgebra', topics: ['Equações'], subtopics: { Equações: ['1º grau'] } }],
    })).toBe(true);
  });
});
