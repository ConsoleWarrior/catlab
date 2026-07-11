import { describe, it, expect } from 'vitest';
import { makeRng, makeCat, RECIPES, recipeKey, recipesFor, breedingOutcomes } from '../genetics/index.js';
import type { Recipe } from '../genetics/index.js';
import {
  createInitialState, serialize, deserialize, makeCatInstance,
  attachHiddenPedigree, buildPedigree, revealPedigree, pedigreeHasFog, knownAncestorBreeds,
  catAncestors, buildBreedingContext,
  analyzeCat, startRecipeResearch, finishRecipeResearch,
  speedUpRecipeResearch, adSkipRecipeResearch,
  recipeIsKnown, breedStudied, knownRecipesFor, researchableRecipes, outcomeRevealed,
} from './index.js';
import * as C from './config.js';
import type { Ancestor, Cat, GameState } from './index.js';

function setup(seed = 1): { s: GameState; mom: Cat; dad: Cat } {
  const s = createInitialState(makeRng(seed), 0);
  s.level = 10;
  s.coins = 100_000;
  s.dna = 100_000;
  const mom = makeCatInstance(s, makeCat('female'), 0, 'nursery', 'persian');
  const dad = makeCatInstance(s, makeCat('male'), 0, 'nursery', 'siamese');
  s.cats.push(mom, dad);
  return { s, mom, dad };
}

/** Все ли узлы дерева несут флаг known (пустое дерево → true). */
function allKnown(a?: Ancestor): boolean {
  if (!a) return true;
  return !!a.known && allKnown(a.mother) && allKnown(a.father);
}

describe('туман родословной (этап A)', () => {
  it('скрытая родословная стартовых/купленных — целиком в тумане', () => {
    const { s, mom } = setup(1);
    attachHiddenPedigree(s, mom, makeRng(2));
    expect(pedigreeHasFog(mom)).toBe(true);
    expect(mom.pedigree!.mother!.known).toBeUndefined();
    expect(knownAncestorBreeds(mom)).toEqual([]); // игроку не видно ни одной породы предков
  });

  it('родители котёнка известны по факту вязки, глубже — туман (родители не вскрыты)', () => {
    const { s, mom, dad } = setup(3);
    attachHiddenPedigree(s, mom, makeRng(4));
    attachHiddenPedigree(s, dad, makeRng(5));
    const ped = buildPedigree(mom, dad, C.PEDIGREE_DEPTH);
    expect(ped.mother.known).toBe(true);
    expect(ped.father.known).toBe(true);
    // деды (= скрытые родители мамы) остаются в тумане
    expect(ped.mother.mother!.known).toBeUndefined();
    expect(ped.father.father!.known).toBeUndefined();
  });

  it('анализ производителя «протекает» в потомков: снимок на момент рождения', () => {
    const { s, mom, dad } = setup(6);
    attachHiddenPedigree(s, mom, makeRng(7));
    attachHiddenPedigree(s, dad, makeRng(8));
    revealPedigree(mom); // маму вскрыли ДО рождения
    const ped = buildPedigree(mom, dad, C.PEDIGREE_DEPTH);
    expect(allKnown(ped.mother)).toBe(true);        // мамина ветка видна котёнку
    expect(ped.father.known).toBe(true);            // папа известен (факт вязки)
    expect(ped.father.mother!.known).toBeUndefined(); // но его предки — нет
  });

  it('анализ ПОСЛЕ рождения не раскрывает уже рождённых котят (снимок)', () => {
    const { s, mom, dad } = setup(9);
    attachHiddenPedigree(s, mom, makeRng(10));
    attachHiddenPedigree(s, dad, makeRng(11));
    const ped = buildPedigree(mom, dad, C.PEDIGREE_DEPTH);
    revealPedigree(mom); // поздно: дерево котёнка уже скопировано
    expect(ped.mother.mother!.known).toBeUndefined();
  });

  it('revealPedigree вскрывает всё; legacy-родители (motherBreed) известны сразу', () => {
    const { s, mom } = setup(12);
    attachHiddenPedigree(s, mom, makeRng(13));
    revealPedigree(mom);
    expect(pedigreeHasFog(mom)).toBe(false);
    expect(allKnown(mom.pedigree!.mother)).toBe(true);
    expect(knownAncestorBreeds(mom).length).toBeGreaterThan(0);
    // legacy-фолбэк: только motherBreed/fatherBreed → синтетические узлы уже известны
    const old: Cat = { ...mom, pedigree: undefined, motherBreed: 'persian', fatherBreed: 'siamese' };
    const ped = catAncestors(old);
    expect(ped.mother!.known).toBe(true);
    expect(pedigreeHasFog(old)).toBe(false);
  });
});

