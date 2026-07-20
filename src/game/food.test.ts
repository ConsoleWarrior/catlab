import { describe, it, expect } from 'vitest';
import { makeRng, makeCat } from '../genetics/index.js';
import {
  createInitialState, serialize, deserialize, makeCatInstance,
  foodRatePerMin, isStarving, foodMinutesLeft, consumeFood, foodLevel, feedingCatCount, foodBuyQuote,
  buyFood, collectIncome, passiveRatePerMin, offlineCapMin, setChampion, startBreeding,
} from './index.js';
import * as C from './config.js';
import type { GameState } from './index.js';

function addCat(s: GameState, breed: string, sex: 'female' | 'male' = 'female') {
  const c = makeCatInstance(s, makeCat(sex), 0, 'nursery', breed);
  s.cats.push(c);
  return c;
}

function pair(s: GameState) {
  const female = s.cats.find((c) => c.genotype.sex === 'female')!;
  const male = s.cats.find((c) => c.genotype.sex === 'male')!;
  return { female, male };
}

describe('consumeFood и сытые минуты', () => {
  it('списывает корм и возвращает сытые минуты; при опустошении — меньше запрошенного', () => {
    const s = createInitialState(makeRng(1), 0);
    s.level = 3;
    s.cats = [];
    for (let i = 0; i < 20; i++) addCat(s, 'moggie'); // 20 × 0.05 → rate 1.0/мин
    expect(foodRatePerMin(s)).toBeCloseTo(1.0);
    s.food = 10;
    expect(consumeFood(s, 4)).toBeCloseTo(4);  // хватило → 4 сытые минуты
    expect(s.food).toBeCloseTo(6);
    expect(consumeFood(s, 20)).toBeCloseTo(6); // осталось на 6 минут
    expect(s.food).toBe(0);
  });

  it('механика активна с 1-го уровня (коты едят сразу); ниже гейта — расхода нет', () => {
    const s = createInitialState(makeRng(2), 0);
    s.cats = [];
    for (let i = 0; i < 20; i++) addCat(s, 'moggie');
    // стартовый уровень 1 → кормушка уже работает, корм тратится
    expect(s.level).toBe(1);
    const before = foodLevel(s);
    consumeFood(s, 30);
    expect(foodLevel(s)).toBeLessThan(before);   // корм тронут с 1-го уровня
    // ниже уровня открытия (искусственный ур. 0) — механика выключена
    s.level = 0;
    s.food = C.FOOD_CAP_BASE;
    const before0 = foodLevel(s);
    expect(consumeFood(s, 30)).toBe(30);
    expect(foodLevel(s)).toBe(before0); // корм не тронут
  });

  it('foodMinutesLeft: запас / расход (Infinity без расхода)', () => {
    const s = createInitialState(makeRng(3), 0);
    s.level = 3;
    s.cats = [];
    for (let i = 0; i < 20; i++) addCat(s, 'moggie'); // 20 × 0.05 → rate 1.0
    s.food = 50;
    expect(foodMinutesLeft(s)).toBeCloseTo(50);
    s.cats = []; // ртов не осталось → расхода нет
    expect(foodMinutesLeft(s)).toBe(Infinity);
    expect(isStarving(s)).toBe(false);
  });

  it('замороженные в крио-банке корм не едят', () => {
    const s = createInitialState(makeRng(4), 0);
    s.level = 3;
    s.cats = [];
    for (let i = 0; i < 5; i++) addCat(s, 'moggie');
    const before = foodRatePerMin(s);
    s.cryo = [s.cats.pop()!]; // кот уехал в капсулу — из state.cats он выбыл
    expect(feedingCatCount(s)).toBe(4);
    expect(foodRatePerMin(s)).toBeCloseTo(before - C.FOOD_PER_MIN_BY_TIER.common);
  });

  it('чемпионы и коты в слотах вязки тоже едят', () => {
    const s = createInitialState(makeRng(5), 0);
    s.level = 3;
    s.cats = [];
    const champ = addCat(s, 'maine_coon'); // T3 → 0.15
    setChampion(s, champ.id, 0, 0);
    expect(feedingCatCount(s)).toBe(1);
    expect(foodRatePerMin(s)).toBeCloseTo(0.15); // на пьедестале, но с довольствия не снят
  });
});

