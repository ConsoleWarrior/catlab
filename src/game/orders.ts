/**
 * Заказы клиентов и проверка соответствия (Этап 4, коллекция).
 * Заказ требует кота определённой ПОРОДЫ или не ниже заданного тира редкости;
 * награда ∝ рыночной ценности «эталона» заказа × случайный спрос. См. GAME.md §12.
 *
 * ПУЛ гейтится УРОВНЕМ ЛАБОРАТОРИИ, а не Котодексом — на уровне L клиенты просят
 * породы скрытых уровней L и L−1 (см. genetics/breedLevel). Порода может быть ещё
 * не выведена: такой заказ и есть цель («выведи бенгальскую»), а не способ слить излишки.
 *
 * СУТОЧНЫЙ ЦИКЛ: доска — ORDER_TARGET фиксированных слотов, которые целиком
 * перевыпускаются в полночь по Москве (rollDailyOrders). Внутри суток доска не
 * меняется сама: выполненный заказ остаётся помеченным (done) и слот до полуночи
 * занят, а игрок может 📺-заменить каждый невыполненный слот один раз за сутки.
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
    done: false,
    adRefreshed: false,
  };
}

// --- Суточный цикл (полночь по Москве) ---

/**
 * Номер московских суток (MSK = UTC+3 круглый год — Россия не переходит на летнее
 * время с 2014, поэтому фиксированный сдвиг корректен и не зависит от таймзоны
 * устройства игрока). Смена номера = наступила московская полночь.
 */
export function mskDay(now: number): number {
  return Math.floor((now + C.MSK_OFFSET_MS) / C.DAY_MS);
}

/** Момент следующей московской полуночи (мс epoch). */
export function nextMskMidnight(now: number): number {
  return (mskDay(now) + 1) * C.DAY_MS - C.MSK_OFFSET_MS;
}

/** Сколько мс осталось до смены заказов — для видимого таймера на доске. */
export function msUntilOrdersReset(now: number): number {
  return Math.max(0, nextMskMidnight(now) - now);
}

/**
 * Перевыпускает доску, если наступили новые московские сутки: все ORDER_TARGET
 * слотов заменяются свежими (флаги done/adRefreshed сбрасываются вместе с ними),
 * корзина освобождается — кот в ней остаётся в приюте, но «предъявлять» его больше
 * некому. Возвращает true, если доска сменилась (UI покажет тост).
 *
 * Идемпотентна: вызывается и на старте, и каждый кадр — внутри суток это no-op.
 * Офлайн отдельно обрабатывать не нужно: вернулся игрок через час или через неделю,
 * сравнение номера суток даёт один и тот же ответ.
 */
export function rollDailyOrders(state: GameState, rng: Rng, now: number): boolean {
  const day = mskDay(now);
  if (state.ordersDay === day && state.orders.length === C.ORDER_TARGET) return false;
  state.orders = [];
  for (let i = 0; i < C.ORDER_TARGET; i++) state.orders.push(generateOrder(state, rng, now));
  state.ordersDay = day;
  state.orderBasket = null;
  return true;
}

/**
 * 📺-замена одного слота: невыполненный заказ меняется на свежий из текущего пула,
 * по одной замене на слот за сутки. Флаг adRefreshed переносится на НОВЫЙ заказ —
 * иначе замену можно было бы крутить бесконечно, каждый раз получая чистый слот.
 */
export function refreshOrderByAd(
  state: GameState, orderId: string, rng: Rng, now: number,
): { ok: true; order: Order } | { ok: false; reason: string } {
  const i = state.orders.findIndex((o) => o.id === orderId);
  if (i < 0) return { ok: false, reason: 'заказ не найден' };
  const old = state.orders[i]!;
  if (old.done) return { ok: false, reason: 'заказ уже выполнен' };
  if (old.adRefreshed) return { ok: false, reason: 'этот заказ уже обновляли сегодня' };
  const fresh = generateOrder(state, rng, now);
  fresh.adRefreshed = true;
  state.orders[i] = fresh;
  return { ok: true, order: fresh };
}
