import { getAdminFirestore } from '../../firebaseAdmin';
import { identifySubjectLevelsTask } from '../../ai/tasks/identifySubjectLevels';
import { generateCurriculumHierarchyTask } from '../../ai/tasks/generateCurriculumHierarchy';
import { analyzeSubjectLevel } from '../curriculum/topicAnalyzer';
import { generateForTopicNeed } from '../cards/cardGenerator';
import { getCurriculum } from '../../db/db';
import { hasRealSubtopics } from '../curriculum/curriculumHierarchy';
import { agentConfig } from '../config/agentConfig';
import { RunTracker } from '../monitoring/runLogger';
import type { ContentRequestDoc, EducationLevel } from '../../db/firestoreSchema';

export async function updateRequestedContentJob(tracker:RunTracker):Promise<void>{
  const db=getAdminFirestore();if(!db)return;
  const snap=await db.collection('contentRequests').where('status','==','pending').limit(agentConfig.limits.maxContentRequestsPerRun).get();
  const requests=[...snap.docs].sort((a,b)=>String(a.data().requestedAt||a.data().createdAt||'').localeCompare(String(b.data().requestedAt||b.data().createdAt||'')));
  for(const ref of requests){
    if(tracker.elapsedMinutes()>=agentConfig.limits.maxRuntimeMinutes||tracker.aiCalls>=agentConfig.limits.maxAiCallsPerRun)break;
    const data=ref.data() as ContentRequestDoc;const subject=String(data.subject||data.requestedSubject||'').trim();if(!subject){await ref.ref.set({status:'failed',stage:'failed',updatedAt:new Date().toISOString(),error:'subject vazio'},{merge:true});continue;}
    try{
      await ref.ref.set({status:'processing',stage:'analyzing',updatedAt:new Date().toISOString()},{merge:true});
      const levelResult=data.educationLevel?{levels:[{level:data.educationLevel}]}:await identifySubjectLevelsTask(subject);if(!data.educationLevel)tracker.aiCalls++;
      const levels=levelResult.levels.map((x:any)=>x.level as EducationLevel).filter(Boolean).slice(0,5);if(!levels.length)throw new Error('Não foi possível identificar o nível educacional.');
      let generated=0;let missing=0;let curriculaReady=0;
      for(const level of levels){
        if(tracker.elapsedMinutes()>=agentConfig.limits.maxRuntimeMinutes||tracker.aiCalls>=agentConfig.limits.maxAiCallsPerRun)break;
        const existing=await getCurriculum(subject,level);
        if(!existing||!hasRealSubtopics(existing.data)){
          const curriculum=await generateCurriculumHierarchyTask({subject,educationLevel:level,language:agentConfig.defaultLanguage});if(!curriculum.cacheHit)tracker.aiCalls++;curriculaReady++;tracker.log({action:'[update_requested] grade completada',subject,level,detail:`categorias=${curriculum.categories.length}, tópicos=${curriculum.categories.reduce((n,c)=>n+c.topics.length,0)}, subtópicos=${curriculum.categories.reduce((n,c)=>n+Object.values(c.subtopics||{}).reduce((m,s)=>m+s.length,0),0)}`});
        }else{curriculaReady++;tracker.log({action:'[update_requested] grade existente reutilizada',subject,level,detail:`tópicos=${existing.data.totalTopics}, subtópicos=${existing.data.totalSubtopics||existing.data.subtopicCount||0}`});}
        const needs=await analyzeSubjectLevel(subject,level);missing+=needs.length;
        for(const need of needs.slice(0,agentConfig.limits.maxRequestTopicsPerRun)){
          if(tracker.aiCalls>=agentConfig.limits.maxAiCallsPerRun||tracker.cardsGenerated>=agentConfig.limits.maxCardsPerRun)break;
          const outcome=await generateForTopicNeed(need,tracker);generated+=outcome.cardsGenerated;tracker.topicsProcessed++;if(outcome.stoppedByLimits)break;
        }
      }
      const complete=curriculaReady===levels.length&&missing===0;const now=new Date().toISOString();await ref.ref.set({status:complete?'completed':'pending',stage:complete?'completed':'generating',updatedAt:now,progress:{levels:levels.length,curriculaReady,leavesDiscovered:missing,cardsGenerated:generated,cardsApproved:generated,cardsRejected:0},...(complete?{error:null}:{lastError:`Ainda existem ${missing} necessidade(s); continuar no próximo ciclo.`})},{merge:true});tracker.log({action:complete?'[update_requested] matéria completa':'[update_requested] matéria parcialmente atualizada',subject,detail:`${curriculaReady} grade(s), ${missing} necessidade(s) restantes, +${generated} cards`});
    }catch(err:any){tracker.errors++;const now=new Date().toISOString();await ref.ref.set({status:'pending',stage:'queued',updatedAt:now,lastError:String(err?.message||err).slice(0,500)},{merge:true});tracker.log({action:'[update_requested] falha temporária',subject,detail:String(err?.message||err)});}
  }
}
