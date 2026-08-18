/**
 * Обучение новичка (FTUE) — визуальный слой. Ведёт по базовой петле игры:
 * 🧬 анализ → пара в слот → 🔮 прогноз пары → «Свести» → ⚡ подарочное ускорение →
 * малыш в Приют → 🤝 в добрые руки → 📋 заказы (доска в Питомнике) → 🏆 пьедестал.
 * Логика шага — чистая функция ядра (`game/tutorial.ts`), здесь только показ.
 *
 * Принцип — МЯГКАЯ подсветка: ничего не блокируется и не затемняется, все тапы
 * проходят насквозь. Игрок волен игнорировать подсказку, уйти в другую комнату
 * или сделать шаг раньше — подсветка просто догонит его на следующем кадре.
 *
 * ⚠️ Все декоративные узлы слоя (кольцо, рука, подложка и текст плашки) обязаны
 * иметь `eventMode = 'none'`. Одного `'passive'` на самом слое НЕ хватает: в
 * Pixi v8 интерактивность НАСЛЕДУЕТСЯ от stage (он `'static'`), и пассивный
 * потомок, попавший под палец, обрывает поиск цели — тап не доходит до кнопки
 * под ним. Ровно этим багом когда-то «съедал» нажатия пустой тост-контейнер
 * (см. Game.start). 'none' у детей + 'passive' у слоя = кнопка «пропустить»
 * работает, остальное для событий прозрачно.
 *
 * Что рисуем:
 *  - пульсирующее кольцо вокруг цели (узел берём у комнаты через `Room.anchor`,
 *    координаты пересчитываем каждый кадр — кот на полу ходит);
 *  - «руку» 👆, проигрывающую нужный жест (зажать / нести к краю / тапнуть);
 *  - плашку с текстом внизу (или сверху, если цель в нижней части экрана).
 */

import { Container, Graphics, Text } from 'pixi.js';
import type { Cat } from '../game/index.js';
import {
  tutorialStep, isInSlot, isAdult, isOld, isChampion, analyzeTarget, adoptTarget,
  growTarget, shelterTarget,
  FREE_ANALYZE_COUNT, FREE_SKIP_COUNT, FREE_GROWTH_COUNT,
} from '../game/index.js';
import type { TutorStep } from '../game/index.js';
import { COLORS, FONT, label } from './theme.js';
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
  /** Игрок нажал «пропустить обучение». */
  skip(): void;
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
}

const PLATE_MAX_W = 460;
// Ниже этой ширины плашка не сжимается даже в узком коридоре между панелями
// комнаты: текст подсказки должен оставаться читаемым (п. 1.10.1).
const MIN_PLATE_W = 300;

export class Tutorial {
  readonly layer = new Container();

  private readonly ring = new Graphics();
  private readonly hand: Text;
  private readonly plate = new Container();
  private readonly plateBg = new Graphics();
  private readonly plateText: Text;
  private readonly skipBtn: Container;

