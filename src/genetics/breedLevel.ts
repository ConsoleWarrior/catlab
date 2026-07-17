/**
 * Скрытый уровень породы (1..10) — внутренняя шкала прогрессии, игроку не показывается.
 * Нужна, чтобы гейтить заказы уровнем лаборатории: на уровне L клиенты просят породы
 * уровней L и L−1 (см. game/orders.candidates).
 *
 * Ранжирование = «базовая цена породы»: сначала тир (главный порядок величины,
 * TIER_MARKET_VALUE), внутри тира — breedValueMult (сложность вывода). Сравнение
 * лексикографическое по (тир, множитель), а не по произведению: диапазоны цен тиров
 * сейчас не пересекаются, так что результат тот же, но порядок не поедет, если
 * TIER_MARKET_VALUE переставят. Отсюда же и независимость от game/config — genetics
 * не должен импортировать game (иначе цикл).
 *
 * Уровни нарезаются КВАНТИЛЯМИ: отсортированный список делится на BREED_LEVELS равных
 * групп (70 пород → по 7 на уровень). Значит уровень — это «место в очереди», а не
 * порог цены: добавление пород перераспределит уровни, но группы останутся ровными.
 */

import { BREEDS, TIER_LEVEL } from './catalog.js';
import { breedValueMult } from './breedValue.js';

/** Сколько скрытых уровней пород (совпадает с MAX_LEVEL лаборатории — не совпадение). */
export const BREED_LEVELS = 10;

/** Породы, отсортированные по возрастанию базовой цены (тир, затем множитель). */
const RANKED: readonly string[] = [...BREEDS]
  .sort((a, b) =>
    TIER_LEVEL[a.tier] - TIER_LEVEL[b.tier]
    || breedValueMult(a.key) - breedValueMult(b.key)
    || a.key.localeCompare(b.key)) // тай-брейк: порядок детерминирован при равных множителях
  .map((b) => b.key);

const LEVEL: Record<string, number> = (() => {
  const out: Record<string, number> = {};
  for (let i = 0; i < RANKED.length; i++) {
    out[RANKED[i]!] = Math.min(BREED_LEVELS, Math.floor((i * BREED_LEVELS) / RANKED.length) + 1);
  }
  return out;
})();

/** Скрытый уровень породы 1..10 (1 — для неизвестных ключей). */
export function breedLevel(breed: string): number {
  return LEVEL[breed] ?? 1;
}

/** Породы данного скрытого уровня. */
export function breedsAtLevel(level: number): string[] {
  return RANKED.filter((key) => LEVEL[key] === level);
}
