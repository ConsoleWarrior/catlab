/**
 * Рецепты выведения пород — ядро новой системы размножения.
 *
 * Порода котёнка определяется РЕЦЕПТАМИ трёх типов:
 *   1. Прямой: Порода А + Порода Б → результат с шансом (пол не важен).
 *   2. Сцепленный с полом (`sexLinked`): мать и отец должны быть именно тех пород,
 *      что указаны — обратная расстановка не срабатывает.
 *   3. Родословный: проверяет «скрытые гены» — породы предков в деревьях pedigree
 *      родителей (ancestorAny/Both/Total, distinctTiers, pureLine). У стартовых
 *      дворовых родословная сгенерирована случайно (лотерея скрытых генов).
 *
 * ИНБРИДИНГ: уровень родства пары (см. game/kinship.ts) умножает шанс
 * родословных рецептов (и прямых с флагом kinshipBoost) на KINSHIP_RECIPE_MULT.
 * Рецепты с minKinship вообще не срабатывают без нужного уровня родства —
 * это «запертые» породы (ликой, каракет...), цена которым — здоровье котёнка.
 *
 * Разрешение (resolveBreeding): собираем все подходящие рецепты, сортируем по
 * тиру результата (редкие пробуются первыми), бросаем шанс каждого по очереди.
 * Ни один не сработал → фолбэк: котёнок наследует породу одного из родителей,
 * с небольшим шансом «неудачи» (откат в дворовые/домашние).
 *
 * Все числа шансов — здесь же в таблице RECIPES (это конфиг баланса рецептов).
 */

import type { RarityTier } from './types.js';
import type { Rng } from './random.js';
import type { BreedBoosts } from './catalog.js';
import { tierOfBreed, TIER_LEVEL, isBaseBreed } from './catalog.js';

/** Уровень родства пары (вычисляется по ID предков в game/kinship.ts). */
export type KinshipLevel = 'none' | 'moderate' | 'high' | 'critical';

export const KINSHIP_RANK: Record<KinshipLevel, number> = {
  none: 0, moderate: 1, high: 2, critical: 3,
};

/** Множитель шанса родословных рецептов от инбридинга (риск ↔ награда). */
export const KINSHIP_RECIPE_MULT: Record<KinshipLevel, number> = {
  none: 1, moderate: 1.15, high: 1.5, critical: 2.5,
};

/** Потолок итогового шанса рецепта после всех множителей. */
const CHANCE_CAP = 0.95;

/** Сводка одного родителя для проверки рецептов (собирает game/kinship.ts). */
export interface BreedSide {
  breed: string;
  /** Породы всех предков в дереве pedigree (без самого кота). */
  ancestorBreeds: ReadonlySet<string>;
  /** Родословная известна и в ней нет дворовых/домашних (T1) — «чистая линия». */
  pureLine: boolean;
  /** Фенотип для цвет/паттерн-условий. */
  baseColor: string;
  tabby: boolean;
}

export interface BreedingContext {
  mother: BreedSide;
  father: BreedSide;
  kinship: KinshipLevel;
  /** Сколько раз порода встречается суммарно в обоих деревьях предков. */
  ancestorCount(breed: string): number;
  /** Сколько РАЗНЫХ пород заданных тиров среди родителей и всех их предков. */
  distinctOfTiers(tiers: readonly RarityTier[]): number;
}

/** Спецификация стороны рецепта: одна порода или любая из списка. */
export type SideSpec = string | readonly string[];

export interface Recipe {
  result: string;
  /** Базовый шанс срабатывания. */
  chance: number;
  /** Пара пород. По умолчанию расстановка любая; sexLinked → a = мать, b = отец. */
  a: SideSpec;
  b: SideSpec;
  sexLinked?: boolean;
  /** Предок из списка есть хотя бы у ОДНОГО родителя (скрытый ген). */
  ancestorAny?: readonly string[];
  /** Предок из списка есть у КАЖДОГО родителя (глубокий крафт). */
  ancestorBoth?: readonly string[];
  /** Суммарно в обоих деревьях ≥ count предков данной породы (чистая линия). */
  ancestorTotal?: { breed: string; count: number };
  /** Среди родителей и предков ≥ count разных пород указанных тиров. */
  distinctTiers?: { tiers: readonly RarityTier[]; count: number };
  /** Обе родословные известны и без дворовых кровей. */
  pureLine?: boolean;
  /** Оба родителя данного базового окраса (фенотип). */
  colorBoth?: string;
  /** Оба родителя с рисунком табби (полосатые/пятнистые). */
  tabbyBoth?: boolean;
  /** Рецепт срабатывает только при родстве этого уровня и выше. */
  minKinship?: KinshipLevel;
  /** Прямой рецепт, который тоже усиливается инбридингом. */
  kinshipBoost?: boolean;
  /** Геймдизайнерское описание рецепта (Котодекс, документация). */
  note: string;
}

