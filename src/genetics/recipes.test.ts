import { describe, it, expect } from 'vitest';
import { makeRng } from './random.js';
import { BREEDS, BREED_BY_KEY, tierOfBreed, TIER_LEVEL } from './catalog.js';
import type { BreedBoosts } from './catalog.js';
import {
  RECIPES, recipesFor, recipeMatches, recipeChance, resolveBreeding, isPedigreeRecipe,
  tierUpTarget, boostCanFire, breedingOutcomes,
} from './recipes.js';
import type { BreedingContext, BreedSide, KinshipLevel, Recipe } from './recipes.js';
import { carriedTraitSet, TRAIT_BY_ID } from './traits.js';

/** Контекст пары для тестов: породы + опционально предки/родство/фенотип. */
function ctx(
  mother: string,
  father: string,
  opts: {
    motherAnc?: string[]; fatherAnc?: string[];
    kinship?: KinshipLevel;
    pure?: boolean;
  } = {},
): BreedingContext {
  const side = (breed: string, anc: string[]): BreedSide => ({
    breed,
    ancestorBreeds: new Set(anc),
    traits: carriedTraitSet(breed, anc),
    pureLine: opts.pure ?? false,
  });
  const all = [...(opts.motherAnc ?? []), ...(opts.fatherAnc ?? [])];
  const counts = new Map<string, number>();
  for (const b of all) counts.set(b, (counts.get(b) ?? 0) + 1);
  const pool = new Set([mother, father, ...all]);
  return {
    mother: side(mother, opts.motherAnc ?? []),
    father: side(father, opts.fatherAnc ?? []),
    kinship: opts.kinship ?? 'none',
    ancestorCount: (b) => counts.get(b) ?? 0,
    distinctOfTiers: (tiers) => {
      let n = 0;
      for (const b of pool) if (tiers.includes(tierOfBreed(b))) n++;
      return n;
    },
  };
}

describe('таблица рецептов', () => {
  it('у каждой породы (кроме базового moggie) есть хотя бы один рецепт', () => {
    for (const b of BREEDS) {
      if (b.key === 'moggie') continue;
      expect(recipesFor(b.key).length, b.key).toBeGreaterThan(0);
    }
  });

  it('все породы в рецептах (ингредиенты, результаты, предки) существуют в каталоге', () => {
    const check = (k: string): void => { expect(BREED_BY_KEY[k], k).toBeDefined(); };
    for (const r of RECIPES) {
      check(r.result);
      for (const spec of [r.a, r.b]) {
        if (typeof spec === 'string') check(spec);
        else for (const k of spec) check(k);
      }
      for (const k of r.ancestorAny ?? []) check(k);
      for (const k of r.ancestorBoth ?? []) check(k);
      if (r.ancestorTotal) check(r.ancestorTotal.breed);
      if (r.traitAny) expect(TRAIT_BY_ID[r.traitAny], r.traitAny).toBeDefined();
      if (r.traitBoth) expect(TRAIT_BY_ID[r.traitBoth], r.traitBoth).toBeDefined();
    }
  });

  it('ДОСТИЖИМОСТЬ: все 70 пород выводимы от дворовых (нет тупиков)', () => {
    // Скрытая лотерея предков стартовых котов покрывает тиры T1–T4, поэтому
    // родословные условия выполнимы всегда — проверяем только замыкание по парам.
    const reachable = new Set(['moggie']);
    const canUse = (spec: Recipe['a']): boolean =>
      typeof spec === 'string' ? reachable.has(spec) : spec.some((k) => reachable.has(k));
    let grown = true;
    while (grown) {
      grown = false;
      for (const r of RECIPES) {
        if (reachable.has(r.result)) continue;
        if (canUse(r.a) && canUse(r.b)) { reachable.add(r.result); grown = true; }
      }
    }
    const missing = BREEDS.map((b) => b.key).filter((k) => !reachable.has(k));
    expect(missing, `недостижимые породы: ${missing.join(', ')}`).toHaveLength(0);
  });

  it('рецепты старших тиров опираются на котов не ниже предыдущих тиров', () => {
    // у каждого рецепта T3+ хотя бы один родитель тиром не более чем на 2 ниже результата
    for (const r of RECIPES) {
      const resTier = TIER_LEVEL[tierOfBreed(r.result)];
      if (resTier < 2) continue;
      const best = Math.max(
        ...[r.a, r.b].map((spec) => {
          const keys = typeof spec === 'string' ? [spec] : spec;
          return Math.max(...keys.map((k) => TIER_LEVEL[tierOfBreed(k)]));
        }),
      );
      expect(best, `${r.result}: слишком простые ингредиенты`).toBeGreaterThanOrEqual(resTier - 2);
    }
  });
});

