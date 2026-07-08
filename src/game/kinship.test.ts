import { describe, it, expect } from 'vitest';
import { makeRng, randomCat } from '../genetics/index.js';
import {
  createInitialState, makeCatInstance, buildPedigree, attachHiddenPedigree,
  relatedness, kinshipLevel, rollKittenHearts, buildBreedingContext,
  startBreeding, collectReady, incubationDuration,
} from './index.js';
import type { Cat } from './index.js';
import { PEDIGREE_DEPTH, MAX_HEARTS } from './config.js';

const rng = makeRng(11);
const s = createInitialState(rng, 0);

function mk(breed: string, sex: 'female' | 'male' = 'female'): Cat {
  return makeCatInstance(s, randomCat(rng, sex), 0, 'nursery', breed);
}

/** Ребёнок пары с настоящей родословной. */
function childOf(mother: Cat, father: Cat, sex: 'female' | 'male' = 'female'): Cat {
  const c = mk('moggie', sex);
  c.pedigree = buildPedigree(mother, father, PEDIGREE_DEPTH);
  return c;
}

describe('kinshipLevel (уровни родства по id предков)', () => {
  const gm = mk('persian');            // бабушка
  const gf = mk('siamese', 'male');    // дед
  const dadY = mk('moggie', 'male');   // «чужой» самец

  it('не родственники → none (в т.ч. со скрытыми родословными)', () => {
    const a = mk('moggie');
    const b = mk('moggie', 'male');
    attachHiddenPedigree(s, a, rng);
    attachHiddenPedigree(s, b, rng);
    expect(relatedness(a, b)).toBe(0);
    expect(kinshipLevel(a, b)).toBe('none');
  });

  it('родитель × ребёнок → critical (r = 0.5)', () => {
    const daughter = childOf(gm, gf);
    expect(relatedness(daughter, gf)).toBeCloseTo(0.5);
    expect(kinshipLevel(daughter, gf)).toBe('critical');
  });

  it('брат × сестра → critical (r = 0.5)', () => {
    const sister = childOf(gm, gf, 'female');
    const brother = childOf(gm, gf, 'male');
    expect(relatedness(sister, brother)).toBeCloseTo(0.5);
    expect(kinshipLevel(sister, brother)).toBe('critical');
  });

  it('дед × внучка → high (r = 0.25)', () => {
    const mom = childOf(gm, gf);
    const granddaughter = childOf(mom, dadY);
    expect(relatedness(granddaughter, gf)).toBeCloseTo(0.25);
    expect(kinshipLevel(granddaughter, gf)).toBe('high');
  });

  it('дядя × племянница → high (r = 0.25)', () => {
    const uncle = childOf(gm, gf, 'male');
    const mom = childOf(gm, gf);           // сестра дяди
    const niece = childOf(mom, dadY);
    expect(relatedness(niece, uncle)).toBeCloseTo(0.25);
    expect(kinshipLevel(niece, uncle)).toBe('high');
  });

  it('двоюродные (общие деды) → moderate (r = 0.125)', () => {
    const sisterA = childOf(gm, gf);
    const brotherB = childOf(gm, gf, 'male');
    const cousin1 = childOf(sisterA, dadY);
    const cousin2 = childOf(mk('moggie'), brotherB, 'male');
    expect(relatedness(cousin1, cousin2)).toBeCloseTo(0.125);
    expect(kinshipLevel(cousin1, cousin2)).toBe('moderate');
  });

  it('один общий прадед → moderate (слабое, но заметное родство)', () => {
    const ggf = mk('bengal', 'male');     // прадед
    // линия 1: ggf → дочь → внучка (у внучки ggf на 2-м уровне... строим до 3-го)
    const line1a = childOf(mk('moggie'), ggf);
    const line1b = childOf(line1a, mk('moggie', 'male'));
    const line1c = childOf(line1b, mk('moggie', 'male')); // ggf — прадед (gen3)
    // линия 2: ggf → сын → внук → правнук
    const line2a = childOf(mk('moggie'), ggf, 'male');
    const line2b = childOf(mk('moggie'), line2a, 'male');
    const line2c = childOf(mk('moggie'), line2b, 'male'); // ggf — прадед (gen3)
    const r = relatedness(line1c, line2c);
    expect(r).toBeGreaterThan(0);
    expect(r).toBeLessThan(0.24);
    expect(kinshipLevel(line1c, line2c)).toBe('moderate');
  });

  it('ложных совпадений нет: у котов позднего поколения от разных линий — none', () => {
    const a = childOf(childOf(gm, gf), dadY);
    const other = childOf(mk('persian'), mk('siamese', 'male'));
    expect(kinshipLevel(a, childOf(other, mk('moggie', 'male'), 'male'))).toBe('none');
  });
});

