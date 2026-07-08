/**
 * Родословная кота: дерево предков (родители → деды → прадеды) с УНИКАЛЬНЫМИ id.
 * Сохраняется на коте при рождении (cat.pedigree). По совпадению id в деревьях
 * пары определяется родство (инбридинг, kinship.ts). Чистые функции — тестируемо.
 *
 * Глубина дерева ограничена (см. PEDIGREE_DEPTH), поэтому сейв не растёт бесконечно:
 * каждый новорождённый копирует уже усечённые родословные родителей.
 *
 * У стартовых/купленных дворовых родословная генерируется случайно
 * (hiddenPedigree) — «лотерея скрытых генов»: породы предков дают материал для
 * родословных рецептов, а уникальные id исключают ложные совпадения родства.
 */

import type { Rng, RarityTier } from '../genetics/index.js';
import { BREEDS_BY_TIER, LEVEL_TIER } from '../genetics/index.js';
import type { Cat, Ancestor, GameState } from './types.js';
import { HIDDEN_GENE_TIER_WEIGHTS, PEDIGREE_DEPTH } from './config.js';

/** Усекает поддерево предков глубиной depth (1 — только сам узел). */
function trimAncestor(a: Ancestor, depth: number): Ancestor {
  const node: Ancestor = { id: a.id, breed: a.breed };
  if (depth > 1) {
    if (a.mother) node.mother = trimAncestor(a.mother, depth - 1);
    if (a.father) node.father = trimAncestor(a.father, depth - 1);
  }
  return node;
}

/** Узел-предок для кота: его id и порода + его родословная (до depth уровней вглубь). */
function ancestorOf(cat: Cat, depth: number): Ancestor {
  const node: Ancestor = { id: cat.id, breed: cat.breed };
  if (depth > 1) {
    const ped = catAncestors(cat);
    if (ped.mother) node.mother = trimAncestor(ped.mother, depth - 1);
    if (ped.father) node.father = trimAncestor(ped.father, depth - 1);
  }
  return node;
}

/**
 * Родословная кота для отображения/построения: { mother?, father? }.
 * Берёт сохранённое дерево cat.pedigree; для котов без него строит один уровень
 * из legacy-полей motherBreed/fatherBreed (id синтетические — родство не ловится).
 */
export function catAncestors(cat: Cat): { mother?: Ancestor; father?: Ancestor } {
  if (cat.pedigree && (cat.pedigree.mother || cat.pedigree.father)) return cat.pedigree;
  const out: { mother?: Ancestor; father?: Ancestor } = {};
  if (cat.motherBreed) out.mother = { id: cat.id + '~m', breed: cat.motherBreed };
  if (cat.fatherBreed) out.father = { id: cat.id + '~f', breed: cat.fatherBreed };
  return out;
}

/** Дерево предков новорождённого от пары родителей (глубина depth поколений). */
export function buildPedigree(
  mother: Cat, father: Cat, depth: number,
): { mother: Ancestor; father: Ancestor } {
  return {
    mother: ancestorOf(mother, depth),
    father: ancestorOf(father, depth),
  };
}

/** Сколько поколений предков реально известно (0 — родословной нет, 1 — только родители). */
export function pedigreeDepth(cat: Cat): number {
  const depthOf = (a: Ancestor | undefined): number =>
    a ? 1 + Math.max(depthOf(a.mother), depthOf(a.father)) : 0;
  const ped = catAncestors(cat);
  return Math.max(depthOf(ped.mother), depthOf(ped.father));
}

// --- Скрытая родословная стартовых котов ---

/** Случайная порода скрытого предка по весам тиров (T5 не выпадает). */
function hiddenBreed(rng: Rng): string {
  let r = rng();
  for (const tier of LEVEL_TIER) {
    const w = HIDDEN_GENE_TIER_WEIGHTS[tier as RarityTier];
    if (r < w) {
      const list = BREEDS_BY_TIER[tier as RarityTier];
      return list[Math.floor(rng() * list.length)]!.key;
    }
    r -= w;
  }
  return 'moggie';
}

function hiddenNode(state: GameState, rng: Rng, depth: number): Ancestor {
  const node: Ancestor = { id: 'anc' + state.nextId++, breed: hiddenBreed(rng) };
  if (depth > 1) {
    node.mother = hiddenNode(state, rng, depth - 1);
    node.father = hiddenNode(state, rng, depth - 1);
  }
  return node;
}

/**
 * Прописывает коту случайную скрытую родословную (полное дерево до прадедов).
 * Вызывается для стартовых и купленных котов. Мутирует state.nextId — id
 * предков уникальны на всю игру, ложных совпадений родства не бывает.
 */
export function attachHiddenPedigree(state: GameState, cat: Cat, rng: Rng): void {
  cat.pedigree = {
    mother: hiddenNode(state, rng, PEDIGREE_DEPTH),
    father: hiddenNode(state, rng, PEDIGREE_DEPTH),
  };
}
