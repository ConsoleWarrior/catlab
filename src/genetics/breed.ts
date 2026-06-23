/**
 * Движок наследования: скрещивание двух котов → генотип потомка.
 * Менделевское расщепление + сцепление с полом для рыжего (O) + мутации.
 * См. GENETICS.md §1, §3.
 */

import type {
  Genotype, GenePair, OAllele, BAllele, DAllele, AAllele, TAllele,
  SAllele, WAllele, CAllele, LAllele, EaAllele, FcAllele, EyAllele,
} from './types.js';
import { type Rng, pick } from './random.js';
import { ALLELE_FREQ } from './loci.js';

/** Случайно выбирает один из двух аллелей пары (вклад родителя в гамету). */
function gamete<T extends string>(pair: GenePair<T>, rng: Rng): T {
  return rng() < 0.5 ? pair[0] : pair[1];
}

/** Возможные мутации аллеля внутри локуса (любой другой аллель того же локуса). */
function maybeMutate<T extends string>(
  allele: T, locus: string, rng: Rng, rate: number,
): T {
  if (rate <= 0 || rng() >= rate) return allele;
  const alts = Object.keys(ALLELE_FREQ[locus] ?? {}).filter(
    (a) => a !== allele && a !== 'Y',
  ) as T[];
  return alts.length > 0 ? pick(rng, alts) : allele;
}

/** Наследование одного аутосомного локуса: по аллелю от каждого родителя (+мутации). */
function inherit<T extends string>(
  mom: GenePair<T>, dad: GenePair<T>, locus: string, rng: Rng, mut: number,
): GenePair<T> {
  return [
    maybeMutate(gamete(mom, rng), locus, rng, mut),
    maybeMutate(gamete(dad, rng), locus, rng, mut),
  ];
}

export interface BreedResult {
  child: Genotype;
}

/**
 * Скрещивает мать (female) и отца (male). Пол потомка определяется тем,
 * какую половую хромосому передал отец (X → дочь, Y → сын) — это и даёт
 * сцепление рыжего гена с полом (черепаховые почти всегда самки).
 *
 * @param mutationRate шанс мутации на каждый переданный аллель (0 = выкл).
 */
export function breed(
  mother: Genotype,
  father: Genotype,
  rng: Rng,
  mutationRate = 0,
): Genotype {
  if (mother.sex !== 'female') throw new Error('breed: первый родитель должен быть female');
  if (father.sex !== 'male') throw new Error('breed: второй родитель должен быть male');

  const mut = mutationRate;

  // --- Рыжий (O), сцеплен с полом ---
  // Мать (XX) передаёт одну из своих X-несомых O-аллелей.
  const momO = maybeMutate(gamete(mother.O, rng), 'O', rng, mut) as OAllele;
  // Отец передаёт либо свою X (O-аллель в позиции 0), либо Y.
  const fatherGivesX = rng() < 0.5;
  const sex = fatherGivesX ? 'female' : 'male';
  const dadO: OAllele = fatherGivesX
    ? (maybeMutate(father.O[0], 'O', rng, mut) as OAllele)
    : 'Y';
  const O: GenePair<OAllele> = [momO, dadO];

  const child: Genotype = {
    sex,
    O,
    B: inherit<BAllele>(mother.B, father.B, 'B', rng, mut),
    D: inherit<DAllele>(mother.D, father.D, 'D', rng, mut),
    A: inherit<AAllele>(mother.A, father.A, 'A', rng, mut),
    T: inherit<TAllele>(mother.T, father.T, 'T', rng, mut),
    S: inherit<SAllele>(mother.S, father.S, 'S', rng, mut),
    W: inherit<WAllele>(mother.W, father.W, 'W', rng, mut),
    C: inherit<CAllele>(mother.C, father.C, 'C', rng, mut),
    L: inherit<LAllele>(mother.L, father.L, 'L', rng, mut),
    Ea: inherit<EaAllele>(mother.Ea, father.Ea, 'Ea', rng, mut),
    Fc: inherit<FcAllele>(mother.Fc, father.Fc, 'Fc', rng, mut),
    Ey: inherit<EyAllele>(mother.Ey, father.Ey, 'Ey', rng, mut),
  };

  return child;
}

/**
 * Жизнеспособность потомка. Двойная вислоухость (fold/fold) даёт тяжёлые
 * проблемы со скелетом — в игре такой котёнок нежизнеспособен. См. GENETICS.md §3.
 */
export function isLethal(g: Genotype): boolean {
  return g.Ea[0] === 'fold' && g.Ea[1] === 'fold';
}
