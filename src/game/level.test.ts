import { describe, it, expect } from 'vitest';
import { makeRng, makeCat } from '../genetics/index.js';
import {
  createInitialState, deserialize, serialize,
  levelForReputation, nextLevelRep, addReputation, levelCrystalReward,
  isUnlocked, unlockLevelOf, maxSlotsForLevel, maxChampionsForLevel,
  nextSlotUnlockLevel, nextPedestalUnlockLevel,
  buyUpgrade, sendToLab, buyBoost, unlockResearch, adoptCat,
  startBreeding, collectReady, incubationDuration, makeCatInstance, catMarketValue,
} from './index.js';
import {
  LEVEL_REP_THRESHOLDS, MAX_LEVEL, TIER_MARKET_VALUE, REP_BIRTH_RATE, REP_NEW_BREED_MULT,
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
    expect(levelForReputation(359)).toBe(1);
    expect(levelForReputation(360)).toBe(2);
    expect(levelForReputation(999)).toBe(2);
    expect(levelForReputation(1000)).toBe(3);
    expect(levelForReputation(20000)).toBe(MAX_LEVEL);
    expect(levelForReputation(999_999)).toBe(MAX_LEVEL); // не превышает максимум
    expect(levelForReputation(-50)).toBe(1);             // отрицательный опыт → ур.1
  });

  it('каждый порог таблицы переключает уровень', () => {
    LEVEL_REP_THRESHOLDS.forEach((rep, i) => {
      expect(levelForReputation(rep)).toBe(i + 1);
    });
  });

  it('nextLevelRep — следующий порог, на максимуме null', () => {
    expect(nextLevelRep(1)).toBe(360);
    expect(nextLevelRep(2)).toBe(1000);
    expect(nextLevelRep(MAX_LEVEL)).toBeNull();
  });

  it('addReputation копит опыт, поднимает уровень и сообщает о повышении', () => {
    const s = createInitialState(makeRng(1), 0);
    expect(s.level).toBe(1);
    const r1 = addReputation(s, 300); // 300 < порог L2 (360)
    expect(r1.gained).toBe(300);
    expect(r1.leveledUp).toBe(false);
    expect(r1.crystalsGifted).toBe(0);
    expect(s.level).toBe(1);
    const r2 = addReputation(s, 300); // всего 600 → ур.2
    expect(r2.leveledUp).toBe(true);
    expect(s.level).toBe(2);
    expect(addReputation(s, -100).gained).toBe(0); // отрицательное не отнимает
  });

  it('повышение уровня дарит 💎: со 2-го уровня 6,9,…,30 (3×уровень)', () => {
    expect(levelCrystalReward(1)).toBe(0);      // старт — без подарка
    expect(levelCrystalReward(2)).toBe(6);
    expect(levelCrystalReward(10)).toBe(30);
    expect(levelCrystalReward(MAX_LEVEL + 1)).toBe(0);

    const s = createInitialState(makeRng(9), 0);
    const before = s.crystals;
    const r = addReputation(s, LEVEL_REP_THRESHOLDS[1]!); // ровно порог ур.2
    expect(s.level).toBe(2);
    expect(r.crystalsGifted).toBe(6);
    expect(s.crystals).toBe(before + 6);
  });

  it('прыжок через несколько уровней дарит сумму 💎 всех пройденных', () => {
    const s = createInitialState(makeRng(10), 0);
    const before = s.crystals;
    const r = addReputation(s, LEVEL_REP_THRESHOLDS[2]!); // сразу до ур.3 (пропустили ур.2)
    expect(s.level).toBe(3);
    expect(r.crystalsGifted).toBe(6 + 9); // подарки ур.2 и ур.3 суммируются
    expect(s.crystals).toBe(before + 15);
  });
});

