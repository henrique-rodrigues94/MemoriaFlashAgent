export interface ProductionCheck { name: string; ok: boolean; detail: string; }

const required = [
  'FIREBASE_PROJECT_ID',
  'FIREBASE_CLIENT_EMAIL',
  'FIREBASE_PRIVATE_KEY',
  'GEMINI_API_KEY',
];

function present(name: string): boolean {
  return typeof process.env[name] === 'string' && process.env[name]!.trim().length > 0;
}

export function validateProductionEnvironment(env: NodeJS.ProcessEnv = process.env): ProductionCheck[] {
  const checks: ProductionCheck[] = [];
  for (const name of required) {
    const value = env[name];
    checks.push({ name: `secret:${name}`, ok: Boolean(value?.trim()), detail: value?.trim() ? 'configurado' : 'ausente' });
  }

  const strict = env.CONTENT_AGENT_PRODUCTION_STRICT === 'true';
  checks.push({ name: 'production-strict', ok: strict, detail: strict ? 'ativado' : 'desativado' });
  checks.push({ name: 'agent-enabled', ok: env.CONTENT_AGENT_ENABLED !== 'false', detail: env.CONTENT_AGENT_ENABLED === 'false' ? 'desativado' : 'ativado' });

  const maxRuntime = Number(env.CONTENT_AGENT_MAX_RUNTIME_MIN || 25);
  const maxAiCalls = Number(env.CONTENT_AGENT_MAX_AI_CALLS || 50);
  const maxCards = Number(env.CONTENT_AGENT_MAX_CARDS_PER_RUN || 500);
  checks.push({ name: 'runtime-limit', ok: Number.isFinite(maxRuntime) && maxRuntime > 0 && maxRuntime <= 120, detail: String(maxRuntime) });
  checks.push({ name: 'ai-call-limit', ok: Number.isFinite(maxAiCalls) && maxAiCalls > 0 && maxAiCalls <= 500, detail: String(maxAiCalls) });
  checks.push({ name: 'card-limit', ok: Number.isFinite(maxCards) && maxCards > 0 && maxCards <= 5000, detail: String(maxCards) });

  return checks;
}

export function assertProductionEnvironment(env: NodeJS.ProcessEnv = process.env): void {
  const checks = validateProductionEnvironment(env);
  const strict = env.CONTENT_AGENT_PRODUCTION_STRICT === 'true';
  if (!strict) return;
  const failures = checks.filter(check => !check.ok);
  if (failures.length > 0) {
    throw new Error(`Configuração de produção inválida: ${failures.map(f => `${f.name}=${f.detail}`).join(', ')}`);
  }
}

export function isProductionEnvironment(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.NODE_ENV === 'production' || env.CONTENT_AGENT_PRODUCTION_STRICT === 'true';
}