describe('collectIncome с кормом', () => {
  it('доход только за сытые минуты, корм тратится за всё отсутствие', () => {
    const s = createInitialState(makeRng(10), 0);
    s.level = 3;
    s.cats = [];
    const champ = addCat(s, 'savannah');             // T5 → 0.25/мин
    for (let i = 0; i < 7; i++) addCat(s, 'moggie'); // 7 × 0.05 → всего 0.6/мин
    setChampion(s, champ.id, 0, 0);
    const rate = foodRatePerMin(s);
    expect(rate).toBeCloseTo(0.6);
    s.food = 3;          // хватит на 5 минут
    s.lastSeenAt = 0;
    const passive = passiveRatePerMin(s);
    const r = collectIncome(s, 10 * 60_000); // отсутствовали 10 минут
    expect(s.food).toBe(0);
    expect(r.coins).toBe(Math.floor(passive * (3 / rate))); // доход за сытые минуты
  });

  it('когда корма хватило, доход упирается в офлайн-потолок', () => {
    const s = createInitialState(makeRng(11), 0);
    s.level = 3;
    s.cats = [];
    const champ = addCat(s, 'savannah'); // 0.25/мин — корма (200) хватит на 800 мин
    setChampion(s, champ.id, 0, 0);
    s.food = C.FOOD_CAP_BASE;
    s.lastSeenAt = 0;
    const cap = offlineCapMin(s);            // 120 мин
    const passive = passiveRatePerMin(s);
    const r = collectIncome(s, 300 * 60_000); // 300 мин: корма хватило, потолок — нет
    expect(r.coins).toBe(Math.floor(passive * cap));
    expect(s.food).toBeCloseTo(C.FOOD_CAP_BASE - C.FOOD_PER_MIN_BY_TIER.legendary * 300); // корм съеден за всё отсутствие
  });
});

describe('buyFood', () => {
  it('пакет добавляет корм и списывает монеты пропорционально', () => {
    const s = createInitialState(makeRng(20), 0);
    s.food = 0; s.coins = 1000;
    const r = buyFood(s, 'pack');
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.added).toBe(C.FOOD_PACK_UNITS);
      expect(s.food).toBe(C.FOOD_PACK_UNITS);
      expect(r.spent).toBe(C.FOOD_PACK_COST);
      expect(s.coins).toBe(1000 - r.spent);
    }
  });

  it('«до полного» заполняет кормушку', () => {
    const s = createInitialState(makeRng(21), 0);
    s.food = 40; s.coins = 1000;
    const r = buyFood(s, 'full');
    expect(r.ok).toBe(true);
    expect(s.food).toBe(C.FOOD_CAP_BASE);
  });

  it('почти полная кормушка (место < 1 ед.) — отказ, а не продажа остатка за 1💰', () => {
    const s = createInitialState(makeRng(24), 0);
    s.coins = 1000;
    s.food = C.FOOD_CAP_BASE - 0.3; // дробный запас — обычное дело при расходе по кадрам
    expect(foodBuyQuote(s, 'pack')).toMatchObject({ units: 0, cost: 0 });
    expect(buyFood(s, 'pack')).toMatchObject({ ok: false, reason: 'кормушка полна' });
    expect(s.coins).toBe(1000); // монеты не списаны
  });

  it('пакет не превышает свободного места и не даёт дробных единиц', () => {
    const s = createInitialState(makeRng(25), 0);
    s.coins = 1000;
    s.food = C.FOOD_CAP_BASE - 20.6;     // места 20.6 → пакет даёт целые 20
    expect(foodBuyQuote(s, 'pack')).toMatchObject({ units: 20, cost: 10 });
    expect(foodBuyQuote(s, 'full').units).toBeCloseTo(20.6); // «до полного» — ровно доверху
  });

  it('полная кормушка и нехватка монет — отказ', () => {
    const full = createInitialState(makeRng(22), 0); // стартует полной
    expect(buyFood(full, 'pack')).toMatchObject({ ok: false });
    const broke = createInitialState(makeRng(23), 0);
    broke.food = 0; broke.coins = 0;
    expect(buyFood(broke, 'pack')).toMatchObject({ ok: false, reason: 'не хватает монет' });
  });
});

describe('голод блокирует вязку', () => {
  it('startBreeding отказывает при пустой кормушке, работает после кормёжки', () => {
    const s = createInitialState(makeRng(30), 0);
    s.level = 3;
    const { female, male } = pair(s);
    for (let i = 0; i < 5; i++) addCat(s, 'moggie'); // расход есть
    s.food = 0;
    expect(isStarving(s)).toBe(true);
    expect(startBreeding(s, 0, female.id, male.id, 0)).toMatchObject({ ok: false });
    s.food = 100;
    expect(startBreeding(s, 0, female.id, male.id, 0).ok).toBe(true);
  });
});

describe('миграция сейва', () => {
  it('старый сейв без food → полная кормушка', () => {
    const s = createInitialState(makeRng(40), 0);
    const raw = JSON.parse(serialize(s)) as Record<string, unknown>;
    delete raw.food;
    const restored = deserialize(JSON.stringify(raw));
    expect(restored.food).toBe(C.FOOD_CAP_BASE);
  });
});
