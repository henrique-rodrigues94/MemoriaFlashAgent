export type AgentMode = 'automatic' | 'correction' | 'update_requested' | 'discover_new' | 'cleanup' | 'content_importer';

export const AGENT_MODES: readonly AgentMode[] = [
  'automatic',
  'correction',
  'update_requested',
  'discover_new',
  'cleanup',
  'content_importer',
] as const;

export function normalizeAgentMode(value: string | undefined): AgentMode {
  const mode = String(value || 'automatic').trim().toLowerCase();
  return (AGENT_MODES as readonly string[]).includes(mode) ? mode as AgentMode : 'automatic';
}
