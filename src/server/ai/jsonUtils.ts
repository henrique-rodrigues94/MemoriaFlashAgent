// Utilitários para extrair JSON confiável da saída de LLMs que não possuem
// "structured output" nativo (todos exceto o Gemini). Modelos costumam
// envolver o JSON em blocos ```json ... ``` ou adicionar texto antes/depois.

export function extractJSON(raw: string): unknown {
  if (!raw) throw new Error('Resposta vazia do provedor de IA');

  let text = raw.trim();

  // Remove blocos de código markdown (```json ... ``` ou ``` ... ```)
  const fenceMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenceMatch) {
    text = fenceMatch[1].trim();
  }

  // Tenta parse direto primeiro
  try {
    return JSON.parse(text);
  } catch {
    // continua para extração heurística
  }

  // Extrai o primeiro objeto ou array JSON balanceado do texto
  const candidates = findBalancedJSONCandidates(text);
  for (const candidate of candidates) {
    try {
      return JSON.parse(candidate);
    } catch {
      continue;
    }
  }

  throw new Error('Não foi possível extrair JSON válido da resposta do provedor');
}

export function extractArrayField(payload: unknown, candidateKeys: string[] = ['cards', 'flashcards']): unknown[] {
  if (Array.isArray(payload)) return payload;
  if (!payload || typeof payload !== 'object') return [];

  const record = payload as Record<string, unknown>;
  for (const key of candidateKeys) {
    const value = record[key];
    if (Array.isArray(value)) return value;
  }

  for (const key of Object.keys(record)) {
    const value = record[key];
    if (Array.isArray(value)) return value;
  }

  return [];
}

function findBalancedJSONCandidates(text: string): string[] {
  const candidates: string[] = [];
  const openers = ['{', '['];
  const closers: Record<string, string> = { '{': '}', '[': ']' };

  for (let i = 0; i < text.length; i++) {
    if (!openers.includes(text[i])) continue;
    const open = text[i];
    const close = closers[open];
    let depth = 0;
    let inString = false;
    let escape = false;

    for (let j = i; j < text.length; j++) {
      const ch = text[j];
      if (inString) {
        if (escape) {
          escape = false;
        } else if (ch === '\\') {
          escape = true;
        } else if (ch === '"') {
          inString = false;
        }
        continue;
      }
      if (ch === '"') {
        inString = true;
        continue;
      }
      if (ch === open) depth++;
      if (ch === close) {
        depth--;
        if (depth === 0) {
          candidates.push(text.slice(i, j + 1));
          break;
        }
      }
    }
  }

  // Prioriza candidatos maiores primeiro (mais chance de ser o payload completo)
  return candidates.sort((a, b) => b.length - a.length);
}

/** Monta o bloco de instrução de formato que é anexado ao prompt de provedores sem JSON mode nativo. */
export function buildJSONInstruction(schemaHint: string): string {
  return `\n\nIMPORTANTE — FORMATO DE RESPOSTA:
Responda APENAS com um JSON válido, sem markdown, sem texto antes ou depois, sem comentários.
Formato esperado:
${schemaHint}`;
}
