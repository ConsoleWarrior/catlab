/**
 * Оболочка комнаты в «разрезе здания»: стена-акцент, пол, боковые стены,
 * титульная плашка. Возвращает тело (body) для контента комнаты.
 */

import { Container, Graphics, Sprite, Text } from 'pixi.js';
import type { UiContext } from '../context.js';
import { COLORS, label, ROOM_ACCENT } from '../theme.js';
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
}

const PAD = 18;
const TITLE_H = 44;
// тонкая полоса под навигацию (точки + стрелки в одном ряду), прижата к самому
// низу экрана. Контент комнат заканчивается на этой высоте — ниже только панель
// навигации, без кликабельного контента, чтобы навигация не перехватывала тапы
// по контенту (и наоборот). Держим её минимальной — лишнее место отдано контенту.
const NAV_RESERVE = 26;

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
  container.addChild(buildDecor(id, w, h));

  // титульная плашка — вдвое короче (название + запас), справа освобождаем место
  // под кнопки комнаты (напр. чипы усилителей у Инкубатора).
  const titleBar = new Container();
  const t = label(title, 20, COLORS.ink, '800');
  t.anchor.set(0, 0.5);
  t.position.set(16, TITLE_H / 2);
  const bw = Math.max(t.width + 32, Math.min(w - PAD * 2, 460) / 2);
  const bg = new Graphics();
  bg.roundRect(0, 0, bw, TITLE_H, 14).fill({ color: COLORS.hud, alpha: 0.92 });
  bg.roundRect(0, 0, bw, TITLE_H, 14).stroke({ width: 2, color: COLORS.cardEdge });
  titleBar.addChild(bg, t);
  titleBar.position.set(PAD, topInset + 8);
  container.addChild(titleBar);

  // Счётчик-бейдж справа в плашке: создаётся по первому вызову, при необходимости
  // расширяет фон плашки, чтобы «название … N/M» помещалось с отступами.
  let badge: Text | null = null;
  const setTitleBadge = (text: string): number => {
    if (!badge) {
      badge = label(text, 15, COLORS.inkSoft, '800');
      badge.anchor.set(1, 0.5);
      badge.position.set(bw - 14, TITLE_H / 2);
      titleBar.addChild(badge);
    }
    badge.text = text;
    const newW = Math.max(bw, 16 + t.width + 16 + badge.width + 14);
    bg.clear();
    bg.roundRect(0, 0, newW, TITLE_H, 14).fill({ color: COLORS.hud, alpha: 0.92 });
    bg.roundRect(0, 0, newW, TITLE_H, 14).stroke({ width: 2, color: COLORS.cardEdge });
    badge.position.x = newW - 14;
    return newW;
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
    titleW: bw,
    titleH: TITLE_H,
    setTitleBadge,
  };
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
