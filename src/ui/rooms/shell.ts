/**
 * Оболочка комнаты в «разрезе здания»: стена-акцент, пол, боковые стены,
 * титульная плашка. Возвращает тело (body) для контента комнаты.
 */

import { Container, Graphics, Rectangle, Sprite, Text } from 'pixi.js';
import type { UiContext } from '../context.js';
import { Button, COLORS, label, ROOM_ACCENT } from '../theme.js';
import { hasRoomHelp } from '../roomHelp.js';
import { roomBg } from '../roomArt.js';
import { buildDecor } from '../decorArt.js';
import { darken, lighten } from '../../render/palette.js';

export interface Shell {
  container: Container;
  body: Container;
  contentW: number;
  contentH: number;
  /** Титульная плашка комнаты — чтобы пристроить справа от названия кнопки/чипы. */
  titleBar: Container;
  titleW: number;
  titleH: number;
  /** Счётчик-бейдж справа в плашке названия (напр. вместимость комнаты «N/M»).
   * Создаётся лениво; плашка расширяется под название + счётчик. Возвращает
   * итоговую ширину плашки — чтобы пристроить элементы справа от неё (чипы). */
  setTitleBadge: (text: string) => number;
  /** Слой декора (интерьерные ИИ-спрайты, координаты нормализованы к комнате).
   * Каждый спрайт несёт zIndex = линия пола · 1000; комната может включить
   * sortableChildren и добавить СЮДА свои объекты той же системы координат
   * (пьедесталы выставки питомника) — перекрытия решаются по глубине. */
  decor: Container;
}

const PAD = 18;
/** Высота титульной плашки комнаты. Экспортируется: под неё подстраивается
 *  подсказка обучения, чтобы не накрывать название комнаты и кнопки рядом. */
export const TITLE_H = 44;
/** Сторона круглой кнопки справки ℹ️ в титульной плашке. */
const INFO_D = 28;
// тонкая полоса под навигацию (точки + стрелки в одном ряду), прижата к самому
// низу экрана. Контент комнат заканчивается на этой высоте — ниже только панель
// навигации, без кликабельного контента, чтобы навигация не перехватывала тапы
// по контенту (и наоборот). Держим её минимальной — лишнее место отдано контенту.
// Экспортируется: на её толщину ориентируется отступ угловых станций (cornerStation).
export const NAV_RESERVE = 26;

/**
 * Высота полосы пола (грунта под котами). Адаптивная: на коротких экранах
 * (мобильный ландшафт) тоньше, чтобы не съедать пятую часть высоты, на ПК —
 * как раньше (70px). Комнаты привязывают «линию ног» котов к этой же величине.
 */
export function floorBandH(h: number): number {
  return Math.round(Math.max(40, Math.min(70, h * 0.11)));
}

/** Линия пола (низ лап котов): чуть выше верха полосы пола — там же контактная тень. */
export function floorBaseline(h: number): number {
  return h - floorBandH(h) - 8;
}

/**
 * Псевдо-3D «комната-коробка» (одноточечная перспектива) для жилых комнат.
 * Единый источник правды: по этой геометрии рисуется задняя/боковые стены и пол
 * (в `roomShell`), и по ней же «живой пол» расставляет котов по глубине.
 *
 *   z = 0 — ближний край (коты крупные, ниже по экрану, шире разброс по X);
 *   z = 1 — дальний край (стык пола и задней стены: коты мельче и выше).
 *
 * Всё считается от размеров комнаты с clamp — на мобильном ландшафте глубина
 * меньше (короткий экран), чтобы подписи котов не наезжали на титул.
 */
export interface FloorPlane {
  centerX: number;
  yNear: number;     // линия ног у ближнего края
  yFar: number;      // линия ног у дальнего края (стык пола и задней стены)
  nearHalfW: number; // половина игровой ширины (для котов) у ближнего края
  farHalfW: number;  // половина игровой ширины (для котов) у дальнего края
  wallHalfW: number; // половина ширины задней стены (для отрисовки коробки)
  catH: number;      // высота кота у ближнего края (z = 0)
  farScale: number;  // масштаб кота у дальнего края (z = 1)
}

