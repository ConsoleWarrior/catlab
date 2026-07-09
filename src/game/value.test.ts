import { describe, it, expect } from 'vitest';
import { makeRng, makeCat } from '../genetics/index.js';
import {
  createInitialState, makeCatInstance, catMarketValue, healthValueMult,
  sendToLab, foodRatePerMin, isStarving, netIncomePerMin, passiveRatePerMin, championIncomePerMin,
  setChampion, unsetChampion, championIds, championAt, championSlots, isChampion, adoptCat,
  startBreeding, collectReady, incubationDuration, speedUpBreeding, speedUpCost,
  adSkipBreeding, speedUpGrowth, adSkipGrowth, growthRemainingMs, isAdult,
  assignBreeder, isInSlot, nurseryCapacity, shelterCapacity, moveCat,
} from './index.js';
import * as C from './config.js';
import type { GameState } from './index.js';

function addCat(s: GameState, breed: string, sex: 'female' | 'male' = 'female') {
  const c = makeCatInstance(s, makeCat(sex), 0, 'nursery', breed);
  s.cats.push(c);
  return c;
}

describe('catMarketValue', () => {
  it('старший тир заметно дороже младшего', () => {
    const s = createInitialState(makeRng(1), 0);
    const moggie = makeCatInstance(s, makeCat('female'), 0, 'nursery', 'moggie');       // common
    const savannah = makeCatInstance(s, makeCat('male'), 0, 'nursery', 'savannah');     // legendary
    expect(catMarketValue(savannah)).toBeGreaterThan(catMarketValue(moggie));
  });

  it('внутри тира труднокрафтовая порода дороже лёгкой', () => {
    const s = createInitialState(makeRng(2), 0);
    const exotic = makeCatInstance(s, makeCat('female'), 0, 'nursery', 'exotic_shorthair'); // рецепт 0.90 — легко
    const persian = makeCatInstance(s, makeCat('male'), 0, 'nursery', 'persian');           // сложнее
    expect(catMarketValue(persian)).toBeGreaterThan(catMarketValue(exotic));
  });

  it('здоровье влияет: урезанные сердца дешевле', () => {
    const s = createInitialState(makeRng(3), 0);
    const healthy = makeCatInstance(s, makeCat('female'), 0, 'nursery', 'persian');
    const sick = makeCatInstance(s, makeCat('male'), 0, 'nursery', 'persian');
    sick.maxHearts = 1;
    expect(healthValueMult(healthy)).toBe(1);
    expect(catMarketValue(sick)).toBeLessThan(catMarketValue(healthy));
  });
});

describe('корм и мягкий голод', () => {
  it('расход корма 0 до лимита котов, растёт сверх лимита (механика открыта)', () => {
    const s = createInitialState(makeRng(4), 0);
    s.level = 3; // кормушка открывается уровнем лаборатории
    s.cats = [];
    for (let i = 0; i < C.FEED_FREE_CATS; i++) addCat(s, 'moggie');
    expect(foodRatePerMin(s)).toBe(0);
    addCat(s, 'moggie');
    addCat(s, 'moggie');
    expect(foodRatePerMin(s)).toBeCloseTo(2 * C.FOOD_PER_CAT_PER_MIN);
  });

  it('ниже гейта кормушки (искусственный ур.0) корм не расходуется и голода нет', () => {
    const s = createInitialState(makeRng(14), 0);
    s.level = 0; // ниже LAB_UNLOCKS.food (=1) — механика выключена
    s.cats = [];
    for (let i = 0; i < 20; i++) addCat(s, 'moggie');
    s.food = 0;
    expect(foodRatePerMin(s)).toBe(0);
    expect(isStarving(s)).toBe(false);
    expect(netIncomePerMin(s)).toBe(passiveRatePerMin(s)); // доход без вычета корма
  });

  it('пустая кормушка → голод → доход 0 (казна не в минус)', () => {
    const s = createInitialState(makeRng(5), 0);
    s.level = 3;
    s.cats = [];
    const champ = addCat(s, 'savannah');              // ценный чемпион — заметный доход
    for (let i = 0; i < 10; i++) addCat(s, 'moggie'); // много ртов
    setChampion(s, champ.id, 0, 0);
    expect(passiveRatePerMin(s)).toBeGreaterThan(0);
    s.food = 0;
    expect(isStarving(s)).toBe(true);
    expect(netIncomePerMin(s)).toBe(0);
  });
});

