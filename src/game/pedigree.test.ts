import { describe, it, expect } from 'vitest';
import { makeRng, randomCat } from '../genetics/index.js';
import { createInitialState, makeCatInstance, buildPedigree, catAncestors, pedigreeDepth } from './index.js';
import type { Cat } from './index.js';
import { PEDIGREE_DEPTH } from './config.js';

const rng = makeRng(7);
const s = createInitialState(rng, 0);
/** Кот заданной породы (без родословной), при необходимости — с заранее заданной. */
function mk(breed: string, pedigree?: Cat['pedigree']): Cat {
  const c = makeCatInstance(s, randomCat(rng, 'female'), 0, 'nursery', breed);
  if (pedigree) c.pedigree = pedigree;
  return c;
}

describe('catAncestors (родословная кота)', () => {
  it('у купленного/стартового кота родословной нет', () => {
    const cat = mk('moggie');
    expect(catAncestors(cat)).toEqual({});
    expect(pedigreeDepth(cat)).toBe(0);
  });

  it('legacy-фолбэк: строит один уровень из motherBreed/fatherBreed', () => {
    const cat = mk('moggie');
    cat.motherBreed = 'persian';
    cat.fatherBreed = 'siamese';
    const a = catAncestors(cat);
    expect(a.mother?.breed).toBe('persian');
    expect(a.father?.breed).toBe('siamese');
    expect(a.mother?.mother).toBeUndefined(); // глубже legacy не знает
    expect(pedigreeDepth(cat)).toBe(1);
  });
});

describe('buildPedigree (дерево при рождении)', () => {
  it('1-е поколение: знаем только родителей', () => {
    const mother = mk('abyssinian');
    const father = mk('manx');
    const child = mk('moggie', buildPedigree(mother, father, PEDIGREE_DEPTH));
    expect(child.pedigree?.mother?.breed).toBe('abyssinian');
    expect(child.pedigree?.father?.breed).toBe('manx');
    expect(child.pedigree?.mother?.mother).toBeUndefined();
    expect(pedigreeDepth(child)).toBe(1);
  });

  it('2-е поколение: подтягиваются деды из родословной родителей', () => {
    const gpmm = mk('persian');  // бабушка по матери
    const gpmf = mk('siamese');  // дедушка по матери
    const mother = mk('abyssinian', buildPedigree(gpmm, gpmf, PEDIGREE_DEPTH));
    const father = mk('manx');   // отец без родословной
    const child = mk('moggie', buildPedigree(mother, father, PEDIGREE_DEPTH));
    expect(child.pedigree?.mother?.mother?.breed).toBe('persian');
    expect(child.pedigree?.mother?.father?.breed).toBe('siamese');
    expect(child.pedigree?.father?.mother).toBeUndefined(); // у отца дедов нет
    expect(pedigreeDepth(child)).toBe(2);
  });

  it('глубина усечена до PEDIGREE_DEPTH (прадеды есть, прапрадедов нет)', () => {
    // линейная цепочка по материнской линии на 4 поколения
    const ggg = mk('toyger');
    const g0m = mk('persian', buildPedigree(ggg, mk('somali'), PEDIGREE_DEPTH));
    const g1 = mk('abyssinian', buildPedigree(g0m, mk('birman'), PEDIGREE_DEPTH));
    const g2 = mk('manx', buildPedigree(g1, mk('ocicat'), PEDIGREE_DEPTH));
    const g3 = mk('moggie', buildPedigree(g2, mk('bengal'), PEDIGREE_DEPTH));
    // g3 → g2 → g1 → g0m (3 уровня предков), глубже обрезано
    expect(g3.pedigree?.mother?.breed).toBe('manx');
    expect(g3.pedigree?.mother?.mother?.breed).toBe('abyssinian');
    expect(g3.pedigree?.mother?.mother?.mother?.breed).toBe('persian'); // прадед
    expect(g3.pedigree?.mother?.mother?.mother?.mother).toBeUndefined(); // прапрадед обрезан
    expect(pedigreeDepth(g3)).toBe(PEDIGREE_DEPTH);
  });
});
