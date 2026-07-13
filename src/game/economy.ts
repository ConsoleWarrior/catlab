/**
 * Производные величины экономики и прокачки (Этап 4): вместимости, таймеры,
 * ставки дохода, стоимость апгрейдов. Чистые функции над GameState. См. GAME.md.
 */

import { tierOfBreed, TIER_LEVEL, breedValueMult } from '../genetics/index.js';
import type { Genotype, BreedBoosts } from '../genetics/index.js';
import type { Ancestor, BreedingSlot, Cat, Currency, GameState, LiveRoom } from './types.js';
import { catAncestors } from './pedigree.js';
import * as C from './config.js';

/** Уровень апгрейда (0, если не куплен). */
export function lvl(state: GameState, id: string): number {
  return state.upgrades[id] ?? 0;
}

export function emptySlot(): BreedingSlot {
  return { motherId: null, fatherId: null, startedAt: 0, readyAt: 0, kittenId: null };
}

export function slotCount(state: GameState): number {
  return state.slots.length;
}

// --- Уровень лаборатории: гейты прогрессии ---

/** Открыта ли фича на текущем уровне лаборатории (labStation/research/engineering/...). */
export function isUnlocked(state: GameState, feature: C.LabFeature): boolean {
  return state.level >= C.LAB_UNLOCKS[feature];
}

/** На каком уровне открывается фича (для подписи замка «Откроется на ур. N»). */
export function unlockLevelOf(feature: C.LabFeature): number {
  return C.LAB_UNLOCKS[feature];
}

/** Сколько слотов вязки разрешает текущий уровень (базовый 1 + открытые порогами). */
export function maxSlotsForLevel(state: GameState): number {
  let n = 1;
  for (const lv of C.SLOT_UNLOCK_LEVELS) if (state.level >= lv) n++;
  return n;
}

/** Сколько пьедесталов разрешает текущий уровень (базовый 1 + открытые порогами). */
export function maxChampionsForLevel(state: GameState): number {
  let n = 1;
  for (const lv of C.PEDESTAL_UNLOCK_LEVELS) if (state.level >= lv) n++;
  return n;
}

/** Уровень, на котором откроется покупка следующего слота вязки (null — уже все доступны). */
export function nextSlotUnlockLevel(state: GameState): number | null {
  const opened = maxSlotsForLevel(state) - 1; // сколько порогов уже пройдено
  return C.SLOT_UNLOCK_LEVELS[opened] ?? null;
}

/** Уровень, на котором откроется покупка следующего пьедестала (null — уже все доступны). */
export function nextPedestalUnlockLevel(state: GameState): number | null {
  const opened = maxChampionsForLevel(state) - 1;
  return C.PEDESTAL_UNLOCK_LEVELS[opened] ?? null;
}

/** Купленный уровень узла исследований (0 — не начат). */
export function researchLevel(state: GameState, id: string): number {
  return state.research[id] ?? 0;
}

/** Изучен ли узел хотя бы на 1 уровень (для проверки `requires` и линий связи в UI). */
export function researchOwned(state: GameState, id: string): boolean {
  return researchLevel(state, id) > 0;
}

/** Полностью ли прокачан узел (все уровни куплены). */
export function researchMaxed(state: GameState, def: C.ResearchDef): boolean {
  return researchLevel(state, def.id) >= def.levels.length;
}

/** Следующий (ещё не купленный) уровень узла или null, если узел прокачан полностью. */
export function researchNext(state: GameState, def: C.ResearchDef): C.ResearchLevel | null {
  return def.levels[researchLevel(state, def.id)] ?? null;
}

/**
 * Суммарный бонус исследований данного типа эффекта: складываем `value` всех
 * КУПЛЕННЫХ уровней всех узлов с этим эффектом (многоуровневые узлы суммируются).
 */
