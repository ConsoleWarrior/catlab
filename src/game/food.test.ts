import { describe, it, expect } from 'vitest';
import { makeRng, makeCat } from '../genetics/index.js';
import {
  createInitialState, serialize, deserialize, makeCatInstance,
  foodRatePerMin, isStarving, foodMinutesLeft, consumeFood, foodLevel,
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
    for (let i = 0; i < 8; i++) addCat(s, 'moggie'); // billable 5 → rate 1.0/мин
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
    for (let i = 0; i < 8; i++) addCat(s, 'moggie'); // rate 1.0
    s.food = 50;
    expect(foodMinutesLeft(s)).toBeCloseTo(50);
    s.cats = s.cats.slice(0, 3); // ≤ бесплатного лимита → расхода нет
    expect(foodMinutesLeft(s)).toBe(Infinity);
    expect(isStarving(s)).toBe(false);
  });
});

describe('collectIncome с кормом', () => {
  it('доход только за сытые минуты, корм тратится за всё отсутствие', () => {
    const s = createInitialState(makeRng(10), 0);
    s.level = 3;
    s.cats = [];
    const champ = addCat(s, 'savannah');
    for (let i = 0; i < 7; i++) addCat(s, 'moggie'); // всего 8 → rate 1.0/мин
    setChampion(s, champ.id, 0, 0);
    s.food = 3;          // хватит на 3 минуты
    s.lastSeenAt = 0;
    const passive = passiveRatePerMin(s);
    const r = collectIncome(s, 10 * 60_000); // отсутствовали 10 минут
    expect(s.food).toBe(0);
    expect(r.coins).toBe(Math.floor(passive * 3)); // доход за 3 сытые минуты
  });

  it('без расхода корма доход упирается в офлайн-потолок', () => {
    const s = createInitialState(makeRng(11), 0);
    s.level = 3;
    s.cats = [];
    const champ = addCat(s, 'savannah'); // 1 кот — в пределах бесплатного лимита, расхода нет
    setChampion(s, champ.id, 0, 0);
    s.food = C.FOOD_CAP_BASE;
    s.lastSeenAt = 0;
    const cap = offlineCapMin(s);
    const passive = passiveRatePerMin(s);
    const r = collectIncome(s, cap * 60_000 * 5); // далеко за потолком
    expect(r.coins).toBe(Math.floor(passive * cap));
    expect(s.food).toBe(C.FOOD_CAP_BASE); // расхода не было
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
