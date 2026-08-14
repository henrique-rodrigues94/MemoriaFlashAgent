// 📁 flashmind-ai/src/server/contentAgent/jobs/discoverTopicsJob.ts
import { buildPlan, AgentPlan } from '../agent/planner';
import { RunTracker } from '../monitoring/runLogger';

export async function discoverTopicsJob(tracker: RunTracker): Promise<AgentPlan> {
  return buildPlan(tracker);
}
