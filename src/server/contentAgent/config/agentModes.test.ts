import { describe, expect, it } from 'vitest';
import { normalizeAgentMode } from './agentModes';

describe('agent modes',()=>{
  it('accepts all operational modes',()=>{
    expect(normalizeAgentMode('correction')).toBe('correction');
    expect(normalizeAgentMode('update_requested')).toBe('update_requested');
    expect(normalizeAgentMode('discover_new')).toBe('discover_new');
    expect(normalizeAgentMode('cleanup')).toBe('cleanup');
    expect(normalizeAgentMode('automatic')).toBe('automatic');
  });
  it('falls back safely for invalid values',()=>{
    expect(normalizeAgentMode('anything')).toBe('automatic');
    expect(normalizeAgentMode(undefined)).toBe('automatic');
  });
});
