import { describe, it, expect } from 'vitest';
import { makeRng, makeCat, breedLevel } from '../genetics/index.js';
import {
  createInitialState, matchesOrder, generateOrder, claimOrder, makeCatInstance,
  rollDailyOrders, refreshOrderByAd, mskDay, msUntilOrdersReset, ORDER_TARGET, DAY_MS,
} from './index.js';
import type { Order } from './index.js';

const noReward = { coins: 0, crystals: 0, dna: 0, reputation: 0 };

describe('matchesOrder', () => {
  it('совпадение и несовпадение по породе', () => {
    const s = createInitialState(makeRng(1), 0);
    const persian = makeCatInstance(s, makeCat('female'), 0, 'nursery', 'persian');
    const ok: Order = { id: 'o', req: { breed: 'persian' }, reward: noReward, createdAt: 0, done: false, adRefreshed: false };
    const bad: Order = { ...ok, req: { breed: 'siamese' } };
    expect(matchesOrder(ok, persian)).toBe(true);
    expect(matchesOrder(bad, persian)).toBe(false);
  });

  it('минимальная редкость: отсекает необычного, пропускает легендарного', () => {
    const s = createInitialState(makeRng(2), 0);
    const persian = makeCatInstance(s, makeCat('female'), 0, 'nursery', 'persian'); // uncommon
    const bengal = makeCatInstance(s, makeCat('male'), 0, 'nursery', 'bengal');     // legendary
    const order: Order = { id: 'o', req: { minRarity: 'rare' }, reward: noReward, createdAt: 0, done: false, adRefreshed: false };
    expect(matchesOrder(order, persian)).toBe(false);
    expect(matchesOrder(order, bengal)).toBe(true);
  });

  it('дворовый кот не подходит под заказ конкретной породы', () => {
    const s = createInitialState(makeRng(3), 0);
    const moggie = makeCatInstance(s, makeCat('female'), 0); // breed по умолчанию moggie
    const order: Order = { id: 'o', req: { breed: 'persian' }, reward: noReward, createdAt: 0, done: false, adRefreshed: false };
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

  it('конкретные породы в заказах — только скрытых уровней L и L−1', () => {
    const s = createInitialState(makeRng(8), 0);
    const rng = makeRng(9);
    for (const level of [1, 5, 10]) {
      s.level = level;
      for (let i = 0; i < 300; i++) {
        const req = generateOrder(s, rng, 0).req;
        if (!req.breed) continue;
        expect(breedLevel(req.breed)).toBeGreaterThanOrEqual(Math.max(1, level - 1));
        expect(breedLevel(req.breed)).toBeLessThanOrEqual(level);
      }
    }
  });

  it('пул не зависит от Котодекса: клиент может заказать ещё не выведенную породу', () => {
    const s = createInitialState(makeRng(10), 0);
    s.level = 5;
    s.discoveredBreeds = []; // не выведено вообще ничего
    const rng = makeRng(11);
    let sawBreed = false;
    for (let i = 0; i < 300; i++) {
      if (generateOrder(s, rng, 0).req.breed) sawBreed = true;
    }
    expect(sawBreed).toBe(true);
  });

  it('рост уровня лабы сдвигает пул к более дорогим породам', () => {
    const s = createInitialState(makeRng(12), 0);
    const seen = (level: number): Set<string> => {
      s.level = level;
      const rng = makeRng(13);
      const out = new Set<string>();
      for (let i = 0; i < 400; i++) {
        const b = generateOrder(s, rng, 0).req.breed;
        if (b) out.add(b);
      }
      return out;
    };
    const early = seen(2);
    const late = seen(9);
    expect(early.size).toBeGreaterThan(0);
    expect(late.size).toBeGreaterThan(0);
    // пулы разных концов игры не пересекаются вовсе
    for (const b of late) expect(early.has(b)).toBe(false);
  });
});

describe('claimOrder', () => {
  const persianOrder = (): Order => ({
    id: 'o1', req: { breed: 'persian' },
    reward: { coins: 100, crystals: 0, dna: 5, reputation: 120 },
    createdAt: 0, done: false, adRefreshed: false,
  });

  it('кот из корзины → награда, репутация, уровень; кот уезжает, заказ помечен выполненным', () => {
    const s = createInitialState(makeRng(5), 0);
    const cat = makeCatInstance(s, makeCat('female'), 0, 'nursery', 'persian');
    s.cats.push(cat);
    s.orders.push(persianOrder());
    s.orderBasket = cat.id;
    const before = s.coins;
    const r = claimOrder(s, 'o1', 0);
    expect(r.ok).toBe(true);
    expect(s.coins).toBe(before + 100);
    expect(s.dna).toBe(5);
    expect(s.reputation).toBe(120);
    expect(s.level).toBe(2); // 1 + floor(120/100)
    expect(s.cats.find((c) => c.id === cat.id)).toBeUndefined();
    // заказ остаётся на доске помеченным, корзина освобождается вместе с котом
    expect(s.orders.find((o) => o.id === 'o1')?.done).toBe(true);
    expect(s.orderBasket).toBeNull();
  });

  it('без кота в корзине заказ не выполнить, даже если подходящий кот есть в коллекции', () => {
    const s = createInitialState(makeRng(5), 0);
    const cat = makeCatInstance(s, makeCat('female'), 0, 'nursery', 'persian');
    s.cats.push(cat);
    s.orders.push(persianOrder());
    s.orderBasket = null;
    expect(claimOrder(s, 'o1', 0).ok).toBe(false);
    expect(s.cats.find((c) => c.id === cat.id)).toBeDefined();
  });

  it('выполненный заказ повторно не закрыть', () => {
    const s = createInitialState(makeRng(5), 0);
    for (const _ of [0, 1]) {
      const cat = makeCatInstance(s, makeCat('female'), 0, 'nursery', 'persian');
      s.cats.push(cat);
    }
    s.orders.push(persianOrder());
    const persians = s.cats.filter((c) => c.breed === 'persian');
    s.orderBasket = persians[0]!.id;
    expect(claimOrder(s, 'o1', 0).ok).toBe(true);
    s.orderBasket = persians[1]!.id; // другой подходящий кот
    expect(claimOrder(s, 'o1', 0).ok).toBe(false);
  });

  it('неподходящий кот в корзине отклоняется', () => {
    const s = createInitialState(makeRng(6), 0);
    const cat = makeCatInstance(s, makeCat('female'), 0); // дворовый
    s.cats.push(cat);
    s.orders.push({ id: 'o2', req: { breed: 'siamese' }, reward: noReward, createdAt: 0, done: false, adRefreshed: false });
    s.orderBasket = cat.id;
    expect(claimOrder(s, 'o2', 0).ok).toBe(false);
  });
});

describe('суточный цикл доски', () => {
  const MSK = 3 * 3600_000;
  const day = (n: number): number => n * DAY_MS - MSK; // московская полночь n-х суток UTC-эпохи

  it('стартовая доска = ORDER_TARGET слотов на текущие сутки', () => {
    const s = createInitialState(makeRng(1), day(20_000) + 5 * 3600_000);
    expect(s.orders.length).toBe(ORDER_TARGET);
    expect(s.orders.every((o) => !o.done && !o.adRefreshed)).toBe(true);
  });

  it('внутри суток доска не меняется, в московскую полночь — перевыпуск', () => {
    const t0 = day(20_000) + 5 * 3600_000; // 05:00 MSK
    const s = createInitialState(makeRng(2), t0);
    const ids = s.orders.map((o) => o.id);
    // тот же день, даже спустя часы → no-op
    expect(rollDailyOrders(s, makeRng(3), t0 + 10 * 3600_000)).toBe(false);
    expect(s.orders.map((o) => o.id)).toEqual(ids);
    // шаг за полночь → доска целиком новая
    expect(rollDailyOrders(s, makeRng(3), day(20_001))).toBe(true);
    expect(s.orders.map((o) => o.id)).not.toEqual(ids);
    expect(s.orders.length).toBe(ORDER_TARGET);
  });

  it('смена суток сбрасывает done/📺-замену и освобождает корзину', () => {
    const t0 = day(20_000) + 3600_000;
    const s = createInitialState(makeRng(4), t0);
    s.orders[0]!.done = true;
    s.orders[1]!.adRefreshed = true;
    s.orderBasket = s.cats[0]!.id;
    rollDailyOrders(s, makeRng(5), day(20_001) + 60_000);
    expect(s.orders.every((o) => !o.done && !o.adRefreshed)).toBe(true);
    expect(s.orderBasket).toBeNull();
  });

  it('долгий офлайн = один перевыпуск, а не по доске за пропущенный день', () => {
    const s = createInitialState(makeRng(6), day(20_000));
    expect(rollDailyOrders(s, makeRng(7), day(20_030))).toBe(true); // вернулись через 30 суток
    expect(s.orders.length).toBe(ORDER_TARGET);
    expect(rollDailyOrders(s, makeRng(7), day(20_030) + 60_000)).toBe(false);
  });

  it('таймер до смены считается от московской полуночи', () => {
    const t = day(20_000) + 5 * 3600_000; // 05:00 MSK → до полуночи 19 ч
    expect(msUntilOrdersReset(t)).toBe(19 * 3600_000);
    expect(mskDay(day(20_000))).toBe(20_000);
    expect(mskDay(day(20_000) - 1)).toBe(19_999); // за миг до полуночи — ещё вчера
  });
});

describe('📺-замена заказа', () => {
  it('меняет слот на новый и тратится один раз за сутки', () => {
    const s = createInitialState(makeRng(8), 0);
    const id = s.orders[0]!.id;
    const r = refreshOrderByAd(s, id, makeRng(9), 0);
    expect(r.ok).toBe(true);
    const fresh = s.orders[0]!;
    expect(fresh.id).not.toBe(id);
    // флаг переезжает на новый заказ — иначе замену можно было бы крутить бесконечно
    expect(fresh.adRefreshed).toBe(true);
    expect(refreshOrderByAd(s, fresh.id, makeRng(10), 0).ok).toBe(false);
    expect(s.orders.length).toBe(ORDER_TARGET);
  });

  it('выполненный заказ не меняется', () => {
    const s = createInitialState(makeRng(11), 0);
    s.orders[0]!.done = true;
    expect(refreshOrderByAd(s, s.orders[0]!.id, makeRng(12), 0).ok).toBe(false);
  });
});
