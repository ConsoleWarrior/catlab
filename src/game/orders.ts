/**
 * Заказы клиентов и проверка соответствия (Этап 4, коллекция).
 * Заказ требует кота определённой ПОРОДЫ или не ниже заданного тира редкости;
 * 💰/🧬 ∝ рыночной ценности «эталона» заказа × случайный спрос, а ⭐ опыт — плавно по
 * скрытому УРОВНЮ породы (C.orderRepFor, см. refRep). См. GAME.md §12.
 *
 * ПУЛ гейтится УРОВНЕМ ЛАБОРАТОРИИ, а не Котодексом — на уровне L клиенты просят
 * породы скрытых уровней L и L−1 (см. genetics/breedLevel). Порода может быть ещё
 * не выведена: такой заказ и есть цель («выведи бенгальскую»), а не способ слить излишки.
 *
 * ТАЙМЕР ЖИЗНИ ЗАКАЗА (v9): доска — ORDER_TARGET независимых слотов, каждый ВСЕГДА
 * держит активный заказ. У заказа свой expiresAt = createdAt + ORDER_REFRESH_MS (6 ч):
 * не выполнил за это время — заказ сам сменяется новым (refreshExpiredOrders). Выполнил
 * — слот сразу получает свежий заказ (claimOrder). У КАЖДОГО слота свой кулдаун
 * 📺-обновления (order.adRefreshAt, раз в ORDER_AD_REFRESH_COOLDOWN_MS) — обновление
 * одного заказа не блокирует остальные. Кулдауна на выполнение/пустых слотов нет.
 *
 * ТИП СЛОТА ФИКСИРОВАН: первые ORDER_SELL_SLOTS слотов — «сбыт» (породы, которые игрок
 * уже вывел: выполнимо прямо сейчас, но БЕЗ 💎), остальные — «цель» по уровню лаборатории
 * (могут быть ещё не выведены, зато дают ORDER_CRYSTALS 💎). Цена заказа на 💎 не влияет.
 */

import {
  PEDIGREE_BREEDS, TIER_LEVEL, tierOfBreed, breedValueMult, breedLevel,
} from '../genetics/index.js';
import type { Rng } from '../genetics/index.js';
import type { Cat, GameState, Order, OrderKind, OrderReq } from './types.js';
import * as C from './config.js';

/** Подходит ли кот под заказ. */
export function matchesOrder(order: Order, cat: Cat): boolean {
  const r = order.req;
  if (r.breed && cat.breed !== r.breed) return false;
  if (r.minRarity && TIER_LEVEL[cat.rarityTier] < TIER_LEVEL[r.minRarity]) return false;
  return true;
}

/** Сколько мс осталось до авто-смены заказа (истечёт 6-часовой таймер жизни). */
export function msUntilOrderExpiry(order: Order, now: number): number {
  return Math.max(0, order.expiresAt - now);
}

/** Доступно ли 📺-обновление ЭТОГО заказа (у каждого слота свой часовой кулдаун). */
export function canAdRefreshOrder(order: Order, now: number): boolean {
  return now >= (order.adRefreshAt ?? 0);
}

/** Сколько мс осталось до 📺-обновления этого заказа (0 — доступно). */
export function msUntilAdRefresh(order: Order, now: number): number {
  return Math.max(0, (order.adRefreshAt ?? 0) - now);
}

/** Рыночная ценность «эталона» заказа (порода при базовой родословной, либо тир). */
function refValue(req: OrderReq): number {
  if (req.breed) return C.TIER_MARKET_VALUE[tierOfBreed(req.breed)] * breedValueMult(req.breed);
  if (req.minRarity) return C.TIER_MARKET_VALUE[req.minRarity];
  return C.TIER_MARKET_VALUE.common;
}

