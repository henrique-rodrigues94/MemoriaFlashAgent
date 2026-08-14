// 📁 flashmind-ai/src/server/ai/providers/openai.ts
//
// OpenAI ChatGPT — TERCEIRO PROVEDOR
// Fallback pago de alta qualidade. Entra em ação quando Gemini e DeepSeek
// falham ou atingem cota. Suporta json_object e json_schema (structured output).
//
// Variáveis de ambiente:
//   OPENAI_API_KEY   obrigatória
//   OPENAI_MODEL     opcional (padrão: gpt-4o-mini — melhor custo-benefício)
//   OPENAI_TIMEOUT   opcional em ms (padrão: 25000)
//
// Modelos recomendados (set via OPENAI_MODEL):
//   gpt-4o-mini   — padrão, barato, boa qualidade para flashcards
//   gpt-4o        — melhor qualidade, mais caro
//   gpt-4.1-mini  — intermediário (quando disponível)

import { AIProvider, AIProviderError, GenerateJSONParams } from '../types';
import { buildJSONInstruction, extractJSON } from '../jsonUtils';

const DEFAULT_MODEL    = 'gpt-4o-mini';
const ENDPOINT         = 'https://api.openai.com/v1/chat/completions';
const DEFAULT_TIMEOUT  = 25_000;

function getModel():   string { return process.env.OPENAI_MODEL   || DEFAULT_MODEL; }
function getTimeout(): number { return parseInt(process.env.OPENAI_TIMEOUT || '0') || DEFAULT_TIMEOUT; }

function classifyError(err: any, status?: number): AIProviderError {
  const msg    = err?.message || String(err);
  const isRate = status === 429 || /rate.?limit|quota|billing/i.test(msg);
  const isAuth = status === 401 || status === 403;
  const isLen  = /maximum context length|tokens? limit/i.test(msg);
  return new AIProviderError(
    isAuth ? `OpenAI: chave inválida (HTTP ${status})` :
    isRate ? `OpenAI: cota atingida (HTTP ${status})` :
    isLen  ? `OpenAI: prompt muito longo — reduza o número de cards` :
             `OpenAI: ${msg.slice(0, 200)}`,
    'openai',
    isRate,
    status,
  );
}

export const openaiProvider: AIProvider = {
  id:    'openai',
  label: 'OpenAI ChatGPT',
  tier:  'paid',

  isConfigured: () => !!process.env.OPENAI_API_KEY,

  async generateJSON(params: GenerateJSONParams): Promise<unknown> {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) throw new AIProviderError('OPENAI_API_KEY não configurada', 'openai');

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), params.timeoutMs ?? getTimeout());

    const model = getModel();

    try {
      const res = await fetch(ENDPOINT, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
        signal:  controller.signal,
        body: JSON.stringify({
          model,
          temperature:     params.temperature ?? 0.7,
          max_tokens:      params.maxOutputTokens ?? 8192,
          // json_object garante JSON válido sem structured output completo
          response_format: { type: 'json_object' },
          messages: [
            {
              role:    'system',
              content: params.systemPrompt + buildJSONInstruction(params.schemaHint),
            },
            { role: 'user', content: params.userPrompt },
          ],
        }),
      });

      if (!res.ok) {
        const body = await res.text().catch(() => '');
        throw classifyError(new Error(body), res.status);
      }

      const data    = await res.json();
      const content = data?.choices?.[0]?.message?.content;
      const reason  = data?.choices?.[0]?.finish_reason;

      if (!content) throw new Error('OpenAI retornou conteúdo vazio');

      // finish_reason=length significa que o JSON foi truncado
      if (reason === 'length') {
        console.warn(`[openai] finish_reason=length com model=${model}. Considere aumentar max_tokens ou reduzir o pedido.`);
      }

      // Log de uso para monitorar custo
      const usage = data?.usage;
      if (usage) {
        const cost = estimateCost(model, usage.prompt_tokens, usage.completion_tokens);
        console.info(`[openai] model=${model} tokens=${usage.prompt_tokens}in/${usage.completion_tokens}out cost≈$${cost}`);
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

// Estimativa de custo em USD para log (preços aproximados de julho/2025)
function estimateCost(model: string, promptTokens: number, completionTokens: number): string {
  const prices: Record<string, [number, number]> = {
    'gpt-4o-mini':  [0.00015, 0.00060], // $0.15/$0.60 por 1M tokens
    'gpt-4o':       [0.00250, 0.01000], // $2.50/$10.00
    'gpt-4.1-mini': [0.00040, 0.00160],
    'gpt-4.1':      [0.00200, 0.00800],
  };
  const [inP, outP] = prices[model] ?? [0.002, 0.006];
  const total = (promptTokens / 1000) * inP + (completionTokens / 1000) * outP;
  return total.toFixed(5);
}
