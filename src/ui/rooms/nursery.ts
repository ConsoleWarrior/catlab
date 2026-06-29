/**
 * Комната «Питомник»: ценные коты ХОДЯТ по полу (можно взять за шкирку и
 * таскать, тап — меню), дают пассивный доход и служат племфондом для вязки.
 * Улучшения — в оверлее ⚙️, чтобы не занимать пол.
 */

import { Container } from 'pixi.js';
import {
  catsIn, nurseryCapacity, buyCat, buyCatCost, isInSlot,
} from '../../game/index.js';
import type { Room, UiContext } from '../context.js';
import { roomShell, floorPlane } from './shell.js';
import { Button, COLORS } from '../theme.js';
import { createLivingFloor } from '../livingFloor.js';

export function createNursery(ctx: UiContext): Room {
  const shell = roomShell(ctx, 'nursery', '🏆 Питомник');
  const floorLayer = new Container();
  shell.container.addChild(floorLayer);

  const floor = createLivingFloor(
    ctx, floorLayer,
    floorPlane(ctx.roomW, ctx.roomH, ctx.topInset),
    // коты, поставленные в слот вязки, физически в инкубаторе — на полу их не показываем
    () => catsIn(ctx.state, 'nursery').filter((c) => !isInSlot(ctx.state, c.id)),
  );

  function refresh(): void {
    shell.body.removeChildren();
    const owned = catsIn(ctx.state, 'nursery');
    // на полу — без тех, кто сейчас стоит в слоте инкубатора (они «в отъезде»)
    const present = owned.filter((c) => !isInSlot(ctx.state, c.id));
    const cap = nurseryCapacity(ctx.state);
    // вместимость комнаты — счётчиком справа в плашке названия
    shell.setTitleBadge(`🐱 ${present.length}/${cap}`);

    const cost = buyCatCost(ctx.state);
    const buy = new Button({
      text: cost === 0 ? '🛒 Котик (бесплатно)' : `🛒 Купить котика (${cost} 💰)`,
      w: 220, h: 40, color: COLORS.good, fontSize: 14,
    });
    // покупку ограничиваем по «владению» (как buyCat) — слотовые коты ещё наши
    buy.enabled = owned.length < cap && ctx.state.coins >= cost;
    buy.position.set(shell.contentW - 114, 16);
    buy.onTap = () => {
      const r = buyCat(ctx.state, ctx.rng, ctx.now());
      if (r.ok) { ctx.commit(); ctx.toast('Новый котик в питомнике 🐱'); }
      else ctx.toast(r.reason);
    };
    shell.body.addChild(buy);

    floor.refresh();
  }

  return {
    id: 'nursery', title: '🏆 Питомник', container: shell.container,
    refresh, tick: (dt) => floor.tick(dt),
  };
}
