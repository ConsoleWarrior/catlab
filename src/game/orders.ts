/**
 * Заказы клиентов и проверка соответствия (Этап 4, коллекция).
 * Заказ требует кота определённой ПОРОДЫ или не ниже заданного тира редкости;
 * награда ∝ рыночной ценности «эталона» заказа × случайный спрос. См. GAME.md §7.
 *
 * ВАЖНО: конкретные породы в заказах берутся ТОЛЬКО из уже открытых в Котодексе
 * (state.discoveredBreeds) — клиент не может заказать породу, которую игрок ещё
 * не выводил. Заказы живут ORDER_TTL_MS (ротация) и доливаются до ORDER_TARGET.
 */

import { PEDIGREE_BREEDS, TIER_LEVEL, tierOfBreed, breedValueMult } from '../genetics/index.js';
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

/** Рыночная ценность «эталона» заказа (порода при базовой родословной, либо тир). */
function refValue(req: OrderReq): number {
  if (req.breed) return C.TIER_MARKET_VALUE[tierOfBreed(req.breed)] * breedValueMult(req.breed);
  if (req.minRarity) return C.TIER_MARKET_VALUE[req.minRarity];
  return C.TIER_MARKET_VALUE.common;
}

/**
 * Пул возможных требований: «не ниже тира» (всегда) + конкретные породы,
 * но только те, что уже открыты в Котодексе (кроме базовых T1).
 */
function candidates(state: GameState): OrderReq[] {
  const reqs: OrderReq[] = [
    { minRarity: 'uncommon' },
    { minRarity: 'rare' },
    { minRarity: 'epic' },
  ];
  const known = new Set(state.discoveredBreeds ?? []);
  for (const b of PEDIGREE_BREEDS) {
    if (known.has(b.key)) reqs.push({ breed: b.key });
  }
  return reqs;
}

/** Генерирует один заказ из доступного пула. Мутирует nextId. */
export function generateOrder(state: GameState, rng: Rng, now: number): Order {
  const cands = candidates(state);
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
    expiresAt: C.ORDER_TTL_MS > 0 ? now + C.ORDER_TTL_MS : 0,
  };
}

/** Убирает просроченные заказы (expiresAt в прошлом). Возвращает число удалённых. */
export function pruneExpiredOrders(state: GameState, now: number): number {
  const before = state.orders.length;
  state.orders = state.orders.filter((o) => o.expiresAt === 0 || now <= o.expiresAt);
  return before - state.orders.length;
}

/** Прунит просроченные и доливает заказы до целевого количества. */
export function refillOrders(state: GameState, rng: Rng, now: number, target = C.ORDER_TARGET): void {
  pruneExpiredOrders(state, now);
  while (state.orders.length < target) state.orders.push(generateOrder(state, rng, now));
}
