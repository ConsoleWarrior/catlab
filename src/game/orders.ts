/**
 * Заказы клиентов и проверка соответствия (Этап 4).
 * Заказ требует кота с конкретным фенотипом; награда ∝ сложности.
 * Требования ограничены открытыми генами (Генолаб). См. GAME.md §7.
 */

import { detectBreed, expressPhenotype } from '../genetics/index.js';
import type { RarityTier, Rng } from '../genetics/index.js';
import type { Cat, GameState, Order, OrderReq } from './types.js';

const TIER_ORDER: RarityTier[] = ['common', 'uncommon', 'rare', 'epic', 'legendary'];

/** Подходит ли кот под заказ. */
export function matchesOrder(order: Order, cat: Cat): boolean {
  const p = expressPhenotype(cat.genotype);
  const r = order.req;
  if (r.baseColor && p.baseColor !== r.baseColor) return false;
  if (r.pattern && (p.pattern ?? 'solid') !== r.pattern) return false;
  if (r.earShape && p.earShape !== r.earShape) return false;
  if (r.coatLength && p.coatLength !== r.coatLength) return false;
  if (r.breed && detectBreed(cat.genotype) !== r.breed) return false;
  if (r.minRarity) {
    if (TIER_ORDER.indexOf(cat.rarityTier) < TIER_ORDER.indexOf(r.minRarity)) return false;
  }
  return true;
}

interface Candidate {
  req: OrderReq;
  weight: number; // сложность → масштаб награды
}

/** Возможные требования заказов, отфильтрованные по открытым генам. */
function candidates(state: GameState): Candidate[] {
  const list: Candidate[] = [
    { req: { baseColor: 'black' }, weight: 1 },
    { req: { baseColor: 'red' }, weight: 1.5 },
    { req: { pattern: 'mackerel' }, weight: 1 },
    { req: { pattern: 'spotted' }, weight: 1.5 },
    { req: { pattern: 'solid' }, weight: 1.2 },
  ];
  const g = state.unlockedGenes;
  if (g.includes('dilute')) {
    list.push({ req: { baseColor: 'blue' }, weight: 2 });
    list.push({ req: { baseColor: 'cream' }, weight: 2.5 });
  }
  if (g.includes('pointed')) list.push({ req: { breed: 'Сиамец' }, weight: 3 });
  if (g.includes('longhair')) list.push({ req: { coatLength: 'long' }, weight: 2 });
  if (g.includes('fold')) list.push({ req: { earShape: 'fold' }, weight: 3.5 });
  if (g.includes('curl')) list.push({ req: { earShape: 'curl' }, weight: 3.5 });
  return list;
}

/** Генерирует один заказ из доступного пула. Мутирует nextId. */
export function generateOrder(state: GameState, rng: Rng, now: number): Order {
  const cands = candidates(state);
  const c = cands[Math.floor(rng() * cands.length)] ?? cands[0]!;
  const w = c.weight;
  return {
    id: 'order' + state.nextId++,
    req: c.req,
    reward: {
      coins: Math.round(80 * w),
      crystals: w >= 3 ? 1 : 0,
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
