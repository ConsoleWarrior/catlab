/**
 * Родословная кота: дерево предков (родители → деды → прадеды).
 * Сохраняется на коте при рождении (cat.pedigree). Чистые функции — тестируемо.
 *
 * Глубина дерева ограничена (см. PEDIGREE_DEPTH), поэтому сейв не растёт бесконечно:
 * каждый новорождённый копирует уже усечённые родословные родителей.
 */

import type { Cat, Ancestor } from './types.js';

/** Усекает поддерево предков глубиной depth (1 — только сам узел). */
function trimAncestor(a: Ancestor, depth: number): Ancestor {
  const node: Ancestor = { breed: a.breed };
  if (depth > 1) {
    if (a.mother) node.mother = trimAncestor(a.mother, depth - 1);
    if (a.father) node.father = trimAncestor(a.father, depth - 1);
  }
  return node;
}

/** Узел-предок для кота: его порода + его родословная (до depth уровней вглубь). */
function ancestorOf(cat: Cat, depth: number): Ancestor {
  const node: Ancestor = { breed: cat.breed };
  if (depth > 1) {
    const ped = catAncestors(cat);
    if (ped.mother) node.mother = trimAncestor(ped.mother, depth - 1);
    if (ped.father) node.father = trimAncestor(ped.father, depth - 1);
  }
  return node;
}

/**
 * Родословная кота для отображения/построения: { mother?, father? }.
 * Берёт сохранённое дерево cat.pedigree; для старых котов (без него) строит
 * один уровень из legacy-полей motherBreed/fatherBreed.
 */
export function catAncestors(cat: Cat): { mother?: Ancestor; father?: Ancestor } {
  if (cat.pedigree && (cat.pedigree.mother || cat.pedigree.father)) return cat.pedigree;
  const out: { mother?: Ancestor; father?: Ancestor } = {};
  if (cat.motherBreed) out.mother = { breed: cat.motherBreed };
  if (cat.fatherBreed) out.father = { breed: cat.fatherBreed };
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
