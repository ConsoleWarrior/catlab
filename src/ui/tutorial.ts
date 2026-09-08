/**
 * Обучение новичка (FTUE) — визуальный слой. Ведёт по базовой петле игры:
 * 🧬 анализ обоих котов → пара в слот → 🔮 прогноз пары → «Свести» → 🌱 подарочное
 * взросление → малыш в Приют → 🤝 в добрые руки → 📋 заказы → 🔬 Генолаб → 🏆 пьедестал.
 * Логика шага — чистая функция ядра (`game/tutorial.ts`), здесь только показ.
 *
 * Принцип — ЖЁСТКИЙ СЦЕНАРИЙ (переделано 08.09.2026, до этого подсветка была
 * «мягкой» и всё вокруг оставалось живым). Пока обучение идёт, доступно ровно
 * одно действие — то, о котором говорит подсказка:
 *  - экран гасит `blocker` — затемнение с «окном» вокруг цели. Это `Graphics` со
 *    своим `hitArea`: `contains` возвращает true ВЕЗДЕ, кроме окна, поэтому мимо
 *    цели не проходит ни один тап (ни шапка, ни кнопки комнат, ни другие коты).
 *    Тап в затемнение повторяет подсказку тостом (`TutorHost.nudge`);
 *  - меню кота фильтрует кнопки (`tutorialMenuGate` в ядре), а на шагах-жестах
 *    вовсе не открывается — там ведёт `tutorialGestureHint`;
 *  - свайп между комнатами выключен (см. Game.installInput).
 * Кнопки «пропустить» нет: подарок за прохождение получает каждый.
 *
 * ⚠️ ВАЖНО: заслонка включается ТОЛЬКО когда цель шага найдена на экране. Нет
 * узла (комната пересобирается, открыт оверлей, кота несут в руке) — гасим её
 * целиком: намертво залипший экран хуже, чем лишняя секунда свободы.
 *
 * ⚠️ Все ДЕКОРАТИВНЫЕ узлы слоя (кольцо, рука, подложка и текст плашки) обязаны
 * иметь `eventMode = 'none'`. Одного `'passive'` на самом слое НЕ хватает: в
 * Pixi v8 интерактивность НАСЛЕДУЕТСЯ от stage (он `'static'`), и пассивный
 * потомок, попавший под палец, обрывает поиск цели — тап не доходит до кнопки
 * под ним. Ровно этим багом когда-то «съедал» нажатия пустой тост-контейнер
 * (см. Game.start). Исключение — сама заслонка: она `'static'` нарочно.
 *
 * Что рисуем:
 *  - затемнение с окном вокруг цели (окно вырезается по КОЛЬЦУ, см. ringBox);
 *  - пульсирующее кольцо вокруг цели (узел берём у комнаты через `Room.anchor`,
 *    координаты пересчитываем каждый кадр — кот на полу ходит);
 *  - «руку» 👆, проигрывающую нужный жест (зажать / нести к краю / тапнуть);
 *  - плашку с номером шага и текстом внизу (или сверху, если цель внизу экрана);
 *    поверх открытой панели плашка встаёт в свободную полосу НАД/ПОД ней или
 *    колонкой сбоку — перекрывать диалог она не вправе.
 */

import { Container, Graphics, Text } from 'pixi.js';
import type { Cat } from '../game/index.js';
import {
  tutorialStep, isInSlot, isAdult, isOld, isChampion, analyzeTarget, adoptTarget,
  growTarget, shelterTarget,
  FREE_ANALYZE_COUNT, FREE_GROWTH_COUNT,
} from '../game/index.js';
import type { TutorStep } from '../game/index.js';
import { COLORS, FONT, label } from './theme.js';
import { DEVTOOLS } from './devTools.js';
import { NAV_RESERVE, TITLE_H } from './rooms/shell.js';
import { t } from '../i18n.js';
import type { UiContext } from './context.js';

/** Что нужно классу от Game (всё остальное — приватная кухня контроллера). */
export interface TutorHost {
  /**
   * Живой контекст игры: состояние, геометрия комнаты, кот «в руках». Берём
   * объект целиком, а не копии полей, — Game заменяет ссылку на state при
   * загрузке сейва, а roomW/roomH меняются на каждом ресайзе.
   */
  readonly ctx: UiContext;
  /** Индекс комнаты по id ('nursery' / 'incubator' / 'genolab'); -1 — нет такой. */
  roomIndexById(id: string): number;
  /** Текущая открытая комната. */
  currentRoomIndex(): number;
  /** Узел-якорь внутри комнаты (Room.anchor) или null. */
  anchorIn(roomIndex: number, key: string): Container | null;
  /** Точка навигации нужной комнаты — подсказываем, куда идти. */
  navDot(roomIndex: number): Container | null;
  /**
   * Занятые полосы в верхнем ряду ТЕКУЩЕЙ комнаты (Room.topReserve): в этот
   * коридор встаёт плашка подсказки, когда стоит сверху. null — комната ничего
   * не резервирует, доступна вся ширина.
   */
  topReserve(): { left: number; right: number } | null;
  /** Открыт ли оверлей (меню кота, панель) — кольцо в этот момент не рисуем. */
  overlayOpen(): boolean;
  /**
   * Прямоугольник открытой панели в координатах сцены (uiRoot) или null, если
   * оверлея нет. Плашка подсказки обходит его стороной — см. layoutPlate.
   */
  overlayRect(): { x: number; y: number; w: number; h: number } | null;
  /**
   * Узел ВНУТРИ открытого оверлея по его `.label` (панель сама метит нужную
   * кнопку) или null. Нужен шагам вроде «Заказы»: доска — не комната, обычный
   * `anchorIn` до её кнопок не достаёт, а без подсветки панель с несколькими
   * кнопками (Выполнить / 📺 / Закрыть) не говорит игроку, куда жать дальше.
   */
  overlayAnchor(label: string): Container | null;
  /**
   * Игрок ткнул мимо цели (в затемнение). Обучение обязательное, уйти с маршрута
   * нельзя — вместо молчания повторяем подсказку тостом, чтобы тап не выглядел
   * «игра зависла».
   */
  nudge(): void;
  /** Все шаги пройдены — закрыть обучение (поздравление + сейв). */
  finish(): void;
}

