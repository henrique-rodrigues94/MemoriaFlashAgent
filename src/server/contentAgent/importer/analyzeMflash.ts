import fs from 'fs';
import { validateMflashPackage } from './completoMflash';
import { analyzeImportQuality } from './importQuality';

const file = process.argv[2];
if (!file) {
  console.error('Uso: npm run content:analyze -- caminho/arquivo.mflash');
  process.exit(2);
}

try {
  const raw = fs.readFileSync(file, 'utf8');
  const parsed = JSON.parse(raw);
  const validation = validateMflashPackage(parsed);
  const quality = validation.package ? analyzeImportQuality(validation.package) : null;
  console.log(JSON.stringify({ validation: validation.issues, quality }, null, 2));
  if (validation.issues.some(issue => issue.severity === 'error')) process.exit(1);
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
