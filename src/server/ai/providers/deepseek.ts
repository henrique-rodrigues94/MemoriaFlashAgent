// 📁 MemoriaFlashAgent/src/server/ai/providers/deepseek.ts
//
// DeepSeek — FALLBACK PAGO COM FOCO EM CUSTO
//
// Estratégia:
// 1. V4 Flash por padrão: modelo oficial mais econômico para tarefas simples.
// 2. Thinking DESATIVADO por padrão: geração de currículo/cards estruturados
//    não precisa de raciocínio profundo na maioria dos casos.
// 3. max_tokens configurável e conservador para evitar saída desperdiçada.
// 4. JSON obrigatório para reduzir texto periférico.
// 5. Mantemos systemPrompt estável para favorecer o KV cache do DeepSeek.
// 6. Registramos cache hit/miss, tokens e custo estimado de cada chamada.
//
// Preços atuais consultados na documentação oficial (USD / 1M tokens):
// V4 Flash: $0.14 cache miss, $0.0028 cache hit, $0.28 output.
// Esses valores podem mudar; o cálculo do log é apenas estimativa.
//
// Variáveis:
//   DEEPSEEK_API_KEY                  obrigatória
//   DEEPSEEK_MODEL                    padrão: deepseek-v4-flash
//   DEEPSEEK_TIMEOUT                  padrão: 60000 ms
//   DEEPSEEK_MAX_OUTPUT_TOKENS        padrão: 8192
//   DEEPSEEK_THINKING                 padrão: disabled
//   DEEPSEEK_MAX_COST_USD_PER_RUN     opcional; 0 = sem limite

import { AIProvider, AIProviderError, GenerateJSONParams } from '../types';
import { buildJSONInstruction, extractJSON } from '../jsonUtils';

const DEFAULT_MODEL = 'deepseek-v4-flash';
const ENDPOINT = 'https://api.deepseek.com/chat/completions';
const DEFAULT_TIMEOUT = 60_000;
const DEFAULT_MAX_OUTPUT_TOKENS = 8192;
const INPUT_CACHE_HIT_USD_PER_M = 0.0028;
const INPUT_CACHE_MISS_USD_PER_M = 0.14;
const OUTPUT_USD_PER_M = 0.28;

let runEstimatedCostUsd = 0;

function getModel(): string {
  return process.env.DEEPSEEK_MODEL || DEFAULT_MODEL;
}

function getTimeout(): number {
  return parseInt(process.env.DEEPSEEK_TIMEOUT || '0') || DEFAULT_TIMEOUT;
}

function getMaxOutputTokens(params: GenerateJSONParams): number {
  return params.maxOutputTokens
    ?? (parseInt(process.env.DEEPSEEK_MAX_OUTPUT_TOKENS || '0') || DEFAULT_MAX_OUTPUT_TOKENS);
}

function isThinkingEnabled(): boolean {
  return /^(1|true|enabled|on)$/i.test(process.env.DEEPSEEK_THINKING || '');
}

function getRunBudgetUsd(): number {
  return parseFloat(process.env.DEEPSEEK_MAX_COST_USD_PER_RUN || '0') || 0;
}

function classifyError(err: any, status?: number): AIProviderError {
  const msg = err?.message || String(err);
  const isRate = status === 429 || /rate.?limit|quota|insufficient.?balance/i.test(msg);
  const isAuth = status === 401 || status === 403;
  return new AIProviderError(
    isAuth ? `DeepSeek: chave inválida ou sem saldo (HTTP ${status})` :
    isRate ? `DeepSeek: cota atingida (HTTP ${status})` :
             `DeepSeek: ${msg.slice(0, 200)}`,
    'deepseek',
    isRate,
    status,
  );
}

function estimateCostUsd(usage: any): number {
  if (!usage) return 0;
  const hit = Number(usage.prompt_cache_hit_tokens || 0);
  const miss = Number(usage.prompt_cache_miss_tokens || 0);
  const prompt = Number(usage.prompt_tokens || 0);
  const output = Number(usage.completion_tokens || 0);

  // Algumas respostas/compatibilidades podem não expor hit/miss. Nesse caso,
  // tratamos todo o prompt como miss para não subestimar o custo.
  const accountedPrompt = hit + miss;
  const fallbackMiss = accountedPrompt > 0 ? 0 : prompt;
  return (
    hit * INPUT_CACHE_HIT_USD_PER_M +
    (miss + fallbackMiss) * INPUT_CACHE_MISS_USD_PER_M +
    output * OUTPUT_USD_PER_M
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

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), params.timeoutMs ?? getTimeout());

    try {
      const thinking = isThinkingEnabled();
      const maxTokens = getMaxOutputTokens(params);
      const systemPrompt = `${params.systemPrompt}\n${buildJSONInstruction(params.schemaHint)}`.trim();

      const body: Record<string, unknown> = {
        model: getModel(),
        max_tokens: maxTokens,
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: params.userPrompt.trim() },
        ],
      };

      // Thinking é opcional. Desligado por padrão reduz custo/latência para
      // tarefas estruturadas; pode ser habilitado via DEEPSEEK_THINKING=true.
      if (thinking) {
        body.thinking = { type: 'enabled' };
        body.reasoning_effort = 'high';
      } else {
        body.thinking = { type: 'disabled' };
        body.temperature = params.temperature ?? 0.4;
      }

      const runBudget = getRunBudgetUsd();
      if (runBudget > 0 && runEstimatedCostUsd >= runBudget) {
        throw new AIProviderError(
          `DeepSeek: orçamento da execução atingido (US$ ${runEstimatedCostUsd.toFixed(4)}/${runBudget.toFixed(4)})`,
          'deepseek',
          true,
        );
      }

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
      const estimatedCostUsd = estimateCostUsd(usage);
      runEstimatedCostUsd += estimatedCostUsd;

      console.info(
        `[deepseek] ${getModel()} | ${thinking ? 'thinking:on' : 'thinking:off'} | ` +
        `${input} in / ${output} out | cache hit ${hit} / miss ${miss} | ` +
        `custo estimado US$ ${estimatedCostUsd.toFixed(5)} | acumulado US$ ${runEstimatedCostUsd.toFixed(5)}`,
      );

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