export function researchBonus(state: GameState, kind: C.ResearchEffectKind): number {
  let sum = 0;
  for (const def of C.RESEARCH) {
    if (def.effectKind !== kind) continue;
    const owned = researchLevel(state, def.id);
    for (let i = 0; i < owned; i++) sum += def.levels[i]!.value;
  }
  return sum;
}

// --- Селекция (эффекты ветки «Селекция» на размножение) ---

/** Множитель шанса ВСЕХ рецептов от исследований «Селекции» (1 + сумма recipeChance). */
export function breedChanceMult(state: GameState): number {
  return 1 + researchBonus(state, 'recipeChance');
}

/** Снижение риска инбридинга для котёнка (доля, потолок 0.5 — полностью не убрать). */
export function kinshipSafety(state: GameState): number {
  return Math.min(0.5, researchBonus(state, 'kinshipSafety'));
}

/** Бонус сердец новорождённым от «Витаминов роста» (обычно 0 или 1). */
export function extraHearts(state: GameState): number {
  return researchBonus(state, 'extraHeart');
}

/**
 * Итоговый запас сердец новорождённого: базовый бросок + «Витамины роста». Бесплодного
 * (0 ❤ — родословный тупик от тяжёлого инбридинга) витамины НЕ спасают (решение §8.3).
 */
export function applyExtraHearts(baseHearts: number, extra: number): number {
  return baseHearts > 0 ? baseHearts + extra : 0;
}

export function nurseryCapacity(state: GameState): number {
  return C.NURSERY_BASE_CAP + researchBonus(state, 'nurseryCap');
}

export function shelterCapacity(state: GameState): number {
  return C.SHELTER_BASE_CAP + researchBonus(state, 'shelterCap');
}

export function capacityOf(state: GameState, room: LiveRoom): number {
  return room === 'nursery' ? nurseryCapacity(state) : shelterCapacity(state);
}

export function incubationDuration(_state: GameState): number {
  return Math.max(C.INCUBATION_MIN_MS, C.INCUBATION_BASE_MS);
}

export function mutationRate(_state: GameState): number {
  return C.MUTATION_BASE;
}

export function offlineCapMin(state: GameState): number {
  return C.OFFLINE_CAP_BASE_MIN + researchBonus(state, 'offline');
}

export function catsIn(state: GameState, room: LiveRoom): Cat[] {
  return state.cats.filter((c) => c.location === room);
}

/**
 * Сколько котов реально живёт в комнате (на полу) — без тех, кто физически в слоте
 * инкубатора (родители вязки и «оставленный с роднёй» малыш) и без чемпионов на
 * пьедесталах выставки (они «в отъезде» на подиуме, а не в комнате). Это число и есть
 * заполненность комнаты для проверки вместимости и подписей «N/cap».
 */
export function roomCount(state: GameState, room: LiveRoom): number {
  return state.cats.filter((c) => c.location === room && !isInSlot(state, c.id) && !isChampion(state, c.id)).length;
}

/** Кот занят, если участвует в активной вязке. */
export function isBusy(state: GameState, catId: string): boolean {
  return state.slots.some((s) => s.readyAt > 0 && (s.motherId === catId || s.fatherId === catId));
}

/**
 * Кот стоит в слоте инкубатора (родитель вязки или «оставленный с роднёй» малыш) —
 * физически он в инкубаторе, поэтому на полу своей комнаты не показывается и в
 * заполненность комнаты не входит.
 */
export function isInSlot(state: GameState, catId: string): boolean {
  return state.slots.some((s) => s.motherId === catId || s.fatherId === catId || s.kittenId === catId);
}

/** Общий множитель дохода пьедесталов: исследования ветки «Обучение» (income). */
function showMult(state: GameState): number {
  return 1 + researchBonus(state, 'income');
}

