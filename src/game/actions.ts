/**
 * Действия игрока над состоянием (Этап 4). Мутируют GameState, возвращают Result.
 * Время передаётся параметром `now` (тестируемо), RNG — параметром. См. GAME.md §10.
 */

import { breed, isLethal, simpleCat, breedKitten } from '../genetics/index.js';
import type { Rng, BreedBoosts } from '../genetics/index.js';
import type { Cat, Currency, GameState, LiveRoom } from './types.js';
import * as C from './config.js';
import * as E from './economy.js';
import { matchesOrder } from './orders.js';
import { buildPedigree } from './pedigree.js';

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
  if (!E.isAdult(mother, now) || !E.isAdult(father, now)) {
    return { ok: false, reason: 'котёнок ещё не вырос' };
  }
  if (E.isOld(mother) || E.isOld(father)) {
    return { ok: false, reason: 'кот слишком стар для вязки' };
  }
  if (E.isBusy(state, motherId) || E.isBusy(state, fatherId)) {
    return { ok: false, reason: 'кот уже занят в вязке' };
  }
  // Место в питомнике НЕ требуется: вязку можно запустить всегда, котёнок
  // родится даже при переполненном питомнике (его потом пристраивают).
  slot.motherId = motherId;
  slot.fatherId = fatherId;
  slot.startedAt = now;
  slot.readyAt = now + E.incubationDuration(state);
  // вязка засчитана обоим: приближает к статусу «Старый»
  mother.breedCount = (mother.breedCount ?? 0) + 1;
  father.breedCount = (father.breedCount ?? 0) + 1;
  return { ok: true };
}

/**
 * Поставить кота в слот вязки (перетаскиванием). Кот занимает место по полу:
 * самка → «мама», самец → «папа». Если место в этой роли уже занято другим
 * котом — он просто освобождается (коты «меняются местами»). Слот с активной
 * вязкой (readyAt > 0) трогать нельзя. Само рождение запускается кнопкой «Свести».
 */
export function assignBreeder(state: GameState, slotIndex: number, catId: string, now: number): Result {
  const slot = state.slots[slotIndex];
  if (!slot) return { ok: false, reason: 'нет такого слота' };
  if (slot.readyAt > 0) return { ok: false, reason: 'слот занят вязкой' };
  const cat = findCat(state, catId);
  if (!cat) return { ok: false, reason: 'кот не найден' };
  if (!E.isAdult(cat, now)) return { ok: false, reason: 'котёнок ещё не вырос' };
  if (E.isOld(cat)) return { ok: false, reason: 'кот слишком стар для вязки' };
  if (E.isBusy(state, catId)) return { ok: false, reason: 'кот уже занят в вязке' };
  // снимаем кота с других неактивных слотов, чтобы он не «раздваивался»
  for (const s of state.slots) {
    if (s.readyAt > 0) continue;
    if (s.motherId === catId) s.motherId = null;
    if (s.fatherId === catId) s.fatherId = null;
  }
  if (cat.genotype.sex === 'female') slot.motherId = catId;
  else slot.fatherId = catId;
  return { ok: true };
}

/**
 * Снять кота со всех неактивных слотов вязки (при перетаскивании из слота
 * обратно в комнату или возврате кнопкой). Слот с идущей вязкой не трогаем.
 * Возвращает true, если кот где-то стоял.
 */
export function clearBreederSlot(state: GameState, catId: string): boolean {
  let removed = false;
  for (const s of state.slots) {
    if (s.readyAt > 0) continue;
    if (s.motherId === catId) { s.motherId = null; removed = true; }
    if (s.fatherId === catId) { s.fatherId = null; removed = true; }
  }
  return removed;
}

export interface BirthEvent {
  slotIndex: number;
  kitten?: Cat;
  stillborn: boolean;
  motherBreed?: string;       // родословная (для карточки рождения)
  fatherBreed?: string;
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
    // Порода котёнка — по лестнице редкости от пород родителей (прогрессия коллекции).
    // Усилители «Генной инженерии» влияют на исход; списываем только сработавшие.
    const used: BreedBoosts = {};
    // бонус родословной: цвет родителей мамы и папы повышает шанс редкого котёнка
    const extraUp = E.pedigreeBonus(mother) + E.pedigreeBonus(father);
    const childBreed = breedKitten(mother.breed, father.breed, rng, E.activeBoosts(state), used, extraUp);
    E.consumeBoosts(state, used);
    const kitten = E.makeCatInstance(state, child, now, 'nursery', childBreed);
    kitten.bornAt = now; // настоящий новорождённый — появляется маленьким и растёт
    kitten.motherBreed = mother.breed; // родословная — покажем в карточке кота
    kitten.fatherBreed = father.breed;
    kitten.pedigree = buildPedigree(mother, father, C.PEDIGREE_DEPTH); // дерево до прадедов
    state.cats.push(kitten);
    events.push({
      slotIndex: i, kitten, stillborn: false,
      motherBreed: mother.breed, fatherBreed: father.breed,
    });
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

/** Дать/сменить имя коту. Пустая строка — сбросить имя. Длина обрезается до 16. */
export function renameCat(state: GameState, catId: string, name: string): Result {
  const cat = findCat(state, catId);
  if (!cat) return { ok: false, reason: 'кот не найден' };
  const trimmed = name.trim().slice(0, 16);
  if (trimmed) cat.name = trimmed;
  else delete cat.name;
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

/**
 * Зарядить усилитель «Генной инженерии» (+1 заряд). Оплата за 🧬 гены (по
 * умолчанию) или 💎 кристаллы. Заряд тратится при рождении из инкубатора.
 */
export function buyBoost(state: GameState, id: string, currency: Currency = 'dna'): Result {
  const def = C.BOOSTS.find((b) => b.id === id);
  if (!def) return { ok: false, reason: 'нет такого усилителя' };
  const cost = currency === 'crystals' ? def.crystals : def.dna;
  if (!spend(state, currency, cost)) {
    return { ok: false, reason: currency === 'crystals' ? 'не хватает кристаллов' : 'не хватает ДНК' };
  }
  state.boosts[def.id] = (state.boosts[def.id] ?? 0) + 1;
  return { ok: true };
}

/** Изучить узел дерева исследований (постоянный бонус за 🧬). */
export function unlockResearch(state: GameState, id: string): Result {
  const def = C.RESEARCH.find((r) => r.id === id);
  if (!def) return { ok: false, reason: 'нет такого исследования' };
  if (state.research.includes(id)) return { ok: false, reason: 'уже изучено' };
  if (!def.requires.every((req) => state.research.includes(req))) {
    return { ok: false, reason: 'сначала изучи предыдущее' };
  }
  if (!spend(state, 'dna', def.dna)) return { ok: false, reason: 'не хватает ДНК' };
  state.research.push(id);
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
