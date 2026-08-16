import { AIProvider, AIProviderError, GenerateJSONParams } from '../types';
import { buildJSONInstruction, extractJSON } from '../jsonUtils';

const DEFAULT_MODEL = 'deepseek-v4-flash';
const ENDPOINT = 'https://api.deepseek.com/chat/completions';
const DEFAULT_TIMEOUT = 60_000;
const DEFAULT_MAX_OUTPUT_TOKENS = 8192;
const DEFAULT_INPUT_CACHE_HIT_USD_PER_M = 0.0028;
const DEFAULT_INPUT_CACHE_MISS_USD_PER_M = 0.14;
const DEFAULT_OUTPUT_USD_PER_M = 0.28;
const DEFAULT_RUN_BUDGET_USD = 0.50;
const DEFAULT_CALL_BUDGET_USD = 0.25;
const MAX_REASONABLE_PRICE_USD_PER_M = 100;
let runEstimatedCostUsd = 0;

function getModel(): string { return process.env.DEEPSEEK_MODEL?.trim() || DEFAULT_MODEL; }
function getTimeout(): number { return parseInt(process.env.DEEPSEEK_TIMEOUT || '0', 10) || DEFAULT_TIMEOUT; }
function getMaxOutputTokens(params: GenerateJSONParams): number { return params.maxOutputTokens ?? (parseInt(process.env.DEEPSEEK_MAX_OUTPUT_TOKENS || '0', 10) || DEFAULT_MAX_OUTPUT_TOKENS); }
function isThinkingEnabled(): boolean { return /^(1|true|enabled|on)$/i.test(process.env.DEEPSEEK_THINKING || ''); }

function getPrice(name: string, fallback: number): number {
  const raw = process.env[name]?.trim();
  if (!raw) return fallback;
  const value = Number(raw);
  if (!Number.isFinite(value) || value < 0 || value > MAX_REASONABLE_PRICE_USD_PER_M) {
    console.warn(`[deepseek] ${name} inválido (${raw}); usando ${fallback}.`);
    return fallback;
  }
  return value;
}
function getRunBudgetUsd(): number {
  const raw = Number(process.env.DEEPSEEK_MAX_COST_USD_PER_RUN || '');
  return Number.isFinite(raw) && raw > 0 ? raw : DEFAULT_RUN_BUDGET_USD;
}
function getCallBudgetUsd(): number {
  const raw = Number(process.env.DEEPSEEK_MAX_COST_USD_PER_CALL || '');
  return Number.isFinite(raw) && raw > 0 ? raw : DEFAULT_CALL_BUDGET_USD;
}

export function estimateDeepSeekCostUsd(usage: any): number {
  if (!usage) return 0;
  const hit = Math.max(0, Number(usage.prompt_cache_hit_tokens || 0));
  const miss = Math.max(0, Number(usage.prompt_cache_miss_tokens || 0));
  const prompt = Math.max(0, Number(usage.prompt_tokens || 0));
  const output = Math.max(0, Number(usage.completion_tokens || 0));
  const fallbackMiss = hit + miss > 0 ? 0 : prompt;
  const hitPrice = getPrice('DEEPSEEK_INPUT_CACHE_HIT_PRICE_PER_MILLION', DEFAULT_INPUT_CACHE_HIT_USD_PER_M);
  const missPrice = getPrice('DEEPSEEK_INPUT_PRICE_PER_MILLION', DEFAULT_INPUT_CACHE_MISS_USD_PER_M);
  const outputPrice = getPrice('DEEPSEEK_OUTPUT_PRICE_PER_MILLION', DEFAULT_OUTPUT_USD_PER_M);
  return (hit / 1_000_000) * hitPrice + ((miss + fallbackMiss) / 1_000_000) * missPrice + (output / 1_000_000) * outputPrice;
}

export function resetDeepSeekRunBudget(): void { runEstimatedCostUsd = 0; }

function classifyError(err: any, status?: number): AIProviderError {
  const msg = err?.message || String(err);
  const isRate = status === 429 || /rate.?limit|quota|insufficient.?balance/i.test(msg);
  const isAuth = status === 401 || status === 403;
  return new AIProviderError(
    isAuth ? `DeepSeek: chave inválida ou sem saldo (HTTP ${status})` : isRate ? `DeepSeek: cota atingida (HTTP ${status})` : `DeepSeek: ${msg.slice(0, 200)}`,
    'deepseek', isRate, status,
  );
}

