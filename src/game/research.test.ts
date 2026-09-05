import { describe, it, expect } from 'vitest';
import { makeRng, makeCat, RECIPES, recipeChance, tierOfBreed } from '../genetics/index.js';
import {
  createInitialState, makeCatInstance,
  breedChanceMult, kinshipSafety, extraHearts, applyExtraHearts, rollKittenHearts,
  feedEfficiency, foodRatePerMin, autoFeedEnabled, collectIncome, claimOrder,
  researchBonus, offlineCapMin, upgradeCost, upgradeMaxed,
  passiveRatePerMin, setChampion,
  hiddenRaritySteps, hiddenTierWeights, buyCat, buyCatCost,
} from './index.js';
import * as C from './config.js';
import type { GameState, Ancestor } from './index.js';

function addCat(s: GameState, breed: string, sex: 'female' | 'male' = 'female') {
  const c = makeCatInstance(s, makeCat(sex), 0, 'nursery', breed);
  s.cats.push(c);
  return c;
}

describe('C0: чистка легаси-апгрейдов', () => {
  it('легаси-ключи в state.upgrades не влияют на формулы и не покупаются', () => {
    const s = createInitialState(makeRng(1), 0);
    s.upgrades.show = 5; s.upgrades.speed = 3; s.upgrades.offline = 2;
    s.upgrades.connections = 4; s.upgrades.biobank = 2; s.upgrades.mutation = 9;
    expect(offlineCapMin(s)).toBe(C.OFFLINE_CAP_BASE_MIN);
    expect(upgradeCost(s, 'show')).toBeNull();       // удалённого апгрейда нет
    expect(upgradeMaxed(s, 'show')).toBe(true);
  });

  it('в UPGRADES остались только 2 живых апгрейда (вместимости ушли в дерево)', () => {
    for (const id of ['slots', 'championSlots']) {
      expect(C.UPGRADES[id]).toBeTruthy();
    }
    expect(C.UPGRADES.nurseryCap).toBeUndefined();
    expect(C.UPGRADES.shelterCap).toBeUndefined();
    expect(Object.keys(C.UPGRADES)).toHaveLength(2);
  });
});

describe('C: селекция — шанс рецептов', () => {
  it('breedChanceMult = 1 + сумма купленных уровней recipeChance', () => {
    const s = createInitialState(makeRng(1), 0);
    expect(breedChanceMult(s)).toBe(1);
    s.research = { r_sel_pairs: 1 };       // +5%
    expect(breedChanceMult(s)).toBeCloseTo(1.05);
    s.research = { r_sel_pairs: 3 };       // 3×5% = +15%
    expect(breedChanceMult(s)).toBeCloseTo(1.15);
  });

  it('recipeChance ×chanceMult, кап 0.95 (усилители сюда не входят)', () => {
    const r = RECIPES.find((x) => x.result === 'domestic_shorthair')!; // 0.55, не родословный
    expect(recipeChance(r, 'none', 1)).toBeCloseTo(0.55);
    expect(recipeChance(r, 'none', 1.15)).toBeCloseTo(0.6325);
    const big = RECIPES.find((x) => x.result === 'exotic_shorthair')!; // 0.90
    expect(recipeChance(big, 'none', 1.15)).toBeCloseTo(0.95);   // упёрлись в кап
    const ped = RECIPES.find((x) => x.result === 'caracat')!; // minKinship critical, база 0.08
    expect(recipeChance(ped, 'critical', 1)).toBeCloseTo(0.08 * 2.5); // инбридинг ×2.5 = 0.20
  });
});

