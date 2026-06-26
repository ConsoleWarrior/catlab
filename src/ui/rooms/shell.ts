/**
 * Оболочка комнаты в «разрезе здания»: стена-акцент, пол, боковые стены,
 * титульная плашка. Возвращает тело (body) для контента комнаты.
 */

import { Container, Graphics } from 'pixi.js';
import type { UiContext } from '../context.js';
import { COLORS, label, ROOM_ACCENT } from '../theme.js';
import { darken } from '../../render/palette.js';

export interface Shell {
  container: Container;
  body: Container;
  contentW: number;
  contentH: number;
  /** Титульная плашка комнаты — чтобы пристроить справа от названия кнопки/чипы. */
  titleBar: Container;
  titleW: number;
  titleH: number;
}

const PAD = 18;
const TITLE_H = 44;
const NAV_RESERVE = 46;

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

  // пол
  const floorY = h - 70;
  const floor = new Graphics();
  floor.rect(0, floorY, w, h - floorY).fill(darken(accent, 0.12));
  floor.rect(0, floorY, w, 4).fill({ color: 0x000000, alpha: 0.06 });
  container.addChild(floor);

  // боковые стены-перегородки (читается как соседние секции здания)
  const walls = new Graphics();
  walls.rect(0, topInset, 6, h - topInset).fill({ color: 0x000000, alpha: 0.05 });
  walls.rect(w - 6, topInset, 6, h - topInset).fill({ color: 0x000000, alpha: 0.05 });
  container.addChild(walls);

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
