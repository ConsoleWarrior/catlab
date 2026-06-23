/**
 * Производные величины экономики и прокачки (Этап 4): вместимости, таймеры,
 * ставки дохода, стоимость апгрейдов. Чистые функции над GameState. См. GAME.md.
 */

import { calcRarity } from '../genetics/index.js';
import type { Genotype } from '../genetics/index.js';
import type { BreedingSlot, Cat, Currency, GameState, LiveRoom } from './types.js';
import * as C from './config.js';

/** Уровень апгрейда (0, если не куплен). */
export function lvl(state: GameState, id: string): number {
  return state.upgrades[id] ?? 0;
}

export function emptySlot(): BreedingSlot {
  return { motherId: null, fatherId: null, startedAt: 0, readyAt: 0 };
}

export function slotCount(state: GameState): number {
  return state.slots.length;
}

export function nurseryCapacity(state: GameState): number {
  return C.NURSERY_BASE_CAP + C.NURSERY_CAP_STEP * lvl(state, 'nurseryCap');
}

export function shelterCapacity(state: GameState): number {
  return C.SHELTER_BASE_CAP + C.SHELTER_CAP_STEP * lvl(state, 'shelterCap');
}

export function capacityOf(state: GameState, room: LiveRoom): number {
  return room === 'nursery' ? nurseryCapacity(state) : shelterCapacity(state);
}

export function incubationDuration(state: GameState): number {
  return Math.max(C.INCUBATION_MIN_MS, C.INCUBATION_BASE_MS - C.SPEED_STEP_MS * lvl(state, 'speed'));
}

export function mutationRate(state: GameState): number {
  return Math.min(C.MUTATION_MAX, C.MUTATION_BASE + C.MUTATION_STEP * lvl(state, 'mutation'));
}

export function offlineCapMin(state: GameState): number {
  return C.OFFLINE_CAP_BASE_MIN + C.OFFLINE_CAP_STEP_MIN * lvl(state, 'offline');
}

export function catsIn(state: GameState, room: LiveRoom): Cat[] {
  return state.cats.filter((c) => c.location === room);
}

/** Кот занят, если участвует в активной вязке. */
export function isBusy(state: GameState, catId: string): boolean {
  return state.slots.some((s) => s.readyAt > 0 && (s.motherId === catId || s.fatherId === catId));
}

/** Суммарный пассивный доход питомника (💰/мин) с учётом «Выставки». */
export function passiveRatePerMin(state: GameState): number {
  const mult = 1 + C.SHOW_BONUS_STEP * lvl(state, 'show');
  let rate = 0;
  for (const c of state.cats) {
    if (c.location === 'nursery') rate += C.TIER_VALUE[c.rarityTier].incomePerMin;
  }
  return rate * mult;
}

/** Стоимость покупки простого кота. Если котов нет вовсе — первый бесплатно (анти-софт-лок). */
export function buyCatCost(state: GameState): number {
  return state.cats.length === 0 ? 0 : C.STARTER_CAT_COST;
}

/** Награда за пристройство кота: 💰 (с учётом «Связей») + 🧬 (с учётом «Биобанка»). */
export function adoptReward(state: GameState, cat: Cat): { coins: number; dna: number } {
  const v = C.TIER_VALUE[cat.rarityTier];
  return {
    coins: Math.round(v.adopt * (1 + C.CONNECTIONS_STEP * lvl(state, 'connections'))),
    dna: Math.round(v.dna * (1 + C.BIOBANK_STEP * lvl(state, 'biobank'))),
  };
}

/** Стоимость следующего уровня апгрейда (или null, если апгрейда нет). */
export function upgradeCost(state: GameState, id: string): { currency: Currency; amount: number } | null {
  if (id === 'slots') {
    const def = C.UPGRADES.slots!;
    const level = state.slots.length - 1; // 0 = покупаем 2-й слот
    return { currency: def.currency, amount: Math.round(def.baseCost * def.mult ** level) };
  }
  const def = C.UPGRADES[id];
  if (!def) return null;
  return { currency: def.currency, amount: Math.round(def.baseCost * def.mult ** lvl(state, id)) };
}

export function upgradeMaxed(state: GameState, id: string): boolean {
  if (id === 'slots') return state.slots.length - 1 >= C.UPGRADES.slots!.max;
  const def = C.UPGRADES[id];
  return def ? lvl(state, id) >= def.max : true;
}

/** Создаёт экземпляр кота из генотипа (с кэшем тира и новым id). Мутирует nextId. */
export function makeCatInstance(
  state: GameState,
  genotype: Genotype,
  now: number,
  location: LiveRoom = 'nursery',
): Cat {
  return {
    id: 'cat' + state.nextId++,
    genotype,
    bornAt: now,
    location,
    rarityTier: calcRarity(genotype).tier,
    analyzed: false,
  };
}
