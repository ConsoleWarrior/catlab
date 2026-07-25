/**
 * Действия игрока над состоянием (Этап 4). Мутируют GameState, возвращают Result.
 * Время передаётся параметром `now` (тестируемо), RNG — параметром. См. GAME.md §10.
 */

import { breed, isLethal, simpleCat, resolveBreeding, recipeKey } from '../genetics/index.js';
import type { Rng, BreedBoosts, KinshipLevel, Recipe } from '../genetics/index.js';
import type { Cat, Currency, GameState, LiveRoom } from './types.js';
import * as C from './config.js';
import * as E from './economy.js';
import { matchesOrder, replaceOrder } from './orders.js';
import { attachHiddenPedigree, buildPedigree, revealPedigree, pedigreeHasFog } from './pedigree.js';
import { buildBreedingContext, rollKittenHearts, softenKinship } from './kinship.js';
import { researchableRecipes } from './knowledge.js';

export type Result<T = unknown> = ({ ok: true } & T) | { ok: false; reason: string };

function findCat(state: GameState, id: string): Cat | undefined {
  return state.cats.find((c) => c.id === id);
}

/**
 * Убирает кота из коллекции, снимая его с выставки и с корзины заказов
 * (продажа/пристройство/лаборатория) — иначе на него осталась бы висячая ссылка.
 */
function removeCat(state: GameState, catId: string): void {
  state.cats = state.cats.filter((c) => c.id !== catId);
  // обнуляем именно его пьедестал (не .filter!), чтобы не сдвинуть соседних чемпионов
  if (state.champions) {
    const idx = state.champions.indexOf(catId);
    if (idx >= 0) state.champions[idx] = null;
  }
  if (state.orderBasket === catId) state.orderBasket = null;
}

function canAfford(state: GameState, currency: Currency, amount: number): boolean {
  return state[currency] >= amount;
}

/**
 * Начислить опыт (⭐ репутацию) и пересчитать уровень лаборатории. Единая точка для
 * всех источников опыта (рождение/продажа/пристройство/лаборатория/заказ). Возвращает
 * фактически начисленное и флаг повышения уровня — UI показывает «+N ⭐» и баннер.
 */
export function addReputation(state: GameState, amount: number): { gained: number; leveledUp: boolean } {
  const before = state.level;
  const gained = Math.max(0, Math.round(amount));
  state.reputation += gained;
  state.level = C.levelForReputation(state.reputation);
  return { gained, leveledUp: state.level > before };
}

function spend(state: GameState, currency: Currency, amount: number): boolean {
  if (state[currency] < amount) return false;
  state[currency] -= amount;
  return true;
}

// --- Доход ---

/**
 * Начисляет пассивный доход выставки с момента lastSeenAt. Корм расходуется за ВСЁ
 * отсутствие (кормушка может опустеть), а доход начисляется только за «сытые» минуты
 * и в пределах офлайн-потолка. Казну в минус не уводит (мягкий голод).
 */
export function collectIncome(state: GameState, now: number): { coins: number } {
  const elapsedMin = Math.max(0, (now - state.lastSeenAt) / 60_000);
  if (E.autoFeedEnabled(state)) E.autoFeed(state, elapsedMin); // «Автокормушка»: докупить корм за 💰
  const fedMin = E.consumeFood(state, elapsedMin); // расход корма + сколько минут были сыты
  const incomeMin = Math.min(fedMin, E.offlineCapMin(state));
  const coins = Math.floor(E.passiveRatePerMin(state) * incomeMin);
  state.coins += coins;
  state.lastSeenAt = now;
  return { coins };
}

/**
 * Купить корм в кормушку: пакет (FOOD_PACK_UNITS) или «до полного». Цена
 * пропорциональна добавленным единицам. Полная кормушка / нехватка монет — отказ.
 */
export function buyFood(state: GameState, mode: 'pack' | 'full' = 'pack'): Result<{ added: number; spent: number }> {
  const { units, cost } = E.foodBuyQuote(state, mode);
  if (units <= 0) return { ok: false, reason: 'кормушка полна' };
  if (!spend(state, 'coins', cost)) return { ok: false, reason: 'не хватает монет' };
  state.food = E.foodLevel(state) + units;
  return { ok: true, added: units, spent: cost };
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
  if (slot.kittenId) return { ok: false, reason: 'сначала пристрой малыша' };
  if (E.isStarving(state)) return { ok: false, reason: 'сначала покорми котов 🍽' };
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
  if (slot.kittenId) return { ok: false, reason: 'сначала пристрой малыша' };
  const cat = findCat(state, catId);
  if (!cat) return { ok: false, reason: 'кот не найден' };
  if (!E.isAdult(cat, now)) return { ok: false, reason: 'котёнок ещё не вырос' };
  if (E.isOld(cat)) return { ok: false, reason: 'кот слишком стар для вязки' };
  if (E.isBusy(state, catId)) return { ok: false, reason: 'кот уже занят в вязке' };
  // снимаем кота со всех других неактивных слотов, чтобы он не «раздваивался».
  // Важно и для kittenId: подросший «малыш с роднёй» уходит в соседний слот как
  // родитель — его ссылку на родном слоте надо обнулить, иначе он останется и там.
  for (const s of state.slots) {
    if (s.readyAt > 0) continue;
    if (s.motherId === catId) s.motherId = null;
    if (s.fatherId === catId) s.fatherId = null;
    if (s.kittenId === catId) s.kittenId = null;
  }
  if (cat.genotype.sex === 'female') slot.motherId = catId;
  else slot.fatherId = catId;
  // в слоте вязки коту не место на пьедестале выставки — снимаем чемпионство
  unsetChampion(state, catId);
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
    if (s.kittenId === catId) { s.kittenId = null; removed = true; }
  }
  return removed;
}

export interface BirthEvent {
  slotIndex: number;
  kitten?: Cat;
  stillborn: boolean;
  motherBreed?: string;       // родословная (для карточки рождения)
  fatherBreed?: string;
  kinship?: KinshipLevel;     // родство пары (инбридинг) — для пометки в карточке
  rep?: number;               // ⭐ опыт, начисленный за рождение (для «+N» в карточке)
  newBreed?: boolean;         // порода котёнка открыта впервые (Котодекс) — бонус к опыту
}