/**
 * Пассивный доход выставки (💰/мин, ДО вычета корма). Приносят ТОЛЬКО коты-чемпионы
 * (выставленные на пьедесталы), доход каждого ∝ его рыночной ценности; сумма
 * умножается на «Выставку» и исследования дохода. Нет чемпионов → дохода нет
 * (кроме бонуса «Коллекционер» за открытые породы).
 */
export function passiveRatePerMin(state: GameState): number {
  let rate = 0;
  for (const c of championCats(state)) rate += catMarketValue(c) * C.CHAMPION_INCOME_RATE;
  // «Коллекционер»: +доход за каждую открытую породу
  rate += state.discoveredBreeds.length * researchBonus(state, 'collectionIncome');
  return rate * showMult(state);
}

/** Доход одного кота-чемпиона (💰/мин) — для подписи над пьедесталом. */
export function championIncomePerMin(state: GameState, cat: Cat): number {
  return catMarketValue(cat) * C.CHAMPION_INCOME_RATE * showMult(state);
}

// --- Корм (контейнер + мягкий голод) ---

/** Открыта ли механика корма (уровнем лаборатории). До ур.3 корм не расходуется. */
export function foodEnabled(state: GameState): boolean {
  return isUnlocked(state, 'food');
}

/** Ёмкость кормушки (ед.): база + узел «Большая кормушка» (foodCap). Расход при этом
 *  снижает «Экономный рацион» (feedEff), автопополнение — «Автокормушка» (autoFeed). */
export function foodCap(state: GameState): number {
  return C.FOOD_CAP_BASE + researchBonus(state, 'foodCap');
}

/** Текущий запас корма (безопасно к старым сейвам без поля). */
export function foodLevel(state: GameState): number {
  return Math.max(0, state.food ?? C.FOOD_CAP_BASE);
}

/** Снижение расхода корма от исследования «Экономный рацион» (доля, потолок 0.9). */
export function feedEfficiency(state: GameState): number {
  return Math.min(0.9, researchBonus(state, 'feedEff'));
}

/**
 * Расход корма (ед./мин): коты сверх бесплатного лимита, со скидкой «Экономного
 * рациона». 0, пока механика не открыта уровнем лаборатории (тогда голода нет и
 * доход считается по-старому — только пассив).
 */
export function foodRatePerMin(state: GameState): number {
  if (!foodEnabled(state)) return 0;
  const billable = Math.max(0, state.cats.length - C.FEED_FREE_CATS);
  return billable * C.FOOD_PER_CAT_PER_MIN * (1 - feedEfficiency(state));
}

/** Голодают ли коты: корм открыт, есть расход и запас на нуле. */
export function isStarving(state: GameState): boolean {
  return foodRatePerMin(state) > 0 && foodLevel(state) <= 0;
}

/** На сколько минут хватит корма при текущем расходе (Infinity — расхода нет). */
export function foodMinutesLeft(state: GameState): number {
  const rate = foodRatePerMin(state);
  if (rate <= 0) return Infinity;
  return foodLevel(state) / rate;
}

/**
 * Списывает корм за `elapsedMin` прошедших минут (мутирует state.food) и возвращает,
 * сколько из них коты были СЫТЫ — за столько и начисляется доход. Если корм не
 * расходуется (механика закрыта или котов мало) — сытыми считаются все минуты.
 * Используется и онлайн (по кадрам), и офлайн (при возврате в игру).
 */
export function consumeFood(state: GameState, elapsedMin: number): number {
  const rate = foodRatePerMin(state);
  if (rate <= 0 || elapsedMin <= 0) return Math.max(0, elapsedMin);
  const have = foodLevel(state);
  const consumed = Math.min(have, rate * elapsedMin);
  state.food = have - consumed;
  return consumed / rate; // сытые минуты (≤ elapsedMin)
}

/** Чистый доход в минуту: пассив выставки; при голоде — 0 (коты не работают). */
export function netIncomePerMin(state: GameState): number {
  return isStarving(state) ? 0 : passiveRatePerMin(state);
}