describe('генетический анализ (этап B)', () => {
  it('за 💰: списывает монеты, ставит analyzed и вскрывает дерево', () => {
    const { s, mom } = setup(20);
    attachHiddenPedigree(s, mom, makeRng(21));
    s.coins = C.ANALYZE_COIN_COST;
    const r = analyzeCat(s, mom.id, 'coins', 1000);
    expect(r).toMatchObject({ ok: true, coins: C.ANALYZE_COIN_COST });
    expect(s.coins).toBe(0);
    expect(mom.analyzed).toBe(true);
    expect(pedigreeHasFog(mom)).toBe(false);
  });

  it('не хватает монет → отказ без изменений', () => {
    const { s, mom } = setup(22);
    attachHiddenPedigree(s, mom, makeRng(23));
    s.coins = C.ANALYZE_COIN_COST - 1;
    expect(analyzeCat(s, mom.id, 'coins', 0)).toMatchObject({ ok: false, reason: 'не хватает монет' });
    expect(mom.analyzed).toBe(false);
    expect(pedigreeHasFog(mom)).toBe(true);
  });

  it('📺: бесплатно, но с глобальным кулдауном', () => {
    const { s, mom, dad } = setup(24);
    attachHiddenPedigree(s, mom, makeRng(25));
    attachHiddenPedigree(s, dad, makeRng(26));
    s.coins = 0;
    expect(analyzeCat(s, mom.id, 'ad', 1000).ok).toBe(true);
    expect(mom.analyzed).toBe(true);
    // сразу второй — кулдаун ещё не прошёл
    expect(analyzeCat(s, dad.id, 'ad', 2000)).toMatchObject({ ok: false });
    // после кулдауна — можно
    expect(analyzeCat(s, dad.id, 'ad', 1000 + C.ANALYZE_AD_COOLDOWN_MS).ok).toBe(true);
  });

  it('повторный анализ — no-op (ok, бесплатно)', () => {
    const { s, mom } = setup(27);
    mom.analyzed = true;
    const coins = s.coins;
    expect(analyzeCat(s, mom.id, 'coins', 0)).toMatchObject({ ok: true, coins: 0 });
    expect(s.coins).toBe(coins);
  });
});

describe('Котодекс-рецептурник (этап C)', () => {
  it('рецепт известен: порода выведена ИЛИ ключ в knownRecipes', () => {
    const { s } = setup(30);
    const r = recipesFor('exotic_shorthair')[0]!; // persian × british_shorthair
    expect(recipeIsKnown(s, r)).toBe(false);
    s.knownRecipes.push(recipeKey(r));
    expect(recipeIsKnown(s, r)).toBe(true);
    const r2 = recipesFor('thai')[0]!;
    s.discoveredBreeds.push('thai');
    expect(recipeIsKnown(s, r2)).toBe(true);
  });

  it('изучена = выведена или известен хотя бы один рецепт; силуэт видит только открытый рецепт', () => {
    const { s } = setup(31);
    expect(breedStudied(s, 'exotic_shorthair')).toBe(false);
    const r = recipesFor('exotic_shorthair')[0]!;
    s.knownRecipes.push(recipeKey(r));
    expect(breedStudied(s, 'exotic_shorthair')).toBe(true);   // силуэт
    expect(knownRecipesFor(s, 'exotic_shorthair')).toEqual([r]);
    // а у ВЫВЕДЕННОЙ породы видны все её рецепты
    s.discoveredBreeds.push('british_shorthair');
    expect(knownRecipesFor(s, 'british_shorthair')).toEqual(recipesFor('british_shorthair'));
  });
});

