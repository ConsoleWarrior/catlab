/**
 * Человекочитаемые (RU) описания котов и требований заказов для UI.
 */

import { expressPhenotype, detectBreed } from '../genetics/index.js';
import type { Cat, OrderReq } from '../game/index.js';
import { TIER_RU } from './theme.js';

const PATTERN_RU: Record<string, string> = {
  ticked: 'тикированный', spotted: 'пятнистый', mackerel: 'тигровый',
  classic: 'мраморный', solid: 'сплошной',
};
const EAR_RU: Record<string, string> = { normal: 'обычные', fold: 'вислоухие', curl: 'кёрл' };
const COAT_RU: Record<string, string> = { short: 'короткая', long: 'длинная' };
const COLOR_RU: Record<string, string> = {
  black: 'чёрный', blue: 'голубой', chocolate: 'шоколадный', lilac: 'лиловый',
  cinnamon: 'циннамон', fawn: 'фавн', red: 'рыжий', cream: 'кремовый',
  white: 'белый', 'albino-white': 'белый (альбинос)',
  tortoiseshell: 'черепаховый', 'blue-cream': 'голубо-кремовый',
};

function colorRu(name: string): string { return COLOR_RU[name] ?? name; }

/** Короткая строка-облик кота (для карточек/меню). */
export function describeCat(cat: Cat): string {
  const p = expressPhenotype(cat.genotype);
  const sex = cat.genotype.sex === 'female' ? '♀' : '♂';
  const color = p.white ? 'белый' : colorRu(p.baseColor) + (p.isTortie ? ' (черепаховый)' : '');
  return `${detectBreed(cat.genotype)} ${sex} · ${color}`;
}

/** Детальные строки облика кота (для меню). */
export function catTraits(cat: Cat): string[] {
  const p = expressPhenotype(cat.genotype);
  return [
    `окрас: ${p.white ? 'белый' : colorRu(p.baseColor)}${p.isTortie ? ' (черепах.)' : ''}`,
    `узор: ${p.pattern ? PATTERN_RU[p.pattern] : 'сплошной'}`,
    `шерсть: ${COAT_RU[p.coatLength]}, уши: ${EAR_RU[p.earShape]}`,
    `глаза: ${p.eyeColor}${p.oddEyed ? ' (разные)' : ''}`,
    p.pointed ? 'колор-пойнт' : '',
  ].filter(Boolean) as string[];
}

/** Требования заказа одной строкой. */
export function describeReq(req: OrderReq): string {
  const parts: string[] = [];
  if (req.breed) parts.push(req.breed);
  if (req.baseColor) parts.push(colorRu(req.baseColor));
  if (req.pattern) parts.push(PATTERN_RU[req.pattern] ?? req.pattern);
  if (req.coatLength) parts.push(`шерсть ${COAT_RU[req.coatLength] ?? req.coatLength}`);
  if (req.earShape) parts.push(`уши ${EAR_RU[req.earShape] ?? req.earShape}`);
  if (req.minRarity) parts.push(`от «${TIER_RU[req.minRarity]}»`);
  return parts.length ? parts.join(', ') : 'любой котик';
}
