// 📁 flashmind-ai/src/server/ai/providers/deepseek.ts
//
// DeepSeek — SEGUNDO PROVEDOR
// Excelente qualidade a custo muito baixo (~$0.27/1M tokens input, $1.10/1M output).
// API 100% compatível com OpenAI — usa o mesmo protocolo.
// Suporta response_format: json_object → JSON garantido.
//
// Variáveis de ambiente:
//   DEEPSEEK_API_KEY   obrigatória (https://platform.deepseek.com/api_keys)
//   DEEPSEEK_MODEL     opcional (padrão: deepseek-chat = V3)
//   DEEPSEEK_TIMEOUT   opcional em ms (padrão: 30000)

import { AIProvider, AIProviderError, GenerateJSONParams } from '../types';
import { buildJSONInstruction, extractJSON } from '../jsonUtils';

const DEFAULT_MODEL    = 'deepseek-chat'; // V3 — melhor custo-benefício
const ENDPOINT         = 'https://api.deepseek.com/chat/completions';
// Lotes de 25+ cards podem ter respostas longas. Mantemos margem suficiente
// para concluir a leitura/parse do JSON antes de deixar o orquestrador usar o
// próximo fallback.
const DEFAULT_TIMEOUT  = 60_000;

function getModel():   string { return process.env.DEEPSEEK_MODEL   || DEFAULT_MODEL; }
function getTimeout(): number { return parseInt(process.env.DEEPSEEK_TIMEOUT || '0') || DEFAULT_TIMEOUT; }

function classifyError(err: any, status?: number): AIProviderError {
  const msg    = err?.message || String(err);
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

export const deepseekProvider: AIProvider = {
  id:    'deepseek',
  label: 'DeepSeek V3',
  tier:  'paid',

  isConfigured: () => !!process.env.DEEPSEEK_API_KEY,

  async generateJSON(params: GenerateJSONParams): Promise<unknown> {
    const apiKey = process.env.DEEPSEEK_API_KEY;
    if (!apiKey) throw new AIProviderError('DEEPSEEK_API_KEY não configurada', 'deepseek');

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), params.timeoutMs ?? getTimeout());

    try {
      const res = await fetch(ENDPOINT, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
        signal:  controller.signal,
        body: JSON.stringify({
          model:           getModel(),
          temperature:     params.temperature ?? 0.7,
          max_tokens:      params.maxOutputTokens ?? 8192,
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
      if (!content) throw new Error('DeepSeek retornou conteúdo vazio');

      // Tokens usados — log para monitorar custo
      const usage = data?.usage;
      if (usage) {
        console.info(`[deepseek] tokens: ${usage.prompt_tokens} in / ${usage.completion_tokens} out`);
      }

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
