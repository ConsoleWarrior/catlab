import { describe, it, expect } from 'vitest';
import { makeRng, makeCat } from '../genetics/index.js';
import {
  createInitialState, serialize, deserialize, makeCatInstance,
  freezeCat, cloneCat, disposeCryo, analyzeCat,
  cryoUnlocked, cryoCapacity, cryoCount, cloneCost, cloneCostCoins,
  catMarketValue, kinshipLevel, heartsOf, isAdult,
  setChampion, assignBreeder, attachHiddenPedigree, pedigreeHasFog,
} from './index.js';
import * as C from './config.js';
import type { Cat, GameState } from './index.js';

/** Состояние с открытым крио-банком (ранг узла `rank`) + один взрослый кот в питомнике. */
function setup(seed = 1, rank = 3): { s: GameState; cat: Cat } {
  const s = createInitialState(makeRng(seed), 0);
  s.level = 10;
  s.dna = 100_000;
  s.coins = 1_000_000;
  s.research.r_sel_cryo = rank; // 1-й ранг открывает крио-банк + капсулы
  const cat = makeCatInstance(s, makeCat('female'), 0, 'nursery', 'persian');
  s.cats.push(cat);
  return { s, cat };
}

describe('крио-банк: заморозка', () => {
  it('морозит взрослого: уходит из cats в cryo как есть', () => {
    const { s, cat } = setup(1);
    const before = s.cats.length;
    const r = freezeCat(s, cat.id, 'ad', 0);
    expect(r.ok).toBe(true);
    expect(s.cats.some((c) => c.id === cat.id)).toBe(false);
    expect(s.cryo.some((c) => c.id === cat.id)).toBe(true);
    expect(s.cats.length).toBe(before - 1);
    expect(cryoCount(s)).toBe(1);
  });

  it('оплата: 📺 бесплатно с кулдауном, 💰 монеты, 💎 кристаллы', () => {
    // 💰 монеты
    const a = setup(40);
    a.s.coins = C.FREEZE_COIN_COST;
    expect(freezeCat(a.s, a.cat.id, 'coins', 0)).toMatchObject({ ok: true, coins: C.FREEZE_COIN_COST });
    expect(a.s.coins).toBe(0);
    // 💎 кристаллы
    const b = setup(41);
    b.s.crystals = C.FREEZE_CRYSTAL_COST;
    expect(freezeCat(b.s, b.cat.id, 'crystals', 0)).toMatchObject({ ok: true, crystals: C.FREEZE_CRYSTAL_COST });
    expect(b.s.crystals).toBe(0);
    // 📺 реклама: первый раз бесплатно, повторно сразу — кулдаун
    const c = setup(42);
    const c2 = makeCatInstance(c.s, makeCat('male'), 0, 'nursery', 'siamese');
    c.s.cats.push(c2);
    expect(freezeCat(c.s, c.cat.id, 'ad', 1000).ok).toBe(true);
    expect(freezeCat(c.s, c2.id, 'ad', 2000)).toMatchObject({ ok: false, reason: 'реклама заморозки ещё недоступна' });
    expect(freezeCat(c.s, c2.id, 'ad', 1000 + C.FREEZE_AD_COOLDOWN_MS).ok).toBe(true);
    // не хватает валюты — отказ, кот в питомнике
    const d = setup(43);
    d.s.coins = 0;
    expect(freezeCat(d.s, d.cat.id, 'coins', 0)).toMatchObject({ ok: false, reason: 'не хватает монет' });
    expect(d.s.cats.some((x) => x.id === d.cat.id)).toBe(true);
  });

  it('без узла Криогенетики — locked (крио-банк закрыт)', () => {
    const { s, cat } = setup(2, 0); // rank 0 → узел не куплен
    expect(cryoUnlocked(s)).toBe(false);
    expect(cryoCapacity(s)).toBe(0);
    expect(freezeCat(s, cat.id, 'ad', 0)).toMatchObject({ ok: false, reason: 'locked' });
  });

  it('котёнка (не взрослого) не морозит', () => {
    const { s, cat } = setup(3);
    cat.bornAt = 0;
    cat.growthMs = C.KITTEN_GROWTH_MS;
    expect(isAdult(cat, 1000)).toBe(false);
    expect(freezeCat(s, cat.id, 'ad', 1000)).toMatchObject({ ok: false, reason: 'котёнок ещё не вырос' });
  });

  it('кота в слоте вязки не морозит', () => {
    const { s, cat } = setup(4);
    expect(assignBreeder(s, 0, cat.id, 0).ok).toBe(true);
    expect(freezeCat(s, cat.id, 'ad', 0)).toMatchObject({ ok: false, reason: 'кот в слоте вязки' });
  });

  it('чемпиона не морозит (сначала снять с пьедестала)', () => {
    const { s, cat } = setup(5);
    expect(setChampion(s, cat.id, 0, 0).ok).toBe(true);
    expect(freezeCat(s, cat.id, 'ad', 0)).toMatchObject({ ok: false, reason: 'сначала снять с пьедестала' });
  });

  it('нет свободной капсулы — отказ', () => {
    const { s, cat } = setup(6, 1); // ранг 1 → небольшая ёмкость
    const cap = cryoCapacity(s);
    for (let i = 0; i < cap; i++) s.cryo.push(makeCatInstance(s, makeCat('male'), 0, 'nursery', 'siamese'));
    expect(cryoCount(s)).toBe(cap);
    expect(freezeCat(s, cat.id, 'ad', 0)).toMatchObject({ ok: false, reason: 'нет свободной капсулы' });
  });
});

