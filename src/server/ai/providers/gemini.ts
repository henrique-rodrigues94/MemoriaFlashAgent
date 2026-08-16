// 📁 MemoriaFlashAgent/src/server/ai/providers/gemini.ts
//
// Google Gemini — PROVEDOR PRINCIPAL
// Estratégia de economia:
// - usa um modelo estável da Gemini API por padrão;
// - permite sobrescrever o modelo por GEMINI_MODEL;
// - usa structured output nativo para evitar retries/parsing;
// - limita a saída por chamada;
// - registra tokens/custo estimado quando o provedor devolve usageMetadata;
// - permite teto opcional de custo por execução para contas pagas;
// - se o modelo configurado retornar 404, tenta automaticamente o modelo
//   estável de fallback uma única vez, evitando que um secret antigo quebre
//   toda a execução do Agent.
//
// Variáveis:
//   GEMINI_API_KEY                 obrigatória
//   GEMINI_MODEL                   opcional; padrão gemini-2.5-flash
//   GEMINI_MAX_OUTPUT_TOKENS       padrão 32768
//   GEMINI_MAX_COST_USD_PER_RUN    padrão 0 = sem bloqueio
//   GEMINI_INPUT_PRICE_PER_MILLION opcional, para estimativa de conta paga
//   GEMINI_OUTPUT_PRICE_PER_MILLION opcional, para estimativa de conta paga

import { GoogleGenAI } from '@google/genai';
import { AIProvider, AIProviderError, GenerateJSONParams } from '../types';

const DEFAULT_MODEL = 'gemini-2.5-flash';
const FALLBACK_MODEL = 'gemini-2.5-flash';
const DEFAULT_MAX_TOKENS = 32768;
const DEFAULT_INPUT_PRICE = 0;
const DEFAULT_OUTPUT_PRICE = 0;

let _client: GoogleGenAI | null = null;
let runCostUsd = 0;

function getClient(): GoogleGenAI {
  const key = process.env.GEMINI_API_KEY;
  if (!key) throw new AIProviderError('GEMINI_API_KEY não configurada', 'gemini');
  if (!_client) {
    _client = new GoogleGenAI({ apiKey: key, httpOptions: { headers: { 'User-Agent': 'memoriaflash/1.0' } } });
  }
  return _client;
}

function getModel(): string {
  return process.env.GEMINI_MODEL?.trim() || DEFAULT_MODEL;
}

function getMaxTokens(params: GenerateJSONParams): number {
  return params.maxOutputTokens
    ?? (parseInt(process.env.GEMINI_MAX_OUTPUT_TOKENS || '0') || DEFAULT_MAX_TOKENS);
}

function getPrice(envName: string, fallback: number): number {
  const value = Number(process.env[envName]);
  return Number.isFinite(value) && value >= 0 ? value : fallback;
}

function estimateCost(inputTokens: number, outputTokens: number): number {
  const inputPrice = getPrice('GEMINI_INPUT_PRICE_PER_MILLION', DEFAULT_INPUT_PRICE);
  const outputPrice = getPrice('GEMINI_OUTPUT_PRICE_PER_MILLION', DEFAULT_OUTPUT_PRICE);
  return (inputTokens / 1_000_000) * inputPrice + (outputTokens / 1_000_000) * outputPrice;
}

function assertBudget(estimatedNextCost: number): void {
  const max = Number(process.env.GEMINI_MAX_COST_USD_PER_RUN || '0');
  if (max > 0 && runCostUsd + estimatedNextCost > max) {
    throw new AIProviderError(
      `Gemini: teto de custo da execução atingido (~US$ ${runCostUsd.toFixed(5)} / US$ ${max.toFixed(2)})`,
      'gemini',
      false,
    );
  }
}

function classifyError(err: any): AIProviderError {
  const msg = err?.message || String(err);
  const messageStatus = typeof msg === 'string'
    ? Number(msg.match(/(?:\"code\"|\bstatus\b)\s*[:=]\s*(\d{3})/)?.[1]) || undefined
    : undefined;
  const status = err?.status ?? err?.response?.status ?? err?.httpStatus ?? messageStatus;
  const isRate = status === 429 || /quota|rate.?limit|resource.?exhausted/i.test(msg);
  return new AIProviderError(
    isRate ? `Gemini: cota atingida (${msg.slice(0, 120)})` : `Gemini: ${msg.slice(0, 200)}`,
    'gemini',
    isRate,
    status,
  );
}

function isNotFoundError(err: any): boolean {
  const message = err?.message || String(err);
  const status = err?.status ?? err?.response?.status ?? err?.httpStatus;
  return status === 404 || /(?:\b404\b|not found|not_found|does not exist)/i.test(message);
}

export const geminiProvider: AIProvider = {
  id: 'gemini',
  label: 'Google Gemini',
  tier: 'free',
  isConfigured: () => !!process.env.GEMINI_API_KEY,

  async generateJSON(params: GenerateJSONParams): Promise<unknown> {
    const ai = getClient();
    const configuredModel = getModel();

    const generate = async (model: string) => {
      const config: Record<string, unknown> = {
        systemInstruction: params.systemPrompt,
        responseMimeType: 'application/json',
        maxOutputTokens: getMaxTokens(params),
        temperature: params.temperature ?? 0.7,
      };
      if (params.geminiSchema) config.responseSchema = params.geminiSchema;

      const response = await ai.models.generateContent({
        model,
        contents: params.userPrompt,
        config,
      });

      const text = response.text;
      if (!text?.trim()) throw new Error('Resposta vazia do Gemini');

      const usage = (response as any).usageMetadata;
      if (usage) {
        const input = Number(usage.promptTokenCount ?? usage.inputTokenCount ?? 0);
        const output = Number(usage.candidatesTokenCount ?? usage.outputTokenCount ?? 0);
        const cached = Number(usage.cachedContentTokenCount ?? 0);
        const cost = estimateCost(input, output);
        assertBudget(cost);
        runCostUsd += cost;
        console.info(`[gemini] model=${model} tokens=${input}in/${output}out cache=${cached} cost≈$${cost.toFixed(6)} accumulated≈$${runCostUsd.toFixed(6)}`);
      } else {
        console.info(`[gemini] model=${model} resposta recebida sem usageMetadata`);
      }

      return JSON.parse(text);
    };

    try {
      return await generate(configuredModel);
    } catch (err: any) {
      // Um secret GEMINI_MODEL antigo/inexistente não deve derrubar a execução
      // inteira. Repetimos somente 404 com um modelo estável conhecido.
      if (configuredModel !== FALLBACK_MODEL && isNotFoundError(err)) {
        console.warn(`[gemini] modelo "${configuredModel}" retornou 404; tentando fallback "${FALLBACK_MODEL}".`);
        try {
          return await generate(FALLBACK_MODEL);
        } catch (fallbackErr: any) {
          throw classifyError(fallbackErr);
        }
      }

      if (err instanceof AIProviderError) throw err;
      throw classifyError(err);
    }
  },
};
