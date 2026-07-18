/**
 * Человекочитаемые (RU) описания котов и требований заказов для UI.
 * Идентичность кота теперь — ПОРОДА из каталога + пол; редкость — тир породы.
 */

import { breedName, breedTraits, sortTraits, traitTag, lookOf, lookTags } from '../genetics/index.js';
import type { Recipe, SideSpec } from '../genetics/index.js';
import type { Cat, OrderReq } from '../game/index.js';
import { KINSHIP_RU } from '../game/index.js';
import { TIER_RU, TIER_RU_GEN } from './theme.js';

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

/**
 * Видимые признаки кота готовыми подписями: наследуемые гены его породы (визитка)
 * + облик по полу (окрас · рисунок · глаза). У дворового визитки нет — облик случаен.
 */
export function catVisibleTraits(cat: Cat): string[] {
  const genes = sortTraits(breedTraits(cat.breed)).map(traitTag);
  const look = lookOf(cat.breed, cat.genotype.sex);
  return [...genes, ...(look ? lookTags(look) : [])];
}

/** Детальные строки облика кота (для меню). Редкость показывают цветные звёзды. */
export function catTraits(cat: Cat): string[] {
  const sex = cat.genotype.sex === 'female' ? 'пол: самка ♀' : 'пол: самец ♂';
  // порода не дублируется — она уже в заголовке меню кота (единственный потребитель)
  const lines = [sex];
  const vis = catVisibleTraits(cat);
  if (vis.length) lines.push(`признаки: ${vis.join(' · ')}`);
  if (cat.motherBreed && cat.fatherBreed) {
    lines.push(`родители: ${breedName(cat.motherBreed)} ♀ × ${breedName(cat.fatherBreed)} ♂`);
  }
  return lines;
}

/** Вероятность для UI: «35%», совсем мелкие шансы — «<1%». */
export function pct(p: number): string {
  if (p <= 0) return '0%';
  if (p < 0.01) return '<1%';
  return `${Math.round(p * 100)}%`;
}

/** Сторона рецепта: одна порода или «А / Б» (любая из списка). */
function sideRu(s: SideSpec): string {
  return typeof s === 'string' ? breedName(s) : s.map(breedName).join(' / ');
}

/**
 * RU-описание рецепта для Котодекса-рецептурника: строка пары + список доп. условий.
 * Базовый шанс подписывает вызывающая сторона (breedCard/превью) — здесь только условия.
 */
export function describeRecipe(r: Recipe): { pair: string; conds: string[] } {
  const pair = r.sexLinked
    ? `♀ ${sideRu(r.a)} × ♂ ${sideRu(r.b)}`
    : `${sideRu(r.a)} × ${sideRu(r.b)}`;
  const conds: string[] = [];
  if (r.sexLinked) conds.push('строго по полу: мать и отец — как указано');
  if (r.traitAny) conds.push(`скрытый ген: ${traitTag(r.traitAny)} — хотя бы у одного родителя`);
  if (r.traitBoth) conds.push(`скрытый ген: ${traitTag(r.traitBoth)} — у ОБОИХ родителей`);
  if (r.ancestorAny) conds.push(`скрытый ген: предок ${r.ancestorAny.map(breedName).join(' / ')} хотя бы у одного`);
  if (r.ancestorBoth) conds.push(`скрытый ген у ОБОИХ: предок ${r.ancestorBoth.map(breedName).join(' / ')}`);
  if (r.ancestorTotal) conds.push(`суммарно ≥${r.ancestorTotal.count} предков «${breedName(r.ancestorTotal.breed)}» у пары`);
  if (r.distinctTiers) {
    conds.push(`≥${r.distinctTiers.count} разных пород (${r.distinctTiers.tiers.map((t) => TIER_RU[t]).join(' / ')}) среди пары и предков`);
  }
  if (r.pureLine) conds.push('обе родословные чистые — без дворовых кровей');
  if (r.minKinship) conds.push(`нужно родство пары: ${KINSHIP_RU[r.minKinship]} и выше`);
  else if (r.kinshipBoost) conds.push('инбридинг повышает шанс');
  return { pair, conds };
}

/** Требования заказа одной строкой. */
export function describeReq(req: OrderReq): string {
  const parts: string[] = [];
  if (req.breed) parts.push(breedName(req.breed));
  if (req.minRarity) parts.push(`любой кот от ${TIER_RU_GEN[req.minRarity]}`);
  if (req.baseColor) parts.push(colorRu(req.baseColor));
  if (req.pattern) parts.push(PATTERN_RU[req.pattern] ?? req.pattern);
  return parts.length ? parts.join(', ') : 'любой котик';
}