describe('типы рецептов', () => {
  it('прямой: экзот = перс × британец (расстановка любая)', () => {
    const r = recipesFor('exotic_shorthair')[0]!;
    expect(recipeMatches(r, ctx('persian', 'british_shorthair'))).toBe(true);
    expect(recipeMatches(r, ctx('british_shorthair', 'persian'))).toBe(true);
    expect(recipeMatches(r, ctx('persian', 'siamese'))).toBe(false);
  });

  it('сцепленный с полом: бурма только от МАТЕРИ-сиамки и отца-британца', () => {
    const r = recipesFor('burmese')[0]!;
    expect(r.sexLinked).toBe(true);
    expect(recipeMatches(r, ctx('siamese', 'british_shorthair'))).toBe(true);
    expect(recipeMatches(r, ctx('british_shorthair', 'siamese'))).toBe(false); // наоборот — нет
  });

  it('родословный (any): сиам из дворовых требует сиамского предка у любого', () => {
    const r = recipesFor('siamese')[0]!;
    expect(recipeMatches(r, ctx('moggie', 'moggie'))).toBe(false);
    expect(recipeMatches(r, ctx('moggie', 'moggie', { fatherAnc: ['siamese'] }))).toBe(true);
    expect(recipeMatches(r, ctx('moggie', 'moggie', { motherAnc: ['thai'] }))).toBe(true);
  });

  it('родословный (both): донской требует ген лысости у ОБОИХ', () => {
    const r = recipesFor('donskoy')[0]!;
    expect(recipeMatches(r, ctx('moggie', 'moggie', { motherAnc: ['sphynx'] }))).toBe(false);
    expect(recipeMatches(r, ctx('moggie', 'moggie', {
      motherAnc: ['sphynx'], fatherAnc: ['donskoy'],
    }))).toBe(true);
  });

  it('родословный (total): као-мани «Алмаз» требует ≥6 као-мани суммарно', () => {
    const r = recipesFor('khao_manee_diamond')[0]!;
    const five = ctx('khao_manee', 'khao_manee', {
      motherAnc: ['khao_manee', 'khao_manee'], fatherAnc: ['khao_manee', 'khao_manee', 'khao_manee'],
    });
    expect(recipeMatches(r, five)).toBe(false); // 5 < 6
    const six = ctx('khao_manee', 'khao_manee', {
      motherAnc: ['khao_manee', 'khao_manee', 'khao_manee'],
      fatherAnc: ['khao_manee', 'khao_manee', 'khao_manee'],
    });
    expect(recipeMatches(r, six)).toBe(true);
  });

  it('чистая линия: египетская мау не выходит с дворовыми в родословной', () => {
    const r = recipesFor('egyptian_mau')[0]!;
    expect(recipeMatches(r, ctx('abyssinian', 'siamese', { pure: false }))).toBe(false);
    expect(recipeMatches(r, ctx('abyssinian', 'siamese', { pure: true }))).toBe(true);
  });

  it('прямые (без гейта окраса): бомбей и тойгер выходят от своей пары', () => {
    // Окрас/табби больше не условие рецепта — облик даёт спрайт породы (rev.3).
    const bombay = recipesFor('bombay')[0]!;
    expect(recipeMatches(bombay, ctx('burmese', 'american_shorthair'))).toBe(true);
    const toyger = recipesFor('toyger')[0]!;
    expect(recipeMatches(toyger, ctx('bengal', 'american_shorthair'))).toBe(true);
  });

  it('minKinship: ликой заперт за критическим инбридингом', () => {
    const r = recipesFor('lykoi')[0]!;
    expect(recipeMatches(r, ctx('donskoy', 'domestic_shorthair'))).toBe(false);
    expect(recipeMatches(r, ctx('donskoy', 'domestic_shorthair', { kinship: 'high' }))).toBe(false);
    expect(recipeMatches(r, ctx('donskoy', 'domestic_shorthair', { kinship: 'critical' }))).toBe(true);
  });
});

