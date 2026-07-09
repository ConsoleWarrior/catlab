import { describe, it, expect } from 'vitest';
import { makeRng, makeCat } from '../genetics/index.js';
import {
  createInitialState, deserialize, serialize,
  levelForReputation, nextLevelRep, addReputation,
  isUnlocked, unlockLevelOf, maxSlotsForLevel, maxChampionsForLevel,
  nextSlotUnlockLevel, nextPedestalUnlockLevel,
  buyUpgrade, sendToLab, buyBoost, unlockResearch, adoptCat,
  startBreeding, collectReady, incubationDuration, makeCatInstance,
} from './index.js';
import {
  LEVEL_REP_THRESHOLDS, MAX_LEVEL, REP_BIRTH_BY_TIER, REP_NEW_BREED_MULT,
} from './config.js';
import type { GameState } from './index.js';

function pair(s: GameState) {
  const female = s.cats.find((c) => c.genotype.sex === 'female')!;
  const male = s.cats.find((c) => c.genotype.sex === 'male')!;
  return { female, male };
}

describe('уровень лаборатории по опыту', () => {
  it('пороги таблицы дают ровно 10 уровней', () => {
    expect(levelForReputation(0)).toBe(1);
    expect(levelForReputation(99)).toBe(1);
    expect(levelForReputation(100)).toBe(2);
    expect(levelForReputation(249)).toBe(2);
    expect(levelForReputation(250)).toBe(3);
    expect(levelForReputation(3200)).toBe(MAX_LEVEL);
    expect(levelForReputation(999_999)).toBe(MAX_LEVEL); // не превышает максимум
    expect(levelForReputation(-50)).toBe(1);             // отрицательный опыт → ур.1
  });

  it('каждый порог таблицы переключает уровень', () => {
    LEVEL_REP_THRESHOLDS.forEach((rep, i) => {
      expect(levelForReputation(rep)).toBe(i + 1);
    });
  });

  it('nextLevelRep — следующий порог, на максимуме null', () => {
    expect(nextLevelRep(1)).toBe(100);
    expect(nextLevelRep(2)).toBe(250);
    expect(nextLevelRep(MAX_LEVEL)).toBeNull();
  });

  it('addReputation копит опыт, поднимает уровень и сообщает о повышении', () => {
    const s = createInitialState(makeRng(1), 0);
    expect(s.level).toBe(1);
    const r1 = addReputation(s, 60);
    expect(r1.gained).toBe(60);
    expect(r1.leveledUp).toBe(false);
    expect(s.level).toBe(1);
    const r2 = addReputation(s, 50); // всего 110 → ур.2
    expect(r2.leveledUp).toBe(true);
    expect(s.level).toBe(2);
    expect(addReputation(s, -100).gained).toBe(0); // отрицательное не отнимает
  });
});

describe('гейты уровня: что открыто когда', () => {
  it('isUnlocked / unlockLevelOf по таблице LAB_UNLOCKS', () => {
    const s = createInitialState(makeRng(2), 0);
    expect(unlockLevelOf('food')).toBe(1);        // коты едят сразу
    expect(unlockLevelOf('labStation')).toBe(2);
    expect(unlockLevelOf('research')).toBe(2);    // дерево видно рано
    expect(unlockLevelOf('engineering')).toBe(5);
    expect(isUnlocked(s, 'food')).toBe(true);        // ур.1 — кормушка уже работает
    expect(isUnlocked(s, 'labStation')).toBe(false); // ур.1
    expect(isUnlocked(s, 'research')).toBe(false);   // ур.1
    s.level = 2;
    expect(isUnlocked(s, 'labStation')).toBe(true);
    expect(isUnlocked(s, 'research')).toBe(true);
    s.level = 5;
    expect(isUnlocked(s, 'engineering')).toBe(true);
    expect(isUnlocked(s, 'clinic')).toBe(true);
  });

  it('maxSlotsForLevel растёт по SLOT_UNLOCK_LEVELS [3,6]', () => {
    const s = createInitialState(makeRng(3), 0);
    s.level = 1; expect(maxSlotsForLevel(s)).toBe(1);
    s.level = 2; expect(maxSlotsForLevel(s)).toBe(1);
    s.level = 3; expect(maxSlotsForLevel(s)).toBe(2);
    s.level = 6; expect(maxSlotsForLevel(s)).toBe(3);
    s.level = 10; expect(maxSlotsForLevel(s)).toBe(3); // максимум 3 слота
    expect(nextSlotUnlockLevel({ ...s, level: 1 } as GameState)).toBe(3);
    expect(nextSlotUnlockLevel({ ...s, level: 3 } as GameState)).toBe(6);
    expect(nextSlotUnlockLevel({ ...s, level: 6 } as GameState)).toBeNull();
  });

  it('maxChampionsForLevel растёт по PEDESTAL_UNLOCK_LEVELS [2,4,6,9] до 5', () => {
    const s = createInitialState(makeRng(4), 0);
    s.level = 1; expect(maxChampionsForLevel(s)).toBe(1);
    s.level = 2; expect(maxChampionsForLevel(s)).toBe(2);
    s.level = 4; expect(maxChampionsForLevel(s)).toBe(3);
    s.level = 6; expect(maxChampionsForLevel(s)).toBe(4);
    s.level = 9; expect(maxChampionsForLevel(s)).toBe(5);
    s.level = 10; expect(maxChampionsForLevel(s)).toBe(5); // максимум 5 пьедесталов
    expect(nextPedestalUnlockLevel({ ...s, level: 1 } as GameState)).toBe(2);
    expect(nextPedestalUnlockLevel({ ...s, level: 9 } as GameState)).toBeNull();
  });
});

