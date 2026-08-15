// Compatibilidade: o agente agora gera uma grade hierárquica.
// Matéria/assunto → categoria → tópico → subtópico.
export {
  generateCurriculumHierarchyTask as generateCurriculumTask,
} from './generateCurriculumHierarchy';

export type {
  EducationLevel,
  CurriculumCategory,
} from './generateCurriculumHierarchy';
