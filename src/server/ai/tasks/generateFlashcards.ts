import { Type } from '@google/genai';
import { aiOrchestrator } from '../index';
import { extractArrayField } from '../jsonUtils';
import { getCardBucket, saveCardBucket, prefetchCardBuckets, BankCard, CardContentType } from '../../db/db';
import { bucketId } from '../../db/firestoreSchema';

export function normalizeForDedup(text: string): string {
  return (text || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^\w\s]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

export function explanationJustRepeatsAnswer(back: string, explanation: string): boolean {
  const normBack = normalizeForDedup(back);
  const normExpl = normalizeForDedup(explanation)
    .replace(/\bexplicacao\b/g, '')
    .replace(/\bcuriosidade\b/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (!normBack || !normExpl) return false;
  const occurrences = normExpl.split(normBack).length - 1;
  if (occurrences >= 2 && normBack.length >= 2) return true;
  const remainder = normExpl.split(normBack).join(' ').replace(/\s+/g, ' ').trim();
  return normExpl.includes(normBack) && remainder.length / Math.max(normExpl.length, 1) < 0.35;
}

export type EducationLevel = 'fundamental' | 'medio' | 'faculdade' | 'concurso' | 'tecnico';
export type GenerationSourceType = 'subject' | 'document';

const EDUCATION_LEVEL_LABELS: Record<EducationLevel, string> = {
  fundamental: 'Ensino Fundamental (1º ao 9º ano) — linguagem simples, clara e didática, sem jargão técnico avançado',
  medio: 'Ensino Médio (1º ao 3º ano) — linguagem formal porém acessível, com foco em preparar para o ENEM/vestibular',
  faculdade: 'Ensino Superior / Faculdade — linguagem técnica e aprofundada, nível de graduação',
  concurso: 'Preparação para Concurso Público — foco em precisão de lei seca, jurisprudência/entendimento consolidado e pegadinhas comuns de banca examinadora (estilo CESPE/FGV/FCC), redigido como questão objetiva de prova',
  tecnico: 'Curso Técnico / Ensino Técnico Profissionalizante — foco prático, aplicado e voltado para procedimentos e uso real no dia a dia de trabalho, evitando teoria excessiva',
};

function distributeEvenly(total: number, slots: number): number[] {
  const base = Math.floor(total / slots);
  const remainder = total % slots;
  return Array.from({ length: slots }, (_, i) => base + (i < remainder ? 1 : 0));
}

function shuffle<T>(arr: T[]): T[] {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

function sanitizeTopics(topics: string[]): string[] {
  const seen = new Set<string>();
  return topics.filter(topic => {
    const value = typeof topic === 'string' ? topic.trim() : '';
    const key = normalizeForDedup(value);
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  }).map(topic => topic.trim());
}

async function generateCardsForTopic(args: {
  subject: string;
  topicLabel: string;
  isSpecificTopic: boolean;
  count: number;
  language: string;
  difficulty: string;
  educationLevel: EducationLevel;
  cardTypeInstruction: string;
}): Promise<{ cards: BankCard[]; providerUsed: string }> {
  const { subject, topicLabel, isSpecificTopic, count, language, difficulty, educationLevel, cardTypeInstruction } = args;
  const langInstruction = language === 'pt' ? 'em Português' : `in ${language}`;
  const levelLabel = EDUCATION_LEVEL_LABELS[educationLevel] || EDUCATION_LEVEL_LABELS.medio;
  const difficultyGuide = "'easy' = conceito fundamental/definição básica; 'medium' = aplicação prática/relação entre conceitos; 'hard' = exceção, pegadinha comum ou caso-limite; 'expert' = nível de banca de concurso/prova avançada.";
  const topicsInstruction = isSpecificTopic
    ? `\nFoque EXCLUSIVAMENTE no subtópico: "${topicLabel}". Não gere cards de outros subtópicos da matéria. Em TODOS os objetos, preencha "topic" exatamente com "${topicLabel}".`
    : '';

  const systemPrompt = `Você é o MemoriaFlash, especialista em criar flashcards educativos de alta retenção para o método de repetição espaçada (SRS SM-2).

REGRAS OBRIGATÓRIAS PARA CADA FLASHCARD:
1. "front" é sempre uma PERGUNTA clara e direta. "back" é sempre a RESPOSTA correspondente. Nunca inverta os dois, e nunca deixe front e back com o mesmo texto ou paráfrases óbvias um do outro.
2. Nenhum card pode repetir a pergunta de outro card do mesmo lote, nem reformular a mesma pergunta com palavras diferentes.
3. "difficulty" reflete a dificuldade REAL daquele card específico: ${difficultyGuide}
4. "explanation" é uma explicação didática do "back", começando com "📘 Explicação:" e incluindo uma curiosidade real e verificável com "💡 Curiosidade:" — nunca invente fatos.
5. "topic" é o subtópico específico do conteúdo abordado por aquele card.
6. PROIBIDO copiar ou apenas reformular o texto de "back" dentro de "explanation": a explicação deve acrescentar informação NOVA.
7. Todo o conteúdo deve respeitar o nível de ensino informado: ${levelLabel}.

FORMATO DOS CARDS — TIPO SOLICITADO:
${cardTypeInstruction}
Aplique esse formato em TODOS os ${count} cards.

Responda sempre ${langInstruction}.`;

  const userPrompt = `Assunto: "${subject}"${topicsInstruction}
Nível de ensino: ${levelLabel}.
Nível-alvo: ${difficulty}.
Gere exatamente ${count} flashcards distintos entre si, cobrindo os conceitos, definições, fórmulas e relações mais importantes do conteúdo.`;
  const schemaHint = `[{ "front": string, "back": string, "explanation": string, "topic": string, "difficulty": "easy"|"medium"|"hard"|"expert" }, ...] — exatamente ${count} objetos.`;
  const geminiSchema = {
    type: Type.ARRAY,
    items: {
      type: Type.OBJECT,
      properties: {
        front: { type: Type.STRING }, back: { type: Type.STRING }, explanation: { type: Type.STRING },
        topic: { type: Type.STRING }, difficulty: { type: Type.STRING },
      },
      required: ['front', 'back', 'topic', 'explanation', 'difficulty'],
    },
  };

  const { data, providerUsed } = await aiOrchestrator.generateJSON({ systemPrompt, userPrompt, schemaHint, geminiSchema, maxOutputTokens: Math.max(8192, count * 280) });
  const rawCards = extractArrayField(data, ['cards', 'flashcards']) as Array<Record<string, unknown>>;
  const seen = new Set<string>();
  const cards = rawCards.filter(card => {
    const front = typeof card?.front === 'string' ? card.front : '';
    const back = typeof card?.back === 'string' ? card.back : '';
    const key = normalizeForDedup(front);
    if (!key || !back.trim() || seen.has(key)) return false;
    seen.add(key);
    return true;
  }).map(card => ({ ...card, topic: topicLabel })) as Array<Record<string, unknown> & { topic: string }>;

  const removedCount = rawCards.length - cards.length;
  if (removedCount > 0) console.info(`[generateFlashcards] ${removedCount} card(s) duplicado(s) removido(s) (provider: ${providerUsed}).`);

  let fixedExplanationCount = 0;
  const finalCards = cards.map(card => {
    const back = typeof card.back === 'string' ? card.back : '';
    const explanation = typeof card.explanation === 'string' ? card.explanation : '';
    if (explanationJustRepeatsAnswer(back, explanation)) {
      fixedExplanationCount++;
      return { ...card, explanation: '📘 Revise este conceito com suas próprias palavras para fixar melhor o conteúdo.' };
    }
    return card;
  });
  if (fixedExplanationCount > 0) console.info(`[generateFlashcards] ${fixedExplanationCount} explicação(ões) corrigida(s) (provider: ${providerUsed}).`);

  return { cards: finalCards.slice(0, count) as unknown as BankCard[], providerUsed };
}

export async function generateFlashcardsTask(args: {
  prompt: string; count?: number; language?: string; difficulty?: string; selectedTopics?: string[];
  educationLevel?: EducationLevel; sourceType?: GenerationSourceType; existingFronts?: string[]; cardContentType?: string;
}) {
  const {
    prompt, count = 6, language = 'pt', difficulty = 'medium', selectedTopics = [], educationLevel = 'medio',
    sourceType = 'subject', existingFronts = [], cardContentType = 'definition',
  } = args;
  const CARD_TYPE_PROMPTS: Record<string, string> = {
    definition: 'Gere flashcards no formato Pergunta→Definição/Conceito. A frente deve ser uma pergunta direta sobre o conceito. O verso deve trazer a definição completa e precisa.',
    quiz: 'Gere flashcards estilo questão de prova/concurso. A frente apresenta um enunciado desafiador com pegadinhas quando relevante. O verso traz a resposta correta e a justificativa.',
    gap: 'Gere flashcards de completar lacuna. A frente é uma frase com a palavra-chave omitida por ___. O verso traz a(s) palavra(s) que completam e uma breve explicação.',
    comparison: 'Gere flashcards de comparação. A frente pergunta a diferença/semelhança/relação entre dois conceitos. O verso apresenta a comparação de forma estruturada.',
    applied: 'Gere flashcards com situações práticas. A frente apresenta um cenário real e pergunta como aplicar o conceito. O verso traz o procedimento correto, lei aplicável ou solução fundamentada.',
    review: 'Gere flashcards de revisão rápida. Frente e verso devem ser ultra-concisos. Foco em fatos, datas, fórmulas, siglas e definições de memorização imediata.',
  };
  const cardTypeInstruction = CARD_TYPE_PROMPTS[cardContentType] ?? CARD_TYPE_PROMPTS.definition;
  const useBank = sourceType === 'subject';
  const existingFrontsSet = new Set<string>(existingFronts);
  const normalizedTopics = sanitizeTopics(selectedTopics);
  const topicsWithCount = normalizedTopics.length > 0
    ? normalizedTopics.map((topic, i) => ({ topicLabel: topic, isSpecificTopic: true, count: distributeEvenly(count, selectedTopics.length)[i] })).filter(s => s.count > 0)
    : [{ topicLabel: prompt, isSpecificTopic: false, count }];
  let bankHits = 0;
  let aiGenerated = 0;
  const providersUsed = new Set<string>();
  const allCards: BankCard[] = [];
  const prefetchedBuckets = useBank
    ? await prefetchCardBuckets(prompt, topicsWithCount.map(s => s.topicLabel), educationLevel, cardContentType as CardContentType)
    : new Map<string, { cards: BankCard[]; stale: boolean }>();

  for (const slot of topicsWithCount) {
    const bId = bucketId(prompt, slot.topicLabel, educationLevel, cardContentType as CardContentType);
    const bankResult = prefetchedBuckets.get(bId) ?? { cards: [], stale: true };
    const bankCards = bankResult.stale ? [] : bankResult.cards.slice(0, slot.count);
    bankHits += bankCards.length;
    if (bankCards.length >= slot.count) {
      allCards.push(...bankCards);
      continue;
    }
    allCards.push(...bankCards);
    const shortfall = slot.count - bankCards.length;
    if (shortfall <= 0) continue;
    const { cards: generated, providerUsed } = await generateCardsForTopic({
      subject: prompt, topicLabel: slot.topicLabel, isSpecificTopic: slot.isSpecificTopic, count: shortfall,
      language, difficulty, educationLevel, cardTypeInstruction,
    });
    aiGenerated += generated.length;
    providersUsed.add(providerUsed);
    allCards.push(...generated);
    if (useBank && generated.length > 0) {
      await saveCardBucket(prompt, slot.topicLabel, educationLevel, cardContentType as CardContentType, generated, providerUsed);
    }
  }

  const dedupedCards = existingFrontsSet.size > 0
    ? allCards.filter(card => !existingFrontsSet.has(normalizeForDedup(card.front || '')))
    : allCards;
  const removedByDedup = allCards.length - dedupedCards.length;
  if (removedByDedup > 0) console.info(`[generateFlashcards] ${removedByDedup} card(s) filtrado(s) por já existirem no baralho do usuário.`);
  shuffle(dedupedCards);
  return {
    cards: dedupedCards,
    providerUsed: aiGenerated === 0 ? 'bank' : providersUsed.size > 0 ? Array.from(providersUsed).join('+') : 'unknown',
    bankHits,
    aiGenerated,
  };
}
