/**
 * Обучение новичка (FTUE) — ядро. Ведёт по всей базовой петле игры:
 * бесплатный генетический анализ → пара в слот вязки → прогноз пары → «Свести» →
 * первый котёнок (вязка идёт секунды) → вырастить его (иначе не видно ни пола, ни облика) → освободить
 * слот, отправив в Питомник → отвести родителя в Приют → пристройство «в добрые
 * руки» → доска заказов (📋 в Питомнике) → 🔬 Генолаб (Котодекс) → кот на пьедестале выставки.
 *
 * Обучение ОБЯЗАТЕЛЬНОЕ и НЕПРОПУСКАЕМОЕ, и с 08.09.2026 — ещё и ГЕРМЕТИЧНОЕ.
 * Затемнения с «окном» вокруг цели (ui/tutorial.ts) для этого мало: окно —
 * прямоугольник (в него попадает и соседняя кнопка), а стоит взять кота за
 * шкирку, как заслонка гаснет совсем — и кота можно было унести в корзину
 * заказов и продать, оборвав сценарий на середине. Поэтому решает не заслонка,
 * а ЗАМОК — `tutorialLock`: он говорит, с каким котом можно работать, тапом
 * или жестом, куда этого кота разрешено опустить, в какую комнату разрешено
 * уйти и какие кнопки живые. Заслонка осталась подсказкой для глаз, запрет
 * держит замок, и проверяют его все точки входа игрока:
 *  - `startGrab` / `openCatMenu` (game.ts) — взять за шкирку и тапнуть;
 *  - `tryDropCat` каждой комнаты — зоны дропа (слот, 🤝, пьедестал, 🧺, 🧬, 🧊);
 *  - `navRoom` и `carryEdgeScroll` — переходы между комнатами;
 *  - `ctx.tutorAllows(id)` — кнопки внутри комнат и панелей.
 * Ошибиться негде, сломать сценарий нечем, а награда за прохождение достаётся
 * каждому — кнопки «пропустить» нет вовсе. Одно исключение: ⚙️ Настройки
 * открыты всегда (звук игрок обязан иметь возможность выключить).
 *
 * Активный шаг — ЧИСТАЯ ФУНКЦИЯ ОТ СОСТОЯНИЯ, а не счётчик в сейве: игрок,
 * который сделал действие другим способом, автоматически проскакивает шаг, а
 * вышедший из игры посреди обучения возвращается ровно на тот шаг, где встал.
 * Тексты и подсветка живут в UI (src/ui/tutorial.ts).
 *
 * Исключение — «просмотровые» шаги (🔮 прогноз пары, 📋 доска заказов,
 * 🔬 Генолаб) и пристройство: открытие панели состояние не меняет, а
 * пристроенный кот из него исчезает. Такие шаги отмечены флагами в
 * `state.tutorial` (previewSeen / ordersSeen / genolabTabs / adoptDone) — их
 * ставят `markTutorialSeen`, `markTutorialTab` и `adoptCat`.
 * Пристройство засчитывается уже по ОТКРЫТИЮ диалога «в добрые руки» (кота
 * донесли до станции 🤝): механику игрок увидел, а расставаться с котом ради
 * подсказки его никто не заставляет — «Отмена» шаг не отматывает назад.
 */

import type { Cat, GameState } from './types.js';
import { isInSlot, isChampion, isInBasket, isAdult, isOld } from './economy.js';
import {
  TUTORIAL_REWARD_COINS, TUTORIAL_REWARD_CRYSTALS,
  FREE_ANALYZE_COUNT, FREE_GROWTH_COUNT,
} from './config.js';

/**
 * Шаг обучения:
 * - `analyze`  — есть НЕИЗУЧЕННЫЙ кот: тап по коту → «🧬 Генетический анализ» (подарок).
 *                Шаг повторяется, пока не изучены оба стартовых: прогноз пары и
 *                родословная котёнка врут, если хоть один родитель в тумане;
 * - `drag`     — слот пуст: тащим первого кота за шкирку из Питомника в слот;
 * - `menu`     — в слоте один кот: второго отправляем кнопкой из меню кота;
 * - `preview`  — пара собрана, но 🔮 прогноз пары ещё не смотрели;
 * - `breed`    — пара готова: жмём «Свести»;
 * - `wait`     — вязка идёт: ждём котёнка (секунды, ускорять нечем);
 * - `grow`     — малыш в окошке вязки ещё котёнок: тап по нему → «Вырастить сейчас» (подарок);
 * - `kitten`   — в окошке вязки сидит выросший кот: слот занят, отправляем его в Питомник;
 * - `toShelter`— слот освобождён: уводим родителя (отца помёта) в Приют;
 * - `adopt`    — в Приюте есть кот: доносим его до станции 🤝 «в добрые руки»
 *                (шаг закрывается открытием диалога, соглашаться необязательно);
 * - `orders`   — открываем доску 📋 Заказы (кнопка слева в Питомнике);
 * - `genolab`  — обходим 🔬 Генолаб по всем трём вкладкам: 📖 Котодекс → 🔬 Улучшения → 🧪 Исследования;
 * - `champion` — ставим взрослого кота на пьедестал выставки в Питомнике.
 */
