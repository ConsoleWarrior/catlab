/**
 * Действия игрока над состоянием (Этап 4). Мутируют GameState, возвращают Result.
 * Время передаётся параметром `now` (тестируемо), RNG — параметром. См. GAME.md §10.
 */

import { breed, isLethal, simpleCat, resolveBreeding, recipeKey, RECIPES, tierOfBreed } from '../genetics/index.js';
import { t } from '../i18n.js';
import type { Rng, BreedBoosts, KinshipLevel, Recipe, Sex } from '../genetics/index.js';
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
 * Убирает кота из коллекции, снимая его с выставки, с корзины заказов и со слота
 * вязки (продажа/пристройство/лаборатория) — иначе на него осталась бы висячая
 * ссылка. Слот важен для пристройства прямо из окошка вязки: родителя или
 * «малыша с роднёй» отдают в добрые руки, не унося сначала в комнату.
 */
function removeCat(state: GameState, catId: string): void {
  state.cats = state.cats.filter((c) => c.id !== catId);
  // обнуляем именно его пьедестал (не .filter!), чтобы не сдвинуть соседних чемпионов
  if (state.champions) {
    const idx = state.champions.indexOf(catId);
    if (idx >= 0) state.champions[idx] = null;
  }
  if (state.orderBasket === catId) state.orderBasket = null;
  for (const s of state.slots) {
    if (s.motherId === catId) s.motherId = null;
    if (s.fatherId === catId) s.fatherId = null;
    if (s.kittenId === catId) s.kittenId = null;
  }
}

function canAfford(state: GameState, currency: Currency, amount: number): boolean {
  return state[currency] >= amount;
}

/**
 * Начислить опыт (⭐ репутацию) и пересчитать уровень лаборатории. Единая точка для
 * всех источников опыта (рождение/продажа/пристройство/лаборатория/заказ). При
 * пересечении порога дарит 💎 кристаллы (levelCrystalReward, суммарно за все
 * пройденные уровни, если прыгнули через несколько). Возвращает фактически
 * начисленный опыт, флаг повышения и подаренные 💎 — панель уровня показывает их.
 */
export function addReputation(
  state: GameState, amount: number,
): { gained: number; leveledUp: boolean; crystalsGifted: number } {
  const before = state.level;
  const gained = Math.max(0, Math.round(amount));
  state.reputation += gained;
  state.level = C.levelForReputation(state.reputation);
  let crystalsGifted = 0;
  for (let lv = before + 1; lv <= state.level; lv++) crystalsGifted += C.levelCrystalReward(lv);
  if (crystalsGifted > 0) state.crystals += crystalsGifted;
  return { gained, leveledUp: state.level > before, crystalsGifted };
}

function spend(state: GameState, currency: Currency, amount: number): boolean {
  if (state[currency] < amount) return false;
  state[currency] -= amount;
  return true;
}

// --- Доход ---

/**
 * Итог начисления за отсутствие. Кроме монет отдаём, сколько игрока не было и за
 * сколько минут реально капало — окно «С возвращением» объясняет разницу
 * (упёрлись в потолок офлайна / закончился корм).
 */
export interface OfflineIncome {
  coins: number;
  awayMin: number;       // сколько всего прошло с прошлого визита
  incomeMin: number;     // за сколько из них начислен доход
  cappedByTime: boolean; // обрезано потолком офлайна («Ночной смотритель»)
  cappedByFood: boolean; // обрезано пустой кормушкой
}

/**
 * Начисляет пассивный доход выставки с момента lastSeenAt. Корм расходуется за ВСЁ
 * отсутствие (кормушка может опустеть), а доход начисляется только за «сытые» минуты
 * и в пределах офлайн-потолка. Казну в минус не уводит (мягкий голод).
 */
export function collectIncome(state: GameState, now: number): OfflineIncome {
  const elapsedMin = Math.max(0, (now - state.lastSeenAt) / 60_000);
  if (E.autoFeedEnabled(state)) E.autoFeed(state, elapsedMin); // «Автокормушка»: докупить корм за 💰
  const fedMin = E.consumeFood(state, elapsedMin); // расход корма + сколько минут были сыты
  const capMin = E.offlineCapMin(state);
  const incomeMin = Math.min(fedMin, capMin);
  const coins = Math.floor(E.passiveRatePerMin(state) * incomeMin);
  state.coins += coins;
  state.lastSeenAt = now;
  // Сравнения с допуском: сытые минуты считаются делением, и «ровно всё время»
  // легко даёт 119.99999 — без допуска игроку показали бы ложный «корм кончился».
  return {
    coins,
    awayMin: elapsedMin,
    incomeMin,
    cappedByTime: elapsedMin > capMin + 1e-6 && fedMin > capMin - 1e-6,
    cappedByFood: fedMin < elapsedMin - 1e-6,
  };
}

/** Сколько 💰 добавит 📺 к начисленному за отсутствие (доля OFFLINE_AD_BONUS). */
export function offlineAdBonus(coins: number): number {
  return Math.floor(Math.max(0, coins) * C.OFFLINE_AD_BONUS);
}

/**
 * Забрать 📺-надбавку к офлайн-доходу (кнопка в окне «С возвращением»). Вызывается
 * ТОЛЬКО после реально досмотренного ролика; `coins` — сумма из того же отчёта, что
 * показан игроку. Возвращает начисленное (0 — надбавка меньше монеты).
 */
export function claimOfflineAdBonus(state: GameState, coins: number): number {
  const bonus = offlineAdBonus(coins);
  state.coins += bonus;
  return bonus;
}

