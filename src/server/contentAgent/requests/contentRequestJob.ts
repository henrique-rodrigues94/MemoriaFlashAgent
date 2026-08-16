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

export async function processContentRequestsJob(tracker: RunTracker): Promise<void> {
  const db=getAdminFirestore();if(!db)return;
  const snap=await db.collection('contentRequests').where('status','==','pending').limit(agentConfig.limits.maxContentRequestsPerRun).get();
  const requests=[...snap.docs].sort((a,b)=>readRequestedAt(a.data() as ContentRequestDoc).localeCompare(readRequestedAt(b.data() as ContentRequestDoc)));

  for(const request of requests){
    if(tracker.elapsedMinutes()>=agentConfig.limits.maxRuntimeMinutes){tracker.stoppedReason=tracker.stoppedReason||'maxRuntimeMinutes atingido durante pedidos de usuários';break;}
    if(tracker.aiCalls>=agentConfig.limits.maxAiCallsPerRun){tracker.stoppedReason=tracker.stoppedReason||'maxAiCallsPerRun atingido durante pedidos de usuários';break;}
    const data=request.data() as ContentRequestDoc;const subject=readSubject(data);
    if(!subject){await request.ref.set({status:'failed',updatedAt:new Date().toISOString(),error:'subject vazio'},{merge:true});continue;}

    const sourceHash=String((data as any).source?.sourceHash||'').trim();
    const duplicateRequestId=await findCompletedSourceRequest(db,sourceHash,request.id);
    if(duplicateRequestId){
      await request.ref.set({status:'completed',updatedAt:new Date().toISOString(),duplicateOf:duplicateRequestId,progress:{levels:0,curriculaReady:0,leavesDiscovered:0,cardsGenerated:0},error:null},{merge:true});
      tracker.log({action:'[request] fonte já processada',subject,detail:`${request.id} reutilizou conteúdo de ${duplicateRequestId}${sourceHash?' [SHA-256]':''}`});
      continue;
    }

    const sourceContext=await loadDocumentSource(request.id);
    const hasDocumentSource=Boolean(sourceContext.trim());
    await request.ref.set({status:'processing',attempts:(data.attempts??0)+1,updatedAt:new Date().toISOString(),progress:{levels:0,curriculaReady:0,leavesDiscovered:0,cardsGenerated:0}},{merge:true});
    tracker.log({action:'[request] processando conteúdo solicitado',subject,detail:`${request.id}${hasDocumentSource?' [PDF/TXT]':''}`});

    try{
      const levelResult=data.educationLevel?{levels:[{level:data.educationLevel}]}:await identifySubjectLevelsTask(subject);
      if(!data.educationLevel)tracker.aiCalls++;
      const levels=levelResult.levels.map((item:any)=>item.level as EducationLevel).filter(Boolean).slice(0,5);
      if(levels.length===0)throw new Error('Não foi possível identificar o nível educacional do assunto.');

      let curriculaReady=0,leavesDiscovered=0,cardsGenerated=0;
      for(const level of levels){
        if(tracker.elapsedMinutes()>=agentConfig.limits.maxRuntimeMinutes||tracker.aiCalls>=agentConfig.limits.maxAiCallsPerRun)break;
        const curriculum=await generateCurriculumHierarchyTask({subject,educationLevel:level,language:agentConfig.defaultLanguage,sourceContext:sourceContext||undefined});
        if(!curriculum.cacheHit)tracker.aiCalls++;curriculaReady++;
        tracker.log({action:'[curriculum] grade gerada',subject,detail:`nível=${level}, categorias=${curriculum.categories.length}, tópicos=${curriculum.categories.reduce((n,c)=>n+c.topics.length,0)}, subtópicos=${curriculum.categories.reduce((n,c)=>n+Object.values(c.subtopics).reduce((m,s)=>m+s.length,0),0)}${hasDocumentSource?' [fonte]':''}`});
        const needs=await analyzeSubjectLevel(subject,level);leavesDiscovered+=needs.length;
        for(const need of needs.slice(0,agentConfig.limits.maxRequestTopicsPerRun)){
          if(tracker.aiCalls>=agentConfig.limits.maxAiCallsPerRun||tracker.cardsGenerated>=agentConfig.limits.maxCardsPerRun)break;
          const outcome=await generateForTopicNeed(need,tracker,sourceContext);cardsGenerated+=outcome.cardsGenerated;tracker.topicsProcessed++;
          if(outcome.stoppedByLimits)break;
        }
      }

      let remainingNeeds=0;for(const level of levels)remainingNeeds+=(await analyzeSubjectLevel(subject,level)).length;
      const complete=curriculaReady===levels.length&&remainingNeeds===0;
      const progress={levels:levels.length,curriculaReady,leavesDiscovered,cardsGenerated};
      await request.ref.set({status:complete?'completed':'pending',updatedAt:new Date().toISOString(),progress,error:complete?null:undefined},{merge:true});
      tracker.log({action:complete?'[request] conteúdo disponibilizado':'[request] conteúdo aguardando próximo ciclo',subject,detail:`${curriculaReady} grade(s), ${leavesDiscovered} folhas, +${cardsGenerated} cards, ${remainingNeeds} necessidades restantes${hasDocumentSource?' [PDF/TXT]':''}`});
      if(!complete)break;
    }catch(err:any){
      tracker.errors++;const message=String(err?.message||err).slice(0,500);
      await request.ref.set({status:'failed',updatedAt:new Date().toISOString(),error:message},{merge:true});
      tracker.log({action:'[request] falha ao processar conteúdo',subject,detail:message});
    }
  }
}
