import 'dotenv/config';
import fs from 'fs/promises';
import path from 'path';
import { stageImport, publishStagedImport } from './completoMflash';
import { normalizeMflashForImport } from './normalizeMflashForImport';
import { normalizeRootCardsIntoHierarchy } from './normalizeRootCards';

const DEFAULT_PACKAGE_DIR = path.resolve(process.env.CONTENT_PACKAGES_DIR || path.join(process.cwd(), 'content-packages'));

function resolvePackageFile(input: string): string {
  const supplied = input.trim();
  const looksLikeRepositoryPath = supplied.replace(/\\/g, '/').toLowerCase().startsWith('content-packages/');
  const fileName = looksLikeRepositoryPath ? supplied.replace(/\\/g, '/').slice('content-packages/'.length) : supplied;
  if (!fileName || path.basename(fileName) !== fileName || fileName.includes('..') || !fileName.toLowerCase().endsWith('.mflash')) {
    throw new Error('Informe somente o nome de um arquivo .mflash da pasta content-packages/, por exemplo: Portugues_Fundamental.mflash');
  }
  return path.join(DEFAULT_PACKAGE_DIR, fileName);
}

async function main() {
  const suppliedPath = process.env.CONTENT_IMPORT_MFLASH_PATH || process.argv[2];
  if (!suppliedPath) throw new Error('Informe o nome do arquivo .mflash. A pasta content-packages/ é incluída automaticamente.');
  const file = resolvePackageFile(suppliedPath);
  const stat = await fs.stat(file).catch(() => null);
  if (!stat?.isFile()) {
    const available = await fs.readdir(DEFAULT_PACKAGE_DIR, { withFileTypes: true }).catch(() => []);
    const packages = available.filter(entry => entry.isFile() && entry.name.toLowerCase().endsWith('.mflash')).map(entry => entry.name).sort();
    const hint = packages.length ? ` Arquivos disponíveis: ${packages.join(', ')}` : ' Nenhum .mflash foi encontrado em content-packages/.';
    throw new Error(`Arquivo .mflash não encontrado em content-packages/: ${path.basename(file)}.${hint}`);
  }

  const raw = await fs.readFile(file, 'utf8');
  console.log(`=== MEMORIAFLASH — ALIMENTADOR CI ===\nPasta padrão: ${DEFAULT_PACKAGE_DIR}\nArquivo selecionado: ${path.basename(file)}`);
  console.log('[0/3] Normalizando formato .mflash...');

  let normalizedRaw: string;
  try {
    const parsed = JSON.parse(raw);
    const normalized = normalizeMflashForImport(parsed);
    const rootCardCheck = normalizeRootCardsIntoHierarchy(normalized, parsed);
    if (rootCardCheck.consistencyError) throw new Error(rootCardCheck.consistencyError);
    if (rootCardCheck.rootCards > 0) console.log(`Cards na raiz: ${rootCardCheck.rootCards} | injetados na hierarquia: ${rootCardCheck.injectedCards} | não associados: ${rootCardCheck.unresolvedCards}`);
    normalizedRaw = JSON.stringify(rootCardCheck.package);
    console.log(`Formato normalizado: ${normalized.manifest.package} | níveis: ${normalized.manifest.levels.join(', ')}`);
  } catch (error) {
    throw new Error(`Falha ao normalizar o .mflash: ${error instanceof Error ? error.message : String(error)}`);
  }

  console.log('[1/3] Validando e colocando em staging...');
  const staged = await stageImport(normalizedRaw);
  console.table({ tipo: staged.plan.manifest.package, niveis: staged.plan.stats.levels, materias: staged.plan.stats.subjects, grades: staged.plan.stats.curricula, topicos: staged.plan.stats.topics, subtopicos: staged.plan.stats.subtopics, cards: staged.plan.stats.cards, novos: staged.plan.stats.newCards, existentes: staged.plan.stats.existingCards, atualizacoes: staged.plan.stats.updatedCards, conflitos: staged.plan.stats.conflicts, usoAtualPercentual: staged.storage.currentPercent, usoDepoisPercentual: staged.storage.afterPercent, jobId: staged.jobId });
  const errors = staged.plan.issues.filter(issue => issue.severity === 'error');
  if (errors.length) { errors.forEach(issue => console.error(`- ${issue.code}: ${issue.message}`)); throw new Error(`Importação bloqueada por ${errors.length} erro(s). Job de staging: ${staged.jobId}`); }

  const autoPublish = String(process.env.CONTENT_IMPORT_AUTO_PUBLISH || 'false').toLowerCase() === 'true';
  if (!autoPublish) { console.log(`\nStaging concluído. Job: ${staged.jobId}`); console.log('Publicação não executada. Para publicar no CI, defina CONTENT_IMPORT_AUTO_PUBLISH=true.'); return; }
  console.log('[2/3] Publicando no Firebase...');
  const published = await publishStagedImport(staged.jobId);
  console.log('[3/3] Publicação concluída e pós-validação executada.');
  console.log(`Job: ${published.jobId}`);
  console.log(`Cards: ${published.stats.cards} | Novos: ${published.stats.newCards} | Existentes: ${published.stats.existingCards} | Atualizados: ${published.stats.updatedCards}`);
}

main().catch(error => { console.error(`\n[alimentador-ci] ${error instanceof Error ? error.message : String(error)}`); process.exit(1); });
