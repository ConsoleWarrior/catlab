/**
 * Просьба оценить игру — свой лимит поверх feedback API Яндекса (GAME.md §17.6).
 *
 * Платформа гарантирует немногое: окно оценки можно вызвать один раз ЗА СЕССИЮ,
 * гостю нельзя вовсе (NO_AUTH), уже оценившему — тоже (GAME_RATED). Но игрок,
 * который просто закрыл окно крестиком, в следующий заход увидит его снова, и
 * так каждый раз. Поэтому счётчик попыток живёт в сейве: не больше
 * REVIEW_ASK_MAX окон за всё время и не чаще REVIEW_ASK_COOLDOWN_MS.
 *
 * Здесь только «наш» лимит — правила площадки (авторизован ли, оценивал ли)
 * проверяет сама платформа перед показом (см. platform/ysdk.requestReview).
 */

import { REVIEW_ASK_MAX, REVIEW_ASK_COOLDOWN_MS } from './config.js';
import type { GameState } from './types.js';

/** Можно ли САМИМ предложить оценку (лимит попыток + пауза между ними). */
export function canAskReview(state: GameState, now: number): boolean {
  if ((state.reviewAsks ?? 0) >= REVIEW_ASK_MAX) return false;
  const last = state.reviewLastAskAt ?? 0;
  return last <= 0 || now - last >= REVIEW_ASK_COOLDOWN_MS;
}

/**
 * Отметить показ окна оценки. Считаем именно попытку, а не результат: игрок мог
 * закрыть окно крестиком, и повторять просьбу сразу же — то самое, от чего
 * защищает лимит. Кнопку «⭐ Оценить игру» в ⚙️ Настройках сюда не заводим —
 * это осознанное действие игрока, оно попыток не тратит.
 */
export function noteReviewAsked(state: GameState, now: number): void {
  state.reviewAsks = (state.reviewAsks ?? 0) + 1;
  state.reviewLastAskAt = now;
}