/** Куда указывает подсказка и что написано в плашке. */
interface Hint {
  room: string;          // id комнаты, где происходит действие
  key: string | null;    // ключ якоря внутри комнаты (null — цель не в комнате)
  text: string;
  gesture: 'tap' | 'hold' | 'carry'; // какой жест проигрывает рука
  /**
   * Показывать плашку поверх открытого оверлея. Нужно шагам, где само действие
   * лежит ВНУТРИ панели (меню кота: «💞 В слот вязки», «🧬 Анализ»). На всех
   * прочих шагах открытая панель прячет подсказку целиком — она там только мешает.
   */
  overOverlay?: boolean;
  /**
   * Кольцо ищет узел ВНУТРИ оверлея по `.label` (см. `TutorHost.overlayAnchor`),
   * а не в комнате — только пока панель открыта. Комнатный `key` при этом
   * игнорируется.
   */
  overlayKey?: string;
}

/**
 * Цвет подсветки — ЯРКО-ЗЕЛЁНЫЙ. Раньше кольцо рисовалось акцентом темы
 * (COLORS.primary, розовый), и на тёплом розово-бежевом фоне игры его попросту
 * не замечали на телефоне (замечание с теста 08.09.2026). Зелёного в палитре
 * комнат нет, поэтому он читается как «указатель», а не как часть интерьера.
 */
const RING_COLOR = 0x00e14b;
/** Тёмная обводка снаружи: на светлом полу одна зелень сливалась бы с бликами. */
const RING_EDGE = 0x0b4f22;

const PLATE_MAX_W = 460;
// Сколько секунд цель должна простоять ПОД плашкой, прежде чем та перепрыгнет на
// другую сторону: кот-цель ходит по полу, и без этой выдержки плашка мельтешила
// туда-сюда на каждом его шаге.
const SIDE_SWITCH_S = 0.9;
// Ниже этой ширины плашка не сжимается даже в узком коридоре между панелями
// комнаты: текст подсказки должен оставаться читаемым (п. 1.10.1).
const MIN_PLATE_W = 300;
// А это предел для колонки СБОКУ от открытой панели (мобильный ландшафт): там
// выбор между узкой плашкой и полным её отсутствием, и узкая всё же полезнее.
const MIN_SIDE_W = 200;
// Запас вокруг цели у «окна» заслонки: попасть по цели должно быть легко даже
// пальцем и даже когда кот-цель шагнул в сторону между кадрами.
const HOLE_PAD = 16;

/**
 * Порядок шагов для счётчика «Шаг N из M» в плашке. Сценарий жёсткий и линейный,
 * поэтому номер шага честно показывает, сколько осталось до подарка — игрок видит
 * конец пути и не гадает, надолго ли это. `analyze` повторяется на втором коте:
 * номер тот же, и это правильно — действие одно и то же.
 */
const STEP_ORDER: readonly TutorStep[] = [
  'analyze', 'drag', 'menu', 'preview', 'breed', 'wait',
  'grow', 'kitten', 'toShelter', 'adopt', 'orders', 'genolab', 'champion',
];

/** Комната шага — куда вернуть игрока при входе в игру и в DEV-прогоне. */
export function tutorialRoomOf(step: TutorStep): string {
  switch (step) {
    case 'adopt': return 'shelter';
    case 'genolab': return 'genolab';
    case 'preview': case 'breed': case 'wait': case 'kitten': case 'grow': return 'incubator';
    default: return 'nursery';
  }
}

/**
 * Короткая подсказка тостом для шагов-ЖЕСТОВ: там кота надо донести за шкирку, а
 * не нажать кнопку, поэтому меню кота на них не открывается (`tutorialMenuGate`)
 * — вместо него игрок получает эту строку. Пустая строка — шаг не жестовый.
 */
export function tutorialGestureHint(step: TutorStep): string {
  switch (step) {
    case 'drag': return t('Зажми котика и тяни к левому краю — в Инкубатор',
      'Hold the cat and drag it to the left edge — into the Incubator');
    case 'adopt': return t('Зажми котика и тяни в правый угол, на станцию 🤝',
      'Hold the cat and drag it to the 🤝 station in the right corner');
    case 'champion': return t('Зажми котика и поставь его на пьедестал 🏆',
      'Hold the cat and put it onto a pedestal 🏆');
    default: return '';
  }
}

export class Tutorial {
  readonly layer = new Container();

  private readonly ring = new Graphics();
  private readonly hand: Text;
  private readonly plate = new Container();
  private readonly plateBg = new Graphics();
  private readonly plateText: Text;
  /**
   * Затемнение всего экрана с «окном» вокруг цели шага: сквозь окно тапы
   * проходят, всё остальное заслонка съедает. Обучение обязательное, свернуть
   * его нечем — значит и уйти с маршрута игрок не должен.
   */
  private readonly blocker = new Graphics();
  /** Окно заслонки в координатах сцены; null — заслонка выключена. */
  private hole: { x: number; y: number; w: number; h: number } | null = null;
  /** Габарит нарисованного кольца — по нему вырезается окно (см. drawRing). */
  private ringBox = { x: 0, y: 0, w: 0, h: 0 };
  private holeDrawn = '';        // что нарисовано в заслонке — лишний раз не пересобираем