describe('исследование рецептов (этап D)', () => {
  it('пул: только неоткрытые рецепты с ОБЕИМИ выведенными родительскими породами', () => {
    const { s } = setup(40);
    s.discoveredBreeds = ['moggie'];
    const pool = researchableRecipes(s);
    const results = pool.map((r) => r.result);
    // от одних дворовых достижимы прямые T1-рецепты и ALLEY×ALLEY-родословные
    // (сторона-«любая из списка» достижима, если выведена хотя бы одна её порода)
    expect(results).toContain('domestic_shorthair');
    expect(results).toContain('domestic_longhair');
    expect(results).toContain('british_shorthair'); // ALLEY × ALLEY (скрытый ген — не гейт пула)
    // а вот exotic_shorthair (persian × british_shorthair) недостижим — породы не выведены
    expect(results).not.toContain('exotic_shorthair');
    // открытый исследованием рецепт уходит из пула (дубликаты исключены)
    s.knownRecipes.push(recipeKey(pool[0]!));
    expect(researchableRecipes(s).length).toBe(pool.length - 1);
    // выведенная порода тоже исключает свои рецепты из пула
    s.discoveredBreeds.push('domestic_shorthair', 'domestic_longhair');
    const results2 = researchableRecipes(s).map((r) => r.result);
    expect(results2).not.toContain('domestic_shorthair');
    expect(results2).not.toContain('domestic_longhair');
    // зато открылись рецепты от домашних короткошёрстных (european_shorthair и т.п.)
    expect(results2).toContain('european_shorthair');
  });

  it('старт: гейт уровнем, цена 💰+🧬, один слот', () => {
    const { s } = setup(41);
    s.level = C.LAB_UNLOCKS.recipeLab - 1;
    expect(startRecipeResearch(s, 0)).toMatchObject({ ok: false, reason: 'locked' });
    s.level = C.LAB_UNLOCKS.recipeLab;
    s.coins = C.RECIPE_RESEARCH_COST_COINS - 1;
    expect(startRecipeResearch(s, 0)).toMatchObject({ ok: false, reason: 'не хватает ресурсов' });
    s.coins = C.RECIPE_RESEARCH_COST_COINS;
    s.dna = C.RECIPE_RESEARCH_COST_DNA;
    expect(startRecipeResearch(s, 1000).ok).toBe(true);
    expect(s.coins).toBe(0);
    expect(s.dna).toBe(0);
    expect(s.recipeResearch.readyAt).toBe(1000 + C.RECIPE_RESEARCH_MS);
    // слот занят — второй запуск невозможен
    s.coins = 10_000; s.dna = 10_000;
    expect(startRecipeResearch(s, 2000)).toMatchObject({ ok: false, reason: 'стол занят исследованием' });
  });

  it('пустой пул: запуск невозможен', () => {
    const { s } = setup(42);
    // все рецепты «известны» → пул пуст
    s.knownRecipes = RECIPES.map((r) => recipeKey(r));
    expect(startRecipeResearch(s, 0)).toMatchObject({ ok: false, reason: 'нет доступных рецептов' });
  });

  it('финиш: выдаёт случайный рецепт из пула → knownRecipes; до готовности — null', () => {
    const { s } = setup(43);
    expect(startRecipeResearch(s, 0).ok).toBe(true);
    const early = finishRecipeResearch(s, C.RECIPE_RESEARCH_MS - 1, makeRng(1));
    expect(early.recipe).toBeNull();
    expect(s.recipeResearch.readyAt).toBeGreaterThan(0);
    const poolKeys = researchableRecipes(s).map((r) => recipeKey(r));
    const done = finishRecipeResearch(s, C.RECIPE_RESEARCH_MS, makeRng(1));
    expect(done.recipe).not.toBeNull();
    expect(s.knownRecipes).toContain(recipeKey(done.recipe as Recipe));
    expect(s.recipeResearch.readyAt).toBe(0); // стол свободен
    // выданный рецепт был из достижимого пула
    expect(poolKeys).toContain(recipeKey(done.recipe as Recipe));
  });

  it('грейс: пул опустел за время исследования → возврат стоимости', () => {
    const { s } = setup(44);
    expect(startRecipeResearch(s, 0).ok).toBe(true);
    const coins = s.coins;
    const dna = s.dna;
    s.knownRecipes = RECIPES.map((r) => recipeKey(r)); // всё открыли, пока шёл таймер
    const done = finishRecipeResearch(s, C.RECIPE_RESEARCH_MS, makeRng(1));
    expect(done).toMatchObject({ recipe: null, refunded: true });
    expect(s.coins).toBe(coins + C.RECIPE_RESEARCH_COST_COINS);
    expect(s.dna).toBe(dna + C.RECIPE_RESEARCH_COST_DNA);
  });

  it('ускорения: 💎 завершает сразу (цена ∝ остатку), 📺 срезает AD_SKIP_MS', () => {
    const { s } = setup(45);
    expect(startRecipeResearch(s, 0).ok).toBe(true);
    const ready0 = s.recipeResearch.readyAt;
    expect(adSkipRecipeResearch(s, 1000).ok).toBe(true);
    expect(s.recipeResearch.readyAt).toBe(Math.max(1000, ready0 - C.AD_SKIP_MS));
    // 💎: стол ещё занят? (короткий тестовый таймер мог уже дойти до now)
    s.recipeResearch.readyAt = 1000 + 5 * 60_000; // 5 минут остатка
    s.crystals = 5;
    const r = speedUpRecipeResearch(s, 1000);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.crystals).toBe(5); // 1 💎/мин × 5 мин
    expect(s.recipeResearch.readyAt).toBe(1000);
  });
});

