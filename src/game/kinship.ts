/**
 * Родство пары (инбридинг) по УНИКАЛЬНЫМ id предков в родословных.
 *
 * Перед вязкой сравниваем деревья pedigree матери и отца (до прадедов) и считаем
 * коэффициент родства r: за каждый общий id — вклад 0.5^(genA+genB), где gen —
 * поколение предка в дереве (1 = родители, 2 = деды, 3 = прадеды); сам партнёр,
 * найденный в дереве другого, считается с gen 0. Примеры:
 *   мать — родитель отца:            r = 0.5^(0+1) = 0.5      → critical
 *   брат × сестра (общие родители):  r = 2 × 0.5^(1+1) = 0.5  → critical
 *   дед × внучка:                    r = 0.5^(0+2) = 0.25     → high
 *   дядя × племянница:               r = 2 × 0.5^(1+2) = 0.25 → high
 *   двоюродные (общие деды):         r = 2 × 0.5^(2+2) = 0.125 → moderate
 *   один общий прадед:               r ≈ 0.016                 → moderate
 *
 * Уровень родства: множит шанс родословных рецептов (recipes.ts) и решает
 * бросок здоровья котёнка (rollKittenHearts) — риск ↔ награда инбридинга.
 */

import { expressPhenotype, tierOfBreed, carriedTraitSet } from '../genetics/index.js';
import type { KinshipLevel, BreedSide, BreedingContext, RarityTier } from '../genetics/index.js';
import type { Cat, Ancestor } from './types.js';
import * as C from './config.js';
import { catAncestors } from './pedigree.js';

/** id → минимальное поколение предка в дереве кота (1 = родители … 3 = прадеды). */
export function ancestorGens(cat: Cat): Map<string, number> {
  const out = new Map<string, number>();
  const walk = (a: Ancestor | undefined, gen: number): void => {
    if (!a) return;
    const prev = out.get(a.id);
    if (prev === undefined || gen < prev) out.set(a.id, gen);
    walk(a.mother, gen + 1);
    walk(a.father, gen + 1);
  };
  const ped = catAncestors(cat);
  walk(ped.mother, 1);
  walk(ped.father, 1);
  return out;
}

/** Коэффициент родства пары (0 — не родственники). */
export function relatedness(mother: Cat, father: Cat): number {
  const A = ancestorGens(mother);
  const B = ancestorGens(father);
  let r = 0;
  // сам партнёр в дереве другого (родитель×ребёнок, дед×внучка)
  const gm = B.get(mother.id);
  if (gm !== undefined) r += 0.5 ** gm;
  const gf = A.get(father.id);
  if (gf !== undefined) r += 0.5 ** gf;
  // общие предки в обоих деревьях
  for (const [id, ga] of A) {
    const gb = B.get(id);
    if (gb !== undefined) r += 0.5 ** (ga + gb);
  }
  return r;
}

/** Уровень родства пары по порогам конфига. */
export function kinshipLevel(mother: Cat, father: Cat): KinshipLevel {
  const r = relatedness(mother, father);
  if (r >= C.KINSHIP_CRITICAL_R) return 'critical';
  if (r >= C.KINSHIP_HIGH_R) return 'high';
  if (r >= C.KINSHIP_MODERATE_R) return 'moderate';
  return 'none';
}

/**
 * Бросок здоровья новорождённого по уровню родства родителей: интервалы одного
 * броска из C.KINSHIP_HEALTH, иначе полный запас MAX_HEARTS. 0 — «Бесплодный».
 * `safety` (0..0.5, исследование «Генетические маркеры») пропорционально уменьшает
 * вероятность каждого негативного исхода — риск сжимается к MAX_HEARTS.
 */
export function rollKittenHearts(kinship: KinshipLevel, rng: () => number, safety = 0): number {
  const risks = C.KINSHIP_HEALTH[kinship];
  if (risks.length === 0) return C.MAX_HEARTS;
  const factor = Math.max(0, 1 - safety);
  let r = rng();
  for (const { p, hearts } of risks) {
    const pp = p * factor;
    if (r < pp) return hearts;
    r -= pp;
  }
  return C.MAX_HEARTS;
}

// --- Контекст пары для движка рецептов ---

/** Породы всех предков кота (без самого кота). */
export function ancestorBreedList(cat: Cat): string[] {
  const out: string[] = [];
  const walk = (a: Ancestor | undefined): void => {
    if (!a) return;
    out.push(a.breed);
    walk(a.mother);
    walk(a.father);
  };
  const ped = catAncestors(cat);
  walk(ped.mother);
  walk(ped.father);
  return out;
}

/** «Чистая линия»: родословная известна (оба родителя) и в ней нет дворовых (T1). */
export function isPureLine(cat: Cat): boolean {
  const ped = catAncestors(cat);
  if (!ped.mother || !ped.father) return false;
  return ancestorBreedList(cat).every((b) => tierOfBreed(b) !== 'common');
}

function sideOf(cat: Cat): BreedSide {
  const phen = expressPhenotype(cat.genotype);
  const ancestors = ancestorBreedList(cat);
  return {
    breed: cat.breed,
    ancestorBreeds: new Set(ancestors),
    traits: carriedTraitSet(cat.breed, ancestors),
    pureLine: isPureLine(cat),
    baseColor: phen.baseColor,
    tabby: phen.pattern !== null,
  };
}

/** Собирает BreedingContext пары для resolveBreeding (рецепты + инбридинг). */
export function buildBreedingContext(mother: Cat, father: Cat): BreedingContext {
  const kinship = kinshipLevel(mother, father);
  const allBreeds = [...ancestorBreedList(mother), ...ancestorBreedList(father)];
  const counts = new Map<string, number>();
  for (const b of allBreeds) counts.set(b, (counts.get(b) ?? 0) + 1);
  // «разные породы тиров» считаем по родителям И предкам — паре в зачёт идут и они сами
  const distinctPool = new Set([mother.breed, father.breed, ...allBreeds]);
  return {
    mother: sideOf(mother),
    father: sideOf(father),
    kinship,
    ancestorCount: (breed: string) => counts.get(breed) ?? 0,
    distinctOfTiers: (tiers: readonly RarityTier[]) => {
      let n = 0;
      for (const b of distinctPool) if (tiers.includes(tierOfBreed(b))) n++;
      return n;
    },
  };
}

/** RU-подписи уровней родства (инкубатор, карточка рождения). */
export const KINSHIP_RU: Record<KinshipLevel, string> = {
  none: '',
  moderate: 'умеренное',
  high: 'высокое',
  critical: 'критическое',
};
