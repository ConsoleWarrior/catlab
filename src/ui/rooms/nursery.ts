/**
 * Комната «Питомник»: ценные коты ХОДЯТ по полу (можно взять за шкирку и
 * таскать, тап — меню), дают пассивный доход и служат племфондом для вязки.
 * Улучшения — в оверлее ⚙️, чтобы не занимать пол.
 */

import { Container } from 'pixi.js';
import {
  catsIn, nurseryCapacity, passiveRatePerMin, buyCat, buyCatCost,
} from '../../game/index.js';
import type { Room, UiContext } from '../context.js';
import { roomShell } from './shell.js';
import { Button, COLORS, label } from '../theme.js';
import { createLivingFloor } from '../livingFloor.js';

export function createNursery(ctx: UiContext): Room {
  const shell = roomShell(ctx, 'nursery', '🏆 Питомник');
  const floorLayer = new Container();
  shell.container.addChild(floorLayer);

  const baseline = ctx.roomH - 78;
  const bandTop = ctx.topInset + 96;
  const floor = createLivingFloor(
    ctx, floorLayer,
    { x: 24, y: bandTop, w: ctx.roomW - 48, h: Math.max(80, baseline - bandTop) },
    () => catsIn(ctx.state, 'nursery'),
  );

  function refresh(): void {
    shell.body.removeChildren();
    const cats = catsIn(ctx.state, 'nursery');
    const cap = nurseryCapacity(ctx.state);
    const rate = passiveRatePerMin(ctx.state);

    const info = label(
      `${cats.length}/${cap} котиков   ·   💰 +${rate.toFixed(rate < 10 ? 1 : 0)}/мин`,
      15, COLORS.ink, '700',
    );
    info.anchor.set(0, 0.5);
    info.position.set(2, 14);
    shell.body.addChild(info);

    const cost = buyCatCost(ctx.state);
    const buy = new Button({
      text: cost === 0 ? '🛒 Котик (бесплатно)' : `🛒 Купить котика (${cost} 💰)`,
      w: 220, h: 40, color: COLORS.good, fontSize: 14,
    });
    buy.enabled = cats.length < cap && ctx.state.coins >= cost;
    buy.position.set(shell.contentW - 252, 16);
    buy.onTap = () => {
      const r = buyCat(ctx.state, ctx.rng, ctx.now());
      if (r.ok) { ctx.commit(); ctx.toast('Новый котик в питомнике 🐱'); }
      else ctx.toast(r.reason);
    };
    shell.body.addChild(buy);

    const gear = new Button({ text: '⚙️ Улучшить', w: 140, h: 40, color: COLORS.secondary, fontSize: 14 });
    gear.position.set(shell.contentW - 78, 16);
    gear.onTap = () => ctx.openUpgrades('🏆 Улучшения питомника', ['nurseryCap', 'show']);
    shell.body.addChild(gear);

    floor.refresh();
  }

  return {
    id: 'nursery', title: '🏆 Питомник', container: shell.container,
    refresh, tick: (dt) => floor.tick(dt),
  };
}