/** Медианный скрытый уровень пород тира — для заказов «не ниже тира» (конкретной породы нет). */
const TIER_BREED_LEVEL: Record<string, number> = (() => {
  const out: Record<string, number> = {};
  for (const b of PEDIGREE_BREEDS) (out[b.tier] ??= 0);
  for (const tier of Object.keys(out)) {
    const ls = PEDIGREE_BREEDS.filter((b) => b.tier === tier).map((b) => breedLevel(b.key)).sort((a, b) => a - b);
    out[tier] = ls[Math.floor(ls.length / 2)] ?? 1;
  }
  return out;
})();

/**
 * ⭐ опыт за заказ — от СКРЫТОГО УРОВНЯ породы (плавная геометрия C.orderRepFor), а не от
 * ценности эталона: тир давал ступеньки на уровнях смены пула (L4/L7/L9). У заказа «не ниже
 * тира» породы нет — берём медианный уровень пород этого тира.
 */
function refRep(req: OrderReq): number {
  if (req.breed) return C.orderRepFor(breedLevel(req.breed));
  if (req.minRarity) return C.orderRepFor(TIER_BREED_LEVEL[req.minRarity] ?? 1);
  return C.orderRepFor(1);
}

/**
 * Пул возможных требований на текущем уровне лаборатории L: породы скрытых уровней
 * L и L−1 (базовые T1 не заказывают) + разбавление заказами «не ниже тира» по тем
 * тирам, что реально представлены в пуле — лёгкий способ слить излишки, когда
 * конкретная порода ещё не выведена. Тир common в разбавление не идёт: под него
 * подошёл бы любой кот.
 */
function candidates(state: GameState): OrderReq[] {
  const hi = Math.max(1, state.level);
  const lo = Math.max(1, hi - 1);
  const breeds = PEDIGREE_BREEDS.filter((b) => {
    const l = breedLevel(b.key);
    return l >= lo && l <= hi;
  });
  const reqs: OrderReq[] = breeds.map((b) => ({ breed: b.key }));
  const tiers = new Set(breeds.map((b) => b.tier).filter((t) => t !== 'common'));
  for (const t of tiers) reqs.push({ minRarity: t });
  return reqs;
}

/**
 * Пул «сбыт»: породы (T2+), которые игрок УЖЕ вывел — такой заказ выполним прямо
 * сейчас имеющимся котом. Часть слотов берём отсюда (см. rollSlot), иначе пул «цель»
 * (candidates по уровню лабы) уходит вперёд коллекции и заказы почти не выполняются.
 * T1 (дворовые) в сбыт не идут — под них подошёл бы любой кот.
 */
function sellCandidates(state: GameState): OrderReq[] {
  return PEDIGREE_BREEDS
    .filter((b) => b.tier !== 'common' && state.discoveredBreeds.includes(b.key))
    .map((b) => ({ breed: b.key }));
}

/**
 * Генерирует один заказ. `kind` выбирает пул: 'sell' — уже выведенные породы (без 💎),
 * 'target' (по умолчанию) — пул по уровню лаборатории (даёт ORDER_CRYSTALS 💎). Если
 * сбывать ещё нечего, слот «сбыт» падает обратно на «цель» — и тогда он тоже с 💎.
 * `adRefreshAt` — кулдаун 📺-обновления слота, переезжающий на новый заказ. Мутирует nextId.
 */
export function generateOrder(
  state: GameState, rng: Rng, now: number, kind: OrderKind = 'target', adRefreshAt = 0,
): Order {
  const sell = kind === 'sell' ? sellCandidates(state) : [];
  const actual: OrderKind = sell.length ? 'sell' : 'target';
  const cands = sell.length ? sell : candidates(state);
  const req = cands[Math.floor(rng() * cands.length)] ?? { minRarity: 'uncommon' };
  const value = refValue(req);
  const demand = 1 + rng() * C.ORDER_DEMAND_SPREAD; // 1.0 .. 1.5
  return {
    id: 'order' + state.nextId++,
    req,
    kind: actual,
    reward: {
      coins: Math.round(value * C.ORDER_COIN_MULT * demand),
      // 💎 — только за «цель» (заказ под уровень лабы), независимо от цены заказа
      crystals: actual === 'target' ? C.ORDER_CRYSTALS : 0,
      dna: Math.max(1, Math.round(value * C.ORDER_DNA_MULT)),
      reputation: refRep(req),
    },
    createdAt: now,
    expiresAt: now + C.ORDER_REFRESH_MS,
    adRefreshAt,
  };
}

