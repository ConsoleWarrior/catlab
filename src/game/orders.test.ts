import { describe, it, expect } from 'vitest';
import { makeRng, makeCat, breedLevel } from '../genetics/index.js';
import {
  createInitialState, matchesOrder, generateOrder, claimOrder, makeCatInstance,
  initOrders, refreshExpiredOrders, adRefreshOrder, canAdRefreshOrder, msUntilAdRefresh,
  msUntilOrderExpiry, ORDER_TARGET, ORDER_REFRESH_MS, ORDER_AD_REFRESH_COOLDOWN_MS,
  ORDER_SELL_SLOTS, ORDER_CRYSTALS, ORDER_CRYSTALS_MAX, ORDER_CRYSTAL_LEVELS, orderCrystalsFor,
  ORDER_SELL_CRYSTALS, ORDER_SELL_CRYSTAL_CHANCE, orderRepFor, MAX_LEVEL,
  putCatInBasket, isInBasket, roomCount, moveCat, setChampion, isChampion,
  assignBreeder, isInSlot, startBreeding, nurseryCapacity, shelterCapacity,
} from './index.js';
import type { Order, GameState } from './index.js';

const noReward = { coins: 0, crystals: 0, dna: 0, reputation: 0 };
const mkOrder = (over: Partial<Order>): Order => ({
  id: 'o', req: { breed: 'persian' }, kind: 'target', reward: noReward,
  createdAt: 0, expiresAt: ORDER_REFRESH_MS, adRefreshAt: 0, ...over,
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
    expect(s.level).toBe(2); // 500 ≥ порог L2 (360)
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

describe('📺-обновление заказа (раз в час у каждого заказа)', () => {
  it('обновляет заказ и ставит кулдаун только этому слоту', () => {
    const s = createInitialState(makeRng(8), 0);
    const oldId = s.orders[0]!.id;
    expect(canAdRefreshOrder(s.orders[0]!, 0)).toBe(true);
    expect(adRefreshOrder(s, makeRng(60), oldId, 0).ok).toBe(true);
    expect(s.orders[0]!.id).not.toBe(oldId);        // заказ сменился
    expect(s.orders[0]!.expiresAt).toBe(ORDER_REFRESH_MS);
    // кулдаун встал этому слоту: сразу второй раз нельзя
    expect(canAdRefreshOrder(s.orders[0]!, 0)).toBe(false);
    expect(msUntilAdRefresh(s.orders[0]!, 0)).toBe(ORDER_AD_REFRESH_COOLDOWN_MS);
    expect(adRefreshOrder(s, makeRng(61), s.orders[0]!.id, 0))
      .toMatchObject({ ok: false, reason: 'обновление этого заказа ещё на кулдауне' });
    // остальные заказы не тронуты — их можно обновить в тот же момент
    for (let i = 1; i < s.orders.length; i++) expect(canAdRefreshOrder(s.orders[i]!, 0)).toBe(true);
    expect(adRefreshOrder(s, makeRng(62), s.orders[1]!.id, 0).ok).toBe(true);
    expect(msUntilAdRefresh(s.orders[1]!, 0)).toBe(ORDER_AD_REFRESH_COOLDOWN_MS);
    expect(msUntilAdRefresh(s.orders[2]!, 0)).toBe(0);
  });

  it('после кулдауна слот снова доступен', () => {
    const s = createInitialState(makeRng(11), 0);
    expect(adRefreshOrder(s, makeRng(62), s.orders[0]!.id, 0).ok).toBe(true);
    expect(canAdRefreshOrder(s.orders[0]!, ORDER_AD_REFRESH_COOLDOWN_MS)).toBe(true);
    expect(adRefreshOrder(s, makeRng(63), s.orders[0]!.id, ORDER_AD_REFRESH_COOLDOWN_MS).ok).toBe(true);
  });

  it('кулдаун принадлежит слоту: смена заказа по таймеру его не сбрасывает', () => {
    const s = createInitialState(makeRng(14), 0);
    expect(adRefreshOrder(s, makeRng(64), s.orders[0]!.id, 0).ok).toBe(true);
    s.orders[0]!.expiresAt = 100; // заказ истёк раньше, чем кончился кулдаун 📺
    refreshExpiredOrders(s, makeRng(65), 1000);
    expect(canAdRefreshOrder(s.orders[0]!, 1000)).toBe(false);
    expect(s.orders[0]!.adRefreshAt).toBe(ORDER_AD_REFRESH_COOLDOWN_MS);
  });

  it('msUntilOrderExpiry считает остаток до авто-смены', () => {
    const s = createInitialState(makeRng(12), 1000);
    expect(msUntilOrderExpiry(s.orders[0]!, 1000)).toBe(ORDER_REFRESH_MS);
    expect(msUntilOrderExpiry(s.orders[0]!, 1000 + ORDER_REFRESH_MS + 5)).toBe(0);
  });
});

describe('⭐ за заказ: плавно по скрытому уровню породы, без ступеней тира', () => {
  it('опыт заказа = orderRepFor(breedLevel породы), а не доля от цены тира', () => {
    const s = createInitialState(makeRng(40), 0);
    s.discoveredBreeds = ['persian'];
    const o = generateOrder(s, makeRng(41), 0, 'sell');
    expect(o.req.breed).toBe('persian');
    expect(o.reward.reputation).toBe(orderRepFor(breedLevel('persian')));
  });

  it('средний ⭐ по уровням лаборатории растёт плавно: шаг ≤ ×1.5 (раньше на смене тира было ×1.9)', () => {
    const s = createInitialState(makeRng(42), 0);
    const rng = makeRng(43);
    const avg: number[] = [];
    for (let L = 1; L <= MAX_LEVEL; L++) {
      s.level = L;
      let sum = 0;
      const N = 400;
      for (let i = 0; i < N; i++) sum += generateOrder(s, rng, 0, 'target').reward.reputation;
      avg.push(sum / N);
    }
    for (let i = 1; i < avg.length; i++) {
      expect(avg[i]!).toBeGreaterThan(avg[i - 1]!);           // монотонно вверх
      expect(avg[i]! / avg[i - 1]!).toBeLessThanOrEqual(1.5); // без ступеней
    }
  });
});

describe('💎 за заказ: только «цель», от уровня лабы, а не от цены', () => {
  it('дешёвый заказ-«цель» всё равно даёт 💎 (правила «от 500 ценности» больше нет)', () => {
    const s = createInitialState(makeRng(20), 0);
    s.level = 1; // самый дешёвый пул: породы 1-го скрытого уровня
    const rng = makeRng(21);
    let sawCheap = false;
    for (let i = 0; i < 100; i++) {
      const o = generateOrder(s, rng, 0, 'target');
      expect(o.kind).toBe('target');
      expect(o.reward.crystals).toBe(ORDER_CRYSTALS);
      if (o.reward.coins < 500) sawCheap = true;
    }
    expect(sawCheap).toBe(true); // на L1 такие заказы раньше шли без 💎
  });

  it('💎 растёт с уровнем лаборатории: 1 → 2 → 3 и не выше потолка', () => {
    expect(orderCrystalsFor(1)).toBe(ORDER_CRYSTALS);
    for (let l = 1; l <= MAX_LEVEL; l++) {
      const expected = ORDER_CRYSTALS + ORDER_CRYSTAL_LEVELS.filter((t) => l >= t).length;
      expect(orderCrystalsFor(l)).toBe(Math.min(ORDER_CRYSTALS_MAX, expected));
      expect(orderCrystalsFor(l)).toBeGreaterThanOrEqual(orderCrystalsFor(l - 1)); // монотонно
    }
    expect(orderCrystalsFor(MAX_LEVEL)).toBe(ORDER_CRYSTALS_MAX);
    expect(orderCrystalsFor(0)).toBe(ORDER_CRYSTALS); // битый сейв → как на 1-м уровне
  });

  it('заказ-«цель» выдаёт 💎 по текущему уровню лабы, «сбыт» — 0 либо ORDER_SELL_CRYSTALS', () => {
    const s = createInitialState(makeRng(40), 0);
    s.discoveredBreeds = ['persian'];
    const rng = makeRng(41);
    for (let l = 1; l <= MAX_LEVEL; l++) {
      s.level = l;
      expect(generateOrder(s, rng, 0, 'target').reward.crystals).toBe(orderCrystalsFor(l));
      expect([0, ORDER_SELL_CRYSTALS]).toContain(generateOrder(s, rng, 0, 'sell').reward.crystals);
    }
  });

  it('заказ-«сбыт»: 💎 не зависит от уровня лабы и выпадает примерно в половине случаев', () => {
    const s = createInitialState(makeRng(22), 0);
    s.level = 10;                       // дорогой пул: цена заказа заведомо выше 500
    s.discoveredBreeds = ['persian'];
    const rng = makeRng(23);
    let withGem = 0;
    const n = 400;
    for (let i = 0; i < n; i++) {
      const o = generateOrder(s, rng, 0, 'sell');
      expect(o.kind).toBe('sell');
      expect(o.req.breed).toBe('persian');
      // уровень лабы 10 дал бы «цели» 3 💎 — «сбыт» платит ровно 1 либо ничего
      expect([0, ORDER_SELL_CRYSTALS]).toContain(o.reward.crystals);
      if (o.reward.crystals) withGem++;
    }
    expect(Math.abs(withGem / n - ORDER_SELL_CRYSTAL_CHANCE)).toBeLessThan(0.08);
  });

  it('сбывать нечего → слот «сбыт» падает на «цель» и даёт 💎', () => {
    const s = createInitialState(makeRng(24), 0);
    s.discoveredBreeds = [];
    const o = generateOrder(s, makeRng(25), 0, 'sell');
    expect(o.kind).toBe('target');
    expect(o.reward.crystals).toBe(orderCrystalsFor(s.level));
  });

  it('доска: первые ORDER_SELL_SLOTS — «сбыт», остальные — «цель», и каждая «цель» с 💎', () => {
    const s = createInitialState(makeRng(26), 0);
    s.discoveredBreeds = ['persian', 'siamese'];
    initOrders(s, makeRng(27), 0);
    const kinds = s.orders.map((o) => o.kind);
    expect(kinds).toEqual(s.orders.map((_, i) => (i < ORDER_SELL_SLOTS ? 'sell' : 'target')));
    expect(s.orders.filter((o) => o.kind === 'target' && o.reward.crystals > 0).length)
      .toBe(ORDER_TARGET - ORDER_SELL_SLOTS);
    // тип слота держится и после смены заказа по таймеру
    for (const o of s.orders) o.expiresAt = 1;
    refreshExpiredOrders(s, makeRng(28), 1000);
    expect(s.orders.map((o) => o.kind)).toEqual(kinds);
  });
});

describe('корзина заказов — отдельное место (как слот вязки и пьедестал)', () => {
  const addCat = (s: GameState, sex: 'female' | 'male' = 'female') => {
    const c = makeCatInstance(s, makeCat(sex), 0, 'nursery', 'persian');
    s.cats.push(c);
    return c;
  };

  it('кот в корзине не занимает места в комнате', () => {
    const s = createInitialState(makeRng(60), 0);
    s.cats = [];
    const cat = addCat(s);
    expect(roomCount(s, 'nursery')).toBe(1);
    expect(putCatInBasket(s, cat.id).ok).toBe(true);
    expect(roomCount(s, 'nursery')).toBe(0); // «в переноске», а не на полу
    expect(isInBasket(s, cat.id)).toBe(true);
  });

  it('кота из слота вязки можно положить в корзину — слот освобождается', () => {
    const s = createInitialState(makeRng(61), 0);
    s.cats = [];
    const cat = addCat(s);
    expect(assignBreeder(s, 0, cat.id, 0).ok).toBe(true);
    expect(isInSlot(s, cat.id)).toBe(true);
    expect(putCatInBasket(s, cat.id).ok).toBe(true);
    expect(isInSlot(s, cat.id)).toBe(false);
    expect(isInBasket(s, cat.id)).toBe(true);
  });

  it('идёт вязка — кота в корзину не забрать', () => {
    const s = createInitialState(makeRng(62), 0);
    s.cats = [];
    const female = addCat(s, 'female');
    const male = addCat(s, 'male');
    assignBreeder(s, 0, female.id, 0);
    assignBreeder(s, 0, male.id, 0);
    expect(startBreeding(s, 0, female.id, male.id, 0, makeRng(62)).ok).toBe(true);
    expect(putCatInBasket(s, female.id).ok).toBe(false);
    expect(s.orderBasket).toBeNull();
  });

  it('из корзины на пьедестал — кот только на пьедестале, без дубля', () => {
    const s = createInitialState(makeRng(63), 0);
    s.cats = [];
    const cat = addCat(s);
    putCatInBasket(s, cat.id);
    expect(setChampion(s, cat.id, 0, 0).ok).toBe(true);
    expect(isChampion(s, cat.id)).toBe(true);
    expect(s.orderBasket).toBeNull(); // корзина пуста — кот не «раздвоился»
  });

  it('в корзину с пьедестала — кот только в корзине', () => {
    const s = createInitialState(makeRng(64), 0);
    s.cats = [];
    const cat = addCat(s);
    setChampion(s, cat.id, 0, 0);
    expect(putCatInBasket(s, cat.id).ok).toBe(true);
    expect(isChampion(s, cat.id)).toBe(false);
    expect(isInBasket(s, cat.id)).toBe(true);
  });

  it('обратно на пол — только если в комнате есть место', () => {
    const s = createInitialState(makeRng(65), 0);
    s.cats = [];
    const cat = addCat(s);
    putCatInBasket(s, cat.id);
    // забиваем питомник до потолка, пока кот «в переноске»
    while (roomCount(s, 'nursery') < nurseryCapacity(s)) addCat(s);
    expect(moveCat(s, cat.id, 'nursery', 0).ok).toBe(false); // некуда — остаётся в корзине
    expect(isInBasket(s, cat.id)).toBe(true);
    expect(moveCat(s, cat.id, 'shelter', 0).ok).toBe(true);  // в приюте место есть
    expect(s.orderBasket).toBeNull();
    expect(cat.location).toBe('shelter');
  });

  it('вытесненному из корзины коту ищется пол, иначе замена не проходит', () => {
    const s = createInitialState(makeRng(66), 0);
    s.cats = [];
    const first = addCat(s);
    const second = addCat(s);
    putCatInBasket(s, first.id);
    // питомник и приют забиты — первому некуда вернуться
    while (roomCount(s, 'nursery') < nurseryCapacity(s)) addCat(s);
    while (roomCount(s, 'shelter') < shelterCapacity(s)) {
      const c = makeCatInstance(s, makeCat('female'), 0, 'shelter', 'persian');
      s.cats.push(c);
    }
    expect(putCatInBasket(s, second.id).ok).toBe(false);
    expect(isInBasket(s, first.id)).toBe(true); // корзина не тронута
  });
});
