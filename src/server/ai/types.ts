// ============================================================================
// MemoriaFlash — Camada de IA multi-provedor (Adapter Pattern)
// ----------------------------------------------------------------------------
// Nenhuma rota do servidor chama uma API de IA diretamente. Toda chamada passa
// pelo AIOrchestrator, que tenta uma lista ordenada de provedores GRATUITOS e
// faz fallback automático quando um provedor atinge limite de uso (HTTP 429),
// fica indisponível (timeout/erro 5xx) ou não está configurado (sem API key).
//
// Para trocar a ordem de prioridade ou adicionar um provedor novo, edite
// apenas `src/server/ai/index.ts`. Nenhuma outra parte do app precisa mudar.
// ============================================================================

export interface GenerateJSONParams {
  /** Instruções de sistema / persona da IA para a tarefa. */
  systemPrompt: string;
  /** Pedido específico do usuário / conteúdo a processar. */
  userPrompt: string;
  /**
   * Descrição em texto simples do formato JSON esperado. Todo provedor que
   * não suporta "structured output" nativo recebe essa descrição embutida no
   * prompt para maximizar a chance de retornar JSON válido.
   */
  schemaHint: string;
  /** Schema nativo do Gemini (Type.*). Ignorado pelos demais provedores. */
  geminiSchema?: unknown;
  temperature?: number;
  /** Máximo de tokens de saída — ESSENCIAL para decks grandes (padrão: 8192).
   *  Para 100 cards com explanation+curiosity, use pelo menos 32768. */
  maxOutputTokens?: number;
  /** Timeout em ms por tentativa (default definido no orquestrador). */
  timeoutMs?: number;
}

export interface AIProvider {
  /** Identificador curto, estável, usado em logs e no endpoint de status. */
  id: string;
  /** Nome amigável para exibir em telas de diagnóstico/admin. */
  label: string;
  /** Indica se é gratuito (para exibir badges na UI/admin). */
  tier: 'free' | 'paid' | 'local';
  /** true se a API key/variável de ambiente necessária está presente. */
  isConfigured(): boolean;
  /** Executa a chamada e retorna o JSON já parseado (lança erro em falha). */
  generateJSON(params: GenerateJSONParams): Promise<unknown>;
}

export class AIProviderError extends Error {
  constructor(
    message: string,
    public readonly providerId: string,
    public readonly isRateLimited: boolean = false,
    public readonly httpStatus?: number
  ) {
    super(message);
    this.name = 'AIProviderError';
  }
}

export interface ProviderStatus {
  id: string;
  label: string;
  tier: 'free' | 'paid' | 'local';
  configured: boolean;
  available: boolean;
  cooldownUntil?: number;
  lastError?: string;
}