  private t = 0;                 // общее время (пульс кольца)
  private gestureT = 0;          // фаза жеста руки
  private lastStep: TutorStep | null = null;
  // Позиция плашки «залипает»: сторону выбираем один раз на цель (см. pickSide),
  // а не каждый кадр, иначе она скачет за ходящим котом и за открытием панелей.
  private plateSide: 'top' | 'bottom' = 'bottom';
  private plateAim = '';         // комната/якорь текущей цели — сменился, сторону выбираем заново
  private sideFixed = false;     // сторона под эту цель уже выбрана
  private overlapT = 0;          // сколько цель уже стоит под плашкой, с
  private plateH = 52;           // высота плашки прошлого кадра (нужна pickSide до первого layout)
  private plateDrawn = '';       // что нарисовано в плашке сейчас — лишний раз не пересобираем

  constructor(private readonly host: TutorHost) {
    // 'passive', а не 'none': сам слой тапы не ловит, но интерактивный ребёнок —
    // крестик «пропустить» — события получает (с 'none' отключилось бы всё
    // поддерево). Декор при этом обязан быть 'none' — см. шапку файла.
    this.layer.eventMode = 'passive';
    this.layer.label = 'tutorial'; // опознавание слоя при отладке хит-теста
    this.layer.visible = false;
    this.ring.eventMode = 'none';
    this.plate.eventMode = 'passive';
    this.plateBg.eventMode = 'none';

    this.hand = label('👆', 30, 0xffffff, '700');
    this.hand.alpha = 0.95;
    this.hand.eventMode = 'none';

    this.plateText = new Text({
      text: '',
      style: {
        fontFamily: FONT, fontSize: 15, fontWeight: '700', fill: COLORS.ink,
        wordWrap: true, wordWrapWidth: PLATE_MAX_W - 40, lineHeight: 20, align: 'left',
      },
    });
    this.plateText.anchor.set(0, 0.5);
    this.plateText.eventMode = 'none';

    // Заслонка: ловит ВСЕ тапы, кроме «окна» вокруг цели шага (см. setHole).
    // Ниже кольца и плашки — их она не должна затемнять.
    this.blocker.eventMode = 'static';
    this.blocker.cursor = 'default';
    this.blocker.hitArea = { contains: (x: number, y: number) => !this.inHole(x, y) };
    this.blocker.on('pointertap', () => this.host.nudge());

    this.plate.addChild(this.plateBg, this.plateText);
    this.layer.addChild(this.blocker, this.ring, this.hand, this.plate);
  }

  /** Покадровое обновление. dt — секунды. */
  update(dt: number): void {
    const step = tutorialStep(this.host.ctx.state, this.host.ctx.now());
    if (!step) {
      this.layer.visible = false;
      this.setHole(null);
      // Шагов больше нет, а обучение ещё открыто — значит игрок только что
      // закрыл последний (кот на пьедестале). Поздравляем и выключаем.
      if (this.host.ctx.state.tutorial?.done === false) this.host.finish();
      return;
    }

    this.t += dt;
    if (step !== this.lastStep) { this.gestureT = 0; this.lastStep = step; }
    this.gestureT += dt;

    const hint = this.hintFor(step);
    // Открытая панель: подсказка остаётся только там, где действие внутри неё
    // самой (меню кота), иначе прячем весь слой — он лишь загораживает диалог.
    const overlay = this.host.overlayOpen();
    if (overlay && !hint.overOverlay) { this.layer.visible = false; this.setHole(null); return; }

    const roomIdx = this.host.roomIndexById(hint.room);
    const here = this.host.currentRoomIndex() === roomIdx;

    // Цель ВНУТРИ открытой панели (см. overlayKey) — комната ни при чём, ищем
    // узел по метке прямо в оверлее. Иначе — обычная комнатная цель, а ушёл
    // игрок в другую комнату — ведём обратно: подсвечиваем точку навигации.
    const node = overlay && hint.overlayKey ? this.host.overlayAnchor(hint.overlayKey)
      : here && hint.key ? this.host.anchorIn(roomIdx, hint.key) : null;
    const navNode = !overlay && !here ? this.host.navDot(roomIdx) : null;
    const target = node ?? navNode;

    // Цель шага сменилась (другая комната, якорь или оверлей) — плашке разрешено
    // выбрать сторону заново. Внутри одной цели она стоит на месте, см. pickSide.
    const aim = `${hint.room}/${hint.key ?? ''}/${hint.overlayKey ?? ''}`;
    if (aim !== this.plateAim) { this.plateAim = aim; this.sideFixed = false; this.overlapT = 0; }

    // Кота держат за шкирку: сам он висит в руке, а его узел на полу остался
    // стоять на месте — кольцо вокруг него светило бы в пустоту. Пока кота несут,
    // указатель на кота не рисуем вовсе (зоны дропа — 'slot', 'adopt', 'pedestal'
    // — подсвечиваются как раньше: туда и надо целиться).
    const dragging = !!this.host.ctx.carrying() && !!hint.key?.startsWith('cat:');

    this.layer.visible = true;
    // Пока открыт оверлей, кольцо/рука обычно бессмысленны — цель под панелью,
    // плашка одна объясняет, какую кнопку нажать. Исключение — overlayKey: цель
    // САМА лежит в оверлее (кнопка «Закрыть» доски заказов), кольцо на неё
    // ставим как обычно, а не только текстом.
    const showPointer = !dragging && !!target && (!overlay || !!hint.overlayKey);

    this.ring.visible = showPointer;
    this.hand.visible = showPointer;

    if (showPointer && target) {
      const b = target.getBounds();
      const k = this.scale();
      const p = this.host.ctx.uiRoot.toLocal({ x: b.x + b.width / 2, y: b.y + b.height / 2 });
      // размеры цели в координатах сцены (getBounds() — пиксели окна)
      const w = Math.min(this.host.ctx.roomW * 0.8, b.width / k);
      const h = Math.min(this.host.ctx.roomH * 0.8, b.height / k);
      const r = this.drawRing(p.x, p.y, w, h);
      this.moveHand(p.x, p.y, r, here ? hint.gesture : 'tap');
      this.pickSide(p.y, Math.max(r, h / 2), dt);
      if (overlay) {
        // Заслонку не ставим, пока цель лежит ВНУТРИ оверлея: у панели уже есть
        // своё затемнение и свои кнопки (Выполнить / 📺), гасить их поверх кольца
        // незачем — оно тут просто подсказка, а не единственный проход к цели.
        this.setHole(null);
      } else {
        // Окно заслонки — по нарисованному кольцу (плюс запас под палец): кольцо
        // должно целиком лежать в светлом, иначе подсветка выглядит обрезанной.
        // Заслонка работает ТОЛЬКО когда цель найдена: не нашли узел (комната
        // пересобирается, панель закрывается) — гасим её целиком, иначе экран
        // залип бы намертво.
        this.setHole({
          x: this.ringBox.x, y: this.ringBox.y,
          w: Math.max(this.ringBox.w, 56) + HOLE_PAD, h: Math.max(this.ringBox.h, 56) + HOLE_PAD,
        });
      }
    } else {
      // Оверлей (у панели своё затемнение и свои кнопки), кот в руках (несём его
      // через весь экран) или цель не найдена — заслонка не нужна.
      this.setHole(null);
    }
    // Цели на экране нет (оверлей, чужая комната, кот в руке) — сторону не трогаем:
    // плашка остаётся там же, где стояла, и не прыгает на каждое открытие меню.
    // Пока панель открыта, плашка обходит её прямоугольник (см. layoutPlate).
    const no = STEP_ORDER.indexOf(step) + 1;
    const head = t(`Шаг ${no} из ${STEP_ORDER.length}. `, `Step ${no} of ${STEP_ORDER.length}. `);
    this.layoutPlate(head + hint.text, this.plateSide, overlay ? this.host.overlayRect() : null);
  }