// Группы для читаемости таблицы: «дворовый» в рецептах = любой простой кот.
const ALLEY: readonly string[] = ['moggie', 'domestic_shorthair'];
const SIAM: readonly string[] = ['siamese', 'thai'];

/** Таблица рецептов всех пород (кроме базового moggie — он старт и «неудача»). */
export const RECIPES: readonly Recipe[] = [
  // ============ Tier 1 — Обычные ============
  { result: 'domestic_shorthair', a: 'moggie', b: 'moggie', chance: 0.30,
    note: 'Отобранные по красоте дворовые коты: скрытый ген «чистота шерсти».' },
  { result: 'domestic_longhair', a: 'moggie', b: 'moggie', chance: 0.18,
    note: 'Дворовые с пушистой шерстью: скрытый ген «пушистость».' },

  // ============ Tier 2 — Популярные ============
  { result: 'european_shorthair', a: 'domestic_shorthair', b: 'domestic_shorthair', chance: 0.40,
    note: 'Закрепление крепкого «рабочего» типа домашней короткошёрстной.' },
  { result: 'british_shorthair', a: ALLEY, b: ALLEY, chance: 0.35,
    ancestorAny: ['british_shorthair'],
    note: 'Рецепт родословной: массивный «британский» предок в древе одного из родителей.' },
  { result: 'siamese', a: ALLEY, b: ALLEY, chance: 0.35,
    ancestorAny: SIAM,
    note: 'Скрытый ген окраса «Сиам» в родословной — тёмные лапки и маска проявляются сами.' },
  { result: 'persian', a: 'domestic_longhair', b: 'domestic_longhair', chance: 0.35,
    ancestorAny: ['persian', 'himalayan'],
    note: 'Пушистая пара + персидский предок в древе: длинная шерсть и приплюснутая морда.' },
  { result: 'scottish_fold', a: 'british_shorthair', b: ALLEY, chance: 0.30, sexLinked: true,
    note: 'Сцеплено с полом: ген вислоухости передаёт МАТЬ-британка (отец — дворовый).' },
  { result: 'thai', a: 'siamese', b: ALLEY, chance: 0.50,
    note: 'Старотипная сиамская: прямой рецепт, «разбавление» сиама дворовой кровью.' },
  { result: 'russian_blue', a: 'british_shorthair', b: ALLEY, chance: 0.30,
    note: 'Скрытый серебристо-голубой окрас всплывает при вязке британца с дворовым.' },
  { result: 'turkish_angora', a: 'domestic_longhair', b: SIAM, chance: 0.30,
    note: 'Скрытый ген белого окраса: пушистая линия + восточная кровь.' },
  { result: 'siberian', a: 'domestic_longhair', b: 'british_shorthair', chance: 0.30, kinshipBoost: true,
    note: 'Крупная лесная кошка. Умеренный инбридинг закрепляет тип (бустит шанс).' },
  { result: 'neva_masquerade', a: 'siberian', b: SIAM, chance: 0.40,
    note: 'Сибирская кошка в сиамском окрасе: прямой рецепт.' },
  { result: 'american_shorthair', a: ALLEY, b: 'british_shorthair', chance: 0.35, tabbyBoth: true,
    note: 'Крепкая рабочая кошка: оба родителя должны быть полосатыми (табби).' },
  { result: 'exotic_shorthair', a: 'persian', b: 'british_shorthair', chance: 0.90,
    note: 'Плюшевый перс с короткой шерстью: почти гарантированный прямой рецепт.' },
  { result: 'abyssinian', a: SIAM, b: ALLEY, chance: 0.30,
    ancestorAny: ['abyssinian', 'somali'],
    note: 'Скрытый ген «тикинг» в родословной: дикий заячий окрас без полос.' },
  { result: 'birman', a: 'persian', b: 'siamese', chance: 0.25,
    note: 'Священная бирма: длинная шерсть + сиамский окрас + белые «носочки».' },

  // ============ Tier 3 — Редкие ============
  { result: 'maine_coon', a: 'siberian', b: 'american_shorthair', chance: 0.20,
    note: 'Гигант с кисточками на ушах: две крепкие северные линии.' },
  { result: 'norwegian_forest', a: 'siberian', b: 'maine_coon', chance: 0.25, kinshipBoost: true,
    note: 'Лесная кошка фьордов. Умеренный инбридинг закрепляет тип.' },
  { result: 'ragdoll', a: 'persian', b: 'birman', chance: 0.25,
    note: 'Тряпичная кукла: крупный, пушистый, обмякает на руках.' },
  { result: 'bengal', a: 'abyssinian', b: ALLEY, chance: 0.20,
    ancestorBoth: ['bengal', 'ocicat', 'egyptian_mau'],
    note: 'Рецепт родословной: «леопардовый» предок у ОБОИХ родителей — дикие пятна.' },
  { result: 'donskoy', a: ALLEY, b: ALLEY, chance: 0.25,
    ancestorBoth: ['donskoy', 'sphynx', 'peterbald'],
    note: 'Рецепт родословной: скрытый ген лысости у обеих линий — доминантная мутация.' },
  { result: 'sphynx', a: 'donskoy', b: SIAM, chance: 0.40, minKinship: 'high',
    note: 'Рецессивная лысость: без близкородственного скрещивания (высокое+) не проявится.' },
  { result: 'cornish_rex', a: 'abyssinian', b: 'siamese', chance: 0.25,
    ancestorAny: ['cornish_rex', 'devon_rex', 'laperm', 'selkirk_rex'],
    note: 'Скрытая мутация каракулевой шерсти в родословной.' },
  { result: 'devon_rex', a: 'cornish_rex', b: 'sphynx', chance: 0.30,
    note: 'Кот-эльф: кудрявая шерсть + огромные уши.' },
  { result: 'munchkin', a: 'american_shorthair', b: ALLEY, chance: 0.25,
    ancestorAny: ['munchkin', 'bambino', 'kinkalow', 'skookum', 'minskin', 'dwelf'],
    note: 'Скрытый ген коротких лап в родословной — кошачья «такса».' },
  { result: 'kurilian_bobtail', a: 'siberian', b: ALLEY, chance: 0.25,
    ancestorAny: ['kurilian_bobtail', 'japanese_bobtail', 'manx', 'pixiebob'],
    note: 'Скрытый ген короткого хвоста-помпона в родословной.' },
  { result: 'japanese_bobtail', a: SIAM, b: 'kurilian_bobtail', chance: 0.35,
    note: 'Грациозный короткохвостый кот: восточная линия + бобтейл.' },
  { result: 'burmese', a: 'siamese', b: 'british_shorthair', chance: 0.30, sexLinked: true,
    note: 'Сцеплено с полом: «кирпич в шёлку» выходит только от МАТЕРИ-сиамки и отца-британца.' },
  { result: 'bombay', a: 'burmese', b: 'american_shorthair', chance: 0.35, colorBoth: 'black',
    note: 'Мини-пантера: оба родителя обязаны быть чёрными.' },
  { result: 'somali', a: 'abyssinian', b: 'turkish_angora', chance: 0.30,
    note: 'Пушистая абиссинская: тикинг + длинная шерсть.' },
  { result: 'ocicat', a: 'abyssinian', b: SIAM, chance: 0.25,
    ancestorAny: ['ocicat', 'egyptian_mau', 'bengal'],
    note: 'Рецепт родословной: пятнистый предок — дикий окрас без дикой крови.' },
  { result: 'chartreux', a: 'british_shorthair', b: 'russian_blue', chance: 0.35, minKinship: 'high',
    note: 'Старинная французская линия: замкнутое (родственное) разведение голубых кошек.' },
  { result: 'oriental_shorthair', a: 'siamese', b: 'abyssinian', chance: 0.30,
    note: 'Экстремально длинное тело и огромные уши: прямой рецепт.' },
  { result: 'tonkinese', a: 'burmese', b: SIAM, chance: 0.40,
    note: 'Золотая середина между бурмой и сиамом.' },
  { result: 'himalayan', a: 'persian', b: SIAM, chance: 0.15,
    note: 'Колор-пойнт перс: редкий исход персидско-сиамской пары.' },
  { result: 'manx', a: 'kurilian_bobtail', b: 'european_shorthair', chance: 0.30, minKinship: 'high',
    note: 'Островной изолят: полная бесхвостость закрепляется только инбридингом.' },
  { result: 'balinese', a: 'siamese', b: 'domestic_longhair', chance: 0.30,
    note: 'Пушистый сиам: длинная шерсть поверх колор-пойнта.' },
  { result: 'turkish_van', a: 'turkish_angora', b: 'european_shorthair', chance: 0.25,
    note: 'Кошка-пловец с озера Ван: белая с цветными головой и хвостом.' },

  // ============ Tier 4 — Эксклюзивные ============
  { result: 'american_curl', a: 'scottish_fold', b: ALLEY, chance: 0.15, kinshipBoost: true,
    note: 'Мутация ушного хряща «наоборот»: уши выворачиваются назад рожками.' },
  { result: 'elf', a: 'sphynx', b: 'american_curl', chance: 0.20,
    note: 'Лысый кот с загнутыми ушами: сфинкс + кёрл.' },
  { result: 'bambino', a: 'sphynx', b: 'munchkin', chance: 0.20,
    note: 'Лысый коротколапый кот: сфинкс + манчкин.' },
  { result: 'skookum', a: 'munchkin', b: 'cornish_rex', chance: 0.25,
    note: 'Кудрявый коротколапый кот.' },
  { result: 'minskin', a: 'bambino', b: 'devon_rex', chance: 0.20,
    ancestorBoth: ['sphynx', 'donskoy'],
    note: 'Рецепт родословной: лысость с обеих сторон — шерсть остаётся только на лапках.' },
  { result: 'lykoi', a: 'donskoy', b: 'domestic_shorthair', chance: 0.20, minKinship: 'critical',
    note: 'Кот-оборотень: ген просыпается ТОЛЬКО при критическом инбридинге.' },
  { result: 'chausie', a: 'abyssinian', b: 'maine_coon', chance: 0.15,
    ancestorAny: ['bengal', 'savannah', 'chausie'],
    note: 'Рецепт родословной: дикая кровь в древе — высокий прыгучий гибрид.' },
  { result: 'khao_manee', a: 'turkish_angora', b: 'turkish_angora', chance: 0.20,
    ancestorTotal: { breed: 'turkish_angora', count: 4 },
    note: 'Чистая белоснежная линия: пара ангор с ≥4 предками-ангорами суммарно.' },
  { result: 'singapura', a: 'burmese', b: 'abyssinian', chance: 0.20,
    note: 'Самая маленькая породистая кошка в мире.' },
  { result: 'selkirk_rex', a: 'persian', b: 'cornish_rex', chance: 0.25,
    note: 'Плюшевый кудрявый медвежонок.' },
  { result: 'pixiebob', a: 'kurilian_bobtail', b: 'maine_coon', chance: 0.15,
    note: 'Домашняя рысь: короткий хвост + крупный костяк.' },
  { result: 'toyger', a: 'bengal', b: 'american_shorthair', chance: 0.15, tabbyBoth: true,
    note: 'Кот-тигр: оба родителя обязаны быть полосатыми — идеальные полосы.' },
  { result: 'kinkalow', a: 'munchkin', b: 'american_curl', chance: 0.20,
    note: 'Коротколапый кот с ушами-рожками.' },
  { result: 'peterbald', a: 'donskoy', b: 'oriental_shorthair', chance: 0.40,
    note: 'Петербургский сфинкс: элегантный и длинный. Надёжный прямой рецепт.' },
  { result: 'egyptian_mau', a: 'abyssinian', b: SIAM, chance: 0.15, pureLine: true,
    note: 'Древняя порода: обе родословные должны быть ЧИСТЫМИ — ни одного дворового в древе.' },
  { result: 'laperm', a: 'cornish_rex', b: 'domestic_longhair', chance: 0.20, kinshipBoost: true,
    note: 'Кудри-локоны на фермерских котах: спонтанная мутация, инбридинг помогает.' },
  { result: 'american_wirehair', a: 'american_shorthair', b: 'devon_rex', chance: 0.15, kinshipBoost: true,
    note: 'Жёсткая проволочная шерсть: редкая мутация американской линии.' },
  { result: 'sokoke', a: 'ocicat', b: 'abyssinian', chance: 0.15,
    note: 'Лесной кенийский табби: мраморный окрас «древесной коры».' },
  { result: 'burmilla', a: 'burmese', b: 'persian', chance: 0.20,
    note: 'Серебристая шиншилла с бурманским характером.' },
  { result: 'havana', a: 'oriental_shorthair', b: 'bombay', chance: 0.20,
    note: '«Шоколадная сигара»: восточный тип + глубокий тёмный окрас.' },
  { result: 'ojos_azules', a: 'turkish_van', b: 'domestic_shorthair', chance: 0.15, minKinship: 'high',
    note: 'Редчайший ген синих глаз при любом окрасе: всплывает при родственном скрещивании.' },

  // ============ Tier 5 — Легендарные ============
  { result: 'savannah', a: 'bengal', b: 'maine_coon', chance: 0.10,
    distinctTiers: { tiers: ['rare', 'epic'], count: 4 },
    note: 'Гибрид с сервалом: нужна пара бенгал × мейн-кун и ≥4 разных редких/эксклюзивных пород среди них и их предков.' },
  { result: 'caracat', a: 'pixiebob', b: 'abyssinian', chance: 0.08, minKinship: 'critical',
    note: 'Степная рысь с кисточками: требует критического инбридинга — генетика на грани.' },
  { result: 'serengeti', a: 'bengal', b: 'oriental_shorthair', chance: 0.05,
    note: 'Копия дикого сервала без капли дикой крови.' },
  { result: 'cheetoh', a: 'bengal', b: 'ocicat', chance: 0.06,
    note: 'Мини-гепард: две пятнистые линии в одной.' },
  { result: 'safari', a: 'bengal', b: 'egyptian_mau', chance: 0.05,
    note: 'Гибрид с кошкой Жоффруа: древние пятна + дикие гены.' },
  { result: 'ashera', a: 'savannah', b: 'toyger', chance: 0.02,
    note: 'Порода-призрак, самая спорная и дорогая в мире. Шанс мизерный — супер-крафт.' },
  { result: 'dwelf', a: 'elf', b: 'bambino', chance: 0.10,
    distinctTiers: { tiers: ['epic'], count: 4 },
    note: 'Лысый + коротколапый + уши-рожки: проверяется ВСЯ родословная (≥4 разных эксклюзивных пород).' },
  { result: 'california_spangled', a: 'toyger', b: 'ocicat', chance: 0.05,
    note: 'Исчезнувшая дизайнерская порода — воскрешается только идеальной парой.' },
  { result: 'khao_manee_diamond', a: 'khao_manee', b: 'khao_manee', chance: 0.15,
    ancestorTotal: { breed: 'khao_manee', count: 6 },
    note: 'Чемпион с алмазными глазами: родословная из ≥6 као-мани суммарно у пары.' },
  { result: 'lykoi_elf', a: 'lykoi', b: 'elf', chance: 0.05,
    note: 'Лысый кот-оборотень с ушами эльфа: экспериментальный микс лаборатории.' },
];

