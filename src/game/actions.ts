/**
 * Действия игрока над состоянием (Этап 4). Мутируют GameState, возвращают Result.
 * Время передаётся параметром `now` (тестируемо), RNG — параметром. См. GAME.md §10.
 */

import { breed, isLethal, simpleCat } from '../genetics/index.js';
import type { Rng } from '../genetics/index.js';
import type { Cat, Currency, GameState, LiveRoom } from './types.js';
import * as C from './config.js';
import * as E from './economy.js';
import { matchesOrder } from './orders.js';

export type Result<T = unknown> = ({ ok: true } & T) | { ok: false; reason: string };

function findCat(state: GameState, id: string): Cat | undefined {
  return state.cats.find((c) => c.id === id);
}

function canAfford(state: GameState, currency: Currency, amount: number): boolean {
  return state[currency] >= amount;
}

function spend(state: GameState, currency: Currency, amount: number): boolean {
  if (state[currency] < amount) return false;
  state[currency] -= amount;
  return true;
}

// --- Доход ---

/** Начисляет пассивный доход питомника с момента lastSeenAt (с потолком офлайна). */
export function collectIncome(state: GameState, now: number): { coins: number } {
  const elapsedMin = Math.max(0, (now - state.lastSeenAt) / 60_000);
  const capped = Math.min(elapsedMin, E.offlineCapMin(state));
  const coins = Math.floor(E.passiveRatePerMin(state) * capped);
  state.coins += coins;
  state.lastSeenAt = now;
  return { coins };
}

// --- Инкубатор ---

export function startBreeding(
  state: GameState,
  slotIndex: number,
  motherId: string,
  fatherId: string,
  now: number,
): Result {
  const slot = state.slots[slotIndex];
  if (!slot) return { ok: false, reason: 'нет такого слота' };
  if (slot.readyAt > 0) return { ok: false, reason: 'слот занят' };
  if (motherId === fatherId) return { ok: false, reason: 'нужны два разных кота' };
  const mother = findCat(state, motherId);
  const father = findCat(state, fatherId);
  if (!mother || !father) return { ok: false, reason: 'кот не найден' };
  if (mother.genotype.sex !== 'female') return { ok: false, reason: 'мама должна быть самкой' };
  if (father.genotype.sex !== 'male') return { ok: false, reason: 'папа должен быть самцом' };
  if (E.isBusy(state, motherId) || E.isBusy(state, fatherId)) {
    return { ok: false, reason: 'кот уже занят в вязке' };
  }
  // резервируем место в питомнике под будущего котёнка
  const pending = state.slots.filter((s) => s.readyAt > 0).length;
  if (E.catsIn(state, 'nursery').length + pending >= E.nurseryCapacity(state)) {
    return { ok: false, reason: 'нет места в питомнике — пристрой котиков' };
  }
  slot.motherId = motherId;
  slot.fatherId = fatherId;
  slot.startedAt = now;
  slot.readyAt = now + E.incubationDuration(state);
  return { ok: true };
}

export interface BirthEvent {
  slotIndex: number;
  kitten?: Cat;
  stillborn: boolean;
}

/** Забирает всех готовых котят из инкубатора. Обрабатывает летальные комбо. */
export function collectReady(state: GameState, now: number, rng: Rng): BirthEvent[] {
  const events: BirthEvent[] = [];
  for (let i = 0; i < state.slots.length; i++) {
    const slot = state.slots[i];
    if (!slot || slot.readyAt === 0 || now < slot.readyAt) continue;
    const mother = slot.motherId ? findCat(state, slot.motherId) : undefined;
    const father = slot.fatherId ? findCat(state, slot.fatherId) : undefined;
    // освобождаем слот в любом случае
    slot.motherId = null;
    slot.fatherId = null;
    slot.startedAt = 0;
    slot.readyAt = 0;
    if (!mother || !father) continue; // родителя удалили — вязка отменяется

    const rate = E.mutationRate(state);
    let child = breed(mother.genotype, father.genotype, rng, rate);
    let guard = 0;
    while (isLethal(child) && guard++ < 8) child = breed(mother.genotype, father.genotype, rng, rate);
    if (isLethal(child)) {
      events.push({ slotIndex: i, stillborn: true });
      continue;
    }
    const kitten = E.makeCatInstance(state, child, now, 'nursery');
    state.cats.push(kitten);
    events.push({ slotIndex: i, kitten, stillborn: false });
  }
  return events;
}

