/**
 * «Живой пол» комнаты: котики ходят по полу, дышат, их можно взять за шкирку
 * (поза виса + перетаскивание) и тапнуть для меню действий. Как в первом тесте,
 * но поверх игровой логики. Питомник и Приют используют это вместо карточек.
 *
 * Псевдо-3D: пол — не линия, а уходящая вглубь плоскость (см. `floorPlane` в
 * rooms/shell.ts). У каждого кота есть глубина z∈[0,1]: вдали (z=1) он выше по
 * экрану, мельче и разброс по X уже; вблизи (z=0) — крупнее, ниже, шире. Ближние
 * коты рисуются поверх дальних (сортировка по экранному Y).
 *
 * Поведение — конечный автомат состояний (`ActorState`): большую часть времени
 * коты отдыхают (сон/умывание/оглядывание), а не бесконечно бродят — так толпа
 * читается спокойнее и реалистичнее. Тень — отдельный узел, не участвует в
 * подскоке при ходьбе (только сам кот). Цели блуждания смещены в «зону» по полу
 * (самцы слева, самки справа, котята в центре) мягко — без жёстких границ.
 *
 * Вторая «опора» (не обязательная) — настенная полка (`ShelfPlane`, Приют):
 * взрослый кот идёт под доску, приседает-виляет и запрыгивает наверх, гостит там
 * и спрыгивает обратно. На доске коты проходят СКВОЗЬ друг друга (не толкаются) —
 * узкая полка не место для очередей.
 */

import { Container, Graphics, Text } from 'pixi.js';
import type { Sprite } from 'pixi.js';
import type { Cat } from '../game/index.js';
import { isBusy, growthScale, isAdult } from '../game/index.js';
import { breedName } from '../genetics/index.js';
import type { UiContext } from './context.js';
import type { FloorPlane, ShelfPlane } from './rooms/shell.js';
import { catSprite, aiSitSpriteFor, rarityGlow, GLOW_OUT, catSizeFactor } from './catTextures.js';
import { attachBlink, type Blinker } from './eyeBlink.js';
import { sfxMeow, sfxPurrSync } from './sound.js';
import { COLORS, FONT, label, stackWords, TIER_COLOR } from './theme.js';
import { t } from '../i18n.js';

type ActorState = 'walk' | 'idle' | 'sleep' | 'groom' | 'lookaround' | 'stretch'
  | 'crouch' | 'jump' | 'land';

/** Летящий кот: точки отрыва и приземления + высота дуги (см. startJump). */
interface Jump {
  fromOx: number; toOx: number;
  fromY: number; toY: number;
  fromS: number; toS: number;
  toZ: number;
  arc: number;   // насколько дуга выгибается над прямой «откуда → куда»
  up: boolean;
  t: number;
  dur: number;
}

interface Actor {
  cat: Cat;
  sig: string;             // слепок всего, что влияет на вид (см. viewSig) — для точечной пересборки
  view: Container;         // якорь на полу (позиция = точка контакта с землёй)
  body: Container;         // спрайт+ореол — только они «подпрыгивают» при ходьбе
  sprite: Sprite;
  glow: Sprite;              // светящийся ореол цвета редкости (под спрайтом)
  shadow: Graphics;          // тень/кружок под котиком — остаётся на полу
  baseScale: number;
  busy: boolean;
  adult: boolean;            // вырос ли (для подписи и эффекта взросления)
  ox: number;                // смещение от центра по X (пиксели на своей глубине)
  z: number;                 // глубина 0 (ближе) … 1 (дальше)
  targetOx: number;
  targetZ: number;
  facing: 1 | -1;
  phase: number;
  leapT: number;             // >0 — идёт редкий прыжок; счётчик оставшегося времени
  leapVX: number;            // горизонтальная скорость прыжка (px/с, со знаком)
  leapPending: boolean;      // в этом походе кот должен разок прыгнуть
  turnT: number;             // >0 — доигрывается приседание при развороте
  moodT: number;             // countdown до следующей проверки эмоции-пузырька
  blink: Blinker | null;     // процедурное моргание глаз (eyeBlink.ts)
  // Подпись над котом (имя + пол) и её габариты в локальных координатах актёра —
  // по ним в конце тика решается, не наехала ли она на подпись соседа (п. 1.10.3).
  caption: Container | null;
  capW: number;
  capY: number;
  zoneU: number;             // предпочитаемая нормированная позиция по X (-1..1)
  state: ActorState;
  stateLeft: number;         // сколько ещё длится текущее состояние
  stuckT: number;            // сколько подряд идущего кота толкают без продвижения — сдаётся и садится
  pushed: number;            // накопленный за этот тик толчок от соседей (для детекта затора)
  onShelf: boolean;          // стоит на настенной полке (своя опора: свой Y, масштаб, границы)
  wantShelf: boolean;        // идёт под полку, чтобы запрыгнуть
  shelfLeft: number;         // сколько ещё гостит наверху, с
  jump: Jump | null;         // не null — кот сейчас в воздухе
  infoIcon: Text | null; // значок ℹ️ над именем, пока изучаем инфо этого кота
}

interface GrowFx { view: Container; sparks: Text[]; ring: Graphics; life: number; ttl: number; }
interface MoodFx { view: Text; life: number; ttl: number; vy: number; }

const SPEED = 64;       // px/с по горизонтали (у ближнего края; вдали медленнее)
const Z_SPEED = 0.18;   // доля глубины в секунду (медленный дрейф «вглубь/наружу»)
const TURN_DUR = 0.14;  // с — длительность приседания при развороте
const TURN_SQUASH_Y = 0.05; // лёгкое приседание при развороте — не «блин»
const TURN_SQUASH_X = 0.09;
const STRETCH_DUR = 1.0; // с — длительность потягивания после сна (вдвое медленнее)
const STUCK_LIMIT = 0.8; // с — если идущего кота столько толкают и он не продвигается, он сдаётся и садится

// Редкий прыжок: изредка (раз за поход) кот делает один быстрый скачок на пару
// своих тел в сторону цели — с дугой в воздухе. Не серия, не «мячик».
const LEAP_LEN = 2;      // длина прыжка, в высотах кота (catH)
const LEAP_DUR = 0.34;   // с — длительность прыжка в воздухе
const JUMP_CHANCE = 0.3; // доля походов, в которых кот делает один прыжок

