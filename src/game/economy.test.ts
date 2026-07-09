import { describe, it, expect } from 'vitest';
import { makeRng } from '../genetics/index.js';
import {
  createInitialState, nurseryCapacity, shelterCapacity, incubationDuration,
  mutationRate, offlineCapMin, upgradeCost, upgradeMaxed, passiveRatePerMin,
  adoptReward, isOld, breedsLeft, isSterile, heartsOf, catMarketValue,
} from './index.js';
import * as C from './config.js';

describe('createInitialState', () => {
  it('стартовые ресурсы, пара котов, 1 слот и 3 заказа', () => {
    const s = createInitialState(makeRng(1), 0);
    expect(s.coins).toBe(100);
    expect(s.crystals).toBe(5);
    expect(s.dna).toBe(0);
    expect(s.level).toBe(1);
    expect(s.cats).toHaveLength(2);
    expect(s.cats.some((c) => c.genotype.sex === 'female')).toBe(true);
    expect(s.cats.some((c) => c.genotype.sex === 'male')).toBe(true);
    expect(s.slots).toHaveLength(1);
    expect(s.orders).toHaveLength(3);
  });
});

describe('геттеры прокачки', () => {
  it('вместимости растут с уровнем', () => {
    const s = createInitialState(makeRng(2), 0);
    expect(nurseryCapacity(s)).toBe(C.NURSERY_BASE_CAP);
    expect(shelterCapacity(s)).toBe(C.SHELTER_BASE_CAP);
    s.upgrades.nurseryCap = 2;
    s.upgrades.shelterCap = 1;
    expect(nurseryCapacity(s)).toBe(C.NURSERY_BASE_CAP + 2 * C.NURSERY_CAP_STEP);
    expect(shelterCapacity(s)).toBe(C.SHELTER_BASE_CAP + C.SHELTER_CAP_STEP);
  });

  it('длительность инкубации постоянна (апгрейд скорости удалён на C0)', () => {
    const s = createInitialState(makeRng(3), 0);
    expect(incubationDuration(s)).toBe(Math.max(C.INCUBATION_MIN_MS, C.INCUBATION_BASE_MS));
    s.upgrades.speed = 2; // легаси-ключ больше ни на что не влияет
    expect(incubationDuration(s)).toBe(Math.max(C.INCUBATION_MIN_MS, C.INCUBATION_BASE_MS));
  });

  it('шанс мутации постоянный (базовый; апгрейд мутагена удалён)', () => {
    const s = createInitialState(makeRng(4), 0);
    expect(mutationRate(s)).toBeCloseTo(C.MUTATION_BASE);
    s.upgrades.mutation = 3; // легаси-ключ больше ни на что не влияет
    expect(mutationRate(s)).toBeCloseTo(C.MUTATION_BASE);
  });

  it('потолок офлайн-дохода растёт узлом «Ночной смотритель»', () => {
    const s = createInitialState(makeRng(5), 0);
    expect(offlineCapMin(s)).toBe(C.OFFLINE_CAP_BASE_MIN);
    s.research = ['r_infra1', 'r_infra2', 'r_infra3'];
    expect(offlineCapMin(s)).toBe(C.OFFLINE_CAP_BASE_MIN + 180);
  });
});

describe('стоимость апгрейдов', () => {
  it('слоты дорожают по кривой', () => {
    const s = createInitialState(makeRng(6), 0);
    expect(upgradeCost(s, 'slots')).toEqual({ currency: 'coins', amount: 500 });
    s.slots.push({ motherId: null, fatherId: null, startedAt: 0, readyAt: 0, kittenId: null });
    expect(upgradeCost(s, 'slots')).toEqual({ currency: 'coins', amount: 2000 });
  });

  it('обычный апгрейд дорожает по mult', () => {
    const s = createInitialState(makeRng(7), 0);
    expect(upgradeCost(s, 'nurseryCap')).toEqual({ currency: 'coins', amount: 200 });
    s.upgrades.nurseryCap = 1;
    expect(upgradeCost(s, 'nurseryCap')).toEqual({ currency: 'coins', amount: Math.round(200 * 1.6) });
  });

  it('upgradeMaxed по достижении максимума', () => {
    const s = createInitialState(makeRng(8), 0);
    expect(upgradeMaxed(s, 'slots')).toBe(false);
    while (s.slots.length - 1 < C.UPGRADES.slots!.max) {
      s.slots.push({ motherId: null, fatherId: null, startedAt: 0, readyAt: 0, kittenId: null });
    }
    expect(upgradeMaxed(s, 'slots')).toBe(true);
    expect(upgradeMaxed(s, 'нет-такого')).toBe(true);
  });
});