describe('выставка (чемпионы)', () => {
  it('нельзя выставить больше слотов; продажа снимает с выставки', () => {
    const s = createInitialState(makeRng(6), 0);
    s.cats = [];
    const a = addCat(s, 'persian');
    const b = addCat(s, 'siamese');
    expect(championSlots(s)).toBe(C.CHAMPION_SLOTS_BASE); // 1 по умолчанию
    expect(setChampion(s, a.id, 0, 0).ok).toBe(true);
    expect(setChampion(s, b.id, 1, 0).ok).toBe(false);     // пьедестал 1 ещё заперт
    s.upgrades.championSlots = 1;                          // +1 слот
    expect(setChampion(s, b.id, 1, 0).ok).toBe(true);
    expect(championIds(s)).toHaveLength(2);
    adoptCat(s, a.id);                                      // продали чемпиона
    expect(championIds(s)).toEqual([b.id]);
  });

  it('доход чемпиона ∝ его рыночной ценности', () => {
    const s = createInitialState(makeRng(7), 0);
    s.cats = [];
    const cheap = addCat(s, 'persian');   // uncommon
    const pricey = addCat(s, 'savannah'); // legendary
    setChampion(s, cheap.id, 0, 0);
    const low = passiveRatePerMin(s);
    unsetChampion(s, cheap.id);
    setChampion(s, pricey.id, 0, 0);
    expect(passiveRatePerMin(s)).toBeGreaterThan(low);
  });

  it('встаёт именно на тот пьедестал, куда уронили, а не на первый свободный по порядку', () => {
    const s = createInitialState(makeRng(15), 0);
    s.cats = [];
    const a = addCat(s, 'persian');
    const b = addCat(s, 'siamese');
    s.upgrades.championSlots = 1; // 2 пьедестала открыты
    expect(setChampion(s, a.id, 0, 0).ok).toBe(true);
    expect(setChampion(s, b.id, 1, 0).ok).toBe(true); // явно на второй, не «следующий свободный»
    expect(championAt(s, 0)?.id).toBe(a.id);
    expect(championAt(s, 1)?.id).toBe(b.id);
  });

  it('перетаскивание на занятый пьедестал меняет чемпионов местами', () => {
    const s = createInitialState(makeRng(16), 0);
    s.cats = [];
    const a = addCat(s, 'persian');
    const b = addCat(s, 'siamese');
    s.upgrades.championSlots = 1;
    setChampion(s, a.id, 0, 0);
    setChampion(s, b.id, 1, 0);
    expect(setChampion(s, b.id, 0, 0).ok).toBe(true); // b → слот 0, занятый a
    expect(championAt(s, 0)?.id).toBe(b.id);
    expect(championAt(s, 1)?.id).toBe(a.id); // a переехал на освободившийся пьедестал b
  });

  it('кот с пола меняется местами с чемпионом на занятом пьедестале', () => {
    const s = createInitialState(makeRng(17), 0);
    s.cats = [];
    const champ = addCat(s, 'persian');
    const floorCat = addCat(s, 'siamese'); // на полу питомника
    setChampion(s, champ.id, 0, 0);
    expect(setChampion(s, floorCat.id, 0, 0).ok).toBe(true);
    expect(championAt(s, 0)?.id).toBe(floorCat.id);
    expect(isChampion(s, champ.id)).toBe(false);
    expect(champ.location).toBe('nursery'); // ушёл на пол питомника, а не пропал
  });

  it('кот из слота вязки становится чемпионом без обмена — снятый чемпион уезжает в питомник', () => {
    const s = createInitialState(makeRng(18), 0);
    s.cats = [];
    const champ = addCat(s, 'persian');
    setChampion(s, champ.id, 0, 0);
    const mother = addCat(s, 'siamese', 'female');
    const father = addCat(s, 'siamese', 'male');
    assignBreeder(s, 0, mother.id, 0);
    assignBreeder(s, 0, father.id, 0);
    expect(isInSlot(s, mother.id)).toBe(true);
    expect(setChampion(s, mother.id, 0, 0).ok).toBe(true);
    expect(championAt(s, 0)?.id).toBe(mother.id);
    expect(isChampion(s, champ.id)).toBe(false);
    expect(champ.location).toBe('nursery'); // снятый чемпион — на полу питомника (было место)
    expect(isInSlot(s, mother.id)).toBe(false); // слот вязки освобождён, а не «занят» пришедшим
    expect(s.slots[0]!.motherId).toBeNull();
  });

  it('нет места ни в питомнике, ни в приюте → отказ, слот вязки и пьедестал не трогаем', () => {
    const s = createInitialState(makeRng(19), 0);
    s.cats = [];
    const champ = addCat(s, 'persian');
    setChampion(s, champ.id, 0, 0);
    for (let i = 0; i < nurseryCapacity(s); i++) addCat(s, 'moggie');
    for (let i = 0; i < shelterCapacity(s); i++) {
      s.cats.push(makeCatInstance(s, makeCat('female'), 0, 'shelter', 'moggie'));
    }
    const mother = addCat(s, 'siamese', 'female');
    const father = addCat(s, 'siamese', 'male');
    assignBreeder(s, 0, mother.id, 0);
    assignBreeder(s, 0, father.id, 0);
    const r = setChampion(s, mother.id, 0, 0);
    expect(r.ok).toBe(false);
    expect(r.ok === false && r.reason).toBe('нет места в лаборатории');
    expect(isInSlot(s, mother.id)).toBe(true); // слот вязки не тронут
    expect(championAt(s, 0)?.id).toBe(champ.id); // пьедестал не тронут
  });

  it('нет места в питомнике → снятие с пьедестала отклоняется, кот остаётся чемпионом', () => {
    const s = createInitialState(makeRng(21), 0);
    s.cats = [];
    const champ = addCat(s, 'persian');
    setChampion(s, champ.id, 0, 0); // location у чемпиона уже 'nursery' — ловушка старого бага
    for (let i = 0; i < nurseryCapacity(s); i++) addCat(s, 'moggie'); // питомник забит под завязку
    const r = moveCat(s, champ.id, 'nursery');
    expect(r.ok).toBe(false);
    expect(isChampion(s, champ.id)).toBe(true); // не «просочился» на пол сверх лимита
    expect(championAt(s, 0)?.id).toBe(champ.id);
  });
});