export type TutorStep =
  | 'analyze' | 'drag' | 'menu' | 'preview' | 'breed' | 'wait'
  | 'grow' | 'kitten' | 'toShelter' | 'adopt' | 'orders' | 'genolab' | 'champion';

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
  // родословную и скрытые гены, от которых зависят будущие породы. Изучаем ОБОИХ
  // стартовых котов (шаг повторяется, пока есть неизученные): по одному родителю
  // ни прогноз пары не посчитать, ни родословную котёнка не прочитать — половина
  // дерева осталась бы в тумане. Подарочные анализы кончились — шага нет: платить
  // за обучение новичка не заставляем.
  if (state.freeAnalyzeLeft > 0 && analyzeTarget(state)) return 'analyze';

  const slot = state.slots[0];
  if (!slot) return null;
  if (slot.readyAt > 0) return 'wait';

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
  // Генолаб — единственная комната, мимо которой петля обучения проходила
  // стороной: игрок доходил до конца, ни разу не узнав, где лежат Котодекс,
  // Улучшения и стол рецептов. Поэтому шаг ведёт по ВСЕМ ТРЁМ вкладкам по
  // очереди (genolabTabs, см. markTutorialTab): открытие вкладки состояние не
  // меняет, вычислить такой шаг из игры нельзя — только флагом.
  if (!t.genolabSeen) return 'genolab';
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

/**
 * Кот, которого шаги `drag`/`menu` ведут в окошко вязки: взрослый, не старый,
 * гуляет по Питомнику. Если один из пары уже в слоте — берём кота
 * ПРОТИВОПОЛОЖНОГО пола: вязка бывает только ♀+♂, и подсветить второго
 * однополого значило бы завести игрока в тупик.
 */
export function breederTarget(state: GameState, now = Date.now()): Cat | null {
  const slot = state.slots[0];
  const need = slot?.motherId ? 'male' : slot?.fatherId ? 'female' : null;
  return state.cats.find((c) => c.location === 'nursery' && !isInSlot(state, c.id)
    && isAdult(c, now) && !isOld(c) && (!need || c.genotype.sex === need)) ?? null;
}

/**
 * Кот для пьедестала: взрослый (котёнка выставка не примет), гуляет по Питомнику
 * и ещё не чемпион. Пусто — значит все взрослые заперты в окошке вязки, и шаг
 * сперва ведёт забрать оттуда любого (см. slotCats).
 */
export function championTarget(state: GameState, now = Date.now()): Cat | null {
  return state.cats.find((c) => c.location === 'nursery' && isAdult(c, now)
    && !isInSlot(state, c.id) && !isChampion(state, c.id)) ?? null;
}

/** Id котов, стоящих сейчас в окошках вязки (родители и оставленный малыш). */
function slotCats(state: GameState): string[] {
  const ids: string[] = [];
  for (const slot of state.slots) {
    for (const id of [slot.motherId, slot.fatherId, slot.kittenId]) {
      if (id && state.cats.some((c) => c.id === id)) ids.push(id);
    }
  }
  return ids;
}

/**
 * Вкладки Генолаба в том порядке, в каком их обходит обучение: комната — это три
 * разных экрана, и одного Котодекса мало, чтобы понять, зачем сюда возвращаться
 * (📖 что из кого выводится, 🔬 куда девать 🧬 ДНК, 🧪 где добывать рецепты).
 */
export const TUTOR_GENOLAB_TABS = ['codex', 'research', 'recipes'] as const;
export type TutorGenolabTab = typeof TUTOR_GENOLAB_TABS[number];

/** Какую вкладку Генолаба обучение ждёт следующей (null — все три открыты). */
export function nextGenolabTab(state: GameState): TutorGenolabTab | null {
  const seen = state.tutorial?.genolabTabs ?? [];
  return TUTOR_GENOLAB_TABS.find((tab) => !seen.includes(tab)) ?? null;
}

/**
 * Засчитать открытую вкладку Генолаба. Порядок жёсткий: вкладка идёт в зачёт,
 * только когда до неё дошла очередь (остальные UI и так не пускает — см.
 * `tutorialAllows`). Собраны все три — шаг закрывается флагом `genolabSeen`.
 */
