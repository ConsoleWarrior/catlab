/**
 * Фабрики генотипов: дикий тип, удобный конструктор, случайный кот,
 * пресеты пород и определение породы по облику. См. GENETICS.md §4.
 */

import type {
  Genotype, GenePair, Sex, OAllele,
} from './types.js';
import type { Rng } from './random.js';
import { ALLELE_FREQ } from './loci.js';
import { expressPhenotype } from './phenotype.js';

/** «Дикий тип» — базовый домашний кот (короткошёрстный чёрный макрель-табби). */
export function wildType(sex: Sex): Genotype {
  const O: GenePair<OAllele> = sex === 'female' ? ['o', 'o'] : ['o', 'Y'];
  return {
    sex,
    O,
    B: ['B', 'B'],
    D: ['D', 'D'],
    A: ['A', 'A'],
    T: ['Mc', 'Mc'],
    S: ['s', 's'],
    W: ['w', 'w'],
    C: ['C', 'C'],
    L: ['L', 'L'],
    Ea: ['normal', 'normal'],
    Fc: ['normal', 'normal'],
    Ey: ['copper', 'copper'],
  };
}

/** Создаёт кота от дикого типа с переопределением отдельных локусов. */
export function makeCat(sex: Sex, overrides: Partial<Omit<Genotype, 'sex'>> = {}): Genotype {
  return { ...wildType(sex), ...overrides };
}

/** Взвешенный выбор аллеля по частотам локуса (исключая Y). */
function weightedAllele(locus: string, rng: Rng): string {
  const freqs = ALLELE_FREQ[locus] ?? {};
  const entries = Object.entries(freqs).filter(([a]) => a !== 'Y');
  const total = entries.reduce((sum, [, f]) => sum + f, 0);
  let r = rng() * total;
  for (const [allele, f] of entries) {
    r -= f;
    if (r <= 0) return allele;
  }
  return entries[entries.length - 1]![0];
}

function samplePair(locus: string, rng: Rng): GenePair<string> {
  return [weightedAllele(locus, rng), weightedAllele(locus, rng)];
}

/** Случайный кот по частотам стартовой популяции. */
export function randomCat(rng: Rng, sex?: Sex): Genotype {
  const s: Sex = sex ?? (rng() < 0.5 ? 'female' : 'male');
  const O: GenePair<OAllele> = s === 'female'
    ? [weightedAllele('O', rng) as OAllele, weightedAllele('O', rng) as OAllele]
    : [weightedAllele('O', rng) as OAllele, 'Y'];
  return {
    sex: s,
    O,
    B: samplePair('B', rng) as Genotype['B'],
    D: samplePair('D', rng) as Genotype['D'],
    A: samplePair('A', rng) as Genotype['A'],
    T: samplePair('T', rng) as Genotype['T'],
    S: samplePair('S', rng) as Genotype['S'],
    W: samplePair('W', rng) as Genotype['W'],
    C: samplePair('C', rng) as Genotype['C'],
    L: samplePair('L', rng) as Genotype['L'],
    Ea: samplePair('Ea', rng) as Genotype['Ea'],
    Fc: samplePair('Fc', rng) as Genotype['Fc'],
    Ey: samplePair('Ey', rng) as Genotype['Ey'],
  };
}

// --- Пресеты пород (узнаваемые наборы генов) ---

export const BREED_PRESETS: Record<string, (sex: Sex) => Genotype> = {
  'Британец голубой': (sex) => makeCat(sex, {
    A: ['a', 'a'], D: ['d', 'd'], Fc: ['round', 'round'], Ey: ['copper', 'copper'],
  }),
  'Сиамец': (sex) => makeCat(sex, {
    C: ['cs', 'cs'], Fc: ['wedge', 'wedge'], A: ['a', 'a'],
  }),
  'Перс': (sex) => makeCat(sex, {
    L: ['l', 'l'], Fc: ['round', 'round'], A: ['a', 'a'],
  }),
  'Мейн-кун': (sex) => makeCat(sex, {
    L: ['l', 'l'], T: ['mc', 'mc'],
  }),
  'Абиссинец': (sex) => makeCat(sex, {
    T: ['Ti', 'Ti'],
  }),
  'Шотландская фолд': (sex) => makeCat(sex, {
    Ea: ['fold', 'normal'], A: ['a', 'a'],
  }),
  'Американский кёрл': (sex) => makeCat(sex, {
    Ea: ['curl', 'normal'],
  }),
};

/** Простое правило-определение породы по облику (иначе «Метис»). */
export function detectBreed(g: Genotype): string {
  const p = expressPhenotype(g);
  if (p.earShape === 'fold') return 'Шотландская фолд';
  if (p.earShape === 'curl') return 'Американский кёрл';
  if (p.pointType === 'colorpoint' && p.faceShape === 'wedge') return 'Сиамец';
  if (p.coatLength === 'long' && p.faceShape === 'round') return 'Перс';
  if (p.coatLength === 'long' && p.pattern !== null) return 'Мейн-кун';
  if (p.pattern === 'ticked' && p.coatLength === 'short' && p.faceShape === 'normal') return 'Абиссинец';
  if (p.faceShape === 'round' && p.coatLength === 'short' && p.pattern === null) return 'Британец';
  return 'Метис';
}
