import { getAdminFirestore } from '../../firebaseAdmin';
import { identifySubjectLevelsTask } from '../../ai/tasks/identifySubjectLevels';
import { generateCurriculumHierarchyTask } from '../../ai/tasks/generateCurriculumHierarchy';
import { analyzeSubjectLevel } from '../curriculum/topicAnalyzer';
import { generateForTopicNeed } from '../cards/cardGenerator';
import { agentConfig } from '../config/agentConfig';
import { RunTracker } from '../monitoring/runLogger';
import { loadDocumentSource } from './documentSource';
import type { ContentRequestDoc, EducationLevel } from '../../db/firestoreSchema';

function readSubject(data: ContentRequestDoc): string { return String(data.subject || data.requestedSubject || '').trim(); }
function readRequestedAt(data: ContentRequestDoc): string { return String(data.requestedAt || data.createdAt || ''); }

async function findCompletedSourceRequest(db: FirebaseFirestore.Firestore, sourceHash: string, currentRequestId: string): Promise<string | null> {
  if (!sourceHash) return null;
  const snap = await db.collection('contentRequests').where('source.sourceHash', '==', sourceHash).limit(20).get();
  const duplicate = snap.docs.find((doc) => doc.id !== currentRequestId && doc.data().status === 'completed');
  return duplicate?.id || null;
}

async function recoverStalledRequests(db: FirebaseFirestore.Firestore, tracker: RunTracker): Promise<void> {
  const cutoff = Date.now() - agentConfig.limits.requestProcessingTimeoutMinutes * 60_000;
  const snap = await db.collection('contentRequests').where('status', '==', 'processing').limit(50).get();

  for (const request of snap.docs) {
    const data = request.data() as ContentRequestDoc;
    const updatedAt = Date.parse(String(data.updatedAt || data.createdAt || ''));
    if (!Number.isFinite(updatedAt) || updatedAt >= cutoff) continue;

    const attempts = Number(data.attempts || 0);
    const now = new Date().toISOString();
    if (attempts < agentConfig.limits.maxRetries) {
      await request.ref.set({
        status: 'pending',
        updatedAt: now,
        recoveredAt: now,
        lastError: `Processamento recuperado após timeout de ${agentConfig.limits.requestProcessingTimeoutMinutes} minutos.`,
      }, { merge: true });
      tracker.log({
        action: '[request] processamento recuperado',
        subject: readSubject(data),
        detail: `${request.id} voltou para pending (tentativa ${attempts + 1}/${agentConfig.limits.maxRetries})`,
      });
    } else {
      await request.ref.set({
        status: 'failed',
        updatedAt: now,
        recoveredAt: now,
        error: `Processamento abandonado após ${attempts} tentativa(s) e timeout de ${agentConfig.limits.requestProcessingTimeoutMinutes} minutos.`,
      }, { merge: true });
      tracker.errors++;
      tracker.log({
        action: '[request] processamento encerrado após timeout',
        subject: readSubject(data),
        detail: `${request.id} excedeu o máximo de ${agentConfig.limits.maxRetries} tentativa(s)`,
      });
    }
  }
}

async function retryFailedRequests(db: FirebaseFirestore.Firestore, tracker: RunTracker): Promise<void> {
  const snap = await db.collection('contentRequests').where('status', '==', 'failed').limit(50).get();
  for (const request of snap.docs) {
    const data = request.data() as ContentRequestDoc;
    const attempts = Number(data.attempts || 0);
    if (attempts >= agentConfig.limits.maxRetries) continue;

    const now = new Date().toISOString();
    await request.ref.set({
      status: 'pending',
      updatedAt: now,
      lastError: data.error || data.lastError || null,
    }, { merge: true });
    tracker.log({
      action: '[request] falha elegível para retry',
      subject: readSubject(data),
      detail: `${request.id} voltou para pending (${attempts + 1}/${agentConfig.limits.maxRetries})`,
    });
  }
}

