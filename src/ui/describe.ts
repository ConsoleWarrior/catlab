/**
 * Человекочитаемые описания котов и требований заказов для UI (ru + en).
 * Идентичность кота теперь — ПОРОДА из каталога + пол; редкость — тир породы.
 */

import { breedName, breedTraits, sortTraits, traitTag } from '../genetics/index.js';
import type { Recipe, SideSpec } from '../genetics/index.js';
import type { Cat, OrderReq } from '../game/index.js';
import { kinshipName } from '../game/index.js';
import { tierName, tierNameGen } from './theme.js';
import { t, tx, type LocStr } from '../i18n.js';

const PATTERN_NAME: Record<string, LocStr> = {
  ticked: ['тикированный', 'ticked'], spotted: ['пятнистый', 'spotted'],
  mackerel: ['тигровый', 'tabby'], classic: ['мраморный', 'marbled'],
  solid: ['сплошной', 'solid'],
};
const COLOR_NAME: Record<string, LocStr> = {
  black: ['чёрный', 'black'], blue: ['голубой', 'blue'], chocolate: ['шоколадный', 'chocolate'],
  lilac: ['лиловый', 'lilac'], cinnamon: ['циннамон', 'cinnamon'], fawn: ['фавн', 'fawn'],
  red: ['рыжий', 'red'], cream: ['кремовый', 'cream'], white: ['белый', 'white'],
  tortoiseshell: ['черепаховый', 'tortoiseshell'], 'blue-cream': ['голубо-кремовый', 'blue-cream'],
};

function colorName(name: string): string {
  const c = COLOR_NAME[name];
  return c ? tx(c) : name;
}

/** Короткая строка-облик кота (для карточек/меню). */
export function describeCat(cat: Cat): string {
  const sex = cat.genotype.sex === 'female' ? '♀' : '♂';
  return `${breedName(cat.breed)} ${sex} · ${tierName(cat.rarityTier)}`;
}

/**
 * Видимые ПРИЗНАКИ кота готовыми подписями — только наследуемые гены строения его
 * породы (визитка). Их читают рецепты; их же показывает анализ. Облик (окрас ·
 * рисунок · глаза) сюда НЕ входит: он косметика по полу, а спрайты всё равно не
 * совпадают с окрасами. У дворового (moggie) визитки нет — список пуст.
 */
export function catVisibleTraits(cat: Cat): string[] {
  return sortTraits(breedTraits(cat.breed)).map(traitTag);
}

/** Детальные строки признаков кота (для меню). Редкость показывают цветные звёзды. */
export function catTraits(cat: Cat): string[] {
  const sex = cat.genotype.sex === 'female'
    ? t('пол: самка ♀', 'sex: female ♀')
    : t('пол: самец ♂', 'sex: male ♂');
  // порода не дублируется — она уже в заголовке меню кота (единственный потребитель)
  const lines = [sex];
  const vis = catVisibleTraits(cat);
  if (vis.length) lines.push(t(`признаки: ${vis.join(' · ')}`, `traits: ${vis.join(' · ')}`));
  if (cat.motherBreed && cat.fatherBreed) {
    const pair = `${breedName(cat.motherBreed)} ♀ × ${breedName(cat.fatherBreed)} ♂`;
    lines.push(t(`родители: ${pair}`, `parents: ${pair}`));
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
 * Описание рецепта для Котодекса-рецептурника: строка пары + список доп. условий.
 * Базовый шанс подписывает вызывающая сторона (breedCard/превью) — здесь только условия.
 */
export function describeRecipe(r: Recipe): { pair: string; conds: string[] } {
  const pair = r.sexLinked
    ? `♀ ${sideRu(r.a)} × ♂ ${sideRu(r.b)}`
    : `${sideRu(r.a)} × ${sideRu(r.b)}`;
  const conds: string[] = [];
  if (r.sexLinked) conds.push(t('строго по полу: мать и отец — как указано', 'sex matters: mother and father exactly as shown'));
  if (r.traitAny) conds.push(t(`скрытый ген: ${traitTag(r.traitAny)} — хотя бы у одного родителя`, `hidden gene: ${traitTag(r.traitAny)} — in at least one parent`));
  if (r.traitBoth) conds.push(t(`скрытый ген: ${traitTag(r.traitBoth)} — у ОБОИХ родителей`, `hidden gene: ${traitTag(r.traitBoth)} — in BOTH parents`));
  if (r.ancestorAny) {
    const list = r.ancestorAny.map(breedName).join(' / ');
    conds.push(t(`скрытый ген: предок ${list} хотя бы у одного`, `hidden gene: a ${list} ancestor in at least one parent`));
  }
  if (r.ancestorBoth) {
    const list = r.ancestorBoth.map(breedName).join(' / ');
    conds.push(t(`скрытый ген у ОБОИХ: предок ${list}`, `hidden gene in BOTH: a ${list} ancestor`));
  }
  if (r.ancestorTotal) {
    const { count } = r.ancestorTotal;
    const breed = breedName(r.ancestorTotal.breed);
    conds.push(t(`суммарно ≥${count} предков «${breed}» у пары`, `≥${count} ${breed} ancestors between the pair`));
  }
  if (r.distinctTiers) {
    const tiers = r.distinctTiers.tiers.map((x) => tierName(x)).join(' / ');
    const { count } = r.distinctTiers;
    conds.push(t(
      `≥${count} разных пород (${tiers}) среди пары и предков`,
      `≥${count} different breeds (${tiers}) among the pair and their ancestors`,
    ));
  }
  if (r.pureLine) conds.push(t('обе родословные чистые — без дворовых кровей', 'both pedigrees are pure — no moggie blood'));
  if (r.minKinship) {
    conds.push(t(`нужно родство пары: ${kinshipName(r.minKinship)} и выше`, `pair kinship required: ${kinshipName(r.minKinship)} or higher`));
  } else if (r.kinshipBoost) {
    conds.push(t('инбридинг повышает шанс', 'inbreeding raises the chance'));
  }
  return { pair, conds };
}

/** Требования заказа одной строкой. */
export function describeReq(req: OrderReq): string {
  const parts: string[] = [];
  if (req.breed) parts.push(breedName(req.breed));
  if (req.minRarity) {
    parts.push(t(`любой кот от ${tierNameGen(req.minRarity)}`, `any ${tierNameGen(req.minRarity)} cat or better`));
  }
  if (req.baseColor) parts.push(colorName(req.baseColor));
  if (req.pattern) parts.push(PATTERN_NAME[req.pattern] ? tx(PATTERN_NAME[req.pattern]!) : req.pattern);
  return parts.length ? parts.join(', ') : t('любой котик', 'any cat');
}
