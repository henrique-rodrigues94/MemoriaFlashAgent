// 📁 MemoriaFlashAgent/src/server/ai/providers/gemini.ts
//
// Google Gemini — PROVEDOR PRINCIPAL
// Usa a mesma configuração validada no aplicativo MemoriaFlash.
// Suporta structured output nativo (responseSchema) → JSON garantido.
//
// Variáveis de ambiente:
//   GEMINI_API_KEY           obrigatória
//   GEMINI_MODEL             opcional (padrão: gemini-flash-latest)
//   GEMINI_MAX_OUTPUT_TOKENS opcional (padrão: 32768)

import { GoogleGenAI } from '@google/genai';
import { AIProvider, AIProviderError, GenerateJSONParams } from '../types';

// O MemoriaFlash já funciona com este alias; manter o Agent alinhado evita
// que uma execução use um modelo diferente quando GEMINI_MODEL não estiver
// definido como secret no GitHub Actions.
const DEFAULT_MODEL      = 'gemini-flash-latest';
const DEFAULT_MAX_TOKENS = 32768;

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
  const configured = process.env.GEMINI_MODEL?.trim();
  return configured || DEFAULT_MODEL;
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