/** Рецепты, дающие данную породу (для Котодекса/подсказок). */
export function recipesFor(breed: string): Recipe[] {
  return RECIPES.filter((r) => r.result === breed);
}

/** Родословный ли рецепт (проверяет предков) — такие усиливает инбридинг. */
export function isPedigreeRecipe(r: Recipe): boolean {
  return !!(r.ancestorAny || r.ancestorBoth || r.ancestorTotal || r.distinctTiers || r.pureLine);
}

function sideIs(breed: string, spec: SideSpec): boolean {
  return typeof spec === 'string' ? breed === spec : spec.includes(breed);
}

/** Пара родителей подходит под рецепт (с учётом сцепления с полом). */
export function pairMatches(r: Recipe, mother: string, father: string): boolean {
  if (r.sexLinked) return sideIs(mother, r.a) && sideIs(father, r.b);
  return (sideIs(mother, r.a) && sideIs(father, r.b))
    || (sideIs(mother, r.b) && sideIs(father, r.a));
}

/** Все условия рецепта выполнены для данной пары. */
export function recipeMatches(r: Recipe, ctx: BreedingContext): boolean {
  if (!pairMatches(r, ctx.mother.breed, ctx.father.breed)) return false;
  const sides = [ctx.mother, ctx.father];
  if (r.ancestorAny && !sides.some((s) => r.ancestorAny!.some((k) => s.ancestorBreeds.has(k)))) return false;
  if (r.ancestorBoth && !sides.every((s) => r.ancestorBoth!.some((k) => s.ancestorBreeds.has(k)))) return false;
  if (r.ancestorTotal && ctx.ancestorCount(r.ancestorTotal.breed) < r.ancestorTotal.count) return false;
  if (r.distinctTiers && ctx.distinctOfTiers(r.distinctTiers.tiers) < r.distinctTiers.count) return false;
  if (r.pureLine && !(ctx.mother.pureLine && ctx.father.pureLine)) return false;
  if (r.colorBoth && !sides.every((s) => s.baseColor === r.colorBoth)) return false;
  if (r.tabbyBoth && !sides.every((s) => s.tabby)) return false;
  if (r.minKinship && KINSHIP_RANK[ctx.kinship] < KINSHIP_RANK[r.minKinship]) return false;
  return true;
}