// Мягкие зоны пола: самцы тяготеют к левой трети, самки — к правой, котята — к
// центру. ZONE_JITTER — разброс вокруг предпочитаемой точки (треугольное
// распределение), ZONE_RANDOM_CHANCE — доля целей блуждания, выбираемых вовсе
// без привязки к зоне (толпа слегка перемешивается, а не делится жёстко пополам).
const ZONE_BIAS = 0.7;
const ZONE_JITTER = 0.32; // +15% — зона шире тянется к центру, меньше пустоты между группами
const ZONE_RANDOM_CHANCE = 0.2;

// Настенная полка: замах (кот приседает и виляет задом), полёт по дуге, посадка
// с амортизацией лап. Наверху кот гостит SHELF_STAY секунд и спрыгивает сам.
const CROUCH_DUR = 0.45;
const JUMP_UP_DUR = 0.5;
const JUMP_DOWN_DUR = 0.42;
const LAND_DUR = 0.22;
const SHELF_STAY_MIN = 22, SHELF_STAY_VAR = 40;
const SHELF_WISH = 0.2; // доля «походов», которые взрослый кот затевает ради полки

// Память поз котов между пересборками комнат (ресайз окна пересоздаёт «живой
// пол» целиком). Смещение по X храним нормированным (u = ox/maxOx ∈ [-1..1]),
// чтобы оно переносилось на другой размер комнаты. Без этого каждый ресайз
// рассыпал котов по новым случайным местам.
const posMemory = new Map<string, {
  u: number; z: number; facing: 1 | -1; phase: number; shelf?: boolean;
}>();

/** Подсадить позу кота в память пола извне: кот, вынутый из корзины заказов
 * перетаскиванием, приземляется в точке сброса, а не на прежнем месте. */
export function rememberFloorPos(catId: string, u: number, z: number): void {
  const mem = posMemory.get(catId);
  posMemory.set(catId, {
    u: Math.max(-1, Math.min(1, u)),
    z: Math.max(0, Math.min(1, z)),
    facing: mem?.facing ?? 1,
    phase: mem?.phase ?? Math.random() * 6,
    shelf: false,
  });
}

const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;

export interface ShelfOpts {
  plane: ShelfPlane;
  /** Слой для котов, стоящих НА полке. Комната кладёт его между декором и
   * кошачьим комплексом, чтобы кот на доске уходил ЗА стойки комплекса, а не
   * летел перед ними. Не задан — коты остаются в общем слое пола. */
  layer?: Container;
}

