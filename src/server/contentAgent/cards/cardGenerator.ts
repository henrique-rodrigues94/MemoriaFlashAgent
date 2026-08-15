// 📁 flashmind-ai/src/server/contentAgent/cards/cardGenerator.ts
//
// NÃO reimplementa geração/validação/dedup — chama generateFlashcardsTask,
// que já faz: checar cardBucket → gerar só o shortfall via IA → filtrar
// explicação-que-repete-resposta → deduplicar por hash → salvar no bucket
// compartilhado (Seções 4, 10 e 11 do briefing).
//
// A única responsabilidade daqui é: quebrar necessidades grandes em lotes
// (Seção 9 — "nunca gerar milhares de cards em uma única chamada") e
// respeitar os limites por execução (Seção 25).

import { generateFlashcardsTask } from '../../ai/tasks/generateFlashcards';
import { agentConfig } from '../config/agentConfig';
import { TopicNeed } from '../curriculum/topicAnalyzer';
import { RunTracker } from '../monitoring/runLogger';
import { loadAdaptations, resolveAdaptedDifficulty } from '../feedback/adaptationRepository';

export interface CardGenerationOutcome {
  requested: number;
  cardsGenerated: number; // gerados via IA (exclui cards já vindos do banco)
  aiCalls: number;
  stoppedByLimits: boolean;
}

/**
 * Gera (se necessário) os cards faltantes para um TopicNeed, em lotes de
 * até `limits.batchSize`. Se um lote falhar, os lotes anteriores já foram
 * salvos no bucket (generateFlashcardsTask salva incrementalmente) — nada
 * se perde (Seção 9, "se um lote falhar, não perder os lotes anteriores").
 *
 * A dificuldade usada por padrão (agentConfig.defaultDifficulty) pode ser
 * sobreposta por tópico/tipo pelo Learning Engine (Seção 19) — ver
 * feedback/adaptationRepository.ts. Sem feedback suficiente, comporta-se
 * exatamente como antes (offset 0 → dificuldade padrão inalterada).
 */
export async function generateForTopicNeed(
  need: TopicNeed,
  tracker: RunTracker,
): Promise<CardGenerationOutcome> {
  const { batchSize, maxAiCallsPerRun, maxCardsPerRun } = agentConfig.limits;
  let remaining = need.shortfall;
  let cardsGenerated = 0;
  let aiCalls = 0;
  let stoppedByLimits = false;

  const adaptations = await loadAdaptations(need.subject, need.level);
  const adaptation = adaptations?.topics[`${need.topic}::${need.cardType}`];
  const difficulty = adaptation
    ? resolveAdaptedDifficulty(agentConfig.defaultDifficulty, adaptation.difficultyStepOffset)
    : agentConfig.defaultDifficulty;

  if (adaptation && difficulty !== agentConfig.defaultDifficulty) {
    tracker.log({
      action: '[cards] usando dificuldade adaptada por feedback',
      subject: need.subject,
      topic: need.topic,
      detail: `${agentConfig.defaultDifficulty} → ${difficulty}`,
    });
  }

  while (remaining > 0) {
    if (tracker.aiCalls >= maxAiCallsPerRun) {
      stoppedByLimits = true;
      tracker.stoppedReason = 'maxAiCallsPerRun atingido';
      break;
    }
    if (tracker.cardsGenerated >= maxCardsPerRun) {
      stoppedByLimits = true;
      tracker.stoppedReason = 'maxCardsPerRun atingido';
      break;
    }
    if (tracker.elapsedMinutes() >= agentConfig.limits.maxRuntimeMinutes) {
      stoppedByLimits = true;
      tracker.stoppedReason = 'maxRuntimeMinutes atingido';
      break;
    }

    // O lote nunca pode ultrapassar o orçamento restante da execução.
    // Ex.: com 495/500 cards, o lote máximo passa a ser 5, não 20.
    const remainingCardBudget = Math.max(0, maxCardsPerRun - tracker.cardsGenerated);
    const batchCount = Math.min(remaining, batchSize, remainingCardBudget);
    if (batchCount <= 0) {
      stoppedByLimits = true;
      tracker.stoppedReason = 'maxCardsPerRun atingido';
      break;
    }

    try {
      const result = await generateFlashcardsTask({
        prompt: need.subject,
        count: batchCount,
        language: agentConfig.defaultLanguage,
        difficulty,
        selectedTopics: [need.topic],
        educationLevel: need.level,
        sourceType: 'subject', // usa e alimenta o banco compartilhado
        cardContentType: need.cardType,
      });

      aiCalls++;
      tracker.aiCalls++;

      const generatedThisBatch = result.aiGenerated ?? 0;
      cardsGenerated += generatedThisBatch;
      tracker.cardsGenerated += generatedThisBatch;

      tracker.log({
        action: '[cards] lote gerado',
        subject: need.subject,
        topic: need.topic,
        detail: `${need.cardType}/${need.level}: +${generatedThisBatch} via IA, ${result.bankHits} do banco (provider: ${result.providerUsed})`,
      });

      // O shortfall é reduzido pelo que realmente foi gerado. Assim, se a
      // IA/de-duplicação devolver menos que o solicitado, o agente não marca
      // falsamente o tópico como completo.
      remaining -= generatedThisBatch;
      if (generatedThisBatch <= 0) {
        tracker.errors++;
        tracker.log({
          action: '[cards] lote sem geração',
          subject: need.subject,
          topic: need.topic,
          detail: `A IA/banco não devolveu cards para um lote de ${batchCount}.`,
        });
        break;
      }
    } catch (err: any) {
      tracker.errors++;
      tracker.log({
        action: '[cards] falha no lote',
        subject: need.subject,
        topic: need.topic,
        detail: err?.message || String(err),
      });
      // Não retenta indefinidamente o mesmo tópico dentro da execução —
      // segue para o próximo need do plano; lotes já salvos permanecem.
      break;
    }
  }

  return { requested: need.shortfall, cardsGenerated, aiCalls, stoppedByLimits };
}
