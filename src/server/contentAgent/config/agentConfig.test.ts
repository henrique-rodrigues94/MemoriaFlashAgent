import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

const ENV_KEYS = [
  'CONTENT_AGENT_MIN_CARDS',
  'CONTENT_AGENT_TARGET_CARDS',
  'CONTENT_AGENT_MAX_CARDS',
  'CONTENT_AGENT_CARD_TYPES',
  'CONTENT_AGENT_ENABLED',
  'CONTENT_AGENT_SUBJECTS',
];

describe('agentConfig — env vars vazias (comum no GitHub Actions sem secret configurado)', () => {
  const original: Record<string, string | undefined> = {};

  beforeEach(() => {
    ENV_KEYS.forEach(k => { original[k] = process.env[k]; process.env[k] = ''; });
  });

  afterEach(() => {
    ENV_KEYS.forEach(k => {
      if (original[k] === undefined) delete process.env[k];
      else process.env[k] = original[k];
    });
  });

  it('não deixa string vazia virar 0 nos limiares numéricos', async () => {
    vi_reset();
    const { agentConfig } = await import('./agentConfig');
    expect(agentConfig.cardTargets.minimumCards).toBe(20);
    expect(agentConfig.cardTargets.targetCards).toBe(60);
    expect(agentConfig.cardTargets.maximumCards).toBe(150);
  });

  it('não deixa string vazia virar [""] em activeCardTypes', async () => {
    vi_reset();
    const { agentConfig } = await import('./agentConfig');
    expect(agentConfig.activeCardTypes).toEqual(['definition', 'quiz']);
  });

  it('CONTENT_AGENT_ENABLED vazio mantém o agente habilitado (default)', async () => {
    vi_reset();
    const { agentConfig } = await import('./agentConfig');
    expect(agentConfig.enabled).toBe(true);
  });

  it('CONTENT_AGENT_SUBJECTS vazio usa a lista curada padrão', async () => {
    vi_reset();
    const { agentConfig } = await import('./agentConfig');
    expect(agentConfig.managedSubjects.length).toBeGreaterThan(0);
  });
});

// vitest cacheia módulos por arquivo de teste; como agentConfig lê env vars
// no top-level do módulo, cada teste precisa de uma importação "fresca".
function vi_reset() {
  vi.resetModules();
}