describe('крио-банк: клонирование', () => {
  it('клон = новорождённый в питомнике, копия породы/пола, breedCount 0, наследует maxHearts', () => {
    const { s, cat } = setup(7);
    cat.maxHearts = 4; // урезанный потолок
    freezeCat(s, cat.id, 'ad', 0);
    const r = cloneCat(s, cat.id, 1000);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.clone.breed).toBe('persian');
    expect(r.clone.genotype.sex).toBe(cat.genotype.sex);
    expect(r.clone.location).toBe('nursery');
    expect(r.clone.maxHearts).toBe(4);   // потолок наследуется
    expect(r.clone.breedCount).toBe(0);  // свежие сердца
    expect(r.clone.bornAt).toBe(1000);   // растёт как настоящий новорождённый
    expect(isAdult(r.clone, 1000)).toBe(false);
    expect(s.cats.some((c) => c.id === r.clone.id)).toBe(true);
    // оригинал остаётся в капсуле
    expect(s.cryo.some((c) => c.id === cat.id)).toBe(true);
  });

  it('клон изучен сразу (analyzed) и наследует вариант внешности оригинала', () => {
    const { s, cat } = setup(20);
    cat.analyzed = false;                 // оригинал даже не изучен
    freezeCat(s, cat.id, 'ad', 0);
    const r = cloneCat(s, cat.id, 0);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.clone.analyzed).toBe(true);          // клонирование = полное секвенирование
    expect(r.clone.artId).toBe(cat.id);           // тот же базовый арт, что у оригинала
  });

  it('родословная клона = точная копия родословной оригинала (не «потомок»)', () => {
    const { s, cat } = setup(21);
    // задаём оригиналу известную родословную (родители + деды-заглушки)
    cat.pedigree = {
      mother: { id: 'a_m', breed: 'siamese', mother: { id: 'a_mm', breed: 'persian' }, father: { id: 'a_mf', breed: 'bengal' } },
      father: { id: 'a_f', breed: 'persian', mother: { id: 'a_fm', breed: 'moggie' }, father: { id: 'a_ff', breed: 'siamese' } },
    };
    freezeCat(s, cat.id, 'ad', 0);
    const r = cloneCat(s, cat.id, 0);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    // те же предки (id/породы); клон analyzed → его дерево вскрыто (known: true на узлах)
    const ids = (a?: { id: string; mother?: unknown; father?: unknown }): unknown =>
      a && { id: a.id, mother: ids(a.mother as never), father: ids(a.father as never) };
    expect(ids(r.clone.pedigree!.mother)).toEqual(ids(cat.pedigree.mother));
    expect(ids(r.clone.pedigree!.father)).toEqual(ids(cat.pedigree.father));
    expect(r.clone.pedigree).not.toBe(cat.pedigree);          // глубокая копия, не общая ссылка
    expect(r.clone.pedigree!.mother!.known).toBe(true);       // секвенирование = без тумана
    expect(cat.pedigree.mother!.known).toBeUndefined();       // оригинал в капсуле НЕ вскрыт
    expect(r.clone.pedigree!.mother!.id).toBe('a_m');         // оригинал НЕ вставлен как родитель
  });

  it('цена = CLONE_LAB_MULT × выход лаборатории того же кота; списывает ДНК + 💰 (×10 от цены в ДНК)', () => {
    const { s, cat } = setup(8);
    freezeCat(s, cat.id, 'ad', 0);
    const orig = s.cryo.find((c) => c.id === cat.id)!;
    const expected = C.CLONE_LAB_MULT * Math.max(1, Math.round(catMarketValue(orig) * C.LAB_DNA_RATE));
    expect(cloneCost(orig)).toBe(expected);
    expect(cloneCostCoins(orig)).toBe(expected * 10);
    const dnaBefore = s.dna;
    const coinsBefore = s.coins;
    const r = cloneCat(s, cat.id, 0);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.dna).toBe(expected);
    expect(r.coins).toBe(expected * 10);
    expect(s.dna).toBe(dnaBefore - expected);
    expect(s.coins).toBe(coinsBefore - expected * 10);
  });

  it('не хватает 💰 монет — отказ, ДНК не списана, капсула цела', () => {
    const { s, cat } = setup(22);
    freezeCat(s, cat.id, 'ad', 0);
    s.coins = 0;
    const dnaBefore = s.dna;
    expect(cloneCat(s, cat.id, 0)).toMatchObject({ ok: false, reason: 'не хватает монет' });
    expect(s.dna).toBe(dnaBefore);
    expect(s.cryo.some((c) => c.id === cat.id)).toBe(true);
  });

  it('клон × оригинал = критическое родство (готовый kinship, не собрать «чистую пару»)', () => {
    const { s, cat } = setup(9);
    freezeCat(s, cat.id, 'ad', 0);
    const orig = s.cryo.find((c) => c.id === cat.id)!;
    const r = cloneCat(s, cat.id, 0);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(kinshipLevel(r.clone, orig)).toBe('critical');
    expect(kinshipLevel(orig, r.clone)).toBe('critical');
  });

  it('бесплодный (0 ❤) клонируется бесплодным', () => {
    const { s, cat } = setup(10);
    cat.maxHearts = 0;
    freezeCat(s, cat.id, 'ad', 0);
    const r = cloneCat(s, cat.id, 0);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(heartsOf(r.clone)).toBe(0);
  });

  it('за клон опыта ⭐ не начисляется (это не рождение)', () => {
    const { s, cat } = setup(11);
    freezeCat(s, cat.id, 'ad', 0);
    const repBefore = s.reputation;
    cloneCat(s, cat.id, 0);
    expect(s.reputation).toBe(repBefore);
  });

  it('нет места в питомнике — отказ, ДНК не списана', () => {
    const { s } = setup(12, 1);
    // забиваем питомник под завязку, кладём отдельного кота в капсулу
    s.cats = [];
    const cap = C.NURSERY_BASE_CAP;
    for (let i = 0; i < cap; i++) s.cats.push(makeCatInstance(s, makeCat('female'), 0, 'nursery', 'moggie'));
    const frozen = makeCatInstance(s, makeCat('male'), 0, 'nursery', 'persian');
    s.cryo.push(frozen);
    const dnaBefore = s.dna;
    expect(cloneCat(s, frozen.id, 0)).toMatchObject({ ok: false, reason: 'нет места в питомнике' });
    expect(s.dna).toBe(dnaBefore);
  });

  it('не хватает ДНК — отказ, капсула цела', () => {
    const { s, cat } = setup(13);
    freezeCat(s, cat.id, 'ad', 0);
    s.dna = 0;
    expect(cloneCat(s, cat.id, 0)).toMatchObject({ ok: false, reason: 'не хватает ДНК' });
    expect(s.cryo.some((c) => c.id === cat.id)).toBe(true);
  });

  it('несуществующая капсула — отказ', () => {
    const { s } = setup(14);
    expect(cloneCat(s, 'nope', 0)).toMatchObject({ ok: false, reason: 'капсула не найдена' });
  });
});

