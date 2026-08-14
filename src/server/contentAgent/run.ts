// 📁 flashmind-ai/src/server/contentAgent/run.ts
//
// Execução standalone do Content Agent — independente do server.ts principal.
// Uso:
//   npx tsx src/server/contentAgent/run.ts
//
// Pensado para ser chamado por um scheduler externo (Cloud Scheduler, GitHub
// Actions cron, etc.) — ver docs/content-agent-deployment.md.

import 'dotenv/config';
import { runContentAgent } from './agent/orchestrator';

runContentAgent()
  .then(summary => {
    console.log(`[agent] Finalizado com status "${summary.status}".`);
    process.exit(summary.status === 'failed' ? 1 : 0);
  })
  .catch(err => {
    console.error('[agent] Erro fatal:', err);
    process.exit(1);
  });