/** Забирает всех готовых котят из инкубатора. Обрабатывает летальные комбо. */
export function collectReady(state: GameState, now: number, rng: Rng): BirthEvent[] {
  const events: BirthEvent[] = [];
  for (let i = 0; i < state.slots.length; i++) {
    const slot = state.slots[i];
    if (!slot || slot.readyAt === 0 || now < slot.readyAt) continue;
    const mother = slot.motherId ? findCat(state, slot.motherId) : undefined;
    const father = slot.fatherId ? findCat(state, slot.fatherId) : undefined;
    // Вязка закончилась: останавливаем таймер, но РОДИТЕЛЕЙ оставляем в слоте
    // (их забирает игрок). Малыша ниже «оставим с роднёй» в центре слота.
    slot.startedAt = 0;
    slot.readyAt = 0;
    if (!mother || !father) {
      // родителя удалили — вязка отменяется, слот полностью очищаем
      slot.motherId = null;
      slot.fatherId = null;
      continue;
    }

    const rate = E.mutationRate(state);
    let child = breed(mother.genotype, father.genotype, rng, rate);
    let guard = 0;
    while (isLethal(child) && guard++ < 8) child = breed(mother.genotype, father.genotype, rng, rate);
    if (isLethal(child)) {
      events.push({ slotIndex: i, stillborn: true }); // мертворождение — родители остаются, малыша нет
      continue;
    }
    // Порода котёнка — по РЕЦЕПТАМ (прямые/сцепленные с полом/родословные) с учётом
    // родства пары (инбридинг множит шанс родословных рецептов). Усилители «Генной
    // инженерии» влияют на исход; списываем только сработавшие.
    const used: BreedBoosts = {};
    const ctx = buildBreedingContext(mother, father);
    // Исследования «Селекции»: глобальный множитель шанса всех рецептов.
    const childBreed = resolveBreeding(ctx, rng, E.activeBoosts(state), used, E.breedChanceMult(state));
    E.consumeBoosts(state, used);
    // «Новая порода» — проверяем ДО makeCatInstance: он сам добавит породу в Котодекс.
    const newBreed = !state.discoveredBreeds.includes(childBreed);
    const kitten = E.makeCatInstance(state, child, now, 'nursery', childBreed);
    kitten.bornAt = now; // настоящий новорождённый — появляется маленьким и растёт
    kitten.motherBreed = mother.breed; // родословная — покажем в карточке кота
    kitten.fatherBreed = father.breed;
    kitten.pedigree = buildPedigree(mother, father, C.PEDIGREE_DEPTH); // дерево до прадедов
    // Анализ производителей «протекает» в потомка: если оба родителя изучены,
    // родословная досталась без тумана — котёнок рождается уже изученным. Его
    // скрытые гены (породы предков) видны сразу, а кнопки анализа нет — вскрывать
    // нечего. Если у родителей был туман — котёнок наследует его и анализ остаётся.
    if (!pedigreeHasFog(kitten)) kitten.analyzed = true;
    // Цена инбридинга: котёнок может родиться с урезанным запасом сердец (0 —
    // «Бесплодный», тупик). «Генетические маркеры» снижают риск, «Витамины роста»
    // дают +1 ❤ (но бесплодных 0 ❤ не спасают — честный тупик).
    // 🛡-перк: пока Стабилизатор активен, бросок ❤ идёт по родству «на ступень мягче»
    // (заряд перк не тратит — бонус активности; рецептный множитель от настоящего родства).
    const heartsKinship = E.activeBoostId(state) === 'noDown' ? softenKinship(ctx.kinship) : ctx.kinship;
    const baseHearts = rollKittenHearts(heartsKinship, rng, E.kinshipSafety(state));
    kitten.maxHearts = E.applyExtraHearts(baseHearts, E.extraHearts(state));
    state.cats.push(kitten);
    // ⭐ опыт за рождение: доля от РЫНОЧНОЙ ЦЕННОСТИ котёнка (тир × порода × родословная
    // × здоровье — гринд дворовых даёт крохи, а трудная порода с чистой линией платит
    // заметно больше), с ×множителем за первое открытие породы. Считается ПОСЛЕ броска
    // сердец: инбридинговый котёнок дешевле → и опыта за него меньше.
    const rep = Math.round(E.catMarketValue(kitten) * C.REP_BIRTH_RATE)
      * (newBreed ? C.REP_NEW_BREED_MULT : 1);
    addReputation(state, rep);
    // Малыш «на руках» в центре слота: родители рядом, перегородка поднята.
    // Игрок решит в карточке рождения — в питомник, в приют или оставить с роднёй.
    slot.kittenId = kitten.id;
    events.push({
      slotIndex: i, kitten, stillborn: false,
      motherBreed: mother.breed, fatherBreed: father.breed,
      kinship: ctx.kinship, rep: Math.round(rep), newBreed,
    });
  }
  return events;
}

/** Купить простого кота в приют (первый бесплатно, если котов нет). */
export function buyCat(state: GameState, rng: Rng, now: number): Result<{ cat: Cat }> {
  if (E.roomCount(state, 'shelter') >= E.shelterCapacity(state)) {
    return { ok: false, reason: 'нет места в приюте' };
  }
  const cost = E.buyCatCost(state);
  if (!spend(state, 'coins', cost)) return { ok: false, reason: 'не хватает монет' };
  const cat = E.makeCatInstance(state, simpleCat(rng), now, 'shelter');
  cat.isNew = true; // бейдж «новый» над котом, пока не откроют его инфо-меню
  attachHiddenPedigree(state, cat, rng); // лотерея скрытых генов у купленного дворового
  state.cats.push(cat);
  return { ok: true, cat };
}

// --- Комнаты ---