describe('доход и пристройство', () => {
  it('пассивный доход считается по чемпионам (без них — ноль)', () => {
    const s = createInitialState(makeRng(9), 0);
    expect(passiveRatePerMin(s)).toBe(0); // чемпионов нет — дохода нет
    const champ = s.cats[0]!;
    s.champions = [champ.id];
    expect(passiveRatePerMin(s)).toBeCloseTo(catMarketValue(champ) * C.CHAMPION_INCOME_RATE);
  });

  it('награда за пристройство = доля рыночной цены (легаси-множители удалены)', () => {
    const s = createInitialState(makeRng(10), 0);
    const cat = s.cats[0]!;
    const market = catMarketValue(cat);
    const dnaBase = C.TIER_VALUE[cat.rarityTier].dna;
    expect(adoptReward(s, cat)).toEqual({
      coins: Math.round(market * C.ADOPT_COIN_FRACTION),
      dna: Math.max(1, Math.round(dnaBase * C.ADOPT_DNA_FRACTION)),
    });
    // легаси-ключи connections/biobank больше не влияют на награду
    s.upgrades.connections = 1;
    s.upgrades.biobank = 1;
    expect(adoptReward(s, cat)).toEqual({
      coins: Math.round(market * C.ADOPT_COIN_FRACTION),
      dna: Math.max(1, Math.round(dnaBase * C.ADOPT_DNA_FRACTION)),
    });
  });
});

describe('здоровье (сердца) и возраст', () => {
  it('isOld / breedsLeft по запасу сердец', () => {
    const s = createInitialState(makeRng(42), 0);
    const cat = s.cats[0]!;
    expect(heartsOf(cat)).toBe(C.MAX_HEARTS);
    expect(breedsLeft(cat)).toBe(C.MAX_HEARTS);
    expect(isOld(cat)).toBe(false);
    cat.breedCount = C.MAX_HEARTS;
    expect(breedsLeft(cat)).toBe(0);
    expect(isOld(cat)).toBe(true);
  });

  it('инбридинговый котёнок с урезанными сердцами стареет раньше; 0 — «Бесплодный»', () => {
    const s = createInitialState(makeRng(43), 0);
    const cat = s.cats[0]!;
    cat.maxHearts = 1; // дефект: одно сердце со старта
    expect(breedsLeft(cat)).toBe(1);
    expect(isSterile(cat)).toBe(false);
    cat.breedCount = 1;
    expect(isOld(cat)).toBe(true);

    const dud = s.cats[1]!;
    dud.maxHearts = 0; // родословный тупик
    expect(isSterile(dud)).toBe(true);
    expect(isOld(dud)).toBe(true);
    expect(breedsLeft(dud)).toBe(0);
  });
});

describe('дерево исследований (эффекты)', () => {
  it('инфраструктура расширяет вместимости и потолок офлайна', () => {
    const s = createInitialState(makeRng(30), 0);
    s.research = ['r_infra1', 'r_infra2', 'r_infra3'];
    expect(nurseryCapacity(s)).toBe(C.NURSERY_BASE_CAP + 4);
    expect(shelterCapacity(s)).toBe(C.SHELTER_BASE_CAP + 6);
    expect(offlineCapMin(s)).toBe(C.OFFLINE_CAP_BASE_MIN + 180);
  });

  it('доходные узлы дают множитель и бонус за коллекцию', () => {
    const s = createInitialState(makeRng(31), 0);
    s.champions = [s.cats[0]!.id]; // доход идёт от чемпиона
    const base = passiveRatePerMin(s);
    s.research = ['r_income1']; // +25% пассива
    expect(passiveRatePerMin(s)).toBeCloseTo(base * 1.25);
    s.research = ['r_income3']; // +0.5 💰/мин за каждую открытую породу
    s.discoveredBreeds = ['a', 'b', 'c', 'd'];
    expect(passiveRatePerMin(s)).toBeCloseTo(base + 4 * 0.5);
  });

  it('узлы пристройства увеличивают 💰 и 🧬', () => {
    const s = createInitialState(makeRng(32), 0);
    const cat = s.cats[0]!;
    const market = catMarketValue(cat);
    const dnaBase = C.TIER_VALUE[cat.rarityTier].dna;
    s.research = ['r_adopt1', 'r_adopt2', 'r_adopt3']; // +0.30 и +0.50 к 💰, +0.40 к 🧬
    expect(adoptReward(s, cat)).toEqual({
      coins: Math.round(market * C.ADOPT_COIN_FRACTION * (1 + 0.30 + 0.50)),
      dna: Math.max(1, Math.round(dnaBase * C.ADOPT_DNA_FRACTION * (1 + 0.40))),
    });
  });
});
