import { describe, expect, it } from 'vitest';
import { assertProductionEnvironment, validateProductionEnvironment } from './productionGate';

describe('production gate', () => {
  it('rejects strict production without required secrets', () => {
    const env = { CONTENT_AGENT_PRODUCTION_STRICT: 'true' } as NodeJS.ProcessEnv;
    expect(() => assertProductionEnvironment(env)).toThrow(/FIREBASE_PROJECT_ID/);
  });

  it('accepts strict production with bounded limits and required secrets', () => {
    const env = {
      CONTENT_AGENT_PRODUCTION_STRICT: 'true',
      CONTENT_AGENT_ENABLED: 'true',
      FIREBASE_PROJECT_ID: 'project',
      FIREBASE_CLIENT_EMAIL: 'agent@example.com',
      FIREBASE_PRIVATE_KEY: '-----BEGIN PRIVATE KEY-----\\nkey\\n-----END PRIVATE KEY-----',
      GEMINI_API_KEY: 'configured',
      CONTENT_AGENT_MAX_RUNTIME_MIN: '60',
      CONTENT_AGENT_MAX_AI_CALLS: '100',
      CONTENT_AGENT_MAX_CARDS_PER_RUN: '1000',
    } as NodeJS.ProcessEnv;
    expect(validateProductionEnvironment(env).every(check => check.ok)).toBe(true);
    expect(() => assertProductionEnvironment(env)).not.toThrow();
  });
});