describe('rollKittenHearts (цена инбридинга)', () => {
  const fixed = (v: number) => () => v;

  it('без родства — всегда полный запас', () => {
    expect(rollKittenHearts('none', fixed(0.0))).toBe(MAX_HEARTS);
    expect(rollKittenHearts('none', fixed(0.99))).toBe(MAX_HEARTS);
  });

  it('critical: 10% → 0 сердец, ещё 50% → 1 сердце, иначе полный запас', () => {
    expect(rollKittenHearts('critical', fixed(0.05))).toBe(0);   // «Бесплодный»
    expect(rollKittenHearts('critical', fixed(0.30))).toBe(1);   // дефект
    expect(rollKittenHearts('critical', fixed(0.59))).toBe(1);
    expect(rollKittenHearts('critical', fixed(0.61))).toBe(MAX_HEARTS);
  });

  it('high: 30% → 3 сердца; moderate: 10% → 4 сердца', () => {
    expect(rollKittenHearts('high', fixed(0.29))).toBe(3);
    expect(rollKittenHearts('high', fixed(0.31))).toBe(MAX_HEARTS);
    expect(rollKittenHearts('moderate', fixed(0.09))).toBe(4);
    expect(rollKittenHearts('moderate', fixed(0.11))).toBe(MAX_HEARTS);
  });
});

describe('интеграция: вязка родственников через инкубатор', () => {
  it('котёнок от брата и сестры получает kinship=critical и рискует сердцами', () => {
    const rng2 = makeRng(77);
    const st = createInitialState(rng2, 0);
    const gm2 = makeCatInstance(st, randomCat(rng2, 'female'), 0, 'nursery', 'persian');
    const gf2 = makeCatInstance(st, randomCat(rng2, 'male'), 0, 'nursery', 'persian');
    const sis = makeCatInstance(st, randomCat(rng2, 'female'), 0, 'nursery', 'persian');
    const bro = makeCatInstance(st, randomCat(rng2, 'male'), 0, 'nursery', 'persian');
    sis.pedigree = buildPedigree(gm2, gf2, PEDIGREE_DEPTH);
    bro.pedigree = buildPedigree(gm2, gf2, PEDIGREE_DEPTH);
    st.cats.push(sis, bro);

    expect(buildBreedingContext(sis, bro).kinship).toBe('critical');

    // прогоняем много вязок: у части котят должно урезаться здоровье
    let reduced = 0;
    let total = 0;
    for (let i = 0; i < 60; i++) {
      sis.breedCount = 0; bro.breedCount = 0; // не даём состариться в тесте
      expect(startBreeding(st, 0, sis.id, bro.id, i * 100_000).ok).toBe(true);
      const events = collectReady(st, i * 100_000 + incubationDuration(st), rng2);
      st.slots[0]!.kittenId = null;
      for (const e of events) {
        if (e.stillborn || !e.kitten) continue;
        total++;
        expect(e.kinship).toBe('critical');
        if (e.kitten.maxHearts < MAX_HEARTS) reduced++;
        expect([0, 1, MAX_HEARTS]).toContain(e.kitten.maxHearts);
      }
    }
    expect(total).toBeGreaterThan(20);
    expect(reduced).toBeGreaterThan(0); // ~60% котят с дефектом — хоть один да будет
  });
});
