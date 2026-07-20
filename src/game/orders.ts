/**
 * Заказы клиентов и проверка соответствия (Этап 4, коллекция).
 * Заказ требует кота определённой ПОРОДЫ или не ниже заданного тира редкости;
 * награда ∝ рыночной ценности «эталона» заказа × случайный спрос. См. GAME.md §12.
 *
 * ПУЛ гейтится УРОВНЕМ ЛАБОРАТОРИИ, а не Котодексом — на уровне L клиенты просят
 * породы скрытых уровней L и L−1 (см. genetics/breedLevel). Порода может быть ещё
 * не выведена: такой заказ и есть цель («выведи бенгальскую»), а не способ слить излишки.
 *
 * ТАЙМЕР ЖИЗНИ ЗАКАЗА (v9): доска — ORDER_TARGET независимых слотов, каждый ВСЕГДА
 * держит активный заказ. У заказа свой expiresAt = createdAt + ORDER_REFRESH_MS (6 ч):
 * не выполнил за это время — заказ сам сменяется новым (refreshExpiredOrders). Выполнил
 * — слот сразу получает свежий заказ (claimOrder). Плюс раз в ORDER_AD_REFRESH_COOLDOWN_MS
 * игрок может обновить ОДИН заказ за 📺 (adRefreshOrder). Кулдауна/пустых слотов нет.
 */

import {
  PEDIGREE_BREEDS, TIER_LEVEL, tierOfBreed, breedValueMult, breedLevel,
} from '../genetics/index.js';
import type { Rng } from '../genetics/index.js';
import type { Cat, GameState, Order, OrderReq } from './types.js';
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

/** Доступно ли сейчас 📺-обновление заказа (глобальный кулдаун раз в час). */
export function canAdRefreshOrder(state: GameState, now: number): boolean {
  return now >= (state.orderAdRefreshAt ?? 0);
}

/** Сколько мс осталось до следующего доступного 📺-обновления заказа (0 — доступно). */
export function msUntilAdRefresh(state: GameState, now: number): number {
  return Math.max(0, (state.orderAdRefreshAt ?? 0) - now);
}

/** Рыночная ценность «эталона» заказа (порода при базовой родословной, либо тир). */
function refValue(req: OrderReq): number {
  if (req.breed) return C.TIER_MARKET_VALUE[tierOfBreed(req.breed)] * breedValueMult(req.breed);
  if (req.minRarity) return C.TIER_MARKET_VALUE[req.minRarity];
  return C.TIER_MARKET_VALUE.common;
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

/** Генерирует один заказ из указанного пула (по умолчанию — «цель» по уровню лабы). Мутирует nextId. */
export function generateOrder(state: GameState, rng: Rng, now: number, pool?: OrderReq[]): Order {
  const cands = pool && pool.length ? pool : candidates(state);
  const req = cands[Math.floor(rng() * cands.length)] ?? { minRarity: 'uncommon' };
  const value = refValue(req);
  const demand = 1 + rng() * C.ORDER_DEMAND_SPREAD; // 1.0 .. 1.5
  return {
    id: 'order' + state.nextId++,
    req,
    reward: {
      coins: Math.round(value * C.ORDER_COIN_MULT * demand),
      crystals: value >= C.ORDER_CRYSTAL_MIN_VALUE ? 1 : 0,
      dna: Math.max(1, Math.round(value * C.ORDER_DNA_MULT)),
      reputation: Math.round(value * C.ORDER_REP_MULT),
    },
    createdAt: now,
    expiresAt: now + C.ORDER_REFRESH_MS,
  };
}

/**
 * Свежий заказ для слота. `wantSell` — попытаться взять породу из пула «сбыт» (уже
 * выведено, выполнимо сразу); если сбывать нечего — берём «цель» по уровню лабы.
 */
function rollSlot(state: GameState, rng: Rng, now: number, wantSell: boolean): Order {
  const sell = wantSell ? sellCandidates(state) : [];
  return generateOrder(state, rng, now, sell.length ? sell : undefined);
}

/**
 * Наполнить доску активными заказами с нуля (старт новой игры). Половину слотов
 * берём из пула «сбыт», остальные — «цель», чтобы часть заказов была выполнима сразу.
 */
export function initOrders(state: GameState, rng: Rng, now: number): void {
  const sellSlots = sellCandidates(state).length ? Math.floor(C.ORDER_TARGET / 2) : 0;
  state.orders = [];
  for (let i = 0; i < C.ORDER_TARGET; i++) {
    state.orders.push(rollSlot(state, rng, now, i < sellSlots));
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
    state.orders.push(rollSlot(state, rng, now, rng() < C.ORDER_SELL_SLOT_CHANCE));
    changed = true;
  }
  for (let i = 0; i < state.orders.length; i++) {
    const o = state.orders[i]!;
    if (now >= o.expiresAt) {
      state.orders[i] = rollSlot(state, rng, now, rng() < C.ORDER_SELL_SLOT_CHANCE);
      changed = true;
    }
  }
  return changed;
}

/**
 * 📺-обновление заказа: сменить ОДИН заказ на свежий досрочно. Глобальный кулдаун —
 * ORDER_AD_REFRESH_COOLDOWN_MS (раз в час можно обновить один заказ). Слот сразу
 * получает новый активный заказ (сбыт/цель — монеткой).
 */
export function adRefreshOrder(
  state: GameState, rng: Rng, orderId: string, now: number,
): { ok: true } | { ok: false; reason: string } {
  if (!canAdRefreshOrder(state, now)) return { ok: false, reason: 'обновление ещё на кулдауне' };
  const i = state.orders.findIndex((x) => x.id === orderId);
  if (i < 0) return { ok: false, reason: 'заказ не найден' };
  state.orders[i] = rollSlot(state, rng, now, rng() < C.ORDER_SELL_SLOT_CHANCE);
  state.orderAdRefreshAt = now + C.ORDER_AD_REFRESH_COOLDOWN_MS;
  return { ok: true };
}

/**
 * Сменить выполненный заказ на свежий в том же слоте (вызывается из claimOrder).
 * Слот всегда остаётся заполненным активным заказом — пустых слотов/кулдауна нет.
 */
export function replaceOrder(state: GameState, rng: Rng, orderId: string, now: number): void {
  const i = state.orders.findIndex((x) => x.id === orderId);
  if (i < 0) return;
  state.orders[i] = rollSlot(state, rng, now, rng() < C.ORDER_SELL_SLOT_CHANCE);
}
