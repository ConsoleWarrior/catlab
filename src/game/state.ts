/**
 * Создание начального состояния и сериализация сейва (Этап 4). См. GAME.md.
 */

import { randomCat } from '../genetics/index.js';
import type { Rng } from '../genetics/index.js';
import type { GameState } from './types.js';
import { BASE_GENES, SAVE_VERSION } from './config.js';
import { emptySlot, makeCatInstance } from './economy.js';
import { refillOrders } from './orders.js';

/** Новое состояние новой игры: стартовая пара котов, 1 слот, базовые гены, заказы. */
export function createInitialState(rng: Rng, now: number): GameState {
  const state: GameState = {
    version: SAVE_VERSION,
    coins: 100,
    crystals: 5,
    dna: 0,
    level: 1,
    reputation: 0,
    cats: [],
    slots: [emptySlot()],
    upgrades: {},
    unlockedGenes: [...BASE_GENES],
    discoveredBreeds: [],
    boosts: {},
    research: [],
    unlockedRooms: ['incubator', 'nursery', 'shelter', 'genolab'],
    orders: [],
    lastSeenAt: now,
    nextId: 1,
  };
  // стартовая пара для первой вязки
  state.cats.push(makeCatInstance(state, randomCat(rng, 'female'), now, 'nursery'));
  state.cats.push(makeCatInstance(state, randomCat(rng, 'male'), now, 'nursery'));
  refillOrders(state, rng, now, 3);
  return state;
}

export function serialize(state: GameState): string {
  return JSON.stringify(state);
}

/** Восстанавливает состояние из сейва (заглушка миграций по version). */
export function deserialize(json: string): GameState {
  const data = JSON.parse(json) as GameState;
  // мягкие дефолты для полей, добавленных в новых версиях
  if (!Array.isArray(data.discoveredBreeds)) data.discoveredBreeds = [];
  if (!data.boosts || typeof data.boosts !== 'object') data.boosts = {};
  if (!Array.isArray(data.research)) data.research = [];
  return data;
}
