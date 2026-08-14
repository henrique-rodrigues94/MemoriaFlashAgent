// 📁 flashmind-ai/src/server/db/firestoreSchema.ts
//
// ════════════════════════════════════════════════════════════════════════════
//  SCHEMA CONSOLIDADO DO FIRESTORE — MemoriaFlash
// ════════════════════════════════════════════════════════════════════════════
//
// FILOSOFIA: "IA só quando não tem no banco"
//
// ┌─────────────────────────────────────────────────────────────────────────┐
// │  COLEÇÃO         │  PROPÓSITO                    │  CHAVE              │
// ├─────────────────────────────────────────────────────────────────────────┤
// │  subjects        │  Matérias + níveis detectados │  sha1(subjectNorm)  │
// │  curricula       │  Grade curricular por nível   │  sha1(subj+level)   │
// │  cardBuckets     │  Cards por tópico (em lote)   │  sha1(subj+topic    │
// │                  │                               │       +level+type)  │
// │  aiCache         │  Cache genérico de IA         │  sha256(task+payload│
// └─────────────────────────────────────────────────────────────────────────┘
//
// ── DETALHAMENTO ────────────────────────────────────────────────────────────
//
// subjects/{subjectId}
//   Guarda os níveis detectados pela IA para uma matéria.
//   Uma matéria = um documento. Nunca mais de ~200 bytes.
//   Evita chamar a IA toda vez que alguém digita "Biologia".
//
//   subjectId   = sha1(normalize(subject))  ex: "a3f9c1..."
//   subject     = "Biologia"
//   normalized  = "biologia"
//   levels      = [{ level, label, icon, reason, priority }]
//   updatedAt   = ISO string
//   ttlAt       = timestamp (90 dias) — quando expirar, re-gera
//
// ── ── ── ── ── ── ── ── ── ── ── ── ── ── ── ── ── ── ── ── ── ── ── ──
//
// curricula/{curriculumId}
//   Grade curricular (categorias + subtópicos) para subject+level.
//   Um doc por combinação. Compacto — todo conteúdo inline no doc.
//   Evita subcoleções = 1 read por grade, não N reads.
//
//   curriculumId = sha1(normalize(subject) + "|" + level)
//   subject      = "Biologia"
//   level        = "medio"
//   categories   = [{ category: string, topics: string[] }]  ← INLINE
//   totalTopics  = number  (desnormalizado para stats rápidos)
//   updatedAt    = ISO string
//   ttlAt        = timestamp (90 dias)
//   providerUsed = string
//
// ── ── ── ── ── ── ── ── ── ── ── ── ── ── ── ── ── ── ── ── ── ── ── ──
//
// cardBuckets/{bucketId}
//   Cards agrupados por (subject + topic + level + cardType) em UM SÓ DOC.
//   Isso é a maior otimização: antes eram N subcoleções (N reads).
//   Agora é 1 doc = 1 read para qualquer quantidade de cards do mesmo balde.
//
//   LIMITE: Firestore doc = 1 MB. Com ~500 bytes/card, cabe ~2000 cards/balde.
//   Na prática usamos max 100 cards/balde — muito dentro do limite.
//
//   bucketId     = sha1(normalize(subject) + "|" + normalize(topic)
//                      + "|" + level + "|" + cardType)
//   subject      = "Biologia"
//   topic        = "Mitocôndria"
//   level        = "medio"
//   cardType     = "definition" | "quiz" | "gap" | "comparison" | "applied" | "review"
//   cards        = BankCard[]  ← TODOS OS CARDS DO BALDE INLINE
//   cardCount    = number
//   updatedAt    = ISO string
//   ttlAt        = timestamp (60 dias)
//   providerUsed = string
//
// ── ── ── ── ── ── ── ── ── ── ── ── ── ── ── ── ── ── ── ── ── ── ── ──
//
// aiCache/{cacheId}
//   Cache genérico para respostas de IA que não se encaixam nas coleções
//   acima (ex: quiz diagnóstico, plano de recuperação, scanner, tutor).
//   Mantido separado porque esses dados NÃO são compartilhados entre usuários
//   (dependem de contexto pessoal) — só o cache de conteúdo genérico é.
//
//   cacheId      = sha256(taskId + JSON(payload))[:32]
//   taskId       = string (ex: "generateQuiz", "recoveryPlan")
//   value        = any
//   expiresAt    = timestamp
//   hitCount     = number
//
// ════════════════════════════════════════════════════════════════════════════
//
// REGRAS DE SEGURANÇA FIRESTORE (firestore.rules):
//
//   match /subjects/{id}      { allow read: if true; allow write: if false; }
//   match /curricula/{id}     { allow read: if true; allow write: if false; }
//   match /cardBuckets/{id}   { allow read: if true; allow write: if false; }
//   match /aiCache/{id}       { allow read: if false; allow write: if false; }
//
//   Leitura pública em subjects/curricula/cardBuckets é segura pois
//   são conteúdos educacionais genéricos, sem dados pessoais.
//   Escrita SEMPRE pelo servidor (Admin SDK) — nunca pelo cliente.
//
// ════════════════════════════════════════════════════════════════════════════