describe('крио-банк: анализ замороженного кота', () => {
  it('генетический анализ доступен коту в капсуле (не «кот не найден»)', () => {
    const { s, cat } = setup(30);
    attachHiddenPedigree(s, cat, makeRng(31));
    s.coins = C.analyzeCoinCost(cat.rarityTier);
    freezeCat(s, cat.id, 'ad', 0);
    const frozen = s.cryo.find((c) => c.id === cat.id)!;
    expect(frozen.analyzed).toBe(false);
    expect(pedigreeHasFog(frozen)).toBe(true);
    const r = analyzeCat(s, cat.id, 'coins', 1000);
    expect(r.ok).toBe(true);
    expect(frozen.analyzed).toBe(true);
    expect(pedigreeHasFog(frozen)).toBe(false); // родословная вскрыта прямо в капсуле
  });
});

describe('крио-банк: утилизация', () => {
  it('освобождает капсулу навсегда, наград нет', () => {
    const { s, cat } = setup(15);
    freezeCat(s, cat.id, 'ad', 0);
    const snap = { coins: s.coins, dna: s.dna, crystals: s.crystals };
    const r = disposeCryo(s, cat.id);
    expect(r.ok).toBe(true);
    expect(s.cryo.some((c) => c.id === cat.id)).toBe(false);
    expect(s.cats.some((c) => c.id === cat.id)).toBe(false); // не возвращается в питомник
    expect({ coins: s.coins, dna: s.dna, crystals: s.crystals }).toEqual(snap);
  });

  it('несуществующая капсула — отказ', () => {
    const { s } = setup(16);
    expect(disposeCryo(s, 'nope')).toMatchObject({ ok: false, reason: 'капсула не найдена' });
  });
});