/** Включена ли «Автокормушка» (исследование r_autofeed + механика корма открыта). */
export function autoFeedEnabled(state: GameState): boolean {
  return foodEnabled(state) && researchBonus(state, 'autoFeed') > 0;
}

/**
 * «Автокормушка»: докупает корм за 💰, чтобы покрыть предстоящий расход за `elapsedMin`,
 * пока хватает монет и есть место в кормушке. Мутирует state.food/coins. Казну в минус
 * не уводит. Вызывается перед consumeFood (онлайн и офлайн — единая математика).
 */
export function autoFeed(state: GameState, elapsedMin: number): void {
  const rate = foodRatePerMin(state);
  if (rate <= 0 || elapsedMin <= 0) return;
  const need = rate * elapsedMin - foodLevel(state); // сколько не хватит на весь период
  if (need <= 0) return;
  const perUnit = C.FOOD_PACK_COST / C.FOOD_PACK_UNITS;
  const room = foodCap(state) - foodLevel(state);
  const affordable = Math.floor(state.coins / perUnit);
  const units = Math.max(0, Math.min(Math.ceil(need), room, affordable));
  if (units <= 0) return;
  const cost = Math.min(state.coins, Math.round(units * perUnit));
  state.coins -= cost;
  state.food = foodLevel(state) + units;
}

/**
 * Длительность взросления конкретного кота. По умолчанию KITTEN_GROWTH_MS, но у
 * малыша, «оставленного с родителями», она в KITTEN_SLOW_FACTOR раз больше —
 * он растёт втрое медленнее (см. keepKittenWithParents).
 */
export function effGrowthMs(cat: Cat): number {
  return cat.growthMs && cat.growthMs > 0 ? cat.growthMs : C.KITTEN_GROWTH_MS;
}

/**
 * Визуальный масштаб кота по возрасту: новорождённый котёнок маленький (≈MIN_SCALE),
 * со временем дорастает до взрослого (1.0). Коты, созданные «взрослыми» (bornAt в
 * прошлом — стартовые, купленные), сразу дают 1.0; растут только настоящие
 * новорождённые из инкубатора (им collectReady ставит bornAt = now).
 */
export function growthScale(cat: Cat, now: number): number {
  const span = effGrowthMs(cat);
  const age = now - cat.bornAt;
  if (age >= span) return 1;
  const t = Math.max(0, age) / span;
  const eased = 1 - (1 - t) * (1 - t); // ease-out: рост заметен сразу, плавно замедляется
  return C.KITTEN_MIN_SCALE + (1 - C.KITTEN_MIN_SCALE) * eased;
}

/** Прогресс взросления 0..1 (1 — котёнок стал взрослым). */
export function growthProgress(cat: Cat, now: number): number {
  return Math.max(0, Math.min(1, (now - cat.bornAt) / effGrowthMs(cat)));
}

/** Взрослый ли кот (вырос). Только взрослые участвуют в вязке и показывают имя/пол. */
export function isAdult(cat: Cat, now: number): boolean {
  return now - cat.bornAt >= effGrowthMs(cat);
}

