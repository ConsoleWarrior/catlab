/**
 * Конфиг баланса (Этап 4). Все числа — первый проход, тюнятся на плейтестах.
 * Менять баланс здесь, не в логике. См. GAME.md §5–6.
 */

import type { RarityTier } from '../genetics/index.js';
import type { Currency } from './types.js';

export const SAVE_VERSION = 1;

/** Ценность кота по тиру редкости: пристройство (💰), образец (🧬), пассив (💰/мин). */
export const TIER_VALUE: Record<RarityTier, { adopt: number; dna: number; incomePerMin: number }> = {
  common: { adopt: 20, dna: 1, incomePerMin: 1 },
  uncommon: { adopt: 60, dna: 3, incomePerMin: 3 },
  rare: { adopt: 200, dna: 8, incomePerMin: 10 },
  epic: { adopt: 800, dna: 20, incomePerMin: 25 },
  legendary: { adopt: 3000, dna: 60, incomePerMin: 60 },
};

// --- Инкубатор ---
export const INCUBATION_BASE_MS = 5 * 60_000;
export const INCUBATION_MIN_MS = 2 * 60_000;
export const SPEED_STEP_MS = 30_000;       // −30 c за уровень скорости
export const MUTATION_BASE = 0.01;
export const MUTATION_STEP = 0.01;
export const MUTATION_MAX = 0.1;

// --- Вместимости комнат ---
export const NURSERY_BASE_CAP = 6;
export const NURSERY_CAP_STEP = 2;
export const SHELTER_BASE_CAP = 8;
export const SHELTER_CAP_STEP = 3;

// --- Доход ---
export const OFFLINE_CAP_BASE_MIN = 120;   // потолок накопления, мин
export const OFFLINE_CAP_STEP_MIN = 60;
export const SHOW_BONUS_STEP = 0.25;       // +25% к пассиву за уровень «Выставки»
export const CONNECTIONS_STEP = 0.2;       // +20% к цене пристройства
export const BIOBANK_STEP = 0.25;          // +25% к выходу ДНК

// --- Генолаб ---
export const ANALYZE_DNA_COST = 10;

export interface UpgradeDef {
  label: string;
  currency: Currency;
  baseCost: number;
  mult: number;   // стоимость уровня = round(baseCost * mult^level)
  max: number;    // максимальный уровень
}

/** Дерево прокачки. Слоты вязки — особый случай (см. economy.upgradeCost). */
export const UPGRADES: Record<string, UpgradeDef> = {
  slots: { label: 'Слоты вязки', currency: 'coins', baseCost: 500, mult: 4, max: 5 },
  speed: { label: 'Скорость инкубации', currency: 'coins', baseCost: 150, mult: 1.8, max: 6 },
  mutation: { label: 'Мутагенез', currency: 'dna', baseCost: 40, mult: 1.7, max: 9 },
  litter: { label: 'Размер помёта', currency: 'coins', baseCost: 1000, mult: 3, max: 3 },
  nurseryCap: { label: 'Вместимость питомника', currency: 'coins', baseCost: 200, mult: 1.6, max: 10 },
  show: { label: 'Выставка (доход)', currency: 'coins', baseCost: 300, mult: 1.7, max: 8 },
  eliteFund: { label: 'Элитный фонд', currency: 'dna', baseCost: 60, mult: 1.8, max: 5 },
  shelterCap: { label: 'Вместимость приюта', currency: 'coins', baseCost: 120, mult: 1.5, max: 10 },
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
