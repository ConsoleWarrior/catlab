/**
 * Каталог пород-коллекции и прогрессия редкости.
 *
 * В отличие от аллельной генетики (которая по-прежнему живёт рядом и даёт пол,
 * мелкую вариативность и заказы), КОЛЛЕКЦИЯ строится на конечном наборе пород
 * с готовым артом. У каждой породы — тир редкости. Базовый «Дворовый» (moggie) —
 * common, из него вязками постепенно поднимаемся к более редким.
 *
 * Лестница тиров: common(0) → uncommon(1) → rare(2) → epic(3) → legendary(4).
 * Пара одного тира с шансом даёт котёнка тиром ВЫШЕ (одинаковая порода —
 * больший шанс), иначе тот же/ниже. См. GAME.md.
 */

import type { RarityTier } from './types.js';
import type { Rng } from './random.js';
import { pick } from './random.js';

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

// [key, RU-имя, тир]. Базовый moggie — common; 30 пород распределены по тирам:
// uncommon(10) — самые «бытовые», rare(9), epic(7), legendary(4) — дикие/дизайнерские.
const RAW: ReadonlyArray<readonly [string, string, RarityTier]> = [
  ['moggie', 'Дворовый', 'common'],

  ['persian', 'Перс', 'uncommon'],
  ['british_shorthair', 'Британец', 'uncommon'],
  ['american_shorthair', 'Американский короткошёрстный', 'uncommon'],
  ['maine_coon', 'Мейн-кун', 'uncommon'],
  ['siamese', 'Сиамец', 'uncommon'],
  ['ragdoll', 'Рэгдолл', 'uncommon'],
  ['scottish_fold', 'Шотландская вислоухая', 'uncommon'],
  ['norwegian_forest', 'Норвежская лесная', 'uncommon'],
  ['siberian', 'Сибирская', 'uncommon'],
  ['exotic_shorthair', 'Экзот', 'uncommon'],

  ['abyssinian', 'Абиссинец', 'rare'],
  ['russian_blue', 'Русская голубая', 'rare'],
  ['birman', 'Священная бирма', 'rare'],
  ['oriental_shorthair', 'Ориентал', 'rare'],
  ['turkish_angora', 'Турецкая ангора', 'rare'],
  ['manx', 'Мэнкс', 'rare'],
  ['himalayan', 'Гималайская', 'rare'],
  ['munchkin', 'Манчкин', 'rare'],
  ['somali', 'Сомали', 'rare'],

  ['sphynx', 'Сфинкс', 'epic'],
  ['devon_rex', 'Девон-рекс', 'epic'],
  ['cornish_rex', 'Корниш-рекс', 'epic'],
  ['burmese', 'Бурма', 'epic'],
  ['tonkinese', 'Тонкинез', 'epic'],
  ['chartreux', 'Шартрез', 'epic'],
  ['ocicat', 'Оцикет', 'epic'],

  ['bengal', 'Бенгал', 'legendary'],
  ['savannah', 'Саванна', 'legendary'],
  ['toyger', 'Тойгер', 'legendary'],
  ['egyptian_mau', 'Египетский мау', 'legendary'],
];

export const BREEDS: readonly BreedDef[] = RAW.map(([key, name, tier]) => ({
  key, name, tier, kind: key === 'moggie' ? 'base' : 'breed',
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

/** Только настоящие породы (без базового Дворового) — для коллекции/прогресса. */
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

/** Случайная порода нужного уровня (0 → всегда базовый Дворовый). */
function randomBreedOfLevel(level: number, rng: Rng): string {
  const lvl = Math.max(0, Math.min(LEVEL_TIER.length - 1, level));
  if (lvl === 0) return 'moggie';
  const tier = LEVEL_TIER[lvl]!;
  const list = BREEDS_BY_TIER[tier];
  return list.length > 0 ? pick(rng, list).key : 'moggie';
}

/**
 * Усилители вязки («Генная инженерия» Генолаба). Применяются к одному котёнку,
 * заряды тратятся при рождении. Поле `used` (см. breedKitten) сообщает, какие
 * усилители реально повлияли на исход — только их и нужно списывать.
 */
export interface BreedBoosts {
  tierUp?: boolean;  // 🔼 гарантированный тир выше (если есть куда расти)
  luckyUp?: boolean; // 🍀 резко повышенный шанс тира-вверх
  noDown?: boolean;  // 🛡 запрет отката вниз
}

/**
 * Порода котёнка от пары родителей.
 * Родители одного тира T:
 *   — шанс pUp подняться на T+1 (одинаковая порода → больший шанс);
 *   — шанс pDown опуститься на T−1;
 *   — иначе остаться на T (одинаковая порода сохраняется, иначе случайная того тира).
 * Родители разных тиров: чаще ниже, иногда выше — без скачка выше старшего.
 *
 * `boosts` — активные усилители; `used` (опц.) заполняется флагами тех усилителей,
 * что реально применились (для списания зарядов без потери впустую).
 */
export function breedKitten(
  motherBreed: string,
  fatherBreed: string,
  rng: Rng,
  boosts: BreedBoosts = {},
  used?: BreedBoosts,
): string {
  const lm = TIER_LEVEL[tierOfBreed(motherBreed)];
  const lf = TIER_LEVEL[tierOfBreed(fatherBreed)];
  const maxLevel = LEVEL_TIER.length - 1;

  if (lm === lf) {
    const T = lm;
    const sameBreed = motherBreed === fatherBreed && !isBaseBreed(motherBreed);
    const canUp = T < maxLevel;

    // 🔼 Форсаж: гарантированный тир выше, если есть куда расти.
    if (boosts.tierUp && canUp) {
      if (used) used.tierUp = true;
      return randomBreedOfLevel(T + 1, rng);
    }

    let pUp = sameBreed ? 0.45 : 0.25;
    if (boosts.luckyUp && canUp) {               // 🍀 Катализатор: резкий буст шанса вверх
      pUp = Math.max(pUp, 0.85);
      if (used) used.luckyUp = true;
    }
    let pDown = 0.15;
    if (boosts.noDown && T > 0) {                 // 🛡 Стабилизатор: запрет отката вниз
      pDown = 0;
      if (used) used.noDown = true;
    }

    const r = rng();
    if (canUp && r < pUp) return randomBreedOfLevel(T + 1, rng);
    // Полоса отката — ровно [pUp, pUp+pDown): на максимуме «несработавший подъём»
    // уходит в «остаться», а не утекает в откат вниз.
    if (T > 0 && r >= pUp && r < pUp + pDown) return randomBreedOfLevel(T - 1, rng);
    if (sameBreed) return motherBreed;        // сохраняем породу
    return randomBreedOfLevel(T, rng);         // тот же тир, но «открытие» породы
  }

  const lo = Math.min(lm, lf);
  const hi = Math.max(lm, lf);

  // 🔼 Форсаж: гарантируем тир старшего родителя.
  if (boosts.tierUp) {
    if (used) used.tierUp = true;
    return randomBreedOfLevel(hi, rng);
  }
  let pHi = 0.3;
  if (boosts.luckyUp) {                          // 🍀 Катализатор: чаще тир старшего
    pHi = Math.max(pHi, 0.75);
    if (used) used.luckyUp = true;
  }
  // 🛡 Стабилизатор тут не нужен: младший тир и так нижняя граница.
  return randomBreedOfLevel(rng() < pHi ? hi : lo, rng);
}
