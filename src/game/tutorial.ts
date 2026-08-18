/**
 * Обучение новичка (FTUE) — ядро. Ведёт по всей базовой петле игры:
 * бесплатный генетический анализ → пара в слот вязки → прогноз пары → «Свести» →
 * первый котёнок → вырастить его (иначе не видно ни пола, ни облика) → освободить
 * слот, отправив в Питомник → отвести родителя в Приют → пристройство «в добрые
 * руки» → доска заказов (📋 в Питомнике) → кот на пьедестале выставки.
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
import { isInSlot, isChampion, isInBasket, isAdult } from './economy.js';
import {
  TUTORIAL_REWARD_COINS, TUTORIAL_REWARD_CRYSTALS,
  FREE_ANALYZE_COUNT, FREE_SKIP_COUNT, FREE_GROWTH_COUNT,
} from './config.js';

/**
 * Шаг обучения:
 * - `analyze`  — стартовый кот не изучен: тап по коту → «🧬 Генетический анализ» (подарок);
 * - `drag`     — слот пуст: тащим первого кота за шкирку из Питомника в слот;
 * - `menu`     — в слоте один кот: второго отправляем кнопкой из меню кота;
 * - `preview`  — пара собрана, но 🔮 прогноз пары ещё не смотрели;
 * - `breed`    — пара готова: жмём «Свести»;
 * - `skip`     — вязка идёт, в запасе есть подарочные ускорения: ускоряем бесплатно;
 * - `wait`     — вязка идёт, запас ускорений пуст: просто ждём котёнка;
 * - `grow`     — малыш в окошке вязки ещё котёнок: тап по нему → «Вырастить сейчас» (подарок);
 * - `kitten`   — в окошке вязки сидит выросший кот: слот занят, отправляем его в Питомник;
 * - `toShelter`— слот освобождён: уводим родителя (отца помёта) в Приют;
 * - `adopt`    — в Приюте есть кот: отдаём «в добрые руки» (станция 🤝);
 * - `orders`   — открываем доску 📋 Заказы (кнопка слева в Питомнике);
 * - `champion` — ставим взрослого кота на пьедестал выставки в Питомнике.
 */
export type TutorStep =
  | 'analyze' | 'drag' | 'menu' | 'preview' | 'breed' | 'skip' | 'wait'
  | 'grow' | 'kitten' | 'toShelter' | 'adopt' | 'orders' | 'champion';

/**
 * Активный шаг обучения или null, если обучение пройдено/пропущено. `now` нужен
 * только шагу `grow` (котёнок это ещё малыш или уже вырос) — по умолчанию берём
 * реальное время, тесты передают своё.
 */
export function tutorialStep(state: GameState, now = Date.now()): TutorStep | null {
  if (state.tutorial?.done !== false) return null;
  // Первый котёнок уже был — обучение перешло во вторую половину, что бы дальше ни
  // происходило со слотом. Флаг `bornOnce` ставит сам `collectReady`: по живым
  // котам судить нельзя — первенца как раз и учат отдать «в добрые руки», после
  // чего он из состояния исчезает. Родословная от вязки — запасной признак для
  // сейвов, сделанных до появления флага (по discoveredBreeds судить нельзя:
  // породы стартовых дворовых попадают в Котодекс при создании новой игры).
  if (state.tutorial.bornOnce || bornInLab(state)) return afterBirthStep(state, now);

  // Первое действие новичка — наука, а не вязка: подарочный анализ вскрывает
  // родословную и скрытые гены, от которых зависят будущие породы. Шага нет,
  // если анализировать некого (игрок уже изучил кота или увёл обоих в слот).
  if (!state.cats.some((c) => c.analyzed) && analyzeTarget(state)) return 'analyze';

  const slot = state.slots[0];
  if (!slot) return null;
  if (slot.readyAt > 0) return state.freeSkipLeft > 0 ? 'skip' : 'wait';

  const inSlot = (slot.motherId ? 1 : 0) + (slot.fatherId ? 1 : 0);
  if (inSlot === 0) return 'drag';
  if (inSlot === 1) return 'menu';
  if (!state.tutorial.previewSeen) return 'preview';
  return 'breed';
}

/**
 * Вторая половина обучения (после первого котёнка): вырастить малыша → освободить
 * слот → отвести родителя в Приют → пристройство → заказы → выставка. Пристройство
 * пропускается, если пристраивать некого, и обратно не возвращается, как только
 * игрок дошёл до заказов — иначе подсказка прыгала бы назад от любого кота,
 * забредшего в Приют.
 */