describe('C: селекция — инбридинг и здоровье', () => {
  it('kinshipSafety = сумма купленных уровней (потолок 0.5)', () => {
    const s = createInitialState(makeRng(1), 0);
    expect(kinshipSafety(s)).toBe(0);
    s.research = { r_sel_markers: 1 };     // −25%
    expect(kinshipSafety(s)).toBeCloseTo(0.25);
    s.research = { r_sel_markers: 2 };     // −25% −25% = −50% (потолок)
    expect(kinshipSafety(s)).toBeCloseTo(0.50);
  });

  it('rollKittenHearts: safety выталкивает бросок к полному здоровью', () => {
    // critical: 10%→0, 50%→1. rng=0.4 без safety → 1 сердце; с safety 0.5 (pp 5%/25%) → MAX.
    expect(rollKittenHearts('critical', () => 0.4, 0)).toBe(1);
    expect(rollKittenHearts('critical', () => 0.4, 0.5)).toBe(C.MAX_HEARTS);
  });

  it('kinship none — всегда полный запас, safety не важен', () => {
    expect(rollKittenHearts('none', () => 0.001, 0)).toBe(C.MAX_HEARTS);
    expect(rollKittenHearts('none', () => 0.001, 0.5)).toBe(C.MAX_HEARTS);
  });

  it('extraHearts и applyExtraHearts: +1 живым, бесплодных не спасает', () => {
    const s = createInitialState(makeRng(1), 0);
    expect(extraHearts(s)).toBe(0);
    s.research = { r_sel_vitamins: 1 };
    expect(extraHearts(s)).toBe(1);
    expect(applyExtraHearts(C.MAX_HEARTS, 1)).toBe(C.MAX_HEARTS + 1);
    expect(applyExtraHearts(3, 1)).toBe(4);
    expect(applyExtraHearts(0, 1)).toBe(0); // бесплодный (0 ❤) остаётся тупиком
  });
});

describe('C: селекция — «Тщательный отбор» (скрытая родословная покупных котов)', () => {
  it('веса тиров предков сдвигаются по ступеням: 70/20/8/2/0 → 60/25/11/3/1 → 50/30/14/4/2', () => {
    const s = createInitialState(makeRng(1), 0);
    const w = (): number[] => {
      const t = hiddenTierWeights(s);
      return [t.common, t.uncommon, t.rare, t.epic, t.legendary].map((x) => Math.round(x * 100));
    };
    expect(hiddenRaritySteps(s)).toBe(0);
    expect(w()).toEqual([70, 20, 8, 2, 0]);
    s.research = { r_sel_select: 1 };
    expect(w()).toEqual([60, 25, 11, 3, 1]);
    s.research = { r_sel_select: 2 };
    expect(w()).toEqual([50, 30, 14, 4, 2]);
    // сумма весов остаётся 1 — раздача идёт ровно из T1
    for (const lvlN of [0, 1, 2]) {
      s.research = { r_sel_select: lvlN };
      const t = hiddenTierWeights(s);
      const sum = t.common + t.uncommon + t.rare + t.epic + t.legendary;
      expect(sum).toBeCloseTo(1);
    }
  });

  it('покупка кота дорожает на 25% за ступень (поверх цены уровня лаборатории)', () => {
    const s = createInitialState(makeRng(1), 0);
    const base = C.STARTER_CAT_COST + C.BUY_CAT_COST_PER_LEVEL * s.level; // ур.1 → 55
    const up = C.BUY_CAT_COST_PER_SELECT;
    expect(buyCatCost(s)).toBe(base);
    s.research = { r_sel_select: 1 };
    expect(buyCatCost(s)).toBe(Math.round(base * (1 + up)));
    s.research = { r_sel_select: 2 };
    expect(buyCatCost(s)).toBe(Math.round(base * (1 + 2 * up)));
    s.cats = [];                       // анти-софт-лок сильнее наценки: первый кот бесплатно
    expect(buyCatCost(s)).toBe(0);
  });

  it('у купленных котов реально растёт доля породистых предков', () => {
    const countPedigree = (steps: number): number => {
      const rng = makeRng(77);
      const s = createInitialState(rng, 0);
      s.level = 10; s.coins = 1_000_000;
      s.research = { r_sel_select: steps };
      let pedigreed = 0, total = 0;
      for (let i = 0; i < 60; i++) {
        s.cats = s.cats.slice(0, 2);   // держим приют свободным
        const r = buyCat(s, rng, 0);
        expect(r.ok).toBe(true);
        if (!r.ok) return 0;
        const walk = (a?: Ancestor): void => {
          if (!a) return;
          total++;
          if (tierOfBreed(a.breed) !== 'common') pedigreed++;
          walk(a.mother); walk(a.father);
        };
        walk(r.cat.pedigree!.mother); walk(r.cat.pedigree!.father);
      }
      return pedigreed / total;
    };
    const base = countPedigree(0);
    const maxed = countPedigree(2);
    expect(base).toBeGreaterThan(0.15);   // ожидание 0.30
    expect(base).toBeLessThan(0.45);
    expect(maxed).toBeGreaterThan(base);  // ожидание 0.50
  });
});