/** Сколько мс осталось котёнку до взросления (0 — уже взрослый). */
export function growthRemainingMs(cat: Cat, now: number): number {
  return Math.max(0, effGrowthMs(cat) - (now - cat.bornAt));
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

// --- Рыночная ценность кота (единая шкала для продажи/выставки/лаборатории) ---

/**
 * Множитель ценности за родословную: глубина известного древа + «породистость»
 * предков (средний тир) + премия за чистую линию. Ограничен PEDIGREE_VALUE_MAX.
 */
export function pedigreeValueMult(cat: Cat): number {
  const ped = catAncestors(cat);
  const roots = [ped.mother, ped.father].filter(Boolean) as Ancestor[];
  if (roots.length === 0) return 1;
  const depthOf = (a?: Ancestor): number => (a ? 1 + Math.max(depthOf(a.mother), depthOf(a.father)) : 0);
  const depth = Math.max(...roots.map((r) => depthOf(r)));
  let tierSum = 0;
  let count = 0;
  let hasBase = false;
  const walk = (a?: Ancestor): void => {
    if (!a) return;
    count++;
    const t = TIER_LEVEL[tierOfBreed(a.breed)];
    if (t === 0) hasBase = true; // дворовый/домашний предок — линия не «чистая»
    tierSum += t;
    walk(a.mother);
    walk(a.father);
  };
  for (const r of roots) walk(r);
  const avgTier = count > 0 ? tierSum / count : 0;
  let mult = 1
    + C.PEDIGREE_VALUE_PER_GEN * Math.max(0, depth - 1)
    + C.PEDIGREE_VALUE_PER_TIER * avgTier;
  if (!hasBase) mult += C.PEDIGREE_VALUE_PURE;
  return Math.min(C.PEDIGREE_VALUE_MAX, mult);
}

/** Множитель ценности за здоровье (запас сердец): 5/5 → 1.0, 0 → HEALTH_VALUE_FLOOR. */
export function healthValueMult(cat: Cat): number {
  const h = Math.max(0, Math.min(1, heartsOf(cat) / C.MAX_HEARTS));
  return C.HEALTH_VALUE_FLOOR + (1 - C.HEALTH_VALUE_FLOOR) * h;
}

/**
 * Рыночная ценность кота (💰) — сколько он «стоит»: тир (главный фактор) × порода
 * внутри тира × родословная × здоровье. Единая база для заказов, пристройства,
 * лаборатории и дохода выставки.
 */
export function catMarketValue(cat: Cat): number {
  return Math.round(
    C.TIER_MARKET_VALUE[cat.rarityTier]
    * breedValueMult(cat.breed)
    * pedigreeValueMult(cat)
    * healthValueMult(cat),
  );
}

/**
 * Награда за пристройство «в добрые руки»: доля рыночной цены (в разы меньше
 * продажи по заказу) + немного 🧬. Учитывает «Связи», «Биобанк» и исследования.
 */
export function adoptReward(state: GameState, cat: Cat): { coins: number; dna: number } {
  const market = catMarketValue(cat);
  return {
    coins: Math.round(market * C.ADOPT_COIN_FRACTION
      * (1 + researchBonus(state, 'adoptCoins'))),
    dna: Math.max(1, Math.round(C.TIER_VALUE[cat.rarityTier].dna * C.ADOPT_DNA_FRACTION
      * (1 + researchBonus(state, 'adoptDna')))),
  };
}

/** Награда за сдачу кота в лабораторию: главным образом 🧬 гены + немного 💰. */
export function labReward(state: GameState, cat: Cat): { dna: number; coins: number } {
  const market = catMarketValue(cat);
  return {
    dna: Math.max(1, Math.round(market * C.LAB_DNA_RATE
      * (1 + researchBonus(state, 'adoptDna')))),
    coins: Math.round(market * C.LAB_COIN_RATE),
  };
}

/**
 * Сводка для кнопок «…всех» в приюте: число свободных (не занятых вязкой) котов и
 * суммарная награда за раздать / сдать в лабораторию — та же цена, что поштучно.
 */
export function shelterTotals(state: GameState): {
  count: number;
  adopt: { coins: number; dna: number };
  lab: { dna: number; coins: number };
} {
  const cats = catsIn(state, 'shelter').filter((c) => !isBusy(state, c.id));
  const adopt = { coins: 0, dna: 0 };
  const lab = { dna: 0, coins: 0 };
  for (const cat of cats) {
    const a = adoptReward(state, cat); adopt.coins += a.coins; adopt.dna += a.dna;
    const l = labReward(state, cat); lab.dna += l.dna; lab.coins += l.coins;
  }
  return { count: cats.length, adopt, lab };
}

// --- Крио-банк (криохранилище коллекции) ---

/** Открыт ли крио-банк: куплен ли хотя бы 1-й ранг узла «❄️ Криогенетика». */
export function cryoUnlocked(state: GameState): boolean {
  return researchOwned(state, 'r_sel_cryo');
}

/** Ёмкость криокапсул: база + ранги «Криогенетики» (cryoCap). До разблокировки — 0. */
export function cryoCapacity(state: GameState): number {
  return cryoUnlocked(state) ? C.CRYO_BASE_CAP + researchBonus(state, 'cryoCap') : 0;
}

/** Сколько капсул сейчас занято (безопасно к старым сейвам без поля). */
export function cryoCount(state: GameState): number {
  return (state.cryo ?? []).length;
}

/**
 * Цена клонирования кота (🧬) = ×CLONE_LAB_MULT от «выхода лаборатории» того же кота
 * (round(catMarketValue × LAB_DNA_RATE), без бонусов). Привязка к ценности особи +
 * анти-луп: клон стоит впятеро дороже сдачи того же кота на опыты, ДНК не наштампуешь.
 */
export function cloneCost(cat: Cat): number {
  const labYield = Math.max(1, Math.round(catMarketValue(cat) * C.LAB_DNA_RATE));
  return C.CLONE_LAB_MULT * labYield;
}

// --- Выставка / чемпионы ---

/** Сколько котов можно выставить чемпионами (прокачивается championSlots). */
export function championSlots(state: GameState): number {
  return C.CHAMPION_SLOTS_BASE + lvl(state, 'championSlots');
}

/** Валидные id чемпионов (без пустых слотов и ссылок на уже проданных/уехавших котов). */
export function championIds(state: GameState): string[] {
  return (state.champions ?? []).filter((id): id is string => !!id && state.cats.some((c) => c.id === id));
}

/** Коты-чемпионы (объекты, без привязки к конкретному пьедесталу). */
export function championCats(state: GameState): Cat[] {
  const ids = new Set(championIds(state));
  return state.cats.filter((c) => ids.has(c.id));
}

/** Кот на конкретном пьедестале (или null — слот пуст/ссылка протухла). */
export function championAt(state: GameState, slotIndex: number): Cat | null {
  const id = (state.champions ?? [])[slotIndex];
  if (!id) return null;
  return state.cats.find((c) => c.id === id) ?? null;
}

/** Выставлен ли кот чемпионом (на любом пьедестале). */
export function isChampion(state: GameState, catId: string): boolean {
  return (state.champions ?? []).includes(catId);
}

/** Стоимость мгновенного завершения таймера (💎) по остатку времени. */
export function speedUpCost(remainingMs: number): number {
  if (remainingMs <= 0) return 0;
  const mins = Math.ceil(remainingMs / 60_000);
  return Math.max(C.SPEEDUP_CRYSTAL_MIN, mins * C.SPEEDUP_CRYSTAL_PER_MIN);
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
    breedCount: 0,
    maxHearts: C.MAX_HEARTS,
  };
}

// --- Здоровье (сердца) / лимит вязок ---

/** Запас сердец кота (инбридинговым котятам его урезает rollKittenHearts). */
export function heartsOf(cat: Cat): number {
  return cat.maxHearts ?? C.MAX_HEARTS;
}

/** Сколько вязок коту ещё доступно (0 — уже «Старый»/«Бесплодный»). */
export function breedsLeft(cat: Cat): number {
  return Math.max(0, heartsOf(cat) - (cat.breedCount ?? 0));
}

/** Кот исчерпал сердца — в слот вязки его не поставить. */
export function isOld(cat: Cat): boolean {
  return breedsLeft(cat) <= 0;
}

/** Родился без сердец (тяжёлый инбридинг) — «Бесплодный», родословный тупик. */
export function isSterile(cat: Cat): boolean {
  return heartsOf(cat) <= 0;
}
