import fs from 'fs/promises';
import { validateMflashPackage } from './completoMflash';
import { parseMflash } from './parseMflashXml';

async function main() {
  const file = process.argv[2];
  if (!file) {
    console.error('Uso: npm run content:validate -- caminho/completo.mflash');
    process.exit(2);
  }
  const raw = await fs.readFile(file, 'utf8');
  try {
    const parsed = parseMflash(raw);
    const result = validateMflashPackage(parsed.package);
    const errors = result.issues.filter(x => x.severity === 'error');
    const warnings = result.issues.filter(x => x.severity === 'warning');
    console.log(JSON.stringify({ valid: errors.length === 0, format: parsed.format, errors: errors.length, warnings: warnings.length, issues: result.issues }, null, 2));
    process.exit(errors.length ? 1 : 0);
  } catch (err: any) {
    console.error(JSON.stringify({ valid: false, errors: 1, warnings: 0, issues: [{ severity: 'error', code: 'MFLASH_PARSE_ERROR', path: '$', message: err?.message || String(err) }] }, null, 2));
    process.exit(1);
  }
}

main().catch(err => { console.error(err?.message || String(err)); process.exit(1); });
