import 'dotenv/config';
import fs from 'fs/promises';
import path from 'path';
import { stageImport, publishStagedImport } from './completoMflash';

async function main() {
  const suppliedPath = process.env.CONTENT_IMPORT_MFLASH_PATH || process.argv[2];
  if (!suppliedPath) throw new Error('CONTENT_IMPORT_MFLASH_PATH é obrigatório no CI. Informe o caminho de um arquivo .mflash versionado no repositório.');

  const file = path.resolve(suppliedPath);
  const stat = await fs.stat(file).catch(() => null);
  if (!stat?.isFile() || !file.toLowerCase().endsWith('.mflash')) {
    throw new Error(`Arquivo .mflash não encontrado: ${file}`);
  }

  const raw = await fs.readFile(file, 'utf8');
  console.log(`=== MEMORIAFLASH — ALIMENTADOR CI ===\nArquivo: ${file}`);
  console.log('[1/3] Validando e colocando em staging...');

  const staged = await stageImport(raw);
  console.table({
    tipo: staged.plan.manifest.package,
    niveis: staged.plan.stats.levels,
    materias: staged.plan.stats.subjects,
    grades: staged.plan.stats.curricula,
    topicos: staged.plan.stats.topics,
    subtopicos: staged.plan.stats.subtopics,
    cards: staged.plan.stats.cards,
    novos: staged.plan.stats.newCards,
    existentes: staged.plan.stats.existingCards,
    atualizacoes: staged.plan.stats.updatedCards,
    conflitos: staged.plan.stats.conflicts,
    usoAtualPercentual: staged.storage.currentPercent,
    usoDepoisPercentual: staged.storage.afterPercent,
    jobId: staged.jobId,
  });

  const errors = staged.plan.issues.filter(issue => issue.severity === 'error');
  if (errors.length) {
    errors.forEach(issue => console.error(`- ${issue.code}: ${issue.message}`));
    throw new Error(`Importação bloqueada por ${errors.length} erro(s). Job de staging: ${staged.jobId}`);
  }

  const autoPublish = String(process.env.CONTENT_IMPORT_AUTO_PUBLISH || 'false').toLowerCase() === 'true';
  if (!autoPublish) {
    console.log(`\nStaging concluído. Job: ${staged.jobId}`);
    console.log('Publicação não executada. Para publicar no CI, defina CONTENT_IMPORT_AUTO_PUBLISH=true.');
    return;
  }

  console.log('[2/3] Publicando no Firebase...');
  const published = await publishStagedImport(staged.jobId);
  console.log('[3/3] Publicação concluída e pós-validação executada.');
  console.log(`Job: ${published.jobId}`);
  console.log(`Cards: ${published.stats.cards} | Novos: ${published.stats.newCards} | Existentes: ${published.stats.existingCards} | Atualizados: ${published.stats.updatedCards}`);
}

main().catch(error => {
  console.error(`\n[alimentador-ci] ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
