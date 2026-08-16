import { getAdminFirestore } from '../../firebaseAdmin';

export async function printAgentReport(): Promise<void> {
  const db = getAdminFirestore();
  if (!db) throw new Error('Firebase Admin não configurado.');
  const [pending, processing, completed, failed, metrics] = await Promise.all([
    db.collection('contentRequests').where('status', '==', 'pending').get(),
    db.collection('contentRequests').where('status', '==', 'processing').get(),
    db.collection('contentRequests').where('status', '==', 'completed').limit(1000).get(),
    db.collection('contentRequests').where('status', '==', 'failed').limit(1000).get(),
    db.collection('agentMetrics').orderBy('updatedAt', 'desc').limit(7).get(),
  ]);
  const cards = metrics.docs.reduce((n, d) => n + Number(d.data().cardsGenerated || 0), 0);
  const rejected = metrics.docs.reduce((n, d) => n + Number(d.data().cardsRejected || 0), 0);
  const aiCalls = metrics.docs.reduce((n, d) => n + Number(d.data().aiCalls || 0), 0);
  const cost = metrics.docs.reduce((n, d) => n + Number(d.data().estimatedAiCostUsd || 0), 0);
  console.log(JSON.stringify({ generatedAt: new Date().toISOString(), requests: { pending: pending.size, processing: processing.size, completed: completed.size, failed: failed.size }, last7Days: { cardsGenerated: cards, cardsRejected: rejected, aiCalls, estimatedAiCostUsd: Number(cost.toFixed(6)) } }, null, 2));
}

if (require.main === module) printAgentReport().catch(err => { console.error(err); process.exitCode = 1; });
