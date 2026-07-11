import { describe, it, expect } from 'vitest';
import { BREEDS, BREED_BY_KEY } from './catalog.js';
import {
  TRAITS, TRAIT_BY_ID, BREED_TRAITS, breedTraits,
  carriedTraitSet, dormantTraits, sortTraits,
} from './traits.js';
import type { TraitId } from './traits.js';

describe('словарь признаков', () => {
  it('id признаков уникальны и совпадают с TRAIT_BY_ID', () => {
    const ids = TRAITS.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const t of TRAITS) expect(TRAIT_BY_ID[t.id]).toBe(t);
  });
});

describe('раскладка BREED_TRAITS', () => {
  it('у каждой породы каталога есть запись', () => {
    for (const b of BREEDS) {
      expect(BREED_TRAITS[b.key], b.key).toBeDefined();
    }
  });

  it('нет лишних ключей и все признаки валидны', () => {
    for (const [key, ids] of Object.entries(BREED_TRAITS)) {
      expect(BREED_BY_KEY[key], key).toBeDefined();
      for (const id of ids) expect(TRAIT_BY_ID[id], `${key}:${id}`).toBeDefined();
      expect(new Set(ids).size, `${key}: дубли признаков`).toBe(ids.length);
    }
  });

  it('дворовый (moggie) — чистый лист (лотерея скрытых генов)', () => {
    expect(breedTraits('moggie')).toHaveLength(0);
  });

  it('ключевые визитки на месте', () => {
    expect(breedTraits('sphynx')).toContain('hairless');
    expect(breedTraits('persian')).toEqual(expect.arrayContaining(['longhair', 'flat_face']));
    expect(breedTraits('bengal')).toContain('spotted');
    expect(breedTraits('munchkin')).toContain('short_legs');
    expect(breedTraits('scottish_fold')).toContain('folded_ears');
  });
});

describe('признаки кота', () => {
  it('carriedTraitSet = визитка породы ∪ визитки предков', () => {
    const s = carriedTraitSet('moggie', ['siamese', 'munchkin']);
    expect(s.has('colorpoint')).toBe(true); // от сиамского предка
    expect(s.has('short_legs')).toBe(true); // от манчкина-предка
    expect(s.has('hairless')).toBe(false);
  });

  it('dormantTraits исключает то, что уже есть у самой породы', () => {
    // сиамка (colorpoint) с сиамским предком: colorpoint НЕ дремлет (уже проявлен)
    const d = dormantTraits('siamese', ['siamese', 'munchkin']);
    expect(d).not.toContain('colorpoint');
    expect(d).toContain('short_legs'); // от манчкина — дремлет
  });

  it('sortTraits даёт канонический порядок без дублей', () => {
    const ids: TraitId[] = ['spotted', 'longhair', 'longhair', 'colorpoint'];
    expect(sortTraits(ids)).toEqual(['longhair', 'colorpoint', 'spotted']);
  });
});
