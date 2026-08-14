// 📁 flashmind-ai/src/server/contentAgent/config/agentConfig.ts
//
// Configuração central do FlashMind Content Agent. Nada de horário/limite
// fixo no código dos jobs — tudo lido daqui (e daqui, de env vars quando
// fizer sentido sobrepor sem redeploy).

import type { EducationLevel, CardContentType } from '../../db/firestoreSchema';

// ─── Helpers de leitura de env var ─────────────────────────────────────────
//
// GitHub Actions (e vários outros CI/CD) sempre define a env var quando ela
// está no `env:` do workflow, mesmo que o secret correspondente não exista
// no repo — nesse caso o valor vira string vazia (''), não `undefined`.
// `Number('') === 0` e `''.split(',')` retornam algo "verdadeiro" mas
// errado, então os defaults abaixo tratam string vazia como "não definido".

function envStr(name: string): string | undefined {
  const v = process.env[name];
  return v && v.trim() !== '' ? v : undefined;
}

function envInt(name: string, fallback: number): number {
  const v = envStr(name);
  if (v === undefined) return fallback;
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

export interface CardTargets {
  minimumCards: number;
  targetCards: number;
  maximumCards: number;
}

export interface ManagedSubject {
  subject: string;
  levels: EducationLevel[];
}

/**
 * Matérias que o agente mantém automaticamente. Diferente do fluxo do
 * usuário (que pode digitar qualquer assunto), o agente só varre este
 * conjunto curado — evita gastar IA em assuntos irrelevantes/spam.
 *
 * Pode ser sobreposto via env CONTENT_AGENT_SUBJECTS (JSON) sem redeploy.
 */
function loadManagedSubjects(): ManagedSubject[] {
  const raw = envStr('CONTENT_AGENT_SUBJECTS');
  if (raw) {
    try {
      const parsed = JSON.parse(raw) as ManagedSubject[];
      if (Array.isArray(parsed) && parsed.length > 0) return parsed;
    } catch (err) {
      console.warn('[agentConfig] CONTENT_AGENT_SUBJECTS inválido, usando lista padrão:', err);
    }
  }
  return [
    { subject: 'Português', levels: ['fundamental', 'medio'] },
    { subject: 'Matemática', levels: ['fundamental', 'medio'] },
    { subject: 'Biologia', levels: ['medio', 'faculdade'] },
    { subject: 'História do Brasil', levels: ['medio'] },
    { subject: 'Direito Constitucional', levels: ['concurso', 'faculdade'] },
    { subject: 'Direito Administrativo', levels: ['concurso', 'faculdade'] },
    { subject: 'Raciocínio Lógico', levels: ['concurso'] },
    { subject: 'Inglês', levels: ['fundamental', 'medio'] },
  ];
}

export const CARD_CONTENT_TYPES: CardContentType[] = [
  'definition', 'quiz', 'gap', 'comparison', 'applied', 'review',
];

/** Distribuição-alvo padrão entre tipos de card (%). Ajustável pelo Learning
 *  Engine no futuro (Etapa 7) — hoje é estática. */
export const DEFAULT_CARD_TYPE_DISTRIBUTION: Record<CardContentType, number> = {
  definition: 30,
  quiz: 20,
  gap: 10,
  comparison: 15,
  applied: 20,
  review: 5,
};

export const agentConfig = {
  enabled: envStr('CONTENT_AGENT_ENABLED') !== 'false',
  timezone: envStr('CONTENT_AGENT_TIMEZONE') || 'America/Campo_Grande',
  /** Cron expression — usada apenas como referência para configurar o Cloud
   *  Scheduler externo; o agente em si não agenda a própria execução. */
  schedule: envStr('CONTENT_AGENT_SCHEDULE') || '0 3 * * 0',

  managedSubjects: loadManagedSubjects(),

  defaultDifficulty: envStr('CONTENT_AGENT_DIFFICULTY') || 'medium',
  defaultLanguage: 'pt',

  cardTargets: {
    minimumCards: envInt('CONTENT_AGENT_MIN_CARDS', 20),
    targetCards: envInt('CONTENT_AGENT_TARGET_CARDS', 60),
    maximumCards: envInt('CONTENT_AGENT_MAX_CARDS', 150),
  } satisfies CardTargets,

  /** Tipos de card que o agente mantém por tópico. Rodar todos os 6 tipos
   *  para todo tópico em toda execução seria caro — por padrão cobrimos os
   *  2 mais usados no app; os demais entram na fila em ciclos futuros. */
  activeCardTypes: (envStr('CONTENT_AGENT_CARD_TYPES')
    ?.split(',')
    .map(s => s.trim())
    .filter(Boolean) as CardContentType[] | undefined) ?? (['definition', 'quiz'] as CardContentType[]),

  limits: {
    maxRuntimeMinutes: envInt('CONTENT_AGENT_MAX_RUNTIME_MIN', 25),
    maxCardsPerRun: envInt('CONTENT_AGENT_MAX_CARDS_PER_RUN', 500),
    maxAiCallsPerRun: envInt('CONTENT_AGENT_MAX_AI_CALLS', 50),
    maxTopicsPerRun: envInt('CONTENT_AGENT_MAX_TOPICS', 20),
    maxRetries: envInt('CONTENT_AGENT_MAX_RETRIES', 2),
    /** Cards gerados por chamada de IA (lote) — nunca peça tudo de uma vez. */
    batchSize: envInt('CONTENT_AGENT_BATCH_SIZE', 20),
    /** Máximo de cards removidos por tópico/tipo numa única revisão do
     *  CardUpdater — remoção em massa é arriscada demais para uma decisão
     *  automática; poucos cards por vez, o resto fica para o próximo ciclo. */
    maxCardsReviewedPerTopic: envInt('CONTENT_AGENT_MAX_CARDS_REVIEWED', 5),
  },

  /** Limiares mínimos de evidência antes do Learning Engine agir sobre
   *  feedback agregado por TÓPICO (dificuldade/flag de revisão). */
  feedbackThresholds: {
    minFeedbackCount: envInt('CONTENT_AGENT_MIN_FEEDBACK', 20),
    minNegativeCount: envInt('CONTENT_AGENT_MIN_NEGATIVE', 5),
    minNegativeRate: envInt('CONTENT_AGENT_MIN_NEGATIVE_RATE', 0.3),
  },

  /** Limiares para o CardUpdater decidir remover um CARD específico (não o
   *  tópico inteiro) de um balde já sinalizado para revisão. Menores que os
   *  de tópico de propósito — um card individual recebe muito menos
   *  avaliações que o agregado do tópico inteiro. */
  cardReviewThresholds: {
    minFeedbackCount: envInt('CONTENT_AGENT_CARD_MIN_FEEDBACK', 5),
    minNegativeRate: envInt('CONTENT_AGENT_CARD_MIN_NEGATIVE_RATE', 0.5),
  },
};

export type AgentConfig = typeof agentConfig;