describe('крио-банк: вместимость от рангов Криогенетики', () => {
  it('0 без узла, растёт с каждым рангом (база + Σvalue), к макс. рангу ~30', () => {
    const s = createInitialState(makeRng(17), 0);
    expect(cryoCapacity(s)).toBe(0);
    s.research.r_sel_cryo = 1;
    expect(cryoCapacity(s)).toBe(C.CRYO_BASE_CAP + 6);
    const def = C.RESEARCH.find((r) => r.id === 'r_sel_cryo')!;
    s.research.r_sel_cryo = def.levels.length;
    const maxCap = C.CRYO_BASE_CAP + def.levels.reduce((sum, l) => sum + l.value, 0);
    expect(cryoCapacity(s)).toBe(maxCap);
    expect(maxCap).toBeGreaterThanOrEqual(24);
  });
});

describe('крио-банк: миграция сейва', () => {
  it('старый сейв без cryo → пустой массив', () => {
    const s = createInitialState(makeRng(18), 0);
    const raw = JSON.parse(serialize(s)) as Record<string, unknown>;
    delete raw.cryo;
    const restored: GameState = deserialize(JSON.stringify(raw));
    expect(Array.isArray(restored.cryo)).toBe(true);
    expect(restored.cryo.length).toBe(0);
  });

  it('сериализация сохраняет замороженных котов', () => {
    const { s, cat } = setup(19);
    freezeCat(s, cat.id, 'ad', 0);
    const restored = deserialize(serialize(s));
    expect(restored.cryo.some((c) => c.id === cat.id)).toBe(true);
  });
});
