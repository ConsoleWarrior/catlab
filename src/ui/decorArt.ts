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
 * Текстуры грузятся в game.ts (`../assets/decor/*.webp`) → `setDecorTexture`.
 * Слой декора строит `roomShell` сразу над фоном (под котами и UI комнаты).
 *
 * Интерактивные зоны (пристройство, лаборатория, ветеринар, криокапсула) — это уже
 * не декор, а станции-коробы в углах комнат (см. `cornerStation` в rooms/shell.ts).
 */

import { Container, Sprite } from 'pixi.js';
import type { Texture } from 'pixi.js';

const texs = new Map<string, Texture>();

export function setDecorTexture(name: string, tex: Texture): void { texs.set(name, tex); }

/** Текстура декор-спрайта по ключу (имя файла без расширения) или undefined. */
export function decorTexture(name: string): Texture | undefined { return texs.get(name); }

export interface DecorItem {
  sprite: string; // имя файла без расширения (ключ текстуры)
  xN: number;
  yN: number;
  scale: number;
  flip?: boolean;
  /** По умолчанию scale — доля ВЫСОТЫ комнаты (вертикальная мебель, anchor внизу).
   * Плоским напольным вещам (ковры) нужна доля ШИРИНЫ — их «рост» не важен. */
  scaleBy?: 'h' | 'w';
  /** Переопределяет ключ глубины (по умолчанию — yN: чем ближе к зрителю, тем
   * позже рисуется). Ковру нужно лежать ПОД мебелью/пьедесталами независимо от
   * своего фактического yN — передать 0, чтобы рисовался всегда первым. */
  sortY?: number;
  /** Доп. вертикальный множитель (после scale/scaleBy) — только для сплющивания
   * плоских напольных вещей. ИИ рисует ковёр как почти круглый packshot (высота
   * кадра ≈ ширине); при anchor снизу и scaleBy:'w' это даёт «коврик» высотой в
   * половину комнаты. squashY≈0.2-0.3 превращает круг в приплюснутый овал —
   * как коврик смотрелся бы на полу при перспективе комнаты. */
  squashY?: number;
}

/**
 * Расстановка декора по комнатам. Порядок в массиве = порядок отрисовки
 * (последующие рисуются поверх предыдущих) — как было в редакторе.
 */
export const ROOM_DECOR: Record<string, DecorItem[]> = {
  shelter: [
    { sprite: 'srug2_seed9903', xN: 0.5, yN: 0.885, scale: 0.64, scaleBy: 'w', squashY: 0.17, sortY: 0 }, // ковёр (всегда под мебелью)
    { sprite: 'bed_seed2001', xN: 0.6887, yN: 0.732, scale: 0.1121 },
    { sprite: 'bowls_seed4001', xN: 0.2486, yN: 0.7567, scale: 0.0906, flip: true },
    { sprite: 'cabinet_seed5001', xN: 0.7621, yN: 0.733, scale: 0.3337 },
    { sprite: 'cabinet_seed5003', xN: 0.2366, yN: 0.727, scale: 0.3636, flip: true },
    { sprite: 'tower3_seed1002', xN: 0.502, yN: 0.7399, scale: 0.4659 },
    { sprite: 'bed_seed2002', xN: 0.3006, yN: 0.7261, scale: 0.1037 },
    { sprite: 'bowls2_seed4103', xN: 0.1965, yN: 0.7438, scale: 0.0513 },
  ],
  // Питомник: центр задней стены занят дугой пьедесталов выставки (rooms/nursery.ts
  // добавляет их в этот же слой декора с zIndex по линии пола — слой y-сортируемый).
  // Декор ушёл на края (шкаф/лампа) и на передний план (тележка/весы/манеж).
  nursery: [
    { sprite: 'nrug_seed9401', xN: 0.5, yN: 0.9, scale: 0.62, scaleBy: 'w', squashY: 0.21, sortY: 0 }, // ковёр (всегда под мебелью/пьедесталами)
    // Настенные украшения (задняя стена, выше пьедесталов и лейбла «Откроется на ур. N»)
    { sprite: 'ncert_seed9701', xN: 0.605, yN: 0.37, scale: 0.13 },    // диплом с печатью
    { sprite: 'ncert_seed9703', xN: 0.685, yN: 0.37, scale: 0.13 },    // розетка (правее — упрётся в «Купить котика» на 4:3)
    { sprite: 'nport_seed9603', xN: 0.295, yN: 0.435, scale: 0.21 },   // портрет кота слева
    { sprite: 'nmedal_seed9802', xN: 0.645, yN: 0.52, scale: 0.16 },   // медали между дипломами
    { sprite: 'wreath_gold', xN: 0.5, yN: 0.315, scale: 0.14 },        // венок над подиумом
    { sprite: 'ncab_seed8403', xN: 0.205, yN: 0.748, scale: 0.27 },    // мед. шкаф слева
    { sprite: 'nlamp2_seed8112', xN: 0.815, yN: 0.75, scale: 0.24 },   // лежанка с лампой справа
    { sprite: 'nscale_seed8302', xN: 0.163, yN: 0.8, scale: 0.065 },   // весы слева от шкафа, за ковром
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
    s.label = it.sprite; // комната может найти конкретный предмет (getChildByLabel)
    // Декор — «прозрачный» для кликов. Без этого спрайт глушит хит-тест всем, кто
    // за ним: Pixi проверяет детей спереди назад и останавливается на первом, чей
    // ПРЯМОУГОЛЬНИК накрыл точку, даже если сам он не интерактивен. Кошачий
    // комплекс так перехватывал тапы по котам на настенной полке.
    s.eventMode = 'none';
    s.anchor.set(0.5, 1);
    const sc = it.scaleBy === 'w' ? (it.scale * roomW) / tex.width : (it.scale * roomH) / tex.height;
    s.scale.set(it.flip ? -sc : sc, sc * (it.squashY ?? 1));
    s.position.set(it.xN * roomW, it.yN * roomH);
    // глубина по линии пола: если комната включит sortableChildren (питомник),
    // декор и пьедесталы выставки перекрываются корректно по «дальше/ближе»
    s.zIndex = (it.sortY ?? it.yN) * 1000;
    layer.addChild(s);
  }
  return layer;
}

/**
 * Точка ВНУТРИ декор-спрайта (в пикселях его текстуры) → координаты комнаты,
 * плюс масштаб (px комнаты на 1 px текстуры). Нужна тем, кто вешает на декор
 * свои живые объекты: Приют так находит место, где к кошачьему комплексу
 * привязаны игрушки-маятники (см. rooms/shelter.ts, hangingToy.ts).
 *
 * Считается той же формулой, что и раскладка в `buildDecor` — иначе привязка
 * разъезжалась бы с самим спрайтом при смене пропорций экрана. Нет такого
 * предмета в комнате или не подгрузилась текстура → null.
 */
export function decorPoint(
  roomId: string,
  sprite: string,
  tx: number,
  ty: number,
  roomW: number,
  roomH: number,
): { x: number; y: number; scale: number } | null {
  const it = ROOM_DECOR[roomId]?.find((d) => d.sprite === sprite);
  const tex = it && texs.get(it.sprite);
  if (!it || !tex) return null;
  const sc = it.scaleBy === 'w' ? (it.scale * roomW) / tex.width : (it.scale * roomH) / tex.height;
  const sy = sc * (it.squashY ?? 1);
  return {
    x: it.xN * roomW + (tx - tex.width / 2) * sc * (it.flip ? -1 : 1),
    y: it.yN * roomH - (tex.height - ty) * sy,
    scale: sc,
  };
}