/** Тип слота по его номеру: первые ORDER_SELL_SLOTS — «сбыт», остальные — «цель» (с 💎). */
function slotKind(i: number): OrderKind {
  return i < C.ORDER_SELL_SLOTS ? 'sell' : 'target';
}

/**
 * Наполнить доску активными заказами с нуля (старт новой игры): ORDER_SELL_SLOTS слотов
 * «сбыт» (выполнимо сразу), остальные — «цель» по уровню лабы.
 */
export function initOrders(state: GameState, rng: Rng, now: number): void {
  state.orders = [];
  for (let i = 0; i < C.ORDER_TARGET; i++) {
    state.orders.push(generateOrder(state, rng, now, slotKind(i)));
  }
}

/**
 * Обновляет доску: каждый заказ с истёкшим таймером жизни (now ≥ expiresAt) сменяется
 * свежим (примерно половина — «сбыт», решается монеткой на слот). Заодно добивает доску
 * до ORDER_TARGET, если слотов почему-то меньше (битый/старый сейв). Возвращает true,
 * если появился хоть один новый заказ (UI покажет тост).
 *
 * Идемпотентна и годится для офлайна: вернулся игрок через 6 часов или через неделю —
 * все просроченные заказы разом сменяются по одному свежему на слот (не по одному за
 * каждый пропущенный период — заказ в слоте один).
 */
export function refreshExpiredOrders(state: GameState, rng: Rng, now: number): boolean {
  let changed = false;
  while (state.orders.length < C.ORDER_TARGET) {
    state.orders.push(generateOrder(state, rng, now, slotKind(state.orders.length)));
    changed = true;
  }
  for (let i = 0; i < state.orders.length; i++) {
    const o = state.orders[i]!;
    if (now >= o.expiresAt) {
      // кулдаун 📺 принадлежит слоту, а не конкретному заказу — переносим на новый
      state.orders[i] = generateOrder(state, rng, now, slotKind(i), o.adRefreshAt ?? 0);
      changed = true;
    }
  }
  return changed;
}

/**
 * 📺-обновление заказа: сменить ЭТОТ заказ на свежий досрочно. Кулдаун свой у каждого
 * слота (ORDER_AD_REFRESH_COOLDOWN_MS) — обновление одного заказа не блокирует остальные.
 * Слот сразу получает новый активный заказ того же типа (сбыт/цель).
 */
export function adRefreshOrder(
  state: GameState, rng: Rng, orderId: string, now: number,
): { ok: true } | { ok: false; reason: string } {
  const i = state.orders.findIndex((x) => x.id === orderId);
  if (i < 0) return { ok: false, reason: 'заказ не найден' };
  if (!canAdRefreshOrder(state.orders[i]!, now)) {
    return { ok: false, reason: 'обновление этого заказа ещё на кулдауне' };
  }
  state.orders[i] = generateOrder(state, rng, now, slotKind(i), now + C.ORDER_AD_REFRESH_COOLDOWN_MS);
  return { ok: true };
}

/**
 * Сменить выполненный заказ на свежий в том же слоте (вызывается из claimOrder).
 * Слот всегда остаётся заполненным активным заказом — пустых слотов/кулдауна нет;
 * кулдаун 📺-обновления слота сохраняется (выполнение заказа его не сбрасывает).
 */
export function replaceOrder(state: GameState, rng: Rng, orderId: string, now: number): void {
  const i = state.orders.findIndex((x) => x.id === orderId);
  if (i < 0) return;
  state.orders[i] = generateOrder(state, rng, now, slotKind(i), state.orders[i]!.adRefreshAt ?? 0);
}