describe('превью пары (этап E): breedingOutcomes', () => {
  it('вероятности исходов в сумме дают 1', () => {
    const { s, mom, dad } = setup(50);
    attachHiddenPedigree(s, mom, makeRng(51));
    attachHiddenPedigree(s, dad, makeRng(52));
    const out = breedingOutcomes(buildBreedingContext(mom, dad));
    const total = out.reduce((sum, o) => sum + o.p, 0);
    expect(total).toBeCloseTo(1, 9);
    expect(out.length).toBeGreaterThan(0);
  });

  it('одинаковая базовая пара: фолбэк целиком уходит в породу родителей', () => {
    const { s } = setup(53);
    const a = makeCatInstance(s, makeCat('female'), 0, 'nursery', 'moggie');
    const b = makeCatInstance(s, makeCat('male'), 0, 'nursery', 'moggie');
    const out = breedingOutcomes(buildBreedingContext(a, b));
    // без родословной у пары дворовых подходят только прямые рецепты T1
    const fallback = out.filter((o) => !o.recipe);
    expect(fallback.map((o) => o.breed)).toEqual(['moggie']);
    const total = out.reduce((sum, o) => sum + o.p, 0);
    expect(total).toBeCloseTo(1, 9);
    // последовательные шансы (при равном тире первым бросается МАЛОВЕРОЯТНЫЙ —
    // как в resolveBreeding): p(dlh) = 0.18, p(dsh) = (1−0.18)×0.30
    const dsh = out.find((o) => o.breed === 'domestic_shorthair' && o.recipe)!;
    const dlh = out.find((o) => o.breed === 'domestic_longhair' && o.recipe)!;
    expect(dlh.p).toBeCloseTo(0.18, 9);
    expect(dsh.p).toBeCloseTo((1 - 0.18) * 0.30, 9);
  });

  it('разные породы: фолбэк делится между родителями и метисом', () => {
    const { mom, dad } = setup(54); // persian × siamese (рецепты birman/himalayan/balinese...)
    const out = breedingOutcomes(buildBreedingContext(mom, dad));
    const momFb = out.find((o) => !o.recipe && o.breed === 'persian');
    const dadFb = out.find((o) => !o.recipe && o.breed === 'siamese');
    expect(momFb).toBeTruthy();
    expect(dadFb).toBeTruthy();
    expect(momFb!.p).toBeCloseTo(dadFb!.p, 9); // родители наследуются поровну
  });

  it('раскрытие исхода: рецепт в Котодексе И оба родителя проанализированы', () => {
    const { s, mom, dad } = setup(55);
    const r = recipesFor('himalayan')[0]!; // persian × SIAM — прямой рецепт нашей пары
    expect(outcomeRevealed(s, mom, dad, r)).toBe(false);        // ничего не известно
    s.knownRecipes.push(recipeKey(r));
    expect(outcomeRevealed(s, mom, dad, r)).toBe(false);        // рецепт есть, генов нет
    mom.analyzed = true;
    dad.analyzed = true;
    expect(outcomeRevealed(s, mom, dad, r)).toBe(true);         // всё вскрыто
  });
});

