import { describe, it, expect } from 'vitest';
import { makeRng, makeCat, breedLevel } from '../genetics/index.js';
import {
  createInitialState, matchesOrder, generateOrder, claimOrder, makeCatInstance,
  initOrders, refreshExpiredOrders, adRefreshOrder, canAdRefreshOrder, msUntilAdRefresh,
  msUntilOrderExpiry, ORDER_TARGET, ORDER_REFRESH_MS, ORDER_AD_REFRESH_COOLDOWN_MS,
} from './index.js';
import type { Order } from './index.js';

const noReward = { coins: 0, crystals: 0, dna: 0, reputation: 0 };
const mkOrder = (over: Partial<Order>): Order => ({
  id: 'o', req: { breed: 'persian' }, reward: noReward, createdAt: 0, expiresAt: ORDER_REFRESH_MS, ...over,
});

describe('matchesOrder', () => {
  it('совпадение и несовпадение по породе', () => {
    const s = createInitialState(makeRng(1), 0);
    const persian = makeCatInstance(s, makeCat('female'), 0, 'nursery', 'persian');
    const ok = mkOrder({ req: { breed: 'persian' } });
    const bad = mkOrder({ req: { breed: 'siamese' } });
    expect(matchesOrder(ok, persian)).toBe(true);
    expect(matchesOrder(bad, persian)).toBe(false);
  });

  it('минимальная редкость: отсекает необычного, пропускает легендарного', () => {
    const s = createInitialState(makeRng(2), 0);
    const persian = makeCatInstance(s, makeCat('female'), 0, 'nursery', 'persian'); // uncommon
    const bengal = makeCatInstance(s, makeCat('male'), 0, 'nursery', 'bengal');     // legendary
    const order = mkOrder({ req: { minRarity: 'rare' } });
    expect(matchesOrder(order, persian)).toBe(false);
    expect(matchesOrder(order, bengal)).toBe(true);
  });

  it('дворовый кот не подходит под заказ конкретной породы', () => {
    const s = createInitialState(makeRng(3), 0);
    const moggie = makeCatInstance(s, makeCat('female'), 0); // breed по умолчанию moggie
    const order = mkOrder({ req: { breed: 'persian' } });
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
      expect(o.expiresAt).toBe(ORDER_REFRESH_MS); // свежий заказ живёт 6 ч от now(0)
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
  const persianOrder = (): Order => mkOrder({
    id: 'o1', req: { breed: 'persian' },
    reward: { coins: 100, crystals: 0, dna: 5, reputation: 500 },
  });

  it('кот из корзины → награда, репутация, уровень; кот уезжает, слот сразу получает свежий заказ', () => {
    const s = createInitialState(makeRng(5), 0);
    const cat = makeCatInstance(s, makeCat('female'), 0, 'nursery', 'persian');
    s.cats.push(cat);
    s.orders = [persianOrder()];
    s.orderBasket = cat.id;
    const before = s.coins;
    const r = claimOrder(s, 'o1', 0, makeRng(50));
    expect(r.ok).toBe(true);
    expect(s.coins).toBe(before + 100);
    expect(s.dna).toBe(5);
    expect(s.reputation).toBe(500);
    expect(s.level).toBe(2); // 500 ≥ порог L2 (480)
    expect(s.cats.find((c) => c.id === cat.id)).toBeUndefined();
    // выполненный заказ сменился свежим в том же слоте: id новый, заказ активен
    expect(s.orders.length).toBe(1);
    expect(s.orders[0]!.id).not.toBe('o1');
    expect(s.orders[0]!.expiresAt).toBeGreaterThan(0);
    expect(s.orderBasket).toBeNull();
  });

  it('без кота в корзине заказ не выполнить, даже если подходящий кот есть в коллекции', () => {
    const s = createInitialState(makeRng(5), 0);
    const cat = makeCatInstance(s, makeCat('female'), 0, 'nursery', 'persian');
    s.cats.push(cat);
    s.orders = [persianOrder()];
    s.orderBasket = null;
    expect(claimOrder(s, 'o1', 0, makeRng(51)).ok).toBe(false);
    expect(s.cats.find((c) => c.id === cat.id)).toBeDefined();
  });

  it('выполненный слот больше не держит тот же заказ (повторно не закрыть по id)', () => {
    const s = createInitialState(makeRng(5), 0);
    for (const _ of [0, 1]) {
      const cat = makeCatInstance(s, makeCat('female'), 0, 'nursery', 'persian');
      s.cats.push(cat);
    }
    s.orders = [persianOrder()];
    const persians = s.cats.filter((c) => c.breed === 'persian');
    s.orderBasket = persians[0]!.id;
    expect(claimOrder(s, 'o1', 0, makeRng(52)).ok).toBe(true);
    s.orderBasket = persians[1]!.id; // другой подходящий кот
    expect(claimOrder(s, 'o1', 0, makeRng(53))).toMatchObject({ ok: false, reason: 'заказ не найден' });
  });

  it('неподходящий кот в корзине отклоняется', () => {
    const s = createInitialState(makeRng(6), 0);
    const cat = makeCatInstance(s, makeCat('female'), 0); // дворовый
    s.cats.push(cat);
    s.orders = [mkOrder({ id: 'o2', req: { breed: 'siamese' }, reward: noReward })];
    s.orderBasket = cat.id;
    expect(claimOrder(s, 'o2', 0, makeRng(54)).ok).toBe(false);
  });
});

describe('таймер жизни заказов (6 ч)', () => {
  it('стартовая доска = ORDER_TARGET активных заказов со сроком жизни', () => {
    const s = createInitialState(makeRng(1), 1000);
    expect(s.orders.length).toBe(ORDER_TARGET);
    expect(s.orders.every((o) => o.expiresAt > 1000)).toBe(true);
  });

  it('initOrders наполняет доску активными заказами', () => {
    const s = createInitialState(makeRng(2), 0);
    s.orders = [];
    initOrders(s, makeRng(3), 500);
    expect(s.orders.length).toBe(ORDER_TARGET);
    expect(s.orders.every((o) => o.expiresAt === 500 + ORDER_REFRESH_MS)).toBe(true);
  });

  it('refreshExpiredOrders: просроченный заказ сменяется, не просроченный не трогается', () => {
    const s = createInitialState(makeRng(4), 0);
    const idExpired = s.orders[0]!.id;
    s.orders[0]!.expiresAt = 100;      // истёк к now=1000
    s.orders[1]!.expiresAt = 5_000_000; // ещё жив
    const idAlive = s.orders[1]!.id;
    expect(refreshExpiredOrders(s, makeRng(5), 1000)).toBe(true);
    expect(s.orders[0]!.id).not.toBe(idExpired);  // слот 0 обновился
    expect(s.orders[0]!.expiresAt).toBe(1000 + ORDER_REFRESH_MS); // новый срок жизни
    expect(s.orders[1]!.id).toBe(idAlive);        // слот 1 не тронут
    expect(s.orders[1]!.expiresAt).toBe(5_000_000);
  });

  it('refreshExpiredOrders без просроченных — no-op', () => {
    const s = createInitialState(makeRng(6), 0);
    for (const o of s.orders) o.expiresAt = 999_999_999; // все живы
    const ids = s.orders.map((o) => o.id);
    expect(refreshExpiredOrders(s, makeRng(7), 1000)).toBe(false);
    expect(s.orders.map((o) => o.id)).toEqual(ids);
  });

  it('долгий офлайн = по одному свежему заказу на просроченный слот', () => {
    const s = createInitialState(makeRng(8), 0);
    for (const o of s.orders) o.expiresAt = 100; // все давно просрочены
    expect(refreshExpiredOrders(s, makeRng(9), 10_000_000)).toBe(true);
    expect(s.orders.length).toBe(ORDER_TARGET);
    expect(s.orders.every((o) => o.expiresAt === 10_000_000 + ORDER_REFRESH_MS)).toBe(true);
  });
});

describe('📺-обновление заказа (раз в час)', () => {
  it('обновляет один заказ и ставит глобальный кулдаун', () => {
    const s = createInitialState(makeRng(8), 0);
    const oldId = s.orders[0]!.id;
    expect(canAdRefreshOrder(s, 0)).toBe(true);
    expect(adRefreshOrder(s, makeRng(60), oldId, 0).ok).toBe(true);
    expect(s.orders[0]!.id).not.toBe(oldId);        // заказ сменился
    expect(s.orders[0]!.expiresAt).toBe(ORDER_REFRESH_MS);
    // кулдаун встал: сразу второй раз нельзя
    expect(canAdRefreshOrder(s, 0)).toBe(false);
    expect(msUntilAdRefresh(s, 0)).toBe(ORDER_AD_REFRESH_COOLDOWN_MS);
    expect(adRefreshOrder(s, makeRng(61), s.orders[1]!.id, 0))
      .toMatchObject({ ok: false, reason: 'обновление ещё на кулдауне' });
  });

  it('после кулдауна снова доступно', () => {
    const s = createInitialState(makeRng(11), 0);
    expect(adRefreshOrder(s, makeRng(62), s.orders[0]!.id, 0).ok).toBe(true);
    expect(canAdRefreshOrder(s, ORDER_AD_REFRESH_COOLDOWN_MS)).toBe(true);
    expect(adRefreshOrder(s, makeRng(63), s.orders[1]!.id, ORDER_AD_REFRESH_COOLDOWN_MS).ok).toBe(true);
  });

  it('msUntilOrderExpiry считает остаток до авто-смены', () => {
    const s = createInitialState(makeRng(12), 1000);
    expect(msUntilOrderExpiry(s.orders[0]!, 1000)).toBe(ORDER_REFRESH_MS);
    expect(msUntilOrderExpiry(s.orders[0]!, 1000 + ORDER_REFRESH_MS + 5)).toBe(0);
  });
});
