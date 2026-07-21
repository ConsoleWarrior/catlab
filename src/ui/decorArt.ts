/**
 * Декор комнат: статичные интерьерные спрайты (лежанки, миски, башни, шкафы),
 * расставленные в «Декор-лабе» (decor-lab.html) и зафиксированные здесь.
 *
 * Координаты НОРМАЛИЗОВАНЫ под размер комнаты, поэтому не зависят от разрешения:
 *   x = xN · roomW;  y = yN · roomH (линия касания пола, низ-центр спрайта);
 *   высота спрайта = scale · roomH;  anchor (0.5, 1).
 * Фон комнаты в игре растянут на весь экран (roomShell), и в редакторе так же —
 * поэтому расстановка переносится один в один.
 *
 * Текстуры грузятся в game.ts (`../assets/decor/*.png`) → `setDecorTexture`.
 * Слой декора строит `roomShell` сразу над фоном (под котами и UI комнаты).
 *
 * Интерактивные зоны (пристройство, лаборатория, ветеринар, криокапсула) — это уже
 * не декор, а станции-коробы в углах комнат (см. `cornerStation` в rooms/shell.ts).
 */

import { Container, Sprite } from 'pixi.js';
import type { Texture } from 'pixi.js';

const texs = new Map<string, Texture>();

export function setDecorTexture(name: string, tex: Texture): void { texs.set(name, tex); }

/** Текстура декор-спрайта по ключу (имя файла без .png) или undefined. */
export function decorTexture(name: string): Texture | undefined { return texs.get(name); }

export interface DecorItem {
  sprite: string; // имя файла без .png (ключ текстуры)
  xN: number;
  yN: number;
  scale: number;
  flip?: boolean;
}

/**
 * Расстановка декора по комнатам. Порядок в массиве = порядок отрисовки
 * (последующие рисуются поверх предыдущих) — как было в редакторе.
 */
export const ROOM_DECOR: Record<string, DecorItem[]> = {
  shelter: [
    { sprite: 'bed_seed2001', xN: 0.6887, yN: 0.732, scale: 0.1121 },
    { sprite: 'bowls_seed4001', xN: 0.2486, yN: 0.7567, scale: 0.0906, flip: true },
    { sprite: 'cabinet_seed5001', xN: 0.7621, yN: 0.733, scale: 0.3337 },
    { sprite: 'cabinet_seed5003', xN: 0.2366, yN: 0.727, scale: 0.3636, flip: true },
    { sprite: 'tower3_seed1002', xN: 0.502, yN: 0.7399, scale: 0.4659 },
    { sprite: 'bed_seed2002', xN: 0.3006, yN: 0.7261, scale: 0.1037 },
    { sprite: 'bowls2_seed4103', xN: 0.1965, yN: 0.7438, scale: 0.0513 },
  ],
};

/** Контейнер со спрайтами декора комнаты под текущий размер (пустой, если декора нет). */
export function buildDecor(roomId: string, roomW: number, roomH: number): Container {
  const layer = new Container();
  const items = ROOM_DECOR[roomId];
  if (!items) return layer;
  for (const it of items) {
    const tex = texs.get(it.sprite);
    if (!tex) continue; // текстура не подгрузилась — пропускаем
    const s = new Sprite(tex);
    s.anchor.set(0.5, 1);
    const sc = (it.scale * roomH) / tex.height;
    s.scale.set(it.flip ? -sc : sc, sc);
    s.position.set(it.xN * roomW, it.yN * roomH);
    layer.addChild(s);
  }
  return layer;
}
