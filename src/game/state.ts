/**
 * Создание начального состояния и сериализация сейва (Этап 4). См. GAME.md.
 */

import { randomCat } from '../genetics/index.js';
import type { Rng } from '../genetics/index.js';
import type { GameState } from './types.js';
import {
  BASE_GENES, MAX_HEARTS, SAVE_VERSION, FOOD_CAP_BASE, ORDER_REFRESH_MS, ORDER_SELL_SLOTS,
  START_COINS, START_CRYSTALS, START_DNA,
  FREE_ANALYZE_COUNT, FREE_GROWTH_COUNT,
  levelForReputation,
} from './config.js';
import { emptySlot, makeCatInstance } from './economy.js';
import { TUTOR_GENOLAB_TABS } from './tutorial.js';
import { attachHiddenPedigree, revealPedigree } from './pedigree.js';
import { initOrders } from './orders.js';

/** Новое состояние новой игры: стартовая пара котов, 1 слот, базовые гены, заказы. */
export function createInitialState(rng: Rng, now: number): GameState {
  const state: GameState = {
    version: SAVE_VERSION,
    coins: START_COINS,
    crystals: START_CRYSTALS, // 💎 на старте нет — весь капитал в подарке за обучение
    dna: START_DNA,
    level: 1,
    reputation: 0,
    cats: [],
    slots: [emptySlot()],
    upgrades: {},
    unlockedGenes: [...BASE_GENES],
    discoveredBreeds: [],
    allBreedsCongratsSeen: false,
    boosts: {},
    activeBoost: null,
    research: {},
    knownRecipes: [],
    recipeResearch: { startedAt: 0, readyAt: 0, paidCoins: 0, paidDna: 0, pending: null },
    cryo: [],
    unlockedRooms: ['incubator', 'nursery', 'shelter', 'genolab'],
    orders: [],
    orderBasket: null,
    champions: [],
    food: FOOD_CAP_BASE, // кормушка стартует полной
    lastSeenAt: now,
    lastHealAdAt: 0,     // 📺-лечение в клинике доступно всегда (кулдауна нет)
    lastAnalyzeAdAt: 0,  // 📺-вариант Генетического анализа сразу доступен
    freeAnalyzeLeft: FREE_ANALYZE_COUNT, // первые анализы новичку — подарок лаборатории
    freeGrowthLeft: FREE_GROWTH_COUNT,   // и первых котят он растит бесплатно
    lastFreezeAdAt: 0,   // 📺-вариант заморозки сразу доступен
    lastBoostAdAt: 0,    // 📺-зарядка усилителя сразу доступна
    processedPurchases: [],
    firstPurchaseDone: false,
    reviewAsks: 0,
    reviewLastAskAt: 0,
    // новая игра — обучение с нуля (подарки целы, ничего ещё не показано)
    tutorial: {
      done: false,
      bornOnce: false, previewSeen: false, ordersSeen: false, genolabSeen: false,
      genolabTabs: [], adoptDone: false, rewardTaken: false,
    },
    nextId: 1,
  };
  // стартовая пара для первой вязки — со скрытой родословной (лотерея генов)
  for (const sex of ['female', 'male'] as const) {
    const cat = makeCatInstance(state, randomCat(rng, sex), now, 'nursery');
    attachHiddenPedigree(state, cat, rng);
    state.cats.push(cat);
  }
  initOrders(state, rng, now); // стартовая доска: часть слотов «сбыт», часть «цель»
  return state;
}

export function serialize(state: GameState): string {
  return JSON.stringify(state);
}

/**
 * Восстанавливает состояние из сейва. Сейвы прежних версий сбрасываются на
 * стороне загрузчика (game.ts сверяет version с SAVE_VERSION) — v6 сломал
 * совместимость: research стал картой id→уровень (было — массив id).
 */
