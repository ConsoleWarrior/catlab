import { describe, it, expect } from 'vitest';
import { makeRng } from './random.js';
import {
  BREEDS, BREED_BY_KEY, BREEDS_BY_TIER, PEDIGREE_BREEDS, TIER_LEVEL,
  tierOfBreed, breedName, isBaseBreed, breedKitten,
} from './catalog.js';
import type { BreedBoosts } from './catalog.js';

describe('каталог пород', () => {
  it('moggie — базовый common, всего 31 запись (1 база + 30 пород)', () => {
    expect(BREEDS.length).toBe(31);
    expect(PEDIGREE_BREEDS.length).toBe(30);
    expect(tierOfBreed('moggie')).toBe('common');
    expect(isBaseBreed('moggie')).toBe(true);
    expect(isBaseBreed('persian')).toBe(false);
    expect(breedName('persian')).toBe('Перс');
  });

  it('распределение по тирам — пирамида', () => {
    expect(BREEDS_BY_TIER.common.length).toBe(1);   // moggie
    expect(BREEDS_BY_TIER.uncommon.length).toBe(10);
    expect(BREEDS_BY_TIER.rare.length).toBe(9);
    expect(BREEDS_BY_TIER.epic.length).toBe(7);
    expect(BREEDS_BY_TIER.legendary.length).toBe(4);
  });

  it('каждая порода имеет имя и валидный тир', () => {
    for (const b of BREEDS) {
      expect(b.name.length).toBeGreaterThan(0);
      expect(BREED_BY_KEY[b.key]).toBe(b);
    }
  });
});

describe('прогрессия breedKitten', () => {
  it('всегда возвращает существующий ключ породы', () => {
    const rng = makeRng(1);
    for (let i = 0; i < 500; i++) {
      const k = breedKitten('moggie', 'moggie', rng);
      expect(BREED_BY_KEY[k]).toBeDefined();
    }
  });

  it('две дворняжки иногда дают необычную породу (подъём с common)', () => {
    const rng = makeRng(2);
    let climbed = 0;
    for (let i = 0; i < 1000; i++) {
      if (tierOfBreed(breedKitten('moggie', 'moggie', rng)) === 'uncommon') climbed++;
    }
    expect(climbed).toBeGreaterThan(0);
  });

  it('одинаковая пара эпиков может дать легендарного', () => {
    const rng = makeRng(3);
    let leg = 0;
    for (let i = 0; i < 2000; i++) {
      if (tierOfBreed(breedKitten('sphynx', 'sphynx', rng)) === 'legendary') leg++;
    }
    expect(leg).toBeGreaterThan(0);
  });

  it('одинаковая порода чаще сохраняется, чем у разнопородной пары', () => {
    const rng = makeRng(4);
    let sameKeep = 0;
    let mixKeep = 0;
    for (let i = 0; i < 2000; i++) {
      if (breedKitten('persian', 'persian', rng) === 'persian') sameKeep++;
    }
    for (let i = 0; i < 2000; i++) {
      const k = breedKitten('persian', 'siamese', rng); // оба uncommon
      if (k === 'persian') mixKeep++;
    }
    expect(sameKeep).toBeGreaterThan(mixKeep);
  });

  it('легендарная пара редко откатывается вниз (~15%, а не ~60% как с прежним багом)', () => {
    const rng = makeRng(50);
    const N = 4000;
    let down = 0;
    for (let i = 0; i < N; i++) {
      if (tierOfBreed(breedKitten('bengal', 'bengal', rng)) !== 'legendary') down++;
    }
    expect(down / N).toBeLessThan(0.25);
  });
});

describe('усилители вязки (генная инженерия)', () => {
  it('🔼 Форсаж: пара одного тира всегда даёт тир выше, заряд помечен использованным', () => {
    const rng = makeRng(60);
    for (let i = 0; i < 300; i++) {
      const used: BreedBoosts = {};
      const k = breedKitten('persian', 'persian', rng, { tierUp: true }, used); // uncommon → rare
      expect(tierOfBreed(k)).toBe('rare');
      expect(used.tierUp).toBe(true);
    }
  });

  it('🔼 Форсаж на максимуме (легендарные) не помечается использованным', () => {
    const rng = makeRng(61);
    const used: BreedBoosts = {};
    breedKitten('bengal', 'bengal', rng, { tierUp: true }, used);
    expect(used.tierUp).toBeUndefined();
  });

  it('🔼 Форсаж для разнотировой пары даёт тир старшего родителя', () => {
    const rng = makeRng(62);
    for (let i = 0; i < 200; i++) {
      const used: BreedBoosts = {};
      const k = breedKitten('moggie', 'persian', rng, { tierUp: true }, used); // common × uncommon
      expect(tierOfBreed(k)).toBe('uncommon');
      expect(used.tierUp).toBe(true);
    }
  });

  it('🛡 Стабилизатор: котёнок не опускается ниже тира родителей', () => {
    const rng = makeRng(63);
    const floor = TIER_LEVEL.rare;
    for (let i = 0; i < 1500; i++) {
      const k = breedKitten('abyssinian', 'abyssinian', rng, { noDown: true }); // rare
      expect(TIER_LEVEL[tierOfBreed(k)]).toBeGreaterThanOrEqual(floor);
    }
  });

  it('🍀 Катализатор повышает шанс тира-вверх', () => {
    const rb = makeRng(64);
    let base = 0;
    for (let i = 0; i < 3000; i++) {
      if (tierOfBreed(breedKitten('siamese', 'persian', rb)) === 'rare') base++;
    }
    const rl = makeRng(64);
    let lucky = 0;
    for (let i = 0; i < 3000; i++) {
      if (tierOfBreed(breedKitten('siamese', 'persian', rl, { luckyUp: true })) === 'rare') lucky++;
    }
    expect(lucky).toBeGreaterThan(base);
  });
});

describe('бонус родословной (extraUp)', () => {
  it('повышает шанс тира-вверх у одинаковой пары', () => {
    const rb = makeRng(80);
    let base = 0;
    for (let i = 0; i < 3000; i++) {
      if (tierOfBreed(breedKitten('persian', 'persian', rb)) === 'rare') base++; // uncommon → rare
    }
    const re = makeRng(80); // тот же сид — честное сравнение
    let boosted = 0;
    for (let i = 0; i < 3000; i++) {
      if (tierOfBreed(breedKitten('persian', 'persian', re, {}, undefined, 0.3)) === 'rare') boosted++;
    }
    expect(boosted).toBeGreaterThan(base);
  });

  it('повышает шанс тира старшего у разнотировой пары', () => {
    const rb = makeRng(81);
    let base = 0;
    for (let i = 0; i < 3000; i++) {
      if (tierOfBreed(breedKitten('moggie', 'persian', rb)) === 'uncommon') base++; // common × uncommon
    }
    const re = makeRng(81);
    let boosted = 0;
    for (let i = 0; i < 3000; i++) {
      if (tierOfBreed(breedKitten('moggie', 'persian', re, {}, undefined, 0.3)) === 'uncommon') boosted++;
    }
    expect(boosted).toBeGreaterThan(base);
  });
});
