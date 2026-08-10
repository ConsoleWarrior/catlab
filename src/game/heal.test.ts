import { describe, it, expect } from 'vitest';
import { makeRng, makeCat } from '../genetics/index.js';
import {
  createInitialState, serialize, deserialize, makeCatInstance,
  healCat, assignBreeder, heartsOf, breedsLeft,
} from './index.js';
import * as C from './config.js';
import type { GameState } from './index.js';

/** Питомник ур. 5 + куплен узел «Ветеринар» (клиника открыта) + кот с потраченными вязками. */
function setup(seed = 1, spent = 2) {
  const s = createInitialState(makeRng(seed), 0);
  s.level = 5;
  s.research.r_lab_vet = 1; // клиника теперь открывается покупкой узла «Лаборатории»
  const cat = makeCatInstance(s, makeCat('female'), 0, 'nursery', 'persian');
  cat.breedCount = spent;
  s.cats.push(cat);
  return { s, cat };
}

describe('клиника: 📺 реклама (+2 ❤, без кулдауна)', () => {
  it('снимает HEAL_AD_HEARTS с breedCount и фиксирует факт просмотра; maxHearts не трогает', () => {
    const { s, cat } = setup(1, 2);
    const heartsBefore = heartsOf(cat);
    const r = healCat(s, cat.id, 'ad', 1000);
    expect(r).toMatchObject({ ok: true, healed: C.HEAL_AD_HEARTS, crystals: 0 });
    expect(cat.breedCount).toBe(2 - C.HEAL_AD_HEARTS);
    expect(heartsOf(cat)).toBe(heartsBefore); // потолок не изменился
    expect(s.lastHealAdAt).toBe(1000);
  });

  it('повторный просмотр сразу же снова работает (кулдауна нет)', () => {
    const spent = C.HEAL_AD_HEARTS * 2 + 1; // хватит на два полноценных лечения
    const { s, cat } = setup(2, spent);
    const t0 = 1_000_000;
    expect(healCat(s, cat.id, 'ad', t0).ok).toBe(true);
    expect(cat.breedCount).toBe(spent - C.HEAL_AD_HEARTS);
    expect(healCat(s, cat.id, 'ad', t0 + 1).ok).toBe(true);
    expect(cat.breedCount).toBe(spent - C.HEAL_AD_HEARTS * 2);
  });

  it('реклама на одном коте не блокирует лечение другого', () => {
    const { s, cat } = setup(3, 1);
    const other = makeCatInstance(s, makeCat('male'), 0, 'nursery', 'siamese');
    other.breedCount = 2;
    s.cats.push(other);
    expect(healCat(s, cat.id, 'ad', 0).ok).toBe(true);
    expect(healCat(s, other.id, 'ad', 1000).ok).toBe(true);
  });
});

describe('клиника: 💎 полное лечение', () => {
  it('обнуляет breedCount, списывает HEAL_CRYSTAL_PER_HEART × потраченные', () => {
    const { s, cat } = setup(4, 3);
    s.crystals = 100;
    const r = healCat(s, cat.id, 'crystals', 0);
    const cost = C.HEAL_CRYSTAL_PER_HEART * 3;
    expect(r).toMatchObject({ ok: true, healed: 3, crystals: cost });
    expect(cat.breedCount).toBe(0);
    expect(breedsLeft(cat)).toBe(heartsOf(cat)); // все вязки снова доступны
    expect(s.crystals).toBe(100 - cost);
  });

  it('не хватает 💎 — отказ, ничего не списано и не вылечено', () => {
    const { s, cat } = setup(5, 4);
    s.crystals = C.HEAL_CRYSTAL_PER_HEART * 4 - 1;
    expect(healCat(s, cat.id, 'crystals', 0))
      .toMatchObject({ ok: false, reason: 'не хватает кристаллов' });
    expect(cat.breedCount).toBe(4);
    expect(s.crystals).toBe(C.HEAL_CRYSTAL_PER_HEART * 4 - 1);
  });

  it('maxHearts не меняется: инбридинговый потолок неизлечим', () => {
    const { s, cat } = setup(6, 3);
    cat.maxHearts = 3; // урезанный инбридингом
    cat.breedCount = 3;
    s.crystals = 100;
    expect(healCat(s, cat.id, 'crystals', 0).ok).toBe(true);
    expect(cat.maxHearts).toBe(3); // вязки восстановлены, потолок прежний
    expect(breedsLeft(cat)).toBe(3);
  });
});

describe('клиника: отказы', () => {
  it('бесплодного (0 ❤) не лечит', () => {
    const { s, cat } = setup(7, 0);
    cat.maxHearts = 0;
    s.crystals = 100;
    expect(healCat(s, cat.id, 'ad', 0)).toMatchObject({ ok: false, reason: 'бесплодного не вылечить' });
    expect(healCat(s, cat.id, 'crystals', 0)).toMatchObject({ ok: false });
  });

  it('полностью здорового не лечит (нечего восстанавливать)', () => {
    const { s, cat } = setup(8, 0);
    expect(healCat(s, cat.id, 'ad', 0)).toMatchObject({ ok: false, reason: 'кот полностью здоров' });
  });

  it('кота, поставленного в слот (вязка ещё не идёт), лечит — в этом смысл шприца в Инкубаторе', () => {
    const { s, cat } = setup(9, 1);
    expect(assignBreeder(s, 0, cat.id, 0).ok).toBe(true);
    expect(healCat(s, cat.id, 'ad', 0).ok).toBe(true);
    expect(cat.breedCount).toBe(0); // потраченное сердце восстановлено
  });

  it('во время ИДУЩЕЙ вязки лечить нельзя', () => {
    const { s, cat } = setup(9, 1);
    expect(assignBreeder(s, 0, cat.id, 0).ok).toBe(true);
    s.slots[0]!.readyAt = 999_999; // вязка пошла (таймер запущен)
    expect(healCat(s, cat.id, 'ad', 0)).toMatchObject({ ok: false, reason: 'кот сейчас в вязке' });
  });

  it('без узла «Ветеринар» — reason locked (клиника заперта)', () => {
    const { s, cat } = setup(10, 2);
    s.research.r_lab_vet = 0; // узел клиники не куплен → лечение заперто
    expect(healCat(s, cat.id, 'ad', 0)).toMatchObject({ ok: false, reason: 'locked' });
    expect(healCat(s, cat.id, 'crystals', 0)).toMatchObject({ ok: false, reason: 'locked' });
  });

  it('несуществующий кот — отказ', () => {
    const { s } = setup(11, 1);
    expect(healCat(s, 'nope', 'ad', 0)).toMatchObject({ ok: false, reason: 'кот не найден' });
  });
});

describe('клиника: миграция сейва', () => {
  it('старый сейв без lastHealAdAt → 0 (реклама сразу доступна)', () => {
    const s = createInitialState(makeRng(12), 0);
    const raw = JSON.parse(serialize(s)) as Record<string, unknown>;
    delete raw.lastHealAdAt;
    const restored: GameState = deserialize(JSON.stringify(raw));
    expect(restored.lastHealAdAt).toBe(0);
  });
});