export function deserialize(json: string): GameState {
  const data = JSON.parse(json) as GameState;
  // мягкие дефолты для полей, добавленных в новых версиях
  if (!Array.isArray(data.discoveredBreeds)) data.discoveredBreeds = [];
  // Финальное поздравление за полный Котодекс — поле добавлено позже. Старым
  // сейвам ставим false: если коллекция там уже собрана, панель покажется один
  // раз при ближайшем действии — она заслужена и без флага в сейве.
  if (typeof data.allBreedsCongratsSeen !== 'boolean') data.allBreedsCongratsSeen = false;
  if (!data.boosts || typeof data.boosts !== 'object') data.boosts = {};
  // Активный усилитель — поле добавлено позже (склад зарядов отделён от активности).
  // У старых сейвов его нет → активируем первый усилитель, у которого есть заряды,
  // чтобы поведение «заряжен → сработает» сохранилось.
  if (typeof data.activeBoost === 'undefined') {
    data.activeBoost = Object.keys(data.boosts).find((k) => (data.boosts[k] ?? 0) > 0) ?? null;
  }
  // research с v6 — карта id→уровень; старый формат (массив id) больше не совместим,
  // но сейвы прежних версий и так сбрасываются загрузчиком по SAVE_VERSION.
  if (!data.research || typeof data.research !== 'object' || Array.isArray(data.research)) {
    data.research = {};
  }
  // Крио-банк — поле добавлено позже; у старых сейвов его нет → пустое хранилище
  // (без бампа SAVE_VERSION — новых обязательных полей у котов не появилось).
  if (!Array.isArray(data.cryo)) data.cryo = [];
  if (!Array.isArray(data.champions)) data.champions = [];
  for (const cat of data.cats) {
    if (typeof cat.breedCount !== 'number') cat.breedCount = 0;
    if (typeof cat.maxHearts !== 'number') cat.maxHearts = MAX_HEARTS;
  }
  // «оставленный с роднёй» малыш в слоте — поле добавлено позже, у старых сейвов его нет
  for (const slot of data.slots) {
    if (slot.kittenId === undefined) slot.kittenId = null;
  }
  // Уровень лаборатории пересчитываем из накопленного опыта по актуальной таблице
  // порогов: сейвы, сделанные при старой линейной формуле, приводятся в согласованность
  // (новых полей нет — бамп SAVE_VERSION не нужен).
  data.level = levelForReputation(data.reputation ?? 0);
  // Кормушка — поле добавлено в этапе B; у старых сейвов его нет → стартуем полными.
  if (typeof data.food !== 'number') data.food = FOOD_CAP_BASE;
  // Кулдаун 📺-лечения клиники — поле этапа D; 0 = реклама сразу доступна.
  if (typeof data.lastHealAdAt !== 'number') data.lastHealAdAt = 0;
  // --- Система знаний (поля добавлены позже; мягкие дефолты без бампа версии) ---
  if (!Array.isArray(data.knownRecipes)) data.knownRecipes = [];
  if (!data.recipeResearch || typeof data.recipeResearch !== 'object') {
    data.recipeResearch = { startedAt: 0, readyAt: 0, paidCoins: 0, paidDna: 0, pending: null };
  } else {
    // paidCoins/paidDna добавлены позже — мягкий дефолт для старых сейвов.
    if (typeof data.recipeResearch.paidCoins !== 'number') data.recipeResearch.paidCoins = 0;
    if (typeof data.recipeResearch.paidDna !== 'number') data.recipeResearch.paidDna = 0;
    // pending (невскрытая колба) — поле добавлено позже: у старых сейвов колбы нет.
    if (typeof data.recipeResearch.pending !== 'string') data.recipeResearch.pending = null;
  }
  if (typeof data.lastAnalyzeAdAt !== 'number') data.lastAnalyzeAdAt = 0;
  if (typeof data.lastFreezeAdAt !== 'number') data.lastFreezeAdAt = 0;
  if (typeof data.lastBoostAdAt !== 'number') data.lastBoostAdAt = 0;
  // Заказы (v9): у каждого свой таймер жизни (refillAt→expiresAt) и свой кулдаун
  // 📺-обновления (adRefreshAt, раньше был один глобальный state.orderAdRefreshAt).
  // Старые сейвы и так сбрасываются загрузчиком по SAVE_VERSION; здесь — мягкая страховка.
  if (!Array.isArray(data.orders)) data.orders = [];
  data.orders.forEach((o, i) => {
    if (typeof o.expiresAt !== 'number') o.expiresAt = (o.createdAt ?? 0) + ORDER_REFRESH_MS;
    if (typeof o.adRefreshAt !== 'number') o.adRefreshAt = 0; // 📺 сразу доступно
    if (o.kind !== 'sell' && o.kind !== 'target') o.kind = i < ORDER_SELL_SLOTS ? 'sell' : 'target';
  });
  // Инап-покупки: поля добавлены с этапом 5.3. Мягкие дефолты без бампа SAVE_VERSION —
  // сбрасывать прогресс из-за чисто аддитивных полей нельзя (тем более у платящих).
  if (!Array.isArray(data.processedPurchases)) data.processedPurchases = [];
  if (typeof data.firstPurchaseDone !== 'boolean') data.firstPurchaseDone = false;
  // Просьба об оценке — поля добавлены позже: старому сейву даём чистый счётчик
  // (окно у него ещё не всплывало, платформа сама не даст показать его повторно
  // тому, кто уже оценил игру — GAME_RATED).
  if (typeof data.reviewAsks !== 'number') data.reviewAsks = 0;
  if (typeof data.reviewLastAskAt !== 'number') data.reviewLastAskAt = 0;
  // Обучение новичка: поля нет только у сейвов, сделанных ДО его появления —
  // а там игра уже началась, и водить игрока за руку по первой вязке поздно.
  // Такому сейву обучение сразу закрыто (и подарочный ускоритель не положен).
  if (!data.tutorial || typeof data.tutorial !== 'object') {
    data.tutorial = {
      done: true,
      bornOnce: true, previewSeen: true, ordersSeen: true, genolabSeen: true,
      genolabTabs: [...TUTOR_GENOLAB_TABS], adoptDone: true, rewardTaken: true,
    };
  } else {
    const t = data.tutorial;
    if (typeof t.done !== 'boolean') t.done = true;
    // Поля второй половины обучения (прогноз пары, пристройство, заказы)
    // добавлены позже. Сейву с ЗАКРЫТЫМ обучением они уже ни на что не влияют, а
    // недопройденному отдаём «ещё не показано» — подсказки продолжатся с нужного шага.
    // факт первого рождения у старого сейва восстанавливаем по самим котам
    // (tutorialStep умеет и так — держим значения согласованными)
    if (typeof t.bornOnce !== 'boolean') {
      t.bornOnce = t.done || data.cats.some((c) => !!(c.motherBreed || c.fatherBreed));
    }
    if (typeof t.previewSeen !== 'boolean') t.previewSeen = t.done;
    if (typeof t.ordersSeen !== 'boolean') t.ordersSeen = t.done;
    if (typeof t.genolabSeen !== 'boolean') t.genolabSeen = t.done;
    // Шаг «Генолаб» раньше закрывался одной вкладкой (📖 Котодекс), теперь ведёт
    // по всем трём. Кто его уже прошёл — считается обошедшим все, остальным
    // список пуст: обход начнётся с Котодекса, как и у новой игры.
    if (!Array.isArray(t.genolabTabs)) t.genolabTabs = t.genolabSeen ? [...TUTOR_GENOLAB_TABS] : [];
    if (typeof t.adoptDone !== 'boolean') t.adoptDone = t.done;
    // Обучение стало обязательным и непропускаемым (см. game/tutorial.ts), поэтому
    // «свёрнутые подсказки» из промежуточной версии вычищаем из сейва.
    delete (t as { hintsOff?: boolean }).hintsOff;
    // Подарок за обучение появился позже стартовых 💎: сейву с уже ЗАКРЫТЫМ обучением
    // он не положен (тот игрок начинал с 5 💎 на руках), недопройденному — положен.
    if (typeof t.rewardTaken !== 'boolean') t.rewardTaken = t.done;
  }
  // Запасы подарков (анализы и ускорения роста): раньше каждый подарок был ОДИН и жил
  // флагом в tutorial (freeAnalyzeUsed / freeSkipUsed). Сейву с уже закрытым обучением
  // запас не положен (тот игрок свои подарки отыграл), недопройденному отдаём остаток
  // нового запаса за вычетом потраченного подарка. Легаси-флаги (в т.ч. от вязки, у
  // которой ускорений больше нет вовсе) убираем из сейва.
  const legacy = data.tutorial as { freeAnalyzeUsed?: boolean; freeSkipUsed?: boolean };
  if (typeof data.freeAnalyzeLeft !== 'number') {
    data.freeAnalyzeLeft = data.tutorial.done ? 0
      : FREE_ANALYZE_COUNT - (legacy.freeAnalyzeUsed ? 1 : 0);
  }
  // У роста подарка раньше не было вовсе — легаси-флага нет, правило то же.
  if (typeof data.freeGrowthLeft !== 'number') {
    data.freeGrowthLeft = data.tutorial.done ? 0 : FREE_GROWTH_COUNT;
  }
  delete legacy.freeAnalyzeUsed;
  delete legacy.freeSkipUsed;
  delete (data as { freeSkipLeft?: number }).freeSkipLeft; // ускорений вязки больше нет
  data.freeAnalyzeLeft = Math.max(0, Math.floor(data.freeAnalyzeLeft));
  data.freeGrowthLeft = Math.max(0, Math.floor(data.freeGrowthLeft));
  // Миграция тумана родословной: в старых сейвах у узлов pedigree нет флага known →
  // всё дерево ушло бы в туман. Анализированным котам вскрываем дерево целиком;
  // рождённым в инкубаторе (есть motherBreed/fatherBreed) раскрываем родителей —
  // они известны по факту вязки. Глубже реконструировать нечестно — пусть туман.
  for (const cat of [...data.cats, ...(data.cryo ?? [])]) {
    if (cat.analyzed) revealPedigree(cat);
    else if (cat.pedigree && (cat.motherBreed || cat.fatherBreed)) {
      if (cat.pedigree.mother) cat.pedigree.mother.known = true;
      if (cat.pedigree.father) cat.pedigree.father.known = true;
    }
  }
  return data;
}
