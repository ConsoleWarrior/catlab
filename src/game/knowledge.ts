/**
 * Система знаний: Котодекс-рецептурник + пул исследования рецептов + раскрытие
 * превью пары. Чистые функции над GameState (тестируемо). Принцип (IDEAS.md):
 * знание — добываемый ресурс; 💎/📺 лишь ускоряют его добычу, но кота не выдают
 * и селекцию не отменяют. Даже зная рецепт и гены, породу надо реально вывести.
 *
 * Статусы породы в Котодексе:
 *   - «выведена» (discoveredBreeds) — полноцветный кот, видны ВСЕ её рецепты;
 *   - «рецепт известен» (knownRecipes, открыт исследованием) — чёрный силуэт,
 *     виден только открытый рецепт;
 *   - иначе — «???» (не изучена).
 */

import { RECIPES, recipeKey, recipesFor } from '../genetics/index.js';
import type { Recipe, SideSpec } from '../genetics/index.js';
import type { Cat, GameState } from './types.js';

/** Рецепт «открыт» в Котодексе: порода-результат выведена ИЛИ рецепт открыт исследованием. */
export function recipeIsKnown(state: GameState, r: Recipe): boolean {
  return state.discoveredBreeds.includes(r.result)
    || (state.knownRecipes ?? []).includes(recipeKey(r));
}

/** Порода выведена хотя бы раз (полноцветная клетка Котодекса). */
export function breedDiscovered(state: GameState, breed: string): boolean {
  return state.discoveredBreeds.includes(breed);
}

/** Порода «изучена» (видна в Котодексе): выведена ИЛИ известен хотя бы один её рецепт. */
export function breedStudied(state: GameState, breed: string): boolean {
  return breedDiscovered(state, breed) || recipesFor(breed).some((r) => recipeIsKnown(state, r));
}

/** Рецепты породы, которые игрок ВИДИТ в её карточке (выведена → все, иначе — открытые). */
export function knownRecipesFor(state: GameState, breed: string): Recipe[] {
  const all = recipesFor(breed);
  return breedDiscovered(state, breed) ? all : all.filter((r) => recipeIsKnown(state, r));
}

/** Сторона рецепта достижима: хотя бы одна порода из спецификации уже выведена. */
function sideReachable(state: GameState, s: SideSpec): boolean {
  return typeof s === 'string'
    ? breedDiscovered(state, s)
    : s.some((b) => breedDiscovered(state, b));
}

/**
 * Пул стола исследований: ещё НЕ открытые рецепты, у которых обе родительские
 * породы уже выведены (знание догоняет практику, а не обгоняет её). Дубликаты
 * исключаются самим пулом. Пуст → исследовать нечего (UI прячет кнопку).
 */
export function researchableRecipes(state: GameState): Recipe[] {
  return RECIPES.filter((r) => !recipeIsKnown(state, r)
    && sideReachable(state, r.a) && sideReachable(state, r.b));
}

/**
 * Исход раскрыт в превью пары (иначе — «❓ <тир> — X%»): рецепт открыт в
 * Котодексе И скрытые гены ОБОИХ родителей вскрыты анализом (дизайн 2026-07-11 —
 * условие общее, в том числе для прямых рецептов без родословных условий).
 */
export function outcomeRevealed(state: GameState, mother: Cat, father: Cat, r: Recipe): boolean {
  return recipeIsKnown(state, r) && mother.analyzed && father.analyzed;
}
