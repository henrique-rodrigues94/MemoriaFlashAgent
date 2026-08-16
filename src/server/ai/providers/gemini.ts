import { GoogleGenAI } from '@google/genai';
import { AIProvider, AIProviderError, GenerateJSONParams } from '../types';

const DEFAULT_MODEL = 'gemini-2.5-flash';
const FALLBACK_MODELS = ['gemini-2.5-flash-lite', 'gemini-3.5-flash'];
const DEFAULT_MAX_TOKENS = 32768;
const DEFAULT_INPUT_PRICE = 0;
const DEFAULT_OUTPUT_PRICE = 0;
const DEFAULT_RUN_BUDGET_USD = 0.50;
let _client: GoogleGenAI | null = null;
let runCostUsd = 0;

function getClient(): GoogleGenAI {
  const key = process.env.GEMINI_API_KEY;
  if (!key) throw new AIProviderError('GEMINI_API_KEY não configurada', 'gemini');
  if (!_client) _client = new GoogleGenAI({ apiKey: key, httpOptions: { headers: { 'User-Agent': 'memoriaflash/1.0' } } });
  return _client;
}
function getModel(): string { return process.env.GEMINI_MODEL?.trim() || DEFAULT_MODEL; }
function getMaxTokens(params: GenerateJSONParams): number { return params.maxOutputTokens ?? (parseInt(process.env.GEMINI_MAX_OUTPUT_TOKENS || '0', 10) || DEFAULT_MAX_TOKENS); }
function getPrice(envName: string, fallback: number): number {
  const raw = process.env[envName]?.trim();
  if (!raw) return fallback;
  const value = Number(raw);
  return Number.isFinite(value) && value >= 0 && value <= 100 ? value : fallback;
}
function estimateCost(inputTokens: number, outputTokens: number): number {
  return (inputTokens / 1_000_000) * getPrice('GEMINI_INPUT_PRICE_PER_MILLION', DEFAULT_INPUT_PRICE) + (outputTokens / 1_000_000) * getPrice('GEMINI_OUTPUT_PRICE_PER_MILLION', DEFAULT_OUTPUT_PRICE);
}
function getRunBudgetUsd(): number {
  const value = Number(process.env.GEMINI_MAX_COST_USD_PER_RUN || '');
  return Number.isFinite(value) && value > 0 ? value : DEFAULT_RUN_BUDGET_USD;
}
function assertBudget(next: number): void {
  const max = getRunBudgetUsd();
  if (!Number.isFinite(next) || next < 0 || runCostUsd + next > max) throw new AIProviderError(`Gemini: teto de custo atingido (~US$ ${(runCostUsd + next).toFixed(5)} / US$ ${max.toFixed(2)})`, 'gemini', true);
}
function isNotFoundError(err: any): boolean {
  const message = err?.message || String(err);
  const status = err?.status ?? err?.response?.status ?? err?.httpStatus;
  return status === 404 || /(?:\b404\b|not found|not_found|does not exist|model.*not.*found)/i.test(message);
}
function classifyError(err: any): AIProviderError {
  const msg = err?.message || String(err);
  const status = err?.status ?? err?.response?.status ?? err?.httpStatus;
  const isRate = status === 429 || /quota|rate.?limit|resource.?exhausted/i.test(msg);
  return new AIProviderError(isRate ? `Gemini: cota atingida (${msg.slice(0, 120)})` : `Gemini: ${msg.slice(0, 240)}`, 'gemini', isRate, status);
}

export const geminiProvider: AIProvider = {
  id: 'gemini',
  label: 'Google Gemini',
  tier: 'free',
  isConfigured: () => !!process.env.GEMINI_API_KEY,

  async generateJSON(params: GenerateJSONParams): Promise<unknown> {
    const ai = getClient();
    const configuredModel = getModel();
    const candidates = Array.from(new Set([configuredModel, DEFAULT_MODEL, ...FALLBACK_MODELS]));
    let lastError: unknown = null;

    for (const model of candidates) {
      try {
        const config: Record<string, unknown> = {
          systemInstruction: params.systemPrompt,
          responseMimeType: 'application/json',
          maxOutputTokens: getMaxTokens(params),
          temperature: params.temperature ?? 0.7,
        };
        if (params.geminiSchema) config.responseSchema = params.geminiSchema;

        const response = await ai.models.generateContent({ model, contents: params.userPrompt, config });
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
      } catch (err: any) {
        lastError = err;
        if (isNotFoundError(err) && model !== candidates[candidates.length - 1]) {
          console.warn(`[gemini] modelo "${model}" indisponível (404); tentando próximo modelo estável.`);
          continue;
        }
        if (err instanceof AIProviderError) throw err;
        throw classifyError(err);
      }
    }
    throw classifyError(lastError);
  },
};
