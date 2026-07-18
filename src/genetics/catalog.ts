/**
 * Каталог пород-коллекции (70 пород, 5 тиров) и типы усилителей вязки.
 *
 * Реструктуризация системы размножения: порода котёнка больше НЕ вычисляется
 * «лестницей тиров» — вместо неё РЕЦЕПТЫ (см. recipes.ts):
 *   — прямые (Порода А + Порода Б → результат с шансом);
 *   — сцепленные с полом (важно, кто мать, а кто отец);
 *   — родословные (проверяют скрытые гены — породы предков в дереве pedigree).
 *
 * Тиры (лестница редкости): common(T1) → uncommon(T2) → rare(T3) → epic(T4)
 * → legendary(T5). Выведение старших тиров требует котов предыдущих тиров.
 * Базовая точка входа — «Дворовый» (moggie); у стартовых дворовых скрытая
 * случайная родословная (лотерея генов), которую игрок раскрывает Анализом.
 */

import type { RarityTier } from './types.js';

export type BreedKind = 'base' | 'breed';

export interface BreedDef {
  /** Ключ (совпадает с именем файла арта: `<key>__<sex>.png`). */
  key: string;
  /** Отображаемое имя (RU). */
  name: string;
  tier: RarityTier;
  kind: BreedKind;
}

/** Числовой уровень тира (для лестницы прогрессии). */
export const TIER_LEVEL: Record<RarityTier, number> = {
  common: 0, uncommon: 1, rare: 2, epic: 3, legendary: 4,
};
export const LEVEL_TIER: readonly RarityTier[] = [
  'common', 'uncommon', 'rare', 'epic', 'legendary',
];

// [key, RU-имя, тир]. 70 записей: T1 (3) — фундамент и «неудачи» вязок;
// T2 (14) — популярные; T3 (22) — редкие; T4 (21) — эксклюзивные;
// T5 (10) — легендарные (вершина селекции). Ключ породы — имя файлов арта
// `src/assets/breeds/<key>__<n>.png` (несколько вариантов, без привязки к полу).
const RAW: ReadonlyArray<readonly [string, string, RarityTier]> = [
  // --- Tier 1 — Обычные ---
  ['moggie', 'Дворовый', 'common'],
  ['domestic_shorthair', 'Домашняя короткошёрстная', 'common'],
  ['domestic_longhair', 'Домашняя длинношёрстная', 'common'],

  // --- Tier 2 — Популярные ---
  ['british_shorthair', 'Британская короткошёрстная', 'uncommon'],
  ['scottish_fold', 'Шотландская вислоухая', 'uncommon'],
  ['persian', 'Персидская', 'uncommon'],
  ['siamese', 'Сиамская', 'uncommon'],
  ['thai', 'Тайская', 'uncommon'],
  ['russian_blue', 'Русская голубая', 'uncommon'],
  ['turkish_angora', 'Турецкая ангора', 'uncommon'],
  ['siberian', 'Сибирская', 'uncommon'],
  ['neva_masquerade', 'Невская маскарадная', 'uncommon'],
  ['american_shorthair', 'Американская короткошёрстная', 'uncommon'],
  ['exotic_shorthair', 'Экзот', 'uncommon'],
  ['abyssinian', 'Абиссинская', 'uncommon'],
  ['birman', 'Священная бирма', 'uncommon'],
  ['european_shorthair', 'Европейская короткошёрстная', 'uncommon'],

  // --- Tier 3 — Редкие ---
  ['maine_coon', 'Мейн-кун', 'rare'],
  ['norwegian_forest', 'Норвежская лесная', 'rare'],
  ['ragdoll', 'Рэгдолл', 'rare'],
  ['bengal', 'Бенгальская', 'rare'],
  ['donskoy', 'Донской сфинкс', 'rare'],
  ['sphynx', 'Канадский сфинкс', 'rare'],
  ['cornish_rex', 'Корниш-рекс', 'rare'],
  ['devon_rex', 'Девон-рекс', 'rare'],
  ['munchkin', 'Манчкин', 'rare'],
  ['kurilian_bobtail', 'Курильский бобтейл', 'rare'],
  ['japanese_bobtail', 'Японский бобтейл', 'rare'],
  ['burmese', 'Бурманская', 'rare'],
  ['bombay', 'Бомбейская', 'rare'],
  ['somali', 'Сомали', 'rare'],
  ['ocicat', 'Оцикет', 'rare'],
  ['chartreux', 'Шартрез', 'rare'],
  ['oriental_shorthair', 'Ориентальная', 'rare'],
  ['tonkinese', 'Тонкинская', 'rare'],
  ['himalayan', 'Гималайская', 'rare'],
  ['manx', 'Мэнкс', 'rare'],
  ['balinese', 'Балинезийская', 'rare'],
  ['turkish_van', 'Турецкий ван', 'rare'],

  // --- Tier 4 — Эксклюзивные ---
  ['american_curl', 'Американский кёрл', 'epic'],
  ['elf', 'Эльф', 'epic'],
  ['bambino', 'Бамбино', 'epic'],
  ['skookum', 'Скукум', 'epic'],
  ['minskin', 'Минскин', 'epic'],
  ['lykoi', 'Ликой', 'epic'],
  ['chausie', 'Чаузи', 'epic'],
  ['khao_manee', 'Као-мани', 'epic'],
  ['singapura', 'Сингапура', 'epic'],
  ['selkirk_rex', 'Селкирк-рекс', 'epic'],
  ['pixiebob', 'Пиксибоб', 'epic'],
  ['toyger', 'Тойгер', 'epic'],
  ['kinkalow', 'Кинкалоу', 'epic'],
  ['peterbald', 'Петерболд', 'epic'],
  ['egyptian_mau', 'Египетская мау', 'epic'],
  ['laperm', 'Лаперм', 'epic'],
  ['american_wirehair', 'Американская жесткошёрстная', 'epic'],
  ['sokoke', 'Сококе', 'epic'],
  ['burmilla', 'Бурмилла', 'epic'],
  ['havana', 'Гавана', 'epic'],
  ['ojos_azules', 'Охос азулес', 'epic'],

  // --- Tier 5 — Легендарные ---
  ['savannah', 'Саванна', 'legendary'],
  ['caracat', 'Каракет', 'legendary'],
  ['ashera', 'Ашера', 'legendary'],
  ['dwelf', 'Двэльф', 'legendary'],
  ['serengeti', 'Серенгети', 'legendary'],
  ['cheetoh', 'Чито', 'legendary'],
  ['safari', 'Сафари', 'legendary'],
  ['california_spangled', 'Калифорнийская сияющая', 'legendary'],
  ['khao_manee_diamond', 'Као-мани «Алмаз»', 'legendary'],
  ['lykoi_elf', 'Ликой-эльф', 'legendary'],
];

