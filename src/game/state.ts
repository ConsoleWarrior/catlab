/**
 * Создание начального состояния и сериализация сейва (Этап 4). См. GAME.md.
 */

import { randomCat } from '../genetics/index.js';
import type { Rng } from '../genetics/index.js';
import type { GameState } from './types.js';
import { BASE_GENES, MAX_HEARTS, SAVE_VERSION, FOOD_CAP_BASE, levelForReputation } from './config.js';
import { emptySlot, makeCatInstance } from './economy.js';
import { attachHiddenPedigree, revealPedigree } from './pedigree.js';
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
    research: {},
    knownRecipes: [],
    recipeResearch: { startedAt: 0, readyAt: 0 },
    cryo: [],
    unlockedRooms: ['incubator', 'nursery', 'shelter', 'genolab'],
    orders: [],
    champions: [],
    food: FOOD_CAP_BASE, // кормушка стартует полной
    lastSeenAt: now,
    lastHealAdAt: 0,     // 📺-лечение в клинике сразу доступно (без стартового кулдауна)
    lastAnalyzeAdAt: 0,  // 📺-вариант Генетического анализа сразу доступен
    nextId: 1,
  };
  // стартовая пара для первой вязки — со скрытой родословной (лотерея генов)
  for (const sex of ['female', 'male'] as const) {
    const cat = makeCatInstance(state, randomCat(rng, sex), now, 'nursery');
    attachHiddenPedigree(state, cat, rng);
    state.cats.push(cat);
  }
  refillOrders(state, rng, now, 3);
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
  if (!data.boosts || typeof data.boosts !== 'object') data.boosts = {};
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
    data.recipeResearch = { startedAt: 0, readyAt: 0 };
  }
  if (typeof data.lastAnalyzeAdAt !== 'number') data.lastAnalyzeAdAt = 0;
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
