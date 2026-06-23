import { describe, it, expect } from 'vitest';
import { breed, isLethal } from './breed.js';
import { makeCat } from './factory.js';
import { expressPhenotype } from './phenotype.js';
import { makeRng } from './random.js';

describe('breed: базовые правила', () => {
  it('детерминирован при одном seed', () => {
    const mom = makeCat('female');
    const dad = makeCat('male');
    const a = breed(mom, dad, makeRng(42));
    const b = breed(mom, dad, makeRng(42));
    expect(a).toEqual(b);
  });

  it('требует правильный пол родителей', () => {
    expect(() => breed(makeCat('male'), makeCat('male'), makeRng(1))).toThrow();
    expect(() => breed(makeCat('female'), makeCat('female'), makeRng(1))).toThrow();
  });

  it('у самца вторая копия O — это Y, у самки — нет', () => {
    const rng = makeRng(7);
    for (let i = 0; i < 100; i++) {
      const child = breed(makeCat('female'), makeCat('male'), rng);
      if (child.sex === 'male') expect(child.O[1]).toBe('Y');
      else expect(child.O[1]).not.toBe('Y');
    }
  });

  it('без мутаций аллели потомка взяты только у родителей', () => {
    const mom = makeCat('female', { B: ['b', 'b1'], L: ['L', 'l'] });
    const dad = makeCat('male', { B: ['B', 'b'], L: ['l', 'l'] });
    const rng = makeRng(3);
    for (let i = 0; i < 50; i++) {
      const c = breed(mom, dad, rng);
      expect(['b', 'b1']).toContain(c.B[0]); // от матери
      expect(['B', 'b']).toContain(c.B[1]); // от отца
    }
  });
});

describe('breed: сцепление рыжего с полом', () => {
  it('рыжая мать × чёрный отец → дочери черепаховые, сыновья рыжие', () => {
    const mom = makeCat('female', { O: ['O', 'O'] }); // рыжая
    const dad = makeCat('male', { O: ['o', 'Y'] });    // чёрный
    const rng = makeRng(123);
    let daughters = 0, sons = 0;
    for (let i = 0; i < 300; i++) {
      const c = breed(mom, dad, rng);
      const p = expressPhenotype(c);
      if (c.sex === 'female') { daughters++; expect(p.isTortie).toBe(true); }
      else { sons++; expect(p.baseColor).toBe('red'); }
    }
    expect(daughters).toBeGreaterThan(0);
    expect(sons).toBeGreaterThan(0);
  });
});

describe('breed: рецессивное носительство', () => {
  it('два носителя длинной шерсти (Ll) могут дать длинношёрстного (ll)', () => {
    const mom = makeCat('female', { L: ['L', 'l'] });
    const dad = makeCat('male', { L: ['L', 'l'] });
    const rng = makeRng(99);
    let long = 0;
    for (let i = 0; i < 300; i++) {
      if (expressPhenotype(breed(mom, dad, rng)).coatLength === 'long') long++;
    }
    expect(long).toBeGreaterThan(0); // ~25% ожидаемо
  });

  it('LL × ll → все котята короткошёрстные носители (Ll)', () => {
    const mom = makeCat('female', { L: ['L', 'L'] });
    const dad = makeCat('male', { L: ['l', 'l'] });
    const rng = makeRng(5);
    for (let i = 0; i < 50; i++) {
      const c = breed(mom, dad, rng);
      expect(c.L).toContain('L');
      expect(c.L).toContain('l');
      expect(expressPhenotype(c).coatLength).toBe('short');
    }
  });
});

describe('isLethal', () => {
  it('двойная вислоухость (fold/fold) летальна', () => {
    expect(isLethal(makeCat('female', { Ea: ['fold', 'fold'] }))).toBe(true);
    expect(isLethal(makeCat('female', { Ea: ['fold', 'normal'] }))).toBe(false);
    expect(isLethal(makeCat('female'))).toBe(false);
  });
});
