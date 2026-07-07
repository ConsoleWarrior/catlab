/**
 * Конфиг баланса (Этап 4). Все числа — первый проход, тюнятся на плейтестах.
 * Менять баланс здесь, не в логике. См. GAME.md §5–6.
 */

import type { RarityTier, BreedBoosts } from '../genetics/index.js';
import type { Currency } from './types.js';

export const SAVE_VERSION = 4; // v4: счётчик вязок кота (breedCount) — мягкий дефолт 0 в deserialize, без сброса

/** Ценность кота по тиру редкости: пристройство (💰), образец (🧬), пассив (💰/мин). */
export const TIER_VALUE: Record<RarityTier, { adopt: number; dna: number; incomePerMin: number }> = {
  common: { adopt: 20, dna: 1, incomePerMin: 1 },
  uncommon: { adopt: 60, dna: 3, incomePerMin: 3 },
  rare: { adopt: 200, dna: 8, incomePerMin: 10 },
  epic: { adopt: 800, dna: 20, incomePerMin: 25 },
  legendary: { adopt: 3000, dna: 60, incomePerMin: 60 },
};

// --- Инкубатор ---
// Лимит вязок: каждый кот может участвовать в вязке не более MAX_BREEDS раз,
// после чего получает статус «Старый» и не может быть выбран в слот вязки.
export const MAX_BREEDS = 5;

// Бонус родословной: вся родословная кота (до прадедов) повышает шанс, что ЕГО
// потомство поднимется по тиру. Вклад каждого предка = его цвет (тир) × вес поколения.
// Чем ярче и глубже родословная — тем больше суммарный бонус.
// Цвет предка: зелёный (uncommon) +1%, синий (rare) +2%, фиолетовый (epic) +3%,
// золотой (legendary) +4%; серый (common) и базовый Дворовый — 0.
export const PEDIGREE_TIER_BONUS: Record<RarityTier, number> = {
  common: 0, uncommon: 0.01, rare: 0.02, epic: 0.03, legendary: 0.04,
};

// Вес поколения: родители ×1, деды ×0.5, прадеды ×0.25 — каждое поколение вглубь
// вдвое слабее (вклад = PEDIGREE_GEN_FALLOFF^(поколение−1)).
export const PEDIGREE_GEN_FALLOFF = 0.5;

// Глубина сохраняемой родословной кота: 3 = родители → деды → прадеды.
export const PEDIGREE_DEPTH = 3;

// ТЕСТ: время вязки 10 c для плейтестов. Вернуть после тестов: BASE = 5 * 60_000, MIN = 2 * 60_000.
export const INCUBATION_BASE_MS = 10_000;
export const INCUBATION_MIN_MS = 10_000;
export const SPEED_STEP_MS = 30_000;       // −30 c за уровень скорости
export const MUTATION_BASE = 0.01;
export const MUTATION_STEP = 0.01;
export const MUTATION_MAX = 0.1;

// --- Вместимости комнат ---
export const NURSERY_BASE_CAP = 6;
export const NURSERY_CAP_STEP = 2;
export const SHELTER_BASE_CAP = 8;
export const SHELTER_CAP_STEP = 2;

// --- Доход ---
export const OFFLINE_CAP_BASE_MIN = 120;   // потолок накопления, мин
export const OFFLINE_CAP_STEP_MIN = 60;
export const SHOW_BONUS_STEP = 0.25;       // +25% к пассиву за уровень «Выставки»
export const CONNECTIONS_STEP = 0.2;       // +20% к цене пристройства
export const BIOBANK_STEP = 0.25;          // +25% к выходу ДНК

// --- Покупка котов (анти-софт-лок) ---
export const STARTER_CAT_COST = 50; // простой кот из питомника; первый (когда котов нет) — бесплатно

// --- Генолаб ---
export const ANALYZE_DNA_COST = 10;