describe('гейты уровня блокируют действия', () => {
  it('покупка 2-го слота вязки заперта до ур.3', () => {
    const s = createInitialState(makeRng(5), 0);
    s.coins = 100_000;
    expect(buyUpgrade(s, 'slots').ok).toBe(false); // ур.1 — заперто
    expect(buyUpgrade(s, 'slots')).toMatchObject({ ok: false, reason: 'locked' });
    s.level = 3;
    expect(buyUpgrade(s, 'slots').ok).toBe(true);
    expect(s.slots).toHaveLength(2);
    // 3-й слот заперт до ур.6
    expect(buyUpgrade(s, 'slots')).toMatchObject({ ok: false, reason: 'locked' });
    s.level = 6;
    expect(buyUpgrade(s, 'slots').ok).toBe(true);
    expect(s.slots).toHaveLength(3);
  });

  it('покупка 2-го пьедестала заперта до ур.2', () => {
    const s = createInitialState(makeRng(6), 0);
    s.coins = 1_000_000;
    expect(buyUpgrade(s, 'championSlots')).toMatchObject({ ok: false, reason: 'locked' });
    s.level = 2;
    expect(buyUpgrade(s, 'championSlots').ok).toBe(true);
  });

  it('sendToLab / buyBoost / unlockResearch заперты до своих уровней', () => {
    const s = createInitialState(makeRng(7), 0);
    s.dna = 10_000;
    const cat = makeCatInstance(s, makeCat('female'), 0, 'nursery', 'persian');
    s.cats.push(cat);
    expect(sendToLab(s, cat.id)).toMatchObject({ ok: false, reason: 'locked' }); // ур.1
    expect(buyBoost(s, 'tierUp')).toMatchObject({ ok: false, reason: 'locked' });
    expect(unlockResearch(s, 'r_income1')).toMatchObject({ ok: false, reason: 'locked' });
    s.level = 5; // labStation(2)+research(2)+engineering(5) открыты
    expect(buyBoost(s, 'tierUp').ok).toBe(true);
    expect(unlockResearch(s, 'r_income1').ok).toBe(true);
    expect(sendToLab(s, cat.id).ok).toBe(true);
  });

  it('верхний узел ветки (col≥2) заперт до researchAdvanced (ур.7)', () => {
    const s = createInitialState(makeRng(8), 0);
    s.dna = 10_000;
    s.level = 4; // research открыт, researchAdvanced (7) — нет
    expect(unlockResearch(s, 'r_income1').ok).toBe(true);
    expect(unlockResearch(s, 'r_income2').ok).toBe(true);
    expect(unlockResearch(s, 'r_income3')).toMatchObject({ ok: false, reason: 'locked' });
    s.level = 7;
    expect(unlockResearch(s, 'r_income3').ok).toBe(true);
  });
});

describe('опыт за важные действия', () => {
  it('рождение котёнка даёт опыт по тиру; первая порода — с бонусом', () => {
    const rng = makeRng(30);
    const s = createInitialState(rng, 0);
    const { female, male } = pair(s);
    const repBefore = s.reputation;
    startBreeding(s, 0, female.id, male.id, 0);
    const ev = collectReady(s, incubationDuration(s), rng)[0]!;
    expect(ev.kitten).toBeDefined();
    const tier = ev.kitten!.rarityTier;
    const expected = REP_BIRTH_BY_TIER[tier] * (ev.newBreed ? REP_NEW_BREED_MULT : 1);
    expect(ev.rep).toBe(Math.round(expected));
    expect(s.reputation).toBe(repBefore + Math.round(expected));
  });

  it('пристройство и лаборатория начисляют опыт ∝ ценности', () => {
    const s = createInitialState(makeRng(31), 0);
    // уровень выводится из опыта: поднимаем через reputation, иначе addReputation
    // внутри adoptCat пересчитает level обратно из низкого опыта (и запрёт sendToLab).
    s.reputation = 5000; s.level = 10;
    const a = makeCatInstance(s, makeCat('female'), 0, 'nursery', 'persian');
    const b = makeCatInstance(s, makeCat('male'), 0, 'nursery', 'persian');
    s.cats.push(a, b);
    const ra = adoptCat(s, a.id);
    expect(ra.ok && ra.rep > 0).toBe(true);
    const rl = sendToLab(s, b.id);
    expect(rl.ok && rl.rep > 0).toBe(true);
  });
});

describe('миграция сейва: уровень пересчитывается из опыта', () => {
  it('сейв со старым линейным уровнем приводится к таблице порогов', () => {
    const s = createInitialState(makeRng(40), 0);
    s.reputation = 300;   // по таблице → ур.3
    s.level = 4;          // «неправильный» уровень из старой линейной формулы
    const restored = deserialize(serialize(s));
    expect(restored.level).toBe(levelForReputation(300));
    expect(restored.level).toBe(3);
  });
});