describe('C: пристройство — orderReward', () => {
  it('«Клиенты-заводчики» повышают всю награду заказа: 💰 гены и ⭐ опыт', () => {
    const s = createInitialState(makeRng(1), 0);
    const cat = s.cats[0]!;
    s.orders = [{
      id: 'o1', req: { minRarity: 'common' }, kind: 'target',
      reward: { coins: 100, crystals: 5, dna: 20, reputation: 10 },
      createdAt: 0, expiresAt: 6 * 60 * 60_000, adRefreshAt: 0,
    }];
    s.orderBasket = cat.id; // заказ закрывают котом из корзины
    s.research = { r_order_dna: 2 }; // 2×15% = +30% к награде (кроме 💎)
    const coinsBefore = s.coins, dnaBefore = s.dna, crBefore = s.crystals, repBefore = s.reputation;
    const r = claimOrder(s, 'o1', 0, makeRng(2));
    expect(r.ok).toBe(true);
    expect(s.coins - coinsBefore).toBe(Math.round(100 * 1.3)); // 130
    expect(s.dna - dnaBefore).toBe(Math.round(20 * 1.3));      // 26
    expect(s.reputation - repBefore).toBe(Math.round(10 * 1.3)); // 13 ⭐
    expect(s.crystals - crBefore).toBe(5);                     // 💎 не множатся
    if (r.ok) { expect(r.reward.coins).toBe(130); expect(r.reward.dna).toBe(26); }
  });
});

describe('C: хозяйство — корм', () => {
  it('feedEff снижает расход корма', () => {
    const s = createInitialState(makeRng(1), 0);
    s.level = 3; s.cats = [];
    for (let i = 0; i < 10; i++) addCat(s, 'moggie'); // 10 × 0.1 → 1.0/мин
    expect(foodRatePerMin(s)).toBeCloseTo(1.0);
    expect(feedEfficiency(s)).toBe(0);
    s.research = { r_feed: 2 };             // 2×15% = −30%
    expect(feedEfficiency(s)).toBeCloseTo(0.30);
    expect(foodRatePerMin(s)).toBeCloseTo(0.70);
  });

  it('autoFeed докупает корм в collectIncome и сохраняет доход', () => {
    const s = createInitialState(makeRng(2), 0);
    s.level = 3; s.research = { r_autofeed: 1 }; // автокормушка
    expect(autoFeedEnabled(s)).toBe(true);
    s.cats = [];
    const champ = addCat(s, 'savannah');
    for (let i = 0; i < 7; i++) addCat(s, 'moggie'); // savannah 0.5 + 7×0.1 → 1.2/мин
    setChampion(s, champ.id, 0, 0);
    s.food = 0; s.coins = 1000; s.lastSeenAt = 0;
    const passive = passiveRatePerMin(s);
    const r = collectIncome(s, 10 * 60_000); // 10 минут отсутствия
    expect(r.coins).toBe(Math.floor(passive * 10)); // не голодал → полный доход
    expect(1000 + r.coins - s.coins).toBeGreaterThan(0); // потратился на корм
  });

  it('autoFeed без монет ничего не покупает и не уводит казну в минус', () => {
    const s = createInitialState(makeRng(3), 0);
    s.level = 3; s.research = { r_autofeed: 1 };
    s.cats = [];
    for (let i = 0; i < 8; i++) addCat(s, 'moggie');
    s.food = 0; s.coins = 0; s.lastSeenAt = 0;
    collectIncome(s, 10 * 60_000);
    expect(s.food).toBe(0);
    expect(s.coins).toBe(0);
  });
});

describe('C: многоуровневые узлы суммируют эффект по купленным уровням', () => {
  it('researchBonus складывает уровни; offlineCapMin растёт по «Ночному смотрителю»', () => {
    const s = createInitialState(makeRng(1), 0);
    s.research = { r_show: 2, r_offline: 2 };
    expect(researchBonus(s, 'income')).toBeCloseTo(0.20 + 0.20); // ур.1+ур.2 «Дрессировки»
    expect(offlineCapMin(s)).toBe(C.OFFLINE_CAP_BASE_MIN + 120); // 2×60
  });
});
