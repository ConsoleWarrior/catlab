import { describe, it, expect } from 'vitest';
import { BREEDS, BREED_BY_KEY } from './catalog.js';
import {
  TRAITS, TRAIT_BY_ID, BREED_GENES, BREED_LOOK, breedTraits, lookOf,
  carriedTraitSet, dormantTraits, sortTraits,
  COLOR_INFO, PATTERN_INFO, EYE_INFO,
} from './traits.js';
import type { TraitId } from './traits.js';

describe('словарь наследуемых генов', () => {
  it('id генов уникальны и совпадают с TRAIT_BY_ID', () => {
    const ids = TRAITS.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const t of TRAITS) expect(TRAIT_BY_ID[t.id]).toBe(t);
  });

  it('гены — только строение (нет окрасов/глаз)', () => {
    const groups = new Set(TRAITS.map((t) => t.group));
    expect(groups).toEqual(new Set(['length', 'texture', 'ears', 'body', 'signature']));
    expect(TRAITS).toHaveLength(14);
  });
});

describe('раскладка генов BREED_GENES', () => {
  it('у каждой породы каталога есть запись', () => {
    for (const b of BREEDS) {
      expect(BREED_GENES[b.key], b.key).toBeDefined();
    }
  });

  it('нет лишних ключей, все гены валидны и без дублей', () => {
    for (const [key, ids] of Object.entries(BREED_GENES)) {
      expect(BREED_BY_KEY[key], key).toBeDefined();
      for (const id of ids) expect(TRAIT_BY_ID[id], `${key}:${id}`).toBeDefined();
      expect(new Set(ids).size, `${key}: дубли генов`).toBe(ids.length);
    }
  });

  it('у каждой породы (кроме лысых и дворового) есть ген длины шерсти', () => {
    const lengths: TraitId[] = ['shorthair', 'longhair', 'hairless'];
    for (const b of BREEDS) {
      if (b.key === 'moggie') continue;
      const has = breedTraits(b.key).some((id) => lengths.includes(id));
      expect(has, `${b.key}: нет гена длины шерсти`).toBe(true);
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

describe('облик по полу BREED_LOOK', () => {
  it('у всех пород кроме дворового есть облик кота и кошки', () => {
    for (const b of BREEDS) {
      if (b.key === 'moggie') { expect(BREED_LOOK[b.key]).toBeUndefined(); continue; }
      const look = BREED_LOOK[b.key];
      expect(look, b.key).toBeDefined();
      expect(look!.male, `${b.key}.male`).toBeDefined();
      expect(look!.female, `${b.key}.female`).toBeDefined();
    }
  });

  it('все окрасы/рисунки/глаза облика валидны', () => {
    for (const [key, { male, female }] of Object.entries(BREED_LOOK)) {
      for (const look of [male, female]) {
        expect(COLOR_INFO[look.color], `${key}:${look.color}`).toBeDefined();
        if (look.pattern) expect(PATTERN_INFO[look.pattern], `${key}:${look.pattern}`).toBeDefined();
        if (look.eyes) expect(EYE_INFO[look.eyes], `${key}:${look.eyes}`).toBeDefined();
      }
    }
  });

  it('lookOf возвращает облик нужного пола, у дворового — undefined', () => {
    expect(lookOf('maine_coon', 'male')!.color).toBe('red');
    expect(lookOf('maine_coon', 'female')!.color).toBe('black');
    expect(lookOf('moggie', 'male')).toBeUndefined();
  });

  it('черепаховый/ми-кэ — только у самок (генетика)', () => {
    for (const { male } of Object.values(BREED_LOOK)) {
      expect(['tortoiseshell', 'calico']).not.toContain(male.color);
    }
    // а у некоторых самок он есть
    expect(lookOf('domestic_shorthair', 'female')!.color).toBe('tortoiseshell');
  });

  it('сигнатурный рисунок в облике ⇒ такой же ген и одинаков у полов', () => {
    // Пойнт/тикинг/пятна — это гены (rev.4). Если рисунок облика сигнатурный,
    // у породы обязан быть соответствующий ген, и рисунок одинаков у кота и кошки.
    const SIGN = ['colorpoint', 'ticked', 'spotted'];
    for (const [key, { male, female }] of Object.entries(BREED_LOOK)) {
      const genes: readonly string[] = breedTraits(key);
      for (const look of [male, female]) {
        if (look.pattern && SIGN.includes(look.pattern)) {
          expect(genes, `${key}: рисунок ${look.pattern} без гена`).toContain(look.pattern);
          expect(male.pattern, `${key}: сигнатурный рисунок разнится по полу`).toBe(female.pattern);
        }
      }
    }
  });

  it('rev.4: чаузи — тикированный (оба пола), каракет — сплошной', () => {
    expect(breedTraits('chausie')).toContain('ticked');
    expect(lookOf('chausie', 'male')!.pattern).toBe('ticked');
    expect(lookOf('chausie', 'female')!.pattern).toBe('ticked');
    expect(lookOf('caracat', 'male')!.pattern).toBeUndefined();
    expect(lookOf('caracat', 'female')!.pattern).toBeUndefined();
  });
});

describe('наследование генов', () => {
  it('carriedTraitSet = гены породы ∪ гены предков', () => {
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
