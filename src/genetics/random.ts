/**
 * Детерминированный ГПСЧ (mulberry32) и стабильный хэш генотипа.
 * Сид нужен, чтобы скрещивания были воспроизводимы (тесты, сохранения, реплеи).
 */

import type { Genotype } from './types.js';

/** Источник случайности: возвращает число [0, 1). */
export type Rng = () => number;

/** Быстрый seedable PRNG. Один и тот же seed → одна и та же последовательность. */
export function makeRng(seed: number): Rng {
  let a = seed >>> 0;
  return function next(): number {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Случайный true с вероятностью p. */
export function chance(rng: Rng, p: number): boolean {
  return rng() < p;
}

/** Случайный элемент массива. */
export function pick<T>(rng: Rng, items: readonly T[]): T {
  const i = Math.floor(rng() * items.length);
  // Защита от граничного rng()===0.9999.. * length === length
  return items[Math.min(i, items.length - 1)]!;
}

/**
 * Стабильный хэш генотипа (FNV-1a по сериализованным аллелям).
 * Используется для детерминированных «фенотипических» модификаторов
 * (степень белого, odd-eyed), чтобы expressPhenotype(g) всегда давал
 * один и тот же облик для одного генома.
 */
export function hashGenotype(g: Genotype): number {
  const parts = [
    g.sex,
    g.B.join(''), g.O.join(''), g.D.join(''), g.A.join(''),
    g.T.join(''), g.S.join(''), g.W.join(''), g.C.join(''),
    g.L.join(''), g.Ea.join(''), g.Fc.join(''), g.Ey.join(''),
  ];
  const str = parts.join('|');
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** Детерминированный rng, привязанный к геному (для фенотипических модификаторов). */
export function rngForGenotype(g: Genotype): Rng {
  return makeRng(hashGenotype(g));
}
