import fs from 'fs/promises';
import { validateMflashPackage } from './completoMflash';

async function main() {
  const file = process.argv[2];
  if (!file) {
    console.error('Uso: npm run content:validate -- caminho/completo.mflash');
    process.exit(2);
  }
  const raw = await fs.readFile(file, 'utf8');
  let parsed: unknown;
  try { parsed = JSON.parse(raw); } catch (err: any) { console.error(`JSON inválido: ${err?.message || String(err)}`); process.exit(1); }
  const result = validateMflashPackage(parsed);
  const errors = result.issues.filter(x => x.severity === 'error');
  const warnings = result.issues.filter(x => x.severity === 'warning');
  console.log(JSON.stringify({ valid: errors.length === 0, errors: errors.length, warnings: warnings.length, issues: result.issues }, null, 2));
  process.exit(errors.length ? 1 : 0);
}

main().catch(err => { console.error(err?.message || String(err)); process.exit(1); });