describe('гейты уровня: что открыто когда', () => {
  it('isUnlocked / unlockLevelOf: фичи, гейтящиеся уровнем лаборатории', () => {
    const s = createInitialState(makeRng(2), 0);
    expect(unlockLevelOf('food')).toBe(1);        // коты едят сразу
    expect(unlockLevelOf('research')).toBe(1);    // дерево «Улучшений» открыто с 1-го уровня
    expect(unlockLevelOf('recipeLab')).toBe(2);   // стол «Исследований» — с ур.2
    expect(unlockLevelOf('engineering')).toBe(4); // усилители вязки — с ур.4
    expect(isUnlocked(s, 'food')).toBe(true);        // ур.1 — кормушка уже работает
    expect(isUnlocked(s, 'research')).toBe(true);    // ур.1 — «Улучшения» уже открыты
    expect(isUnlocked(s, 'recipeLab')).toBe(false);  // ур.1 — стол «Исследований» ещё заперт
    s.level = 2;
    expect(isUnlocked(s, 'recipeLab')).toBe(true);
    expect(isUnlocked(s, 'engineering')).toBe(false); // ещё ур.2
    s.level = 4;
    expect(isUnlocked(s, 'engineering')).toBe(true);
  });

  it('labStation/clinic открываются ПОКУПКОЙ узла «Лаборатории», а не уровнем', () => {
    const s = createInitialState(makeRng(2), 0);
    s.level = 10;                                  // даже на максимуме — заперто без узла
    expect(isUnlocked(s, 'labStation')).toBe(false);
    expect(isUnlocked(s, 'clinic')).toBe(false);
    s.research.r_lab_station = 1;                   // куплен узел «На эксперименты»
    expect(isUnlocked(s, 'labStation')).toBe(true);
    s.research.r_lab_vet = 1;                       // куплен узел «Ветеринар»
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

  it('sendToLab / buyBoost / unlockResearch заперты до своих условий', () => {
    const s = createInitialState(makeRng(7), 0);
    s.dna = 10_000; s.coins = 10_000; // Селекция стоит и 🧬, и 💰
    const cat = makeCatInstance(s, makeCat('female'), 0, 'nursery', 'persian');
    s.cats.push(cat);
    expect(sendToLab(s, cat.id)).toMatchObject({ ok: false, reason: 'locked' }); // узел станции не куплен
    expect(buyBoost(s, 'tierUp')).toMatchObject({ ok: false, reason: 'locked' });
    // r_sel_markers — корень ветки Селекции (без пререквизитов), заперт деревом до ур.2
    expect(unlockResearch(s, 'r_sel_markers')).toMatchObject({ ok: false, reason: 'locked' });
    s.level = 5; // research(2)+engineering(4) открыты
    expect(buyBoost(s, 'tierUp').ok).toBe(true);
    expect(unlockResearch(s, 'r_sel_markers').ok).toBe(true);
    // станция «на эксперименты» открывается ПОКУПКОЙ узла, а не уровнем
    expect(sendToLab(s, cat.id)).toMatchObject({ ok: false, reason: 'locked' });
    expect(unlockResearch(s, 'r_lab_station').ok).toBe(true);
    expect(sendToLab(s, cat.id).ok).toBe(true);
  });

  it('уровни узла гейтятся своим minLevel (прокачка растянута по уровням)', () => {
    const s = createInitialState(makeRng(8), 0);
    s.dna = 10_000; s.coins = 10_000;
    // research открыт с ур.1; у «Генетических маркеров» (корень) ур.1 — minLevel 2, ур.2 — minLevel 5.
    s.level = 2;
    expect(unlockResearch(s, 'r_sel_markers').ok).toBe(true);            // ур.1 узла доступен
    expect(unlockResearch(s, 'r_sel_markers')).toMatchObject({ ok: false, reason: 'locked' }); // ур.2 заперт
    s.level = 5;
    expect(unlockResearch(s, 'r_sel_markers').ok).toBe(true);            // ур.2 открылся
  });
});

describe('опыт за важные действия', () => {
  it('рождение котёнка даёт опыт от его рыночной ценности; первая порода — с бонусом', () => {
    const rng = makeRng(30);
    const s = createInitialState(rng, 0);
    const { female, male } = pair(s);
    const repBefore = s.reputation;
    startBreeding(s, 0, female.id, male.id, 0);
    const ev = collectReady(s, incubationDuration(s), rng)[0]!;
    expect(ev.kitten).toBeDefined();
    // база опыта — та же catMarketValue, что у пристройства/лаборатории (тир × порода
    // × родословная × здоровье), а не голый TIER_MARKET_VALUE тира.
    const expected = Math.round(catMarketValue(ev.kitten!) * REP_BIRTH_RATE)
      * (ev.newBreed ? REP_NEW_BREED_MULT : 1);
    expect(ev.rep).toBe(expected);
    expect(s.reputation).toBe(repBefore + expected);
    // ценность котёнка ≥ базы тира (родословная от родителей), значит и опыт ≥ старой формулы
    expect(ev.rep).toBeGreaterThanOrEqual(
      Math.round(TIER_MARKET_VALUE[ev.kitten!.rarityTier] * REP_BIRTH_RATE) * (ev.newBreed ? REP_NEW_BREED_MULT : 1),
    );
  });

  it('пристройство и лаборатория начисляют опыт ∝ ценности', () => {
    const s = createInitialState(makeRng(31), 0);
    // уровень выводится из опыта: поднимаем через reputation, иначе addReputation
    // внутри adoptCat пересчитает level обратно из низкого опыта (и запрёт sendToLab).
    s.reputation = 5000; s.level = 10;
    s.research.r_lab_station = 1; // станция «на эксперименты» открывается покупкой узла
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
    s.reputation = 1200;  // по таблице → ур.3
    s.level = 6;          // «неправильный» уровень из старой линейной формулы
    const restored = deserialize(serialize(s));
    expect(restored.level).toBe(levelForReputation(1200));
    expect(restored.level).toBe(3);
  });
});