// Задняя кромка «ходимого» пола — доля высоты комнаты, глубже которой коты не
// заходят. В ИИ-фонах плинтус (стык стены и пола) проходит на ~0.645·h, но кот —
// высокий спрайт: даже стоя ступнями ровно на плинтусе, телом он наезжает на
// заднюю стену и читается как «запрыгнул на стену». Поэтому дальнюю линию ног
// держим заметно ниже плинтуса (ближе к зрителю) — коты остаются на дереве пола.
const FLOOR_BACK_FRAC = 0.72;

export function floorPlane(w: number, h: number, topInset: number): FloorPlane {
  const centerX = w / 2;
  const usable = h - topInset;
  // ближняя линия ног — у самого низа, над полосой навигации
  const yNear = h - NAV_RESERVE - 4;
  // насколько пол «уходит вглубь»: умеренно, с потолком (чтобы дальние коты и их
  // подписи не упирались в титульную плашку на коротких экранах)
  const depth = Math.round(Math.max(96, Math.min(240, usable * 0.34)));
  // дальняя линия ног — но не дальше задней кромки пола: глубже коты не ходят,
  // чтобы у дальнего края не наезжать телом на стену
  const yFar = Math.max(yNear - depth, Math.round(h * FLOOR_BACK_FRAC));

  const sideInset = 22;
  const playHalf = Math.max(40, w / 2 - sideInset);
  const wallHalfW = playHalf * 0.6;            // задняя стена — центральные ~60% ширины
  const nearHalfW = playHalf * 0.96;           // у зрителя коты гуляют почти во всю ширину
  const farHalfW = wallHalfW * 0.9;            // вдали разброс сужается по перспективе

  return {
    centerX, yNear, yFar, nearHalfW, farHalfW, wallHalfW,
    catH: Math.round(Math.max(100, Math.min(150, usable * 0.36))),
    farScale: 0.6,
  };
}

/**
 * Настенная полка (Приют): доска под подоконником окон фона, на которую коты
 * запрыгивают с пола (см. livingFloor). Задана долями от размера комнаты — фон
 * растянут на всю комнату, поэтому доска садится ровно под окна при любой
 * пропорции экрана.
 *
 *   y        — верх доски, он же «линия лап» стоящего на ней кота;
 *   walkHalf — половина ХОДИМОЙ части (уже доски: по краям лежат плед и горшок,
 *              и кот не должен свешиваться с торца);
 *   scale    — масштаб кота на полке. Полка — на самой стене, дальше задней
 *              кромки ходимого пола, поэтому коты там мельче, чем при z = 1.
 */
export interface ShelfPlane {
  cx: number;
  halfW: number;
  walkHalf: number;
  y: number;
  thick: number;
  scale: number;
  capacity: number; // сколько котов пускаем на доску одновременно
  /** Кусок доски, закрытый кошачьим комплексом: остановки там не назначаем, но
   * пройти сквозь можно (кот выныривает из-за стоек — это как раз мило). */
  blindFrom: number;
  blindTo: number;
}

// Низ окон в фоне Приюта — на 0.495·h, оба окна укладываются в 0.34…0.66 ширины:
// доска шириной 0.44·w под ними смотрится как подоконник во всю простенку.
const SHELF_YN = 0.502;
const SHELF_HALF_WN = 0.22;
// Сколько котов пускаем на доску одновременно. Столько влезает на широком экране;
// на узком (4:3) доска короче — там потолок опускает уже сама ширина.
const SHELF_CAPACITY = 8;
// Кошачий комплекс (декор Приюта, ROOM_DECOR.shelter) закрывает эти доли ширины
// комнаты — не на самой доске, а по всей высоте кота на ней (силуэт комплекса
// 0.449…0.558 плюс полкорпуса кота с каждой стороны).
const SHELF_BLIND: readonly [number, number] = [0.434, 0.573];