/**
 * Купить корм в кормушку: пакет (FOOD_PACK_UNITS) или «до полного». Цена
 * пропорциональна добавленным единицам. Полная кормушка / нехватка монет — отказ.
 */
export function buyFood(state: GameState, mode: 'pack' | 'full' = 'pack'): Result<{ added: number; spent: number }> {
  const { units, cost } = E.foodBuyQuote(state, mode);
  if (units <= 0) return { ok: false, reason: t('кормушка полна', 'the feeder is full') };
  if (!spend(state, 'coins', cost)) return { ok: false, reason: t('не хватает монет', 'not enough coins') };
  state.food = E.foodLevel(state) + units;
  return { ok: true, added: units, spent: cost };
}

// --- Инкубатор ---

/**
 * Запустить вязку. Здесь же РЕШАЕТСЯ, кто родится: порода котёнка бросается прямо
 * сейчас (resolveBreeding, усилители тратятся тут же) и кладётся в `slot.plannedBreed`,
 * а от её тира зависит длительность вязки — от 5 с за серого до минуты за легендарного
 * (E.breedingDuration). Ускорять вязку нечем и незачем: ожидание короткое, а его длина —
 * единственная подсказка о том, кто там внутри. Сам котёнок собирается при рождении
 * (collectReady) — генотип, родословная и сердца бросаются уже там.
 */
export function startBreeding(
  state: GameState,
  slotIndex: number,
  motherId: string,
  fatherId: string,
  now: number,
  rng: Rng = Math.random,
): Result {
  const slot = state.slots[slotIndex];
  if (!slot) return { ok: false, reason: t('нет такого слота', 'no such slot') };
  if (slot.readyAt > 0) return { ok: false, reason: t('слот занят', 'the slot is occupied') };
  if (slot.kittenId) return { ok: false, reason: t('сначала пристрой малыша', 'move the kitten out first') };
  if (E.isStarving(state)) return { ok: false, reason: t('сначала покорми котов 🍽', 'feed the cats first 🍽') };
  if (motherId === fatherId) return { ok: false, reason: t('нужны два разных кота', 'two different cats needed') };
  const mother = findCat(state, motherId);
  const father = findCat(state, fatherId);
  if (!mother || !father) return { ok: false, reason: t('кот не найден', 'cat not found') };
  if (mother.genotype.sex !== 'female') return { ok: false, reason: t('мама должна быть самкой', 'the mother must be female') };
  if (father.genotype.sex !== 'male') return { ok: false, reason: t('папа должен быть самцом', 'the father must be male') };
  if (!E.isAdult(mother, now) || !E.isAdult(father, now)) {
    return { ok: false, reason: t('котёнок ещё не вырос', "the kitten hasn't grown up yet") };
  }
  if (E.isOld(mother) || E.isOld(father)) {
    return { ok: false, reason: t('кот слишком стар для вязки', 'the cat is too old to breed') };
  }
  if (E.isBusy(state, motherId) || E.isBusy(state, fatherId)) {
    return { ok: false, reason: t('кот уже занят в вязке', 'the cat is already breeding') };
  }
  // Место в питомнике НЕ требуется: вязку можно запустить всегда, котёнок
  // родится даже при переполненном питомнике (его потом пристраивают).
  // Кто родится — решаем сейчас: рецепты (с учётом родства и усилителей «Генной
  // инженерии») дают породу, порода даёт тир, тир — длительность вязки. Заряды
  // сработавших усилителей списываются здесь же, в момент нажатия «Свести».
  const used: BreedBoosts = {};
  const plannedBreed = resolveBreeding(
    buildBreedingContext(mother, father), rng, E.activeBoosts(state), used, E.breedChanceMult(state),
  );
  E.consumeBoosts(state, used);
  slot.motherId = motherId;
  slot.fatherId = fatherId;
  slot.startedAt = now;
  slot.plannedBreed = plannedBreed;
  slot.readyAt = now + E.breedingDuration(tierOfBreed(plannedBreed));
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
 * «Старый»/«Бесплодный» в слот ставится (там его лечит шприц-ветеринар), но свести
 * его нельзя — этот запрет живёт в startBreeding.
 */
export function assignBreeder(state: GameState, slotIndex: number, catId: string, now: number): Result {
  const slot = state.slots[slotIndex];
  if (!slot) return { ok: false, reason: t('нет такого слота', 'no such slot') };
  if (slot.readyAt > 0) return { ok: false, reason: t('слот занят вязкой', 'the slot is busy breeding') };
  if (slot.kittenId) return { ok: false, reason: t('сначала пристрой малыша', 'move the kitten out first') };
  const cat = findCat(state, catId);
  if (!cat) return { ok: false, reason: t('кот не найден', 'cat not found') };
  if (!E.isAdult(cat, now)) return { ok: false, reason: t('котёнок ещё не вырос', "the kitten hasn't grown up yet") };
  // «Старого» (сердца кончились) в слот ПУСКАЕМ: шприц-ветеринар лечит только кота,
  // стоящего в слоте (см. healCat / rooms/incubator), — иначе исчерпанного производителя
  // невозможно было бы вылечить вообще. Саму вязку по-прежнему не даст startBreeding.
  if (E.isBusy(state, catId)) return { ok: false, reason: t('кот уже занят в вязке', 'the cat is already breeding') };
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
  // в слоте вязки коту не место ни на пьедестале выставки, ни в корзине заказов
  unsetChampion(state, catId);
  if (state.orderBasket === catId) state.orderBasket = null;
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
      slot.plannedBreed = undefined;
      continue;
    }

    const rate = E.mutationRate(state);
    const plannedBreed = slot.plannedBreed;
    slot.plannedBreed = undefined; // вязка закончилась — план отработан
    let child = breed(mother.genotype, father.genotype, rng, rate);
    // Двойная вислоухость (fold/fold) нежизнеспособна — такой помёт пересобираем.
    // Если не повезло и после пересборок пара опять дала fold/fold, котёнок
    // рождается носителем: одно ухо-ген меняем на прямое. В игре про котов
    // мёртвых котят не бывает — исход «не выжил» убран совсем.
    let guard = 0;
    while (isLethal(child) && guard++ < 8) child = breed(mother.genotype, father.genotype, rng, rate);
    if (isLethal(child)) child = { ...child, Ea: ['fold', 'normal'] };
    // Порода котёнка бро́шена ещё на «Свести» (startBreeding → slot.plannedBreed):
    // от её тира зависела длительность вязки, так что переигрывать бросок нельзя.
    // Фолбэк на месте ради сейвов с вязкой, начатой до этого правила, и дев-слотов,
    // выставленных руками, — там бросаем как раньше, при рождении.
    const ctx = buildBreedingContext(mother, father);
    let childBreed = plannedBreed;
    if (!childBreed) {
      const used: BreedBoosts = {};
      childBreed = resolveBreeding(ctx, rng, E.activeBoosts(state), used, E.breedChanceMult(state));
      E.consumeBoosts(state, used);
    }
    // «Новая порода» — проверяем ДО makeCatInstance: он сам добавит породу в Котодекс.
    const newBreed = !state.discoveredBreeds.includes(childBreed);
    const kitten = E.makeCatInstance(state, child, now, 'nursery', childBreed);
    kitten.bornAt = now; // настоящий новорождённый — появляется маленьким и растёт
    // В слоте тесно: пока малыша не унесли в комнату, срок взросления удвоен
    // (KITTEN_SLOW_FACTOR) — таймер в его карточке сразу показывает 30 мин.
    // moveCat снимет замедление и вернёт обычный темп, сохранив долю роста.
    kitten.growthMs = C.KITTEN_GROWTH_MS * C.KITTEN_SLOW_FACTOR;
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
    // Обучение: факт первого рождения фиксируем флагом — самого котёнка новичок
    // тут же учится пристраивать, и по коллекции это событие потом не восстановить.
    if (state.tutorial && !state.tutorial.done) state.tutorial.bornOnce = true;
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
      slotIndex: i, kitten,
      motherBreed: mother.breed, fatherBreed: father.breed,
      kinship: ctx.kinship, rep: Math.round(rep), newBreed,
    });
  }
  return events;
}

