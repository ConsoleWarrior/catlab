import { describe, it, expect } from 'vitest';
import { makeRng, makeCat } from '../genetics/index.js';
import {
  createInitialState, matchesOrder, generateOrder, claimOrder, makeCatInstance,
} from './index.js';
import type { Order } from './index.js';

const noReward = { coins: 0, crystals: 0, dna: 0, reputation: 0 };

describe('matchesOrder', () => {
  it('совпадение и несовпадение по породе', () => {
    const s = createInitialState(makeRng(1), 0);
    const persian = makeCatInstance(s, makeCat('female'), 0, 'nursery', 'persian');
    const ok: Order = { id: 'o', req: { breed: 'persian' }, reward: noReward, createdAt: 0, expiresAt: 0 };
    const bad: Order = { ...ok, req: { breed: 'siamese' } };
    expect(matchesOrder(ok, persian)).toBe(true);
    expect(matchesOrder(bad, persian)).toBe(false);
  });

  it('минимальная редкость: отсекает необычного, пропускает легендарного', () => {
    const s = createInitialState(makeRng(2), 0);
    const persian = makeCatInstance(s, makeCat('female'), 0, 'nursery', 'persian'); // uncommon
    const bengal = makeCatInstance(s, makeCat('male'), 0, 'nursery', 'bengal');     // legendary
    const order: Order = { id: 'o', req: { minRarity: 'rare' }, reward: noReward, createdAt: 0, expiresAt: 0 };
    expect(matchesOrder(order, persian)).toBe(false);
    expect(matchesOrder(order, bengal)).toBe(true);
  });

  it('дворовый кот не подходит под заказ конкретной породы', () => {
    const s = createInitialState(makeRng(3), 0);
    const moggie = makeCatInstance(s, makeCat('female'), 0); // breed по умолчанию moggie
    const order: Order = { id: 'o', req: { breed: 'persian' }, reward: noReward, createdAt: 0, expiresAt: 0 };
    expect(matchesOrder(order, moggie)).toBe(false);
  });
});

describe('generateOrder', () => {
  it('заказы требуют породу или минимальную редкость (без генных полей)', () => {
    const s = createInitialState(makeRng(3), 0);
    const rng = makeRng(123);
    for (let i = 0; i < 200; i++) {
      const o = generateOrder(s, rng, 0);
      expect(o.req.breed !== undefined || o.req.minRarity !== undefined).toBe(true);
      expect(o.req.earShape).toBeUndefined();
      expect(o.req.coatLength).toBeUndefined();
      // конкретная порода в заказе — всегда породистая (не базовый дворовый)
      if (o.req.breed) expect(o.req.breed).not.toBe('moggie');
    }
  });

  it('в пул попадают и конкретные породы, и тиры редкости', () => {
    const s = createInitialState(makeRng(4), 0);
    const rng = makeRng(7);
    let sawBreed = false;
    let sawTier = false;
    for (let i = 0; i < 300; i++) {
      const req = generateOrder(s, rng, 0).req;
      if (req.breed) sawBreed = true;
      if (req.minRarity) sawTier = true;
    }
    expect(sawBreed).toBe(true);
    expect(sawTier).toBe(true);
  });
});

describe('claimOrder', () => {
  it('подходящий кот → награда, репутация, уровень; кот уезжает', () => {
    const s = createInitialState(makeRng(5), 0);
    const cat = makeCatInstance(s, makeCat('female'), 0, 'nursery', 'persian');
    s.cats.push(cat);
    const order: Order = {
      id: 'o1', req: { breed: 'persian' },
      reward: { coins: 100, crystals: 0, dna: 5, reputation: 120 },
      createdAt: 0, expiresAt: 0,
    };
    s.orders.push(order);
    const before = s.coins;
    const r = claimOrder(s, 'o1', cat.id, 0);
    expect(r.ok).toBe(true);
    expect(s.coins).toBe(before + 100);
    expect(s.dna).toBe(5);
    expect(s.reputation).toBe(120);
    expect(s.level).toBe(2); // 1 + floor(120/100)
    expect(s.cats.find((c) => c.id === cat.id)).toBeUndefined();
    expect(s.orders.find((o) => o.id === 'o1')).toBeUndefined();
  });

  it('неподходящий кот отклоняется', () => {
    const s = createInitialState(makeRng(6), 0);
    const cat = makeCatInstance(s, makeCat('female'), 0); // дворовый
    s.cats.push(cat);
    const order: Order = { id: 'o2', req: { breed: 'siamese' }, reward: noReward, createdAt: 0, expiresAt: 0 };
    s.orders.push(order);
    expect(claimOrder(s, 'o2', cat.id, 0).ok).toBe(false);
  });
});