  /**
   * Поставить «окно» заслонки (координаты сцены, центр + размеры) или снять её.
   * Перерисовываем, только когда окно реально сдвинулось: цель-кот ходит по полу,
   * и покадровая пересборка четырёх прямоугольников была бы напрасной работой.
   */
  private setHole(hole: { x: number; y: number; w: number; h: number } | null): void {
    this.hole = hole;
    const key = hole
      ? `${Math.round(hole.x / 2)},${Math.round(hole.y / 2)},${Math.round(hole.w)},${Math.round(hole.h)}`
      : '-';
    if (key === this.holeDrawn) return;
    this.holeDrawn = key;
    this.blocker.visible = !!hole;
    this.blocker.eventMode = hole ? 'static' : 'none';
    this.blocker.clear();
    if (!hole) return;

    // Затемнение рисуем ЧЕТЫРЬМЯ ПОЛОСАМИ вокруг окна. Вычитание путей
    // (GraphicsContext.cut) для этого не годится: в Pixi v8 оно съедает и саму
    // заливку — экран остаётся без вуали вовсе (проверено 08.09.2026).
    const { roomW: W, roomH: H } = this.host.ctx;
    const l = Math.max(0, hole.x - hole.w / 2);
    const r = Math.min(W, hole.x + hole.w / 2);
    const tp = Math.max(0, hole.y - hole.h / 2);
    const bt = Math.min(H, hole.y + hole.h / 2);
    const veil = { color: COLORS.overlay, alpha: 0.5 };
    this.blocker.rect(0, 0, W, tp).fill(veil);
    this.blocker.rect(0, bt, W, H - bt).fill(veil);
    this.blocker.rect(0, tp, l, bt - tp).fill(veil);
    this.blocker.rect(r, tp, W - r, bt - tp).fill(veil);
  }

  /** Точка (координаты сцены) внутри окна заслонки — тап проходит к цели. */
  private inHole(x: number, y: number): boolean {
    // ⚠️ ВРЕМЕННОЕ DEV: верхний ряд (кнопки 🎓/🛠/📊) заслонка не перекрывает —
    // иначе из dev-сборки не выключить обучение, которое сама же и блокирует.
    // В релизе DEVTOOLS выключен, и исключения нет.
    if (DEVTOOLS && y < this.host.ctx.topInset) return true;
    const h = this.hole;
    return !!h && Math.abs(x - h.x) <= h.w / 2 && Math.abs(y - h.y) <= h.h / 2;
  }

  /**
   * Выбор стороны плашки. Раньше сторону решал порог `targetY > roomH*0.62`, и
   * считался он каждый кадр: кот-цель ходит по полу и пересекает порог туда-сюда,
   * а стоило открыть меню кота (цель «пропадала» под панелью) — плашка уезжала
   * наверх и по закрытии возвращалась вниз. Теперь сторона выбирается ОДИН РАЗ
   * на цель по тому же порогу, а меняется, только если цель действительно заехала
   * под плашку, продержалась там SIDE_SWITCH_S и на другой стороне ей свободно
   * (иначе крупная цель, накрытая с обеих сторон, гоняла бы плашку по кругу).
   */
  private pickSide(cy: number, half: number, dt: number): void {
    if (!this.sideFixed) {
      this.plateSide = cy > this.host.ctx.roomH * 0.62 ? 'top' : 'bottom';
      this.sideFixed = true;
      this.overlapT = 0;
      return;
    }
    const hits = (side: 'top' | 'bottom'): boolean => {
      const y = this.plateY(side, this.plateH);
      return cy + half > y - 6 && cy - half < y + this.plateH + 6;
    };
    const other: 'top' | 'bottom' = this.plateSide === 'top' ? 'bottom' : 'top';
    this.overlapT = hits(this.plateSide) && !hits(other) ? this.overlapT + dt : 0;
    if (this.overlapT >= SIDE_SWITCH_S) { this.plateSide = other; this.overlapT = 0; }
  }

