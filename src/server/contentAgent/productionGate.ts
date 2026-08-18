export interface ProductionCheck { name: string; ok: boolean; detail: string; }

const required = ['FIREBASE_PROJECT_ID', 'FIREBASE_CLIENT_EMAIL', 'FIREBASE_PRIVATE_KEY'];
function present(env: NodeJS.ProcessEnv, name: string): boolean { return typeof env[name] === 'string' && env[name]!.trim().length > 0; }
function positiveNumber(env: NodeJS.ProcessEnv, name: string, fallback: number): number { const n = Number(env[name] || ''); return Number.isFinite(n) && n > 0 ? n : fallback; }

export function validateProductionEnvironment(env: NodeJS.ProcessEnv = process.env): ProductionCheck[] {
  const checks: ProductionCheck[] = [];
  for (const name of required) checks.push({ name: `secret:${name}`, ok: present(env, name), detail: present(env, name) ? 'configurado' : 'ausente' });

  const mode = String(env.CONTENT_AGENT_MODE || 'automatic').trim().toLowerCase();
  const importerMode = mode === 'content_importer';
  const hasGemini = present(env, 'GEMINI_API_KEY');
  const hasDeepSeek = present(env, 'DEEPSEEK_API_KEY');
  const hasOpenAI = present(env, 'OPENAI_API_KEY');
  checks.push({ name: 'ai-provider', ok: importerMode || hasGemini || hasDeepSeek || hasOpenAI, detail: importerMode ? 'dispensado no modo content_importer' : hasGemini ? 'Gemini configurado' : hasDeepSeek ? 'DeepSeek configurado' : hasOpenAI ? 'OpenAI configurado' : 'nenhum provedor configurado' });

  const strict = env.CONTENT_AGENT_PRODUCTION_STRICT === 'true';
  checks.push({ name: 'production-strict', ok: strict, detail: strict ? 'ativado' : 'desativado' });
  checks.push({ name: 'agent-enabled', ok: env.CONTENT_AGENT_ENABLED !== 'false', detail: env.CONTENT_AGENT_ENABLED === 'false' ? 'desativado' : 'ativado' });

  const maxRuntime = positiveNumber(env, 'CONTENT_AGENT_MAX_RUNTIME_MIN', 25);
  const maxAiCalls = positiveNumber(env, 'CONTENT_AGENT_MAX_AI_CALLS', 50);
  const maxCards = positiveNumber(env, 'CONTENT_AGENT_MAX_CARDS_PER_RUN', 500);
  checks.push({ name: 'runtime-limit', ok: maxRuntime <= 120, detail: String(maxRuntime) });
  checks.push({ name: 'ai-call-limit', ok: importerMode || maxAiCalls <= 500, detail: importerMode ? 'não aplicável' : String(maxAiCalls) });
  checks.push({ name: 'card-limit', ok: maxCards <= 5000, detail: String(maxCards) });

  if (importerMode) {
    const maxImportBytes = positiveNumber(env, 'CONTENT_IMPORT_MAX_BYTES', 50 * 1024 * 1024);
    const maxStoragePercent = positiveNumber(env, 'CONTENT_IMPORT_MAX_STORAGE_PERCENT', 95);
    checks.push({ name: 'import-size-limit', ok: maxImportBytes <= 200 * 1024 * 1024, detail: `${Math.round(maxImportBytes / 1024 / 1024)} MB` });
    checks.push({ name: 'import-storage-limit', ok: maxStoragePercent > 0 && maxStoragePercent <= 100, detail: `${maxStoragePercent}%` });
  }

  if (hasDeepSeek && !importerMode) {
    const budget = positiveNumber(env, 'DEEPSEEK_MAX_COST_USD_PER_RUN', 0.50);
    const callBudget = positiveNumber(env, 'DEEPSEEK_MAX_COST_USD_PER_CALL', 0.25);
    checks.push({ name: 'deepseek-run-budget', ok: budget <= 10, detail: `US$ ${budget.toFixed(2)}` });
    checks.push({ name: 'deepseek-call-budget', ok: callBudget <= budget && callBudget <= 5, detail: `US$ ${callBudget.toFixed(2)}` });
  }
  return checks;
}

export function assertProductionEnvironment(env: NodeJS.ProcessEnv = process.env): void {
  const checks = validateProductionEnvironment(env);
  if (env.CONTENT_AGENT_PRODUCTION_STRICT !== 'true') return;
  const failures = checks.filter(check => !check.ok);
  if (failures.length > 0) throw new Error(`Configuração de produção inválida: ${failures.map(f => `${f.name}=${f.detail}`).join(', ')}`);
}

export function isProductionEnvironment(env: NodeJS.ProcessEnv = process.env): boolean { return env.NODE_ENV === 'production' || env.CONTENT_AGENT_PRODUCTION_STRICT === 'true'; }