// --- Генная инженерия (усилители вязки) ---
// Кнопки усилителей живут у названия Инкубатора; активируются за 🧬 гены или 💎
// кристаллы. Заряд тратится при рождении из инкубатора (на первой подходящей вязке).
export type BoostId = keyof BreedBoosts;
export interface BoostDef {
  id: BoostId;
  glyph: string;
  label: string;
  desc: string;
  dna: number;      // цена активации за 🧬 гены
  crystals: number; // цена активации за 💎 кристаллы (премиум-альтернатива)
}
/** Усилители следующей вязки. Заряд тратится при рождении из инкубатора. */
export const BOOSTS: readonly BoostDef[] = [
  { id: 'noDown', glyph: '🛡', label: 'Стабилизатор', desc: 'Котёнок не опустится по тиру', dna: 15, crystals: 2 },
  { id: 'luckyUp', glyph: '🍀', label: 'Катализатор', desc: 'Резкий рост шанса тира-вверх', dna: 30, crystals: 3 },
  { id: 'tierUp', glyph: '🔼', label: 'Активатор', desc: 'Гарантия тира выше (если есть куда)', dna: 60, crystals: 5 },
];

// --- Рост котят ---
// ТЕСТ: котёнок взрослеет за 30 c, чтобы видеть взросление/эффект/таблички.
// Вернуть после тестов: 8 * 60_000 (~8 минут).
export const KITTEN_GROWTH_MS = 30_000;
export const KITTEN_MIN_SCALE = 0.45;       // размер новорождённого относительно взрослого
export const KITTEN_SLOW_FACTOR = 3;        // во сколько раз медленнее растёт котёнок, «оставленный с родителями»

// --- Дерево исследований (постоянные бонусы за 🧬) ---
// Эффекты применяются в чистых функциях economy.ts. 3 ветки × 3 уровня;
// узел открывается, если изучены все `requires` и хватает 🧬.
export type ResearchEffectKind =
  | 'income'           // +доля к пассивному доходу (множитель)
  | 'collectionIncome' // +плоский доход за каждую открытую породу
  | 'adoptCoins'       // +доля к 💰 за пристройство
  | 'adoptDna'         // +доля к 🧬 за пристройство
  | 'nurseryCap'       // +мест в питомнике
  | 'shelterCap'       // +мест в приюте
  | 'offline';         // +минут к потолку офлайн-дохода

export interface ResearchDef {
  id: string;
  glyph: string;
  title: string;
  desc: string;
  dna: number;
  requires: readonly string[];
  col: number; // уровень в ветке (0 — корень)
  row: number; // ветка (0 — доход, 1 — пристройство, 2 — инфраструктура)
  effect: { kind: ResearchEffectKind; value: number };
}

export const RESEARCH: readonly ResearchDef[] = [
  // ветка 0 — 💰 Доход
  { id: 'r_income1', glyph: '🧺', title: 'Лежанки', desc: '+25% пассивного дохода',
    dna: 30, requires: [], col: 0, row: 0, effect: { kind: 'income', value: 0.25 } },
  { id: 'r_income2', glyph: '🏆', title: 'Выставка', desc: '+35% пассивного дохода',
    dna: 70, requires: ['r_income1'], col: 1, row: 0, effect: { kind: 'income', value: 0.35 } },
  { id: 'r_income3', glyph: '📖', title: 'Коллекционер', desc: '+0.5 💰/мин за каждую открытую породу',
    dna: 140, requires: ['r_income2'], col: 2, row: 0, effect: { kind: 'collectionIncome', value: 0.5 } },

  // ветка 1 — 🤝 Пристройство
  { id: 'r_adopt1', glyph: '🤝', title: 'Добрые руки', desc: '+30% 💰 за пристройство',
    dna: 30, requires: [], col: 0, row: 1, effect: { kind: 'adoptCoins', value: 0.30 } },
  { id: 'r_adopt2', glyph: '🧬', title: 'Биобанк+', desc: '+40% 🧬 за пристройство',
    dna: 70, requires: ['r_adopt1'], col: 1, row: 1, effect: { kind: 'adoptDna', value: 0.40 } },
  { id: 'r_adopt3', glyph: '💞', title: 'Меценаты', desc: '+50% 💰 за пристройство',
    dna: 140, requires: ['r_adopt2'], col: 2, row: 1, effect: { kind: 'adoptCoins', value: 0.50 } },

  // ветка 2 — 🏠 Инфраструктура
  { id: 'r_infra1', glyph: '🏠', title: 'Пристройка', desc: '+4 места в питомнике',
    dna: 40, requires: [], col: 0, row: 2, effect: { kind: 'nurseryCap', value: 4 } },
  { id: 'r_infra2', glyph: '🏡', title: 'Приют+', desc: '+6 мест в приюте',
    dna: 60, requires: ['r_infra1'], col: 1, row: 2, effect: { kind: 'shelterCap', value: 6 } },
  { id: 'r_infra3', glyph: '⏳', title: 'Автокорм', desc: '+180 мин к потолку офлайна',
    dna: 120, requires: ['r_infra2'], col: 2, row: 2, effect: { kind: 'offline', value: 180 } },
];