  /**
   * Верх плашки на выбранной стороне. Сверху она встаёт ПОД титульной строкой
   * комнаты (название, счётчик и кнопки рядом должны остаться видимыми —
   * п. 1.10.3), снизу — над полосой навигации.
   */
  private plateY(side: 'top' | 'bottom', h: number): number {
    return side === 'top'
      ? this.host.ctx.topInset + 8 + TITLE_H + 10
      : this.host.ctx.roomH - NAV_RESERVE - h - 12;
  }

  /** Масштаб сцены: getBounds() отдаёт пиксели окна, а рисуем мы в uiRoot. */
  private scale(): number {
    return this.host.ctx.uiRoot.scale.x || 1;
  }

  /**
   * Подсветка по форме цели: круг для «квадратных» целей (кот, точка навигации),
   * скруглённая рамка для вытянутых (кнопки, карточка слота) — круг вокруг
   * широкой кнопки занимал пол-экрана. Возвращает полурадиус для позиции руки.
   */
  private drawRing(x: number, y: number, w: number, h: number): number {
    const pulse = 1 + Math.sin(this.t * 3.4) * 0.06;
    const pad = 12 * pulse;
    // Тёмно-зелёный контур снаружи + яркая зелень внутри: на светлом полу пара
    // «тень + цвет» видна и в солнечный день на телефоне.
    const outer = { width: 4, color: RING_EDGE, alpha: 0.45 };
    const inner = { width: 6, color: RING_COLOR, alpha: 1 };
    this.ring.clear();

    const ratio = w / Math.max(1, h);
    if (ratio > 0.7 && ratio < 1.45) {
      const r = Math.max(24, Math.min(140, Math.max(w, h) / 2 + pad));
      this.ring.circle(x, y, r + 7).stroke(outer);
      this.ring.circle(x, y, r).stroke(inner);
      this.ringBox = { x, y, w: (r + 9) * 2, h: (r + 9) * 2 };
      return r;
    }
    const rw = w + pad * 2, rh = h + pad * 2;
    const rad = Math.min(rh / 2, 18);
    this.ring.roundRect(x - rw / 2 - 5, y - rh / 2 - 5, rw + 10, rh + 10, rad + 5).stroke(outer);
    this.ring.roundRect(x - rw / 2, y - rh / 2, rw, rh, rad).stroke(inner);
    this.ringBox = { x, y, w: rw + 14, h: rh + 14 };
    return rh / 2;
  }

  /**
   * Рука проигрывает жест шага:
   *  - `tap`   — короткое постукивание по цели;
   *  - `hold`  — палец опускается, «зажимает» и тянет чуть в сторону (взять за шкирку);
   *  - `carry` — едет от кота к левому краю экрана (перенос между комнатами).
   */
  private moveHand(x: number, y: number, r: number, gesture: 'tap' | 'hold' | 'carry'): void {
    const loop = gesture === 'carry' ? 2.2 : 1.4;
    const k = (this.gestureT % loop) / loop; // 0..1 фаза
    if (gesture === 'carry') {
      // от цели к левому краю и обратно (пауза в конце — видно, куда нести)
      const ease = k < 0.75 ? k / 0.75 : 1;
      const toX = 26;
      this.hand.position.set(x + (toX - x) * ease, y + r * 0.5 - 6 * Math.sin(k * Math.PI * 2));
      this.hand.alpha = k > 0.9 ? 0.3 : 0.95;
      return;
    }
    if (gesture === 'hold') {
      // прижался и потянул влево-вниз (жест «взял за шкирку и понёс»)
      const press = Math.min(1, k * 3);
      const drag = Math.max(0, (k - 0.45) / 0.55);
      this.hand.position.set(x + r * 0.28 - drag * r * 0.9, y + r * 0.42 + press * 5);
      this.hand.alpha = 0.55 + press * 0.4;
      return;
    }
    const press = Math.sin(k * Math.PI * 2);
    this.hand.position.set(x + r * 0.28, y + r * 0.45 + press * 5);
    this.hand.alpha = 0.75 + Math.abs(press) * 0.25;
  }