describe('лаборатория и ускорение', () => {
  it('sendToLab даёт гены и убирает кота', () => {
    const s = createInitialState(makeRng(8), 0);
    s.level = 10; // станция «в лабораторию» открыта уровнем
    const cat = addCat(s, 'persian');
    const before = s.dna;
    const r = sendToLab(s, cat.id);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.dna).toBeGreaterThan(0);
      expect(s.dna).toBe(before + r.dna);
    }
    expect(s.cats.find((c) => c.id === cat.id)).toBeUndefined();
  });

  it('speedUpBreeding завершает вязку за 💎', () => {
    const rng = makeRng(9);
    const s = createInitialState(rng, 0);
    const female = s.cats.find((c) => c.genotype.sex === 'female')!;
    const male = s.cats.find((c) => c.genotype.sex === 'male')!;
    const now = 1000; // ненулевое время (readyAt=0 — это «пустой слот»)
    startBreeding(s, 0, female.id, male.id, now);
    const cost = speedUpCost(incubationDuration(s));
    s.crystals = cost;
    expect(speedUpBreeding(s, 0, now).ok).toBe(true);
    expect(s.crystals).toBe(0);
    const ev = collectReady(s, now, rng); // готово немедленно
    expect(ev[0]!.kitten).toBeDefined();
  });

  it('adSkipBreeding сокращает остаток вязки на AD_SKIP_MS (бесплатно)', () => {
    const s = createInitialState(makeRng(10), 0);
    const female = s.cats.find((c) => c.genotype.sex === 'female')!;
    const male = s.cats.find((c) => c.genotype.sex === 'male')!;
    const now = 1_000_000;
    s.slots[0] = { motherId: female.id, fatherId: male.id, startedAt: now, readyAt: now + 60 * 60_000, kittenId: null };
    const before = s.slots[0]!.readyAt;
    const crystals = s.crystals;
    expect(adSkipBreeding(s, 0, now).ok).toBe(true);
    expect(before - s.slots[0]!.readyAt).toBe(C.AD_SKIP_MS);
    expect(s.crystals).toBe(crystals); // реклама бесплатна
  });

  it('speedUpGrowth растит котёнка сразу за 💎', () => {
    const s = createInitialState(makeRng(11), 0);
    const now = 1000;
    const kitten = makeCatInstance(s, makeCat('female'), now, 'nursery', 'moggie');
    kitten.bornAt = now; // только родился — растёт
    s.cats.push(kitten);
    expect(isAdult(kitten, now)).toBe(false);
    s.crystals = speedUpCost(growthRemainingMs(kitten, now));
    expect(speedUpGrowth(s, kitten.id, now).ok).toBe(true);
    expect(isAdult(kitten, now)).toBe(true);
    expect(s.crystals).toBe(0);
  });

  it('adSkipGrowth сокращает остаток роста на AD_SKIP_MS (бесплатно)', () => {
    const s = createInitialState(makeRng(12), 0);
    const now = 1000;
    const kitten = makeCatInstance(s, makeCat('female'), now, 'nursery', 'moggie');
    kitten.bornAt = now;
    kitten.growthMs = 60 * 60_000; // длинный рост, чтобы скип был частичным
    s.cats.push(kitten);
    const before = growthRemainingMs(kitten, now);
    expect(adSkipGrowth(s, kitten.id, now).ok).toBe(true);
    expect(before - growthRemainingMs(kitten, now)).toBe(C.AD_SKIP_MS);
  });

  it('championIncomePerMin растёт с исследованиями дохода', () => {
    const s = createInitialState(makeRng(13), 0);
    s.cats = [];
    const cat = addCat(s, 'savannah');
    const base = championIncomePerMin(s, cat);
    s.research = ['r_income1', 'r_income2']; // +25% +35% = +60%
    expect(championIncomePerMin(s, cat)).toBeCloseTo(base * (1 + 0.25 + 0.35));
  });
});
