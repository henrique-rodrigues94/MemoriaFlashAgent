// 📁 flashmind-ai/src/server/contentAgent/jobs/reviewFlaggedTopicsJob.ts
import { agentConfig } from '../config/agentConfig';
import { reviewFlaggedTopics } from '../cards/cardQualityReviewer';
import { RunTracker } from '../monitoring/runLogger';

export async function reviewFlaggedTopicsJob(tracker: RunTracker): Promise<void> {
  for (const managed of agentConfig.managedSubjects) {
    if (tracker.elapsedMinutes() >= agentConfig.limits.maxRuntimeMinutes) {
      tracker.stoppedReason = tracker.stoppedReason || 'maxRuntimeMinutes atingido durante revisão de qualidade';
      return;
    }
    for (const level of managed.levels) {
      const outcome = await reviewFlaggedTopics(managed.subject, level, tracker);
      tracker.cardsReviewed += outcome.cardsRemoved;
    }
  }
}
