// Execução standalone do Content Agent.
//
// Em produção, CONTENT_AGENT_PRODUCTION_STRICT=true obriga as credenciais
// essenciais e os limites de segurança antes de qualquer escrita no Firebase.
import 'dotenv/config';
import { assertProductionEnvironment } from './productionGate';
import { runContentAgent } from './agent/orchestrator';

try {
  assertProductionEnvironment();
} catch (err) {
  console.error('[agent] Production gate bloqueou a execução:', err);
  process.exit(78);
}

runContentAgent()
  .then(summary => {
    console.log(`[agent] Finalizado com status "${summary.status}".`);
    process.exit(summary.status === 'failed' ? 1 : 0);
  })
  .catch(err => {
    console.error('[agent] Erro fatal:', err);
    process.exit(1);
  });