export const deepseekProvider: AIProvider = {
  id: 'deepseek',
  label: 'DeepSeek V4 Flash',
  tier: 'paid',
  isConfigured: () => !!process.env.DEEPSEEK_API_KEY,

  async generateJSON(params: GenerateJSONParams): Promise<unknown> {
    const apiKey = process.env.DEEPSEEK_API_KEY;
    if (!apiKey) throw new AIProviderError('DEEPSEEK_API_KEY não configurada', 'deepseek');

    const runBudget = getRunBudgetUsd();
    const callBudget = getCallBudgetUsd();
    if (runEstimatedCostUsd >= runBudget) {
      throw new AIProviderError(`DeepSeek: orçamento da execução atingido (US$ ${runEstimatedCostUsd.toFixed(5)}/${runBudget.toFixed(5)})`, 'deepseek', true);
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), params.timeoutMs ?? getTimeout());
    try {
      const thinking = isThinkingEnabled();
      const maxTokens = getMaxOutputTokens(params);
      const systemPrompt = `${params.systemPrompt}\n${buildJSONInstruction(params.schemaHint)}`.trim();
      const body: Record<string, unknown> = {
        model: getModel(), max_tokens: maxTokens, response_format: { type: 'json_object' },
        messages: [{ role: 'system', content: systemPrompt }, { role: 'user', content: params.userPrompt.trim() }],
      };
      if (thinking) { body.thinking = { type: 'enabled' }; body.reasoning_effort = 'high'; }
      else { body.thinking = { type: 'disabled' }; body.temperature = params.temperature ?? 0.4; }

      const res = await fetch(ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
        signal: controller.signal,
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const responseBody = await res.text().catch(() => '');
        throw classifyError(new Error(responseBody), res.status);
      }

      const data = await res.json();
      const content = data?.choices?.[0]?.message?.content;
      if (!content) throw new Error('DeepSeek retornou conteúdo vazio');

      const usage = data?.usage;
      const hit = Number(usage?.prompt_cache_hit_tokens || 0);
      const miss = Number(usage?.prompt_cache_miss_tokens || 0);
      const input = Number(usage?.prompt_tokens || 0);
      const output = Number(usage?.completion_tokens || 0);
      const estimatedCostUsd = estimateDeepSeekCostUsd(usage);

      // Guarda contra unidade/preço incorreto: não permita que uma estimativa
      // anômala seja acumulada e provoque dezenas de chamadas caras.
      if (!Number.isFinite(estimatedCostUsd) || estimatedCostUsd < 0) {
        throw new AIProviderError('DeepSeek: estimativa de custo inválida; execução interrompida.', 'deepseek', true);
      }
      if (estimatedCostUsd > callBudget) {
        runEstimatedCostUsd += estimatedCostUsd;
        throw new AIProviderError(`DeepSeek: custo estimado da chamada excedeu o teto (US$ ${estimatedCostUsd.toFixed(5)}/${callBudget.toFixed(5)}). Execução interrompida por segurança.`, 'deepseek', true);
      }
      if (runEstimatedCostUsd + estimatedCostUsd > runBudget) {
        runEstimatedCostUsd += estimatedCostUsd;
        throw new AIProviderError(`DeepSeek: custo estimado excederia o orçamento da execução (US$ ${runEstimatedCostUsd.toFixed(5)}/${runBudget.toFixed(5)}). Execução interrompida por segurança.`, 'deepseek', true);
      }

      runEstimatedCostUsd += estimatedCostUsd;
      console.info(`[deepseek] ${getModel()} | ${thinking ? 'thinking:on' : 'thinking:off'} | ${input} in / ${output} out | cache hit ${hit} / miss ${miss} | custo estimado US$ ${estimatedCostUsd.toFixed(6)} | acumulado US$ ${runEstimatedCostUsd.toFixed(6)}`);
      return extractJSON(content);
    } catch (err: any) {
      if (err instanceof AIProviderError) throw err;
      if (err?.name === 'AbortError') throw new AIProviderError('DeepSeek: timeout', 'deepseek');
      throw classifyError(err);
    } finally {
      clearTimeout(timer);
    }
  },
};