/**
 * Купить простого кота в приют (первый бесплатно, если котов нет). Если при этом
 * нет и денег — выдаём сразу пару ♀+♂ (E.isRescuePair), чтобы игрок мог вязать.
 * `cats` — все выданные коты (1 или 2), `cat` — первый из них.
 */
export function buyCat(state: GameState, rng: Rng, now: number): Result<{ cat: Cat; cats: Cat[] }> {
  const pair = E.isRescuePair(state);
  const need = pair ? 2 : 1;
  if (E.roomCount(state, 'shelter') + need > E.shelterCapacity(state)) {
    return { ok: false, reason: t('нет места в приюте', 'no room in the shelter') };
  }
  const cost = E.buyCatCost(state);
  if (!spend(state, 'coins', cost)) return { ok: false, reason: t('не хватает монет', 'not enough coins') };
  // обычная покупка — пол случайный; спасательная пара — строго самка и самец
  const sexes: (Sex | undefined)[] = pair ? ['female', 'male'] : [undefined];
  const cats = sexes.map((sex) => {
    const cat = E.makeCatInstance(state, simpleCat(rng, sex), now, 'shelter');
    cat.isNew = true; // бейдж «новый» над котом, пока не откроют его инфо-меню
    // лотерея скрытых генов у купленного дворового; «Тщательный отбор» сдвигает тиры предков
    attachHiddenPedigree(state, cat, rng, E.hiddenTierWeights(state));
    state.cats.push(cat);
    return cat;
  });
  return { ok: true, cat: cats[0]!, cats };
}

// --- Комнаты ---

/** Пристройство кота «в добрые руки»: 💰 + 🧬 + ⭐ опыт, кот покидает коллекцию. */
export function adoptCat(state: GameState, catId: string): Result<{ coins: number; dna: number; rep: number }> {
  const cat = findCat(state, catId);
  if (!cat) return { ok: false, reason: t('кот не найден', 'cat not found') };
  if (E.isBusy(state, catId)) return { ok: false, reason: t('кот занят в вязке', 'the cat is busy breeding') };
  const { coins, dna } = E.adoptReward(state, cat);
  state.coins += coins;
  state.dna += dna;
  const { gained: rep } = addReputation(state, E.catMarketValue(cat) * C.REP_ADOPT_MULT);
  removeCat(state, catId);
  // Шаг обучения «в добрые руки» из состояния не вычислить — пристроенный кот из
  // него исчезает; отмечаем сам факт (см. game/tutorial.ts).
  if (state.tutorial && !state.tutorial.done) state.tutorial.adoptDone = true;
  return { ok: true, coins, dna, rep };
}

