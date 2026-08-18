import { MflashPackage, OFFICIAL_LEVELS, validateMflashPackage } from './completoMflash';

/**
 * Valida os dois formatos aceitos pelo alimentador:
 * - completo: os cinco níveis oficiais;
 * - nivel: somente um nível, usado por arquivos como Portugues_Fundamental.mflash.
 *
 * O validador legado continua exigindo o pacote completo. Para preservar essa
 * garantia sem duplicar todas as regras, um pacote por nível é validado como
 * um pacote completo temporário, com os demais níveis vazios, e depois o
 * pacote original é devolvido ao chamador.
 */
export function validateAnyMflashPackage(pkg: unknown): { package?: MflashPackage; issues: ReturnType<typeof validateMflashPackage>['issues'] } {
  const root = pkg as any;
  if (!root || typeof root !== 'object') return validateMflashPackage(pkg);

  if (root?.manifest?.package !== 'nivel') return validateMflashPackage(pkg);

  const levelIds = Array.isArray(root.levels) ? root.levels.map((level: any) => level?.id).filter(Boolean) : [];
  if (levelIds.length !== 1 || !OFFICIAL_LEVELS.includes(levelIds[0])) {
    return {
      issues: [{ severity: 'error', code: 'LEVEL_PACKAGE_INVALID', path: 'levels', message: `Pacote por nível deve conter exatamente um nível oficial: ${OFFICIAL_LEVELS.join(', ')}.` }],
    };
  }

  if (!Array.isArray(root.manifest?.levels) || root.manifest.levels.length !== 1 || root.manifest.levels[0] !== levelIds[0]) {
    return {
      issues: [{ severity: 'error', code: 'LEVEL_MANIFEST_INVALID', path: 'manifest.levels', message: 'No pacote por nível, manifest.levels deve declarar exatamente o nível do arquivo.' }],
    };
  }

  const synthetic = {
    ...root,
    manifest: { ...root.manifest, package: 'completo', levels: [...OFFICIAL_LEVELS] },
    levels: OFFICIAL_LEVELS.map(level => level === levelIds[0] ? root.levels[0] : ({ id: level, name: level, subjects: [] })),
  };
  const result = validateMflashPackage(synthetic);
  if (!result.package) return { issues: result.issues };
  return { package: root as MflashPackage, issues: result.issues };
}
