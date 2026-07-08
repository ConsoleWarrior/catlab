/**
 * Комната «Приют»: котики-метисы ХОДЯТ по полу и ждут, пока их пристроят
 * «в добрые руки». Тап по котику → меню (пристроить → 💰+🧬 / вернуть).
 * Можно взять за шкирку и потаскать. Улучшения — в оверлее ⚙️.
 */

import { Container, Graphics } from 'pixi.js';
import { catsIn, shelterCapacity, isInSlot } from '../../game/index.js';
import type { Cat } from '../../game/index.js';
import type { Room, UiContext } from '../context.js';
import { roomShell, floorPlane } from './shell.js';
import { COLORS, label } from '../theme.js';
import { createLivingFloor } from '../livingFloor.js';
import { decorZone } from '../decorArt.js';

export function createShelter(ctx: UiContext): Room {
  const shell = roomShell(ctx, 'shelter', '🏠 Приют');

  // Зона пристройства — переноска у двери (декор с role:'adopt'). Перетащил кота
  // сюда → подтверждение «Отдать в добрые руки?» (см. tryDropCat). Над переноской
  // — лёгкая подпись-подсказка, чтобы зона читалась.
  const adoptZone = decorZone('shelter', 'adopt', ctx.roomW, ctx.roomH);
  if (adoptZone) {
    const tag = label('🤝 в добрые руки', 13, COLORS.ink, '800');
    const pillBg = new Graphics();
    const pw = tag.width + 18;
    pillBg.roundRect(-pw / 2, -14, pw, 26, 13).fill({ color: COLORS.hud, alpha: 0.9 });
    pillBg.roundRect(-pw / 2, -14, pw, 26, 13).stroke({ width: 2, color: COLORS.cardEdge });
    const badge = new Container();
    badge.addChild(pillBg, tag);
    badge.position.set(adoptZone.x + adoptZone.width / 2, adoptZone.y - 6);
    shell.container.addChild(badge);
  }

  const floorLayer = new Container();
  shell.container.addChild(floorLayer);

  const floor = createLivingFloor(
    ctx, floorLayer,
    floorPlane(ctx.roomW, ctx.roomH, ctx.topInset),
    // коты, поставленные в слот вязки, физически в инкубаторе — на полу их не показываем
    () => catsIn(ctx.state, 'shelter').filter((c) => !isInSlot(ctx.state, c.id)),
  );

  /** Уронили кота на переноску → подтверждение пристройства. Иначе — обычный переезд. */
  function tryDropCat(cat: Cat, gx: number, gy: number): boolean {
    const zone = decorZone('shelter', 'adopt', ctx.roomW, ctx.roomH);
    if (!zone) return false;
    // gx/gy — координаты виртуальной сцены; зона — в локальных координатах
    // комнаты (комнаты сдвинуты внутри world на i·roomW) — переводим точку
    const lp = shell.container.toLocal({ x: gx, y: gy }, ctx.uiRoot);
    if (!zone.contains(lp.x, lp.y)) return false;
    ctx.commit();                 // grab-спрайт уже уничтожен — вернём наземного кота на пол
    ctx.openAdoptConfirm(cat);     // «Отдать котика в добрые руки?» (Да → adoptCat)
    return true;
  }

  function refresh(): void {
    shell.body.removeChildren();
    // на полу — без тех, кто сейчас стоит в слоте инкубатора (они «в отъезде»)
    const present = catsIn(ctx.state, 'shelter').filter((c) => !isInSlot(ctx.state, c.id));
    const cap = shelterCapacity(ctx.state);
    // вместимость комнаты — счётчиком справа в плашке названия
    shell.setTitleBadge(`🐱 ${present.length}/${cap}`);

    floor.refresh();
  }

  return {
    id: 'shelter', title: '🏠 Приют', container: shell.container,
    refresh, tick: (dt) => floor.tick(dt), tryDropCat,
  };
}
