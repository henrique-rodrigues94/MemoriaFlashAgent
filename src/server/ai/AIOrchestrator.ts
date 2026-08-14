// 📁 flashmind-ai/src/server/ai/AIOrchestrator.ts
import { AIProvider, AIProviderError, GenerateJSONParams, ProviderStatus } from './types';

const RATE_LIMIT_COOLDOWN_MS  = 60  * 1000; // 60s para 429 / quota
const GENERIC_ERROR_COOLDOWN_MS = 90 * 1000; // 90s para outros erros
const MAX_RETRIES = 2;                         // tentativas por provedor antes de mover pro próximo
const RETRY_BASE_DELAY_MS = 800;               // base do backoff exponencial entre retries

interface CooldownEntry {
  until: number;
  lastError: string;
}

interface ProviderStats {
  hits: number;          // sucessos totais
  failures: number;      // falhas totais
  rateLimits: number;    // 429s recebidos
  totalLatencyMs: number; // latência acumulada (para calcular média)
}

/**
 * Orquestra múltiplos provedores de IA com:
 *  - Fallback automático (tenta o próximo quando um falha)
 *  - Circuit breaker com cooldown (evita martelar provedor em falha)
 *  - Retry com backoff exponencial por provedor (2 tentativas antes de desistir)
 *  - Estatísticas de uso por provedor (hits, failures, latência média)
 */
export class AIOrchestrator {
  private cooldowns = new Map<string, CooldownEntry>();
  private stats     = new Map<string, ProviderStats>();

  constructor(private providers: AIProvider[]) {
    providers.forEach(p => this.stats.set(p.id, { hits: 0, failures: 0, rateLimits: 0, totalLatencyMs: 0 }));
  }

  getProviders(): AIProvider[] { return this.providers; }

  private isAvailable(p: AIProvider): boolean {
    if (!p.isConfigured()) return false;
    const cd = this.cooldowns.get(p.id);
    return !(cd && Date.now() < cd.until);
  }

  private setCooldown(id: string, ms: number, errorMsg: string) {
    this.cooldowns.set(id, { until: Date.now() + ms, lastError: errorMsg });
  }

  resetCooldown(id: string) { this.cooldowns.delete(id); }

  private recordHit(id: string, latencyMs: number) {
    const s = this.stats.get(id)!;
    s.hits++;
    s.totalLatencyMs += latencyMs;
  }

  private recordFailure(id: string, isRateLimit: boolean) {
    const s = this.stats.get(id)!;
    s.failures++;
    if (isRateLimit) s.rateLimits++;
  }

  async generateJSON(params: GenerateJSONParams): Promise<{ data: unknown; providerUsed: string }> {
    const attempted: string[] = [];
    const errors: string[] = [];

    for (const provider of this.providers) {
      if (!this.isAvailable(provider)) continue;
      attempted.push(provider.id);

      // Retry com backoff exponencial dentro do mesmo provedor
      for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
        if (attempt > 0) {
          const delay = RETRY_BASE_DELAY_MS * Math.pow(2, attempt - 1); // 800ms, 1600ms
          await new Promise(r => setTimeout(r, delay));
        }

        const t0 = Date.now();
        try {
          const data = await provider.generateJSON(params);
          this.recordHit(provider.id, Date.now() - t0);
          return { data, providerUsed: provider.id };
        } catch (err) {
          const aiErr = err instanceof AIProviderError
            ? err
            : new AIProviderError(err instanceof Error ? err.message : String(err), provider.id);

          // Chave/modelo inválido ou rota inexistente não se recuperam com uma
          // nova tentativa. Pule imediatamente para o próximo provedor para o
          // usuário não aguardar os 2 backoffs antes de receber o fallback.
          const isPermanentClientError = [400, 401, 403, 404].includes(aiErr.httpStatus ?? 0);
          const isTimeout = /\btimeout\b/i.test(aiErr.message);
          if (isPermanentClientError || isTimeout) {
            this.recordFailure(provider.id, false);
            errors.push(`${provider.id}[${isTimeout ? 'timeout' : `HTTP ${aiErr.httpStatus}`}]: ${aiErr.message}`);
            if (provider.tier !== 'local') {
              this.setCooldown(provider.id, GENERIC_ERROR_COOLDOWN_MS, aiErr.message);
            }
            console.warn(`[AIOrchestrator] "${provider.id}" falhou (${isTimeout ? 'timeout' : `HTTP ${aiErr.httpStatus}`}); usando o próximo provedor.`);
            break;
          }

          // Rate limit = não adianta retry no mesmo provedor agora
          if (aiErr.isRateLimited) {
            this.recordFailure(provider.id, true);
            if (provider.tier !== 'local') {
              this.setCooldown(provider.id, RATE_LIMIT_COOLDOWN_MS, aiErr.message);
            }
            errors.push(`${provider.id}[rate-limit]: ${aiErr.message}`);
            console.warn(`[AIOrchestrator] "${provider.id}" rate-limited. Cooldown ${RATE_LIMIT_COOLDOWN_MS / 1000}s.`);
            break; // pula direto para o próximo provedor
          }

          this.recordFailure(provider.id, false);
          errors.push(`${provider.id}[attempt ${attempt + 1}]: ${aiErr.message}`);

          if (attempt === MAX_RETRIES) {
            // Esgotou retries neste provedor
            if (provider.tier !== 'local') {
              this.setCooldown(provider.id, GENERIC_ERROR_COOLDOWN_MS, aiErr.message);
            }
            console.warn(`[AIOrchestrator] "${provider.id}" falhou após ${MAX_RETRIES + 1} tentativa(s). Cooldown ${GENERIC_ERROR_COOLDOWN_MS / 1000}s.`);
          } else {
            console.warn(`[AIOrchestrator] "${provider.id}" falhou (tentativa ${attempt + 1}/${MAX_RETRIES + 1}). Retentando...`);
          }
        }
      }
    }

    throw new Error('Nenhum servidor de IA disponível no momento. Tente novamente em instantes.');
  }

  getStatus(): ProviderStatus[] {
    return this.providers.map(p => {
      const cd  = this.cooldowns.get(p.id);
      const st  = this.stats.get(p.id) ?? { hits: 0, failures: 0, rateLimits: 0, totalLatencyMs: 0 };
      const configured  = p.isConfigured();
      const inCooldown  = !!cd && Date.now() < cd.until;
      const totalCalls  = st.hits + st.failures;
      const avgLatencyMs = st.hits > 0 ? Math.round(st.totalLatencyMs / st.hits) : 0;
      const successRate  = totalCalls > 0 ? Math.round((st.hits / totalCalls) * 100) : null;

      return {
        id: p.id,
        label: p.label,
        tier: p.tier,
        configured,
        available: configured && !inCooldown,
        cooldownUntil: inCooldown ? cd!.until : undefined,
        lastError: cd?.lastError,
        stats: { ...st, avgLatencyMs, successRate, totalCalls },
      };
    });
  }
}
