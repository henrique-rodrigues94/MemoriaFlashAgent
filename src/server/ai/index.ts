// 📁 flashmind-ai/src/server/ai/index.ts
//
// ════════════════════════════════════════════════════════════════════════════
//  ORQUESTRADOR DE IA — MemoriaFlash
// ════════════════════════════════════════════════════════════════════════════
//
//  Provedores configurados (em ordem de tentativa):
//
//  1. 🟢 Google Gemini   — PRINCIPAL   (gratuito, Google AI Studio)
//                           GEMINI_API_KEY no .env
//                           Modelo: gemini-2.5-flash (pode trocar via GEMINI_MODEL)
//
//  2. 🔵 DeepSeek V3     — SEGUNDO     (pago, custo muito baixo ~$0.27/1M tokens)
//                           DEEPSEEK_API_KEY no .env
//                           Modelo: deepseek-chat (pode trocar via DEEPSEEK_MODEL)
//
//  3. 🟡 OpenAI ChatGPT  — TERCEIRO    (pago, fallback de alta qualidade)
//                           OPENAI_API_KEY no .env
//                           Modelo: gpt-4o-mini (pode trocar via OPENAI_MODEL)
//
//  O orquestrador tenta cada provedor em ordem. O primeiro que responder
//  vence. Provedores sem chave configurada são pulados automaticamente.
//  Falhas ativam cooldown automático (ver AIOrchestrator.ts).
//
//  Para alterar ordem ou desativar um provedor, edite apenas este arquivo.
// ════════════════════════════════════════════════════════════════════════════

import { AIOrchestrator } from './AIOrchestrator';
import { AIProvider }     from './types';
import { geminiProvider }   from './providers/gemini';
import { deepseekProvider } from './providers/deepseek';
import { openaiProvider }   from './providers/openai';

const providers: AIProvider[] = [
  geminiProvider,   // 1º — gratuito, sem custo por token
  deepseekProvider, // 2º — pago, custo baixíssimo
  openaiProvider,   // 3º — pago, fallback de alta qualidade
];

export const aiOrchestrator = new AIOrchestrator(providers);

// Log de configuração no boot para facilitar debug
const configured = providers.filter(p => p.isConfigured()).map(p => p.label);
const missing    = providers.filter(p => !p.isConfigured()).map(p => `${p.label} (sem chave)`);

console.info(`[AI] Provedores ativos: ${configured.join(', ') || 'nenhum'}`);
if (missing.length > 0) {
  console.info(`[AI] Provedores inativos: ${missing.join(', ')}`);
}
if (configured.length === 0) {
  console.error('[AI] ⚠️  Nenhum provedor de IA configurado! Configure pelo menos GEMINI_API_KEY no .env');
}

export * from './types';
