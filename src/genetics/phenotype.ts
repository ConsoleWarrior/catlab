/**
 * Вычисление видимого облика (фенотипа) из генотипа.
 * Порядок шагов важен из-за эпистаза (одни гены перекрывают другие).
 * См. GENETICS.md §2. Функция детерминирована: один геном → один облик.
 */

import type {
  Genotype, Phenotype, BAllele, TabbyPattern, PointType,
} from './types.js';
import { DOMINANCE, dominantOf } from './loci.js';
import { rngForGenotype } from './random.js';

/** Цвет эумеланина (чёрный пигмент) по основному цвету и разбавлению. */
function eumelaninColor(base: BAllele, dilute: boolean): string {
  switch (base) {
    case 'B': return dilute ? 'blue' : 'black';
    case 'b': return dilute ? 'lilac' : 'chocolate';
    case 'b1': return dilute ? 'fawn' : 'cinnamon';
  }
}

/** Цвет феомеланина (рыжий пигмент). */
function pheomelaninColor(dilute: boolean): string {
  return dilute ? 'cream' : 'red';
}

const TABBY_MAP: Record<string, TabbyPattern> = {
  Ti: 'ticked', Sp: 'spotted', Mc: 'mackerel', mc: 'classic',
};

const FACE_SCORE = { round: 1, normal: 0, wedge: -1 } as const;

/** Тип колор-пойнта по паре аллелей C-ряда, либо null (полный цвет). */
function resolvePoint(c0: string, c1: string): PointType | null {
  if (c0 === 'C' || c1 === 'C') return null; // C доминирует — полный цвет
  if (c0 === 'c' && c1 === 'c') return 'albino';
  const set = new Set([c0, c1]);
  if (set.has('cb') && set.has('cs')) return 'mink';
  // эффективный доминантный среди cb > cs > c
  if (set.has('cb')) return 'sepia';
  if (set.has('cs')) return 'colorpoint';
  return 'albino';
}

export function expressPhenotype(g: Genotype): Phenotype {
  const gr = rngForGenotype(g); // детерминированный «рандом» для модификаторов
  // фиксированный порядок выборок:
  const whiteVar = gr();
  const oddEyedRoll = gr();

  const dilute = g.D[0] === 'd' && g.D[1] === 'd';

  // --- Пигмент: рыжий сцеплен с полом ---
  let fullRed: boolean;
  let tortie: boolean;
  if (g.sex === 'female') {
    const oCount = (g.O[0] === 'O' ? 1 : 0) + (g.O[1] === 'O' ? 1 : 0);
    fullRed = oCount === 2;
    tortie = oCount === 1;
  } else {
    fullRed = g.O[0] === 'O';
    tortie = false;
  }
  const redPresent = fullRed || tortie;

  const eumelanin = eumelaninColor(dominantOf(g.B, DOMINANCE.B), dilute);
  const pheo = pheomelaninColor(dilute);

  // --- Шаг 1: доминантный белый перекрывает всё ---
  const white = g.W[0] === 'W' || g.W[1] === 'W';

  // --- Шаг 3: колор-пойнт ---
  const pointType = resolvePoint(g.C[0], g.C[1]);
  const pointed = pointType === 'colorpoint' || pointType === 'mink' || pointType === 'sepia';

  // --- Шаг 2: базовый цвет ---
  let baseColor: string;
  let tortieColors: readonly [string, string] | undefined;
  if (white) {
    baseColor = 'white';
  } else if (pointType === 'albino') {
    baseColor = 'albino-white';
  } else if (fullRed) {
    baseColor = pheo;
  } else if (tortie) {
    baseColor = dilute ? 'blue-cream' : 'tortoiseshell';
    tortieColors = [eumelanin, pheo];
  } else {
    baseColor = eumelanin;
  }

  // --- Шаг 4: рисунок (табби) ---
  const agoutiPresent = g.A[0] === 'A' || g.A[1] === 'A';
  const showTabby = !white && pointType !== 'albino' && (agoutiPresent || redPresent);
  const pattern: TabbyPattern | null = showTabby
    ? TABBY_MAP[dominantOf(g.T, DOMINANCE.T)]!
    : null;

  // --- Шаг 5: белые пятна ---
  let whiteAmount: number;
  if (white) {
    whiteAmount = 1;
  } else {
    const sCount = (g.S[0] === 'S' ? 1 : 0) + (g.S[1] === 'S' ? 1 : 0);
    if (sCount === 0) whiteAmount = 0;
    else if (sCount === 1) whiteAmount = 0.3 + whiteVar * 0.3;       // 0.30..0.60
    else whiteAmount = 0.6 + whiteVar * 0.35;                        // 0.60..0.95
  }

  // --- Шаг 6: шерсть ---
  const coatLength = g.L[0] === 'l' && g.L[1] === 'l' ? 'long' : 'short';

  // --- Шаг 7: морфология ---
  const earShape = dominantOf(g.Ea, DOMINANCE.Ea);
  const faceSum = FACE_SCORE[g.Fc[0]] + FACE_SCORE[g.Fc[1]];
  const faceShape = faceSum >= 1 ? 'round' : faceSum <= -1 ? 'wedge' : 'normal';

  // --- Шаг 8: цвет глаз (с переопределениями) ---
  let eyeColor: string = dominantOf(g.Ey, DOMINANCE.Ey);
  let oddEyed = false;
  if (white) {
    eyeColor = 'blue';
    oddEyed = oddEyedRoll < 0.3;
  } else if (pointType === 'colorpoint') {
    eyeColor = 'blue';
  } else if (pointType === 'mink') {
    eyeColor = 'aqua';
  } else if (pointType === 'albino') {
    eyeColor = 'pale-blue';
  }

  return {
    baseColor,
    ...(tortieColors ? { tortieColors } : {}),
    pattern,
    whiteAmount,
    isTortie: tortie,
    pointed,
    ...(pointType ? { pointType } : {}),
    white,
    coatLength,
    earShape,
    faceShape,
    eyeColor,
    oddEyed,
  };
}