export function markTutorialTab(state: GameState, tab: TutorGenolabTab): boolean {
  if (state.tutorial?.done !== false) return false;
  if (tab !== nextGenolabTab(state)) return false;
  (state.tutorial.genolabTabs ??= []).push(tab);
  if (!nextGenolabTab(state)) state.tutorial.genolabSeen = true;
  return true;
}

/**
 * ЗАМОК обучения — что игроку разрешено прямо сейчас. Это единственный источник
 * правды о запретах: подсветка (ui/tutorial.ts) только показывает цель, а
 * держат сценарий проверки замка на всех входах игрока (см. шапку файла).
 * Правило на каждом шаге одно: РОВНО ОДНО действие.
 */
export interface TutorLock {
  step: TutorStep;
  /** Коты, с которыми разрешено взаимодействие (пусто — ни с кем). */
  cats: readonly string[];
  /** Разрешён тап по такому коту (откроется меню кота). */
  tap: boolean;
  /** Разрешено взять такого кота за шкирку. */
  grab: boolean;
  /**
   * Разрешённые действия — кнопки интерфейса и зоны дропа одним списком:
   * 'slot' | 'adopt' | 'pedestal' (зоны), 'preview' | 'breed' | 'orders' |
   * 'toNursery' | 'codex' | 'research' | 'recipes' (кнопки). Всё, чего в списке
   * нет, на этом шаге мертво — включая 🧺 корзину, 🧬 биобанк и 🧊 криокапсулу.
   */
  allow: readonly string[];
  /** Комнаты, куда разрешено уйти (та, где игрок стоит, разрешена всегда). */
  rooms: readonly string[];
}

/** Замок текущего шага или null — обучение пройдено, всё работает как обычно. */
export function tutorialLock(state: GameState, now = Date.now()): TutorLock | null {
  const step = tutorialStep(state, now);
  if (!step) return null;
  const lock = (extra: Partial<TutorLock>): TutorLock => ({
    step, cats: [], tap: false, grab: false, allow: [], rooms: [], ...extra,
  });
  const one = (cat: Cat | null): string[] => (cat ? [cat.id] : []);
  switch (step) {
    // ТАПОМ и только тапом: кота на этих шагах не двигают вовсе — «взял за
    // шкирку» уводит его из-под подсказки (в корзину, в чужую комнату, на пьедестал).
    case 'analyze':
      return lock({ cats: one(analyzeTarget(state)), tap: true, rooms: ['nursery'] });
    case 'menu':
      return lock({ cats: one(breederTarget(state, now)), tap: true, rooms: ['nursery'] });
    case 'grow': {
      const kid = growTarget(state, now);
      const room = kid && !isInSlot(state, kid.id) ? kid.location : 'incubator';
      return lock({ cats: one(kid), tap: true, rooms: [room] });
    }
    case 'kitten':
      return lock({ cats: one(kittenInSlot(state)), tap: true, allow: ['toNursery'], rooms: ['incubator'] });
    case 'toShelter': {
      const cat = shelterTarget(state);
      const room = cat && isInSlot(state, cat.id) ? 'incubator' : 'nursery';
      return lock({ cats: one(cat), tap: true, rooms: [room] });
    }
    // ЖЕСТОМ и только жестом: одна разрешённая зона дропа, одна комната-цель.
    case 'drag':
      return lock({
        cats: one(breederTarget(state, now)), grab: true,
        allow: ['slot'], rooms: ['nursery', 'incubator'],
      });
    case 'adopt':
      return lock({ cats: one(adoptTarget(state)), grab: true, allow: ['adopt'], rooms: ['shelter'] });
    // КНОПКОЙ: 🔮 прогноз и «Свести» стоят вплотную одна под другой — живёт ровно
    // одна из них, промахнуться мимо и свести вслепую больше нельзя.
    case 'preview':
      return lock({ allow: ['preview'], rooms: ['incubator'] });
    case 'breed':
      return lock({ allow: ['breed'], rooms: ['incubator'] });
    case 'wait':
      return lock({ rooms: ['incubator'] });
    case 'orders':
      return lock({ allow: ['orders'], rooms: ['nursery'] });
    case 'genolab': {
      const tab = nextGenolabTab(state);
      return lock({ allow: tab ? [tab] : [], rooms: ['genolab'] });
    }
    case 'champion':
    default: {
      const cat = championTarget(state, now);
      // Все взрослые ещё стоят в окошке вязки — сперва забираем оттуда любого
      // кнопкой «🏠 В питомник», и только потом несём на пьедестал.
      if (!cat) return lock({ cats: slotCats(state), tap: true, allow: ['toNursery'], rooms: ['incubator'] });
      return lock({ cats: [cat.id], grab: true, allow: ['pedestal'], rooms: ['nursery'] });
    }
  }
}