/** Сдать кота в лабораторию «на эксперименты»: 🧬 + немного 💰 + ⭐ опыт, кот уезжает. */
export function sendToLab(state: GameState, catId: string): Result<{ dna: number; coins: number; rep: number }> {
  const cat = findCat(state, catId);
  if (!cat) return { ok: false, reason: t('кот не найден', 'cat not found') };
  if (!E.isUnlocked(state, 'labStation')) return { ok: false, reason: 'locked' };
  if (E.isBusy(state, catId)) return { ok: false, reason: t('кот занят в вязке', 'the cat is busy breeding') };
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
  if (cats.length === 0) return { ok: false, reason: t('В приюте некого раздавать', 'No cats to give away') };
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
  if (cats.length === 0) return { ok: false, reason: t('В приюте некого сдавать', 'No cats to send to the lab') };
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
  if (!cat) return { ok: false, reason: t('кот не найден', 'cat not found') };
  if (!E.isAdult(cat, now)) return { ok: false, reason: t('котёнок ещё не вырос', "the kitten hasn't grown up yet") };
  if (slotIndex < 0 || slotIndex >= E.championSlots(state)) {
    return { ok: false, reason: t('пьедестал заперт', 'the pedestal is locked') };
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
  } else if (E.isInSlot(state, catId) || E.isInBasket(state, catId)) {
    // источник — спецместо (слот вязки или корзина заказов): места на полу кот там не
    // занимал, меняться нечем — снятому чемпиону ищем физический дом
    if (displaced) {
      const home = homeFloorFor(state, displaced.location);
      if (!home) return { ok: false, reason: t('нет места в лаборатории', 'no room in the lab') };
      displaced.location = home;
    }
    clearBreederSlot(state, catId);
    if (state.orderBasket === catId) state.orderBasket = null; // с корзины на пьедестал — без дубля
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

/**
 * Мгновенно вырастить котёнка за 💎 (скип роста). Стоимость ∝ остатку роста, но в
 * обычном масштабе (`growthBillableMs`): растянутый срок в слоте цену не удваивает.
 */
export function speedUpGrowth(state: GameState, catId: string, now: number): Result<{ crystals: number }> {
  const cat = findCat(state, catId);
  if (!cat) return { ok: false, reason: t('кот не найден', 'cat not found') };
  const remaining = E.growthBillableMs(cat, now);
  if (remaining <= 0) return { ok: true, crystals: 0 };
  const cost = E.speedUpCost(remaining, C.GROWTH_SPEEDUP_CRYSTAL_PER_MIN);
  if (!spend(state, 'crystals', cost)) return { ok: false, reason: t('не хватает кристаллов', 'not enough crystals') };
  cat.bornAt = now - E.effGrowthMs(cat); // возраст ≥ срок → сразу взрослый
  return { ok: true, crystals: cost };
}

/**
 * Подарочный ускоритель роста: котёнок мгновенно взрослеет бесплатно. Запас — первые
 * C.FREE_GROWTH_COUNT котят новой игры (счётчик `state.freeGrowthLeft`). Смысл тот же,
 * что у подарочных вязок: пол, имя и облик проявляются только у взрослого, и без
 * подарка новичок полчаса не знает, кто у него родился. Кончился запас — остаются
 * штатные 📺 и 💎. Возвращает остаток подарков (UI показывает его на кнопке и в тосте).
 */
export function freeGrowKitten(state: GameState, catId: string, now: number): Result<{ left: number }> {
  const cat = findCat(state, catId);
  if (!cat) return { ok: false, reason: t('кот не найден', 'cat not found') };
  // Взрослому подарок не тратим: расти уже некуда (котёнок мог дорасти сам,
  // пока диалог был открыт) — просто ничего не делаем.
  if (E.growthRemainingMs(cat, now) <= 0) return { ok: true, left: state.freeGrowthLeft };
  if (state.freeGrowthLeft <= 0) return { ok: false, reason: t('бесплатные ускорения роста закончились', 'no free grow-ups left') };
  state.freeGrowthLeft -= 1;
  cat.bornAt = now - E.effGrowthMs(cat); // возраст ≥ срок → сразу взрослый
  return { ok: true, left: state.freeGrowthLeft };
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
  if (!cat) return { ok: false, reason: t('кот не найден', 'cat not found') };
  if (!E.isUnlocked(state, 'clinic')) return { ok: false, reason: 'locked' };
  if (E.isSterile(cat)) return { ok: false, reason: t('бесплодного не вылечить', "a sterile cat can't be healed") };
  // Кота, ПОСТАВЛЕННОГО в слот вязки, ветеринар лечит прямо в Инкубаторе (в этом
  // весь смысл шприца там) — но НЕ во время идущей вязки: сердца уже «в работе».
  const inBreeding = state.slots.some(
    (sl) => sl.readyAt > 0 && (sl.motherId === catId || sl.fatherId === catId),
  );
  if (inBreeding) return { ok: false, reason: t('кот сейчас в вязке', 'the cat is breeding right now') };
  const spent = cat.breedCount ?? 0;
  if (spent <= 0) return { ok: false, reason: t('кот полностью здоров', 'the cat is fully healthy') };
  if (mode === 'ad') {
    const healed = Math.min(spent, C.HEAL_AD_HEARTS);
    cat.breedCount = spent - healed;   // реклама-заглушка, реальный SDK — бэклог
    state.lastHealAdAt = Math.max(1, now); // фиксируем факт просмотра (кулдауна нет)
    return { ok: true, healed, crystals: 0 };
  }
  const cost = C.HEAL_CRYSTAL_PER_HEART * spent;
  if (!spend(state, 'crystals', cost)) return { ok: false, reason: t('не хватает кристаллов', 'not enough crystals') };
  cat.breedCount = 0;                  // полное восстановление
  return { ok: true, healed: spent, crystals: cost };
}

/**
 * Реклама: вырастить котёнка целиком (кнопка так и обещает — «вырастить бесплатно»).
 * Не фиксированные минуты, а весь остаток: у малыша в слоте срок удвоен, и срез на
 * четверть часа оставлял бы его котёнком после просмотра ролика.
 */
export function adSkipGrowth(state: GameState, catId: string, now: number): Result {
  const cat = findCat(state, catId);
  if (!cat) return { ok: false, reason: t('кот не найден', 'cat not found') };
  if (E.growthRemainingMs(cat, now) <= 0) return { ok: true };
  cat.bornAt = now - E.effGrowthMs(cat); // возраст ≥ срок → сразу взрослый
  return { ok: true };
}

/**
 * Перемещение кота между питомником и приютом (с учётом вместимости).
 * `now` нужен малышу, «оставленному с роднёй»: в комнате он снова растёт в обычном
 * темпе, поэтому замедление снимается с сохранением накопленной доли роста.
 */
export function moveCat(state: GameState, catId: string, room: LiveRoom, now = 0): Result {
  const cat = findCat(state, catId);
  if (!cat) return { ok: false, reason: t('кот не найден', 'cat not found') };
  // Кот физически «не на полу», хотя location может формально совпадать с целевой
  // комнатой: либо в слоте инкубатора (родитель вязки / малыш с роднёй), либо на
  // пьедестале выставки (чемпион). В обоих случаях ранний выход по location — ложный,
  // иначе пристройство проскакивает проверку вместимости.
  const grounded = !E.isInSlot(state, catId) && !E.isChampion(state, catId) && !E.isInBasket(state, catId);
  if (grounded && cat.location === room) return { ok: true };
  if (E.roomCount(state, room) >= E.capacityOf(state, room)) {
    return { ok: false, reason: t('нет места', 'no room') };
  }
  cat.location = room;
  const heldSlot = state.slots.find((s) => s.kittenId === catId);
  if (heldSlot) {
    heldSlot.kittenId = null; // унесли малыша → слот свободен под новую пару
    if (cat.growthMs) {
      // В комнате места хватает — дальше обычный темп. Долю роста, накопленную в
      // слоте, переносим как есть: перенос ускоряет, но не обнуляет прогресс.
      const p = E.growthProgress(cat, now);
      delete cat.growthMs;
      cat.bornAt = now - Math.round(p * C.KITTEN_GROWTH_MS);
    }
  }
  unsetChampion(state, catId); // переехал на пол — с пьедестала снят (no-op, если не был чемпионом)
  if (state.orderBasket === catId) state.orderBasket = null; // и из корзины вынут — он теперь на полу
  return { ok: true };
}

/**
 * Оставить новорождённого в слоте с родителями (на крайний случай, когда мест нигде
 * нет): малыш сидит в центре слота, растёт вдвое медленнее (KITTEN_SLOW_FACTOR) и
 * блокирует постановку новых котов, пока его не унесут в комнату. Медленный рост
 * малышу включил ещё collectReady при рождении — здесь только подтверждаем его на
 * случай, если кота уже успели пронести через комнату (moveCat снимает замедление).
 * Отсчёт НЕ перезапускаем: прожитое в слоте время малышу засчитано.
 */
export function keepKittenWithParents(state: GameState, catId: string, _now = 0): Result {
  const cat = findCat(state, catId);
  if (!cat) return { ok: false, reason: t('кот не найден', 'cat not found') };
  cat.growthMs = C.KITTEN_GROWTH_MS * C.KITTEN_SLOW_FACTOR;
  return { ok: true };
}

/** Дать/сменить имя коту. Пустая строка — сбросить имя. Длина обрезается до 16. */
export function renameCat(state: GameState, catId: string, name: string): Result {
  const cat = findCat(state, catId);
  if (!cat) return { ok: false, reason: t('кот не найден', 'cat not found') };
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
  if (!cat) return { ok: false, reason: t('кот не найден', 'cat not found') };
  if (!E.cryoUnlocked(state)) return { ok: false, reason: 'locked' };
  if (!E.isAdult(cat, now)) return { ok: false, reason: t('котёнок ещё не вырос', "the kitten hasn't grown up yet") };
  if (E.isInSlot(state, catId)) return { ok: false, reason: t('кот в слоте вязки', 'the cat is in a breeding slot') };
  if (E.isChampion(state, catId)) return { ok: false, reason: t('сначала снять с пьедестала', 'take it off the pedestal first') };
  if (E.cryoCount(state) >= E.cryoCapacity(state)) return { ok: false, reason: t('нет свободной капсулы', 'no free capsule') };
  // Оплата — только после того, как заморозка гарантированно пройдёт (ничего не спишем впустую).
  let coins = 0, crystals = 0;
  if (mode === 'ad') {
    // lastFreezeAdAt = 0 → рекламу ещё ни разу не смотрели (кулдауна нет)
    if (state.lastFreezeAdAt > 0 && now - state.lastFreezeAdAt < C.FREEZE_AD_COOLDOWN_MS) {
      return { ok: false, reason: t('реклама заморозки ещё недоступна', "the freeze ad isn't available yet") };
    }
    state.lastFreezeAdAt = Math.max(1, now); // 0 зарезервирован под «не смотрели»
  } else if (mode === 'coins') {
    if (!spend(state, 'coins', C.FREEZE_COIN_COST)) return { ok: false, reason: t('не хватает монет', 'not enough coins') };
    coins = C.FREEZE_COIN_COST;
  } else {
    if (!spend(state, 'crystals', C.FREEZE_CRYSTAL_COST)) return { ok: false, reason: t('не хватает кристаллов', 'not enough crystals') };
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
  if (!original) return { ok: false, reason: t('капсула не найдена', 'capsule not found') };
  if (!E.cryoUnlocked(state)) return { ok: false, reason: 'locked' };
  if (E.roomCount(state, 'nursery') >= E.nurseryCapacity(state)) {
    return { ok: false, reason: t('нет места в питомнике', 'no room in the cattery') };
  }
  const cost = E.cloneCost(original);
  const coinsCost = E.cloneCostCoins(original);
  if (state.dna < cost) return { ok: false, reason: t('не хватает ДНК', 'not enough DNA') };
  if (state.coins < coinsCost) return { ok: false, reason: t('не хватает монет', 'not enough coins') };
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
  if (state.cryo.length === before) return { ok: false, reason: t('капсула не найдена', 'capsule not found') };
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
  if (E.upgradeMaxed(state, id)) return { ok: false, reason: t('максимальный уровень', 'max level') };
  const cost = E.upgradeCost(state, id);
  if (!cost) return { ok: false, reason: t('нет такого апгрейда', 'no such upgrade') };
  if (!canAfford(state, cost.currency, cost.amount)) return { ok: false, reason: t('не хватает ресурсов', 'not enough resources') };
  spend(state, cost.currency, cost.amount);
  if (id === 'slots') state.slots.push(E.emptySlot());
  else state.upgrades[id] = E.lvl(state, id) + 1;
  return { ok: true };
}

// --- Генолаб ---

export function unlockGene(state: GameState, geneId: string): Result {
  const def = C.GENES[geneId];
  if (!def) return { ok: false, reason: t('нет такого гена', 'no such gene') };
  if (state.unlockedGenes.includes(geneId)) return { ok: false, reason: t('уже открыт', 'already unlocked') };
  if (!spend(state, 'dna', def.dna)) return { ok: false, reason: t('не хватает ДНК', 'not enough DNA') };
  state.unlockedGenes.push(geneId);
  return { ok: true };
}

/**
 * Генетический анализ кота (система знаний, этап B): вскрывает СРАЗУ всё дерево
 * родословной (туман) и список скрытых генов — пород предков. Механику НЕ меняет:
 * скрытые гены влияли на рецепты и до анализа, игрок лишь получает информацию.
 * Три способа оплаты: 'pay' = 💰 + 🧬 по УРОВНЮ ЛАБОРАТОРИИ (C.analyzeCost — цена растёт
 * вместе с доходами игрока, а не с тиром кота), 'crystals' = ANALYZE_CRYSTAL_COST 💎
 * (страховка, когда кончились и монеты, и гены) или '📺 ad' — бесплатно и БЕЗ кулдауна.
 */
export function analyzeCat(
  state: GameState, catId: string, mode: 'pay' | 'crystals' | 'ad' = 'pay', now = 0,
): Result<{ coins: number; dna: number; crystals: number }> {
  void now; // кулдауна у анализа больше нет — параметр оставлен ради совместимости сигнатуры
  // Анализ доступен и замороженным котам (крио-банк) — родословную вскрывают и в капсуле.
  const cat = findCat(state, catId) ?? (state.cryo ?? []).find((c) => c.id === catId);
  if (!cat) return { ok: false, reason: t('кот не найден', 'cat not found') };
  const free = { ok: true as const, coins: 0, dna: 0, crystals: 0 };
  if (cat.analyzed) { revealPedigree(cat); return free; } // уже изучен
  const price = C.analyzeCost(state.level);
  let paid = free;
  if (mode === 'ad') {
    state.lastAnalyzeAdAt = Math.max(1, now); // фиксируем факт просмотра (кулдауна нет)
  } else if (mode === 'crystals') {
    if (!spend(state, 'crystals', C.ANALYZE_CRYSTAL_COST)) {
      return { ok: false, reason: t('не хватает кристаллов', 'not enough crystals') };
    }
    paid = { ...free, crystals: C.ANALYZE_CRYSTAL_COST };
  } else {
    // 💰 и 🧬 списываем атомарно: проверяем ОБЕ валюты до первого списания, иначе
    // ушли бы монеты, а на гены бы не хватило (та же схема, что у unlockResearch).
    if (state.coins < price.coins) return { ok: false, reason: t('не хватает монет', 'not enough coins') };
    if (state.dna < price.dna) return { ok: false, reason: t('не хватает ДНК', 'not enough DNA') };
    spend(state, 'coins', price.coins);
    spend(state, 'dna', price.dna);
    paid = { ...free, coins: price.coins, dna: price.dna };
  }
  cat.analyzed = true;
  revealPedigree(cat);
  return paid;
}

/**
 * Подарочный Генетический анализ: первые C.FREE_ANALYZE_COUNT котов изучаются
 * бесплатно (счётчик `state.freeAnalyzeLeft`). Смысл тот же, что у подарочного
 * ускорителя вязки, только запаса хватает дальше обучения: новичок должен успеть
 * сравнить несколько родословных и понять, за что потом платит 💰 или 📺.
 * Возвращает остаток подарков — UI показывает его в тосте и на кнопках.
 */
export function freeAnalyzeCat(state: GameState, catId: string): Result<{ left: number }> {
  if (state.freeAnalyzeLeft <= 0) return { ok: false, reason: t('бесплатные анализы закончились', 'no free analyses left') };
  const cat = findCat(state, catId) ?? (state.cryo ?? []).find((c) => c.id === catId);
  if (!cat) return { ok: false, reason: t('кот не найден', 'cat not found') };
  if (cat.analyzed) return { ok: false, reason: t('кот уже изучен', 'the cat is already analysed') };
  state.freeAnalyzeLeft -= 1;
  cat.analyzed = true;
  revealPedigree(cat);
  return { ok: true, left: state.freeAnalyzeLeft };
}

// --- Исследование рецептов (вкладка «Исследования» Генолаба, этап D) ---

/**
 * Запустить стол исследований: комбинированная цена 💰 + 🧬, один слот-таймер.
 * Итог по готовности выдаёт finishRecipeResearch. Запуск невозможен, если пул
 * достижимых рецептов пуст (UI в этом случае прячет кнопку).
 */
export function startRecipeResearch(state: GameState, now: number): Result {
  if (!E.isUnlocked(state, 'recipeLab')) return { ok: false, reason: 'locked' };
  if (state.recipeResearch.readyAt > 0) return { ok: false, reason: t('стол занят исследованием', 'the bench is busy researching') };
  if (state.recipeResearch.pending) return { ok: false, reason: t('на столе ждёт невскрытая колба', 'a sealed flask is waiting on the bench') };
  if (researchableRecipes(state).length === 0) return { ok: false, reason: t('нет доступных рецептов', 'no recipes available') };
  const price = C.recipeResearchCost(state.level);
  if (state.coins < price.coins || state.dna < price.dna) {
    return { ok: false, reason: t('не хватает ресурсов', 'not enough resources') };
  }
  state.coins -= price.coins;
  state.dna -= price.dna;
  state.recipeResearch = {
    startedAt: now,
    readyAt: now + C.recipeResearchMs(state.level),
    paidCoins: price.coins,
    paidDna: price.dna,
    pending: null,
  };
  return { ok: true };
}

/**
 * Дождаться конца ГОТОВОГО исследования: случайный ещё не открытый рецепт из
 * достижимого пула запечатывается в колбу (rr.pending) — в Котодекс он попадёт
 * только после того, как игрок вскроет её сам (revealRecipeResearch). Название
 * рецепта наружу не отдаём вовсе: уведомление о готовности не должно его выдать.
 * Таймер не готов → sealed: false. Грейс: если пул опустел, пока шло исследование
 * (например, породу успели вывести), — возвращаем стоимость (refunded: true).
 */
export function finishRecipeResearch(
  state: GameState, now: number, rng: Rng,
): { sealed: boolean; refunded: boolean } {
  const rr = state.recipeResearch;
  if (rr.readyAt === 0 || now < rr.readyAt) return { sealed: false, refunded: false };
  const pool = researchableRecipes(state);
  if (pool.length === 0) {
    state.coins += rr.paidCoins;   // возврат ровно уплаченного (цена зависит от уровня)
    state.dna += rr.paidDna;
    rr.startedAt = 0; rr.readyAt = 0; rr.paidCoins = 0; rr.paidDna = 0;
    return { sealed: false, refunded: true };
  }
  rr.startedAt = 0; rr.readyAt = 0; rr.paidCoins = 0; rr.paidDna = 0;
  rr.pending = recipeKey(pool[Math.floor(rng() * pool.length)]!);
  return { sealed: true, refunded: false };
}

/**
 * Вскрыть колбу с готовым результатом: рецепт из pending уходит в knownRecipes
 * (в Котодексе появляется чёрный силуэт) и возвращается сюда — UI играет по нему
 * анимацию раскрытия. Колбы нет → null. Пул на этот момент уже не важен: рецепт
 * выбран в момент готовности и оплачен.
 */
export function revealRecipeResearch(state: GameState): Recipe | null {
  const rr = state.recipeResearch;
  if (!rr.pending) return null;
  const recipe = RECIPES.find((r) => recipeKey(r) === rr.pending) ?? null;
  if (recipe && !state.knownRecipes.includes(rr.pending)) state.knownRecipes.push(rr.pending);
  rr.pending = null; // даже если рецепт из сейва не опознан — колбу со стола убираем
  return recipe;
}

/** Мгновенно завершить исследование рецепта за 💎 (цена ∝ остатку: 1 💎 за 5 мин). */
export function speedUpRecipeResearch(state: GameState, now: number): Result<{ crystals: number }> {
  const rr = state.recipeResearch;
  if (rr.readyAt === 0) return { ok: false, reason: t('стол не занят исследованием', "the bench isn't researching") };
  const cost = E.speedUpCost(Math.max(0, rr.readyAt - now), C.RECIPE_SPEEDUP_CRYSTAL_PER_MIN);
  if (cost > 0 && !spend(state, 'crystals', cost)) return { ok: false, reason: t('не хватает кристаллов', 'not enough crystals') };
  rr.readyAt = now; // готово немедленно — finishRecipeResearch заберёт рецепт
  return { ok: true, crystals: cost };
}

/** Реклама: сократить остаток исследования на RECIPE_AD_SKIP_MS (бесплатно, можно повторять). */
export function adSkipRecipeResearch(state: GameState, now: number): Result {
  const rr = state.recipeResearch;
  if (rr.readyAt === 0) return { ok: false, reason: t('стол не занят исследованием', "the bench isn't researching") };
  rr.readyAt = Math.max(now, rr.readyAt - C.RECIPE_AD_SKIP_MS);
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
  if (!def) return { ok: false, reason: t('нет такого усилителя', 'no such booster') };
  const cost = currency === 'crystals' ? def.crystals : def.dna;
  if (!spend(state, currency, cost)) {
    return { ok: false, reason: currency === 'crystals' ? t('не хватает кристаллов', 'not enough crystals') : t('не хватает ДНК', 'not enough DNA') };
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
  if (!def) return { ok: false, reason: t('нет такого усилителя', 'no such booster') };
  if (!def.adCharge) return { ok: false, reason: t('заряжается только за валюту', 'charged with currency only') };
  // lastBoostAdAt = 0 → рекламу ещё ни разу не смотрели (кулдауна нет)
  if (state.lastBoostAdAt > 0 && now - state.lastBoostAdAt < C.BOOST_AD_COOLDOWN_MS) {
    return { ok: false, reason: t('реклама ещё не готова', "the ad isn't ready yet") };
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
  if (!def) return { ok: false, reason: t('нет такого усилителя', 'no such booster') };
  if (state.activeBoost === def.id) { state.activeBoost = null; return { ok: true }; }
  if (E.boostCharges(state, def.id) <= 0) return { ok: false, reason: t('нет зарядов', 'no charges') };
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
  if (!def) return { ok: false, reason: t('нет такого исследования', 'no such research') };
  if (!E.isUnlocked(state, 'research')) return { ok: false, reason: 'locked' };
  const next = E.researchNext(state, def);
  if (!next) return { ok: false, reason: t('уже изучено', 'already researched') };
  // Гейт уровня: этот уровень узла открывается только с нужного уровня лаборатории.
  if (state.level < next.minLevel) return { ok: false, reason: 'locked' };
  if (!def.requires.every((req) => E.researchOwned(state, req))) {
    return { ok: false, reason: t('сначала изучи предыдущее', 'research the previous one first') };
  }
  // Двойная цена: основная валюта узла + доп. монеты (у Селекции на 🧬). Проверяем
  // и списываем атомарно — иначе списали бы гены, а на монеты бы не хватило.
  const extraCoins = E.researchExtraCoins(def, next);
  if (!E.canAffordResearch(state, def, next)) {
    return {
      ok: false,
      reason: def.currency !== 'coins' && state[def.currency] >= next.cost ? t('не хватает монет', 'not enough coins')
        : def.currency === 'coins' ? t('не хватает монет', 'not enough coins') : t('не хватает ДНК', 'not enough DNA'),
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
 * Кот берётся только из корзины (зона в Питомнике) — предъявить клиенту кота, которого
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
  if (!order) return { ok: false, reason: t('заказ не найден', 'order not found') };
  const catId = state.orderBasket;
  if (!catId) return { ok: false, reason: t('положите кота в корзину заказов', 'put a cat into the order basket') };
  const cat = findCat(state, catId);
  if (!cat) return { ok: false, reason: t('кот не найден', 'cat not found') };
  if (E.isBusy(state, catId)) return { ok: false, reason: t('кот занят в вязке', 'the cat is busy breeding') };
  if (!matchesOrder(order, cat)) return { ok: false, reason: t('кот в корзине не подходит под заказ', "the cat in the basket doesn't match the order") };

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

// --- Корзина заказов (зона в Питомнике) ---

/**
 * Положить кота в корзину заказов: только им можно закрыть заказ. Корзина — такое же
 * отдельное место, как слот вязки и пьедестал: кот в ней НЕ занимает места на полу
 * (см. `roomCount`) и не стоит одновременно нигде ещё — поэтому забираем его хоть с
 * пола, хоть из слота вязки (неактивного), хоть с пьедестала. Нельзя только того, у
 * кого вязка идёт прямо сейчас. Прежнего жильца корзины возвращаем на пол — и если
 * его комната успела заполниться, ищем ему свободную (некуда — отказ, корзина цела).
 */
export function putCatInBasket(state: GameState, catId: string): Result {
  const cat = findCat(state, catId);
  if (!cat) return { ok: false, reason: t('кот не найден', 'cat not found') };
  if (E.isBusy(state, catId)) return { ok: false, reason: t('кот занят в вязке', 'the cat is busy breeding') };
  if (state.orderBasket === catId) return { ok: true }; // уже в корзине

  const prevId = state.orderBasket;
  state.orderBasket = catId;      // новый жилец занял корзину — его место на полу свободно
  clearBreederSlot(state, catId); // пришёл из слота вязки — слот освобождается
  unsetChampion(state, catId);    // пришёл с пьедестала — снят с выставки
  const prev = prevId ? findCat(state, prevId) : undefined;
  if (prev) {
    const home = homeFloorFor(state, prev.location);
    if (!home) {
      state.orderBasket = prevId; // откат: вытесненному коту негде стоять
      return { ok: false, reason: t('некуда вернуть кота из корзины', 'nowhere to put the cat from the basket') };
    }
    prev.location = home;
  }
  return { ok: true };
}

/** Комната с местом на полу для кота, покидающего спецместо: своя → питомник → приют. */
function homeFloorFor(state: GameState, preferred: LiveRoom): LiveRoom | null {
  if (E.roomCount(state, preferred) < E.capacityOf(state, preferred)) return preferred;
  if (E.roomCount(state, 'nursery') < E.nurseryCapacity(state)) return 'nursery';
  if (E.roomCount(state, 'shelter') < E.shelterCapacity(state)) return 'shelter';
  return null;
}

/** Вынуть кота из корзины (сама корзина пустеет; место на полу проверяет moveCat). */
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
  if (!pack) return { ok: false, reason: t('неизвестный товар', 'unknown product') };
  if (purchaseToken && state.processedPurchases.includes(purchaseToken)) {
    return { ok: false, reason: t('покупка уже начислена', 'purchase already credited') };
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
