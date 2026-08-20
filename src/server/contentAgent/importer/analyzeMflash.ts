import fs from 'fs';
import { validateMflashPackage } from './completoMflash';
import { analyzeImportQuality } from './importQuality';
import { parseMflash } from './parseMflashXml';

const file = process.argv[2];
if (!file) {
  console.error('Uso: npm run content:analyze -- caminho/arquivo.mflash');
  process.exit(2);
}

try {
  const raw = fs.readFileSync(file, 'utf8');
  const parsed = parseMflash(raw);
  const validation = validateMflashPackage(parsed.package);
  const quality = validation.package ? analyzeImportQuality(validation.package) : null;
  console.log(JSON.stringify({ format: parsed.format, validation: validation.issues, quality }, null, 2));
  if (validation.issues.some(issue => issue.severity === 'error')) process.exit(1);
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