describe('инбридинг и шансы', () => {
  it('критическое родство множит шанс родословного рецепта ×2.5', () => {
    const r = recipesFor('donskoy')[0]!;
    expect(isPedigreeRecipe(r)).toBe(true);
    expect(recipeChance(r, 'none')).toBeCloseTo(r.chance);
    expect(recipeChance(r, 'critical')).toBeCloseTo(r.chance * 2.5);
    expect(recipeChance(r, 'high')).toBeCloseTo(r.chance * 1.5);
  });

  it('прямой рецепт без kinshipBoost инбридингом не усиливается', () => {
    const r = recipesFor('exotic_shorthair')[0]!;
    expect(recipeChance(r, 'critical')).toBeCloseTo(Math.min(0.95, r.chance));
  });

  it('шанс не превышает потолок 0.95', () => {
    const r = recipesFor('exotic_shorthair')[0]!; // 0.90 базовый
    expect(recipeChance(r, 'none', 1.5)).toBeCloseTo(0.95);
  });
});

describe('resolveBreeding (разрешение вязки)', () => {
  it('всегда возвращает существующую породу', () => {
    const rng = makeRng(1);
    for (let i = 0; i < 300; i++) {
      const k = resolveBreeding(ctx('moggie', 'moggie'), rng);
      expect(BREED_BY_KEY[k], k).toBeDefined();
    }
  });

  it('пара без рецепта: котёнок наследует породу родителей или скатывается в метисы', () => {
    const rng = makeRng(2);
    const seen = new Set<string>();
    for (let i = 0; i < 500; i++) seen.add(resolveBreeding(ctx('ragdoll', 'bombay'), rng));
    for (const k of seen) {
      expect(['ragdoll', 'bombay', 'moggie', 'domestic_shorthair', 'domestic_longhair']).toContain(k);
    }
    expect(seen.has('ragdoll')).toBe(true);
    expect(seen.has('bombay')).toBe(true);
  });

  it('одинаковая пара сохраняет породу чаще, чем разнопородная', () => {
    const rng = makeRng(3);
    let same = 0;
    for (let i = 0; i < 1000; i++) {
      if (resolveBreeding(ctx('ragdoll', 'ragdoll'), rng) === 'ragdoll') same++;
    }
    expect(same / 1000).toBeGreaterThan(0.8);
  });

  it('рецепт срабатывает: перс × британец почти всегда даёт экзота', () => {
    const rng = makeRng(4);
    let exotic = 0;
    for (let i = 0; i < 1000; i++) {
      if (resolveBreeding(ctx('persian', 'british_shorthair'), rng) === 'exotic_shorthair') exotic++;
    }
    expect(exotic / 1000).toBeGreaterThan(0.8);
  });

  it('инбридинг повышает выход родословного рецепта', () => {
    const args = { motherAnc: ['sphynx'], fatherAnc: ['donskoy'] };
    const rBase = makeRng(5);
    let base = 0;
    for (let i = 0; i < 2000; i++) {
      if (resolveBreeding(ctx('moggie', 'moggie', args), rBase) === 'donskoy') base++;
    }
    const rCrit = makeRng(5);
    let crit = 0;
    for (let i = 0; i < 2000; i++) {
      if (resolveBreeding(ctx('moggie', 'moggie', { ...args, kinship: 'critical' }), rCrit) === 'donskoy') crit++;
    }
    expect(crit).toBeGreaterThan(base * 1.5);
  });

  it('🔼 Активатор гарантирует подходящий рецепт тира выше', () => {
    const rng = makeRng(6);
    for (let i = 0; i < 100; i++) {
      const used: BreedBoosts = {};
      const k = resolveBreeding(ctx('persian', 'british_shorthair'), rng, { tierUp: true }, used);
      // единственный подходящий рецепт выше тира родителей — экзот? нет: экзот тоже uncommon.
      // перс(T2) × британец(T2): подходят и химера-рецепты? Проверяем факт гарантии:
      // если рецепт тира выше есть — он выбран; здесь его нет, заряд не тратится.
      expect(used.tierUp ?? false).toBe(false);
      expect(BREED_BY_KEY[k]).toBeDefined();
    }
    // а вот сиамка-мать × британец-отец имеют рецепт бурмы (T3 > T2) — гарантия срабатывает
    for (let i = 0; i < 100; i++) {
      const used: BreedBoosts = {};
      const k = resolveBreeding(ctx('siamese', 'british_shorthair'), rng, { tierUp: true }, used);
      expect(k).toBe('burmese');
      expect(used.tierUp).toBe(true);
    }
  });

  it('tierUpTarget называет цель гарантии Активатора (превью 🔮 / чипы)', () => {
    expect(tierUpTarget(ctx('siamese', 'british_shorthair'))).toBe('burmese'); // T3 > T2
    expect(tierUpTarget(ctx('persian', 'british_shorthair'))).toBeUndefined(); // рецептов тира выше нет
  });

  it('boostCanFire: «выстрелит ли» активный усилитель на паре (подсказка ⚡)', () => {
    // 🔼 — есть/нет цели для гарантии (та же логика, что tierUpTarget)
    expect(boostCanFire('tierUp', ctx('siamese', 'british_shorthair'))).toBe(true);
    expect(boostCanFire('tierUp', ctx('persian', 'british_shorthair'))).toBe(false);
    // 🛡 — фолбэк способен уронить тир: разные породы (младший родитель/метис)…
    expect(boostCanFire('noDown', ctx('ragdoll', 'bombay'))).toBe(true);
    // …одинаковая небазовая порода — риск «метиса-сюрприза»; дворовым терять нечего
    expect(boostCanFire('noDown', ctx('persian', 'persian'))).toBe(true);
    expect(boostCanFire('noDown', ctx('moggie', 'moggie'))).toBe(false);
    expect(boostCanFire('noDown', ctx('moggie', 'domestic_shorthair'))).toBe(false);
    // 🍀 — в исходах есть и цветные (оставить), и серые (вычеркнуть)
    expect(boostCanFire('luckyUp', ctx('siamese', 'british_shorthair'))).toBe(true);
  });

  it('🛡 Стабилизатор: котёнок не ниже старшего родителя', () => {
    const rng = makeRng(7);
    const floor = TIER_LEVEL[tierOfBreed('ragdoll')];
    for (let i = 0; i < 1000; i++) {
      const used: BreedBoosts = {};
      const k = resolveBreeding(ctx('ragdoll', 'bombay'), rng, { noDown: true }, used);
      expect(TIER_LEVEL[tierOfBreed(k)]).toBeGreaterThanOrEqual(floor);
    }
  });

  it('🍀 Катализатор: котёнок всегда цветной (T2+), заряд списан за сработавший отсев', () => {
    const args = { motherAnc: ['siamese'] }; // дворовые со скрытым сиамом: единственный цветной исход
    const rng = makeRng(8);
    let usedCount = 0;
    for (let i = 0; i < 500; i++) {
      const used: BreedBoosts = {};
      const k = resolveBreeding(ctx('moggie', 'moggie', args), rng, { luckyUp: true }, used);
      expect(tierOfBreed(k)).not.toBe('common');
      if (used.luckyUp) usedCount++;
    }
    expect(usedCount).toBe(500);
    // паре без единого цветного исхода отсеивать нечего — заряд цел
    const used: BreedBoosts = {};
    expect(tierOfBreed(resolveBreeding(ctx('moggie', 'moggie'), rng, { luckyUp: true }, used)))
      .toBe('common');
    expect(used.luckyUp).toBeUndefined();
  });

  it('🍀 Катализатор делит шансы серых между цветными, сохраняя их пропорции', () => {
    // пара домашних короткошёрстных со скрытыми генами: три рецепта T2 + фолбэк-наследование
    const pair = ctx('domestic_shorthair', 'domestic_shorthair', {
      motherAnc: ['british_shorthair', 'siamese'],
    });
    const base = breedingOutcomes(pair);
    const luck = breedingOutcomes(pair, true);
    const pOf = (list: { breed: string; p: number }[], breed: string): number =>
      list.filter((o) => o.breed === breed).reduce((s, o) => s + o.p, 0);
    const color = ['british_shorthair', 'siamese', 'european_shorthair'];
    const mult = color.map((b) => pOf(luck, b) / pOf(base, b));
    const first = mult[0]!;
    expect(first).toBeGreaterThan(1);
    for (const m of mult) expect(m).toBeCloseTo(first, 6); // рост одинаковый, не перекос в первый
    // серых в исходах не осталось совсем, сумма по-прежнему единица
    expect(luck.some((o) => tierOfBreed(o.breed) === 'common')).toBe(false);
    expect(luck.reduce((s, o) => s + o.p, 0)).toBeCloseTo(1, 6);
  });

  it('⬇ Деградатор: котёнок всегда дворовый (T1), заряд списан за сработавший отсев', () => {
    const rng = makeRng(11);
    let base = 0;
    for (let i = 0; i < 500; i++) {
      if (tierOfBreed(resolveBreeding(ctx('persian', 'ragdoll'), rng)) === 'common') base++;
    }
    expect(base / 500).toBeLessThan(0.25); // обычно «неудача»-метис ~15%
    let usedCount = 0;
    for (let i = 0; i < 500; i++) {
      const used: BreedBoosts = {};
      const k = resolveBreeding(ctx('persian', 'ragdoll'), rng, { degrade: true }, used);
      expect(tierOfBreed(k)).toBe('common');
      if (used.degrade) usedCount++;
    }
    expect(usedCount).toBe(500);
  });

  it('⬇ Деградатор делит шансы цветных между серыми, сохраняя их пропорции', () => {
    // пара дворовых: два рецепта T1 (домашние) + сам дворовый в фолбэке + сиамка (T2)
    const pair = ctx('moggie', 'moggie', { motherAnc: ['siamese'] });
    const base = breedingOutcomes(pair);
    const deg = breedingOutcomes(pair, false, 1, true);
    const pOf = (list: { breed: string; p: number }[], breed: string): number =>
      list.filter((o) => o.breed === breed).reduce((s, o) => s + o.p, 0);
    const t1 = ['moggie', 'domestic_shorthair', 'domestic_longhair'];
    const mult = t1.map((b) => pOf(deg, b) / pOf(base, b));
    const first = mult[0]!;
    expect(first).toBeGreaterThan(1);
    for (const m of mult) expect(m).toBeCloseTo(first, 6); // рост одинаковый, не перекос в одну
    // сиамки в исходах больше нет, сумма по-прежнему единица
    expect(pOf(deg, 'siamese')).toBe(0);
    expect(deg.reduce((s, o) => s + o.p, 0)).toBeCloseTo(1, 6);
  });

  it('усилители-фильтры видны в превью пары той же математикой, что при рождении', () => {
    const sumT1 = (list: { breed: string; p: number }[]): number =>
      list.filter((o) => tierOfBreed(o.breed) === 'common').reduce((s, o) => s + o.p, 0);
    const pair = ctx('persian', 'ragdoll');
    expect(sumT1(breedingOutcomes(pair))).toBeLessThan(0.25);
    expect(sumT1(breedingOutcomes(pair, false, 1, true))).toBeCloseTo(1, 6);  // ⬇ только серые
    expect(sumT1(breedingOutcomes(pair, true))).toBeCloseTo(0, 6);            // 🍀 только цветные
    // сумма вероятностей остаётся единицей — превью не «уплывает»
    for (const list of [breedingOutcomes(pair, false, 1, true), breedingOutcomes(pair, true)]) {
      expect(list.reduce((s, o) => s + o.p, 0)).toBeCloseTo(1, 6);
    }
  });

  it('boostCanFire(🍀/⬇): не «выстрелят», когда отсеивать в паре нечего', () => {
    expect(boostCanFire('degrade', ctx('persian', 'ragdoll'))).toBe(true);
    expect(boostCanFire('luckyUp', ctx('persian', 'ragdoll'))).toBe(true);
    // дворовые со скрытым сиамом: обе половины исходов есть — сработает любой
    const hidden = ctx('moggie', 'moggie', { motherAnc: ['siamese'] });
    expect(boostCanFire('degrade', hidden)).toBe(true);
    expect(boostCanFire('luckyUp', hidden)).toBe(true);
    // у пары, чьи исходы все до одного дворовые: ⬇ нечего вычёркивать, 🍀 нечего оставить
    expect(boostCanFire('degrade', ctx('moggie', 'moggie'))).toBe(false);
    expect(boostCanFire('luckyUp', ctx('moggie', 'moggie'))).toBe(false);
    expect(boostCanFire('degrade', ctx('moggie', 'domestic_longhair'))).toBe(false);
  });
});