/** Итоговый шанс рецепта с учётом инбридинга и Катализатора. */
export function recipeChance(r: Recipe, kinship: KinshipLevel, luckyUp = false): number {
  let p = r.chance;
  if (isPedigreeRecipe(r) || r.kinshipBoost || r.minKinship) p *= KINSHIP_RECIPE_MULT[kinship];
  if (luckyUp) p *= 2;
  return Math.min(CHANCE_CAP, p);
}

// --- Фолбэк (ни один рецепт не сработал) ---

/** Одинаковая пара: шанс сохранить породу (иначе «дворняжка-сюрприз»). */
const FALLBACK_KEEP = 0.90;
/** Разные породы: шанс унаследовать породу одного из родителей (иначе метис). */
const FALLBACK_PARENT = 0.85;

/** «Неудачное скрещивание»: котёнок-метис (T1). */
function mixedKitten(rng: Rng): string {
  const r = rng();
  if (r < 0.5) return 'moggie';
  return r < 0.8 ? 'domestic_shorthair' : 'domestic_longhair';
}

/**
 * Порода котёнка от пары родителей — главная точка входа (заменяет прежнюю
 * «лестницу тиров» breedKitten). `used` заполняется флагами реально сработавших
 * усилителей (для списания зарядов без потери впустую).
 */
