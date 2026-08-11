/**
 * Обучение новичка (FTUE) — ядро. Ведёт по всей базовой петле игры:
 * бесплатный генетический анализ → пара в слот вязки → прогноз пары → «Свести» →
 * первый котёнок → пристройство «в добрые руки» → доска заказов → кот на
 * пьедестале выставки.
 *
 * Активный шаг — ЧИСТАЯ ФУНКЦИЯ ОТ СОСТОЯНИЯ, а не счётчик в сейве: игрок,
 * который сделал действие раньше подсказки (или сделал его другим способом),
 * автоматически проскакивает шаг, а вернувшись после перерыва — попадает
 * ровно туда, где остановился. Тексты и подсветка живут в UI (src/ui/tutorial.ts).
 *
 * Исключение — «просмотровые» шаги (🔮 прогноз пары, 📋 доска заказов) и
 * пристройство: открытие панели состояние не меняет, а пристроенный кот из него
 * исчезает. Такие шаги отмечены флагами в `state.tutorial` (previewSeen /
 * ordersSeen / adoptDone) — их ставят `markTutorialSeen` и `adoptCat`.
 */

import type { Cat, GameState } from './types.js';
import { isInSlot, isChampion, isInBasket } from './economy.js';

/**
 * Шаг обучения:
 * - `analyze`  — стартовый кот не изучен: тап по коту → «🧬 Генетический анализ» (подарок);
 * - `drag`     — слот пуст: тащим первого кота за шкирку из Питомника в слот;
 * - `menu`     — в слоте один кот: второго отправляем кнопкой из меню кота;
 * - `preview`  — пара собрана, но 🔮 прогноз пары ещё не смотрели;
 * - `breed`    — пара готова: жмём «Свести»;
 * - `skip`     — вязка идёт, подарочный ускоритель ещё цел: ускоряем бесплатно;
 * - `wait`     — вязка идёт, ускоритель потрачен: просто ждём котёнка;
 * - `kitten`   — малыш сидит в окошке вязки: отправляем его в Приют;
 * - `adopt`    — в Приюте есть кот: отдаём «в добрые руки» (станция 🤝);
 * - `orders`   — открываем доску 📋 Заказы;
 * - `champion` — ставим взрослого кота на пьедестал выставки в Питомнике.
 */
export type TutorStep =
  | 'analyze' | 'drag' | 'menu' | 'preview' | 'breed' | 'skip' | 'wait'
  | 'kitten' | 'adopt' | 'orders' | 'champion';

/** Активный шаг обучения или null, если обучение пройдено/пропущено. */
export function tutorialStep(state: GameState): TutorStep | null {
  if (state.tutorial?.done !== false) return null;
  // Первый котёнок уже был — обучение перешло во вторую половину, что бы дальше ни
  // происходило со слотом. Флаг `bornOnce` ставит сам `collectReady`: по живым
  // котам судить нельзя — первенца как раз и учат отдать «в добрые руки», после
  // чего он из состояния исчезает. Родословная от вязки — запасной признак для
  // сейвов, сделанных до появления флага (по discoveredBreeds судить нельзя:
  // породы стартовых дворовых попадают в Котодекс при создании новой игры).
  if (state.tutorial.bornOnce || bornInLab(state)) return afterBirthStep(state);

  // Первое действие новичка — наука, а не вязка: подарочный анализ вскрывает
  // родословную и скрытые гены, от которых зависят будущие породы. Шага нет,
  // если анализировать некого (игрок уже изучил кота или увёл обоих в слот).
  if (!state.cats.some((c) => c.analyzed) && analyzeTarget(state)) return 'analyze';

  const slot = state.slots[0];
  if (!slot) return null;
  if (slot.readyAt > 0) return state.tutorial.freeSkipUsed ? 'wait' : 'skip';

  const inSlot = (slot.motherId ? 1 : 0) + (slot.fatherId ? 1 : 0);
  if (inSlot === 0) return 'drag';
  if (inSlot === 1) return 'menu';
  if (!state.tutorial.previewSeen) return 'preview';
  return 'breed';
}

/**
 * Вторая половина обучения (после первого котёнка): пристройство → заказы →
 * выставка. Пристройство пропускается, если пристраивать некого (малыша унесли в
 * Питомник) и обратно не возвращается, как только игрок дошёл до заказов —
 * иначе подсказка прыгала бы назад от любого кота, забредшего в Приют.
 */
function afterBirthStep(state: GameState): TutorStep | null {
  const t = state.tutorial;
  if (!t.ordersSeen && !t.adoptDone) {
    if (adoptTarget(state)) return 'adopt';
    if (state.slots.some((s) => s.kittenId)) return 'kitten';
  }
  if (!t.ordersSeen) return 'orders';
  if (!state.champions?.some(Boolean)) return 'champion';
  return null; // всё пройдено — показ закрывает обучение (finishTutorial)
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

/**
 * Кот для подарочного Генетического анализа: гуляет по Питомнику (значит, по нему
 * можно тапнуть) и ещё не изучен. Тот же кот подсвечивается в UI.
 */
export function analyzeTarget(state: GameState): Cat | null {
  return state.cats.find((c) => c.location === 'nursery' && !c.analyzed
    && !isInSlot(state, c.id) && !isChampion(state, c.id)) ?? null;
}

/** Кот в Приюте, которого показываем на шаге «в добрые руки» (не в слоте и не в корзине). */
export function adoptTarget(state: GameState): Cat | null {
  return state.cats.find((c) => c.location === 'shelter'
    && !isInSlot(state, c.id) && !isInBasket(state, c.id)) ?? null;
}

/** Обучение идёт прямо сейчас (для гейтов: подарки новичку, подсказки и т.п.). */
export function tutorialActive(state: GameState): boolean {
  return tutorialStep(state) !== null;
}

/**
 * Отметить «просмотровый» шаг обучения: открытие 🔮 прогноза пары и 📋 доски
 * заказов ничего в игре не меняет, вычислить их из состояния нельзя. Вне
 * обучения — пустышка, лишний раз сейв не пачкаем.
 */
export function markTutorialSeen(state: GameState, what: 'preview' | 'orders'): boolean {
  if (state.tutorial?.done !== false) return false;
  const key = what === 'preview' ? 'previewSeen' : 'ordersSeen';
  if (state.tutorial[key]) return false;
  state.tutorial[key] = true;
  return true;
}

/** Пометить обучение пройденным (финальный шаг или кнопка «пропустить»). */
export function finishTutorial(state: GameState): void {
  state.tutorial.done = true;
}

/**
 * Прогнать обучение заново (дев-кнопка 🎓). Возвращает и подарки, и отметки
 * просмотров: шаг всё равно вычисляется от состояния, так что на уже отыгранной
 * партии подсветка встанет туда, куда дотянулся прогресс.
 */
export function restartTutorial(state: GameState): void {
  state.tutorial = {
    done: false, freeSkipUsed: false, freeAnalyzeUsed: false,
    bornOnce: false, previewSeen: false, ordersSeen: false, adoptDone: false,
  };
}
