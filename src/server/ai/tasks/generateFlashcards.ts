import { Type } from '@google/genai';
import { aiOrchestrator } from '../index';
import { extractArrayField } from '../jsonUtils';
import { getCardBucket, saveCardBucket, prefetchCardBuckets, BankCard, CardContentType } from '../../db/db';
import { bucketId } from '../../db/firestoreSchema';

/**
 * Normaliza uma pergunta para comparação de duplicatas: minúsculas, sem
 * acentuação, sem pontuação/espaços extras. Duas perguntas quase idênticas
 * (variando só maiúscula/pontuação) caem na mesma chave.
 */
export function normalizeForDedup(text: string): string {
  return (text || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '') // remove acentos
    .replace(/[^\w\s]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Rede de segurança determinística para a regra 6 do prompt: apesar da
 * instrução explícita, modelos às vezes ainda geram "explanation" que só
 * repete/parafraseia "back" (ex.: back="Paris" / explanation="A capital da
 * França é Paris."). Quando isso é detectado — o texto de "back" aparece
 * quase inteiro dentro de "explanation" sem nada além disso — substituímos
 * por um aviso didático em vez de mostrar uma explicação vazia de conteúdo.
 */
export function explanationJustRepeatsAnswer(back: string, explanation: string): boolean {
  const normBack = normalizeForDedup(back);
  // Remove os rótulos fixos que nós mesmos injetamos no prompt (regra 4) —
  // "explicacao"/"curiosidade" não são conteúdo gerado pelo modelo, então
  // não devem contar como "texto novo" ao medir o quanto sobra além da
  // resposta.
  const normExpl = normalizeForDedup(explanation)
    .replace(/\bexplicacao\b/g, '')
    .replace(/\bcuriosidade\b/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (!normBack || !normExpl) return false;

  // Resposta curta repetida 2+ vezes na explicação: forte sinal de que o
  // modelo só ficou reafirmando a resposta em vez de explicar algo novo.
  const occurrences = normExpl.split(normBack).length - 1;
  if (occurrences >= 2 && normBack.length >= 2) return true;

  // Caso geral: quanto sobra da explicação depois de remover o texto da
  // resposta? Se sobrar muito pouco, a "explicação" é essencialmente só a
  // resposta com enfeites, sem conteúdo didático novo.
  const remainder = normExpl.split(normBack).join(' ').replace(/\s+/g, ' ').trim();
  const remainderRatio = remainder.length / Math.max(normExpl.length, 1);
  const containsBack = normExpl.includes(normBack);
  return containsBack && remainderRatio < 0.35;
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

/** Distribui `total` em `slots` partes o mais equilibradas possível (a diferença entre a maior e a menor parte nunca passa de 1). */
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
  return topics.filter((topic) => {
    const value = typeof topic === 'string' ? topic.trim() : '';
    const key = normalizeForDedup(value);
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  }).map(topic => topic.trim());
}

/**
 * Gera exatamente `count` flashcards via IA para UM subtópico específico
 * (ou para o assunto geral, quando `topicLabel` é o próprio assunto).
 * Contém toda a lógica de prompt/schema/dedup/anti-repetição que antes
 * vivia direto em generateFlashcardsTask — agora reutilizável por balde.
 */
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

  const difficultyGuide =
    "'easy' = conceito fundamental/definição básica; 'medium' = aplicação prática/relação entre conceitos; " +
    "'hard' = exceção, pegadinha comum ou caso-limite; 'expert' = nível de banca de concurso/prova avançada.";

  const topicsInstruction = isSpecificTopic
    ? `\nFoque EXCLUSIVAMENTE no subtópico: "${topicLabel}". Não gere cards de outros subtópicos da matéria. Em TODOS os objetos, preencha "topic" exatamente com "${topicLabel}".`
    : '';

  const systemPrompt = `Você é o MemoriaFlash, especialista em criar flashcards educativos de alta retenção para o método de repetição espaçada (SRS SM-2).

REGRAS OBRIGATÓRIAS PARA CADA FLASHCARD:
1. "front" é sempre uma PERGUNTA clara e direta. "back" é sempre a RESPOSTA correspondente. Nunca inverta os dois, e nunca deixe front e back com o mesmo texto ou paráfrases óbvias um do outro.
   ❌ Errado: front="Mitocôndria" / back="Mitocôndria é a organela responsável pela respiração celular."
   ✅ Certo: front="Qual organela é responsável pela respiração celular e produção de ATP?" / back="A mitocôndria."
2. Nenhum card pode repetir a pergunta de outro card do mesmo lote, nem reformular a mesma pergunta com palavras diferentes ("card espelho"). Cada card deve testar um FATO ou RELAÇÃO distinta do conteúdo.
3. "difficulty" reflete a dificuldade REAL daquele card específico, não um valor fixo repetido em todos: ${difficultyGuide}
4. "explanation" é uma explicação didática do "back", começando com "📘 Explicação:" e incluindo uma curiosidade real e verificável do mundo real com "💡 Curiosidade:" — nunca invente fatos, datas ou números; se não tiver uma curiosidade genuína, foque em aprofundar a explicação do conceito em vez de inventar uma.
5. "topic" é o subtópico específico do conteúdo abordado por aquele card (não repita o nome da matéria inteira).
6. PROIBIDO copiar ou apenas reformular o texto de "back" dentro de "explanation": a explicação e a curiosidade devem acrescentar informação NOVA que não está em "back" (contexto, mecanismo, exemplo aplicado, dado histórico, comparação, consequência prática). Se "explanation" repetir o mesmo conteúdo de "back" com outras palavras, o card é considerado inválido.
   ❌ Errado: back="Paris" / explanation="📘 Explicação: A capital da França é Paris. 💡 Curiosidade: Paris é a capital da França."
   ✅ Certo: back="Paris" / explanation="📘 Explicação: Paris é sede do governo francês desde o século III. 💡 Curiosidade: A Torre Eiffel, símbolo da cidade, foi construída em 1889 para a Exposição Universal e era originalmente vista como provisória."
7. Todo o conteúdo (pergunta, resposta e explicação) deve respeitar o nível de ensino informado: ${levelLabel}. Não use conceitos, fórmulas ou vocabulário de um nível mais avançado do que o pedido, nem trate o aluno como se fosse mais novo/menos preparado do que o nível indicado.

FORMATO DOS CARDS — TIPO SOLICITADO PELO USUÁRIO:
${cardTypeInstruction}
Aplique esse formato em TODOS os ${count} cards gerados.

Responda sempre ${langInstruction}.`;

  const userPrompt = `Assunto: "${subject}"${topicsInstruction}
Nível de ensino do aluno: ${levelLabel}.
Nível-alvo de dificuldade do conjunto: ${difficulty} (varie individualmente ao redor desse nível conforme a regra 3, mas mantenha a maioria dos cards nesse patamar — sempre dentro do que é esperado para o nível de ensino informado).
Gere exatamente ${count} flashcards distintos entre si, cobrindo os conceitos, definições, fórmulas e relações mais importantes do assunto acima que fazem parte do currículo desse nível de ensino.`;

  const schemaHint = `[{ "front": string, "back": string, "explanation": string, "topic": string, "difficulty": "easy"|"medium"|"hard"|"expert" }, ...] — um array com exatamente ${count} objetos ("cards"), cada um com todos os 5 campos preenchidos.`;

  const geminiSchema = {
    type: Type.ARRAY,
    items: {
      type: Type.OBJECT,
      properties: {
        front: { type: Type.STRING },
        back: { type: Type.STRING },
        explanation: { type: Type.STRING },
        topic: { type: Type.STRING },
        difficulty: { type: Type.STRING },
      },
      required: ['front', 'back', 'topic', 'explanation', 'difficulty'],
    },
  };

  const { data, providerUsed } = await aiOrchestrator.generateJSON({
    systemPrompt,
    userPrompt,
    schemaHint,
    geminiSchema,
    // 280 tokens/card comportam frente, verso e explicação mantendo a saída
    // dos lotes grandes dentro do tempo esperado pelos provedores de fallback.
    maxOutputTokens: Math.max(8192, count * 280),
  });

  const rawCards = extractArrayField(data, ['cards', 'flashcards']) as Array<Record<string, unknown>>;

  // Dedup intra-lote: remove cards com front repetido no mesmo batch
  const seen = new Set<string>();
  const cards = rawCards.filter((card) => {
    const front = typeof card?.front === 'string' ? card.front : '';
    const back = typeof card?.back === 'string' ? card.back : '';
    const key = normalizeForDedup(front);
    if (!key || !back.trim() || seen.has(key)) return false;
    seen.add(key);
    return true;
  }).map(card => ({
    ...card,
    // O balde é definido pela escolha do usuário. Não usamos o tópico livre
    // retornado pelo modelo, que poderia ser mais amplo ou outro subtópico.
    topic: topicLabel,
  }));

  const removedCount = rawCards.length - cards.length;
  if (removedCount > 0) {
    console.info(`[generateFlashcards] ${removedCount} card(s) duplicado(s) removido(s) (provider: ${providerUsed}).`);
  }

  // Substitui explicações que só repetem a resposta
  let fixedExplanationCount = 0;
  const finalCards = cards.map((card) => {
    const back = typeof card?.back === 'string' ? card.back : '';
    const explanation = typeof card?.explanation === 'string' ? card.explanation : '';
    if (explanationJustRepeatsAnswer(back, explanation)) {
      fixedExplanationCount++;
      return { ...card, explanation: '📘 Revise este conceito com suas próprias palavras para fixar melhor o conteúdo.' };
    }
    return card;
  });
  if (fixedExplanationCount > 0) {
    console.info(`[generateFlashcards] ${fixedExplanationCount} explicação(ões) corrigida(s) (provider: ${providerUsed}).`);
  }

  return { cards: finalCards as unknown as BankCard[], providerUsed };
}

export async function generateFlashcardsTask(args: {
  prompt: string;
  count?: number;
  language?: string;
  difficulty?: string;
  selectedTopics?: string[];
  educationLevel?: EducationLevel;
  /**
   * 'subject' (padrão) → geração normal por matéria/tópico, PODE reaproveitar
   * e alimentar o banco compartilhado do Firestore.
   * 'document' → conteúdo extraído de um documento privado do usuário
   * (fluxo do Scanner). NUNCA passa pelo banco — geração de outro usuário
   * jamais deve vazar conteúdo do documento de ninguém, e vice-versa.
   */
  sourceType?: GenerationSourceType;
  /**
   * Fronts normalizados de cards já existentes no baralho do usuário.
   * A geração filtra esses fronts para não duplicar cards que o usuário já tem.
   */
  existingFronts?: string[];
  /** Tipo de card a gerar: 'definition' | 'quiz' | 'gap' | 'comparison' | 'applied' | 'review' */
  cardContentType?: string;
}) {
  const {
    prompt,
    count = 6,
    language = 'pt',
    difficulty = 'medium',
    selectedTopics = [],
    educationLevel = 'medio',
    sourceType = 'subject',
    existingFronts = [],
    cardContentType = 'definition',
  } = args;

  // Prompt adicional baseado no tipo de card escolhido pelo usuário
  const CARD_TYPE_PROMPTS: Record<string, string> = {
    definition:  'Gere flashcards no formato Pergunta→Definição/Conceito. A frente deve ser uma pergunta direta sobre o conceito. O verso deve trazer a definição completa e precisa.',
    quiz:        'Gere flashcards estilo questão de prova/concurso. A frente apresenta um enunciado desafiador com "pegadinhas" quando relevante. O verso traz a resposta correta e a justificativa.',
    gap:         'Gere flashcards de completar lacuna. A frente é uma frase com a palavra-chave omitida por ___. O verso traz a(s) palavra(s) que completam e uma breve explicação.',
    comparison:  'Gere flashcards de comparação. A frente pergunta a diferença/semelhança/relação entre dois conceitos. O verso apresenta a comparação de forma estruturada.',
    applied:     'Gere flashcards com situações práticas. A frente apresenta um cenário real e pergunta como aplicar o conceito. O verso traz o procedimento correto, lei aplicável ou solução fundamentada.',
    review:      'Gere flashcards de revisão rápida. Frente e verso devem ser ultra-concisos (máx 1 linha). Foco em fatos, datas, fórmulas, siglas e definições de memorização imediata.',
  };
  const cardTypeInstruction = CARD_TYPE_PROMPTS[cardContentType] ?? CARD_TYPE_PROMPTS['definition'];

  const useBank = sourceType === 'subject';

  // Set de fronts já existentes no baralho do usuário (para deduplicação)
  const existingFrontsSet = new Set<string>(existingFronts);

  // Cada slot é um "balde" independente: matéria + (tópico específico OU o
  // próprio assunto geral, quando nenhum tópico foi selecionado).
  // IMPORTANTE: count por tópico é distribuído APENAS entre os tópicos que
  // realmente receberão cards (count > 0), para nunca zerar um slot.
  const normalizedTopics = sanitizeTopics(selectedTopics);
  const topicsWithCount = normalizedTopics.length > 0
    ? normalizedTopics
        .map((topic, i) => ({
          topicLabel: topic,
          isSpecificTopic: true,
          count: distributeEvenly(count, selectedTopics.length)[i],
        }))
        .filter(s => s.count > 0)  // remove slots zerados
    : [{ topicLabel: prompt, isSpecificTopic: false, count }];

  const slots = topicsWithCount;

  let bankHits = 0;
  let aiGenerated = 0;
  const providersUsed = new Set<string>();
  const allCards: BankCard[] = [];

  // Prefetch todos os buckets em paralelo antes do loop — reduz latência total
  // de N × (1 Firestore read) para ~1 × (1 Firestore read) em paralelo.
  const prefetchedBuckets = useBank
    ? await prefetchCardBuckets(prompt, slots.map(s => s.topicLabel), educationLevel, cardContentType as CardContentType)
    : new Map<string, { cards: BankCard[]; stale: boolean }>();

  for (const slot of slots) {
    if (slot.count <= 0) continue;

    // 1. Usa resultado do prefetch (já em memória, 0 reads adicionais)
    const bId = bucketId(prompt, slot.topicLabel, educationLevel, cardContentType as CardContentType);
    const bankResult = prefetchedBuckets.get(bId) ?? { cards: [], stale: true };

    // Nunca devolva mais cards do que a quantidade solicitada. Quando o
    // bucket está expirado, ele não entra na resposta: geramos um lote novo e
    // o persistimos abaixo para renovar o banco.
    const bankCards = bankResult.stale ? [] : bankResult.cards.slice(0, slot.count);
    const bankStale = bankResult.stale;
    const enoughFromBank = bankCards.length >= slot.count && !bankStale;

    bankHits += bankCards.length;
    if (enoughFromBank) {
      // Banco tem cards suficientes e frescos — zero IA
      allCards.push(...bankCards);
      continue;
    }

    // 2. Banco vazio, insuficiente ou stale → gera via IA
    allCards.push(...bankCards); // aproveita o que tiver enquanto completa
    const shortfall = slot.count - bankCards.length;
    if (shortfall <= 0) continue;

    const { cards: generated, providerUsed } = await generateCardsForTopic({
      subject: prompt,
      topicLabel: slot.topicLabel,
      isSpecificTopic: slot.isSpecificTopic,
      count: shortfall,
      language,
      difficulty,
      educationLevel,
      cardTypeInstruction,
    });
    aiGenerated += generated.length;
    providersUsed.add(providerUsed);
    allCards.push(...generated);

    // 3. Salva no banco para próximas requisições (1 write por slot)
    // Aguardamos o commit para garantir que requests paralelos encontrem
    // os dados antes de chamar a IA novamente.
    if (useBank && generated.length > 0) {
      await saveCardBucket(
        prompt,
        slot.topicLabel,
        educationLevel,
        cardContentType as CardContentType,
        generated,
        providerUsed,
      );
    }
  }

  // Remove cards cujo front já existe no baralho do usuário
  const dedupedCards = existingFrontsSet.size > 0
    ? allCards.filter(c => {
        const normFront = normalizeForDedup(c.front || '');
        return !existingFrontsSet.has(normFront);
      })
    : allCards;

  // Avisa no log se muitos cards foram filtrados (indica necessidade de ampliar o prompt)
  const removedByDedup = allCards.length - dedupedCards.length;
  if (removedByDedup > 0) {
    console.info(`[generateFlashcards] ${removedByDedup} card(s) filtrado(s) por já existirem no baralho do usuário.`);
  }

  shuffle(dedupedCards);

  const providerUsed =
    aiGenerated === 0 ? 'bank' : providersUsed.size > 0 ? Array.from(providersUsed).join('+') : 'unknown';

  return { cards: dedupedCards, providerUsed, bankHits, aiGenerated };
}
