/**
 * Ценностный множитель породы ВНУТРИ её тира — «раскидывает» цену по всем породам.
 *
 * Тир задаёт базовый порядок величины (см. game/config TIER_MARKET_VALUE), а этот
 * множитель уточняет цену конкретной породы относительно соседей по тиру: чем
 * сложнее её вывести (ниже шанс рецепта + условия родословной/инбридинга/фенотипа),
 * тем она дороже. Базовые породы без рецепта (moggie) → минимум диапазона.
 *
 * Значение нормируется в [VALUE_MULT_MIN..VALUE_MULT_MAX] ОТДЕЛЬНО в каждом тире,
 * поэтому «средняя» порода тира ≈ середина диапазона, а самая труднокрафтовая —
 * заметно дороже. Чистая функция + мемоизация (таблица рецептов статична).
 */

import type { RarityTier } from './types.js';
import { BREEDS } from './catalog.js';
import { RECIPES, isPedigreeRecipe, KINSHIP_RANK } from './recipes.js';
import type { Recipe } from './recipes.js';

export const VALUE_MULT_MIN = 0.8;
export const VALUE_MULT_MAX = 1.6;

/** «Сложность» одного рецепта: чем ниже шанс и больше условий — тем выше. */
function recipeDifficulty(r: Recipe): number {
  let d = 1 - r.chance;                              // низкий шанс → сложнее
  if (isPedigreeRecipe(r)) d += 0.15;                // требует скрытых генов в родословной
  if (r.minKinship) d += 0.15 * KINSHIP_RANK[r.minKinship]; // требует инбридинга (риск здоровья)
  if (r.colorBoth || r.tabbyBoth) d += 0.05;         // фенотипическое условие обоих родителей
  return d;
}

/** Сырой «скор сложности» породы = самый ЛЁГКИЙ способ её получить. */
function rawScore(breed: string): number {
  const rs = RECIPES.filter((r) => r.result === breed);
  if (rs.length === 0) return 0; // базовая порода / без рецепта — минимум
  return Math.min(...rs.map(recipeDifficulty));
}

/** Множитель ценности каждой породы, нормированный внутри её тира. */
const MULT: Record<string, number> = (() => {
  const byTier: Record<RarityTier, string[]> = {
    common: [], uncommon: [], rare: [], epic: [], legendary: [],
  };
  for (const b of BREEDS) byTier[b.tier].push(b.key);

  const out: Record<string, number> = {};
  for (const keys of Object.values(byTier)) {
    if (keys.length === 0) continue;
    const scores = keys.map(rawScore);
    const min = Math.min(...scores);
    const max = Math.max(...scores);
    for (let i = 0; i < keys.length; i++) {
      const t = max > min ? (scores[i]! - min) / (max - min) : 0.5;
      out[keys[i]!] = VALUE_MULT_MIN + (VALUE_MULT_MAX - VALUE_MULT_MIN) * t;
    }
  }
  return out;
})();

/** Множитель ценности породы внутри её тира (1.0 для неизвестных ключей). */
export function breedValueMult(breed: string): number {
  return MULT[breed] ?? 1;
}
