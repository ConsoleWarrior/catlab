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
 * тиру результата (редкие пробуются первыми) и раскладываем их шансы по очереди
 * в распределение исходов; хвост — фолбэк: котёнок наследует породу одного из
 * родителей, с небольшим шансом «неудачи» (откат в дворовые/домашние). Порода
 * котёнка — один бросок по этому распределению, поэтому превью 🔮 в инкубаторе
 * показывает ровно те вероятности, по которым рождается котёнок.
 *
 * УСИЛИТЕЛИ 🍀/⬇ — не множители шанса, а фильтр половины пород (keepGroup):
 * 🍀 вычёркивает из исходов серых (T1), ⬇ — цветных (T2+); шансы вычеркнутых
 * раздаются оставшимся пропорционально. То есть каждый из них — гарантия «рода»
 * котёнка, а конкретная порода внутри своей половины по-прежнему лотерея.
 *
 * Все числа шансов — здесь же в таблице RECIPES (это конфиг баланса рецептов).
 */

import type { RarityTier } from './types.js';
import type { Rng } from './random.js';
import type { BreedBoosts } from './catalog.js';
import type { TraitId } from './traits.js';
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
  /** Наследуемые гены, что несёт кот: визитка его породы ∪ визитки пород-предков. */
  traits: ReadonlySet<TraitId>;
  /** Родословная известна и в ней нет дворовых/домашних (T1) — «чистая линия». */
  pureLine: boolean;
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
  /** Признак (скрытый ген) несёт хотя бы ОДИН родитель — своей породой или предком. */
  traitAny?: TraitId;
  /** Признак несёт КАЖДЫЙ родитель (глубокий крафт). */
  traitBoth?: TraitId;
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
  { result: 'domestic_shorthair', a: 'moggie', b: 'moggie', chance: 0.55,
    note: 'Отобранные по красоте дворовые коты: надёжный фундамент селекции.' },
  { result: 'domestic_longhair', a: 'moggie', b: 'moggie', chance: 0.40,
    note: 'Дворовые с пушистой шерстью: базовая длинношёрстная линия.' },

  // ============ Tier 2 — Популярные ============
  { result: 'european_shorthair', a: 'domestic_shorthair', b: 'domestic_shorthair', chance: 0.40,
    note: 'Закрепление крепкого «рабочего» типа домашней короткошёрстной.' },
  { result: 'british_shorthair', a: ALLEY, b: ALLEY, chance: 0.35,
    ancestorAny: ['british_shorthair'],
    note: 'Рецепт родословной: массивный «британский» предок в древе одного из родителей.' },
  { result: 'siamese', a: ALLEY, b: ALLEY, chance: 0.35,
    traitAny: 'colorpoint',
    note: 'Скрытый ген окраса «Сиам» в родословной — тёмные лапки и маска проявляются сами.' },
  { result: 'persian', a: 'domestic_longhair', b: 'domestic_longhair', chance: 0.35,
    traitAny: 'flat_face',
    note: 'Пушистая пара + приплюснутомордый предок в древе: длинная шерсть и брахи-морда.' },
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
  { result: 'american_shorthair', a: ALLEY, b: 'british_shorthair', chance: 0.35,
    note: 'Крепкая рабочая кошка: прямой рецепт из дворовой линии и британца.' },
  { result: 'exotic_shorthair', a: 'persian', b: 'british_shorthair', chance: 0.90,
    note: 'Плюшевый перс с короткой шерстью: почти гарантированный прямой рецепт.' },
  { result: 'abyssinian', a: SIAM, b: ALLEY, chance: 0.30,
    traitAny: 'ticked',
    note: 'Скрытый ген «тикинг» в родословной: дикий заячий окрас без полос.' },
  { result: 'birman', a: 'persian', b: 'siamese', chance: 0.25,
    note: 'Священная бирма: длинная шерсть + сиамский окрас + белые «носочки».' },

  // ============ Tier 3 — Редкие ============
  { result: 'maine_coon', a: 'siberian', b: 'american_shorthair', chance: 0.20,
    note: 'Гигант с кисточками на ушах: две крепкие северные линии.' },
  { result: 'norwegian_forest', a: 'siberian', b: 'maine_coon', chance: 0.25, kinshipBoost: true,
    note: 'Лесная кошка фьордов. Умеренный инбридинг закрепляет тип.' },
  { result: 'ragdoll', a: 'persian', b: 'birman', chance: 0.25,
    traitAny: 'big',
    note: 'Тряпичная кукла: пушистая пара + крупный предок в древе даёт рослый мягкий тип.' },
  { result: 'bengal', a: ALLEY, b: ALLEY, chance: 0.20,
    traitBoth: 'spotted',
    note: 'Рецепт родословной: «леопардовый» предок у ОБОИХ родителей — дикие пятна.' },
  { result: 'donskoy', a: ALLEY, b: ALLEY, chance: 0.25,
    traitBoth: 'hairless',
    note: 'Рецепт родословной: скрытый ген лысости у обеих линий — доминантная мутация.' },
  { result: 'sphynx', a: 'donskoy', b: SIAM, chance: 0.40, minKinship: 'high',
    note: 'Рецессивная лысость: без близкородственного скрещивания (высокое+) не проявится.' },
  { result: 'cornish_rex', a: 'european_shorthair', b: 'moggie', chance: 0.25,
    traitAny: 'curly',
    note: 'Скрытая мутация каракулевой шерсти в родословной.' },
  { result: 'devon_rex', a: 'cornish_rex', b: 'sphynx', chance: 0.30,
    note: 'Кот-эльф: кудрявая шерсть + огромные уши.' },
  { result: 'munchkin', a: 'american_shorthair', b: ALLEY, chance: 0.25,
    traitAny: 'short_legs',
    note: 'Скрытый ген коротких лап в родословной — кошачья «такса».' },
  { result: 'kurilian_bobtail', a: 'siberian', b: ALLEY, chance: 0.25,
    traitAny: 'short_tail',
    note: 'Скрытый ген короткого хвоста-помпона в родословной.' },
  { result: 'japanese_bobtail', a: SIAM, b: 'kurilian_bobtail', chance: 0.35,
    note: 'Грациозный короткохвостый кот: восточная линия + бобтейл.' },
  { result: 'burmese', a: 'siamese', b: 'british_shorthair', chance: 0.30, sexLinked: true,
    note: 'Сцеплено с полом: «кирпич в шёлку» выходит только от МАТЕРИ-сиамки и отца-британца.' },
  { result: 'bombay', a: 'burmese', b: 'american_shorthair', chance: 0.35,
    note: 'Мини-пантера, чёрная как смоль: прямой рецепт бурмы и американской к/ш.' },
  { result: 'somali', a: 'abyssinian', b: 'turkish_angora', chance: 0.30,
    note: 'Пушистая абиссинская: тикинг + длинная шерсть.' },
  { result: 'ocicat', a: 'abyssinian', b: SIAM, chance: 0.25,
    traitAny: 'spotted',
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
    note: 'Лысый кот: шерсть остаётся только на лапках. Прямой рецепт бамбино и девон-рекса.' },
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
    note: 'Плюшевый кудрявый медвежонок: прямой рецепт перса и корниш-рекса.' },
  { result: 'pixiebob', a: 'kurilian_bobtail', b: 'maine_coon', chance: 0.15,
    note: 'Домашняя рысь: короткий хвост + крупный костяк.' },
  { result: 'toyger', a: 'bengal', b: 'american_shorthair', chance: 0.15,
    note: 'Кот-тигр с идеальными вертикальными полосами: бенгал × американская к/ш.' },
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
  { result: 'ashera', a: 'savannah', b: 'domestic_shorthair', chance: 0.02,
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

/**
 * Стабильный ключ рецепта — по нему хранятся открытые исследованием рецепты в
 * сейве (state.knownRecipes). Формат «result|a|b» НЕ менять и не менять породы
 * сторон существующих рецептов без миграции — иначе игроки потеряют открытия.
 */
export function recipeKey(r: Recipe): string {
  const side = (s: SideSpec): string => (typeof s === 'string' ? s : s.join('+'));
  return `${r.result}|${side(r.a)}|${side(r.b)}`;
}

/** Родословный ли рецепт (читает предков/скрытые признаки) — такие усиливает инбридинг. */
export function isPedigreeRecipe(r: Recipe): boolean {
  return !!(r.traitAny || r.traitBoth
    || r.ancestorAny || r.ancestorBoth || r.ancestorTotal || r.distinctTiers || r.pureLine);
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
  if (r.traitAny && !sides.some((s) => s.traits.has(r.traitAny!))) return false;
  if (r.traitBoth && !sides.every((s) => s.traits.has(r.traitBoth!))) return false;
  if (r.ancestorAny && !sides.some((s) => r.ancestorAny!.some((k) => s.ancestorBreeds.has(k)))) return false;
  if (r.ancestorBoth && !sides.every((s) => r.ancestorBoth!.some((k) => s.ancestorBreeds.has(k)))) return false;
  if (r.ancestorTotal && ctx.ancestorCount(r.ancestorTotal.breed) < r.ancestorTotal.count) return false;
  if (r.distinctTiers && ctx.distinctOfTiers(r.distinctTiers.tiers) < r.distinctTiers.count) return false;
  if (r.pureLine && !(ctx.mother.pureLine && ctx.father.pureLine)) return false;
  if (r.minKinship && KINSHIP_RANK[ctx.kinship] < KINSHIP_RANK[r.minKinship]) return false;
  return true;
}

/**
 * Итоговый шанс рецепта: базовый × инбридинг × `chanceMult` (глобальный множитель от
 * исследований «Селекции»). Кап CHANCE_CAP. Усилители 🍀/⬇ сюда НЕ входят — они
 * вычёркивают из готового распределения целую половину пород (см. keepGroup).
 */
export function recipeChance(r: Recipe, kinship: KinshipLevel, chanceMult = 1): number {
  const inbreedRecipe = isPedigreeRecipe(r) || !!r.kinshipBoost || !!r.minKinship;
  const kMult = inbreedRecipe ? KINSHIP_RECIPE_MULT[kinship] : 1;
  return Math.min(CHANCE_CAP, r.chance * kMult * chanceMult);
}

// --- Фолбэк (ни один рецепт не сработал) ---

/** Одинаковая пара: шанс сохранить породу (иначе «дворняжка-сюрприз»). */
const FALLBACK_KEEP = 0.90;
/** Разные породы: шанс унаследовать породу одного из родителей (иначе метис). */
const FALLBACK_PARENT = 0.85;

/** «Неудачное скрещивание» — котёнок-метис: доли дворовых пород (T1) в исходе. */
const MIXED_SHARES: readonly (readonly [string, number])[] = [
  ['moggie', 0.5], ['domestic_shorthair', 0.3], ['domestic_longhair', 0.2],
];

/** Подходящие паре рецепты: редкие результаты первыми (старший тир, внутри — маловероятные). */
function matchedRecipes(ctx: BreedingContext): Recipe[] {
  return RECIPES.filter((r) => recipeMatches(r, ctx))
    .sort((x, y) => (TIER_LEVEL[tierOfBreed(y.result)] - TIER_LEVEL[tierOfBreed(x.result)])
      || (x.chance - y.chance));
}

/** Тир старшего родителя пары. */
function maxParentTier(ctx: BreedingContext): number {
  return Math.max(
    TIER_LEVEL[tierOfBreed(ctx.mother.breed)],
    TIER_LEVEL[tierOfBreed(ctx.father.breed)],
  );
}

/**
 * Порода, которую 🔼 Активатор гарантирует этой паре (или undefined — гарантии нет).
 * Та же выборка, что в resolveBreeding: первый подходящий рецепт тира ВЫШЕ родителей
 * (сортировка отдаёт самый старший и редкий). Чистая функция — для превью 🔮 и чипов.
 */
export function tierUpTarget(ctx: BreedingContext): string | undefined {
  const top = maxParentTier(ctx);
  return matchedRecipes(ctx).find((r) => TIER_LEVEL[tierOfBreed(r.result)] > top)?.result;
}

/**
 * «Выстрелит» ли усилитель на этой паре — подсказка ⚡ на чипах Инкубатора (UI,
 * механику не меняет): 🔼 — есть цель для гарантии; 🍀/⬇ — в исходах пары есть и то,
 * что усилитель оставляет, и то, что он вычёркивает (иначе фильтровать нечего);
 * 🛡 — фолбэк способен опустить котёнка ниже старшего родителя.
 */
export function boostCanFire(id: keyof BreedBoosts, ctx: BreedingContext): boolean {
  if (id === 'tierUp') return tierUpTarget(ctx) !== undefined;
  if (id === 'degrade' || id === 'luckyUp') {
    const mass = massOf(outcomesBase(ctx), id === 'degrade' ? isCommonOutcome : isColorOutcome);
    return mass > 0 && mass < 1;
  }
  // noDown: одинаковая пара рискует только «метисом-сюрпризом» (базовые породы его
  // не бросают); разные породы — младшим родителем или метисом. Дворовым (T1,
  // TIER_LEVEL 0) терять нечего — ниже фолбэк не роняет.
  if (ctx.mother.breed === ctx.father.breed) {
    return !isBaseBreed(ctx.mother.breed) && maxParentTier(ctx) > TIER_LEVEL.common;
  }
  return maxParentTier(ctx) > TIER_LEVEL.common;
}

/**
 * Порода котёнка от пары родителей — главная точка входа (заменяет прежнюю
 * «лестницу тиров» breedKitten). Исход берём одним броском по распределению
 * исходов пары — ровно те вероятности, что игрок видит в превью 🔮 (одна
 * математика на бросок и на прогноз). `used` заполняется флагами реально
 * сработавших усилителей (для списания зарядов без потери впустую).
 */
export function resolveBreeding(
  ctx: BreedingContext,
  rng: Rng,
  boosts: BreedBoosts = {},
  used?: BreedBoosts,
  chanceMult = 1,
): string {
  // 🔼 Активатор: гарантируем первый подходящий рецепт тира ВЫШЕ родителей.
  if (boosts.tierUp) {
    const up = tierUpTarget(ctx);
    if (up) {
      if (used) used.tierUp = true;
      return up;
    }
  }

  // Распределение исходов + отсев пород активными усилителями (см. keepGroup).
  const base = outcomesBase(ctx, chanceMult);
  const lucky = boosts.luckyUp ? keepGroup(base, isColorOutcome) : base;
  const dist = boosts.degrade ? keepGroup(lucky, isCommonOutcome) : lucky;
  const pick = pickOutcome(dist, rng());
  let out = pick?.breed ?? ctx.mother.breed;

  // Заряд списываем, только если усилитель реально сузил выбор (keepGroup отдаёт
  // исходный список, когда вычёркивать нечего — тогда бустер не сработал, заряд цел).
  if (boosts.luckyUp && used && lucky !== base) used.luckyUp = true;
  if (boosts.degrade && used && dist !== lucky) used.degrade = true;

  // 🛡 Стабилизатор: котёнок не опускается ниже старшего родителя.
  if (boosts.noDown && TIER_LEVEL[tierOfBreed(out)] < maxParentTier(ctx)) {
    out = TIER_LEVEL[tierOfBreed(ctx.mother.breed)] >= TIER_LEVEL[tierOfBreed(ctx.father.breed)]
      ? ctx.mother.breed
      : ctx.father.breed;
    if (used) used.noDown = true;
  }
  return out;
}

// --- Превью пары (система знаний, «тир-тизер») ---

/** Один исход превью: порода-результат и её вероятность. Без recipe — фолбэк. */
export interface BreedingOutcome {
  breed: string;
  p: number;       // вероятность исхода; сумма по списку = 1
  recipe?: Recipe; // сработавший рецепт (нет — наследование породы родителя / метис)
}

/**
 * Распределение исходов пары БЕЗ усилителей-перевзвешивателей: последовательные
 * шансы рецептов (редкие первыми) + фолбэк-наследование. Общая основа и для броска
 * (resolveBreeding), и для превью 🔮 — 🍀/⬇ применяются поверх (boostMass).
 */
function outcomesBase(ctx: BreedingContext, chanceMult = 1): BreedingOutcome[] {
  const matched = matchedRecipes(ctx);

  const out: BreedingOutcome[] = [];
  let rest = 1; // масса «ни один из предыдущих рецептов не сработал»
  for (const r of matched) {
    const p = recipeChance(r, ctx.kinship, chanceMult);
    out.push({ breed: r.result, p: rest * p, recipe: r });
    rest *= 1 - p;
  }

  // фолбэк: одинаковые породы фолбэка сливаем в одну строку
  const addFb = (breed: string, p: number): void => {
    if (p <= 0) return;
    const prev = out.find((o) => !o.recipe && o.breed === breed);
    if (prev) prev.p += p;
    else out.push({ breed, p });
  };
  const addMixed = (mass: number): void => {
    for (const [breed, share] of MIXED_SHARES) addFb(breed, mass * share);
  };
  if (ctx.mother.breed === ctx.father.breed) {
    if (isBaseBreed(ctx.mother.breed)) addFb(ctx.mother.breed, rest);
    else {
      addFb(ctx.mother.breed, rest * FALLBACK_KEEP);
      addMixed(rest * (1 - FALLBACK_KEEP));
    }
  } else {
    addFb(ctx.mother.breed, rest * FALLBACK_PARENT * 0.5);
    addFb(ctx.father.breed, rest * FALLBACK_PARENT * 0.5);
    addMixed(rest * (1 - FALLBACK_PARENT));
  }
  return out;
}

/** Половина пород, которую усилитель оставляет в исходах пары. */
type OutcomePick = (o: BreedingOutcome) => boolean;

/** ⬇ Деградатор оставляет серых дворовых (T1) — по тиру породы, не по рецепту. */
const isCommonOutcome: OutcomePick = (o) => tierOfBreed(o.breed) === 'common';
/** 🍀 Катализатор оставляет цветных — всё от зелёных (T2) и выше. */
const isColorOutcome: OutcomePick = (o) => tierOfBreed(o.breed) !== 'common';

/** Суммарная вероятность исходов группы. */
function massOf(list: readonly BreedingOutcome[], pick: OutcomePick): number {
  return list.reduce((s, o) => s + (pick(o) ? o.p : 0), 0);
}

/**
 * Усилитель-фильтр (🍀/⬇): в исходах остаётся ТОЛЬКО его половина пород, шанс всех
 * остальных обнуляется и раздаётся оставшимся — пропорционально их собственным шансам
 * (редкий рецепт остаётся редким относительно частого, меняется лишь масштаб).
 * Поэтому усилитель — гарантия «какого рода будет котёнок», а не множитель шанса:
 * прежняя схема множителей раздувала первый же рецепт в очереди до капа и съедала
 * шансы остальных. Если вычёркивать нечего (вся масса уже в группе) или оставлять
 * нечего (группа пуста) — возвращается ИСХОДНЫЙ список: бустер не сработал.
 */
function keepGroup(list: BreedingOutcome[], pick: OutcomePick): BreedingOutcome[] {
  const mass = massOf(list, pick);
  if (mass <= 0 || mass >= 1) return list;
  return list.filter(pick).map((o) => ({ ...o, p: o.p / mass }));
}

/** Исход по броску rng ∈ [0,1) на распределении (сумма p = 1). */
function pickOutcome(
  list: readonly BreedingOutcome[], roll: number,
): BreedingOutcome | undefined {
  let acc = 0;
  for (const o of list) {
    acc += o.p;
    if (roll < acc) return o;
  }
  return list[list.length - 1]; // страховка от накопленной погрешности
}

/**
 * Распределение исходов пары для превью в инкубаторе — та же математика, что в
 * resolveBreeding, но без броска. Механику НЕ меняет (чистая функция). `luckyUp` —
 * активен 🍀 Катализатор (остаются только цветные породы), `degrade` — активен
 * ⬇ Деградатор (остаются только серые дворовые), `chanceMult` — множитель исследований
 * «Селекции». Усилители tierUp/noDown в превью не учитываются (гарантии, а не вероятности).
 */
export function breedingOutcomes(
  ctx: BreedingContext, luckyUp = false, chanceMult = 1, degrade = false,
): BreedingOutcome[] {
  let list = outcomesBase(ctx, chanceMult);
  if (luckyUp) list = keepGroup(list, isColorOutcome);
  if (degrade) list = keepGroup(list, isCommonOutcome);
  return list;
}
