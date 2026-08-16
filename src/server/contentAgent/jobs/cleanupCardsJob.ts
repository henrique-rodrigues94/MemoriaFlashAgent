import { getAdminFirestore } from '../../firebaseAdmin';
import { agentConfig } from '../config/agentConfig';
import { RunTracker } from '../monitoring/runLogger';
import type { CardBucketDoc, BankCard } from '../../db/firestoreSchema';

interface UsageDoc { cardId:string; reviewCount?:number; correctCount?:number; incorrectCount?:number; lastReviewedAt?:string; lastUsedAt?:string; }
function usageScore(card:BankCard,usage:UsageDoc|undefined,feedbackCount:number,positiveCount:number):number{const reviews=Number(usage?.reviewCount||0);const correct=Number(usage?.correctCount||0);const incorrect=Number(usage?.incorrectCount||0);const accuracy=reviews>0?correct/reviews:0;const quality=Number(card.qualityScore||0);const relevance=Number(card.relevanceScore||0);const feedback=Math.min(1,positiveCount/Math.max(1,feedbackCount));const recency=usage?.lastUsedAt?Math.max(0,1-(Date.now()-Date.parse(usage.lastUsedAt))/((agentConfig.cleanup.usageWindowDays||120)*86400000)):0;return reviews*0.5+accuracy*2+quality+relevance+feedback+recency-(incorrect*0.05);}

export async function cleanupCardsJob(tracker:RunTracker):Promise<void>{
  if(!agentConfig.cleanup.enabled){tracker.log({action:'[cleanup] modo desabilitado por configuração'});return;}
  const db=getAdminFirestore();if(!db)return;
  const cutoff=Date.now()-agentConfig.cleanup.staleDays*86400000;
  const snap=await db.collection('cardBuckets').limit(100).get();let removed=0;
  for(const docRef of snap.docs){
    if(removed>=agentConfig.limits.maxCleanupCardsPerRun||tracker.elapsedMinutes()>=agentConfig.limits.maxRuntimeMinutes)break;
    const bucket=docRef.data() as CardBucketDoc;const updated=Date.parse(String(bucket.updatedAt||''));if(Number.isFinite(updated)&&updated>cutoff)continue;
    const cards=Array.isArray(bucket.cards)?bucket.cards:[];if(cards.length<=agentConfig.cleanup.minimumKeepPerBucket)continue;
    const ranked: {card:BankCard;score:number}[]=[];
    for(const card of cards){
      const usageSnap=await db.collection('cardUsage').doc(`${docRef.id}_${card.id}`).get();const usage=usageSnap.exists?usageSnap.data() as UsageDoc:undefined;
      const feedbackSnap=await db.collection('cardFeedback').where('cardId','==',card.id).limit(50).get();let positive=0;for(const f of feedbackSnap.docs)if(f.data().rating==='positive')positive++;ranked.push({card,score:usageScore(card,usage,feedbackSnap.size,positive)});
    }
    ranked.sort((a,b)=>b.score-a.score);const keep=ranked.slice(0,agentConfig.cleanup.minimumKeepPerBucket).map(x=>x.card.id);const candidates=ranked.slice(agentConfig.cleanup.minimumKeepPerBucket).filter(x=>x.score<Number(process.env.CONTENT_AGENT_CLEANUP_MIN_SCORE||1.25)).slice(0,agentConfig.limits.maxCleanupCardsPerRun-removed);
    if(!candidates.length)continue;
    if(!agentConfig.cleanup.apply){tracker.log({action:'[cleanup] dry-run',subject:bucket.subject,topic:bucket.topic,detail:`${candidates.length} candidato(s), bucket=${docRef.id}, preservados=${keep.length}`});continue;}
    const removeIds=new Set(candidates.map(x=>x.card.id));const remaining=cards.filter(c=>!removeIds.has(c.id));await docRef.ref.set({...bucket,cards:remaining,cardCount:remaining.length,updatedAt:new Date().toISOString()});await db.collection('cardCleanupHistory').doc(`${docRef.id}_${Date.now()}`).set({bucketId:docRef.id,subject:bucket.subject,topic:bucket.topic,removedCards:candidates.map(x=>x.card),preservedCards:keep,reason:'low relevance/usage on stale bucket',removedAt:new Date().toISOString()});removed+=candidates.length;tracker.cardsReviewed+=candidates.length;tracker.log({action:'[cleanup] cards removidos',subject:bucket.subject,topic:bucket.topic,detail:`-${candidates.length}, preservados=${keep.length}, bucket=${docRef.id}`});
  }
  if(!agentConfig.cleanup.apply)tracker.log({action:'[cleanup] concluído em dry-run',detail:'Nenhum card foi apagado. Defina CONTENT_AGENT_CLEANUP_APPLY=true após validar os candidatos.'});
}
