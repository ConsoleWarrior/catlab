/**
 * Заказы клиентов и проверка соответствия (Этап 4, коллекция).
 * Заказ требует кота определённой ПОРОДЫ или не ниже заданного тира редкости;
 * награда ∝ сложности. См. GAME.md §7.
 */

import { PEDIGREE_BREEDS, TIER_LEVEL } from '../genetics/index.js';
import type { Rng } from '../genetics/index.js';
import type { Cat, GameState, Order, OrderReq } from './types.js';

/** Подходит ли кот под заказ. */
export function matchesOrder(order: Order, cat: Cat): boolean {
  const r = order.req;
  if (r.breed && cat.breed !== r.breed) return false;
  if (r.minRarity && TIER_LEVEL[cat.rarityTier] < TIER_LEVEL[r.minRarity]) return false;
  return true;
}

interface Candidate {
  req: OrderReq;
  weight: number; // сложность → масштаб награды
}

/** Пул заказов: «не ниже тира» + конкретные породы (сложнее → дороже). */
function candidates(): Candidate[] {
  const list: Candidate[] = [
    { req: { minRarity: 'uncommon' }, weight: 1.5 },
    { req: { minRarity: 'rare' }, weight: 3 },
    { req: { minRarity: 'epic' }, weight: 6 },
  ];
  // конкретные породы — вес растёт с тиром
  for (const b of PEDIGREE_BREEDS) {
    list.push({ req: { breed: b.key }, weight: 1.5 + TIER_LEVEL[b.tier] * 1.6 });
  }
  return list;
}

/** Генерирует один заказ из доступного пула. Мутирует nextId. */
export function generateOrder(state: GameState, rng: Rng, now: number): Order {
  const cands = candidates();
  const c = cands[Math.floor(rng() * cands.length)] ?? cands[0]!;
  const w = c.weight;
  return {
    id: 'order' + state.nextId++,
    req: c.req,
    reward: {
      coins: Math.round(80 * w),
      crystals: w >= 5 ? 1 : 0,
      dna: Math.round(3 * w),
      reputation: Math.round(20 * w),
    },
    createdAt: now,
    expiresAt: 0,
  };
}

/** Доливает заказы до целевого количества. */
export function refillOrders(state: GameState, rng: Rng, now: number, target = 3): void {
  while (state.orders.length < target) state.orders.push(generateOrder(state, rng, now));
}
