import { describe, it, expect } from 'vitest';
import {
  BREEDS, BREED_BY_KEY, BREEDS_BY_TIER, PEDIGREE_BREEDS,
  tierOfBreed, breedName, isBaseBreed,
} from './catalog.js';
import { BREED_DESC, breedDescription } from './breedInfo.js';

describe('каталог пород (70, 5 тиров)', () => {
  it('всего 70 записей: 3 базовых (T1) + 67 пород', () => {
    expect(BREEDS.length).toBe(70);
    expect(PEDIGREE_BREEDS.length).toBe(67);
    expect(tierOfBreed('moggie')).toBe('common');
    expect(isBaseBreed('moggie')).toBe(true);
    expect(isBaseBreed('domestic_shorthair')).toBe(true);
    expect(isBaseBreed('persian')).toBe(false);
    expect(breedName('persian')).toBe('Персидская');
  });

  it('распределение по тирам: 3 / 14 / 22 / 21 / 10', () => {
    expect(BREEDS_BY_TIER.common.length).toBe(3);
    expect(BREEDS_BY_TIER.uncommon.length).toBe(14);
    expect(BREEDS_BY_TIER.rare.length).toBe(22);
    expect(BREEDS_BY_TIER.epic.length).toBe(21);
    expect(BREEDS_BY_TIER.legendary.length).toBe(10);
  });

  it('каждая порода имеет имя, валидный тир и уникальный ключ', () => {
    const keys = new Set<string>();
    for (const b of BREEDS) {
      expect(b.name.length).toBeGreaterThan(0);
      expect(BREED_BY_KEY[b.key]).toBe(b);
      expect(keys.has(b.key)).toBe(false);
      keys.add(b.key);
    }
  });

  it('ключи 30 прежних пород сохранены (арт продолжает работать)', () => {
    const legacy = [
      'persian', 'british_shorthair', 'american_shorthair', 'maine_coon', 'siamese',
      'ragdoll', 'scottish_fold', 'norwegian_forest', 'siberian', 'exotic_shorthair',
      'abyssinian', 'russian_blue', 'birman', 'oriental_shorthair', 'turkish_angora',
      'manx', 'himalayan', 'munchkin', 'somali',
      'sphynx', 'devon_rex', 'cornish_rex', 'burmese', 'tonkinese', 'chartreux', 'ocicat',
      'bengal', 'savannah', 'toyger', 'egyptian_mau',
    ];
    for (const k of legacy) expect(BREED_BY_KEY[k], k).toBeDefined();
  });
});

describe('справки о породах (Котодекс)', () => {
  it('у каждой породы каталога есть непустая справка', () => {
    for (const b of BREEDS) {
      const d = breedDescription(b.key);
      expect(d.length, b.key).toBeGreaterThan(0);
    }
  });

  it('нет лишних ключей в BREED_DESC', () => {
    for (const key of Object.keys(BREED_DESC)) {
      expect(BREED_BY_KEY[key], key).toBeDefined();
    }
  });

  it('незнакомый ключ → пустая строка', () => {
    expect(breedDescription('no_such_breed')).toBe('');
  });
});