  /**
   * Разложить плашку. `avoid` — прямоугольник открытой панели: подсказка не
   * вправе её закрывать (игрок переставал понимать, какое меню открыл), но и
   * пропадать ей нельзя — на шагах «тапни кота → кнопка в меню» нужная кнопка
   * лежит как раз внутри панели. Поэтому плашка ищет свободное место рядом:
   * сперва полосу над панелью или под ней, а если панель высокая (мобильный
   * ландшафт — она почти во весь экран) — колонку сбоку от неё. Если не
   * помещается никуда, честнее не показать её вовсе.
   */
  private layoutPlate(
    text: string, side: 'top' | 'bottom',
    avoid: { x: number; y: number; w: number; h: number } | null = null,
  ): void {
    const ctx = this.host.ctx;
    // Сверху плашка живёт в коридоре между боковыми панелями комнаты (стойка
    // заказов и кормушка в Питомнике, массовые кнопки в Приюте): комната сообщает
    // их ширину через Room.topReserve. Без этого плашка, центрированная по всей
    // сцене, наезжала на кормушку — п. 1.10.3 требований площадки. Снизу вдоль
    // краёв ничего нет, там доступна вся ширина. Поверх затемнения панели комнаты
    // не видны вовсе — коридор там на всю ширину.
    const res = side === 'top' && !avoid ? this.host.topReserve() : null;
    const left = res?.left ?? 0;
    const right = res?.right ?? 0;
    const corridor = ctx.roomW - left - right;

    // Раскладку считаем только когда что-то реально изменилось: текст, сторона,
    // размер сцены или прямоугольник открытой панели. Иначе — раз за кадр
    // перемеряли бы обёртку текста ради тех же самых координат.
    const box = avoid
      ? `${Math.round(avoid.x)},${Math.round(avoid.y)},${Math.round(avoid.w)},${Math.round(avoid.h)}`
      : '-';
    const key = `${side}|${Math.round(corridor)}|${Math.round(left)}|${Math.round(ctx.roomH)}|${box}|${text}`;
    if (key === this.plateDrawn) return;
    this.plateDrawn = key;

    // Ширина плашки тянется за шириной сцены: в мобильном ландшафте сцена низкая и
    // широкая, и узкая плашка разворачивала текст в пять строк — такая «стена»
    // накрывала верхний ряд кнопок комнаты. Чем шире плашка, тем она ниже, и
    // перекрывать ей уже почти нечего. Коридор уже плашки (узкий экран) — берём
    // его целиком: наехать на панель хуже, чем стать на строку выше.
    const W = Math.round(Math.max(
      MIN_PLATE_W,
      Math.min(Math.max(PLATE_MAX_W, ctx.roomW * 0.62), ctx.roomW - 32, corridor - 16),
    ));
    let H = this.drawPlate(text, W);

    if (!avoid) {
      // Центр — по свободному коридору, а не по всей сцене; на всякий случай
      // прижимаем к краям экрана (коридор мог оказаться уже минимальной ширины).
      const x = Math.round(Math.min(Math.max(8, left + (corridor - W) / 2), ctx.roomW - W - 8));
      this.plate.position.set(x, this.plateY(side, H));
      this.plate.visible = true;
      return;
    }

    // 1) полоса над панелью или под ней — берём ту, где просторнее
    const above = avoid.y - this.topLimit();
    const below = this.bottomLimit() - (avoid.y + avoid.h);
    if (Math.max(above, below) >= H + 12) {
      const y = above >= below ? avoid.y - H - 10 : avoid.y + avoid.h + 10;
      this.plate.position.set(
        Math.round(Math.max(8, (ctx.roomW - W) / 2)),
        Math.round(Math.max(this.topLimit(), Math.min(y, this.bottomLimit() - H))),
      );
      this.plate.visible = true;
      return;
    }

    // 2) панель высокая — встаём колонкой сбоку. Текст перевёрстываем под
    // ширину этой колонки: строк станет больше, но по высоте места как раз вдоволь.
    const gapL = avoid.x - 8;
    const gapR = ctx.roomW - (avoid.x + avoid.w) - 8;
    const sideW = Math.round(Math.min(W, Math.max(gapL, gapR) - 12));
    if (sideW >= MIN_SIDE_W) {
      H = this.drawPlate(text, sideW);
      if (H <= this.bottomLimit() - this.topLimit()) {
        const x = gapL >= gapR
          ? Math.max(8, avoid.x - sideW - 10)
          : Math.min(ctx.roomW - sideW - 8, avoid.x + avoid.w + 10);
        this.plate.position.set(Math.round(x), Math.round((ctx.roomH - H) / 2));
        this.plate.visible = true;
        return;
      }
    }
    this.plate.visible = false;
  }

  /** Перерисовать плашку под ширину W; возвращает её высоту (она же plateH). */
  private drawPlate(text: string, w: number): number {
    this.plateText.style.wordWrapWidth = w - 40;
    this.plateText.text = text;
    this.plateH = Math.max(52, this.plateText.height + 26);

    this.plateBg.clear();
    // Рамка плашки — того же зелёного, что и кольцо: подсказка и её цель
    // читаются как одна пара (раньше и то и другое было розовым и терялось).
    this.plateBg.roundRect(0, 0, w, this.plateH, 16)
      .fill({ color: COLORS.hud, alpha: 0.96 })
      .stroke({ width: 2.5, color: RING_COLOR, alpha: 0.95 });

    this.plateText.position.set(20, this.plateH / 2);
    return this.plateH;
  }

  private topLimit(): number { return this.host.ctx.topInset + 8; }
  private bottomLimit(): number { return this.host.ctx.roomH - NAV_RESERVE - 4; }

