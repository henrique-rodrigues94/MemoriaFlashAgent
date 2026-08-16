import { getAdminFirestore } from '../../firebaseAdmin';
import { EducationLevel } from '../../db/firestoreSchema';

const LEVELS: EducationLevel[] = ['fundamental', 'medio', 'faculdade', 'concurso', 'tecnico'];
const FREE_STORAGE_BYTES = Number(process.env.FIRESTORE_FREE_STORAGE_BYTES || 1024 * 1024 * 1024);

function text(value: unknown): string { return typeof value === 'string' ? value.trim() : ''; }
function key(...parts: unknown[]): string { return parts.map(p => text(p).toLowerCase()).join('|'); }
function bytes(value: unknown): number {
  try { return Buffer.byteLength(JSON.stringify(value), 'utf8'); } catch { return 0; }
}
function unique(values: string[]): string[] { return [...new Set(values.filter(Boolean))].sort((a, b) => a.localeCompare(b, 'pt-BR')); }

interface TopicCoverage {
  topic: string;
  subtopics: string[];
  coveredSubtopics: string[];
  missingSubtopics: string[];
  cardCount: number;
  covered: boolean;
}
interface LevelCoverage {
  level: EducationLevel;
  curriculumFound: boolean;
  topics: TopicCoverage[];
  missingTopics: string[];
  totalTopics: number;
  coveredTopics: number;
  coveragePercent: number | null;
}
interface SubjectCoverage {
  subject: string;
  levels: LevelCoverage[];
  totalExpectedTopics: number;
  totalCoveredTopics: number;
  totalCards: number;
  coveragePercent: number | null;
}

function extractExpectedTopics(doc: any): Map<string, string[]> {
  const result = new Map<string, string[]>();
  const add = (topic: unknown, subs: unknown[] = []) => {
    const t = text(topic); if (!t) return;
    const existing = result.get(t) || [];
    result.set(t, unique([...existing, ...subs.map(text)]));
  };
  for (const c of Array.isArray(doc?.categories) ? doc.categories : []) {
    const category = text(c?.category);
    const topics = Array.isArray(c?.topics) ? c.topics : [];
    if (category && topics.length === 0) add(category);
    for (const topic of topics) add(topic);
  }
  for (const node of Array.isArray(doc?.topicTree) ? doc.topicTree : []) {
    add(node?.topic, Array.isArray(node?.subtopics) ? node.subtopics : []);
  }
  return result;
}

function inferSubjectFromDoc(data: any): string { return text(data?.subject || data?.requestedSubject || data?.normalizedSubject); }
function inferLevelFromDoc(data: any): EducationLevel | null {
  const level = text(data?.level || data?.educationLevel);
  return LEVELS.includes(level as EducationLevel) ? level as EducationLevel : null;
}