export function shelfPlane(w: number, h: number, plane: FloorPlane): ShelfPlane {
  const scale = plane.farScale * 0.88;
  const halfW = w * SHELF_HALF_WN;
  const pad = plane.catH * scale * 0.5; // полкорпуса кота + место под краевой декор
  const walkHalf = Math.max(30, halfW - pad);
  const catW = plane.catH * scale * 0.55;
  return {
    cx: w / 2,
    halfW,
    walkHalf,
    y: Math.round(h * SHELF_YN),
    thick: Math.max(9, Math.round(h * 0.018)),
    scale,
    capacity: Math.max(2, Math.min(SHELF_CAPACITY, Math.floor((walkHalf * 2) / (catW * 1.45)))),
    blindFrom: w * SHELF_BLIND[0],
    blindTo: w * SHELF_BLIND[1],
  };
}

/**
 * Отрисовка полки: тёплая деревянная доска на деревянных кронштейнах, по краям
 * (вне ходимой части) сложенный плед и горшок с зеленью. Рисуем процедурно —
 * доска должна попадать точно в геометрию `shelfPlane`, по которой ходят коты.
 */
export function buildShelf(s: ShelfPlane): Container {
  const { cx, halfW, walkHalf, y, thick } = s;
  const c = new Container();
  c.eventMode = 'none'; // рисунок полки не должен перехватывать тапы по котам на ней
  const g = new Graphics();
  const x0 = cx - halfW, x1 = cx + halfW;
  const top = Math.max(5, Math.round(thick * 0.55)); // верхняя грань — на неё встают коты
  const yb = y + top + thick;                        // низ доски
  const woodTop = 0xf2d6a9, wood = 0xdfb27c, woodDark = 0xc08f55, woodEdge = 0x8f6231;

  // мягкая тень на стене под доской (двумя полосами, без фильтров)
  g.roundRect(x0 + 8, yb, halfW * 2 - 16, 12, 6).fill({ color: 0x000000, alpha: 0.15 });
  g.roundRect(x0 + 30, yb + 9, halfW * 2 - 60, 8, 4).fill({ color: 0x000000, alpha: 0.07 });

  // кронштейны: короткий клин с вогнутыми боками + плашка примыкания к доске,
  // чтобы читались опорой полки, а не флажком под ней
  const bw = Math.max(20, thick * 2.2), bh = Math.max(16, thick * 1.7);
  for (const bx of [cx - halfW * 0.66, cx + halfW * 0.66]) {
    g.moveTo(bx - bw / 2, yb - 2)
      .quadraticCurveTo(bx - bw * 0.22, yb + bh * 0.55, bx, yb + bh)
      .quadraticCurveTo(bx + bw * 0.22, yb + bh * 0.55, bx + bw / 2, yb - 2)
      .closePath()
      .fill(woodDark);
    g.roundRect(bx - bw * 0.62, yb - thick * 0.55, bw * 1.24, thick * 0.55 + 3, 2).fill(woodDark);
    g.moveTo(bx - bw * 0.4, yb + 1)
      .quadraticCurveTo(bx - bw * 0.14, yb + bh * 0.45, bx, yb + bh * 0.82)
      .stroke({ width: 2, color: 0xffffff, alpha: 0.2 });
  }

  // доска: передний торец + верхняя грань трапецией (смотрим на полку чуть сверху)
  g.roundRect(x0, y + top - 2, halfW * 2, thick + 2, 4).fill(wood);
  g.roundRect(x0 + 2, yb - thick * 0.42, halfW * 2 - 4, thick * 0.42, 2)
    .fill({ color: woodEdge, alpha: 0.22 });               // затемнение к нижней кромке
  g.poly([x0 + 5, y, x1 - 5, y, x1, y + top, x0, y + top]).fill(woodTop);
  g.moveTo(x0 + 7, y + 1.5).lineTo(x1 - 7, y + 1.5)
    .stroke({ width: 2, color: 0xffffff, alpha: 0.4 });     // блик по кромке (свет из окна)
  g.roundRect(x0, y, halfW * 2, top + thick, 4).stroke({ width: 2, color: woodEdge, alpha: 0.45 });
  c.addChild(g);

  // Краевой декор — в поле между ходимой частью и торцом доски.
  const d = new Graphics();
  const dw = Math.max(20, (halfW - walkHalf) * 1.3);
  // слева — мягкая подушечка (кот на полке любит на неё улечься)
  const px = x0 + dw * 0.66, ph = Math.max(11, dw * 0.5);
  const pillow = (ox: number, oy: number, w: number, h: number, col: number): void => {
    d.moveTo(ox - w / 2, oy - h * 0.4)
      .quadraticCurveTo(ox - w * 0.54, oy - h * 1.05, ox, oy - h * 0.92)
      .quadraticCurveTo(ox + w * 0.54, oy - h * 1.05, ox + w / 2, oy - h * 0.4)
      .quadraticCurveTo(ox + w * 0.54, oy + h * 0.12, ox, oy)
      .quadraticCurveTo(ox - w * 0.54, oy + h * 0.12, ox - w / 2, oy - h * 0.4)
      .closePath().fill(col);
  };
  pillow(px, y + 2, dw, ph, 0xe8756b);
  pillow(px, y - ph * 0.52, dw * 0.82, ph * 0.78, 0xf59d92);
  d.circle(px, y - ph * 0.78, Math.max(1.5, ph * 0.09)).fill({ color: 0xc04f47, alpha: 0.8 });
  // справа — горшок с зеленью
  const gx = x1 - dw * 0.62, pw = dw * 0.62, poth = dw * 0.52;
  d.ellipse(gx, y - poth - pw * 0.46, pw * 0.54, pw * 0.44).fill(0x74b072);
  d.ellipse(gx - pw * 0.44, y - poth - pw * 0.22, pw * 0.36, pw * 0.31).fill(0x8cc487);
  d.ellipse(gx + pw * 0.44, y - poth - pw * 0.28, pw * 0.32, pw * 0.27).fill(0x63a065);
  d.poly([gx - pw / 2, y - poth, gx + pw / 2, y - poth, gx + pw * 0.36, y + 1, gx - pw * 0.36, y + 1])
    .fill(0xd98b62);
  d.roundRect(gx - pw * 0.57, y - poth - 4, pw * 1.14, 7, 3).fill(0xeaa87f);
  c.addChild(d);
  return c;
}

