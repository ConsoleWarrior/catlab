/**
 * Производные величины экономики и прокачки (Этап 4): вместимости, таймеры,
 * ставки дохода, стоимость апгрейдов. Чистые функции над GameState. См. GAME.md.
 */

import { tierOfBreed } from '../genetics/index.js';
import type { Genotype, BreedBoosts } from '../genetics/index.js';
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

/** Суммарный бонус изученных исследований данного типа эффекта. */
export function researchBonus(state: GameState, kind: C.ResearchEffectKind): number {
  let sum = 0;
  for (const r of C.RESEARCH) {
    if (r.effect.kind === kind && state.research.includes(r.id)) sum += r.effect.value;
  }
  return sum;
}

export function nurseryCapacity(state: GameState): number {
  return C.NURSERY_BASE_CAP + C.NURSERY_CAP_STEP * lvl(state, 'nurseryCap')
    + researchBonus(state, 'nurseryCap');
}

export function shelterCapacity(state: GameState): number {
  return C.SHELTER_BASE_CAP + C.SHELTER_CAP_STEP * lvl(state, 'shelterCap')
    + researchBonus(state, 'shelterCap');
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
  return C.OFFLINE_CAP_BASE_MIN + C.OFFLINE_CAP_STEP_MIN * lvl(state, 'offline')
    + researchBonus(state, 'offline');
}

export function catsIn(state: GameState, room: LiveRoom): Cat[] {
  return state.cats.filter((c) => c.location === room);
}

/** Кот занят, если участвует в активной вязке. */
export function isBusy(state: GameState, catId: string): boolean {
  return state.slots.some((s) => s.readyAt > 0 && (s.motherId === catId || s.fatherId === catId));
}

/**
 * Кот стоит в слоте инкубатора (поставлен для вязки или вязка уже идёт) —
 * физически он в инкубаторе, поэтому на полу своей комнаты не показывается.
 */
export function isInSlot(state: GameState, catId: string): boolean {
  return state.slots.some((s) => s.motherId === catId || s.fatherId === catId);
}

/** Суммарный пассивный доход питомника (💰/мин) с учётом «Выставки» и исследований. */
export function passiveRatePerMin(state: GameState): number {
  const mult = (1 + C.SHOW_BONUS_STEP * lvl(state, 'show')) * (1 + researchBonus(state, 'income'));
  let rate = 0;
  for (const c of state.cats) {
    if (c.location === 'nursery') rate += C.TIER_VALUE[c.rarityTier].incomePerMin;
  }
  // «Коллекционер»: +доход за каждую открытую породу
  rate += state.discoveredBreeds.length * researchBonus(state, 'collectionIncome');
  return rate * mult;
}

/**
 * Визуальный масштаб кота по возрасту: новорождённый котёнок маленький (≈MIN_SCALE),
 * со временем дорастает до взрослого (1.0). Коты, созданные «взрослыми» (bornAt в
 * прошлом — стартовые, купленные), сразу дают 1.0; растут только настоящие
 * новорождённые из инкубатора (им collectReady ставит bornAt = now).
 */
export function growthScale(cat: Cat, now: number): number {
  const age = now - cat.bornAt;
  if (age >= C.KITTEN_GROWTH_MS) return 1;
  const t = Math.max(0, age) / C.KITTEN_GROWTH_MS;
  const eased = 1 - (1 - t) * (1 - t); // ease-out: рост заметен сразу, плавно замедляется
  return C.KITTEN_MIN_SCALE + (1 - C.KITTEN_MIN_SCALE) * eased;
}

/** Прогресс взросления 0..1 (1 — котёнок стал взрослым). */
export function growthProgress(cat: Cat, now: number): number {
  return Math.max(0, Math.min(1, (now - cat.bornAt) / C.KITTEN_GROWTH_MS));
}

/** Взрослый ли кот (вырос). Только взрослые участвуют в вязке и показывают имя/пол. */
export function isAdult(cat: Cat, now: number): boolean {
  return now - cat.bornAt >= C.KITTEN_GROWTH_MS;
}

/** Сколько мс осталось котёнку до взросления (0 — уже взрослый). */
export function growthRemainingMs(cat: Cat, now: number): number {
  return Math.max(0, C.KITTEN_GROWTH_MS - (now - cat.bornAt));
}

// --- Генная инженерия ---

/** Сколько зарядов усилителя заряжено. */
export function boostCharges(state: GameState, id: C.BoostId): number {
  return state.boosts[id] ?? 0;
}

/** Активные усилители (есть хотя бы один заряд) — для передачи в breedKitten. */
export function activeBoosts(state: GameState): BreedBoosts {
  const out: BreedBoosts = {};
  for (const def of C.BOOSTS) if (boostCharges(state, def.id) > 0) out[def.id] = true;
  return out;
}

/** Списать по одному заряду усилителей, которые реально сработали (флаги из breedKitten). */
export function consumeBoosts(state: GameState, used: BreedBoosts): void {
  for (const def of C.BOOSTS) {
    const n = boostCharges(state, def.id);
    if (used[def.id] && n > 0) state.boosts[def.id] = n - 1;
  }
}

/** Стоимость покупки простого кота. Если котов нет вовсе — первый бесплатно (анти-софт-лок). */
export function buyCatCost(state: GameState): number {
  return state.cats.length === 0 ? 0 : C.STARTER_CAT_COST;
}

/** Награда за пристройство кота: 💰 (с учётом «Связей») + 🧬 (с учётом «Биобанка») + исследований. */
export function adoptReward(state: GameState, cat: Cat): { coins: number; dna: number } {
  const v = C.TIER_VALUE[cat.rarityTier];
  return {
    coins: Math.round(v.adopt
      * (1 + C.CONNECTIONS_STEP * lvl(state, 'connections'))
      * (1 + researchBonus(state, 'adoptCoins'))),
    dna: Math.round(v.dna
      * (1 + C.BIOBANK_STEP * lvl(state, 'biobank'))
      * (1 + researchBonus(state, 'adoptDna'))),
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

/**
 * Создаёт экземпляр кота (с кэшем тира из породы и новым id). Мутирует nextId.
 * Редкость теперь определяется ПОРОДОЙ из каталога, а не аллелями.
 */
export function makeCatInstance(
  state: GameState,
  genotype: Genotype,
  now: number,
  location: LiveRoom = 'nursery',
  breed = 'moggie',
): Cat {
  // отметить породу как открытую в Котодексе (любой полученный кот «открывает» породу)
  if (state.discoveredBreeds && !state.discoveredBreeds.includes(breed)) {
    state.discoveredBreeds.push(breed);
  }
  return {
    id: 'cat' + state.nextId++,
    genotype,
    breed,
    // По умолчанию кот «взрослый» (bornAt в прошлом) — стартовые/купленные не растут.
    // Настоящему новорождённому collectReady перезапишет bornAt = now.
    bornAt: now - C.KITTEN_GROWTH_MS,
    location,
    rarityTier: tierOfBreed(breed),
    analyzed: false,
  };
}
