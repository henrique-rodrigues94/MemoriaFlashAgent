export interface GenerateJSONParams {
  systemPrompt: string;
  userPrompt: string;
  schemaHint: string;
  geminiSchema?: unknown;
  temperature?: number;
  maxOutputTokens?: number;
  timeoutMs?: number;
  /** Ativa Google Search Grounding no Gemini para tarefas que exigem pesquisa web atual. */
  groundedSearch?: boolean;
}
export interface AIProvider { id:string; label:string; tier:'free'|'paid'|'local'; isConfigured():boolean; generateJSON(params:GenerateJSONParams):Promise<unknown>; }
export class AIProviderError extends Error { constructor(message:string,public readonly providerId:string,public readonly isRateLimited:boolean=false,public readonly httpStatus?:number){super(message);this.name='AIProviderError';} }
export interface ProviderStatus { id:string; label:string; tier:'free'|'paid'|'local'; configured:boolean; available:boolean; cooldownUntil?:number; lastError?:string; }
