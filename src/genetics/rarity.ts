/**
 * Оценка редкости котика по его видимым признакам (фенотипу).
 * Чем больше редких выраженных черт — тем выше score и тир.
 * Player-facing: считается по облику, а не по скрытому носительству. См. GENETICS.md §3.
 */

import type { Genotype, Phenotype, RarityTier } from './types.js';
import { expressPhenotype } from './phenotype.js';

export interface Rarity {
  score: number;
  tier: RarityTier;
}

/** Вклад каждой выраженной черты в редкость. */
function featureScore(p: Phenotype): number {
  let s = 0;

  // цвет / разбавление
  if (p.baseColor === 'chocolate' || p.baseColor === 'lilac') s += 1.5;
  if (p.baseColor === 'cinnamon' || p.baseColor === 'fawn') s += 2.5;
  if (['blue', 'cream', 'lilac', 'fawn', 'blue-cream'].includes(p.baseColor)) s += 1;
  if (p.isTortie) s += 1;

  // колор-пойнт / альбинос
  if (p.pointType === 'colorpoint') s += 1.5;
  if (p.pointType === 'sepia') s += 1.5;
  if (p.pointType === 'mink') s += 2;
  if (p.pointType === 'albino') s += 3;

  // доминантный белый и разные глаза
  if (p.white) s += 3;
  if (p.oddEyed) s += 2;

  // шерсть
  if (p.coatLength === 'long') s += 1;

  // морфология
  if (p.earShape === 'fold') s += 2;
  if (p.earShape === 'curl') s += 2.5;
  if (p.faceShape === 'round') s += 1;
  if (p.faceShape === 'wedge') s += 1;

  // рисунок
  if (p.pattern === 'ticked') s += 1.5;
  if (p.pattern === 'spotted') s += 1;
  if (p.pattern === 'classic') s += 0.5;

  // глаза (голубые/зелёные без пойнта — редки)
  if (!p.pointed && !p.white) {
    if (p.eyeColor === 'blue') s += 1;
    if (p.eyeColor === 'green') s += 0.5;
  }

  // много белого
  if (!p.white && p.whiteAmount > 0.7) s += 0.5;

  return s;
}

function tierOf(score: number): RarityTier {
  if (score < 2) return 'common';
  if (score < 4) return 'uncommon';
  if (score < 6.5) return 'rare';
  if (score < 9.5) return 'epic';
  return 'legendary';
}

export function calcRarity(g: Genotype): Rarity {
  const score = featureScore(expressPhenotype(g));
  return { score: Math.round(score * 100) / 100, tier: tierOf(score) };
}
