import { describe, it, expect } from 'vitest';
import { BREEDS } from './catalog.js';
import { breedValueMult } from './breedValue.js';
import { breedLevel, breedsAtLevel, BREED_LEVELS } from './breedLevel.js';

describe('скрытый уровень породы', () => {
  it('каждая порода каталога получает уровень 1..10', () => {
    for (const b of BREEDS) {
      const l = breedLevel(b.key);
      expect(l).toBeGreaterThanOrEqual(1);
      expect(l).toBeLessThanOrEqual(BREED_LEVELS);
    }
  });

  it('группы ровные: 70 пород → по 7 на уровень', () => {
    let total = 0;
    for (let l = 1; l <= BREED_LEVELS; l++) {
      const n = breedsAtLevel(l).length;
      expect(n).toBe(BREEDS.length / BREED_LEVELS);
      total += n;
    }
    expect(total).toBe(BREEDS.length);
  });

  it('уровень монотонен по тиру: дворовый в начале, легендарные — в конце', () => {
    expect(breedLevel('moggie')).toBe(1);
    for (const b of BREEDS) {
      if (b.tier === 'legendary') expect(breedLevel(b.key)).toBeGreaterThanOrEqual(9);
      if (b.tier === 'common') expect(breedLevel(b.key)).toBe(1);
    }
  });

  it('внутри одного тира порядок задаёт множитель ценности', () => {
    for (const a of BREEDS) {
      for (const b of BREEDS) {
        if (a.tier !== b.tier) continue;
        if (breedValueMult(a.key) > breedValueMult(b.key)) {
          expect(breedLevel(a.key)).toBeGreaterThanOrEqual(breedLevel(b.key));
        }
      }
    }
  });

  it('неизвестный ключ не роняет шкалу', () => {
    expect(breedLevel('нет-такой-породы')).toBe(1);
  });
});
