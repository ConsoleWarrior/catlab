/**
 * Человекочитаемые (RU) описания котов и требований заказов для UI.
 * Идентичность кота теперь — ПОРОДА из каталога + пол; редкость — тир породы.
 */

import { breedName } from '../genetics/index.js';
import type { Cat, OrderReq } from '../game/index.js';
import { pedigreeBonus } from '../game/index.js';
import { TIER_RU } from './theme.js';

const PATTERN_RU: Record<string, string> = {
  ticked: 'тикированный', spotted: 'пятнистый', mackerel: 'тигровый',
  classic: 'мраморный', solid: 'сплошной',
};
const COLOR_RU: Record<string, string> = {
  black: 'чёрный', blue: 'голубой', chocolate: 'шоколадный', lilac: 'лиловый',
  cinnamon: 'циннамон', fawn: 'фавн', red: 'рыжий', cream: 'кремовый',
  white: 'белый', tortoiseshell: 'черепаховый', 'blue-cream': 'голубо-кремовый',
};

function colorRu(name: string): string { return COLOR_RU[name] ?? name; }

/** Короткая строка-облик кота (для карточек/меню). */
export function describeCat(cat: Cat): string {
  const sex = cat.genotype.sex === 'female' ? '♀' : '♂';
  return `${breedName(cat.breed)} ${sex} · ${TIER_RU[cat.rarityTier]}`;
}

/** Детальные строки облика кота (для меню). Редкость показывают цветные звёзды. */
export function catTraits(cat: Cat): string[] {
  const sex = cat.genotype.sex === 'female' ? 'пол: самка ♀' : 'пол: самец ♂';
  const lines = [sex, `порода: ${breedName(cat.breed)}`];
  if (cat.motherBreed && cat.fatherBreed) {
    lines.push(`родители: ${breedName(cat.motherBreed)} ♀ × ${breedName(cat.fatherBreed)} ♂`);
    const bonus = pedigreeBonus(cat);
    if (bonus > 0) {
      lines.push(`родословная: +${Math.round(bonus * 100)}% к шансу редкого потомства`);
    }
  }
  return lines;
}

/** Требования заказа одной строкой. */
export function describeReq(req: OrderReq): string {
  const parts: string[] = [];
  if (req.breed) parts.push(breedName(req.breed));
  if (req.minRarity) parts.push(`от «${TIER_RU[req.minRarity]}»`);
  if (req.baseColor) parts.push(colorRu(req.baseColor));
  if (req.pattern) parts.push(PATTERN_RU[req.pattern] ?? req.pattern);
  return parts.length ? parts.join(', ') : 'любой котик';
}
