import { MflashPackage, MflashLevelInput, MflashManifest, OFFICIAL_LEVELS } from './completoMflash';

/**
 * Aceita tanto o pacote editorial completo quanto um pacote de um único nível.
 * O formato nivel é normalizado internamente para o formato completo, mantendo
 * somente o nível informado e deixando os demais vazios para reaproveitar o
 * pipeline de validação, staging e publicação já existente.
 */
export function normalizeMflashForImport(input: unknown): MflashPackage {
  const root = input as any;
  const manifest = root?.manifest as MflashManifest | undefined;

  if (manifest?.package !== 'nivel') return root as MflashPackage;

  const levelId = String(manifest.levels?.[0] || root?.levels?.[0]?.id || '').toLowerCase();
  if (!OFFICIAL_LEVELS.includes(levelId as any)) {
    throw new Error(`Pacote por nível inválido. Nível permitido: ${OFFICIAL_LEVELS.join(', ')}.`);
  }

  const sourceLevel = Array.isArray(root.levels)
    ? root.levels.find((level: MflashLevelInput) => level?.id === levelId)
    : undefined;

  if (!sourceLevel) throw new Error(`O pacote declara o nível ${levelId}, mas não contém esse nível em levels.`);

  const emptyLevels: MflashLevelInput[] = OFFICIAL_LEVELS.map(level =>
    level === levelId
      ? sourceLevel
      : { id: level, name: level.toUpperCase(), subjects: [] },
  );

  return {
    manifest: {
      ...manifest,
      package: 'completo',
      levels: [...OFFICIAL_LEVELS],
      generator: {
        ...(manifest.generator || {}),
        normalizedFrom: 'nivel',
        importedLevel: levelId,
      },
    },
    levels: emptyLevels,
  };
}

export function detectMflashPackageType(input: unknown): 'completo' | 'nivel' {
  const type = (input as any)?.manifest?.package;
  if (type === 'nivel') return 'nivel';
  if (type === 'completo') return 'completo';
  throw new Error('Tipo de pacote .mflash inválido. Use package="completo" ou package="nivel".');
}