/** Пристройство кота «в добрые руки»: 💰 + 🧬 + ⭐ опыт, кот покидает коллекцию. */
export function adoptCat(state: GameState, catId: string): Result<{ coins: number; dna: number; rep: number }> {
  const cat = findCat(state, catId);
  if (!cat) return { ok: false, reason: 'кот не найден' };
  if (E.isBusy(state, catId)) return { ok: false, reason: 'кот занят в вязке' };
  const { coins, dna } = E.adoptReward(state, cat);
  state.coins += coins;
  state.dna += dna;
  const { gained: rep } = addReputation(state, E.catMarketValue(cat) * C.REP_ADOPT_MULT);
  removeCat(state, catId);
  return { ok: true, coins, dna, rep };
}

/** Сдать кота в лабораторию «на эксперименты»: 🧬 + немного 💰 + ⭐ опыт, кот уезжает. */
export function sendToLab(state: GameState, catId: string): Result<{ dna: number; coins: number; rep: number }> {
  const cat = findCat(state, catId);
  if (!cat) return { ok: false, reason: 'кот не найден' };
  if (!E.isUnlocked(state, 'labStation')) return { ok: false, reason: 'locked' };
  if (E.isBusy(state, catId)) return { ok: false, reason: 'кот занят в вязке' };
  const { dna, coins } = E.labReward(state, cat);
  state.dna += dna;
  state.coins += coins;
  const { gained: rep } = addReputation(state, E.catMarketValue(cat) * C.REP_LAB_MULT);
  removeCat(state, catId);
  return { ok: true, dna, coins, rep };
}

/** Свободные (не занятые вязкой) коты приюта — цель массовых действий комнаты. */
function shelterFree(state: GameState): Cat[] {
  return E.catsIn(state, 'shelter').filter((c) => !E.isBusy(state, c.id));
}

/**
 * Раздать «в добрые руки» ВСЕХ котов приюта разом. Награда — сумма поштучных
 * adoptCat (та же цена, что по одному). Занятые вязкой коты пропускаются.
 */
export function adoptAll(state: GameState): Result<{ coins: number; dna: number; rep: number; count: number }> {
  const cats = shelterFree(state);
  if (cats.length === 0) return { ok: false, reason: 'В приюте некого раздавать' };
  let coins = 0, dna = 0, rep = 0, count = 0;
  for (const cat of cats) {
    const r = adoptCat(state, cat.id);
    if (!r.ok) continue;
    coins += r.coins; dna += r.dna; rep += r.rep; count++;
  }
  return { ok: true, coins, dna, rep, count };
}

/**
 * Сдать в лабораторию ВСЕХ котов приюта разом за 🧬 (+ немного 💰). Требует открытой
 * лаборатории (labStation). Занятые вязкой коты пропускаются.
 */
export function sendAllToLab(state: GameState): Result<{ dna: number; coins: number; rep: number; count: number }> {
  if (!E.isUnlocked(state, 'labStation')) return { ok: false, reason: 'locked' };
  const cats = shelterFree(state);
  if (cats.length === 0) return { ok: false, reason: 'В приюте некого сдавать' };
  let dna = 0, coins = 0, rep = 0, count = 0;
  for (const cat of cats) {
    const r = sendToLab(state, cat.id);
    if (!r.ok) continue;
    dna += r.dna; coins += r.coins; rep += r.rep; count++;
  }
  return { ok: true, dna, coins, rep, count };
}

// --- Выставка (чемпионы) ---

/**
 * Выставить кота чемпионом на КОНКРЕТНЫЙ пьедестал (приносит пассивный доход).
 * Источник кота определяет, что происходит со «снятым» с этого пьедестала чемпионом
 * (если он там был):
 *  - кот пришёл с другого пьедестала → прямой обмен местами;
 *  - кот пришёл с пола (питомник/приют) → меняются местами (снятый чемпион занимает
 *    ровно то место на полу, которое освободил пришедший — вместимость не страдает);
 *  - кот пришёл из слота вязки инкубатора → обмена НЕТ (нельзя впихнуть чемпиона в
 *    роль вязки): снятому чемпиону ищем физический дом — питомник, иначе приют, иначе
 *    отказ («нет места в лаборатории»), и сам слот вязки не трогаем.
 */
export function setChampion(state: GameState, catId: string, slotIndex: number, now: number): Result {
  const cat = findCat(state, catId);
  if (!cat) return { ok: false, reason: 'кот не найден' };
  if (!E.isAdult(cat, now)) return { ok: false, reason: 'котёнок ещё не вырос' };
  if (slotIndex < 0 || slotIndex >= E.championSlots(state)) {
    return { ok: false, reason: 'пьедестал заперт' };
  }
  if (!state.champions) state.champions = [];
  while (state.champions.length <= slotIndex) state.champions.push(null);
  if (state.champions[slotIndex] === catId) return { ok: true }; // уже тут

  const ownIdx = state.champions.indexOf(catId);
  const displacedId = state.champions[slotIndex];
  const displaced = displacedId ? findCat(state, displacedId) : undefined;

  if (ownIdx >= 0) {
    // сам уже чемпион на другом пьедестале — прямой обмен слотами
    state.champions[ownIdx] = displacedId ?? null;
  } else if (E.isInSlot(state, catId)) {
    // источник — слот вязки: обмена нет, снятому чемпиону ищем физический дом
    if (displaced) {
      if (E.roomCount(state, 'nursery') < E.nurseryCapacity(state)) displaced.location = 'nursery';
      else if (E.roomCount(state, 'shelter') < E.shelterCapacity(state)) displaced.location = 'shelter';
      else return { ok: false, reason: 'нет места в лаборатории' };
    }
    clearBreederSlot(state, catId);
  } else if (displaced) {
    // источник — кот с пола: меняются местами (снятый чемпион — на освободившееся место)
    displaced.location = cat.location;
  }

  cat.location = 'nursery';
  state.champions[slotIndex] = catId;
  return { ok: true };
}

/** Снять кота с выставки (не трогая соседние пьедесталы). */
export function unsetChampion(state: GameState, catId: string): Result {
  if (state.champions) {
    const idx = state.champions.indexOf(catId);
    if (idx >= 0) state.champions[idx] = null;
  }
  return { ok: true };
}