import { createHash } from 'crypto';

export type EducationLevel = 'fundamental' | 'medio' | 'faculdade' | 'concurso' | 'tecnico';

export type CardContentType =
  | 'definition' | 'quiz' | 'gap' | 'comparison' | 'applied' | 'review';

// ─── TTLs (em dias) ───────────────────────────────────────────────────────────

export const TTL_DAYS = {
  SUBJECT_LEVELS: 90,   // Níveis de uma matéria — raramente muda
  CURRICULUM:     90,   // Grade curricular — muito estável
  CARD_BUCKET:    60,   // Cards por tópico — pode melhorar com novos prompts
  AI_CACHE:       30,   // Cache genérico de IA
} as const;

// ─── Normalização ─────────────────────────────────────────────────────────────

export function normalizeText(text: string): string {
  return (text || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^\w\s]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

export function shortHash(text: string, len = 16): string {
  return createHash('sha1').update(text).digest('hex').slice(0, len);
}

export function sha256Hash(text: string, len = 32): string {
  return createHash('sha256').update(text).digest('hex').slice(0, len);
}

// ─── Geração de IDs determinísticos ──────────────────────────────────────────

export function subjectId(subject: string): string {
  return shortHash(normalizeText(subject));
}

export function curriculumId(subject: string, level: EducationLevel): string {
  return shortHash(`${normalizeText(subject)}|${level}`);
}

export function bucketId(
  subject: string,
  topic: string,
  level: EducationLevel,
  cardType: CardContentType = 'definition',
): string {
  return shortHash(`${normalizeText(subject)}|${normalizeText(topic)}|${level}|${cardType}`);
}

// ─── Tipos dos documentos ─────────────────────────────────────────────────────

export interface SubjectDoc {
  subject: string;
  normalized: string;
  levels: Array<{
    level: EducationLevel;
    label: string;
    icon: string;
    reason: string;
    priority: number;
  }>;
  updatedAt: string;
  ttlAt: number; // epoch ms
  providerUsed: string;
}

export interface CurriculumDoc {
  subject: string;
  level: EducationLevel;
  categories: Array<{
    category: string;
    topics: string[];
  }>;
  totalTopics: number;
  updatedAt: string;
  ttlAt: number;
  providerUsed: string;
}

export interface BankCard {
  id: string;          // sha1(normalize(front))[:16] — dedup
  front: string;
  back: string;
  explanation: string;
  topic: string;
  difficulty: string;
}

export interface CardBucketDoc {
  subject: string;
  topic: string;
  level: EducationLevel;
  cardType: CardContentType;
  cards: BankCard[];   // TODOS inline — 1 read = todos os cards do balde
  cardCount: number;
  updatedAt: string;
  ttlAt: number;
  providerUsed: string;
  /** Campos de revisão (Seção 20/21) — opcionais, só presentes depois que o
   *  Content Agent revisa o balde pelo menos uma vez. Ausência = nunca revisado. */
  qualityScore?: number;      // 0–1, derivado da taxa negativa de feedback no momento da revisão
  reviewVersion?: number;     // incrementa a cada revisão que remove cards
  lastReviewedAt?: string;
}

// ─── Feedback dos usuários ────────────────────────────────────────────────────
//
// cardFeedback/{feedbackId} — escrito DIRETO pelo cliente (Firebase client
// SDK + auth anônima, ver firestore.rules), não pelo backend. Cada doc é
// append-only: create permitido, read/update/delete negados a todos exceto
// Admin SDK (o Content Agent lê tudo via Admin SDK, que ignora as regras).
// Nenhum dado pessoal — nem o uid de quem avaliou é armazenado.

export type FeedbackRating = 'positive' | 'negative';

export type FeedbackReason =
  | 'confusing_question'
  | 'wrong_answer'
  | 'bad_explanation'
  | 'too_easy'
  | 'too_hard'
  | 'duplicate_content'
  | 'outdated_content'
  | 'other';

export interface CardFeedbackDoc {
  cardId: string;
  bucketId: string;
  subject: string;
  topic: string;
  level: EducationLevel;
  cardType: CardContentType;
  difficulty: string;
  rating: FeedbackRating;
  reason?: FeedbackReason; // só presente quando rating === 'negative'
  comment?: string;        // livre, truncado a 300 chars — ver regra no firestore.rules
  createdAt: string;
}


// ─── Helpers de TTL ───────────────────────────────────────────────────────────

export function makeTtl(days: number): number {
  return Date.now() + days * 24 * 60 * 60 * 1000;
}

export function isExpired(ttlAt: number | undefined): boolean {
  if (!ttlAt) return true;
  return Date.now() > ttlAt;
}