/** Купить простого кота в питомник (первый бесплатно, если котов нет). */
export function buyCat(state: GameState, rng: Rng, now: number): Result<{ cat: Cat }> {
  if (E.catsIn(state, 'nursery').length >= E.nurseryCapacity(state)) {
    return { ok: false, reason: 'нет места в питомнике' };
  }
  const cost = E.buyCatCost(state);
  if (!spend(state, 'coins', cost)) return { ok: false, reason: 'не хватает монет' };
  const cat = E.makeCatInstance(state, simpleCat(rng), now, 'nursery');
  state.cats.push(cat);
  return { ok: true, cat };
}

// --- Комнаты ---

/** Пристройство кота «в добрые руки»: 💰 + 🧬, кот покидает коллекцию. */
export function adoptCat(state: GameState, catId: string): Result<{ coins: number; dna: number }> {
  const cat = findCat(state, catId);
  if (!cat) return { ok: false, reason: 'кот не найден' };
  if (E.isBusy(state, catId)) return { ok: false, reason: 'кот занят в вязке' };
  const { coins, dna } = E.adoptReward(state, cat);
  state.coins += coins;
  state.dna += dna;
  state.cats = state.cats.filter((c) => c.id !== catId);
  return { ok: true, coins, dna };
}

/** Перемещение кота между питомником и приютом (с учётом вместимости). */
export function moveCat(state: GameState, catId: string, room: LiveRoom): Result {
  const cat = findCat(state, catId);
  if (!cat) return { ok: false, reason: 'кот не найден' };
  if (cat.location === room) return { ok: true };
  if (E.catsIn(state, room).length >= E.capacityOf(state, room)) {
    return { ok: false, reason: 'нет места' };
  }
  cat.location = room;
  return { ok: true };
}

// --- Прокачка ---

export function buyUpgrade(state: GameState, id: string): Result {
  if (E.upgradeMaxed(state, id)) return { ok: false, reason: 'максимальный уровень' };
  const cost = E.upgradeCost(state, id);
  if (!cost) return { ok: false, reason: 'нет такого апгрейда' };
  if (!canAfford(state, cost.currency, cost.amount)) return { ok: false, reason: 'не хватает ресурсов' };
  spend(state, cost.currency, cost.amount);
  if (id === 'slots') state.slots.push(E.emptySlot());
  else state.upgrades[id] = E.lvl(state, id) + 1;
  return { ok: true };
}

// --- Генолаб ---

export function unlockGene(state: GameState, geneId: string): Result {
  const def = C.GENES[geneId];
  if (!def) return { ok: false, reason: 'нет такого гена' };
  if (state.unlockedGenes.includes(geneId)) return { ok: false, reason: 'уже открыт' };
  if (!spend(state, 'dna', def.dna)) return { ok: false, reason: 'не хватает ДНК' };
  state.unlockedGenes.push(geneId);
  return { ok: true };
}

export function analyzeCat(state: GameState, catId: string): Result {
  const cat = findCat(state, catId);
  if (!cat) return { ok: false, reason: 'кот не найден' };
  if (cat.analyzed) return { ok: true };
  if (!spend(state, 'dna', C.ANALYZE_DNA_COST)) return { ok: false, reason: 'не хватает ДНК' };
  cat.analyzed = true;
  return { ok: true };
}

// --- Заказы ---

/** Выполнить заказ подходящим котом: награда + репутация, кот уезжает к клиенту. */
export function claimOrder(
  state: GameState,
  orderId: string,
  catId: string,
  now: number,
): Result<{ reward: import('./types.js').OrderReward }> {
  const order = state.orders.find((o) => o.id === orderId);
  if (!order) return { ok: false, reason: 'заказ не найден' };
  if (order.expiresAt > 0 && now > order.expiresAt) return { ok: false, reason: 'заказ просрочен' };
  const cat = findCat(state, catId);
  if (!cat) return { ok: false, reason: 'кот не найден' };
  if (E.isBusy(state, catId)) return { ok: false, reason: 'кот занят в вязке' };
  if (!matchesOrder(order, cat)) return { ok: false, reason: 'кот не подходит под заказ' };

  state.coins += order.reward.coins;
  state.crystals += order.reward.crystals;
  state.dna += order.reward.dna;
  state.reputation += order.reward.reputation;
  state.level = C.levelForReputation(state.reputation);
  state.orders = state.orders.filter((o) => o.id !== orderId);
  state.cats = state.cats.filter((c) => c.id !== catId);
  return { ok: true, reward: order.reward };
}
