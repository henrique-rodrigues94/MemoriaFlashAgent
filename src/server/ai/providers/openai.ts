// 📁 MemoriaFlashAgent/src/server/ai/providers/openai.ts
//
// OpenAI — TERCEIRO PROVEDOR / FALLBACK
// Estratégia de economia:
// - GPT-5.4 mini como padrão para alto volume;
// - reasoning_effort=none para tarefas estruturadas que não precisam de raciocínio;
// - saída limitada por chamada;
// - prompt enxuto + JSON estruturado;
// - registra tokens/cache/custo real retornado pela API;
// - teto opcional de custo por execução;
// - GPT-5.4/GPT-5.5 ficam disponíveis via OPENAI_MODEL para tarefas excepcionais.
//
// Variáveis:
//   OPENAI_API_KEY                 obrigatória
//   OPENAI_MODEL                   padrão gpt-5.4-mini
//   OPENAI_REASONING_EFFORT        padrão none
//   OPENAI_MAX_OUTPUT_TOKENS       padrão 8192
//   OPENAI_MAX_COST_USD_PER_RUN    padrão 0.50
//   OPENAI_TIMEOUT                 padrão 25000ms

import { AIProvider, AIProviderError, GenerateJSONParams } from '../types';
import { buildJSONInstruction, extractJSON } from '../jsonUtils';

const DEFAULT_MODEL = 'gpt-5.4-mini';
const ENDPOINT = 'https://api.openai.com/v1/chat/completions';
const DEFAULT_TIMEOUT = 25_000;
const DEFAULT_MAX_OUTPUT = 8192;
const DEFAULT_INPUT_PRICE = 0.75;
const DEFAULT_CACHED_INPUT_PRICE = 0.075;
const DEFAULT_OUTPUT_PRICE = 4.5;

let runCostUsd = 0;

function getModel(): string { return process.env.OPENAI_MODEL?.trim() || DEFAULT_MODEL; }
function getTimeout(): number { return parseInt(process.env.OPENAI_TIMEOUT || '0') || DEFAULT_TIMEOUT; }
function getMaxOutput(params: GenerateJSONParams): number {
  return params.maxOutputTokens ?? (parseInt(process.env.OPENAI_MAX_OUTPUT_TOKENS || '0') || DEFAULT_MAX_OUTPUT);
}
function getReasoningEffort(): string { return process.env.OPENAI_REASONING_EFFORT?.trim() || 'none'; }

function classifyError(err: any, status?: number): AIProviderError {
  const msg = err?.message || String(err);
  const isRate = status === 429 || /rate.?limit|quota|billing/i.test(msg);
  const isAuth = status === 401 || status === 403;
  const isLen = /maximum context length|tokens? limit/i.test(msg);
  return new AIProviderError(
    isAuth ? `OpenAI: chave inválida (HTTP ${status})` :
    isRate ? `OpenAI: cota atingida (HTTP ${status})` :
    isLen ? `OpenAI: prompt muito longo — reduza o pedido` : `OpenAI: ${msg.slice(0, 200)}`,
    'openai', isRate, status,
  );
}

function price(model: string): [number, number, number] {
  // Valores atuais por 1M tokens. Permitem override para modelos futuros.
  const prices: Record<string, [number, number, number]> = {
    'gpt-5.4-mini': [0.75, 0.075, 4.5],
    'gpt-5.4-nano': [0.20, 0.02, 1.25],
    'gpt-5.4': [2.5, 0.25, 15],
    'gpt-5.5': [5, 0.5, 30],
    'gpt-5.6': [5, 0.5, 30],
    'gpt-5.6 Terra': [2.5, 0.25, 15],
    'gpt-5.6 Luna': [1, 0.1, 6],
  };
  return prices[model] ?? [
    Number(process.env.OPENAI_INPUT_PRICE_PER_MILLION || DEFAULT_INPUT_PRICE),
    Number(process.env.OPENAI_CACHED_INPUT_PRICE_PER_MILLION || DEFAULT_CACHED_INPUT_PRICE),
    Number(process.env.OPENAI_OUTPUT_PRICE_PER_MILLION || DEFAULT_OUTPUT_PRICE),
  ];
}

function estimateCost(model: string, usage: any): number {
  const [inputPrice, cachedPrice, outputPrice] = price(model);
  const input = Number(usage?.prompt_tokens ?? usage?.input_tokens ?? 0);
  const cached = Number(usage?.prompt_tokens_details?.cached_tokens ?? usage?.input_tokens_details?.cached_tokens ?? 0);
  const output = Number(usage?.completion_tokens ?? usage?.output_tokens ?? 0);
  const uncached = Math.max(0, input - cached);
  return (uncached / 1_000_000) * inputPrice + (cached / 1_000_000) * cachedPrice + (output / 1_000_000) * outputPrice;
}

function assertBudget(nextCost: number): void {
  const max = Number(process.env.OPENAI_MAX_COST_USD_PER_RUN || '0.50');
  if (max > 0 && runCostUsd + nextCost > max) {
    throw new AIProviderError(`OpenAI: teto de custo atingido (~US$ ${runCostUsd.toFixed(5)} / US$ ${max.toFixed(2)})`, 'openai');
  }
}

export const openaiProvider: AIProvider = {
  id: 'openai',
  label: 'OpenAI ChatGPT',
  tier: 'paid',
  isConfigured: () => !!process.env.OPENAI_API_KEY,

  async generateJSON(params: GenerateJSONParams): Promise<unknown> {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) throw new AIProviderError('OPENAI_API_KEY não configurada', 'openai');

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), params.timeoutMs ?? getTimeout());
    const model = getModel();

    try {
      const system = params.systemPrompt + buildJSONInstruction(params.schemaHint);
      const res = await fetch(ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
        signal: controller.signal,
        body: JSON.stringify({
          model,
          temperature: params.temperature ?? 0.7,
          max_tokens: getMaxOutput(params),
          reasoning_effort: getReasoningEffort(),
          response_format: { type: 'json_object' },
          messages: [
            { role: 'system', content: system },
            { role: 'user', content: params.userPrompt },
          ],
        }),
      });

      if (!res.ok) {
        const body = await res.text().catch(() => '');
        throw classifyError(new Error(body), res.status);
      }

      const data = await res.json();
      const content = data?.choices?.[0]?.message?.content;
      const reason = data?.choices?.[0]?.finish_reason;
      if (!content) throw new Error('OpenAI retornou conteúdo vazio');
      if (reason === 'length') console.warn(`[openai] finish_reason=length model=${model}`);

      const usage = data?.usage;
      if (usage) {
        const cost = estimateCost(model, usage);
        assertBudget(cost);
        runCostUsd += cost;
        const input = Number(usage.prompt_tokens ?? usage.input_tokens ?? 0);
        const cached = Number(usage.prompt_tokens_details?.cached_tokens ?? usage.input_tokens_details?.cached_tokens ?? 0);
        const output = Number(usage.completion_tokens ?? usage.output_tokens ?? 0);
        console.info(`[openai] model=${model} reasoning=${getReasoningEffort()} tokens=${input}in/${output}out cache=${cached} cost≈$${cost.toFixed(6)} accumulated≈$${runCostUsd.toFixed(6)}`);
      }

      return extractJSON(content);
    } catch (err: any) {
      if (err instanceof AIProviderError) throw err;
      if (err?.name === 'AbortError') throw new AIProviderError('OpenAI: timeout', 'openai');
      throw classifyError(err);
    } finally {
      clearTimeout(timer);
    }
  },
};
