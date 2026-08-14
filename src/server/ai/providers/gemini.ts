// 📁 flashmind-ai/src/server/ai/providers/gemini.ts
//
// Google Gemini — PROVEDOR PRINCIPAL
// Camada gratuita generosa via Google AI Studio (GEMINI_API_KEY).
// Suporta structured output nativo (responseSchema) → JSON garantido.
//
// Variáveis de ambiente:
//   GEMINI_API_KEY          obrigatória
//   GEMINI_MODEL            opcional (padrão: gemini-2.5-flash)
//   GEMINI_MAX_OUTPUT_TOKENS opcional (padrão: 8192)

import { GoogleGenAI } from '@google/genai';
import { AIProvider, AIProviderError, GenerateJSONParams } from '../types';

// gemini-2.5-flash: melhor custo-benefício, contexto 1M tokens, saída 65k tokens
const DEFAULT_MODEL      = 'gemini-2.5-flash';
const DEFAULT_MAX_TOKENS = 8192;

let _client: GoogleGenAI | null = null;

function getClient(): GoogleGenAI {
  const key = process.env.GEMINI_API_KEY;
  if (!key) throw new AIProviderError('GEMINI_API_KEY não configurada', 'gemini');
  if (!_client) {
    _client = new GoogleGenAI({ apiKey: key, httpOptions: { headers: { 'User-Agent': 'memoriaflash/1.0' } } });
  }
  return _client;
}

function getModel(): string {
  return process.env.GEMINI_MODEL || DEFAULT_MODEL;
}

function getMaxTokens(params: GenerateJSONParams): number {
  return params.maxOutputTokens
    ?? (parseInt(process.env.GEMINI_MAX_OUTPUT_TOKENS || '0') || DEFAULT_MAX_TOKENS);
}

function classifyError(err: any): AIProviderError {
  const msg    = err?.message || String(err);
  // O SDK pode encapsular o erro HTTP como texto JSON em `message`. Extrair
  // esse código garante que 429 entre no cooldown imediatamente, em vez de
  // gastar novas tentativas da cota já esgotada.
  const messageStatus = typeof msg === 'string'
    ? Number(msg.match(/(?:"code"|\bstatus\b)\s*[:=]\s*(\d{3})/)?.[1]) || undefined
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

export const geminiProvider: AIProvider = {
  id:    'gemini',
  label: 'Google Gemini',
  tier:  'free',

  isConfigured: () => !!process.env.GEMINI_API_KEY,

  async generateJSON(params: GenerateJSONParams): Promise<unknown> {
    const ai = getClient();

    try {
      const config: Record<string, unknown> = {
        systemInstruction: params.systemPrompt,
        responseMimeType: 'application/json',
        maxOutputTokens: getMaxTokens(params),
        temperature: params.temperature ?? 0.7,
      };

      // Structured output nativo — garante schema sem depender do parsing
      if (params.geminiSchema) {
        config.responseSchema = params.geminiSchema;
      }

      const response = await ai.models.generateContent({
        model: getModel(),
        contents: params.userPrompt,
        config,
      });

      const text = response.text;
      if (!text?.trim()) throw new Error('Resposta vazia do Gemini');

      // Com responseSchema, a resposta já é JSON válido — parse direto
      return JSON.parse(text);
    } catch (err: any) {
      if (err instanceof AIProviderError) throw err;
      throw classifyError(err);
    }
  },
};
