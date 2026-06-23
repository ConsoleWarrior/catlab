import { describe, it, expect } from 'vitest';
import { randomCat, detectBreed, BREED_PRESETS } from './factory.js';
import { calcRarity } from './rarity.js';
import { makeCat } from './factory.js';
import { makeRng } from './random.js';

describe('randomCat', () => {
  it('самцы имеют Y во второй копии O, самки — нет', () => {
    const rng = makeRng(11);
    for (let i = 0; i < 100; i++) {
      const c = randomCat(rng);
      if (c.sex === 'male') expect(c.O[1]).toBe('Y');
      else expect(c.O).not.toContain('Y');
    }
  });
});

describe('detectBreed: пресеты распознаются', () => {
  it('сиамец → Сиамец', () => {
    expect(detectBreed(BREED_PRESETS['Сиамец']!('male'))).toBe('Сиамец');
  });
  it('перс → Перс', () => {
    expect(detectBreed(BREED_PRESETS['Перс']!('female'))).toBe('Перс');
  });
  it('фолд → Шотландская фолд', () => {
    expect(detectBreed(BREED_PRESETS['Шотландская фолд']!('male'))).toBe('Шотландская фолд');
  });
  it('абиссинец → Абиссинец', () => {
    expect(detectBreed(BREED_PRESETS['Абиссинец']!('female'))).toBe('Абиссинец');
  });
});

describe('calcRarity', () => {
  it('обычный дикий кот — common/uncommon, экзотический — выше', () => {
    const plain = calcRarity(makeCat('male', { A: ['a', 'a'] })); // чёрный солид
    const exotic = calcRarity(makeCat('female', {
      O: ['O', 'o'], D: ['d', 'd'], L: ['l', 'l'], Ea: ['fold', 'normal'], W: ['w', 'w'],
    }));
    expect(plain.score).toBeLessThan(exotic.score);
    expect(['common', 'uncommon']).toContain(plain.tier);
  });

  it('детерминирована', () => {
    const cat = makeCat('female', { O: ['O', 'o'], L: ['l', 'l'] });
    expect(calcRarity(cat)).toEqual(calcRarity(cat));
  });
});