/**
 * Разрешено ли обучением действие `id` — кнопка интерфейса или зона дропа
 * (см. TutorLock.allow). Вне обучения разрешено всё.
 */
export function tutorialAllows(state: GameState, id: string, now = Date.now()): boolean {
  const lock = tutorialLock(state, now);
  return !lock || lock.allow.includes(id);
}

/** Разрешено ли обучением трогать кота: `tap` — тапнуть, `grab` — взять за шкирку. */
export function tutorialAllowsCat(
  state: GameState, catId: string, what: 'tap' | 'grab', now = Date.now(),
): boolean {
  const lock = tutorialLock(state, now);
  if (!lock) return true;
  return lock.cats.includes(catId) && (what === 'tap' ? lock.tap : lock.grab);
}

/** Разрешён ли обучением переход в комнату `roomId` (вне обучения — куда угодно). */
export function tutorialAllowsRoom(state: GameState, roomId: string, now = Date.now()): boolean {
  const lock = tutorialLock(state, now);
  return !lock || lock.rooms.includes(roomId);
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
export function markTutorialSeen(
  state: GameState, what: 'preview' | 'orders' | 'adopt',
): boolean {
  if (state.tutorial?.done !== false) return false;
  const key = what === 'preview' ? 'previewSeen'
    : what === 'orders' ? 'ordersSeen' : 'adoptDone';
  if (state.tutorial[key]) return false;
  state.tutorial[key] = true;
  return true;
}

/**
 * Что разрешено в меню кота, пока идёт обучение. Меню — самое соблазнительное
 * место свернуть со сценария (отдать не того кота, увести родителя не в ту
 * комнату), поэтому на каждом шаге в нём остаётся РОВНО ОДНА кнопка — та, о
 * которой говорит подсказка, плюс «Закрыть».
 *
 * `null` — обучение не идёт, меню работает как обычно.
 * `open: false` — меню не открывается вовсе: либо шаг требует ЖЕСТА (донести
 * кота за шкирку), либо это ЧУЖОЙ кот — не тот, на который показывает подсказка.
 * Вместо меню UI показывает тост с той же подсказкой.
 *
 * Ключи кнопок совпадают с id в `buildCatMenu` / `buildKittenCard`
 * (`analyze`, `slot`, `grow`, `nursery`, `shelter`).
 */
export function tutorialMenuGate(
  state: GameState, cat: Cat, now = Date.now(),
): { open: boolean; actions: readonly string[] } | null {
  const lock = tutorialLock(state, now);
  if (!lock) return null;
  const shut = { open: false, actions: [] as readonly string[] };
  // Не тот кот или шаг вообще не про тап — меню закрыто. Именно эта проверка не
  // даёт «выбрать другого котика» на любом шаге, где меню в принципе открывается.
  if (!lock.tap || !lock.cats.includes(cat.id)) return shut;
  const menu = (...actions: string[]): { open: boolean; actions: readonly string[] } => ({ open: true, actions });
  switch (lock.step) {
    case 'analyze': return menu('analyze');
    case 'menu': return menu('slot');
    case 'grow': return menu('grow');
    case 'kitten': return menu('nursery');
    case 'toShelter': return menu('shelter');
    // Подшаг финала: родителя из окошка вязки забирают кнопкой (на пьедестал
    // кота с пола Питомника несут руками — там меню только мешает).
    case 'champion': return menu('nursery');
    default: return shut;
  }
}

/** Пометить обучение пройденным (наступает только по последнему шагу). */
export function finishTutorial(state: GameState): void {
  state.tutorial.done = true;
}


/**
 * Подарок за ПРОЙДЕННОЕ обучение (TUTORIAL_REWARD_COINS 💰 + TUTORIAL_REWARD_CRYSTALS 💎):
 * стартовый капитал новичка перенесён сюда — на старте у игрока 💎 нет вовсе, а внутри
 * обучения они и не нужны (анализ подарочный, вязка идёт секунды, малыш растёт бесплатно). Выдаётся один
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
    bornOnce: false, previewSeen: false, ordersSeen: false, genolabSeen: false,
    genolabTabs: [], adoptDone: false, rewardTaken: false,
  };
  state.freeAnalyzeLeft = FREE_ANALYZE_COUNT;
  state.freeGrowthLeft = FREE_GROWTH_COUNT;
}