export async function runDatabaseAudit(): Promise<any> {
  const db = getAdminFirestore();
  if (!db) throw new Error('Firebase Admin não configurado.');

  const collectionRefs = await db.listCollections();
  const collections: Record<string, { documents: number; estimatedBytes: number }> = {};
  const allDocs: Array<{ collection: string; id: string; data: any; estimatedBytes: number }> = [];

  for (const ref of collectionRefs) {
    const snap = await ref.get();
    let totalBytes = 0;
    for (const doc of snap.docs) {
      const data = doc.data();
      const size = bytes(data) + Buffer.byteLength(doc.id, 'utf8') + 32;
      totalBytes += size;
      allDocs.push({ collection: ref.id, id: doc.id, data, estimatedBytes: size });
    }
    collections[ref.id] = { documents: snap.size, estimatedBytes: totalBytes };
  }

  const curriculumDocs = allDocs.filter(d => extractExpectedTopics(d.data).size > 0 && inferSubjectFromDoc(d.data) && inferLevelFromDoc(d.data));
  const bucketDocs = allDocs.filter(d => d.collection === 'cardBuckets');
  const feedbackDocs = allDocs.filter(d => d.collection === 'cardFeedback');
  const contentIndexDocs = allDocs.filter(d => d.collection === 'contentIndex');

  const subjectNames = unique([
    ...curriculumDocs.map(d => inferSubjectFromDoc(d.data)),
    ...bucketDocs.map(d => inferSubjectFromDoc(d.data)),
    ...contentIndexDocs.map(d => inferSubjectFromDoc(d.data)),
  ]);

  const coverage: SubjectCoverage[] = subjectNames.map(subject => {
    const levels: LevelCoverage[] = LEVELS.map(level => {
      const curricula = curriculumDocs.filter(d => inferSubjectFromDoc(d.data).toLowerCase() === subject.toLowerCase() && inferLevelFromDoc(d.data) === level);
      const expected = new Map<string, string[]>();
      for (const d of curricula) for (const [topic, subs] of extractExpectedTopics(d.data)) expected.set(topic, unique([...(expected.get(topic) || []), ...subs]));

      const buckets = bucketDocs.filter(d => inferSubjectFromDoc(d.data).toLowerCase() === subject.toLowerCase() && inferLevelFromDoc(d.data) === level);
      const topicCards = new Map<string, { cards: number; subs: Set<string> }>();
      for (const b of buckets) {
        const topic = text(b.data?.topic);
        if (!topic) continue;
        const entry = topicCards.get(topic) || { cards: 0, subs: new Set<string>() };
        entry.cards += Number(b.data?.cardCount || (Array.isArray(b.data?.cards) ? b.data.cards.length : 0));
        if (text(b.data?.subtopic)) entry.subs.add(text(b.data.subtopic));
        for (const c of Array.isArray(b.data?.cards) ? b.data.cards : []) if (text(c?.subtopic)) entry.subs.add(text(c.subtopic));
        topicCards.set(topic, entry);
      }

      const topics: TopicCoverage[] = [...expected.entries()].map(([topic, subs]) => {
        const actual = [...topicCards.entries()].find(([name]) => name.toLowerCase() === topic.toLowerCase())?.[1];
        const coveredSubtopics = unique(subs.filter(s => actual?.subs.has(s)));
        const missingSubtopics = unique(subs.filter(s => !actual?.subs.has(s)));
        return { topic, subtopics: subs, coveredSubtopics, missingSubtopics, cardCount: actual?.cards || 0, covered: Boolean(actual?.cards) };
      });

      // Se não houver currículo, não inventamos lacunas. O dashboard mostra cobertura como "não aferida".
      const coveredTopics = topics.filter(t => t.covered).length;
      const coveragePercent = expected.size ? Number((coveredTopics / expected.size * 100).toFixed(1)) : null;
      const missingTopics = topics.filter(t => !t.covered).map(t => t.topic);
      return { level, curriculumFound: curricula.length > 0, topics, missingTopics, totalTopics: expected.size, coveredTopics, coveragePercent };
    });

    const totalExpectedTopics = levels.reduce((n, l) => n + l.totalTopics, 0);
    const totalCoveredTopics = levels.reduce((n, l) => n + l.coveredTopics, 0);
    const totalCards = bucketDocs.filter(d => inferSubjectFromDoc(d.data).toLowerCase() === subject.toLowerCase()).reduce((n, d) => n + Number(d.data?.cardCount || (Array.isArray(d.data?.cards) ? d.data.cards.length : 0)), 0);
    return { subject, levels, totalExpectedTopics, totalCoveredTopics, totalCards, coveragePercent: totalExpectedTopics ? Number((totalCoveredTopics / totalExpectedTopics * 100).toFixed(1)) : null };
  });

  const feedbackByReason: Record<string, number> = {};
  const feedbackBySubject: Record<string, number> = {};
  let pendingFeedback = 0;
  for (const d of feedbackDocs) {
    const reason = text(d.data?.reason) || 'sem_motivo';
    feedbackByReason[reason] = (feedbackByReason[reason] || 0) + 1;
    const subject = text(d.data?.subject) || 'Desconhecida';
    feedbackBySubject[subject] = (feedbackBySubject[subject] || 0) + 1;
    if (text(d.data?.status) === 'pending') pendingFeedback++;
  }

  const totalBytes = allDocs.reduce((n, d) => n + d.estimatedBytes, 0);
  const storagePercent = Number(Math.min(100, totalBytes / FREE_STORAGE_BYTES * 100).toFixed(2));
  const agentMetrics = allDocs.filter(d => d.collection === 'agentMetrics').sort((a, b) => text(b.data?.date).localeCompare(text(a.data?.date))).slice(0, 30);
  const requests = allDocs.filter(d => d.collection === 'contentRequests');

  return {
    generatedAt: new Date().toISOString(),
    storage: {
      estimatedLogicalBytes: totalBytes,
      estimatedLogicalMb: Number((totalBytes / 1024 / 1024).toFixed(2)),
      freeReferenceBytes: FREE_STORAGE_BYTES,
      freeReferenceGb: Number((FREE_STORAGE_BYTES / 1024 / 1024 / 1024).toFixed(2)),
      usedPercent: storagePercent,
      note: 'Estimativa lógica baseada nos documentos retornados pelo Firestore; não substitui o Storage Usage oficial do Google Cloud/Firebase, que inclui overhead de índices e metadados.'
    },
    database: {
      collections: Object.entries(collections).sort((a, b) => b[1].estimatedBytes - a[1].estimatedBytes).map(([name, value]) => ({ name, ...value })),
      totalDocuments: allDocs.length,
    },
    content: {
      subjects: coverage,
      subjectCount: subjectNames.length,
      levels: LEVELS,
      curriculumDocuments: curriculumDocs.length,
      cardBuckets: bucketDocs.length,
      totalCards: bucketDocs.reduce((n, d) => n + Number(d.data?.cardCount || (Array.isArray(d.data?.cards) ? d.data.cards.length : 0)), 0),
    },
    feedback: {
      total: feedbackDocs.length,
      pending: pendingFeedback,
      processed: feedbackDocs.filter(d => text(d.data?.status) === 'processed').length,
      byReason: feedbackByReason,
      bySubject: feedbackBySubject,
      recent: feedbackDocs.sort((a, b) => text(b.data?.createdAt).localeCompare(text(a.data?.createdAt))).slice(0, 100).map(d => ({ id: d.id, ...d.data })),
    },
    requests: {
      total: requests.length,
      pending: requests.filter(d => ['pending', 'queued'].includes(text(d.data?.status))).length,
      processing: requests.filter(d => ['processing', 'extracting', 'analyzing', 'generating', 'validating', 'publishing', 'building'].includes(text(d.data?.status))).length,
      completed: requests.filter(d => text(d.data?.status) === 'completed').length,
      failed: requests.filter(d => ['failed', 'error'].includes(text(d.data?.status))).length,
    },
    metrics: agentMetrics.map(d => ({ id: d.id, ...d.data })),
  };
}
