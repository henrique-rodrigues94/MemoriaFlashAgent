// 📁 flashmind-ai/src/server/contentAgent/rollback.ts
//
// Ferramenta operacional, NÃO chamada pelo orchestrator — para quando o
// CardUpdater removeu cards que, na prática, eram bons (falso positivo do
// feedback agregado). Roda manualmente, isolado do ciclo automático.
//
// Uso:
//   npx tsx src/server/contentAgent/rollback.ts "Português" "Regência" medio definition

import 'dotenv/config';
import { rollbackLastReview } from './cards/cardBucketRepository';
import type { EducationLevel, CardContentType } from '../db/firestoreSchema';

async function main() {
  const [subject, topic, level, cardType] = process.argv.slice(2);

  if (!subject || !topic || !level || !cardType) {
    console.error('Uso: npx tsx src/server/contentAgent/rollback.ts "<matéria>" "<tópico>" <nível> <tipoDeCard>');
    console.error('Exemplo: npx tsx src/server/contentAgent/rollback.ts "Português" "Regência" medio definition');
    process.exit(1);
  }

  console.log(`[rollback] Revertendo última revisão: ${subject} / ${topic} / ${level} / ${cardType}...`);

  const result = await rollbackLastReview(
    subject, topic, level as EducationLevel, cardType as CardContentType,
  );

  if (!result) {
    console.log('[rollback] Nenhum histórico de revisão encontrado para este balde — nada a reverter.');
    process.exit(0);
  }
  if (result.restored === 0) {
    console.log(`[rollback] A revisão v${result.reviewVersion} já havia sido restaurada anteriormente.`);
    process.exit(0);
  }

  console.log(`[rollback] ${result.restored} card(s) restaurado(s) da revisão v${result.reviewVersion}.`);
  process.exit(0);
}

main().catch(err => {
  console.error('[rollback] Erro:', err);
  process.exit(1);
});
