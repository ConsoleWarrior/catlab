import { describe, it, expect } from 'vitest';
import { makeRng, makeCat } from '../genetics/index.js';
import {
  createInitialState, matchesOrder, generateOrder, claimOrder, makeCatInstance,
} from './index.js';
import type { Order } from './index.js';

const noReward = { coins: 0, crystals: 0, dna: 0, reputation: 0 };

describe('matchesOrder', () => {
  it('совпадение и несовпадение по цвету', () => {
    const s = createInitialState(makeRng(1), 0);
    const black = makeCatInstance(s, makeCat('female'), 0); // дикий чёрный
    const ok: Order = { id: 'o', req: { baseColor: 'black' }, reward: noReward, createdAt: 0, expiresAt: 0 };
    const bad: Order = { ...ok, req: { baseColor: 'blue' } };
    expect(matchesOrder(ok, black)).toBe(true);
    expect(matchesOrder(bad, black)).toBe(false);
  });

  it('минимальная редкость отсекает обычного кота', () => {
    const s = createInitialState(makeRng(2), 0);
    const plain = makeCatInstance(s, makeCat('male', { A: ['a', 'a'] }), 0); // чёрный солид
    const order: Order = { id: 'o', req: { minRarity: 'epic' }, reward: noReward, createdAt: 0, expiresAt: 0 };
    expect(matchesOrder(order, plain)).toBe(false);
  });
});

describe('generateOrder', () => {
  it('не требует закрытых генов', () => {
    const s = createInitialState(makeRng(3), 0); // dilute/fold/curl/pointed/longhair закрыты
    const rng = makeRng(123);
    for (let i = 0; i < 200; i++) {
      const o = generateOrder(s, rng, 0);
      if (o.req.baseColor) expect(['blue', 'cream']).not.toContain(o.req.baseColor);
      expect(o.req.earShape).toBeUndefined();
      expect(o.req.coatLength).toBeUndefined();
      expect(o.req.breed).toBeUndefined();
    }
  });

  it('после открытия dilute синий/кремовый попадают в пул', () => {
    const s = createInitialState(makeRng(4), 0);
    s.unlockedGenes.push('dilute');
    const rng = makeRng(7);
    let seen = false;
    for (let i = 0; i < 300; i++) {
      const c = generateOrder(s, rng, 0).req.baseColor;
      if (c === 'blue' || c === 'cream') { seen = true; break; }
    }
    expect(seen).toBe(true);
  });
});

describe('claimOrder', () => {
  it('подходящий кот → награда, репутация, уровень; кот уезжает', () => {
    const s = createInitialState(makeRng(5), 0);
    const cat = makeCatInstance(s, makeCat('female'), 0); // чёрный
    s.cats.push(cat);
    const order: Order = {
      id: 'o1', req: { baseColor: 'black' },
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
    const cat = makeCatInstance(s, makeCat('female'), 0); // чёрный
    s.cats.push(cat);
    const order: Order = { id: 'o2', req: { baseColor: 'blue' }, reward: noReward, createdAt: 0, expiresAt: 0 };
    s.orders.push(order);
    expect(claimOrder(s, 'o2', cat.id, 0).ok).toBe(false);
  });
});