export function createLivingFloor(
  ctx: UiContext,
  layer: Container,
  plane: FloorPlane,
  getCats: () => Cat[],
  shelfOpts?: ShelfOpts,
): {
  refresh(): void;
  tick(dt: number): void;
  nodeOf(catId: string): Container | null;
  placeAt(catId: string, lx: number, ly: number, hold?: number): void;
} {
  let actors: Actor[] = [];
  const effects: GrowFx[] = [];
  const moodFx: MoodFx[] = [];
  // Занятые прямоугольники подписей за текущий кадр (см. конец tick). Массив
  // переиспользуется — это горячий путь, мусорить объектами каждый кадр незачем.
  const capBoxes: { x: number; y: number; halfW: number; halfH: number }[] = [];
  // Порядок разбора подписей: сначала передний план (больший Y на сцене) — его
  // подпись важнее, дальние уступают.
  const captionOrder = (list: Actor[]): Actor[] => [...list].sort((a, b) => b.view.y - a.view.y);
  const { centerX, yNear, yFar, nearHalfW, farHalfW, catH, farScale } = plane;
  const shelf = shelfOpts?.plane ?? null;
  const shelfLayer = shelfOpts?.layer ?? null;
  const shelfOx = shelf ? shelf.cx - centerX : 0; // центр доски в системе ox
  layer.sortableChildren = true; // ближние коты (больший Y) рисуются поверх дальних

  // геометрия глубины
  const yAt = (z: number): number => lerp(yNear, yFar, z);
  const depthScale = (z: number): number => lerp(1, farScale, z);
  // максимальное смещение по X на данной глубине (с отступом под полспрайта,
  // чтобы кот не «вылезал» на боковую стену)
  const maxOx = (z: number): number => {
    const pad = catH * 0.3 * depthScale(z);
    return Math.max(10, lerp(nearHalfW, farHalfW, z) - pad);
  };

  // --- опора кота: пол (по глубине z) или доска полки ---
  const groundY = (a: Actor): number => (a.onShelf && shelf ? shelf.y : yAt(a.z));
  const groundScale = (a: Actor): number => (a.onShelf && shelf ? shelf.scale : depthScale(a.z));
  const oxLo = (a: Actor): number => (a.onShelf && shelf ? shelfOx - shelf.walkHalf : -maxOx(a.z));
  const oxHi = (a: Actor): number => (a.onShelf && shelf ? shelfOx + shelf.walkHalf : maxOx(a.z));
  /** Экранный Y и масштаб С УЧЁТОМ полёта: в прыжке — точка на дуге. */
  const poseScale = (a: Actor): number =>
    (a.jump ? lerp(a.jump.fromS, a.jump.toS, Math.min(1, a.jump.t / a.jump.dur)) : groundScale(a));
  const poseY = (a: Actor): number => {
    const j = a.jump;
    if (!j) return groundY(a);
    const p = Math.min(1, j.t / j.dur);
    return lerp(j.fromY, j.toY, p) - j.arc * 4 * p * (1 - p);
  };
  /** Слой, в котором должен жить кот: на полке — за кошачьим комплексом. */
  const hostOf = (a: Actor): Container => (a.onShelf && shelfLayer ? shelfLayer : layer);
  /** Занято мест на полке (стоящие наверху + идущие туда). */
  const shelfLoad = (): number => actors.reduce((n, a) => n + (a.onShelf || a.wantShelf ? 1 : 0), 0);
  /** Есть ли наверху место для ЭТОГО кота (своё уже занятое место не считаем). */
  const shelfHasRoom = (a: Actor): boolean =>
    !!shelf && shelfLoad() - (a.onShelf || a.wantShelf ? 1 : 0) < shelf.capacity;
  /** Кот стоит на полу ровно под доской — отсюда можно прыгать. */
  const underShelf = (a: Actor): boolean =>
    !!shelf && a.z > 0.72 && a.ox > shelfOx - shelf.walkHalf + 6 && a.ox < shelfOx + shelf.walkHalf - 6;
  /**
   * Точка остановки на доске. Отсеиваем две неудачи (проходить через них можно,
   * просто не встаём там насовсем):
   *   — за кошачьим комплексом кота не видно вообще, а уснуть он может на минуту;
   *   — вплотную к соседу: расталкивания на полке нет, и два кота слились бы в
   *     одну кашу. Место выбираем «с оглядкой», а не толкаемся.
   */
  function pickShelfOx(self: Actor, spread = 1): number {
    const lo = shelfOx - shelf!.walkHalf * spread, hi = shelfOx + shelf!.walkHalf * spread;
    const bLo = shelf!.blindFrom - centerX, bHi = shelf!.blindTo - centerX;
    const gap = catH * shelf!.scale * 0.5;
    const bad = (ox: number): boolean => (ox > bLo && ox < bHi)
      || actors.some((b) => b !== self && b.onShelf && !b.jump && Math.abs(b.ox - ox) < gap);
    let ox = lerp(lo, hi, Math.random());
    for (let i = 0; i < 6 && bad(ox); i++) ox = lerp(lo, hi, Math.random());
    return ox;
  }

  function enterState(a: Actor, state: ActorState, dur: number): void {
    a.state = state;
    a.stateLeft = dur;
  }

  const actorOf = (catId: string): Actor | null => {
    const a = actors.find((x) => x.cat.id === catId);
    return a && !a.view.destroyed ? a : null;
  };

  /**
   * Спрятать/показать кота на полу (пока он «в руках», его рисует dragLayer).
   * Ищем актёра по id, а не держим ссылку на его view: пол могли пересобрать,
   * пока кота несли, — старый контейнер уже уничтожен, и show() ушёл бы в пустоту.
   */
  function setHidden(catId: string, hidden: boolean): void {
    const a = actorOf(catId);
    if (a) a.view.visible = !hidden;
  }

  /**
   * Поставить кота в точку слоя пола (локальные координаты) и задержать его там
   * на hold секунд. Нужно станциям комнаты (ветеринар, криокапсула, лаборатория,
   * пристройство): после диалога кот остаётся у станции, куда его принесли, а не
   * возвращается на прежнее место через полкомнаты.
   */
  function placeAt(catId: string, lx: number, ly: number, hold = 10): void {
    const nz = Math.max(0, Math.min(1, (yNear - ly) / Math.max(1, yNear - yFar)));
    const m = maxOx(nz);
    const ox = Math.max(-m, Math.min(m, lx - centerX));
    rememberFloorPos(catId, ox / m, nz); // переживёт пересборку пола (ресайз/реклама)
    const a = actorOf(catId);
    if (!a) return;
    a.ox = ox; a.targetOx = ox;
    a.z = nz; a.targetZ = nz;
    a.leapT = 0;
    leaveShelf(a);
    a.view.position.set(centerX + ox, yAt(nz));
    a.view.scale.set(growthScale(a.cat, ctx.now()) * depthScale(nz));
    a.view.zIndex = Math.round(yAt(nz));
    enterState(a, 'idle', hold); // постоит у станции, потом сам пойдёт гулять
  }

  /** Снять кота с полки «мгновенно» (его унесли в руках / поставили у станции). */
  function leaveShelf(a: Actor): void {
    a.jump = null;
    a.wantShelf = false;
    if (!a.onShelf) return;
    a.onShelf = false;
    layer.addChild(a.view);
  }

  /**
   * Поставить кота на доску полки (игрок сам уронил его туда перетаскиванием).
   * Возвращает false, если точка мимо доски или наверху уже тесно.
   */
  function dropOnShelf(a: Actor, lx: number, ly: number): boolean {
    if (!shelf) return false;
    const ox = lx - centerX;
    const catTop = shelf.y - catH * shelf.scale * 1.5;
    if (ly < catTop || ly > shelf.y + shelf.thick * 2.5) return false;
    if (ox < shelfOx - shelf.walkHalf || ox > shelfOx + shelf.walkHalf) return false;
    if (!a.onShelf && shelfLoad() >= shelf.capacity + 1) return false; // совсем впритык не пускаем
    a.jump = null;
    a.wantShelf = false;
    a.onShelf = true;
    a.ox = ox; a.targetOx = ox;
    a.shelfLeft = SHELF_STAY_MIN + Math.random() * SHELF_STAY_VAR;
    (shelfLayer ?? layer).addChild(a.view);
    a.view.position.set(centerX + ox, shelf.y);
    a.view.scale.set(growthScale(a.cat, ctx.now()) * shelf.scale);
    enterState(a, 'land', LAND_DUR);
    return true;
  }

  /** Новая цель блуждания: с вероятностью 80% — вокруг «своей» зоны (мягко,
   * треугольный разброс), иначе — где угодно на полу (перемешивание толпы). */
  function startWalk(a: Actor): void {
    // на доске гуляем только вдоль неё, в её границах и без прыжков «в походе»
    if (a.onShelf && shelf) {
      a.targetOx = pickShelfOx(a);
      a.targetZ = a.z;
      a.leapT = 0;
      a.leapPending = false;
      enterState(a, 'walk', 5 + Math.random() * 2);
      return;
    }
    // собрался на полку — идём под доску, к самой стене
    if (a.wantShelf && shelf) {
      a.targetZ = 0.86 + Math.random() * 0.14;
      a.targetOx = pickShelfOx(a, 0.8);
      a.leapT = 0;
      a.leapPending = false;
      enterState(a, 'walk', 7 + Math.random() * 3);
      return;
    }
    const nz = Math.random();
    const m = maxOx(nz);
    let u: number;
    if (Math.random() < 1 - ZONE_RANDOM_CHANCE) {
      u = a.zoneU + (Math.random() + Math.random() - 1) * ZONE_JITTER;
      u = Math.max(-1, Math.min(1, u));
    } else {
      u = Math.random() * 2 - 1;
    }
    a.targetZ = nz;
    a.targetOx = u * m;
    a.leapT = 0;
    a.leapPending = Math.random() < JUMP_CHANCE; // может, разок прыгнет по дороге
    enterState(a, 'walk', 5 + Math.random() * 2); // страховка на случай недостижимой цели
  }

  /** После ходьбы коты в основном отдыхают (сон чаще всего), а не бродят без пауз. */
  function pickNextState(a: Actor): void {
    // дошёл под доску — замах и прыжок наверх (не дошёл/место заняли — передумал).
    // Флаг держим до самого отрыва: пока кот целится, место наверху за ним.
    if (a.wantShelf && !a.onShelf) {
      if (underShelf(a) && shelfHasRoom(a)) { enterState(a, 'crouch', CROUCH_DUR); return; }
      a.wantShelf = false;
    }
    // отгостил наверху — тем же замахом спрыгивает обратно на пол
    if (a.onShelf && a.shelfLeft <= 0) { enterState(a, 'crouch', CROUCH_DUR); return; }

    if (a.state === 'walk') {
      const r = Math.random();
      if (r < 0.5) {
        enterState(a, 'sleep', 10 + Math.random() * 20); // дремлют подолгу, 10–30 с
        spawnMoodFx(centerX + a.ox, poseY(a) - catH * groundScale(a) * 0.9, 'Zz..'); // сразу как заснул
      }
      else if (r < 0.7) enterState(a, 'groom', 1.6 + Math.random() * 1.8);
      else if (r < 0.88) enterState(a, 'lookaround', 1.3 + Math.random() * 1.5);
      else enterState(a, 'idle', 0.7 + Math.random() * 1.1);
    } else if (a.state === 'sleep') {
      enterState(a, 'stretch', STRETCH_DUR); // потягивание перед тем, как встать
    } else {
      // на полу иногда затеваем поход ради полки (котята туда не запрыгивают)
      if (shelf && !a.onShelf && a.adult && Math.random() < SHELF_WISH && shelfHasRoom(a)) a.wantShelf = true;
      startWalk(a);
    }
  }

  /**
   * Отрыв от опоры: с пола на доску (up) или обратно. Летим по параболе с
   * перелётом над целью — прыжок читается как настоящий, а не как подъём по
   * прямой. «На полке» кот числится уже с момента отрыва: так место наверху не
   * занимает второй кот, пока первый в воздухе.
   */
  function startJump(a: Actor, up: boolean): void {
    if (!shelf) { startWalk(a); return; }
    const fromY = poseY(a), fromS = groundScale(a);
    let toOx: number, toY: number, toS: number, toZ = a.z;
    if (up) {
      const lo = shelfOx - shelf.walkHalf, hi = shelfOx + shelf.walkHalf;
      toOx = Math.max(lo, Math.min(hi, a.ox + (Math.random() * 2 - 1) * shelf.walkHalf * 0.2));
      toY = shelf.y;
      toS = shelf.scale;
    } else {
      toZ = 0.82 + Math.random() * 0.18;
      const m = maxOx(toZ);
      toOx = Math.max(-m, Math.min(m, a.ox + (Math.random() * 2 - 1) * catH * 0.6));
      toY = yAt(toZ);
      toS = depthScale(toZ);
    }
    a.jump = {
      fromOx: a.ox, toOx, fromY, toY, fromS, toS, toZ, up,
      arc: Math.max(0, fromY - toY) * 0.5 + catH * fromS * 0.32,
      t: 0, dur: up ? JUMP_UP_DUR : JUMP_DOWN_DUR,
    };
    if (Math.abs(toOx - a.ox) > 4) a.facing = (Math.sign(toOx - a.ox) || 1) as 1 | -1;
    a.wantShelf = false;
    a.onShelf = up;
    hostOf(a).addChild(a.view); // сменить слой на отрыве: за комплексом / перед ним
    enterState(a, 'jump', a.jump.dur + 0.2);
  }

  /** Касание лап: закрепляем новую опору и пружиним (состояние 'land'). */
  function landJump(a: Actor): void {
    const j = a.jump;
    if (!j) return;
    a.jump = null;
    a.ox = j.toOx; a.targetOx = j.toOx;
    a.z = j.toZ; a.targetZ = j.toZ;
    a.stuckT = 0;
    if (a.onShelf) a.shelfLeft = SHELF_STAY_MIN + Math.random() * SHELF_STAY_VAR;
    enterState(a, 'land', LAND_DUR);
  }

  /** Реакция на руки игрока (тап/взятие): «❓» над головой, спящий просыпается
   * сразу — без потягивания (оно только после сна «по своей воле») — и секунд
   * 5–8 стоит на месте, приходя в себя. Мурчание погаснет само на сверке тика. */
  function poke(a: Actor): void {
    spawnMoodFx(centerX + a.ox, poseY(a) - catH * poseScale(a) * 0.9, '❓');
    if (!a.busy && !a.jump) enterState(a, 'idle', 5 + Math.random() * 3);
  }

  /**
   * Всё, из чего собран вид кота на полу: занятость, взрослость, выбор для вязки,
   * бейдж «новый», подпись. Совпали слепки — значит пересобирать актёра незачем,
   * можно оставить готового (см. refresh). Иначе любое действие игрока
   * пересоздавало бы всю толпу: спрайт, ореол, тень и по два Text на кота.
   */
  function viewSig(cat: Cat): string {
    return [
      isBusy(ctx.state, cat.id) ? 1 : 0,
      isAdult(cat, ctx.now()) ? 1 : 0,
      ctx.selection.includes(cat.id) ? 1 : 0,
      cat.isNew ? 1 : 0,
      cat.name ?? '',
      cat.rarityTier,
    ].join('|');
  }

  function makeActor(cat: Cat, prev?: Actor): Actor {
    const busy = isBusy(ctx.state, cat.id);
    const adult = isAdult(cat, ctx.now());
    const selected = ctx.selection.includes(cat.id);
    const view = new Container();

    // тень/кружок под котиком (+ подсветка выбора для вязки) — остаётся на полу,
    // не подпрыгивает вместе с котом (см. body ниже). Приподнята на 2/3 своей
    // толщины (полная высота главной тени = 2×8=16 → ≈10.7px), чтобы лежать ПОД
    // котом, а не «перед» ним (иначе кажется оторванной у лап).
    const sizeF = catSizeFactor(cat); // самцы и крупные породы (🐘) по +10% — сам спрайт, тень и подписи
    const shUp = (2 * 8) * (2 / 3);
    const shadow = new Graphics();
    if (selected) shadow.ellipse(0, -4 - shUp, catH * 0.42 * sizeF, 12).fill({ color: COLORS.primary, alpha: 0.55 });
    shadow.ellipse(0, -2 - shUp, catH * 0.34 * sizeF, 8).fill({ color: 0x000000, alpha: 0.12 });
    view.addChild(shadow);

    const body = new Container();
    const aiSprite = aiSitSpriteFor(cat, catH);
    const sprite = aiSprite ?? catSprite(ctx.app, cat, catH);
    if (busy) sprite.alpha = 0.55;
    // ореол редкости — под спрайтом, чтобы наружу выходила лишь цветная кромка
    const glow = rarityGlow(ctx.app, sprite, cat.rarityTier, catH);
    if (busy) glow.alpha *= 0.5;
    body.addChild(glow, sprite);
    view.addChild(body);
    const baseScale = sprite.scale.x;

    // процедурное моргание для всех пород с готовым артом: глаза берутся из ручной
    // разметки eyes.json по ключу спрайта, иначе автодетект по пикселям (eyeBlink.ts).
    const blink = aiSprite ? attachBlink(ctx.app, sprite) : null;

    // подпись над котиком: имя (или порода по умолчанию, пока имя не задано) + значок пола,
    // цветом редкости с белой обводкой. Имя крупнее (1.5×), значок пола — крупнее (2×),
    // поэтому это отдельные Text в общем контейнере. У котят подписи нет — имя и пол
    // проявляются только когда котёнок вырастет.
    let caption: Container | null = null;
    let capW = 0;
    let capY = 0;
    if (adult) {
      const tierCol = TIER_COLOR[cat.rarityTier];
      const sexGlyph = cat.genotype.sex === 'female' ? '♀' : '♂';
      const display = stackWords(cat.name?.trim() || breedName(cat.breed));
      const mk = (text: string, size: number): Text => new Text({
        text,
        style: {
          fontFamily: FONT, fontSize: size, fontWeight: '800', align: 'center',
          fill: tierCol, stroke: { color: 0xffffff, width: 3 },
        },
      });
      const nameT = mk(display, 20);  // 13 × 1.5
      const sexT = mk(sexGlyph, 26);  // 13 × 2
      nameT.anchor.set(0, 0.5);
      sexT.anchor.set(0, 0.5);
      const gap = 5;
      const totalW = nameT.width + gap + sexT.width;
      const cap = new Container();
      nameT.position.set(-totalW / 2, 0);
      sexT.position.set(-totalW / 2 + nameT.width + gap, 0);
      cap.addChild(nameT, sexT);
      capY = -(catH * sizeF + 16);
      cap.position.set(0, capY);
      view.addChild(cap);
      caption = cap;
      capW = totalW;
    }

    if (selected) {
      const paw = label('🐾', 18, 0xffffff, '700');
      paw.position.set(0, -catH * 0.95 * sizeF);
      view.addChild(paw);
    }
    if (busy) {
      const z = label('💤', 18, COLORS.ink, '700');
      z.position.set(catH * 0.34 * sizeF, -catH * 0.92 * sizeF);
      view.addChild(z);
    }

    // Бейдж «новый» над именем: висит у только что купленного кота, пока его не
    // изучат — первое открытие инфо-меню снимает cat.isNew (см. game.openCatMenu),
    // а пересборка пола в commit() убирает бейдж. Ставит флаг только покупка (buyCat).
    if (cat.isNew) {
      const txt = label(t('✨ новый', '✨ new'), 13, 0xffffff, '800', { color: 0x8a2b26, width: 3 });
      const pw = txt.width + 16, ph = txt.height + 5;
      const pill = new Graphics();
      pill.roundRect(-pw / 2, -ph / 2, pw, ph, ph / 2)
        .fill({ color: 0xe8564f }).stroke({ width: 2, color: 0xffffff });
      const badge = new Container();
      badge.addChild(pill, txt);
      badge.position.set(0, -(catH * sizeF + (adult ? 46 : 20)));
      view.addChild(badge);
    }

    const mem = posMemory.get(cat.id);
    // поза переживает и пересборку актёра (сменилась подпись/занятость), и
    // пересборку всей комнаты при ресайзе (posMemory) — включая «стоит на полке»
    const onShelf = !!shelf && (prev?.onShelf ?? mem?.shelf ?? false);
    const z = prev?.z ?? mem?.z ?? Math.random();
    const span = onShelf ? shelf!.walkHalf : maxOx(z);
    const u = mem ? mem.u : Math.random() * 2 - 1;
    const ox = prev?.ox ?? ((onShelf ? shelfOx : 0) + u * span);
    const gy = onShelf ? shelf!.y : yAt(z);
    view.position.set(centerX + ox, gy);
    view.scale.set(growthScale(cat, ctx.now()) * (onShelf ? shelf!.scale : depthScale(z))); // котёнок мал + перспектива
    view.zIndex = Math.round(gy);
    view.eventMode = 'static';
    view.cursor = busy ? 'pointer' : 'grab';

    // зона предпочтения по полу: самцы — левая треть, самки — правая, котята — центр
    const zoneU = !adult ? 0 : (cat.genotype.sex === 'male' ? -ZONE_BIAS : ZONE_BIAS);

    const actor: Actor = {
      cat, sig: viewSig(cat), view, body, sprite, glow, shadow, baseScale, busy, adult,
      ox, z, targetOx: ox, targetZ: z, facing: prev?.facing ?? mem?.facing ?? 1,
      phase: prev?.phase ?? mem?.phase ?? Math.random() * 6,
      leapT: 0, leapVX: 0, leapPending: false, turnT: 0, moodT: 2 + Math.random() * 6, blink, zoneU,
      caption, capW, capY,
      state: 'idle', stateLeft: Math.random() * 3, // стартовая рассинхронизация, чтобы не все разом пошли бродить
      stuckT: 0, pushed: 0,
      onShelf, wantShelf: false, jump: null,
      shelfLeft: prev?.shelfLeft ?? SHELF_STAY_MIN + Math.random() * SHELF_STAY_VAR,
      infoIcon: null,
    };

    if (busy) {
      view.on('pointertap', () => { sfxMeow(); poke(actor); ctx.openCatMenu(cat); });
    } else {
      view.on('pointerdown', (e) => { poke(actor); ctx.startGrab({
        cat,
        // «на весу» кот того же размера, что и на полу/полке (с учётом роста и глубины)
        displayH: catH * growthScale(cat, ctx.now()) * groundScale(actor),
        hide: () => setHidden(cat.id, true),
        show: () => setHidden(cat.id, false),
        onTap: () => ctx.openCatMenu(cat),
        onDrop: (gx, gy) => {
          // пол могли пересобрать, пока кота несли — берём актуального актёра по id
          const a = actorOf(cat.id);
          if (!a) return;
          // gx/gy — координаты виртуальной сцены (uiRoot) → в систему слоя пола
          const lp = layer.toLocal({ x: gx, y: gy ?? 0 }, ctx.uiRoot);
          if (gy === undefined) lp.y = groundY(a);
          // уронили прямо на доску полки — кот остаётся там (если наверху не тесно)
          if (gy !== undefined && dropOnShelf(a, lp.x, lp.y)) return;
          leaveShelf(a);
          // глубина из точки сброса по Y (вне диапазона — прижимаем к краю)
          const nz = Math.max(0, Math.min(1, (yNear - lp.y) / Math.max(1, yNear - yFar)));
          const m = maxOx(nz);
          a.z = nz;
          a.ox = Math.max(-m, Math.min(m, lp.x - centerX));
          a.targetZ = nz;
          a.targetOx = a.ox;
          a.view.scale.set(growthScale(cat, ctx.now()) * depthScale(nz));
          a.view.position.set(centerX + a.ox, yAt(nz));
          a.view.zIndex = Math.round(yAt(nz));
        },
      }, e); });
    }
    return actor;
  }

  /** Праздничный «пых» в момент взросления котёнка: кольцо + разлетающиеся искорки. */
  function spawnGrowFx(x: number, y: number): void {
    const c = new Container();
    c.position.set(x, y);
    c.zIndex = 1e6; // искорки поверх всех котов
    const ring = new Graphics();
    c.addChild(ring);
    const sparks: Text[] = [];
    for (let i = 0; i < 9; i++) {
      const s = label(Math.random() < 0.5 ? '✨' : '⭐', 13 + Math.random() * 9, 0xffd86b, '700');
      s.anchor.set(0.5);
      sparks.push(s);
      c.addChild(s);
    }
    layer.addChild(c);
    effects.push({ view: c, sparks, ring, life: 0, ttl: 1.0 });
  }

  /** Эмоция-пузырёк над котом: одиночный эмодзи всплывает и гаснет. */
  function spawnMoodFx(x: number, y: number, emoji: string): void {
    const t = label(emoji, 20, 0xffffff, '700', { color: 0x000000, width: 2 });
    t.position.set(x, y);
    t.zIndex = 1e6;
    layer.addChild(t);
    moodFx.push({ view: t, life: 0, ttl: 1.3, vy: -18 - Math.random() * 10 });
  }

  function refresh(): void {
    const prev = new Map(actors.map((a) => [a.cat.id, a]));
    const cats = getCats();
    const keep = new Set(cats.map((c) => c.id));
    for (const a of actors) if (!keep.has(a.cat.id)) a.view.destroy({ children: true });
    // Скрыт на полу ровно один кот — тот, что сейчас «в руках» (его рисует
    // dragLayer). Сверяем это на каждой пересборке: иначе переиспользованный
    // актёр (см. ниже) навсегда оставался бы невидимым после дропа на станцию —
    // кот числится в комнате, а на полу его нет.
    const held = ctx.carrying()?.cat.id ?? null;
    actors = cats.map((cat) => {
      const p = prev.get(cat.id);
      // вид кота не изменился — оставляем готового актёра со всей его анимацией
      if (p && p.sig === viewSig(cat)) { p.cat = cat; p.view.visible = cat.id !== held; return p; }
      if (p) p.view.destroy({ children: true }); // выбор/занятость/подпись изменились — пересобираем
      const a = makeActor(cat, p);
      a.view.visible = cat.id !== held;
      hostOf(a).addChild(a.view);
      return a;
    });
  }

  function tick(dt: number): void {
    const now = ctx.now();
    const focus = ctx.infoFocus();
    const matured: Actor[] = [];
    const sleepy: string[] = []; // кто мурчит во сне — сверка хора в конце тика
    for (const a of actors) {
      a.phase += dt;
      a.blink?.setSleep(a.state === 'sleep'); // дремлет → веки медленно опускаются
      a.blink?.update(dt);                    // моргание глаз
      let ds = poseScale(a); // масштаб на текущей опоре (в полёте — на дуге)
      a.view.scale.set(growthScale(a.cat, now) * ds); // котята подрастают + перспектива
      a.view.zIndex = Math.round(poseY(a));
      // запоминаем позу — переживает пересборку комнаты при ресайзе окна
      posMemory.set(a.cat.id, {
        u: (a.ox - (a.onShelf ? shelfOx : 0)) / Math.max(1, a.onShelf && shelf ? shelf.walkHalf : maxOx(a.z)),
        z: a.z, facing: a.facing, phase: a.phase, shelf: a.onShelf,
      });
      // момент взросления: эффект + пересборка актёра (появятся имя/пол над головой)
      if (!a.adult && isAdult(a.cat, now)) {
        a.adult = true;
        spawnGrowFx(centerX + a.ox, poseY(a) - catH * 0.55 * ds);
        matured.push(a);
      }

      // значок ℹ️ над именем: изучаем инфо этого кота — держим значок, пока
      // меню открыто, и ещё 3 сек после закрытия, чтобы не потерять его в толпе
      const focused = focus?.id === a.cat.id;
      const showIcon = focused && Date.now() < focus!.iconUntil;
      if (showIcon && !a.infoIcon) {
        const icon = label('ℹ️', 22, COLORS.ink, '800');
        icon.position.set(0, -(catH + 40));
        a.view.addChild(icon);
        a.infoIcon = icon;
      } else if (!showIcon && a.infoIcon) {
        a.infoIcon.destroy();
        a.infoIcon = null;
      }

      // спящий видимый кот тихо мурчит (взятый за шкирку — visible=false — молчит)
      if (a.state === 'sleep' && a.view.visible) sleepy.push(a.cat.id);

      // «Заморозка» кота с открытым инфо-меню не касается летящего: иначе тапнутый
      // в прыжке кот повис бы в воздухе до закрытия меню.
      if (a.busy || !a.view.visible || (focused && focus!.frozen && !a.jump)) continue;

      a.turnT = Math.max(0, a.turnT - dt);
      a.moodT -= dt;
      a.stateLeft -= dt;
      if (a.onShelf && !a.jump) a.shelfLeft -= dt; // отсчёт «гостевания» наверху

      // --- машина состояний: движение только в 'walk', иначе стоим на месте ---
      let movingX = false, movingZ = false;
      if (a.state === 'jump') {
        // полёт: по X — по прямой, дугу по Y рисует poseY (парабола)
        const j = a.jump!;
        j.t += dt;
        const p = Math.min(1, j.t / j.dur);
        a.ox = lerp(j.fromOx, j.toOx, p);
        if (p >= 1) landJump(a);
      } else if (a.state === 'walk') {
        const dz = a.targetZ - a.z;
        movingZ = Math.abs(dz) > 0.01;
        if (movingZ) a.z += Math.sign(dz) * Math.min(Math.abs(dz), Z_SPEED * dt);
        const dsz = groundScale(a);
        const dox = a.targetOx - a.ox;
        movingX = Math.abs(dox) > 3;
        if (a.leapT > 0) {
          // идёт прыжок — летим по инерции скачка, обычный шаг не считаем
          a.leapT -= dt;
          a.ox += a.leapVX * dt;
        } else if (movingX) {
          const newFacing = (Math.sign(dox) || 1) as 1 | -1;
          if (newFacing !== a.facing) { a.facing = newFacing; a.turnT = TURN_DUR; }
          if (a.leapPending && Math.abs(dox) > LEAP_LEN * catH * dsz * 0.5) {
            // старт редкого прыжка на пару тел в сторону цели
            a.leapPending = false;
            a.leapT = LEAP_DUR;
            a.leapVX = a.facing * (LEAP_LEN * catH * dsz) / LEAP_DUR;
            a.ox += a.leapVX * dt;
          } else {
            // обычный шаг — постоянная скорость, без разгона
            a.ox += a.facing * Math.min(Math.abs(dox), SPEED * dsz * dt);
          }
        }
        a.ox = Math.max(oxLo(a), Math.min(oxHi(a), a.ox));
        if (a.leapT <= 0 && ((!movingX && !movingZ) || a.stateLeft <= 0)) pickNextState(a);
      } else if (a.stateLeft <= 0) {
        // замах кончился — отрыв: с пола на доску, с доски на пол
        if (a.state === 'crouch') startJump(a, !a.onShelf);
        else pickNextState(a);
      }

      // --- поза по текущему состоянию ---
      const turnDip = a.turnT > 0 ? Math.sin((1 - a.turnT / TURN_DUR) * Math.PI) : 0;
      let sx = 1, sy = 1, rot = 0, bodyLift = 0, hop = 0;
      switch (a.state) {
        case 'walk': {
          if (a.leapT > 0) {
            // сам прыжок: дуга вверх-вниз + вытягивание тела в полёте
            const p = 1 - Math.max(0, a.leapT) / LEAP_DUR; // 0 → 1
            const arc = Math.sin(p * Math.PI);             // 0 → 1 → 0
            hop = arc;
            bodyLift = arc * catH * 0.2;
            sy = (1 - arc * 0.08) * (1 - turnDip * TURN_SQUASH_Y);
            sx = (1 + arc * 0.12) * (1 - turnDip * TURN_SQUASH_X);
            rot = a.facing * 0.05 * arc;
          } else {
            // обычная ходьба: лёгкий постоянный подскок при движении, без разгона
            const moving = movingX || movingZ;
            hop = moving ? Math.abs(Math.sin(a.phase * 7)) : 0;
            const squash = 1 + (hop - 0.5) * 0.1; // в воздухе тянется, на земле приплюснут
            sy = squash * (1 - turnDip * TURN_SQUASH_Y);
            sx = (1 / squash) * (1 - turnDip * TURN_SQUASH_X); // лёгкое приседание при развороте
            rot = a.facing * 0.05 * (moving ? 1 : 0);
            bodyLift = hop * catH * 0.07;
          }
          break;
        }
        case 'sleep': {
          const breathe = 1 + Math.sin(a.phase * 0.8) * 0.015; // медленное дыхание во сне
          sy = 0.96 * breathe; // едва осел, а не «блин»
          sx = 1.02;
          break;
        }
        case 'groom': {
          sy = 1 + Math.sin(a.phase * 2) * 0.02;
          rot = Math.sin(a.phase * 7) * 0.09; // быстрое умывание — покачивание
          break;
        }
        case 'lookaround': {
          const flipIdx = Math.floor(a.phase / 0.6);
          const newFacing = (flipIdx % 2 === 0 ? 1 : -1) as 1 | -1;
          if (newFacing !== a.facing) { a.facing = newFacing; a.turnT = TURN_DUR; }
          sy = (1 + Math.sin(a.phase * 2) * 0.02) * (1 - turnDip * TURN_SQUASH_Y);
          sx = 1 - turnDip * TURN_SQUASH_X;
          break;
        }
        case 'stretch': {
          const t = 1 - Math.max(0, Math.min(1, a.stateLeft / STRETCH_DUR));
          const curve = Math.sin(t * Math.PI); // 0 → 1 → 0
          sy = 1 + curve * 0.3;
          sx = 1 - curve * 0.2;
          break;
        }
        case 'crouch': {
          // замах перед прыжком: приседает и мелко виляет — как настоящий кот,
          // прицеливающийся на полку
          const t = 1 - Math.max(0, a.stateLeft) / CROUCH_DUR; // 0 → 1
          const dip = Math.min(1, t * 2.4);
          const wig = Math.sin(t * Math.PI * 7) * 0.035 * dip;
          sy = 1 - 0.18 * dip + wig;
          sx = 1 + 0.14 * dip - wig;
          break;
        }
        case 'jump': {
          // в полёте кот вытягивается «свечкой» и чуть кренится по ходу движения
          const j = a.jump;
          const air = j ? Math.sin(Math.min(1, j.t / j.dur) * Math.PI) : 0;
          sy = 1 + 0.16 * air;
          sx = 1 - 0.1 * air;
          rot = a.facing * 0.1 * air;
          break;
        }
        case 'land': {
          // амортизация лап: спружинил и выпрямился
          const k = Math.max(0, a.stateLeft) / LAND_DUR; // 1 → 0
          sy = 1 - 0.18 * k;
          sx = 1 + 0.14 * k;
          break;
        }
        default: // 'idle' — просто дышим
          sy = 1 + Math.sin(a.phase * 2) * 0.02;
      }

      const sp = a.sprite;
      sp.scale.x = a.baseScale * a.facing * sx;
      sp.scale.y = a.baseScale * sy;
      sp.rotation += (rot - sp.rotation) * Math.min(1, dt * 8);
      // ореол повторяет позу кота (разворот/сквош/наклон)
      a.glow.scale.set(sp.scale.x * GLOW_OUT, sp.scale.y * GLOW_OUT);
      a.glow.rotation = sp.rotation;
      // тень остаётся на полу — только «прижимается» при подскоке, не летает вместе с котом
      a.shadow.scale.set(1 - hop * 0.15);
      a.shadow.visible = !a.jump; // оторвался от опоры — тень под лапами гасим
      a.body.y = -bodyLift;

      // опора могла смениться прямо в этом кадре (взлёт/посадка) — пересчитываем
      ds = poseScale(a);
      const vy = poseY(a);
      a.view.scale.set(growthScale(a.cat, now) * ds);
      a.view.x = centerX + a.ox;
      a.view.y = vy;
      a.view.zIndex = Math.round(vy);

      // эмоция-пузырёк: редкая, чаще привязана к текущему занятию
      if (a.moodT <= 0) {
        a.moodT = 5 + Math.random() * 9;
        let emoji: string | null = null;
        if (a.state === 'sleep' && Math.random() < 0.5) emoji = 'Zz..';
        else if (a.state === 'groom' && Math.random() < 0.5) emoji = '🧶';
        // «❓» больше не случайный — он теперь реакция на тап игрока (см. poke)
        else if (a.state !== 'sleep' && Math.random() < 0.35) emoji = Math.random() < 0.5 ? '❤️' : '🐟';
        if (emoji) spawnMoodFx(centerX + a.ox, vy - catH * ds * 0.9, emoji);
      }
    }

    // Расталкивание: толкается только ИДУЩИЙ кот — отдыхающий (сон/умывание/
    // оглядывание/потягивание/стоит) остаётся неподвижным препятствием. Иначе
    // сидячие коты «ползут» по сцене, а те, что уже устроились у стены, откуда
    // толкать больше некуда, со временем выдавливаются к центру. Отдельным
    // проходом — зоны задают лишь НАМЕРЕНИЕ цели блуждания, а не жёсткую позицию.
    // Коты на полке (и все, кто в воздухе) в расталкивании не участвуют вовсе:
    // на узкой доске они ходят СКВОЗЬ друг друга, а не устраивают затор.
    for (const a of actors) a.pushed = 0;
    for (let i = 0; i < actors.length; i++) {
      const a = actors[i]!;
      if (a.busy || !a.view.visible || a.onShelf || a.jump
        || (focus?.id === a.cat.id && focus.frozen)) continue;
      for (let j = i + 1; j < actors.length; j++) {
        const b = actors[j]!;
        if (b.busy || !b.view.visible || b.onShelf || b.jump
          || (focus?.id === b.cat.id && focus.frozen)) continue;
        if (Math.abs(a.z - b.z) > 0.12) continue; // разная глубина — визуально не пересекаются
        const aWalk = a.state === 'walk', bWalk = b.state === 'walk';
        if (!aWalk && !bWalk) continue; // оба стоят/спят — не толкаемся
        const dx = a.ox - b.ox;
        const dist = Math.abs(dx);
        const minDist = catH * 0.48 * depthScale((a.z + b.z) / 2);
        if (dist >= minDist) continue;
        const sign = dist > 0.001 ? Math.sign(dx) : (Math.random() < 0.5 ? 1 : -1);
        const overlap = minDist - dist;
        if (aWalk && bWalk) {
          const push = overlap * 0.5 * sign;
          a.ox += push; a.pushed += Math.abs(push);
          b.ox -= push; b.pushed += Math.abs(push);
        } else if (aWalk) {
          a.ox += overlap * sign; a.pushed += overlap;
        } else {
          b.ox -= overlap * sign; b.pushed += overlap;
        }
      }
    }
    for (const a of actors) {
      if (a.busy || !a.view.visible || a.jump) continue;
      a.ox = Math.max(oxLo(a), Math.min(oxHi(a), a.ox));
      a.view.x = centerX + a.ox;
      // застрял в толчее и не может пройти — не пихается бесконечно, сдаётся и садится
      if (a.state === 'walk' && a.pushed > 1.5) a.stuckT += dt; else a.stuckT = Math.max(0, a.stuckT - dt * 2);
      if (a.stuckT > STUCK_LIMIT) { a.stuckT = 0; pickNextState(a); }
    }

    // Подписи, наехавшие друг на друга, гасим (п. 1.10.3 — «элементы и тексты не
    // накладываются»). В полном приюте имена сливались в кашу, особенно на английском,
    // где названия пород длиннее. Приоритет у ближних котов: идём от переднего плана
    // вглубь и оставляем подпись, только если её прямоугольник свободен. Гасим и
    // возвращаем плавно — иначе на каждом шаге бредущего кота подписи мигали бы.
    capBoxes.length = 0;
    for (const a of captionOrder(actors)) {
      const cap = a.caption;
      if (!cap) continue;
      const sx = Math.abs(a.view.scale.x);
      const sy = a.view.scale.y;
      const halfW = (a.capW * sx) / 2 + 3;
      const cx = a.view.x;
      const cy = a.view.y + a.capY * sy;
      const halfH = 15 * sy;
      let free = a.view.visible;
      if (free) {
        for (const b of capBoxes) {
          if (Math.abs(cx - b.x) < halfW + b.halfW && Math.abs(cy - b.y) < halfH + b.halfH) { free = false; break; }
        }
      }
      if (free) capBoxes.push({ x: cx, y: cy, halfW, halfH });
      const target = free ? 1 : 0;
      cap.alpha += Math.sign(target - cap.alpha) * Math.min(dt * 5, Math.abs(target - cap.alpha));
      cap.visible = cap.alpha > 0.02;
    }

    // пересобираем повзрослевших — чтобы появилась подпись (имя/пол)
    for (const a of matured) {
      const i = actors.indexOf(a);
      if (i < 0) continue;
      if (!a.view.visible) continue; // кота держат за шкирку — подпись появится при refresh
      a.view.destroy({ children: true });
      const na = makeActor(a.cat, a);
      actors[i] = na;
      hostOf(na).addChild(na.view);
    }

    // анимация эффектов взросления: кольцо расходится, искорки разлетаются и гаснут
    for (let k = effects.length - 1; k >= 0; k--) {
      const fx = effects[k]!;
      fx.life += dt;
      const t = Math.min(1, fx.life / fx.ttl);
      const e = 1 - (1 - t) * (1 - t);
      const r = catH * (0.15 + e * 0.7);
      fx.ring.clear();
      fx.ring.circle(0, 0, r).stroke({ width: 3 * (1 - t), color: 0xffd86b, alpha: 0.85 * (1 - t) });
      fx.sparks.forEach((s, i) => {
        const ang = (i / fx.sparks.length) * Math.PI * 2;
        s.x = Math.cos(ang) * r;
        s.y = Math.sin(ang) * r - e * catH * 0.12;
        s.alpha = 1 - t;
        s.scale.set(0.6 + e * 0.7);
      });
      if (fx.life >= fx.ttl) { fx.view.destroy({ children: true }); effects.splice(k, 1); }
    }

    // всплывающие эмоции: дрейф вверх + затухание
    for (let k = moodFx.length - 1; k >= 0; k--) {
      const m = moodFx[k]!;
      m.life += dt;
      const t = Math.min(1, m.life / m.ttl);
      m.view.y += m.vy * dt;
      m.view.alpha = 1 - t;
      m.view.scale.set(0.8 + t * 0.3);
      if (m.life >= m.ttl) { m.view.destroy(); moodFx.splice(k, 1); }
    }

    sfxPurrSync(sleepy); // хор мурлыканья = ровно те, кто сейчас спит на этом полу
  }

  /** Узел гуляющего кота — «якорь» подсветки обучения (см. Room.anchor). */
  function nodeOf(catId: string): Container | null {
    const a = actors.find((x) => x.cat.id === catId);
    return a && !a.body.destroyed ? a.body : null;
  }

  return { refresh, tick, nodeOf, placeAt };
}
