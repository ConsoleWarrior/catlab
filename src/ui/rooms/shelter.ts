/**
 * Комната «Приют»: котики-метисы ХОДЯТ по полу и ждут, пока их пристроят
 * «в добрые руки». Тап по котику → меню (пристроить → 💰+🧬 / вернуть).
 * Можно взять за шкирку и потаскать. Улучшения — в оверлее ⚙️.
 */

import { Container } from 'pixi.js';
import { catsIn, shelterCapacity, isInSlot } from '../../game/index.js';
import type { Room, UiContext } from '../context.js';
import { roomShell, floorBaseline } from './shell.js';
import { Button, COLORS, label } from '../theme.js';
import { createLivingFloor } from '../livingFloor.js';

export function createShelter(ctx: UiContext): Room {
  const shell = roomShell(ctx, 'shelter', '🏠 Приют');
  const floorLayer = new Container();
  shell.container.addChild(floorLayer);

  const baseline = floorBaseline(ctx.roomH);
  const bandTop = ctx.topInset + 96;
  const floor = createLivingFloor(
    ctx, floorLayer,
    { x: 24, y: bandTop, w: ctx.roomW - 48, h: Math.max(80, baseline - bandTop) },
    // коты, поставленные в слот вязки, физически в инкубаторе — на полу их не показываем
    () => catsIn(ctx.state, 'shelter').filter((c) => !isInSlot(ctx.state, c.id)),
  );

  function refresh(): void {
    shell.body.removeChildren();
    // на полу — без тех, кто сейчас стоит в слоте инкубатора (они «в отъезде»)
    const present = catsIn(ctx.state, 'shelter').filter((c) => !isInSlot(ctx.state, c.id));
    const cap = shelterCapacity(ctx.state);

    const info = label(
      `${present.length}/${cap} котиков ждут добрые руки   ·   тапни → пристроить (💰 + 🧬)`,
      15, COLORS.ink, '700',
    );
    info.anchor.set(0, 0.5);
    info.position.set(2, 14);
    shell.body.addChild(info);

    const gear = new Button({ text: '⚙️ Улучшить', w: 140, h: 40, color: COLORS.secondary, fontSize: 14 });
    gear.position.set(shell.contentW - 78, 16);
    gear.onTap = () => ctx.openUpgrades('🏠 Улучшения приюта', ['shelterCap', 'connections', 'biobank']);
    shell.body.addChild(gear);

    floor.refresh();
  }

  return {
    id: 'shelter', title: '🏠 Приют', container: shell.container,
    refresh, tick: (dt) => floor.tick(dt),
  };
}
