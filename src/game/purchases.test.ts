import { describe, it, expect } from 'vitest';
import { makeRng } from '../genetics/index.js';
import { createInitialState, grantCrystals, firstPurchaseBonusAvailable, serialize, deserialize } from './index.js';
import * as C from './config.js';

const pack = (i = 0): C.CrystalPack => C.CRYSTAL_PACKS[i]!;

function freshState(): ReturnType<typeof createInitialState> {
  const s = createInitialState(makeRng(1), 0);
  s.crystals = 0;
  return s;
}

describe('grantCrystals', () => {
  it('первая покупка даёт бонус +50%, вторая — только номинал', () => {
    const s = freshState();
    expect(firstPurchaseBonusAvailable(s)).toBe(true);

    const p = pack(1); // 150 💎
    const first = grantCrystals(s, p.id, 'tok-1');
    expect(first).toMatchObject({ ok: true, bonus: Math.round(p.crystals * C.FIRST_PURCHASE_BONUS) });
    expect(s.crystals).toBe(p.crystals + Math.round(p.crystals * 0.5)); // 150 + 75
    expect(firstPurchaseBonusAvailable(s)).toBe(false);

    const second = grantCrystals(s, p.id, 'tok-2');
    expect(second).toMatchObject({ ok: true, bonus: 0 });
    expect(s.crystals).toBe(p.crystals * 2 + Math.round(p.crystals * 0.5));
  });

  it('повторный тот же purchaseToken не начисляет второй раз', () => {
    const s = freshState();
    expect(grantCrystals(s, pack().id, 'tok-A').ok).toBe(true);
    const after = s.crystals;

    const again = grantCrystals(s, pack().id, 'tok-A');
    expect(again).toMatchObject({ ok: false });
    expect(s.crystals).toBe(after);
    expect(s.processedPurchases.filter((t) => t === 'tok-A')).toHaveLength(1);
  });

  it('неизвестный товар не начисляется и не помечается обработанным', () => {
    const s = freshState();
    expect(grantCrystals(s, 'crystals_999999', 'tok-X')).toMatchObject({ ok: false });
    expect(s.crystals).toBe(0);
    expect(s.processedPurchases).toHaveLength(0);
    expect(s.firstPurchaseDone).toBe(false); // бонус первой покупки не сгорел
  });

  it('список обработанных токенов не растёт бесконечно', () => {
    const s = freshState();
    for (let i = 0; i < C.PROCESSED_PURCHASES_KEEP + 20; i++) grantCrystals(s, pack().id, `tok-${i}`);
    expect(s.processedPurchases).toHaveLength(C.PROCESSED_PURCHASES_KEEP);
    // хвост — самые свежие токены, старые вытеснены
    const last = s.processedPurchases[s.processedPurchases.length - 1];
    expect(last).toBe(`tok-${C.PROCESSED_PURCHASES_KEEP + 19}`);
  });

  it('токены переживают сериализацию сейва (защита работает после перезапуска)', () => {
    const s = freshState();
    grantCrystals(s, pack().id, 'tok-save');
    const restored = deserialize(serialize(s));
    expect(grantCrystals(restored, pack().id, 'tok-save')).toMatchObject({ ok: false });
    expect(restored.crystals).toBe(s.crystals);
  });

  it('старый сейв без полей покупок читается и позволяет покупать', () => {
    const s = freshState();
    const legacy = JSON.parse(serialize(s)) as Record<string, unknown>;
    delete legacy.processedPurchases;
    delete legacy.firstPurchaseDone;

    const restored = deserialize(JSON.stringify(legacy));
    expect(restored.processedPurchases).toEqual([]);
    expect(restored.firstPurchaseDone).toBe(false);
    expect(grantCrystals(restored, pack().id, 'tok-legacy').ok).toBe(true);
  });
});

describe('паки кристаллов', () => {
  it('id уникальны — иначе покупка из Консоли начислит не тот пак', () => {
    const ids = C.CRYSTAL_PACKS.map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('чем крупнее пак, тем выгоднее курс 💎/ян', () => {
    const rates = C.CRYSTAL_PACKS.map((p) => p.crystals / p.yans);
    for (let i = 1; i < rates.length; i++) expect(rates[i]!).toBeGreaterThan(rates[i - 1]!);
  });

  it('бейдж выгоды считается от базового пака', () => {
    expect(C.packBonusPct(pack(0))).toBe(0);
    for (let i = 1; i < C.CRYSTAL_PACKS.length; i++) {
      expect(C.packBonusPct(pack(i))).toBeGreaterThan(0);
    }
  });
});
