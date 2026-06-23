/**
 * Конфигурация локусов: порядок доминирования и частоты аллелей.
 * Частоты задают «обычность» гена в стартовой популяции и используются
 * для расчёта редкости. См. GENETICS.md §1, §3.
 */

import type {
  BAllele, TAllele, CAllele, EyAllele, EaAllele, GenePair,
} from './types.js';

/** Порядок доминирования: левее = доминантнее. */
export const DOMINANCE = {
  B: ['B', 'b', 'b1'] as const satisfies readonly BAllele[],
  O: ['O', 'o'] as const,
  T: ['Ti', 'Sp', 'Mc', 'mc'] as const satisfies readonly TAllele[],
  C: ['C', 'cb', 'cs', 'c'] as const satisfies readonly CAllele[],
  Ey: ['copper', 'yellow', 'green', 'blue'] as const satisfies readonly EyAllele[],
  Ea: ['fold', 'curl', 'normal'] as const satisfies readonly EaAllele[],
};

/**
 * Возвращает доминантный аллель пары по заданному порядку.
 * Чем меньше индекс в order — тем доминантнее.
 */
export function dominantOf<T extends string>(pair: GenePair<T>, order: readonly T[]): T {
  const i0 = order.indexOf(pair[0]);
  const i1 = order.indexOf(pair[1]);
  return i0 <= i1 ? pair[0] : pair[1];
}

/**
 * Частоты аллелей в стартовой популяции, сгруппированы по локусам
 * (имена аллелей пересекаются между локусами, напр. 'normal' в Ea и Fc).
 */
export const ALLELE_FREQ: Record<string, Record<string, number>> = {
  B: { B: 0.6, b: 0.3, b1: 0.1 },
  O: { O: 0.3, o: 0.7, Y: 1 },
  D: { D: 0.75, d: 0.25 },
  A: { A: 0.7, a: 0.3 },
  T: { Mc: 0.5, mc: 0.3, Sp: 0.15, Ti: 0.05 },
  S: { S: 0.4, s: 0.6 },
  W: { W: 0.03, w: 0.97 },
  C: { C: 0.85, cb: 0.05, cs: 0.08, c: 0.02 },
  L: { L: 0.7, l: 0.3 },
  Ea: { normal: 0.9, fold: 0.07, curl: 0.03 },
  Fc: { normal: 0.7, round: 0.15, wedge: 0.15 },
  Ey: { copper: 0.3, yellow: 0.3, green: 0.3, blue: 0.1 },
};

/** Частота аллеля в конкретном локусе (дефолт 1 для отсутствующих, напр. 'Y'). */
export function freqOf(locus: string, allele: string): number {
  return ALLELE_FREQ[locus]?.[allele] ?? 1;
}
