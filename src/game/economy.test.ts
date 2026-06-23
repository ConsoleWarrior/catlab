import { describe, it, expect } from 'vitest';
import { makeRng } from '../genetics/index.js';
import {
  createInitialState, nurseryCapacity, shelterCapacity, incubationDuration,
  mutationRate, offlineCapMin, upgradeCost, upgradeMaxed, passiveRatePerMin,
  adoptReward,
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

  it('скорость инкубации уменьшается и упирается в минимум', () => {
    const s = createInitialState(makeRng(3), 0);
    expect(incubationDuration(s)).toBe(C.INCUBATION_BASE_MS);
    s.upgrades.speed = 2;
    expect(incubationDuration(s)).toBe(C.INCUBATION_BASE_MS - 2 * C.SPEED_STEP_MS);
    s.upgrades.speed = 999;
    expect(incubationDuration(s)).toBe(C.INCUBATION_MIN_MS);
  });

  it('мутация растёт и упирается в потолок', () => {
    const s = createInitialState(makeRng(4), 0);
    expect(mutationRate(s)).toBeCloseTo(C.MUTATION_BASE);
    s.upgrades.mutation = 3;
    expect(mutationRate(s)).toBeCloseTo(C.MUTATION_BASE + 3 * C.MUTATION_STEP);
    s.upgrades.mutation = 999;
    expect(mutationRate(s)).toBeCloseTo(C.MUTATION_MAX);
  });

  it('потолок офлайн-дохода растёт', () => {
    const s = createInitialState(makeRng(5), 0);
    expect(offlineCapMin(s)).toBe(C.OFFLINE_CAP_BASE_MIN);
    s.upgrades.offline = 1;
    expect(offlineCapMin(s)).toBe(C.OFFLINE_CAP_BASE_MIN + C.OFFLINE_CAP_STEP_MIN);
  });
});

describe('стоимость апгрейдов', () => {
  it('слоты дорожают по кривой', () => {
    const s = createInitialState(makeRng(6), 0);
    expect(upgradeCost(s, 'slots')).toEqual({ currency: 'coins', amount: 500 });
    s.slots.push({ motherId: null, fatherId: null, startedAt: 0, readyAt: 0 });
    expect(upgradeCost(s, 'slots')).toEqual({ currency: 'coins', amount: 2000 });
  });

  it('обычный апгрейд дорожает по mult', () => {
    const s = createInitialState(makeRng(7), 0);
    expect(upgradeCost(s, 'speed')).toEqual({ currency: 'coins', amount: 150 });
    s.upgrades.speed = 1;
    expect(upgradeCost(s, 'speed')).toEqual({ currency: 'coins', amount: Math.round(150 * 1.8) });
  });

  it('upgradeMaxed по достижении максимума', () => {
    const s = createInitialState(makeRng(8), 0);
    expect(upgradeMaxed(s, 'slots')).toBe(false);
    while (s.slots.length - 1 < C.UPGRADES.slots!.max) {
      s.slots.push({ motherId: null, fatherId: null, startedAt: 0, readyAt: 0 });
    }
    expect(upgradeMaxed(s, 'slots')).toBe(true);
    expect(upgradeMaxed(s, 'нет-такого')).toBe(true);
  });
});

describe('доход и пристройство', () => {
  it('пассивный доход = сумма по тирам питомника', () => {
    const s = createInitialState(makeRng(9), 0);
    const expected = s.cats
      .filter((c) => c.location === 'nursery')
      .reduce((a, c) => a + C.TIER_VALUE[c.rarityTier].incomePerMin, 0);
    expect(passiveRatePerMin(s)).toBe(expected);
  });

  it('награда за пристройство учитывает связи и биобанк', () => {
    const s = createInitialState(makeRng(10), 0);
    const cat = s.cats[0]!;
    const v = C.TIER_VALUE[cat.rarityTier];
    expect(adoptReward(s, cat)).toEqual({ coins: v.adopt, dna: v.dna });
    s.upgrades.connections = 1;
    s.upgrades.biobank = 1;
    expect(adoptReward(s, cat)).toEqual({
      coins: Math.round(v.adopt * (1 + C.CONNECTIONS_STEP)),
      dna: Math.round(v.dna * (1 + C.BIOBANK_STEP)),
    });
  });
});