  private t = 0;                 // общее время (пульс кольца)
  private gestureT = 0;          // фаза жеста руки
  private lastStep: TutorStep | null = null;

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
        wordWrap: true, wordWrapWidth: PLATE_MAX_W - 76, lineHeight: 20, align: 'left',
      },
    });
    this.plateText.anchor.set(0, 0.5);
    this.plateText.eventMode = 'none';

    // Крестик «пропустить» — единственный интерактивный элемент слоя.
    this.skipBtn = new Container();
    this.skipBtn.eventMode = 'static';
    this.skipBtn.cursor = 'pointer';
    const x = label('✕', 15, COLORS.inkSoft, '800');
    const hit = new Graphics();
    hit.circle(0, 0, 17).fill({ color: 0x000000, alpha: 0.001 }); // крупная зона под палец
    this.skipBtn.addChild(hit, x);
    this.skipBtn.on('pointertap', () => this.host.skip());

    this.plate.addChild(this.plateBg, this.plateText, this.skipBtn);
    this.layer.addChild(this.ring, this.hand, this.plate);
  }

  /** Покадровое обновление. dt — секунды. */
  update(dt: number): void {
    const step = tutorialStep(this.host.ctx.state, this.host.ctx.now());
    if (!step) {
      this.layer.visible = false;
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
    if (overlay && !hint.overOverlay) { this.layer.visible = false; return; }

    const roomIdx = this.host.roomIndexById(hint.room);
    const here = this.host.currentRoomIndex() === roomIdx;

    // Игрок ушёл в другую комнату — ведём обратно: подсвечиваем точку навигации.
    const node = here && hint.key ? this.host.anchorIn(roomIdx, hint.key) : null;
    const navNode = here ? null : this.host.navDot(roomIdx);
    const target = node ?? navNode;

    this.layer.visible = true;
    // Пока открыт оверлей, кольцо/рука бессмысленны — цель под панелью. Плашку
    // оставляем: она и объясняет, какую кнопку в этом меню нажать.
    const showPointer = !overlay && !!target;

    this.ring.visible = showPointer;
    this.hand.visible = showPointer;

    let targetY = this.host.ctx.roomH; // для выбора стороны плашки, если цели нет
    if (showPointer && target) {
      const b = target.getBounds();
      const k = this.scale();
      const p = this.host.ctx.uiRoot.toLocal({ x: b.x + b.width / 2, y: b.y + b.height / 2 });
      // размеры цели в координатах сцены (getBounds() — пиксели окна)
      const w = Math.min(this.host.ctx.roomW * 0.8, b.width / k);
      const h = Math.min(this.host.ctx.roomH * 0.8, b.height / k);
      targetY = p.y;
      const r = this.drawRing(p.x, p.y, w, h);
      this.moveHand(p.x, p.y, r, here ? hint.gesture : 'tap');
    }

    // Плашка не должна накрывать цель: цель внизу — уводим текст наверх.
    const bottom = targetY > this.host.ctx.roomH * 0.62;
    this.layoutPlate(hint.text, bottom ? 'top' : 'bottom');
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
    const outer = { width: 3, color: 0xffffff, alpha: 0.5 };
    const inner = { width: 4, color: COLORS.primary, alpha: 0.95 };
    this.ring.clear();

    const ratio = w / Math.max(1, h);
    if (ratio > 0.7 && ratio < 1.45) {
      const r = Math.max(24, Math.min(140, Math.max(w, h) / 2 + pad));
      this.ring.circle(x, y, r + 7).stroke(outer);
      this.ring.circle(x, y, r).stroke(inner);
      return r;
    }
    const rw = w + pad * 2, rh = h + pad * 2;
    const rad = Math.min(rh / 2, 18);
    this.ring.roundRect(x - rw / 2 - 5, y - rh / 2 - 5, rw + 10, rh + 10, rad + 5).stroke(outer);
    this.ring.roundRect(x - rw / 2, y - rh / 2, rw, rh, rad).stroke(inner);
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

  private layoutPlate(text: string, side: 'top' | 'bottom'): void {
    // Сверху плашка живёт в коридоре между боковыми панелями комнаты (стойка
    // заказов и кормушка в Питомнике, массовые кнопки в Приюте): комната сообщает
    // их ширину через Room.topReserve. Без этого плашка, центрированная по всей
    // сцене, наезжала на кормушку — п. 1.10.3 требований площадки. Снизу вдоль
    // краёв ничего нет, там доступна вся ширина.
    const res = side === 'top' ? this.host.topReserve() : null;
    const left = res?.left ?? 0;
    const right = res?.right ?? 0;
    const corridor = this.host.ctx.roomW - left - right;

    // Ширина плашки тянется за шириной сцены: в мобильном ландшафте сцена низкая и
    // широкая, и узкая плашка разворачивала текст в пять строк — такая «стена»
    // накрывала верхний ряд кнопок комнаты. Чем шире плашка, тем она ниже, и
    // перекрывать ей уже почти нечего. Коридор уже плашки (узкий экран) — берём
    // его целиком: наехать на панель хуже, чем стать на строку выше.
    const W = Math.round(Math.max(
      MIN_PLATE_W,
      Math.min(
        Math.max(PLATE_MAX_W, this.host.ctx.roomW * 0.62),
        this.host.ctx.roomW - 32,
        corridor - 16,
      ),
    ));
    this.plateText.style.wordWrapWidth = W - 76;
    this.plateText.text = text;
    const H = Math.max(52, this.plateText.height + 26);

    this.plateBg.clear();
    this.plateBg.roundRect(0, 0, W, H, 16)
      .fill({ color: COLORS.hud, alpha: 0.96 })
      .stroke({ width: 2, color: COLORS.primary, alpha: 0.8 });

    this.plateText.position.set(20, H / 2);
    this.skipBtn.position.set(W - 26, H / 2);

    // Центр — по свободному коридору, а не по всей сцене; на всякий случай
    // прижимаем к краям экрана (коридор мог оказаться уже минимальной ширины).
    const x = Math.round(Math.min(
      Math.max(8, left + (corridor - W) / 2),
      this.host.ctx.roomW - W - 8,
    ));
    // Сверху плашка встаёт ПОД титульной строкой комнаты: название, счётчик и
    // кнопки рядом с ним должны остаться видимыми (п. 1.10.3 — элементы не
    // перекрывают друг друга). Снизу — над полосой навигации.
    const y = side === 'top'
      ? this.host.ctx.topInset + 8 + TITLE_H + 10
      : this.host.ctx.roomH - NAV_RESERVE - H - 12;
    this.plate.position.set(x, y);
  }

  /** Текст и цель шага. Внутри шагов-переносов подшаг выбирается по «коту в руках». */
  private hintFor(step: TutorStep): Hint {
    const ctx = this.host.ctx;
    switch (step) {
      case 'analyze': {
        const cat = analyzeTarget(ctx.state);
        return {
          room: 'nursery', key: cat ? `cat:${cat.id}` : null, gesture: 'tap', overOverlay: true,
          text: t(
            'Привет! Начнём с науки — тапни котика → «🧬 Генетический анализ» → 🎁 бесплатно. '
              + 'Он вскроет родословную и скрытые гены предков — от них зависит, какой породы будут потомки. '
              + `Первые ${FREE_ANALYZE_COUNT} анализов бесплатны`,
            'Hi! Science first — tap a cat → "🧬 Genetic analysis" → 🎁 free. '
              + 'It reveals the pedigree and the hidden genes of its ancestors — they decide which breeds the offspring will be. '
              + `The first ${FREE_ANALYZE_COUNT} analyses are free`,
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
      case 'skip':
        return {
          room: 'incubator', key: 'freeSkip', gesture: 'tap',
          text: t(
            `Вязка идёт. Держи подарок лаборатории ⚡ первые ${FREE_SKIP_COUNT} ускорений бесплатно!`,
            `Breeding is running. Here is a gift from the lab ⚡ the first ${FREE_SKIP_COUNT} speed-ups are free!`,
          ),
        };
      case 'wait':
        return {
          room: 'incubator', key: 'slot', gesture: 'tap',
          text: t('Малыш вот-вот появится в окошке вязки 🥚', 'The kitten is about to appear in the breeding slot 🥚'),
        };
      case 'grow': {
        // Малыш мог остаться в окошке вязки, а мог сразу уехать в комнату из карточки
        // рождения — ведём туда, где он сейчас (в комнатах якорь тот же, `cat:<id>`).
        const kid = growTarget(ctx.state, ctx.now());
        return {
          room: !kid || isInSlot(ctx.state, kid.id) ? 'incubator' : kid.location,
          key: kid ? `cat:${kid.id}` : 'slot', gesture: 'tap', overOverlay: true,
          text: t(
            'Малыш родился! Чтобы узнать пол котёнка, он должен вырасти. Тапни по нему → '
              + `«🌱 Вырастить сейчас» → 🎁 бесплатно. Первые ${FREE_GROWTH_COUNT} ускорений роста бесплатно!`,
            'The kitten is born! To find out its sex it has to grow up. Tap it → '
              + `"🌱 Grow up now" → 🎁 free. The first ${FREE_GROWTH_COUNT} grow-ups are free!`,
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
            text: t('Отпусти котика на станцию 🤝 в правом углу — за него дадут 💰 и опыт ⭐', 'Drop the cat onto the 🤝 station in the right corner — you get 💰 and ⭐ XP for it'),
          };
        }
        const cat = adoptTarget(ctx.state);
        return {
          room: 'shelter', key: cat ? `cat:${cat.id}` : null, gesture: 'hold',
          text: t(
            'Простых и лишних котиков отдают «в добрые руки»: возьми котика за шкирку '
              + 'и тащи в правый угол, на станцию 🤝. Породистых так не отдавай — им место в Питомнике',
            'Plain and spare cats are given away: pick a cat up by the scruff '
              + 'and drag it to the 🤝 station in the right corner. Do not give pedigreed cats away — they belong in the Cattery',
          ),
        };
      }
      case 'orders':
        return {
          room: 'nursery', key: 'orders', gesture: 'tap',
          text: t(
            '📋 Заказы — главный заработок игры, доска висит в Питомнике слева. Клиент просит кота '
              + 'определённой породы или не ниже нужной редкости, ты кладёшь подходящего в 🧺 корзину '
              + 'под кнопкой и жмёшь «Выполнить»: платят 💰, 💎 и опытом ⭐. Заказ живёт 6 часов и сменится сам. Открой доску',
            '📋 Orders are the main earner of the game, and the board hangs on the left in the Cattery. '
              + 'A client asks for a cat of a certain breed or of at least a certain rarity, you put a matching cat '
              + 'into the 🧺 basket under the button and hit "Complete": it pays 💰, 💎 and ⭐ XP. '
              + 'An order lives 6 hours and then changes by itself. Open the board',
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