export function resolveBreeding(
  ctx: BreedingContext,
  rng: Rng,
  boosts: BreedBoosts = {},
  used?: BreedBoosts,
): string {
  const matched = RECIPES.filter((r) => recipeMatches(r, ctx))
    // редкие результаты пробуем первыми; при равном тире — сначала маловероятные
    .sort((x, y) => (TIER_LEVEL[tierOfBreed(y.result)] - TIER_LEVEL[tierOfBreed(x.result)])
      || (x.chance - y.chance));

  const maxParentTier = Math.max(
    TIER_LEVEL[tierOfBreed(ctx.mother.breed)],
    TIER_LEVEL[tierOfBreed(ctx.father.breed)],
  );

  // 🔼 Активатор: гарантируем первый подходящий рецепт тира ВЫШЕ родителей.
  if (boosts.tierUp) {
    const up = matched.find((r) => TIER_LEVEL[tierOfBreed(r.result)] > maxParentTier);
    if (up) {
      if (used) used.tierUp = true;
      return up.result;
    }
  }

  for (const r of matched) {
    if (rng() < recipeChance(r, ctx.kinship, boosts.luckyUp)) {
      if (boosts.luckyUp && used) used.luckyUp = true; // 🍀 сработал усиленный бросок
      return r.result;
    }
  }

  // Фолбэк: наследование породы родителей / «неудача» (метис).
  let out: string;
  if (ctx.mother.breed === ctx.father.breed) {
    out = isBaseBreed(ctx.mother.breed) || rng() < FALLBACK_KEEP
      ? ctx.mother.breed
      : mixedKitten(rng);
  } else {
    out = rng() < FALLBACK_PARENT
      ? (rng() < 0.5 ? ctx.mother.breed : ctx.father.breed)
      : mixedKitten(rng);
  }
  // 🛡 Стабилизатор: котёнок не опускается ниже старшего родителя.
  if (boosts.noDown && TIER_LEVEL[tierOfBreed(out)] < maxParentTier) {
    out = TIER_LEVEL[tierOfBreed(ctx.mother.breed)] >= TIER_LEVEL[tierOfBreed(ctx.father.breed)]
      ? ctx.mother.breed
      : ctx.father.breed;
    if (used) used.noDown = true;
  }
  return out;
}
