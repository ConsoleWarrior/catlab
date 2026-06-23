import { describe, it, expect } from 'vitest';
import { makeRng } from '../genetics/index.js';
import {
  createInitialState, startBreeding, collectReady, adoptCat, moveCat,
  buyUpgrade, unlockGene, collectIncome, incubationDuration,
  passiveRatePerMin, offlineCapMin, buyCat, buyCatCost,
} from './index.js';
import { STARTER_CAT_COST } from './config.js';
import type { GameState } from './index.js';

function pair(s: GameState) {
  const female = s.cats.find((c) => c.genotype.sex === 'female')!;
  const male = s.cats.find((c) => c.genotype.sex === 'male')!;
  return { female, male };
}

describe('инкубатор', () => {
  it('вязка → ожидание → котёнок появляется', () => {
    const rng = makeRng(5);
    const s = createInitialState(rng, 0);
    const { female, male } = pair(s);
    const r = startBreeding(s, 0, female.id, male.id, 0);
    expect(r.ok).toBe(true);
    const dur = incubationDuration(s);
    expect(s.slots[0]!.readyAt).toBe(dur);
    // рано — никого
    expect(collectReady(s, dur - 1, rng)).toHaveLength(0);
    // вовремя — котёнок
    const ev = collectReady(s, dur, rng);
    expect(ev).toHaveLength(1);
    expect(ev[0]!.kitten).toBeDefined();
    expect(s.cats).toHaveLength(3);
    expect(s.slots[0]!.readyAt).toBe(0); // слот освобождён
  });

  it('валидации: тот же кот / неверный пол', () => {
    const s = createInitialState(makeRng(6), 0);
    const { female, male } = pair(s);
    expect(startBreeding(s, 0, female.id, female.id, 0).ok).toBe(false);
    expect(startBreeding(s, 0, male.id, female.id, 0).ok).toBe(false); // мама-самец
  });

  it('занятый кот не идёт во вторую вязку', () => {
    const s = createInitialState(makeRng(7), 0);
    s.coins = 1000;
    expect(buyUpgrade(s, 'slots').ok).toBe(true);
    const { female, male } = pair(s);
    expect(startBreeding(s, 0, female.id, male.id, 0).ok).toBe(true);
    expect(startBreeding(s, 1, female.id, male.id, 0).ok).toBe(false);
  });

  it('нет места в питомнике — вязка блокируется', () => {
    const s = createInitialState(makeRng(8), 0);
    const { female, male } = pair(s);
    s.upgrades.nurseryCap = 0; // cap 6, добьём до предела фиктивными котами
    while (s.cats.filter((c) => c.location === 'nursery').length < 6) {
      const clone = { ...female, id: 'x' + s.nextId++ };
      s.cats.push(clone);
    }
    expect(startBreeding(s, 0, female.id, male.id, 0).ok).toBe(false);
  });
});

describe('комнаты', () => {
  it('пристройство даёт монеты и ДНК, кот уходит', () => {
    const s = createInitialState(makeRng(3), 0);
    const cat = s.cats[0]!;
    const before = s.coins;
    const r = adoptCat(s, cat.id);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.coins).toBeGreaterThan(0);
      expect(s.coins).toBe(before + r.coins);
      expect(s.dna).toBe(r.dna);
    }
    expect(s.cats.find((c) => c.id === cat.id)).toBeUndefined();
  });

  it('занятого кота нельзя пристроить', () => {
    const s = createInitialState(makeRng(11), 0);
    const { female, male } = pair(s);
    startBreeding(s, 0, female.id, male.id, 0);
    expect(adoptCat(s, female.id).ok).toBe(false);
  });

  it('перемещение между комнатами с учётом вместимости', () => {
    const s = createInitialState(makeRng(12), 0);
    const cat = s.cats[0]!;
    expect(moveCat(s, cat.id, 'shelter').ok).toBe(true);
    expect(cat.location).toBe('shelter');
  });
});

describe('покупка кота (анти-софт-лок)', () => {
  it('первый кот бесплатно, если котов нет; затем платно', () => {
    const rng = makeRng(20);
    const s = createInitialState(rng, 0);
    s.cats = []; // продал всех — тупик
    expect(buyCatCost(s)).toBe(0);
    s.coins = 0;
    const r1 = buyCat(s, rng, 0);
    expect(r1.ok).toBe(true);
    expect(s.cats).toHaveLength(1);
    expect(s.cats[0]!.location).toBe('nursery');
    // следующий уже стоит денег
    expect(buyCatCost(s)).toBe(STARTER_CAT_COST);
    expect(buyCat(s, rng, 0).ok).toBe(false); // 0 монет
    s.coins = STARTER_CAT_COST;
    expect(buyCat(s, rng, 0).ok).toBe(true);
    expect(s.coins).toBe(0);
  });

  it('купленный кот — простой (без редких генов)', () => {
    const rng = makeRng(21);
    const s = createInitialState(rng, 0);
    s.cats = [];
    const r = buyCat(s, rng, 0);
    expect(r.ok).toBe(true);
    if (r.ok) {
      const g = r.cat.genotype;
      expect(g.W).toEqual(['w', 'w']);
      expect(g.Ea).toEqual(['normal', 'normal']);
      expect(g.L).toEqual(['L', 'L']);
      expect(g.D).toEqual(['D', 'D']);
    }
  });
});

describe('прокачка и генолаб', () => {
  it('апгрейд слотов: списывает монеты и добавляет слот', () => {
    const s = createInitialState(makeRng(13), 0);
    expect(buyUpgrade(s, 'slots').ok).toBe(false); // 100 < 500
    s.coins = 500;
    expect(buyUpgrade(s, 'slots').ok).toBe(true);
    expect(s.slots).toHaveLength(2);
    expect(s.coins).toBe(0);
  });

  it('открытие гена тратит ДНК', () => {
    const s = createInitialState(makeRng(14), 0);
    expect(unlockGene(s, 'dilute').ok).toBe(false); // 0 ДНК
    s.dna = 50;
    expect(unlockGene(s, 'dilute').ok).toBe(true);
    expect(s.unlockedGenes).toContain('dilute');
    expect(s.dna).toBe(0);
    expect(unlockGene(s, 'dilute').ok).toBe(false); // уже открыт
  });
});

describe('пассивный доход', () => {
  it('начисляется со временем и упирается в потолок офлайна', () => {
    const s = createInitialState(makeRng(9), 0);
    const rate = passiveRatePerMin(s);
    s.lastSeenAt = 0;
    const r1 = collectIncome(s, 60_000); // 1 минута
    expect(r1.coins).toBe(Math.floor(rate * 1));
    expect(s.lastSeenAt).toBe(60_000);

    s.lastSeenAt = 0;
    const cap = offlineCapMin(s);
    const r2 = collectIncome(s, cap * 60_000 * 5); // далеко за потолком
    expect(r2.coins).toBe(Math.floor(rate * cap));
  });
});
