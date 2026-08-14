// 📁 flashmind-ai/src/server/contentAgent/jobs/generateCardsJob.ts
import { AgentPlan } from '../agent/planner';
import { generateForTopicNeed } from '../cards/cardGenerator';
import { RunTracker } from '../monitoring/runLogger';
import { agentConfig } from '../config/agentConfig';

export async function generateCardsJob(plan: AgentPlan, tracker: RunTracker): Promise<void> {
  for (const need of plan.needs) {
    if (tracker.elapsedMinutes() >= agentConfig.limits.maxRuntimeMinutes) {
      tracker.stoppedReason = tracker.stoppedReason || 'maxRuntimeMinutes atingido';
      break;
    }
    if (tracker.aiCalls >= agentConfig.limits.maxAiCallsPerRun) {
      tracker.stoppedReason = tracker.stoppedReason || 'maxAiCallsPerRun atingido';
      break;
    }

    const outcome = await generateForTopicNeed(need, tracker);
    tracker.topicsProcessed++;

    if (outcome.stoppedByLimits) break;
  }
}