export async function processContentRequestsJob(tracker: RunTracker): Promise<void> {
  const db = getAdminFirestore();
  if (!db) return;

  await recoverStalledRequests(db, tracker);
  await retryFailedRequests(db, tracker);

  const snap = await db.collection('contentRequests').where('status', '==', 'pending').limit(agentConfig.limits.maxContentRequestsPerRun).get();
  const requests = [...snap.docs].sort((a, b) => readRequestedAt(a.data() as ContentRequestDoc).localeCompare(readRequestedAt(b.data() as ContentRequestDoc)));

  for (const request of requests) {
    if (tracker.elapsedMinutes() >= agentConfig.limits.maxRuntimeMinutes) {
      tracker.stoppedReason = tracker.stoppedReason || 'maxRuntimeMinutes atingido durante pedidos de usuários';
      break;
    }
    if (tracker.aiCalls >= agentConfig.limits.maxAiCallsPerRun) {
      tracker.stoppedReason = tracker.stoppedReason || 'maxAiCallsPerRun atingido durante pedidos de usuários';
      break;
    }

    const data = request.data() as ContentRequestDoc;
    const subject = readSubject(data);
    if (!subject) {
      await request.ref.set({ status: 'failed', updatedAt: new Date().toISOString(), error: 'subject vazio' }, { merge: true });
      continue;
    }

    const sourceHash = String((data as any).source?.sourceHash || '').trim();
    const duplicateRequestId = await findCompletedSourceRequest(db, sourceHash, request.id);
    if (duplicateRequestId) {
      await request.ref.set({
        status: 'completed',
        updatedAt: new Date().toISOString(),
        duplicateOf: duplicateRequestId,
        progress: { levels: 0, curriculaReady: 0, leavesDiscovered: 0, cardsGenerated: 0 },
        error: null,
      }, { merge: true });
      tracker.log({ action: '[request] fonte já processada', subject, detail: `${request.id} reutilizou conteúdo de ${duplicateRequestId}${sourceHash ? ' [SHA-256]' : ''}` });
      continue;
    }

    const sourceContext = await loadDocumentSource(request.id);
    const hasDocumentSource = Boolean(sourceContext.trim());
    const attempt = Number(data.attempts || 0) + 1;
    await request.ref.set({
      status: 'processing',
      attempts: attempt,
      updatedAt: new Date().toISOString(),
      progress: { levels: 0, curriculaReady: 0, leavesDiscovered: 0, cardsGenerated: 0 },
    }, { merge: true });
    tracker.log({ action: '[request] processando conteúdo solicitado', subject, detail: `${request.id}${hasDocumentSource ? ' [PDF/TXT]' : ''} [tentativa ${attempt}/${agentConfig.limits.maxRetries}]` });

    try {
      const levelResult = data.educationLevel ? { levels: [{ level: data.educationLevel }] } : await identifySubjectLevelsTask(subject);
      if (!data.educationLevel) tracker.aiCalls++;
      const levels = levelResult.levels.map((item: any) => item.level as EducationLevel).filter(Boolean).slice(0, 5);
      if (levels.length === 0) throw new Error('Não foi possível identificar o nível educacional do assunto.');

      let curriculaReady = 0;
      let leavesDiscovered = 0;
      let cardsGenerated = 0;
      for (const level of levels) {
        if (tracker.elapsedMinutes() >= agentConfig.limits.maxRuntimeMinutes || tracker.aiCalls >= agentConfig.limits.maxAiCallsPerRun) break;
        const curriculum = await generateCurriculumHierarchyTask({ subject, educationLevel: level, language: agentConfig.defaultLanguage, sourceContext: sourceContext || undefined });
        if (!curriculum.cacheHit) tracker.aiCalls++;
        curriculaReady++;
        tracker.log({
          action: '[curriculum] grade gerada',
          subject,
          detail: `nível=${level}, categorias=${curriculum.categories.length}, tópicos=${curriculum.categories.reduce((n, c) => n + c.topics.length, 0)}, subtópicos=${curriculum.categories.reduce((n, c) => n + Object.values(c.subtopics).reduce((m, s) => m + s.length, 0), 0)}${hasDocumentSource ? ' [fonte]' : ''}`,
        });
        const needs = await analyzeSubjectLevel(subject, level);
        leavesDiscovered += needs.length;
        for (const need of needs.slice(0, agentConfig.limits.maxRequestTopicsPerRun)) {
          if (tracker.aiCalls >= agentConfig.limits.maxAiCallsPerRun || tracker.cardsGenerated >= agentConfig.limits.maxCardsPerRun) break;
          const outcome = await generateForTopicNeed(need, tracker, sourceContext);
          cardsGenerated += outcome.cardsGenerated;
          tracker.topicsProcessed++;
          if (outcome.stoppedByLimits) break;
        }
      }

      let remainingNeeds = 0;
      for (const level of levels) remainingNeeds += (await analyzeSubjectLevel(subject, level)).length;
      const complete = curriculaReady === levels.length && remainingNeeds === 0;
      const progress = { levels: levels.length, curriculaReady, leavesDiscovered, cardsGenerated };
      const update: Record<string, unknown> = {
        status: complete ? 'completed' : 'pending',
        updatedAt: new Date().toISOString(),
        progress,
      };
      if (complete) update.error = null;
      else update.lastError = `Ciclo interrompido com ${remainingNeeds} necessidade(s) restante(s).`;
      await request.ref.set(update, { merge: true });
      tracker.log({
        action: complete ? '[request] conteúdo disponibilizado' : '[request] conteúdo aguardando próximo ciclo',
        subject,
        detail: `${curriculaReady} grade(s), ${leavesDiscovered} folhas, +${cardsGenerated} cards, ${remainingNeeds} necessidades restantes${hasDocumentSource ? ' [PDF/TXT]' : ''}`,
      });
      if (!complete) break;
    } catch (err: any) {
      tracker.errors++;
      const message = String(err?.message || err).slice(0, 500);
      const shouldRetry = attempt < agentConfig.limits.maxRetries;
      await request.ref.set({
        status: shouldRetry ? 'pending' : 'failed',
        updatedAt: new Date().toISOString(),
        lastError: message,
        ...(shouldRetry ? {} : { error: message }),
      }, { merge: true });
      tracker.log({
        action: shouldRetry ? '[request] falha temporária, retry agendado' : '[request] falha definitiva',
        subject,
        detail: `${request.id}: ${message} (${attempt}/${agentConfig.limits.maxRetries})`,
      });
    }
  }
}