function afterBirthStep(state: GameState, now: number): TutorStep | null {
  const t = state.tutorial;
  if (!t.ordersSeen && !t.adoptDone) {
    // Сначала растим малыша: у котёнка не видно ни пола, ни облика (и растить его
    // можно где угодно — в окошке вязки или уже в комнате). Растить нечем — идём дальше.
    if (growTarget(state, now)) return 'grow';
    if (kittenInSlot(state)) return 'kitten';      // выросший занимает слот — уносим в Питомник
    if (adoptTarget(state)) return 'adopt';        // кто-то в Приюте — учим отдавать
    if (shelterTarget(state)) return 'toShelter';  // Приют пуст — уводим туда родителя
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

/** Малыш, оставленный в окошке вязки: пока он там, слот занят под новую пару. */
export function kittenInSlot(state: GameState): Cat | null {
  for (const slot of state.slots) {
    const kid = slot.kittenId ? state.cats.find((c) => c.id === slot.kittenId) : undefined;
    if (kid) return kid;
  }
  return null;
}

/**
 * Котёнок для подарочного ускорения роста (шаг «Вырастить сейчас»): сперва тот, что
 * сидит в окошке вязки, иначе любой малыш на полу комнат — из карточки рождения его
 * могли сразу унести в Питомник или Приют, и шаг должен догонять его там. Подарков в
 * запасе нет — цели нет и шага нет: посылать новичка платить 📺/💎 обучение не должно.
 */
export function growTarget(state: GameState, now: number): Cat | null {
  if (state.freeGrowthLeft <= 0) return null;
  const kid = kittenInSlot(state);
  if (kid && !isAdult(kid, now)) return kid;
  return state.cats.find((c) => !isAdult(c, now) && !isChampion(state, c.id)
    && (c.location === 'nursery' || c.location === 'shelter')) ?? null;
}

/**
 * Кот для шага «отправь в Приют» — отец помёта: `collectReady` оставляет родителей
 * стоять в окошке вязки, так что его и учим увести (тап по коту → «🏚️ В приют»).
 * Отца уже увели сами — сойдёт любой кот с пола Питомника.
 */
export function shelterTarget(state: GameState): Cat | null {
  for (const slot of state.slots) {
    const dad = slot.fatherId ? state.cats.find((c) => c.id === slot.fatherId) : undefined;
    if (dad && dad.location !== 'shelter') return dad;
  }
  return state.cats.find((c) => c.location === 'nursery'
    && !isInSlot(state, c.id) && !isChampion(state, c.id)) ?? null;
}

/** Обучение идёт прямо сейчас (для гейтов: подарки новичку, подсказки и т.п.). */
export function tutorialActive(state: GameState, now = Date.now()): boolean {
  return tutorialStep(state, now) !== null;
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
 * Подарок за ПРОЙДЕННОЕ обучение (TUTORIAL_REWARD_COINS 💰 + TUTORIAL_REWARD_CRYSTALS 💎):
 * стартовый капитал новичка перенесён сюда — на старте у игрока 💎 нет вовсе, а внутри
 * обучения они и не нужны (анализ и ускорение первой вязки подарочные). Выдаётся один
 * раз (флаг `rewardTaken`) и только за реальное прохождение всех шагов — крестик
 * «пропустить» подсказки просто выключает, подарка не даёт. Возвращает true, если
 * начислили (UI показывает тост).
 */
export function grantTutorialReward(state: GameState): boolean {
  if (state.tutorial.rewardTaken) return false;
  state.tutorial.rewardTaken = true;
  state.coins += TUTORIAL_REWARD_COINS;
  state.crystals += TUTORIAL_REWARD_CRYSTALS;
  return true;
}

/**
 * Прогнать обучение заново (дев-кнопка 🎓). Возвращает и подарки (включая запас
 * бесплатных анализов), и отметки просмотров: шаг всё равно вычисляется от состояния,
 * так что на уже отыгранной партии подсветка встанет туда, куда дотянулся прогресс.
 */
export function restartTutorial(state: GameState): void {
  state.tutorial = {
    done: false,
    bornOnce: false, previewSeen: false, ordersSeen: false, adoptDone: false,
    rewardTaken: false,
  };
  state.freeAnalyzeLeft = FREE_ANALYZE_COUNT;
  state.freeSkipLeft = FREE_SKIP_COUNT;
  state.freeGrowthLeft = FREE_GROWTH_COUNT;
}