export const BREEDS: readonly BreedDef[] = RAW.map(([key, name, tier]) => ({
  key, name, tier, kind: tier === 'common' ? 'base' : 'breed',
}));

export const BREED_BY_KEY: Record<string, BreedDef> = Object.fromEntries(
  BREEDS.map((b) => [b.key, b]),
);

export const BREEDS_BY_TIER: Record<RarityTier, BreedDef[]> = (() => {
  const m: Record<RarityTier, BreedDef[]> = {
    common: [], uncommon: [], rare: [], epic: [], legendary: [],
  };
  for (const b of BREEDS) m[b.tier].push(b);
  return m;
})();

/** Только настоящие породы (без базовых T1) — для коллекции/прогресса. */
export const PEDIGREE_BREEDS: readonly BreedDef[] = BREEDS.filter((b) => b.kind === 'breed');

export function tierOfBreed(key: string): RarityTier {
  return BREED_BY_KEY[key]?.tier ?? 'common';
}

export function breedName(key: string): string {
  return BREED_BY_KEY[key]?.name ?? key;
}

export function isBaseBreed(key: string): boolean {
  return (BREED_BY_KEY[key]?.kind ?? 'base') === 'base';
}

/**
 * Усилители вязки («Генная инженерия» Генолаба). Применяются к одному котёнку,
 * заряды тратятся при рождении. Поле `used` (см. resolveBreeding) сообщает,
 * какие усилители реально повлияли на исход — только их и нужно списывать.
 */
export interface BreedBoosts {
  tierUp?: boolean;  // 🔼 гарантированный успех рецепта тира выше (если условия выполнены)
  luckyUp?: boolean; // 🍀 шансы всех подходящих рецептов ×2
  noDown?: boolean;  // 🛡 котёнок не опустится ниже старшего родителя
}