export function roomShell(ctx: UiContext, id: string, title: string): Shell {
  const { roomW: w, roomH: h, topInset } = ctx;
  const container = new Container();
  const accent = ROOM_ACCENT[id] ?? 0xf3ece2;

  // задняя стена
  const wall = new Graphics();
  wall.rect(0, 0, w, h).fill(accent);
  // мягкий «свет из окна» сверху
  wall.rect(0, 0, w, topInset + 90).fill({ color: 0xffffff, alpha: 0.18 });
  container.addChild(wall);

  // Готовый ИИ-фон комнаты (нарисован по нашей геометрии floorPlane). Если есть —
  // растягиваем на всю комнату и НЕ рисуем процедурную коробку: коты «живого пола»
  // встают сверху по той же геометрии. Нет фона → процедурная коробка (ниже).
  const bgTex = roomBg(id);
  if (bgTex) {
    const bgSprite = new Sprite(bgTex);
    bgSprite.width = w;
    bgSprite.height = h;
    container.addChild(bgSprite);
  }

  // Пол — только в жилых комнатах (там по нему ходят коты). Рисуем псевдо-3D
  // «комнату-коробку» (одноточечная перспектива): задняя стена в центре, боковые
  // стены-трапеции и пол, уходящий вглубь. По этой же геометрии «живой пол»
  // расставляет котов по глубине. В Инкубаторе/Генолабе пола нет (слоты/панели).
  if (!bgTex && (id === 'nursery' || id === 'shelter')) {
    const p = floorPlane(w, h, topInset);
    const cx = p.centerX, wh = p.wallHalfW, yf = p.yFar;
    const wallL = cx - wh, wallR = cx + wh;
    const g = new Graphics();

    // боковые стены (чуть темнее задней — лёгкий объём от бокового света)
    g.poly([0, topInset, wallL, topInset, wallL, yf, 0, h]).fill(darken(accent, 0.05));
    g.poly([w, topInset, wallR, topInset, wallR, yf, w, h]).fill(darken(accent, 0.09));

    // пол-трапеция: узкий у задней стены, во всю ширину у зрителя
    g.poly([wallL, yf, wallR, yf, w, h, 0, h]).fill(darken(accent, 0.14));
    // ближе к зрителю пол светлее (имитация падающего света) — мягкая засветка снизу
    g.poly([cx - wh * 1.4, p.yNear, cx + wh * 1.4, p.yNear, w, h, 0, h])
      .fill({ color: lighten(accent, 0.06), alpha: 0.5 });

    // линия стыка пола и задней стены + лёгкое затенение у плинтуса (контакт-тень)
    g.poly([wallL, yf, wallR, yf, wallR + 14, yf + 12, wallL - 14, yf + 12])
      .fill({ color: 0x000000, alpha: 0.07 });
    g.moveTo(wallL, yf).lineTo(wallR, yf).stroke({ width: 2, color: 0x000000, alpha: 0.06 });

    container.addChild(g);
  }

  // боковые стены-перегородки (читается как соседние секции здания)
  const walls = new Graphics();
  walls.rect(0, topInset, 6, h - topInset).fill({ color: 0x000000, alpha: 0.05 });
  walls.rect(w - 6, topInset, 6, h - topInset).fill({ color: 0x000000, alpha: 0.05 });
  container.addChild(walls);

  // Декор комнаты (статичные интерьерные спрайты из decorArt) — над фоном/стенами,
  // но под титульной плашкой, телом комнаты и котами (их добавляют выше по слоям).
  const decor = buildDecor(id, w, h);
  container.addChild(decor);

  // титульная плашка — вдвое короче (название + запас), справа освобождаем место
  // под кнопки комнаты (напр. чипы усилителей у Инкубатора).
  const titleBar = new Container();
  const t = label(title, 20, COLORS.ink, '800');
  t.anchor.set(0, 0.5);
  t.position.set(16, TITLE_H / 2);
  const bg = new Graphics();
  titleBar.addChild(bg, t);
  titleBar.position.set(PAD, topInset + 8);
  container.addChild(titleBar);

  // Кнопка справки комнаты (ℹ️) — ПОСЛЕДНЯЯ в плашке, за счётчиком. Живёт внутри
  // плашки, а не рядом с ней, чтобы не спорить за место с тем, что комнаты сами
  // вешают правее (чипы усилителей в Инкубаторе): те считаются от итоговой ширины
  // плашки, и место под ℹ️ учтено автоматически.
  const info = hasRoomHelp(id)
    ? new Button({ text: 'ℹ️', w: INFO_D, h: INFO_D, color: COLORS.cardEdge, textColor: COLORS.ink, fontSize: 15 })
    : null;
  if (info) {
    info.onTap = () => ctx.openRoomHelp(id);
    titleBar.addChild(info);
  }
  const infoSpace = info ? INFO_D + 10 : 0;

  // Ширина плашки: название + (счётчик) + (ℹ️). Пересчитывается при смене
  // счётчика — «название … N/M ℹ️» должно помещаться с отступами.
  let badge: Text | null = null;
  const relayout = (): number => {
    const inner = 16 + t.width + (badge ? 16 + badge.width : 0) + infoSpace + 14;
    const bw = Math.max(inner, Math.min(w - PAD * 2, 460) / 2);
    bg.clear();
    bg.roundRect(0, 0, bw, TITLE_H, 14).fill({ color: COLORS.hud, alpha: 0.92 });
    bg.roundRect(0, 0, bw, TITLE_H, 14).stroke({ width: 2, color: COLORS.cardEdge });
    if (info) info.position.set(bw - 14 - INFO_D / 2, TITLE_H / 2);
    if (badge) badge.position.x = bw - 14 - infoSpace;
    return bw;
  };
  const titleW = relayout();

  const setTitleBadge = (text: string): number => {
    if (!badge) {
      badge = label(text, 15, COLORS.inkSoft, '800');
      badge.anchor.set(1, 0.5);
      badge.position.set(0, TITLE_H / 2);
      titleBar.addChild(badge);
    }
    badge.text = text;
    return relayout();
  };

  const body = new Container();
  const top = topInset + 8 + TITLE_H + 12;
  body.position.set(PAD, top);
  container.addChild(body);

  return {
    container,
    body,
    contentW: w - PAD * 2,
    contentH: h - top - NAV_RESERVE,
    titleBar,
    titleW,
    titleH: TITLE_H,
    setTitleBadge,
    decor,
  };
}

