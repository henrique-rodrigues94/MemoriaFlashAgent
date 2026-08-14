import { describe, it, expect, vi, beforeEach } from 'vitest';

// Fake mínimo de Firestore Admin SDK suficiente para exercitar
// removeCardsFromBucket + rollbackLastReview sem infra real.
class FakeDoc {
  constructor(private store: Map<string, any>, private id: string) {}
  async get() {
    const data = this.store.get(this.id);
    return { exists: data !== undefined, data: () => data, ref: this };
  }
  async set(data: any) { this.store.set(this.id, data); }
}
class FakeQuery {
  constructor(private store: Map<string, any>, private filters: Record<string, any> = {}, private orderField?: string, private orderDesc?: boolean, private limitN?: number) {}
  where(field: string, _op: string, value: any) {
    return new FakeQuery(this.store, { ...this.filters, [field]: value }, this.orderField, this.orderDesc, this.limitN);
  }
  orderBy(field: string, dir: 'asc' | 'desc' = 'asc') {
    return new FakeQuery(this.store, this.filters, field, dir === 'desc', this.limitN);
  }
  limit(n: number) {
    return new FakeQuery(this.store, this.filters, this.orderField, this.orderDesc, n);
  }
  async get() {
    let docs = [...this.store.entries()]
      .filter(([, data]) => Object.entries(this.filters).every(([k, v]) => data[k] === v))
      .map(([id, data]) => ({ id, data: () => data, ref: new FakeDoc(this.store, id) }));
    if (this.orderField) {
      docs.sort((a, b) => this.orderDesc
        ? b.data()[this.orderField!] - a.data()[this.orderField!]
        : a.data()[this.orderField!] - b.data()[this.orderField!]);
    }
    if (this.limitN) docs = docs.slice(0, this.limitN);
    return { empty: docs.length === 0, docs };
  }
}
class FakeCollection {
  constructor(private store: Map<string, any>) {}
  doc(id: string) { return new FakeDoc(this.store, id); }
  where(field: string, op: string, value: any) { return new FakeQuery(this.store).where(field, op, value); }
}
class FakeFirestore {
  private collections = new Map<string, Map<string, any>>();
  collection(name: string) {
    if (!this.collections.has(name)) this.collections.set(name, new Map());
    return new FakeCollection(this.collections.get(name)!);
  }
}

let fakeDb: FakeFirestore;

vi.mock('../../firebaseAdmin', () => ({
  getAdminFirestore: () => fakeDb,
}));

import { bucketId } from '../../db/firestoreSchema';
import { removeCardsFromBucket, rollbackLastReview } from './cardBucketRepository';
import type { CardBucketDoc } from '../../db/firestoreSchema';

const SUBJECT = 'Português', TOPIC = 'Regência', LEVEL = 'medio' as const, TYPE = 'definition' as const;

function seedBucket(cards: { id: string; front: string }[]) {
  const id = bucketId(SUBJECT, TOPIC, LEVEL, TYPE);
  const doc: CardBucketDoc = {
    subject: SUBJECT, topic: TOPIC, level: LEVEL, cardType: TYPE,
    cards: cards.map(c => ({ ...c, back: 'x', explanation: 'y', cardType: TYPE } as any)),
    cardCount: cards.length, updatedAt: '', ttlAt: 0, providerUsed: 'gemini',
  };
  fakeDb.collection('cardBuckets').doc(id).set(doc);
}

describe('removeCardsFromBucket + rollbackLastReview', () => {
  beforeEach(() => { fakeDb = new FakeFirestore(); });

  it('grava histórico e remove os cards do balde', async () => {
    seedBucket([{ id: 'c1', front: 'Card 1' }, { id: 'c2', front: 'Card 2' }, { id: 'c3', front: 'Card 3' }]);

    const result = await removeCardsFromBucket(SUBJECT, TOPIC, LEVEL, TYPE, ['c1', 'c2'], 0.4);
    expect(result).toEqual({ removed: 2 });

    const id = bucketId(SUBJECT, TOPIC, LEVEL, TYPE);
    const bucketSnap = await fakeDb.collection('cardBuckets').doc(id).get();
    const bucket = bucketSnap.data() as CardBucketDoc;
    expect(bucket.cards.map(c => c.id)).toEqual(['c3']);
    expect(bucket.reviewVersion).toBe(1);
    expect(bucket.qualityScore).toBe(0.4);

    const historySnap = await fakeDb.collection('cardRevisionHistory').doc(`${id}_v1`).get();
    expect(historySnap.exists).toBe(true);
    expect(historySnap.data().removedCards.map((c: any) => c.id).sort()).toEqual(['c1', 'c2']);
  });

  it('rollback devolve os cards removidos ao balde', async () => {
    seedBucket([{ id: 'c1', front: 'Card 1' }, { id: 'c2', front: 'Card 2' }, { id: 'c3', front: 'Card 3' }]);
    await removeCardsFromBucket(SUBJECT, TOPIC, LEVEL, TYPE, ['c1', 'c2'], 0.4);

    const result = await rollbackLastReview(SUBJECT, TOPIC, LEVEL, TYPE);
    expect(result).toEqual({ restored: 2, reviewVersion: 1 });

    const id = bucketId(SUBJECT, TOPIC, LEVEL, TYPE);
    const bucketSnap = await fakeDb.collection('cardBuckets').doc(id).get();
    const bucket = bucketSnap.data() as CardBucketDoc;
    expect(bucket.cards.map(c => c.id).sort()).toEqual(['c1', 'c2', 'c3']);
  });

  it('rollback sem histórico anterior retorna null', async () => {
    seedBucket([{ id: 'c1', front: 'Card 1' }]);
    const result = await rollbackLastReview(SUBJECT, TOPIC, LEVEL, TYPE);
    expect(result).toBeNull();
  });

  it('rollback duplo não duplica cards (segunda chamada é no-op)', async () => {
    seedBucket([{ id: 'c1', front: 'Card 1' }, { id: 'c2', front: 'Card 2' }]);
    await removeCardsFromBucket(SUBJECT, TOPIC, LEVEL, TYPE, ['c1'], 0.4);

    const first = await rollbackLastReview(SUBJECT, TOPIC, LEVEL, TYPE);
    expect(first?.restored).toBe(1);

    const second = await rollbackLastReview(SUBJECT, TOPIC, LEVEL, TYPE);
    expect(second?.restored).toBe(0); // já restaurado — no-op, não duplica
  });
});
