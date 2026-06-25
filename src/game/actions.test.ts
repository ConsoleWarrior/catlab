import { describe, it, expect } from 'vitest';
import { makeRng } from '../genetics/index.js';
import {
  createInitialState, startBreeding, assignBreeder, clearBreederSlot, isInSlot,
  collectReady, adoptCat, moveCat,
  buyUpgrade, unlockGene, collectIncome, incubationDuration,
  passiveRatePerMin, offlineCapMin, buyCat, buyCatCost, buyBoost, unlockResearch,
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

  it('вязка не зависит от места в питомнике', () => {
    const s = createInitialState(makeRng(8), 0);
    const { female, male } = pair(s);
    s.upgrades.nurseryCap = 0; // cap 6, добьём до предела фиктивными котами
    while (s.cats.filter((c) => c.location === 'nursery').length < 6) {
      const clone = { ...female, id: 'x' + s.nextId++ };
      s.cats.push(clone);
    }
    // даже при переполненном питомнике вязку можно запустить
    expect(startBreeding(s, 0, female.id, male.id, 0).ok).toBe(true);
  });

  it('assignBreeder: ставит по полу, меняет местами, не трогает активный слот', () => {
    const s = createInitialState(makeRng(15), 0);
    s.coins = 1000;
    buyUpgrade(s, 'slots'); // нужен второй слот
    const { female, male } = pair(s);
    const female2 = { ...female, id: 'f2' + s.nextId++ };
    s.cats.push(female2);

    expect(assignBreeder(s, 0, female.id, 0).ok).toBe(true);
    expect(s.slots[0]!.motherId).toBe(female.id);
    expect(assignBreeder(s, 0, male.id, 0).ok).toBe(true);
    expect(s.slots[0]!.fatherId).toBe(male.id);

    // другая самка в ту же роль вытесняет первую (коты «меняются местами»)
    expect(assignBreeder(s, 0, female2.id, 0).ok).toBe(true);
    expect(s.slots[0]!.motherId).toBe(female2.id);

    // активный (идёт вязка) слот трогать нельзя
    startBreeding(s, 1, female.id, male.id, 0);
    expect(assignBreeder(s, 1, female2.id, 0).ok).toBe(false);
  });

  it('isInSlot / clearBreederSlot: кот в слоте и снятие (активную вязку не трогаем)', () => {
    const s = createInitialState(makeRng(17), 0);
    const { female, male } = pair(s);
    // поставили в слот (staged, readyAt === 0)
    expect(assignBreeder(s, 0, female.id, 0).ok).toBe(true);
    expect(isInSlot(s, female.id)).toBe(true);
    expect(isInSlot(s, male.id)).toBe(false);
    // сняли со слота
    expect(clearBreederSlot(s, female.id)).toBe(true);
    expect(isInSlot(s, female.id)).toBe(false);
    expect(clearBreederSlot(s, female.id)).toBe(false); // уже снят
    // активную вязку clearBreederSlot не разрывает
    expect(startBreeding(s, 0, female.id, male.id, 0).ok).toBe(true);
    expect(isInSlot(s, female.id)).toBe(true);
    expect(clearBreederSlot(s, female.id)).toBe(false);
    expect(isInSlot(s, female.id)).toBe(true);
  });

  it('невзрослого котёнка нельзя ни поставить в слот, ни свести', () => {
    const s = createInitialState(makeRng(16), 0);
    const { female, male } = pair(s);
    const now = 1000;
    female.bornAt = now;       // только что родилась — ещё котёнок
    expect(assignBreeder(s, 0, female.id, now).ok).toBe(false);
    expect(startBreeding(s, 0, female.id, male.id, now).ok).toBe(false);
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

describe('генная инженерия', () => {
  it('buyBoost заряжает усилитель за ДНК', () => {
    const s = createInitialState(makeRng(40), 0);
    expect(buyBoost(s, 'tierUp').ok).toBe(false); // 0 ДНК
    expect(buyBoost(s, 'bogus').ok).toBe(false);  // нет такого усилителя
    s.dna = 100;
    expect(buyBoost(s, 'tierUp').ok).toBe(true);
    expect(s.boosts.tierUp).toBe(1);
    expect(s.dna).toBe(40); // 60 🧬 списано
  });

  it('🔼 Форсаж в инкубаторе поднимает тир котёнка и тратит заряд', () => {
    const rng = makeRng(41);
    const s = createInitialState(rng, 0);
    const { female, male } = pair(s); // дворовые (common)
    s.dna = 100;
    buyBoost(s, 'tierUp');
    startBreeding(s, 0, female.id, male.id, 0);
    const ev = collectReady(s, incubationDuration(s), rng);
    expect(ev[0]!.kitten!.rarityTier).not.toBe('common'); // поднялся минимум на 1 тир
    expect(s.boosts.tierUp).toBe(0); // заряд списан
  });

  it('заряд Форсажа не тратится впустую на легендарной паре', () => {
    const rng = makeRng(42);
    const s = createInitialState(rng, 0);
    const { female, male } = pair(s);
    female.breed = 'bengal'; female.rarityTier = 'legendary';
    male.breed = 'bengal'; male.rarityTier = 'legendary';
    s.dna = 100;
    buyBoost(s, 'tierUp');
    startBreeding(s, 0, female.id, male.id, 0);
    const ev = collectReady(s, incubationDuration(s), rng);
    expect(ev[0]!.kitten).toBeDefined();
    expect(s.boosts.tierUp).toBe(1); // не сработал → заряд сохранён
  });
});

describe('дерево исследований', () => {
  it('unlockResearch: пререквизиты, стоимость, повтор и неизвестный узел', () => {
    const s = createInitialState(makeRng(50), 0);
    expect(unlockResearch(s, 'r_income2').ok).toBe(false); // нужен r_income1
    expect(unlockResearch(s, 'r_income1').ok).toBe(false); // 0 ДНК
    s.dna = 1000;
    expect(unlockResearch(s, 'r_income1').ok).toBe(true);
    expect(s.research).toContain('r_income1');
    expect(unlockResearch(s, 'r_income1').ok).toBe(false); // уже изучено
    expect(unlockResearch(s, 'r_income2').ok).toBe(true);  // пререквизит теперь есть
    expect(s.dna).toBe(1000 - 30 - 70);                    // списаны обе стоимости
    expect(unlockResearch(s, 'bogus').ok).toBe(false);
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