describe('сейв: поля системы знаний', () => {
  it('новые поля переживают round-trip; у старого сейва — мягкие дефолты', () => {
    const { s } = setup(60);
    s.knownRecipes = ['x|y|z'];
    s.recipeResearch = { startedAt: 5, readyAt: 9 };
    s.lastAnalyzeAdAt = 7;
    const back = deserialize(serialize(s));
    expect(back.knownRecipes).toEqual(['x|y|z']);
    expect(back.recipeResearch).toEqual({ startedAt: 5, readyAt: 9 });
    expect(back.lastAnalyzeAdAt).toBe(7);
    // «старый» сейв без полей
    const legacy = JSON.parse(serialize(s)) as Record<string, unknown>;
    delete legacy.knownRecipes;
    delete legacy.recipeResearch;
    delete legacy.lastAnalyzeAdAt;
    const migrated = deserialize(JSON.stringify(legacy));
    expect(migrated.knownRecipes).toEqual([]);
    expect(migrated.recipeResearch).toEqual({ startedAt: 0, readyAt: 0 });
    expect(migrated.lastAnalyzeAdAt).toBe(0);
  });

  it('миграция тумана: analyzed кот вскрыт целиком, рождённый — родители известны', () => {
    const { s, mom, dad } = setup(61);
    attachHiddenPedigree(s, mom, makeRng(62));
    attachHiddenPedigree(s, dad, makeRng(63));
    mom.analyzed = true;
    dad.motherBreed = 'persian'; // «рождённый в инкубаторе» до тумана
    dad.fatherBreed = 'siamese';
    // сейв, записанный ДО появления флага known: срезаем флаги у всех узлов
    const raw = JSON.parse(serialize(s)) as { cats: { pedigree?: { mother?: Ancestor; father?: Ancestor } }[] };
    const strip = (a?: Ancestor): void => { if (!a) return; delete a.known; strip(a.mother); strip(a.father); };
    for (const c of raw.cats) { strip(c.pedigree?.mother); strip(c.pedigree?.father); }
    const back = deserialize(JSON.stringify(raw));
    const bMom = back.cats.find((c) => c.id === mom.id)!;
    const bDad = back.cats.find((c) => c.id === dad.id)!;
    expect(pedigreeHasFog(bMom)).toBe(false);                 // analyzed → всё вскрыто
    expect(bDad.pedigree!.mother!.known).toBe(true);          // родители — по факту вязки
    expect(bDad.pedigree!.mother!.mother!.known).toBeUndefined(); // деды — в тумане
  });
});
