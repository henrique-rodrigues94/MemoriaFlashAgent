import { aiOrchestrator } from '../../ai';
import { identifySubjectLevelsTask } from '../../ai/tasks/identifySubjectLevels';
import { generateCurriculumHierarchyTask } from '../../ai/tasks/generateCurriculumHierarchy';
import { analyzeSubjectLevel } from '../curriculum/topicAnalyzer';
import { generateForTopicNeed } from '../cards/cardGenerator';
import { getContentIndex, getCurriculum } from '../../db/db';
import { agentConfig } from '../config/agentConfig';
import { RunTracker } from '../monitoring/runLogger';
import type { EducationLevel } from '../../db/firestoreSchema';

interface DiscoveryCandidate { subject:string; reason:string; confidence:number; priority:number; levels?:EducationLevel[]; }

async function discoverCandidates(tracker:RunTracker):Promise<DiscoveryCandidate[]>{
  const existing=agentConfig.managedSubjects.map(s=>s.subject).join(', ');
  const context=process.env.CONTENT_AGENT_DISCOVERY_CONTEXT||'concursos, vestibulares, ENEM, formação técnica e acadêmica no Brasil';
  const response=await aiOrchestrator.generateJSON({
    systemPrompt:'Você é um curador de conteúdo educacional. Sugira apenas matérias/assuntos que tenham demanda educacional plausível e que possam ser transformados em uma grade completa. Não sugira variações de matérias já existentes. Seja conservador: poucos candidatos e alta confiança.',
    userPrompt:`Contexto de descoberta: ${context}. Conteúdos já administrados: ${existing}. Encontre até ${agentConfig.limits.maxDiscoverySubjectsPerRun} novas matérias/assuntos relevantes que valham entrar no banco compartilhado. Não gere cards ainda; apenas proponha candidatos para validação.`,
    schemaHint:'JSON { candidates: [{ subject: string, reason: string, confidence: number 0..1, priority: number 1..10, levels?: string[] }] }',
    temperature:0.2,
    maxOutputTokens:1200,
  });
  tracker.aiCalls++;
  const raw=(response.data as any)?.candidates;return Array.isArray(raw)?raw.map((x:any)=>({subject:String(x.subject||'').trim(),reason:String(x.reason||'').trim(),confidence:Number(x.confidence||0),priority:Number(x.priority||5),levels:Array.isArray(x.levels)?x.levels.filter((l:any)=>['fundamental','medio','faculdade','concurso','tecnico'].includes(l)):undefined})).filter(x=>x.subject&&x.confidence>=agentConfig.discovery.minimumConfidence):[];
}

export async function discoverNewContentJob(tracker:RunTracker):Promise<void>{
  if(!agentConfig.discovery.enabled){tracker.log({action:'[discovery] modo desabilitado por configuração'});return;}
  try{
    const candidates=await discoverCandidates(tracker);
    for(const candidate of candidates){
      if(tracker.elapsedMinutes()>=agentConfig.limits.maxRuntimeMinutes||tracker.aiCalls>=agentConfig.limits.maxAiCallsPerRun)break;
      const existing=await getContentIndex(candidate.subject);if(existing){tracker.log({action:'[discovery] candidato já existe',subject:candidate.subject,detail:`status=${existing.status}`});continue;}
      tracker.log({action:'[discovery] nova matéria aprovada',subject:candidate.subject,detail:`confiança=${candidate.confidence.toFixed(2)} prioridade=${candidate.priority} — ${candidate.reason}`});
      const levelResult=await identifySubjectLevelsTask(candidate.subject);tracker.aiCalls++;
      const levels=(candidate.levels?.length?candidate.levels:levelResult.levels.map((x:any)=>x.level)).filter(Boolean).slice(0,3) as EducationLevel[];
      for(const level of levels){
        if(tracker.elapsedMinutes()>=agentConfig.limits.maxRuntimeMinutes||tracker.aiCalls>=agentConfig.limits.maxAiCallsPerRun)break;
        const curriculum=await generateCurriculumHierarchyTask({subject:candidate.subject,educationLevel:level,language:agentConfig.defaultLanguage});if(!curriculum.cacheHit)tracker.aiCalls++;
        tracker.curriculaCreated++;
        tracker.log({action:'[discovery] grade criada',subject:candidate.subject,level,detail:`categorias=${curriculum.categories.length}, tópicos=${curriculum.categories.reduce((n,c)=>n+c.topics.length,0)}, subtópicos=${curriculum.categories.reduce((n,c)=>n+Object.values(c.subtopics||{}).reduce((m,s)=>m+s.length,0),0)}`});
        const needs=await analyzeSubjectLevel(candidate.subject,level);
        if(!agentConfig.discovery.generateCards)continue;
        for(const need of needs.slice(0,agentConfig.limits.maxTopicsPerRun)){
          if(tracker.aiCalls>=agentConfig.limits.maxAiCallsPerRun||tracker.cardsGenerated>=agentConfig.limits.maxCardsPerRun)break;
          const outcome=await generateForTopicNeed(need,tracker);tracker.topicsProcessed++;if(outcome.stoppedByLimits)break;
        }
      }
    }
  }catch(err:any){tracker.errors++;tracker.log({action:'[discovery] falha na descoberta',detail:err?.message||String(err)});}
}
