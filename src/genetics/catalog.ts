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
import { tx, type LocStr } from '../i18n.js';

export type BreedKind = 'base' | 'breed';

export interface BreedDef {
  /** Ключ (совпадает с именем файла арта: `<key>__<n>.webp`). */
  key: string;
  /** Отображаемое имя, пара [ru, en] — разворачивать через `breedName()`/`tx()`. */
  name: LocStr;
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
// `src/assets/breeds/<key>__<n>.webp` (несколько вариантов, без привязки к полу).
const RAW: ReadonlyArray<readonly [key: string, ru: string, en: string, tier: RarityTier]> = [
  // --- Tier 1 — Обычные ---
  ['moggie', 'Дворовый', 'Moggie', 'common'],
  ['domestic_shorthair', 'Домашняя короткошёрстная', 'Domestic Shorthair', 'common'],
  ['domestic_longhair', 'Домашняя длинношёрстная', 'Domestic Longhair', 'common'],

  // --- Tier 2 — Популярные ---
  ['british_shorthair', 'Британская короткошёрстная', 'British Shorthair', 'uncommon'],
  ['scottish_fold', 'Шотландская вислоухая', 'Scottish Fold', 'uncommon'],
  ['persian', 'Персидская', 'Persian', 'uncommon'],
  ['siamese', 'Сиамская', 'Siamese', 'uncommon'],
  ['thai', 'Тайская', 'Thai', 'uncommon'],
  ['russian_blue', 'Русская голубая', 'Russian Blue', 'uncommon'],
  ['turkish_angora', 'Турецкая ангора', 'Turkish Angora', 'uncommon'],
  ['siberian', 'Сибирская', 'Siberian', 'uncommon'],
  ['neva_masquerade', 'Невская маскарадная', 'Neva Masquerade', 'uncommon'],
  ['american_shorthair', 'Американская короткошёрстная', 'American Shorthair', 'uncommon'],
  ['exotic_shorthair', 'Экзот', 'Exotic Shorthair', 'uncommon'],
  ['abyssinian', 'Абиссинская', 'Abyssinian', 'uncommon'],
  ['birman', 'Священная бирма', 'Birman', 'uncommon'],
  ['european_shorthair', 'Европейская короткошёрстная', 'European Shorthair', 'uncommon'],

  // --- Tier 3 — Редкие ---
  ['maine_coon', 'Мейн-кун', 'Maine Coon', 'rare'],
  ['norwegian_forest', 'Норвежская лесная', 'Norwegian Forest Cat', 'rare'],
  ['ragdoll', 'Рэгдолл', 'Ragdoll', 'rare'],
  ['bengal', 'Бенгальская', 'Bengal', 'rare'],
  ['donskoy', 'Донской сфинкс', 'Donskoy', 'rare'],
  ['sphynx', 'Канадский сфинкс', 'Sphynx', 'rare'],
  ['cornish_rex', 'Корниш-рекс', 'Cornish Rex', 'rare'],
  ['devon_rex', 'Девон-рекс', 'Devon Rex', 'rare'],
  ['munchkin', 'Манчкин', 'Munchkin', 'rare'],
  ['kurilian_bobtail', 'Курильский бобтейл', 'Kurilian Bobtail', 'rare'],
  ['japanese_bobtail', 'Японский бобтейл', 'Japanese Bobtail', 'rare'],
  ['burmese', 'Бурманская', 'Burmese', 'rare'],
  ['bombay', 'Бомбейская', 'Bombay', 'rare'],
  ['somali', 'Сомали', 'Somali', 'rare'],
  ['ocicat', 'Оцикет', 'Ocicat', 'rare'],
  ['chartreux', 'Шартрез', 'Chartreux', 'rare'],
  ['oriental_shorthair', 'Ориентальная', 'Oriental Shorthair', 'rare'],
  ['tonkinese', 'Тонкинская', 'Tonkinese', 'rare'],
  ['himalayan', 'Гималайская', 'Himalayan', 'rare'],
  ['manx', 'Мэнкс', 'Manx', 'rare'],
  ['balinese', 'Балинезийская', 'Balinese', 'rare'],
  ['turkish_van', 'Турецкий ван', 'Turkish Van', 'rare'],

  // --- Tier 4 — Эксклюзивные ---
  ['american_curl', 'Американский кёрл', 'American Curl', 'epic'],
  ['elf', 'Эльф', 'Elf', 'epic'],
  ['bambino', 'Бамбино', 'Bambino', 'epic'],
  ['skookum', 'Скукум', 'Skookum', 'epic'],
  ['minskin', 'Минскин', 'Minskin', 'epic'],
  ['lykoi', 'Ликой', 'Lykoi', 'epic'],
  ['chausie', 'Чаузи', 'Chausie', 'epic'],
  ['khao_manee', 'Као-мани', 'Khao Manee', 'epic'],
  ['singapura', 'Сингапура', 'Singapura', 'epic'],
  ['selkirk_rex', 'Селкирк-рекс', 'Selkirk Rex', 'epic'],
  ['pixiebob', 'Пиксибоб', 'Pixiebob', 'epic'],
  ['toyger', 'Тойгер', 'Toyger', 'epic'],
  ['kinkalow', 'Кинкалоу', 'Kinkalow', 'epic'],
  ['peterbald', 'Петерболд', 'Peterbald', 'epic'],
  ['egyptian_mau', 'Египетская мау', 'Egyptian Mau', 'epic'],
  ['laperm', 'Лаперм', 'LaPerm', 'epic'],
  ['american_wirehair', 'Американская жесткошёрстная', 'American Wirehair', 'epic'],
  ['sokoke', 'Сококе', 'Sokoke', 'epic'],
  ['burmilla', 'Бурмилла', 'Burmilla', 'epic'],
  ['havana', 'Гавана', 'Havana Brown', 'epic'],
  ['ojos_azules', 'Охос азулес', 'Ojos Azules', 'epic'],

  // --- Tier 5 — Легендарные ---
  ['savannah', 'Саванна', 'Savannah', 'legendary'],
  ['caracat', 'Каракет', 'Caracat', 'legendary'],
  ['ashera', 'Ашера', 'Ashera', 'legendary'],
  ['dwelf', 'Двэльф', 'Dwelf', 'legendary'],
  ['serengeti', 'Серенгети', 'Serengeti', 'legendary'],
  ['cheetoh', 'Чито', 'Cheetoh', 'legendary'],
  ['safari', 'Сафари', 'Safari', 'legendary'],
  ['california_spangled', 'Калифорнийская сияющая', 'California Spangled', 'legendary'],
  ['khao_manee_diamond', 'Као-мани «Алмаз»', 'Khao Manee "Diamond"', 'legendary'],
  ['lykoi_elf', 'Ликой-эльф', 'Lykoi Elf', 'legendary'],
];

export const BREEDS: readonly BreedDef[] = RAW.map(([key, ru, en, tier]) => ({
  key, name: [ru, en] as LocStr, tier, kind: tier === 'common' ? 'base' : 'breed',
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
  const def = BREED_BY_KEY[key];
  return def ? tx(def.name) : key;
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
  luckyUp?: boolean; // 🍀 из исходов вычёркиваются серые (T1): родится цветной (T2+)
  noDown?: boolean;  // 🛡 котёнок не опустится ниже старшего родителя
  degrade?: boolean; // ⬇ из исходов вычёркиваются цветные (T2+): родится серый дворовый
}
