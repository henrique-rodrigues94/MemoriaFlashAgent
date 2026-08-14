import { describe, it, expect, vi, beforeEach } from 'vitest';

class FakeQuery {
  constructor(private docs: any[], private limitN?: number) {}
  orderBy() { return this; }
  limit(n: number) { return new FakeQuery(this.docs, n); }
  async get() {
    const docs = this.limitN ? this.docs.slice(0, this.limitN) : this.docs;
    return { docs: docs.map(d => ({ data: () => d })) };
  }
}
class FakeCollection {
  constructor(private docs: any[]) {}
  orderBy() { return new FakeQuery(this.docs); }
  limit(n: number) { return new FakeQuery(this.docs, n); }
  async get() { return { docs: this.docs.map(d => ({ data: () => d })) }; }
}

let runsData: any[] = [];
let adaptationsData: any[] = [];

vi.mock('../../firebaseAdmin', () => ({
  getAdminFirestore: () => ({
    collection: (name: string) => {
      if (name === 'agentRuns') return new FakeCollection(runsData);
      if (name === 'contentAdaptations') return new FakeCollection(adaptationsData);
      return new FakeCollection([]);
    },
  }),
}));

import { getOverview, getCriticalTopics, getRecentRuns } from './dashboardQueries';

describe('dashboardQueries', () => {
  beforeEach(() => { runsData = []; adaptationsData = []; });

  it('getOverview soma os contadores das execuções recentes', async () => {
    runsData = [
      { runId: 'r2', startedAt: '2026-08-10T00:00:00Z', status: 'completed', cardsGenerated: 40, cardsReviewed: 5, feedbackAnalyzed: 100, adaptationsApplied: 3, aiCalls: 8, errors: 0 },
      { runId: 'r1', startedAt: '2026-08-03T00:00:00Z', status: 'completed', cardsGenerated: 20, cardsReviewed: 2, feedbackAnalyzed: 50, adaptationsApplied: 1, aiCalls: 4, errors: 1 },
    ];
    const overview = await getOverview(20);
    expect(overview.cardsGeneratedRecent).toBe(60);
    expect(overview.cardsReviewedRecent).toBe(7);
    expect(overview.errorsRecent).toBe(1);
    expect(overview.lastRunAt).toBe('2026-08-10T00:00:00Z');
    expect(overview.lastRunStatus).toBe('completed');
  });

  it('getOverview com nenhuma execução retorna zeros sem quebrar', async () => {
    const overview = await getOverview(20);
    expect(overview.recentRuns).toBe(0);
    expect(overview.lastRunAt).toBeUndefined();
  });

  it('getRecentRuns retorna os dados brutos das execuções', async () => {
    runsData = [{ runId: 'r1', startedAt: '2026-08-10T00:00:00Z', status: 'completed' }];
    const runs = await getRecentRuns(5);
    expect(runs).toHaveLength(1);
    expect(runs[0].runId).toBe('r1');
  });

  it('getCriticalTopics extrai só tópicos com flaggedForReview=true, ordenados por volume de feedback', async () => {
    adaptationsData = [
      {
        subject: 'Português', level: 'medio',
        topics: {
          'Regência::definition': { topic: 'Regência', cardType: 'definition', flaggedForReview: true, basedOnFeedbackCount: 30, lastReason: 'bad_explanation' },
          'Crase::quiz': { topic: 'Crase', cardType: 'quiz', flaggedForReview: false, basedOnFeedbackCount: 10 },
        },
      },
      {
        subject: 'Biologia', level: 'medio',
        topics: {
          'Mitose::definition': { topic: 'Mitose', cardType: 'definition', flaggedForReview: true, basedOnFeedbackCount: 80, lastReason: 'confusing_question' },
        },
      },
    ];

    const critical = await getCriticalTopics();
    expect(critical).toHaveLength(2); // Crase não entra (flaggedForReview false)
    expect(critical[0].topic).toBe('Mitose'); // maior basedOnFeedbackCount primeiro
    expect(critical[1].topic).toBe('Regência');
  });
});