export interface UpgradeDef {
  label: string;
  currency: Currency;
  baseCost: number;
  mult: number;   // стоимость уровня = round(baseCost * mult^level)
  max: number;    // максимальный уровень
}

/** Дерево прокачки. Слоты вязки — особый случай (см. economy.upgradeCost). */
export const UPGRADES: Record<string, UpgradeDef> = {
  slots: { label: 'Слоты вязки', currency: 'coins', baseCost: 500, mult: 4, max: 2 },
  speed: { label: 'Скорость инкубации', currency: 'coins', baseCost: 150, mult: 1.8, max: 6 },
  mutation: { label: 'Мутагенез', currency: 'dna', baseCost: 40, mult: 1.7, max: 9 },
  litter: { label: 'Размер помёта', currency: 'coins', baseCost: 1000, mult: 3, max: 3 },
  nurseryCap: { label: 'Слоты питомника', currency: 'coins', baseCost: 200, mult: 1.6, max: 3 },
  show: { label: 'Выставка (доход)', currency: 'coins', baseCost: 300, mult: 1.7, max: 8 },
  eliteFund: { label: 'Элитный фонд', currency: 'dna', baseCost: 60, mult: 1.8, max: 5 },
  shelterCap: { label: 'Слоты приюта', currency: 'coins', baseCost: 120, mult: 1.5, max: 3 },
  connections: { label: 'Связи (цена пристройства)', currency: 'coins', baseCost: 250, mult: 1.6, max: 8 },
  biobank: { label: 'Биобанк (выход ДНК)', currency: 'dna', baseCost: 50, mult: 1.7, max: 6 },
  selection: { label: 'Селекция (+редкость)', currency: 'dna', baseCost: 80, mult: 1.9, max: 5 },
  offline: { label: 'Офлайн-доход', currency: 'coins', baseCost: 400, mult: 1.8, max: 6 },
};

export interface GeneDef {
  label: string;
  dna: number;
}

/** Гены, открываемые в Генолабе за ДНК. */
export const GENES: Record<string, GeneDef> = {
  pointed: { label: 'Колор-пойнт', dna: 80 },
  dilute: { label: 'Разбавление (dilute)', dna: 50 },
  longhair: { label: 'Длинная шерсть', dna: 60 },
  fold: { label: 'Вислоухость (фолд)', dna: 150 },
  curl: { label: 'Кёрл', dna: 120 },
  white: { label: 'Доминантный белый', dna: 300 },
};

/** Фичи, открытые с самого старта (базовые цвета, табби, белые пятна). */
export const BASE_GENES = ['base-colors', 'tabby', 'spotting'];

/** Уровень лаборатории по репутации (каждые 100 — +1). */
export function levelForReputation(rep: number): number {
  return 1 + Math.floor(Math.max(0, rep) / 100);
}