  /** Текст и цель шага. Внутри шагов-переносов подшаг выбирается по «коту в руках». */
  private hintFor(step: TutorStep): Hint {
    const ctx = this.host.ctx;
    switch (step) {
      case 'analyze': {
        const cat = analyzeTarget(ctx.state);
        // Анализируем ОБОИХ стартовых котов, поэтому текст у шага два: первый
        // объясняет, зачем это вообще, второй — почему мало изучить одного.
        const first = !ctx.state.cats.some((c) => c.analyzed);
        return {
          room: 'nursery', key: cat ? `cat:${cat.id}` : null, gesture: 'tap', overOverlay: true,
          text: first
            ? t(
              'Привет! Начнём с науки. Тапни этого котика → «🧬 Генетический анализ» → 🎁 бесплатно. '
                + 'Анализ вскроет его родословную и скрытые гены предков — именно от них зависит, '
                + `какой породы родятся котята. Первые ${FREE_ANALYZE_COUNT} анализов в подарок`,
              'Hi! Science first. Tap this cat → "🧬 Genetic analysis" → 🎁 free. '
                + 'The analysis reveals its pedigree and the hidden genes of its ancestors — they are exactly what decides '
                + `which breeds the kittens will be. The first ${FREE_ANALYZE_COUNT} analyses are a gift`,
            )
            : t(
              'Теперь второго! Пара — это ДВЕ родословные: пока один родитель в тумане, '
                + 'прогноз вязки неполон, и половина дерева котёнка останется неизвестной. '
                + 'Тапни второго котика → «🧬 Генетический анализ» → 🎁 бесплатно',
              'Now the second one! A pair means TWO pedigrees: while one parent is in the fog, '
                + 'the breeding forecast is incomplete and half of the kitten pedigree stays unknown. '
                + 'Tap the second cat → "🧬 Genetic analysis" → 🎁 free',
            ),
        };
      }
      case 'drag': {
        const held = ctx.carrying();
        if (held) {
          // кота уже несут: в Инкубаторе — «отпусти на слот», иначе — «неси к краю»
          const inIncubator = this.host.currentRoomIndex() === this.host.roomIndexById('incubator');
          return inIncubator
            ? { room: 'incubator', key: 'slot', text: t('Отпусти котика прямо на окошко вязки 💞', 'Drop the cat right onto the breeding slot 💞'), gesture: 'tap' }
            : {
              room: 'nursery', key: null, gesture: 'carry',
              text: t('Не отпускай! Веди котика к левому краю — лаборатория пролистнётся в Инкубатор', 'Do not let go! Carry the cat to the left edge — the lab will scroll to the Incubator'),
            };
        }
        const cat = this.firstBreeder();
        return {
          room: 'nursery',
          key: cat ? `cat:${cat.id}` : null,
          gesture: 'hold',
          text: t('Возьми котика за шкирку — зажми и тяни к левому краю, в Инкубатор', 'Pick the cat up by the scruff — hold and drag it to the left edge, into the Incubator'),
        };
      }
      case 'menu': {
        const cat = this.firstBreeder();
        return {
          room: 'nursery',
          key: cat ? `cat:${cat.id}` : null,
          gesture: 'tap',
          overOverlay: true,
          text: t('Второго проще: тапни котика → «💞 В свободный слот вязки»', 'The second one is easier: tap a cat → "💞 To a free breeding slot"'),
        };
      }
      case 'preview':
        return {
          room: 'incubator', key: 'preview', gesture: 'tap',
          text: t(
            'Пара собрана — но сначала 🔮 прогноз пары: он показывает, каких котят '
              + 'эта пара может дать и с какими шансами. Так вяжут осознанно, а не наугад',
            'The pair is ready — but first the 🔮 pair forecast: it shows which kittens '
              + 'this pair can give and with what odds. That is how you breed on purpose, not at random',
          ),
        };
      case 'breed':
        return {
          room: 'incubator', key: 'breed', gesture: 'tap',
          text: t('Теперь жми «Свести» — порода котёнка зависит от родителей', 'Now hit "Breed" — the kitten breed depends on its parents'),
        };
      case 'wait':
        return {
          room: 'incubator', key: 'slot', gesture: 'tap',
          text: t(
            'Вязка пошла! Малыш вот-вот появится прямо в окошке 🥚 '
              + 'Чем дольше идёт вязка — тем ценнее помёт',
            'Breeding has started! The kitten will show up right in the slot 🥚 '
              + 'The longer the breeding runs, the rarer the litter',
          ),
        };
      case 'grow': {
        // Малыш мог остаться в окошке вязки, а мог сразу уехать в комнату из карточки
        // рождения — ведём туда, где он сейчас (в комнатах якорь тот же, `cat:<id>`).
        const kid = growTarget(ctx.state, ctx.now());
        return {
          room: !kid || isInSlot(ctx.state, kid.id) ? 'incubator' : kid.location,
          key: kid ? `cat:${kid.id}` : 'slot', gesture: 'tap', overOverlay: true,
          text: t(
            'Малыш родился! Чтобы узнать пол котёнка, он должен вырасти, и это занимает время. '
              + 'Взросление можно ускорить: тапни по нему → «🌱 Вырастить сейчас» → 🎁 бесплатно. '
              + `Первые ${FREE_GROWTH_COUNT} ускорений роста в подарок!`,
            'The kitten is born! To find out its sex it has to grow up, and that takes time. '
              + 'Growing up can be rushed: tap it → "🌱 Grow up now" → 🎁 free. '
              + `The first ${FREE_GROWTH_COUNT} grow-ups are a gift!`,
          ),
        };
      }
      case 'kitten':
        return {
          room: 'incubator', key: 'toNursery', gesture: 'tap',
          text: t(
            'Пока кот в слоте новорождённого — слот занят. Отправь его в питомник',
            'While the cat sits in the newborn slot, the slot is busy. Send it to the cattery',
          ),
        };
      case 'toShelter': {
        const cat = shelterTarget(ctx.state);
        return {
          room: cat && isInSlot(ctx.state, cat.id) ? 'incubator' : 'nursery',
          key: cat ? `cat:${cat.id}` : null, gesture: 'tap', overOverlay: true,
          text: t(
            'Отправь кота в приют: тапни по нему → «🏚️ В приют». Приют — перевалочный '
              + 'пункт для всех лишних котиков',
            'Send the cat to the shelter: tap it → "🏚️ To the shelter". The shelter is '
              + 'the waypoint for every spare cat',
          ),
        };
      }
      case 'adopt': {
        if (ctx.carrying()) {
          return {
            room: 'shelter', key: 'adopt', gesture: 'tap',
            text: t(
              'Отпусти котика на станцию 🤝 в правом углу — откроется диалог: '
                + 'соглашаться необязательно, в нём можно нажать «Нет» — этого кота продавать сейчас не обязательно',
              'Drop the cat onto the 🤝 station in the right corner — a dialog opens: '
                + 'agreeing is optional, you can tap "No" — you do not have to give this particular cat away right now',
            ),
          };
        }
        const cat = adoptTarget(ctx.state);
        return {
          room: 'shelter', key: cat ? `cat:${cat.id}` : null, gesture: 'hold',
          text: t(
            'Простых и лишних котиков отдают «в добрые руки»: возьми котика за шкирку '
              + 'и тащи в правый угол, на станцию 🤝. Породистых так не отдавай — им место в Питомнике. '
              + 'Диалог можно отменить — сейчас можешь и не продавать',
            'Plain and spare cats are given away: pick a cat up by the scruff '
              + 'and drag it to the 🤝 station in the right corner. Do not give pedigreed cats away — they belong in the Cattery. '
              + 'The dialog can be cancelled — you do not have to sell right now',
          ),
        };
      }
      case 'orders': {
        // Доску можно разглядывать сколько угодно — шаг завершается только по
        // ЗАКРЫТИЮ (см. Game.openOrders), поэтому пока панель открыта, кольцо
        // переезжает на её кнопку «Закрыть»: без этого игрок остаётся один на
        // один с доской заказов (Выполнить / 📺 / Закрыть) и не знает, куда жать.
        if (this.host.overlayOpen()) {
          return {
            room: 'nursery', key: null, overlayKey: 'tutorClose', gesture: 'tap', overOverlay: true,
            text: t('Вот доска заказов! Дочитал — жми «Закрыть», обучение продолжится', 'Here is the order board! Once you are done reading, hit "Close" to continue'),
          };
        }
        return {
          room: 'nursery', key: 'orders', gesture: 'tap',
          text: t(
            '📋 Заказы — главный заработок игры, доска висит в Питомнике справа. Клиент просит кота '
              + 'определённой породы или не ниже нужной редкости, ты кладёшь подходящего в 🧺 корзину '
              + 'под кнопкой и жмёшь «Выполнить»: платят 💰, 💎 и опытом ⭐. Заказ живёт 6 часов и сменится сам. Открой доску',
            '📋 Orders are the main earner of the game, and the board hangs on the right in the Cattery. '
              + 'A client asks for a cat of a certain breed or of at least a certain rarity, you put a matching cat '
              + 'into the 🧺 basket under the button and hit "Complete": it pays 💰, 💎 and ⭐ XP. '
              + 'An order lives 6 hours and then changes by itself. Open the board',
          ),
        };
      }
      case 'genolab':
        return {
          room: 'genolab', key: 'codex', gesture: 'tap',
          text: t(
            '🔬 Генолаб — мозг лаборатории, три вкладки: 📖 Котодекс (все породы и рецепты — '
              + 'кто от кого получается), 🔬 Улучшения (постоянные апгрейды за 🧬 ДНК) и '
              + '🧪 Исследования (стол рецептов: вскрывает рецепты новых пород). '
              + 'Загляни в 📖 Котодекс — оттуда ты и будешь узнавать, кого с кем сводить',
            '🔬 The Genolab is the brain of the lab, with three tabs: 📖 the Catdex (every breed '
              + 'and recipe — who comes from whom), 🔬 Upgrades (permanent upgrades for 🧬 DNA) and '
              + '🧪 Research (the recipe bench: it uncovers recipes for new breeds). '
              + 'Open the 📖 Catdex — that is where you learn which cats to pair',
          ),
        };
      case 'champion':
      default: {
        if (ctx.carrying()) {
          return {
            room: 'nursery', key: 'pedestal', gesture: 'tap',
            text: t('Опусти котика на пьедестал 🏆 — над тумбой загорится золотая зона', 'Drop the cat onto a pedestal 🏆 — a golden zone lights up above it'),
          };
        }
        const cat = this.championTarget();
        if (!cat) {
          return {
            room: 'incubator', key: 'slot', gesture: 'tap', overOverlay: true,
            text: t(
              'Родители всё ещё стоят в окошке вязки. Тапни кота → «🏠 В питомник» — '
                + 'он пригодится на выставке',
              'The parents are still standing in the breeding slot. Tap a cat → "🏠 To the cattery" — '
                + 'it will come in handy at the show',
            ),
          };
        }
        return {
          room: 'nursery', key: `cat:${cat.id}`, gesture: 'hold',
          text: t(
            'И последнее: подними взрослого котика за шкирку и поставь на пьедестал 🏆. '
              + 'Лучшие коты, когда сыты, приносят на выставке постоянный доход 💰',
            'And the last one: pick an adult cat up by the scruff and put it onto a pedestal 🏆. '
              + 'Your best cats, as long as they are fed, bring a steady income at the show 💰',
          ),
        };
      }
    }
  }

  /** Кот из питомника, которого сейчас логично отправить в слот вязки. */
  private firstBreeder(): Cat | null {
    const s = this.host.ctx.state;
    const now = Date.now();
    const slot = s.slots[0];
    // если один уже в слоте — ведём к коту противоположного пола (пара ♀+♂)
    const need = slot?.motherId ? 'male' : slot?.fatherId ? 'female' : null;
    const fit = s.cats.filter((c) => c.location === 'nursery'
      && !isInSlot(s, c.id) && isAdult(c, now) && !isOld(c)
      && (!need || c.genotype.sex === need));
    return fit[0] ?? null;
  }

  /**
   * Кот для пьедестала: взрослый (котёнка выставка не примет), гуляет по
   * Питомнику и ещё не чемпион. Пусто — значит все взрослые заперты в окошке
   * вязки, и подсказка сначала ведёт забрать их оттуда.
   */
  private championTarget(): Cat | null {
    const s = this.host.ctx.state;
    const now = Date.now();
    return s.cats.find((c) => c.location === 'nursery' && isAdult(c, now)
      && !isInSlot(s, c.id) && !isChampion(s, c.id)) ?? null;
  }
}
