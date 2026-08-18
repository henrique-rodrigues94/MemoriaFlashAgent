import { agentConfig } from '../config/agentConfig';
import { normalizeAgentMode } from '../config/agentModes';
import { getAdminFirestore } from '../../firebaseAdmin';
import { RunTracker, persistRunSummary, AgentRunSummary } from '../monitoring/runLogger';
import { correctCardsJob } from '../jobs/correctCardsJob';
import { discoverNewContentJob } from '../jobs/discoverNewContentJob';
import { cleanupCardsJob } from '../jobs/cleanupCardsJob';
import { updateRequestedContentJob } from '../jobs/updateRequestedContentJob';
import { publishStagedImportProduction } from '../importer/productionImporter';

const LOCK_ID='global';const LOCK_COLLECTION='agentLocks';const LOCK_TTL_MS=35*60*1000;
async function acquireAgentLease(runId:string):Promise<boolean>{const db=getAdminFirestore();if(!db){if(process.env.CONTENT_AGENT_PRODUCTION_STRICT==='true')throw new Error('Firebase Admin é obrigatório em produção; não foi possível adquirir o lease do Agent.');return true;}const ref=db.collection(LOCK_COLLECTION).doc(LOCK_ID);const now=Date.now();return db.runTransaction(async transaction=>{const snap=await transaction.get(ref);const current=snap.exists?snap.data()||{}:{};const currentExpiry=Number(current.expiresAt||0);const currentRunId=String(current.runId||'');if(currentRunId&&currentExpiry>now&&currentRunId!==runId)return false;transaction.set(ref,{runId,status:'running',mode:agentConfig.mode,acquiredAt:new Date(now).toISOString(),heartbeatAt:new Date(now).toISOString(),expiresAt:now+LOCK_TTL_MS},{merge:true});return true;});}
async function releaseAgentLease(runId:string):Promise<void>{const db=getAdminFirestore();if(!db)return;const ref=db.collection(LOCK_COLLECTION).doc(LOCK_ID);await db.runTransaction(async transaction=>{const snap=await transaction.get(ref);if(snap.exists&&String(snap.data()?.runId||'')===runId)transaction.set(ref,{status:'idle',releasedAt:new Date().toISOString(),expiresAt:Date.now()},{merge:true});});}
export async function runContentAgent():Promise<AgentRunSummary>{
  if(!agentConfig.enabled){const tracker=new RunTracker();tracker.stoppedReason='Agente desativado via CONTENT_AGENT_ENABLED=false';return tracker.toSummary('aborted');}
  const tracker=new RunTracker();const mode=normalizeAgentMode(process.env.CONTENT_AGENT_MODE||agentConfig.mode);const acquired=await acquireAgentLease(tracker.runId);if(!acquired){tracker.stoppedReason='Outro worker possui o lease global do Agent.';return tracker.toSummary('aborted');}
  tracker.log({action:'[agent] iniciando execução',detail:`${tracker.runId} | modo=${mode}`});
  try{
    if(mode==='content_importer'){
      const jobId=String(process.env.CONTENT_IMPORT_JOB_ID||'').trim();
      if(!jobId) throw new Error('CONTENT_IMPORT_JOB_ID é obrigatório no modo content_importer. Use o dashboard para validar e colocar o pacote em staging antes de publicar.');
      tracker.log({action:'[mode:content_importer] publicando completo.mflash staged',detail:`job=${jobId}`});
      await publishStagedImportProduction(jobId);
    }
    if(mode==='correction'||mode==='automatic'){tracker.log({action:'[mode:correction] corrigindo somente cards com feedback de erro'});await correctCardsJob(tracker);}
    if(mode==='update_requested'||mode==='automatic'){tracker.log({action:'[mode:update_requested] completando somente matérias/assuntos solicitados e faltantes'});await updateRequestedContentJob(tracker);}
    if(mode==='discover_new'){tracker.log({action:'[mode:discover_new] pesquisando candidatos antes de gerar qualquer card'});await discoverNewContentJob(tracker);}
    if(mode==='cleanup'){tracker.log({action:'[mode:cleanup] avaliando cards antigos por uso, relevância e qualidade'});await cleanupCardsJob(tracker);}
    if(mode==='automatic'&&agentConfig.discovery.enabled&&process.env.CONTENT_AGENT_AUTO_DISCOVERY==='true'){tracker.log({action:'[mode:automatic] descoberta opcional habilitada'});await discoverNewContentJob(tracker);}
    if(mode==='automatic'&&agentConfig.cleanup.enabled&&process.env.CONTENT_AGENT_AUTO_CLEANUP==='true'){tracker.log({action:'[mode:automatic] limpeza opcional habilitada'});await cleanupCardsJob(tracker);}
    const summary=tracker.toSummary('completed');await persistRunSummary(summary);tracker.log({action:'[agent] execução concluída',detail:`modo=${mode}; ${summary.cardsGenerated} cards gerados, ${summary.cardsReviewed} removidos/revisados, ${summary.topicsProcessed} tópicos, ${summary.feedbackAnalyzed} feedbacks, ${summary.adaptationsApplied} adaptações, ${summary.aiCalls} chamadas de IA, ${summary.errors} erro(s)`});return summary;
  }catch(err:any){tracker.errors++;tracker.log({action:'[agent] falha não tratada',detail:err?.message||String(err)});const summary=tracker.toSummary('failed');await persistRunSummary(summary);return summary;}
  finally{try{await releaseAgentLease(tracker.runId);}catch(err:any){console.error('[agent] Falha ao liberar lease:',err?.message||err);}}
}