/** Мгновенно завершить вязку в слоте за 💎 (скип таймера). Стоимость ∝ остатку времени. */
export function speedUpBreeding(state: GameState, slotIndex: number, now: number): Result<{ crystals: number }> {
  const slot = state.slots[slotIndex];
  if (!slot) return { ok: false, reason: 'нет такого слота' };
  if (slot.readyAt === 0) return { ok: false, reason: 'слот не занят вязкой' };
  const remaining = Math.max(0, slot.readyAt - now);
  const cost = E.speedUpCost(remaining, C.BREED_SPEEDUP_CRYSTAL_PER_MIN);
  if (cost > 0 && !spend(state, 'crystals', cost)) return { ok: false, reason: 'не хватает кристаллов' };
  slot.readyAt = now; // готово немедленно — collectReady заберёт котёнка
  return { ok: true, crystals: cost };
}

/** Реклама: сократить остаток вязки на AD_SKIP_MS (бесплатно, можно повторять). */
export function adSkipBreeding(state: GameState, slotIndex: number, now: number): Result {
  const slot = state.slots[slotIndex];
  if (!slot) return { ok: false, reason: 'нет такого слота' };
  if (slot.readyAt === 0) return { ok: false, reason: 'слот не занят вязкой' };
  slot.readyAt = Math.max(now, slot.readyAt - C.AD_SKIP_MS);
  return { ok: true };
}

/** Мгновенно вырастить котёнка за 💎 (скип роста). Стоимость ∝ остатку роста. */
export function speedUpGrowth(state: GameState, catId: string, now: number): Result<{ crystals: number }> {
  const cat = findCat(state, catId);
  if (!cat) return { ok: false, reason: 'кот не найден' };
  const remaining = E.growthRemainingMs(cat, now);
  if (remaining <= 0) return { ok: true, crystals: 0 };
  const cost = E.speedUpCost(remaining, C.GROWTH_SPEEDUP_CRYSTAL_PER_MIN);
  if (!spend(state, 'crystals', cost)) return { ok: false, reason: 'не хватает кристаллов' };
  cat.bornAt = now - E.effGrowthMs(cat); // возраст ≥ срок → сразу взрослый
  return { ok: true, crystals: cost };
}

/**
 * Клиника (шприц): восстановить коту потраченные вязки (`breedCount`), НЕ `maxHearts` —
 * генетический потолок от инбридинга неизлечим, «Бесплодных» (0 ❤) клиника не берёт.
 * Два способа: '📺 ad' = +HEAL_AD_HEARTS без кулдауна (заглушка рекламы, как analyzeCat);
 * '💎 crystals' = полное восстановление, цена ∝ потраченным сердцам.
 * Гейт — уровень лаборатории (LAB_UNLOCKS.clinic).
 */
export function healCat(
  state: GameState, catId: string, mode: 'ad' | 'crystals', now: number,
): Result<{ healed: number; crystals: number }> {
  const cat = findCat(state, catId);
  if (!cat) return { ok: false, reason: 'кот не найден' };
  if (!E.isUnlocked(state, 'clinic')) return { ok: false, reason: 'locked' };
  if (E.isSterile(cat)) return { ok: false, reason: 'бесплодного не вылечить' };
  if (E.isInSlot(state, catId)) return { ok: false, reason: 'кот в слоте вязки' };
  const spent = cat.breedCount ?? 0;
  if (spent <= 0) return { ok: false, reason: 'кот полностью здоров' };
  if (mode === 'ad') {
    const healed = Math.min(spent, C.HEAL_AD_HEARTS);
    cat.breedCount = spent - healed;   // реклама-заглушка, реальный SDK — бэклог
    state.lastHealAdAt = Math.max(1, now); // фиксируем факт просмотра (кулдауна нет)
    return { ok: true, healed, crystals: 0 };
  }
  const cost = C.HEAL_CRYSTAL_PER_HEART * spent;
  if (!spend(state, 'crystals', cost)) return { ok: false, reason: 'не хватает кристаллов' };
  cat.breedCount = 0;                  // полное восстановление
  return { ok: true, healed: spent, crystals: cost };
}

/** Реклама: сократить остаток роста котёнка на KITTEN_GROWTH_AD_MS (−15 мин → сразу взрослый). */
export function adSkipGrowth(state: GameState, catId: string, now: number): Result {
  const cat = findCat(state, catId);
  if (!cat) return { ok: false, reason: 'кот не найден' };
  if (E.growthRemainingMs(cat, now) <= 0) return { ok: true };
  cat.bornAt -= C.KITTEN_GROWTH_AD_MS; // сдвигаем рождение назад → остаток роста уменьшается
  return { ok: true };
}

/** Перемещение кота между питомником и приютом (с учётом вместимости). */
export function moveCat(state: GameState, catId: string, room: LiveRoom): Result {
  const cat = findCat(state, catId);
  if (!cat) return { ok: false, reason: 'кот не найден' };
  // Кот физически «не на полу», хотя location может формально совпадать с целевой
  // комнатой: либо в слоте инкубатора (родитель вязки / малыш с роднёй), либо на
  // пьедестале выставки (чемпион). В обоих случаях ранний выход по location — ложный,
  // иначе пристройство проскакивает проверку вместимости.
  const grounded = !E.isInSlot(state, catId) && !E.isChampion(state, catId);
  if (grounded && cat.location === room) return { ok: true };
  if (E.roomCount(state, room) >= E.capacityOf(state, room)) {
    return { ok: false, reason: 'нет места' };
  }
  cat.location = room;
  const heldSlot = state.slots.find((s) => s.kittenId === catId);
  if (heldSlot) heldSlot.kittenId = null; // унесли малыша → слот свободен под новую пару
  unsetChampion(state, catId); // переехал на пол — с пьедестала снят (no-op, если не был чемпионом)
  return { ok: true };
}

