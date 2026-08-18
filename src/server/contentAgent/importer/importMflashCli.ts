import 'dotenv/config';
import fs from 'fs/promises';
import path from 'path';
import readline from 'readline/promises';
import { stdin as input, stdout as output } from 'process';
import { stageImport, publishStagedImport } from './completoMflash';

type Candidate = { file: string; type: 'completo' | 'nivel'; levels: string[]; subject?: string };

function question(rl: readline.Interface, text: string): Promise<string> { return rl.question(text); }

async function discover(directory: string): Promise<Candidate[]> {
  const entries = await fs.readdir(directory, { withFileTypes: true });
  const candidates: Candidate[] = [];
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.toLowerCase().endsWith('.mflash')) continue;
    const file = path.join(directory, entry.name);
    try {
      const parsed = JSON.parse(await fs.readFile(file, 'utf8')) as any;
      const type = parsed?.manifest?.package;
      if (type !== 'completo' && type !== 'nivel') continue;
      candidates.push({ file, type, levels: Array.isArray(parsed?.manifest?.levels) ? parsed.manifest.levels : [], subject: parsed?.manifest?.subject });
    } catch {
      // Arquivo .mflash inválido será reportado se o usuário o selecionar.
      candidates.push({ file, type: 'nivel', levels: [], subject: undefined });
    }
  }
  return candidates.sort((a, b) => a.file.localeCompare(b.file));
}

async function chooseCandidate(rl: readline.Interface, candidates: Candidate[]): Promise<Candidate> {
  if (candidates.length === 0) throw new Error('Nenhum arquivo .mflash encontrado no diretório informado.');
  console.log('\nArquivos .mflash encontrados:');
  candidates.forEach((candidate, index) => console.log(`  [${index + 1}] ${path.basename(candidate.file)} — ${candidate.type === 'nivel' ? `NÍVEL: ${candidate.levels.join(', ')}` : 'COMPLETO'}`));
  const answer = await question(rl, '\nSelecione o arquivo pelo número: ');
  const index = Number(answer) - 1;
  if (!Number.isInteger(index) || !candidates[index]) throw new Error('Seleção inválida.');
  return candidates[index];
}

async function main() {
  const rl = readline.createInterface({ input, output });
  try {
    console.log('=== MEMORIAFLASH — ALIMENTADOR DE CONTEÚDO ===');
    console.log('Aceita pacotes COMPLETO e pacotes POR NÍVEL.');
    console.log('Os arquivos serão validados, analisados, colocados em staging e só depois publicados.');

    const suppliedDirectory = process.argv[2]?.trim();
    const directoryInput = suppliedDirectory || await question(rl, '\nInforme o diretório onde estão os arquivos .mflash: ');
    const directory = path.resolve(directoryInput);
    const stat = await fs.stat(directory).catch(() => null);
    if (!stat?.isDirectory()) throw new Error(`Diretório não encontrado: ${directory}`);

    const candidates = await discover(directory);
    const candidate = await chooseCandidate(rl, candidates);
    console.log(`\nArquivo selecionado: ${candidate.file}`);

    const raw = await fs.readFile(candidate.file, 'utf8');
    console.log('\n[1/3] Validando e preparando staging...');
    const staged = await stageImport(raw);

    console.log('\n[2/3] Resultado da análise:');
    console.table({
      tipo: candidate.type,
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
      console.error('\nIMPORTAÇÃO BLOQUEADA:');
      errors.forEach(issue => console.error(`- ${issue.code}: ${issue.message}`));
      process.exitCode = 1;
      return;
    }

    const confirm = await question(rl, '\nDeseja publicar este pacote no Firebase? [S/n]: ');
    if (confirm.trim().toLowerCase() === 'n') {
      console.log(`Staging mantido. Job: ${staged.jobId}`);
      return;
    }

    console.log('\n[3/3] Publicando no Firebase...');
    const published = await publishStagedImport(staged.jobId);
    console.log(`\nIMPORTAÇÃO CONCLUÍDA. Job: ${published.jobId}`);
    console.log(`Cards processados: ${published.stats.cards}`);
    console.log(`Novos: ${published.stats.newCards} | Existentes: ${published.stats.existingCards} | Atualizados: ${published.stats.updatedCards}`);
  } finally {
    rl.close();
  }
}

main().catch(error => { console.error(`\n[alimentador] ${error?.message || String(error)}`); process.exitCode = 1; });
