/**
 * Обучение новичка (FTUE) — ядро. Ведёт ровно до первого котёнка: поставить
 * пару в слот (первого кота — перетаскиванием за шкирку, второго — кнопкой из
 * меню кота), свести, ускорить подарочным ускорителем, заглянуть в Котодекс.
 *
 * Активный шаг — ЧИСТАЯ ФУНКЦИЯ ОТ СОСТОЯНИЯ, а не счётчик в сейве: игрок,
 * который сделал действие раньше подсказки (или сделал его другим способом),
 * автоматически проскакивает шаг, а вернувшись после перерыва — попадает
 * ровно туда, где остановился. Тексты и подсветка живут в UI (src/ui/tutorial.ts).
 */

import type { GameState } from './types.js';

/**
 * Шаг обучения:
 * - `drag`  — слот пуст: тащим первого кота за шкирку из Питомника в слот;
 * - `menu`  — в слоте один кот: второго отправляем кнопкой из меню кота;
 * - `breed` — пара собрана: жмём «Свести»;
 * - `skip`  — вязка идёт, подарочный ускоритель ещё цел: ускоряем бесплатно;
 * - `wait`  — вязка идёт, ускоритель потрачен: просто ждём котёнка;
 * - `codex` — котёнок родился: показываем Котодекс, на этом обучение кончается.
 */
export type TutorStep = 'drag' | 'menu' | 'breed' | 'skip' | 'wait' | 'codex';

/** Активный шаг обучения или null, если обучение пройдено/пропущено. */
export function tutorialStep(state: GameState): TutorStep | null {
  if (state.tutorial?.done !== false) return null;
  // Кто-то уже родился в инкубаторе — обучение на финишной прямой, что бы дальше
  // ни происходило со слотом (малыша могли сразу унести в комнату). Признак —
  // родословная от вязки; по discoveredBreeds судить нельзя: породы стартовых
  // дворовых попадают в Котодекс при создании новой игры.
  if (bornInLab(state)) return 'codex';

  const slot = state.slots[0];
  if (!slot) return null;
  if (slot.readyAt > 0) return state.tutorial.freeSkipUsed ? 'wait' : 'skip';

  const inSlot = (slot.motherId ? 1 : 0) + (slot.fatherId ? 1 : 0);
  if (inSlot === 0) return 'drag';
  if (inSlot === 1) return 'menu';
  return 'breed';
}

/**
 * В лаборатории уже кто-то родился: у кота есть порода матери/отца — так
 * помечает потомство только `collectReady`. Смотрим и в крио-банк: теоретически
 * первенца могли успеть заморозить.
 */
function bornInLab(state: GameState): boolean {
  return [...state.cats, ...(state.cryo ?? [])]
    .some((c) => !!(c.motherBreed || c.fatherBreed));
}

/** Обучение идёт прямо сейчас (для гейтов: межстраничная реклама и т.п.). */
export function tutorialActive(state: GameState): boolean {
  return tutorialStep(state) !== null;
}

/** Пометить обучение пройденным (финальный шаг или кнопка «пропустить»). */
export function finishTutorial(state: GameState): void {
  state.tutorial.done = true;
}

/**
 * Прогнать обучение заново (дев-кнопка 🎓). Возвращает и подарочный ускоритель:
 * шаг всё равно вычисляется от состояния, так что на уже отыгранной партии
 * подсветка встанет туда, куда дотянулся прогресс (скорее всего сразу «codex»).
 */
export function restartTutorial(state: GameState): void {
  state.tutorial.done = false;
  state.tutorial.freeSkipUsed = false;
}