/**
 * Оставить новорождённого в слоте с родителями (на крайний случай, когда мест нигде
 * нет): малыш сидит в центре слота, растёт втрое медленнее (KITTEN_SLOW_FACTOR) и
 * блокирует постановку новых котов, пока его не унесут в комнату. kittenId уже стоит
 * на слоте (его поставил collectReady) — здесь только включаем медленный рост.
 */
export function keepKittenWithParents(state: GameState, catId: string, now: number): Result {
  const cat = findCat(state, catId);
  if (!cat) return { ok: false, reason: 'кот не найден' };
  cat.growthMs = C.KITTEN_GROWTH_MS * C.KITTEN_SLOW_FACTOR;
  cat.bornAt = now; // отсчёт взросления — заново, в медленном темпе
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

// --- Крио-банк (криохранилище коллекции) ---

/**
 * Заморозить кота в криокапсулу: он уходит из `state.cats` в `state.cryo` как есть
 * (сердца/вязки/родословная сохраняются). В капсуле не ест, не приносит доход и
 * недоступен для вязки — витрина коллекции без живого кота на сцене.
 * Оплата (по образцу клиники/анализа): '📺 ad' — бесплатно с глобальным кулдауном
 * (заглушка рекламы), '💰 coins' (FREEZE_COIN_COST) или '💎 crystals' (FREEZE_CRYSTAL_COST).
 * Ограничения: крио-банк открыт (узел «Криогенетика»), кот взрослый, не в слоте
 * вязки, не чемпион (сначала снять с пьедестала), есть свободная капсула.
 * РАЗМОРОЗКИ НЕТ (решение дизайна) — освободить капсулу можно только утилизацией.
 */
export function freezeCat(
  state: GameState, catId: string, mode: 'ad' | 'coins' | 'crystals' = 'ad', now = 0,
): Result<{ coins: number; crystals: number }> {
  const cat = findCat(state, catId);
  if (!cat) return { ok: false, reason: 'кот не найден' };
  if (!E.cryoUnlocked(state)) return { ok: false, reason: 'locked' };
  if (!E.isAdult(cat, now)) return { ok: false, reason: 'котёнок ещё не вырос' };
  if (E.isInSlot(state, catId)) return { ok: false, reason: 'кот в слоте вязки' };
  if (E.isChampion(state, catId)) return { ok: false, reason: 'сначала снять с пьедестала' };
  if (E.cryoCount(state) >= E.cryoCapacity(state)) return { ok: false, reason: 'нет свободной капсулы' };
  // Оплата — только после того, как заморозка гарантированно пройдёт (ничего не спишем впустую).
  let coins = 0, crystals = 0;
  if (mode === 'ad') {
    // lastFreezeAdAt = 0 → рекламу ещё ни разу не смотрели (кулдауна нет)
    if (state.lastFreezeAdAt > 0 && now - state.lastFreezeAdAt < C.FREEZE_AD_COOLDOWN_MS) {
      return { ok: false, reason: 'реклама заморозки ещё недоступна' };
    }
    state.lastFreezeAdAt = Math.max(1, now); // 0 зарезервирован под «не смотрели»
  } else if (mode === 'coins') {
    if (!spend(state, 'coins', C.FREEZE_COIN_COST)) return { ok: false, reason: 'не хватает монет' };
    coins = C.FREEZE_COIN_COST;
  } else {
    if (!spend(state, 'crystals', C.FREEZE_CRYSTAL_COST)) return { ok: false, reason: 'не хватает кристаллов' };
    crystals = C.FREEZE_CRYSTAL_COST;
  }
  removeCat(state, catId);   // убрать из cats (с выставки уже сняли бы — чемпиону отказали)
  if (!state.cryo) state.cryo = [];
  state.cryo.push(cat);
  return { ok: true, coins, crystals };
}

/**
 * Клонировать замороженного кота за 🧬 + 💰 (цена 🧬 = ×CLONE_LAB_MULT от выхода лаборатории
 * этого экземпляра, цена 💰 = ×10 от цены в 🧬, см. cloneCostCoins). Клон = ТОЧНАЯ копия
 * оригинала: генотип/порода/пол/внешность и родословная совпадают; сразу `analyzed`
 * (клонирование = полное секвенирование); `maxHearts` наследуется (бесплодный клонируется
 * бесплодным), `breedCount = 0`. Появляется маленьким котёнком в питомнике и растёт (как
 * настоящий). Оригинал остаётся в капсуле. Анти-эксплойты: у клона та же родословная, что у
 * оригинала → они делят всех предков, поэтому клон×оригинал (и клон×клон) даёт
 * критическое родство, «фабрику чистых пар» не собрать; опыта ⭐ за клона нет (не
 * рождение), порода не переоткрывается.
 */
export function cloneCat(
  state: GameState, cryoId: string, now: number,
): Result<{ clone: Cat; dna: number; coins: number }> {
  const original = (state.cryo ?? []).find((c) => c.id === cryoId);
  if (!original) return { ok: false, reason: 'капсула не найдена' };
  if (!E.cryoUnlocked(state)) return { ok: false, reason: 'locked' };
  if (E.roomCount(state, 'nursery') >= E.nurseryCapacity(state)) {
    return { ok: false, reason: 'нет места в питомнике' };
  }
  const cost = E.cloneCost(original);
  const coinsCost = E.cloneCostCoins(original);
  if (state.dna < cost) return { ok: false, reason: 'не хватает ДНК' };
  if (state.coins < coinsCost) return { ok: false, reason: 'не хватает монет' };
  spend(state, 'dna', cost);
  spend(state, 'coins', coinsCost);
  // genotype — глубокая копия (клон не должен делить ссылку с оригиналом в капсуле)
  const genotype = structuredClone(original.genotype);
  const clone = E.makeCatInstance(state, genotype, now, 'nursery', original.breed);
  clone.bornAt = now;                    // клон появляется маленьким и растёт (как настоящий)
  clone.maxHearts = original.maxHearts;  // потолок сердец наследуется от оригинала
  clone.analyzed = true;                 // клонирование = полное секвенирование → геном/родословная уже изучены
  clone.artId = original.artId ?? original.id; // тот же вариант базового арта, что у оригинала
  // Родословная — точная копия оригинала (те же предки → идентичный облик и родство).
  // Fallback для legacy-котов без сохранённого дерева: оригинал как оба родителя.
  clone.pedigree = original.pedigree
    ? structuredClone(original.pedigree)
    : buildPedigree(original, original, C.PEDIGREE_DEPTH);
  clone.motherBreed = original.motherBreed;
  clone.fatherBreed = original.fatherBreed;
  revealPedigree(clone); // analyzed → дерево клона без тумана (даже если оригинал не вскрыт)
  state.cats.push(clone);
  return { ok: true, clone, dna: cost, coins: coinsCost };
}

/**
 * Утилизировать капсулу: замороженный кот пропадает навсегда, капсула освобождается.
 * Награды нет (заморозка бесплатна → freeze↔утилизация нейтральна) — это чистка
 * витрины, а не экономика. Необратимо (подтверждение — на стороне UI).
 */
export function disposeCryo(state: GameState, cryoId: string): Result {
  const before = (state.cryo ?? []).length;
  state.cryo = (state.cryo ?? []).filter((c) => c.id !== cryoId);
  if (state.cryo.length === before) return { ok: false, reason: 'капсула не найдена' };
  return { ok: true };
}

// --- Прокачка ---

export function buyUpgrade(state: GameState, id: string): Result {
  // Гейт уровня лаборатории: слоты вязки и пьедесталы открываются постепенно
  // (см. SLOT_UNLOCK_LEVELS / PEDESTAL_UNLOCK_LEVELS). Замок ≠ «максимальный уровень».
  if (id === 'slots' && state.slots.length >= E.maxSlotsForLevel(state)) {
    return { ok: false, reason: 'locked' };
  }
  if (id === 'championSlots' && E.championSlots(state) >= E.maxChampionsForLevel(state)) {
    return { ok: false, reason: 'locked' };
  }
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

/**
 * Генетический анализ кота (система знаний, этап B): вскрывает СРАЗУ всё дерево
 * родословной (туман) и список скрытых генов — пород предков. Механику НЕ меняет:
 * скрытые гены влияли на рецепты и до анализа, игрок лишь получает информацию.
 * Оплата: 💰 (цена по тиру кота, analyzeCoinCost) или '📺 ad' — бесплатно и БЕЗ
 * кулдауна (анализ — инфо-действие, реальный SDK рекламы — бэклог).
 */
export function analyzeCat(
  state: GameState, catId: string, mode: 'coins' | 'ad' = 'coins', now = 0,
): Result<{ coins: number }> {
  void now; // кулдауна у анализа больше нет — параметр оставлен ради совместимости сигнатуры
  // Анализ доступен и замороженным котам (крио-банк) — родословную вскрывают и в капсуле.
  const cat = findCat(state, catId) ?? (state.cryo ?? []).find((c) => c.id === catId);
  if (!cat) return { ok: false, reason: 'кот не найден' };
  if (cat.analyzed) { revealPedigree(cat); return { ok: true, coins: 0 }; } // уже изучен
  const cost = C.analyzeCoinCost(cat.rarityTier);
  if (mode === 'ad') {
    state.lastAnalyzeAdAt = Math.max(1, now); // фиксируем факт просмотра (кулдауна нет)
  } else if (!spend(state, 'coins', cost)) {
    return { ok: false, reason: 'не хватает монет' };
  }
  cat.analyzed = true;
  revealPedigree(cat);
  return { ok: true, coins: mode === 'coins' ? cost : 0 };
}

// --- Исследование рецептов (вкладка «Исследования» Генолаба, этап D) ---

/**
 * Запустить стол исследований: комбинированная цена 💰 + 🧬, один слот-таймер.
 * Итог по готовности выдаёт finishRecipeResearch. Запуск невозможен, если пул
 * достижимых рецептов пуст (UI в этом случае прячет кнопку).
 */
export function startRecipeResearch(state: GameState, now: number): Result {
  if (!E.isUnlocked(state, 'recipeLab')) return { ok: false, reason: 'locked' };
  if (state.recipeResearch.readyAt > 0) return { ok: false, reason: 'стол занят исследованием' };
  if (researchableRecipes(state).length === 0) return { ok: false, reason: 'нет доступных рецептов' };
  const price = C.recipeResearchCost(state.level);
  if (state.coins < price.coins || state.dna < price.dna) {
    return { ok: false, reason: 'не хватает ресурсов' };
  }
  state.coins -= price.coins;
  state.dna -= price.dna;
  state.recipeResearch = {
    startedAt: now,
    readyAt: now + C.recipeResearchMs(state.level),
    paidCoins: price.coins,
    paidDna: price.dna,
  };
  return { ok: true };
}

/**
 * Забрать результат ГОТОВОГО исследования: случайный ещё не открытый рецепт из
 * достижимого пула → в state.knownRecipes (в Котодексе появится чёрный силуэт).
 * Таймер не готов → null. Грейс: если пул опустел, пока шло исследование
 * (например, породу успели вывести), — возвращаем стоимость (refunded: true).
 */
export function finishRecipeResearch(
  state: GameState, now: number, rng: Rng,
): { recipe: Recipe | null; refunded: boolean } {
  const rr = state.recipeResearch;
  if (rr.readyAt === 0 || now < rr.readyAt) return { recipe: null, refunded: false };
  const pool = researchableRecipes(state);
  if (pool.length === 0) {
    state.coins += rr.paidCoins;   // возврат ровно уплаченного (цена зависит от уровня)
    state.dna += rr.paidDna;
    rr.startedAt = 0; rr.readyAt = 0; rr.paidCoins = 0; rr.paidDna = 0;
    return { recipe: null, refunded: true };
  }
  rr.startedAt = 0; rr.readyAt = 0; rr.paidCoins = 0; rr.paidDna = 0;
  const recipe = pool[Math.floor(rng() * pool.length)]!;
  state.knownRecipes.push(recipeKey(recipe));
  return { recipe, refunded: false };
}

/** Мгновенно завершить исследование рецепта за 💎 (цена ∝ остатку, как у вязки). */
export function speedUpRecipeResearch(state: GameState, now: number): Result<{ crystals: number }> {
  const rr = state.recipeResearch;
  if (rr.readyAt === 0) return { ok: false, reason: 'стол не занят исследованием' };
  const cost = E.speedUpCost(Math.max(0, rr.readyAt - now), C.RECIPE_SPEEDUP_CRYSTAL_PER_MIN);
  if (cost > 0 && !spend(state, 'crystals', cost)) return { ok: false, reason: 'не хватает кристаллов' };
  rr.readyAt = now; // готово немедленно — finishRecipeResearch заберёт рецепт
  return { ok: true, crystals: cost };
}

/** Реклама: сократить остаток исследования на AD_SKIP_MS (бесплатно, можно повторять). */
export function adSkipRecipeResearch(state: GameState, now: number): Result {
  const rr = state.recipeResearch;
  if (rr.readyAt === 0) return { ok: false, reason: 'стол не занят исследованием' };
  rr.readyAt = Math.max(now, rr.readyAt - C.AD_SKIP_MS);
  return { ok: true };
}

/**
 * Купить заряд усилителя «Генной инженерии» (+1 на склад). Оплата за 🧬 гены (по
 * умолчанию) или 💎 кристаллы. Заряды можно копить любых типов и помногу — они не
 * тратятся, пока усилитель не активен и не сработает в вязке. Если сейчас НИЧЕГО не
 * активно — первый купленный заряд заодно делаем активным (чтобы «заряжен → работает»
 * без лишнего действия); активность всегда можно переключить (см. toggleBoost).
 */
export function buyBoost(state: GameState, id: string, currency: Currency = 'dna'): Result {
  if (!E.isUnlocked(state, 'engineering')) return { ok: false, reason: 'locked' };
  const def = C.BOOSTS.find((b) => b.id === id);
  if (!def) return { ok: false, reason: 'нет такого усилителя' };
  const cost = currency === 'crystals' ? def.crystals : def.dna;
  if (!spend(state, currency, cost)) {
    return { ok: false, reason: currency === 'crystals' ? 'не хватает кристаллов' : 'не хватает ДНК' };
  }
  state.boosts[def.id] = (state.boosts[def.id] ?? 0) + 1;
  if (!E.activeBoostId(state)) state.activeBoost = def.id; // ничего не активно → активируем этот
  return { ok: true };
}

/**
 * 📺-зарядка усилителя: +1 заряд бесплатно за просмотр рекламы. Доступна только
 * усилителям с `adCharge` (🛡/🍀) — Активатор слишком силён для бесплатного крана и
 * заряжается только за валюту. Кулдаун глобальный (BOOST_AD_COOLDOWN_MS — один на
 * оба, иначе двумя показами подряд собирается комплект). Как и в buyBoost: если
 * сейчас ничего не активно — заряженный усилитель заодно становится активным.
 */
export function adChargeBoost(state: GameState, id: string, now: number): Result {
  if (!E.isUnlocked(state, 'engineering')) return { ok: false, reason: 'locked' };
  const def = C.BOOSTS.find((b) => b.id === id);
  if (!def) return { ok: false, reason: 'нет такого усилителя' };
  if (!def.adCharge) return { ok: false, reason: 'заряжается только за валюту' };
  // lastBoostAdAt = 0 → рекламу ещё ни разу не смотрели (кулдауна нет)
  if (state.lastBoostAdAt > 0 && now - state.lastBoostAdAt < C.BOOST_AD_COOLDOWN_MS) {
    return { ok: false, reason: 'реклама ещё не готова' };
  }
  state.lastBoostAdAt = Math.max(1, now); // 0 зарезервирован под «не смотрели»
  state.boosts[def.id] = (state.boosts[def.id] ?? 0) + 1;
  if (!E.activeBoostId(state)) state.activeBoost = def.id; // ничего не активно → активируем этот
  return { ok: true };
}

/**
 * Переключить активность усилителя (в любой момент, заряды при этом НЕ тратятся):
 * — если он уже активен → снять активность (усилитель не сработает в вязке);
 * — иначе → сделать активным ЕГО (единовременно активен только один, прежний слетает).
 * Активировать можно только усилитель, у которого есть заряды на складе.
 */
export function toggleBoost(state: GameState, id: string): Result {
  if (!E.isUnlocked(state, 'engineering')) return { ok: false, reason: 'locked' };
  const def = C.BOOSTS.find((b) => b.id === id);
  if (!def) return { ok: false, reason: 'нет такого усилителя' };
  if (state.activeBoost === def.id) { state.activeBoost = null; return { ok: true }; }
  if (E.boostCharges(state, def.id) <= 0) return { ok: false, reason: 'нет зарядов' };
  state.activeBoost = def.id;
  return { ok: true };
}

/**
 * Прокачать следующий уровень узла дерева исследований (постоянный бонус). Валюта —
 * своя у узла (🧬 у Селекции, 💰 у остальных веток). Гейт двойной: всё дерево — с
 * LAB_UNLOCKS.research, а КАЖДЫЙ уровень узла — со своего `minLevel` (растянуто L2→L10).
 */
export function unlockResearch(state: GameState, id: string): Result {
  const def = C.RESEARCH.find((r) => r.id === id);
  if (!def) return { ok: false, reason: 'нет такого исследования' };
  if (!E.isUnlocked(state, 'research')) return { ok: false, reason: 'locked' };
  const next = E.researchNext(state, def);
  if (!next) return { ok: false, reason: 'уже изучено' };
  // Гейт уровня: этот уровень узла открывается только с нужного уровня лаборатории.
  if (state.level < next.minLevel) return { ok: false, reason: 'locked' };
  if (!def.requires.every((req) => E.researchOwned(state, req))) {
    return { ok: false, reason: 'сначала изучи предыдущее' };
  }
  // Двойная цена: основная валюта узла + доп. монеты (у Селекции на 🧬). Проверяем
  // и списываем атомарно — иначе списали бы гены, а на монеты бы не хватило.
  const extraCoins = E.researchExtraCoins(def, next);
  if (!E.canAffordResearch(state, def, next)) {
    return {
      ok: false,
      reason: def.currency !== 'coins' && state[def.currency] >= next.cost ? 'не хватает монет'
        : def.currency === 'coins' ? 'не хватает монет' : 'не хватает ДНК',
    };
  }
  spend(state, def.currency, next.cost);
  if (extraCoins > 0) spend(state, 'coins', extraCoins);
  state.research[id] = E.researchLevel(state, id) + 1;
  return { ok: true };
}

// --- Заказы ---

/**
 * Выполнить заказ котом ИЗ КОРЗИНЫ: награда + репутация, кот уезжает к клиенту.
 * Кот берётся только из корзины (зона в Приюте) — предъявить клиенту кота, которого
 * не положили в корзину, нельзя. Выполненный заказ сразу сменяется свежим в том же слоте
 * (replaceOrder, нужен rng) — доска остаётся заполненной, пустых слотов/кулдауна нет.
 */
export function claimOrder(
  state: GameState,
  orderId: string,
  now: number,
  rng: Rng,
): Result<{ reward: import('./types.js').OrderReward }> {
  const order = state.orders.find((o) => o.id === orderId);
  if (!order) return { ok: false, reason: 'заказ не найден' };
  const catId = state.orderBasket;
  if (!catId) return { ok: false, reason: 'положите кота в корзину заказов' };
  const cat = findCat(state, catId);
  if (!cat) return { ok: false, reason: 'кот не найден' };
  if (E.isBusy(state, catId)) return { ok: false, reason: 'кот занят в вязке' };
  if (!matchesOrder(order, cat)) return { ok: false, reason: 'кот в корзине не подходит под заказ' };

  // Исследование «Клиенты-заводчики» (orderReward) повышает всю награду заказа:
  // 💰 монеты, 🧬 гены и ⭐ опыт (💎 кристаллы — премиум, не множатся).
  const mult = 1 + E.researchBonus(state, 'orderReward');
  const coinGain = Math.round(order.reward.coins * mult);
  const dnaGain = Math.round(order.reward.dna * mult);
  const repGain = Math.round(order.reward.reputation * mult);
  const reward = { ...order.reward, coins: coinGain, dna: dnaGain, reputation: repGain };
  state.coins += coinGain;
  state.crystals += order.reward.crystals;
  state.dna += dnaGain;
  addReputation(state, repGain);                  // ⭐ опыт + пересчёт уровня лаборатории
  replaceOrder(state, rng, orderId, now);         // слот сразу получает свежий заказ
  removeCat(state, catId); // сам снимет кота с корзины и с пьедестала
  return { ok: true, reward };
}

// --- Корзина заказов (зона в Приюте) ---

/**
 * Положить кота в корзину заказов: только им можно закрыть заказ. Кот остаётся
 * в приюте и занимает место, но на полу не гуляет — он «в переноске» у стойки.
 * Прежний обитатель корзины просто вытесняется обратно на пол.
 */
export function putCatInBasket(state: GameState, catId: string): Result {
  const cat = findCat(state, catId);
  if (!cat) return { ok: false, reason: 'кот не найден' };
  if (E.isBusy(state, catId)) return { ok: false, reason: 'кот занят в вязке' };
  if (E.isInSlot(state, catId)) return { ok: false, reason: 'кот в слоте вязки' };
  if (E.isChampion(state, catId)) return { ok: false, reason: 'кот выставлен чемпионом' };
  state.orderBasket = catId;
  return { ok: true };
}

/** Вынуть кота из корзины (вернуть на пол приюта). */
export function clearOrderBasket(state: GameState): void {
  state.orderBasket = null;
}

// --- Инап-покупки 💎 ---

/**
 * Начислить кристаллы за оплаченный пак. Чистая функция над состоянием: сам платёж
 * живёт в src/platform/payments.ts, сюда приходит уже подтверждённая покупка.
 *
 * Идемпотентна по purchaseToken — это ключевое требование: если состояние
 * сохранилось, а consumePurchase не прошёл (обрыв связи), платформа вернёт ту же
 * покупку при следующем запуске, и начислить второй раз нельзя (см. GDD.md §6.4).
 * Неизвестный товар НЕ начисляем и не считаем обработанным: пусть покупка
 * дождётся версии игры, которая про неё знает, чем пропадёт при консумировании.
 */
export function grantCrystals(
  state: GameState, productId: string, purchaseToken: string,
): Result<{ crystals: number; bonus: number; pack: C.CrystalPack }> {
  const pack = C.CRYSTAL_PACKS.find((p) => p.id === productId);
  if (!pack) return { ok: false, reason: 'неизвестный товар' };
  if (purchaseToken && state.processedPurchases.includes(purchaseToken)) {
    return { ok: false, reason: 'покупка уже начислена' };
  }

  const bonus = state.firstPurchaseDone ? 0 : Math.round(pack.crystals * C.FIRST_PURCHASE_BONUS);
  state.crystals += pack.crystals + bonus;
  state.firstPurchaseDone = true;
  if (purchaseToken) {
    state.processedPurchases.push(purchaseToken);
    if (state.processedPurchases.length > C.PROCESSED_PURCHASES_KEEP) {
      state.processedPurchases = state.processedPurchases.slice(-C.PROCESSED_PURCHASES_KEEP);
    }
  }
  return { ok: true, crystals: pack.crystals + bonus, bonus, pack };
}

/** Полагается ли игроку бонус первой покупки (+50%) — для витрины магазина. */
export function firstPurchaseBonusAvailable(state: GameState): boolean {
  return !state.firstPurchaseDone;
}

/**
 * Знает ли эта сборка игры такой товар. Нужно, чтобы отличить «уже начислено»
 * (покупку можно гасить) от «товар неизвестен» (гасить нельзя — потеряется).
 */
export function isKnownPack(productId: string): boolean {
  return C.CRYSTAL_PACKS.some((p) => p.id === productId);
}