/**
 * Прямоугольник «станции-короба» в нижнем углу комнаты (drag-цель: ветеринар,
 * криокапсула, лаборатория «на эксперименты», пристройство «в добрые руки»).
 * Короб жмётся в угол с отступом ≈ толщине полосы навигации (NAV_RESERVE), поэтому
 * все станции стоят единообразно по углам, над навигацией. Габарит короба — как был
 * (0.15·w × 0.95 от ширины), меняется только привязка к углу.
 */
export function cornerStation(w: number, h: number, side: 'left' | 'right'): Rectangle {
  const sw = w * 0.15;
  const sh = sw * 0.95;
  const m = NAV_RESERVE;
  const x = side === 'left' ? m : w - m - sw;
  const y = h - m - sh;
  return new Rectangle(x, y, sw, sh);
}

/** Плашка-подпись станции (пилюля с текстом над коробом-станцией). */
export function stationBadge(cx: number, topY: number, text: string): Container {
  const tag = label(text, 13, COLORS.ink, '800');
  const pillBg = new Graphics();
  const pw = tag.width + 18;
  pillBg.roundRect(-pw / 2, -14, pw, 26, 13).fill({ color: COLORS.hud, alpha: 0.9 });
  pillBg.roundRect(-pw / 2, -14, pw, 26, 13).stroke({ width: 2, color: COLORS.cardEdge });
  const badge = new Container();
  badge.addChild(pillBg, tag);
  badge.position.set(cx, topY - 8);
  return badge;
}

/** Сетка позиций для карточек котов: квадратные клетки в contentW×contentH. */
export function gridLayout(
  count: number,
  contentW: number,
  contentH: number,
): { cols: number; rows: number; cw: number; ch: number; gap: number } {
  const gap = 12;
  // подбираем число колонок, чтобы клетки были максимально крупными и помещались
  let best = { cols: 1, rows: count, cw: 0, ch: 0, gap };
  for (let cols = 1; cols <= Math.max(1, count); cols++) {
    const rows = Math.ceil(count / cols);
    const cw = (contentW - gap * (cols - 1)) / cols;
    const ch = (contentH - gap * (rows - 1)) / rows;
    const cell = Math.min(cw, ch * 0.82); // карточка чуть выше ширины
    const bestCell = Math.min(best.cw, best.ch * 0.82);
    if (cols === 1 || cell > bestCell) best = { cols, rows, cw, ch, gap };
  }
  // ограничим максимальный размер клетки, чтобы не было гигантских карточек
  best.cw = Math.min(best.cw, 150);
  best.ch = Math.min(best.ch, 180);
  return best;
}
