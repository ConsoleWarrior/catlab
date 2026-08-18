/**
 * Производные величины экономики и прокачки (Этап 4): вместимости, таймеры,
 * ставки дохода, стоимость апгрейдов. Чистые функции над GameState. См. GAME.md.
 */

import { tierOfBreed, TIER_LEVEL, LEVEL_TIER, breedValueMult } from '../genetics/index.js';
import type { Genotype, BreedBoosts, RarityTier } from '../genetics/index.js';
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

/**
 * Открыта ли фича. Большинство — по уровню лаборатории (LAB_UNLOCKS), но станция «на
 * эксперименты» и ветеринар открываются ПОКУПКОЙ узла ветки «Лаборатория» (FEATURE_RESEARCH,
 * по образцу крио-банка) — для них проверяем владение узлом, а не уровень.
 */
export function isUnlocked(state: GameState, feature: C.LabFeature): boolean {
  const nodeId = C.FEATURE_RESEARCH[feature];
  if (nodeId) return researchOwned(state, nodeId);
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
 * Доп. цена в 💰 сверх основной валюты узла. Есть только у веток НЕ на монеты
 * (Селекция за 🧬 стоит ещё и денег). У монетных веток дубля нет — вернём 0.
 */
export function researchExtraCoins(def: C.ResearchDef, next: C.ResearchLevel | null): number {
  return next && def.currency !== 'coins' ? (next.coins ?? 0) : 0;
}

/** Хватает ли ресурсов на следующий уровень узла: основная валюта + доп. монеты. */
export function canAffordResearch(state: GameState, def: C.ResearchDef, next: C.ResearchLevel | null): boolean {
  if (!next) return false;
  if (state[def.currency] < next.cost) return false;
  return state.coins >= researchExtraCoins(def, next);
}

/**
 * Суммарный бонус исследований данного типа эффекта: складываем `value` всех
 * КУПЛЕННЫХ уровней всех узлов с этим эффектом (многоуровневые узлы суммируются).
 */
export function researchBonus(state: GameState, kind: C.ResearchEffectKind): number {
  let sum = 0;
  for (const def of C.RESEARCH) {
    if (def.effectKind !== kind) continue;
    // clamp: сейв мог сохранить уровень выше нынешнего числа уровней (если узел
    // ужали в балансе) — берём не больше, чем реально есть уровней, чтобы не упасть.
    const owned = Math.min(researchLevel(state, def.id), def.levels.length);
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

/** Купленные ступени «Тщательного отбора» (0..2) — сдвиг тиров скрытой родословной. */
export function hiddenRaritySteps(state: GameState): number {
  return researchBonus(state, 'hiddenRarity');
}

/**
 * Веса тиров предка в скрытой родословной покупного кота с учётом «Тщательного отбора»:
 * каждая ступень отнимает у T1 и раздаёт выше (HIDDEN_GENE_TIER_SHIFT). Сумма всегда 1.
 */
export function hiddenTierWeights(state: GameState): Record<RarityTier, number> {
  const steps = hiddenRaritySteps(state);
  const out = { ...C.HIDDEN_GENE_TIER_WEIGHTS };
  if (steps <= 0) return out;
  for (const tier of LEVEL_TIER) {
    out[tier] = Math.max(0, out[tier] + C.HIDDEN_GENE_TIER_SHIFT[tier] * steps);
  }
  return out;
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

/**
 * Индекс слота инкубатора, куда кот может встать по своей роли (самка → «мама»,
 * самец → «папа»): слот без идущей вязки, без «оставленного с роднёй» малыша и со
 * свободным местом нужного пола. Сначала ищем слот, где партнёр уже стоит — так кот
 * сразу образует пару и вязку можно запускать; иначе берём первый подходящий.
 * Возвращает -1, если свободных мест нет (кнопка меню кота покажет предупреждение).
 */
export function freeBreedSlot(state: GameState, cat: Cat): number {
  const female = cat.genotype.sex === 'female';
  const free = (s: BreedingSlot): boolean =>
    s.readyAt === 0 && !s.kittenId && !(female ? s.motherId : s.fatherId);
  const paired = state.slots.findIndex((s) => free(s) && !!(female ? s.fatherId : s.motherId));
  return paired >= 0 ? paired : state.slots.findIndex(free);
}

/** Общий множитель дохода пьедесталов: исследования ветки «Обучение» (income). */
function showMult(state: GameState): number {
  return 1 + researchBonus(state, 'income');
}

/**
 * Пассивный доход выставки (💰/мин, ДО вычета корма). Приносят ТОЛЬКО коты-чемпионы
 * (выставленные на пьедесталы), доход каждого ∝ его рыночной ценности; сумма
 * умножается на «Выставку» и исследования дохода. Нет чемпионов → дохода нет
 * (кроме бонуса «Коллекционер» за выведенные породы).
 */
export function passiveRatePerMin(state: GameState): number {
  let rate = 0;
  // считаем ПО СЛОТАМ, а не по множеству котов: доход зависит от МЕСТА пьедестала
  for (let i = 0; i < championSlots(state); i++) {
    const c = championAt(state, i);
    if (c) rate += catMarketValue(c) * C.CHAMPION_INCOME_RATE * placeIncomeMult(i);
  }
  // «Коллекционер»: +доход за каждую ВЫВЕДЕННУЮ породу. discoveredBreeds наполняет только
  // makeCatInstance (реально полученный кот); рецепт, открытый исследованием в Генолабе,
  // лежит в knownRecipes и дохода не даёт.
  rate += state.discoveredBreeds.length * researchBonus(state, 'collectionIncome');
  return rate * showMult(state);
}

/**
 * Доход одного кота-чемпиона (💰/мин) — для подписи над пьедесталом. Учитывает
 * МЕСТО пьедестала (1 место = +50%): slotIndex можно передать явно, иначе ищем
 * кота среди выставленных (не на пьедестале → без бонуса места).
 */
export function championIncomePerMin(state: GameState, cat: Cat, slotIndex?: number): number {
  const i = slotIndex ?? (state.champions ?? []).indexOf(cat.id);
  const place = i >= 0 ? placeIncomeMult(i) : 1;
  return catMarketValue(cat) * C.CHAMPION_INCOME_RATE * place * showMult(state);
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

/** Аппетит одного кота (ед./мин) до скидок — зависит от тира: 0.1 (дворовый) … 0.5 (легендарный). */
export function catFoodPerMin(cat: Cat): number {
  return C.FOOD_PER_MIN_BY_TIER[cat.rarityTier];
}

/**
 * Сколько ртов на довольствии: едят ВСЕ коты коллекции (питомник, приют, слоты вязки,
 * пьедесталы), кроме замороженных в крио-банке — те лежат в state.cryo, а не в cats.
 */
export function feedingCatCount(state: GameState): number {
  return state.cats.length;
}

/**
 * Расход корма (ед./мин): сумма аппетитов всех котов (по тиру), со скидкой «Экономного
 * рациона». 0, пока механика не открыта уровнем лаборатории (тогда голода нет и
 * доход считается по-старому — только пассив).
 */
export function foodRatePerMin(state: GameState): number {
  if (!foodEnabled(state)) return 0;
  let sum = 0;
  for (const cat of state.cats) sum += catFoodPerMin(cat);
  return sum * (1 - feedEfficiency(state));
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

/**
 * Сколько корма добавит покупка и почём: пакет (FOOD_PACK_UNITS) или «до полного».
 * Цена всегда пропорциональна добавленным единицам — единая формула для кнопок UI и
 * самой покупки (buyFood), чтобы подпись цены не разъезжалась с списанием.
 */
export function foodBuyQuote(state: GameState, mode: 'pack' | 'full'): { units: number; cost: number } {
  const room = Math.max(0, foodCap(state) - foodLevel(state));
  // Меньше единицы места — считаем кормушку полной: иначе «＋50» продавал бы остаток
  // 0.3 ед. по цене, округлённой вверх до 1 💰 (запас всегда дробный из-за расхода по кадрам).
  if (room < 1) return { units: 0, cost: 0 };
  const units = mode === 'full' ? room : Math.min(C.FOOD_PACK_UNITS, Math.floor(room));
  const perUnit = C.FOOD_PACK_COST / C.FOOD_PACK_UNITS;
  return { units, cost: Math.max(1, Math.round(units * perUnit)) };
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

/** Сколько зарядов усилителя на складе (куплено). Не зависит от активности. */
export function boostCharges(state: GameState, id: C.BoostId): number {
  return state.boosts[id] ?? 0;
}

/**
 * Какой усилитель сейчас АКТИВЕН (сработает в вязке). Единовременно только один —
 * это `state.activeBoost`, но лишь пока у него есть заряды на складе (иначе гореть
 * нечему → считаем неактивным).
 */
export function activeBoostId(state: GameState): C.BoostId | undefined {
  const id = state.activeBoost as C.BoostId | null;
  return id && boostCharges(state, id) > 0 ? id : undefined;
}

/** Активный усилитель как флаги для breedKitten (не более одного). */
export function activeBoosts(state: GameState): BreedBoosts {
  const out: BreedBoosts = {};
  const id = activeBoostId(state);
  if (id) out[id] = true;
  return out;
}

/**
 * Списать по одному заряду усилителей, которые реально сработали (флаги из
 * breedKitten — активным может быть лишь один). Если у активного заряды кончились —
 * снимаем активность (гореть больше нечему).
 */
export function consumeBoosts(state: GameState, used: BreedBoosts): void {
  for (const def of C.BOOSTS) {
    const n = boostCharges(state, def.id);
    if (used[def.id] && n > 0) state.boosts[def.id] = n - 1;
  }
  if (state.activeBoost && boostCharges(state, state.activeBoost as C.BoostId) <= 0) {
    state.activeBoost = null;
  }
}

/**
 * Стоимость покупки простого кота. Если котов нет вовсе — первый бесплатно (анти-софт-лок).
 * База растёт с уровнем лаборатории (+5 💰 за уровень: 55 на ур.1 … 100 на ур.10), сверху
 * «Тщательный отбор» удорожает покупку на 25% за ступень — плата за более породистых предков.
 * Потолок цены: 100 × 1.5 = 150 💰.
 */
export function buyCatCost(state: GameState): number {
  return state.cats.length === 0 ? 0 : fullCatCost(state);
}

/** Цена кота БЕЗ скидки анти-софт-лока — она же порог «не хватает даже на одного». */
function fullCatCost(state: GameState): number {
  const base = C.STARTER_CAT_COST + C.BUY_CAT_COST_PER_LEVEL * Math.min(state.level, C.MAX_LEVEL);
  const mult = 1 + hiddenRaritySteps(state) * C.BUY_CAT_COST_PER_SELECT;
  return Math.round(base * mult);
}

/**
 * Спасательная пара (анти-софт-лок): котов нет И монет не хватает даже на одного —
 * бесплатно выдаём сразу ♀+♂, иначе с одним котом игрок всё равно в тупике (вязать
 * не с кем и не на что). Если в приюте нет места на двоих — обычная выдача одного.
 */
export function isRescuePair(state: GameState): boolean {
  return state.cats.length === 0
    && state.coins < fullCatCost(state)
    && shelterCapacity(state) - roomCount(state, 'shelter') >= 2;
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
 * продажи по заказу) + немного 🧬. Только 💰 усиливается «Добрыми руками»
 * (adoptCoins); 🧬 здесь базовое — «Биобанк+» (adoptDna) теперь усиливает 🧬
 * ТОЛЬКО за сдачу на эксперименты (labReward), не за раздачу в добрые руки.
 */
export function adoptReward(state: GameState, cat: Cat): { coins: number; dna: number } {
  const market = catMarketValue(cat);
  return {
    coins: Math.round(market * C.ADOPT_COIN_FRACTION
      * (1 + researchBonus(state, 'adoptCoins'))),
    dna: Math.max(1, Math.round(market * C.ADOPT_DNA_RATE)),
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

/** Цена клонирования в 💰 (сверх 🧬) = ×10 от цены в 🧬 (см. cloneCost). */
export function cloneCostCoins(cat: Cat): number {
  return cloneCost(cat) * 10;
}

// --- Выставка / чемпионы ---

/** Сколько котов можно выставить чемпионами (прокачивается championSlots). */
export function championSlots(state: GameState): number {
  return C.CHAMPION_SLOTS_BASE + lvl(state, 'championSlots');
}

/**
 * Место выставки (1..5) у пьедестала с этим индексом слота. Слоты открываются по
 * порядку (слева направо по дуге), а места распределены по ВЫСОТЕ тумб — см.
 * C.PEDESTAL_PLACES: 5 → 3 → 1 → 2 → 4.
 */
export function pedestalPlace(slotIndex: number): number {
  return C.PEDESTAL_PLACES[slotIndex] ?? slotIndex + 1;
}

/** Множитель дохода кота на пьедестале по его МЕСТУ (1 место = ×1.5, 5 место = ×1.1). */
export function placeIncomeMult(slotIndex: number): number {
  return C.PLACE_INCOME_MULT[pedestalPlace(slotIndex) - 1] ?? 1;
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

// --- Корзина заказов (зона в Питомнике) ---

/**
 * Кот, стоящий в корзине заказов (null — корзина пуста). Ссылка проверяется по
 * живой коллекции: кот мог уехать по заказу/в лабораторию или попасть в крио.
 */
export function basketCat(state: GameState): Cat | null {
  const id = state.orderBasket;
  if (!id) return null;
  return state.cats.find((c) => c.id === id) ?? null;
}

/** Кот сидит в корзине заказов (на полу его не рисуем — он «в переноске»). */
export function isInBasket(state: GameState, catId: string): boolean {
  return state.orderBasket === catId;
}

/**
 * Стоимость мгновенного завершения таймера (💎) по остатку времени.
 * ratePerMin — ставка 💎 за минуту остатка (по фиче: вязка/рост/рецепты, см. config);
 * по умолчанию базовая. Округление ВВЕРХ (и минуты, и итог): при общей ставке 0.2
 * это читаемое правило «1 💎 за каждые начатые 5 минут» без провалов на границах
 * (11 мин → 3 💎, а не 2, как давало бы округление к ближайшему). Не ниже
 * SPEEDUP_CRYSTAL_MIN.
 */
export function speedUpCost(remainingMs: number, ratePerMin: number = C.SPEEDUP_CRYSTAL_PER_MIN): number {
  if (remainingMs <= 0) return 0;
  const mins = Math.ceil(remainingMs / 60_000);
  // −ε: дробная ставка живёт в double, и ровное произведение (5 × 0.2) не должно
  // из-за погрешности перескочить на следующий кристалл.
  return Math.max(C.SPEEDUP_CRYSTAL_MIN, Math.ceil(mins * ratePerMin - 1e-9));
}

/** Стоимость следующего уровня апгрейда (или null, если апгрейда нет). */
export function upgradeCost(state: GameState, id: string): { currency: Currency; amount: number } | null {
  if (id === 'slots') {
    const def = C.UPGRADES.slots!;
    const level = state.slots.length - 1; // 0 = покупаем 2-й слот
    return { currency: def.currency, amount: Math.round(def.baseCost * def.mult ** level) };
  }
  if (id === 'championSlots') {
    // Пьедесталы — явный прайс PEDESTAL_COSTS (1-й бесплатный, далее 500/2000/8000/24000),
    // индекс = число уже купленных апгрейдов. Дальше последнего — уже максимум.
    const amount = C.PEDESTAL_COSTS[lvl(state, 'championSlots')];
    return amount === undefined ? null : { currency: C.UPGRADES.championSlots!.currency, amount };
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
