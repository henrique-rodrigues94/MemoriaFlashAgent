import { generateFlashcardsTask } from '../../ai/tasks/generateFlashcards';
import { saveCardBucket } from '../../db/db';
import { TopicNeed } from '../curriculum/topicAnalyzer';
import { agentConfig } from '../config/agentConfig';
import { RunTracker } from '../monitoring/runLogger';
import { loadAdaptations, resolveAdaptedDifficulty } from '../feedback/adaptationRepository';
import { evaluateCard } from './cardQualityGate';

export interface CardGenerationOutcome { requested:number; cardsGenerated:number; cardsApproved:number; cardsRejected:number; qualityScore:number; aiCalls:number; stoppedByLimits:boolean; }

export async function generateForTopicNeed(need:TopicNeed,tracker:RunTracker,sourceContext='',sourceHash=''):Promise<CardGenerationOutcome>{
  const {batchSize,maxAiCallsPerRun,maxCardsPerRun}=agentConfig.limits;let remaining=need.shortfall,cardsGenerated=0,cardsApproved=0,cardsRejected=0,qualityTotal=0,qualityCount=0,aiCalls=0,stoppedByLimits=false;
  const adaptations=await loadAdaptations(need.subject,need.level);const adaptation=adaptations?.topics[`${need.topic}::${need.cardType}`];const difficulty=adaptation?resolveAdaptedDifficulty(agentConfig.defaultDifficulty,adaptation.difficultyStepOffset):agentConfig.defaultDifficulty;
  if(adaptation&&difficulty!==agentConfig.defaultDifficulty)tracker.log({action:'[cards] usando dificuldade adaptada por feedback',subject:need.subject,topic:need.topic,detail:`${agentConfig.defaultDifficulty} → ${difficulty}`});
  while(remaining>0){
    if(tracker.aiCalls>=maxAiCallsPerRun){stoppedByLimits=true;tracker.stoppedReason='maxAiCallsPerRun atingido';break;}
    if(tracker.cardsGenerated>=maxCardsPerRun){stoppedByLimits=true;tracker.stoppedReason='maxCardsPerRun atingido';break;}
    if(tracker.elapsedMinutes()>=agentConfig.limits.maxRuntimeMinutes){stoppedByLimits=true;tracker.stoppedReason='maxRuntimeMinutes atingido';break;}
    const remainingCardBudget=Math.max(0,maxCardsPerRun-tracker.cardsGenerated);const batchCount=Math.min(remaining,batchSize,remainingCardBudget);if(batchCount<=0){stoppedByLimits=true;tracker.stoppedReason='maxCardsPerRun atingido';break;}
    try{
      const result=await generateFlashcardsTask({prompt:need.subject,count:batchCount,language:agentConfig.defaultLanguage,difficulty,selectedTopics:[need.topic],educationLevel:need.level,sourceType:sourceContext?'document':'subject',cardContentType:need.cardType,sourceContext});
      aiCalls++;tracker.aiCalls++;const generatedThisBatch=result.aiGenerated??0;const bankHitsThisBatch=result.bankHits??0;const progressThisBatch=Math.min(batchCount,generatedThisBatch+bankHitsThisBatch);
      if(sourceContext&&result.cards.length>0&&generatedThisBatch>0){
        const publishable: any[] = [];
        for(const card of result.cards.filter(c=>Boolean(c.front&&c.back))){
          const quality=evaluateCard(card,sourceContext,publishable); qualityTotal+=quality.qualityScore; qualityCount++;
          if(quality.approved&&quality.qualityScore>=agentConfig.quality.minimumScore&&quality.groundingScore>=agentConfig.quality.minimumGrounding){ publishable.push({front:card.front,back:card.back,explanation:card.explanation,topic:card.topic,subtopic:need.subtopic||card.subtopic,difficulty:card.difficulty,qualityScore:quality.qualityScore,accuracyScore:quality.accuracyScore,relevanceScore:quality.relevanceScore,groundingScore:quality.groundingScore,sourceHash:sourceHash||undefined,sourceSection:need.topic,agentVersion:agentConfig.version,promptVersion:agentConfig.promptVersion,model:result.providerUsed}); cardsApproved++; }
          else { cardsRejected++; tracker.cardsRejected++; }
        }
        if(publishable.length>0) await saveCardBucket(need.subject,need.topic,need.level,need.cardType,publishable,result.providerUsed,need.subtopic||'');
      } else if(!sourceContext) { cardsApproved += generatedThisBatch; }
      cardsGenerated+=generatedThisBatch;tracker.cardsGenerated+=generatedThisBatch;
      tracker.log({action:'[cards] lote gerado e validado',subject:need.subject,topic:need.topic,detail:`${need.cardType}/${need.level}: +${generatedThisBatch} IA, ${bankHitsThisBatch} banco, aprovados=${cardsApproved}, rejeitados=${cardsRejected}${sourceContext?' [quality gate + fonte]':''} (provider: ${result.providerUsed})`});
      remaining-=progressThisBatch;if(progressThisBatch<=0){tracker.errors++;tracker.log({action:'[cards] lote sem geração',subject:need.subject,topic:need.topic,detail:`A IA/banco não devolveu cards para um lote de ${batchCount}.`});break;}
    }catch(err:any){tracker.errors++;tracker.log({action:'[cards] falha no lote',subject:need.subject,topic:need.topic,detail:err?.message||String(err)});break;}
  }
  return {requested:need.shortfall,cardsGenerated,cardsApproved,cardsRejected,qualityScore:qualityCount?qualityTotal/qualityCount:0,aiCalls,stoppedByLimits};
}
