/**
 * Комната «Питомник»: ценные коты, пассивный доход, племфонд для вязки.
 * Тап по коту → меню. Кнопка «Купить котика» спасает от тупика (анти-софт-лок).
 */

import {
  catsIn, nurseryCapacity, passiveRatePerMin, buyCat, buyCatCost,
} from '../../game/index.js';
import type { Room, UiContext } from '../context.js';
import { roomShell } from './shell.js';
import { Button, COLORS, centerRow, label } from '../theme.js';
import { layoutCatGrid } from '../catCard.js';
import { upgradeButton } from '../upgradeButton.js';

export function createNursery(ctx: UiContext): Room {
  const shell = roomShell(ctx, 'nursery', '🏆 Питомник');

  function refresh(): void {
    shell.body.removeChildren();
    const cats = catsIn(ctx.state, 'nursery');
    const cap = nurseryCapacity(ctx.state);
    const rate = passiveRatePerMin(ctx.state);

    // шапка
    const info = label(
      `${cats.length}/${cap} котиков   ·   💰 +${rate.toFixed(rate < 10 ? 1 : 0)}/мин   ·   выбери ♀ и ♂ для вязки`,
      15, COLORS.ink, '700',
    );
    info.anchor.set(0, 0.5);
    info.position.set(2, 14);
    shell.body.addChild(info);

    // кнопка покупки кота (первый бесплатно, если котов нет)
    const cost = buyCatCost(ctx.state);
    const hasSpace = cats.length < cap;
    const buy = new Button({
      text: cost === 0 ? '🛒 Купить котика (бесплатно)' : `🛒 Купить котика (${cost} 💰)`,
      w: 240, h: 40, color: COLORS.good, fontSize: 14,
    });
    buy.enabled = hasSpace && ctx.state.coins >= cost;
    buy.position.set(shell.contentW - 124, 16);
    buy.onTap = () => {
      const r = buyCat(ctx.state, ctx.rng, ctx.now());
      if (r.ok) { ctx.commit(); ctx.toast('Новый котик в питомнике 🐱'); }
      else ctx.toast(r.reason);
    };
    shell.body.addChild(buy);

    // сетка котов
    const gridTop = 42;
    const gridH = shell.contentH - gridTop - 66;
    layoutCatGrid(ctx, shell.body, cats, 0, gridTop, shell.contentW, gridH);

    // апгрейды снизу
    const bw = Math.min(248, (shell.contentW - 14) / 2);
    const b1 = upgradeButton(ctx, 'nurseryCap', bw);
    const b2 = upgradeButton(ctx, 'show', bw);
    centerRow([b1, b2], shell.contentH - 28, shell.contentW);
    shell.body.addChild(b1, b2);
  }

  return { id: 'nursery', title: '🏆 Питомник', container: shell.container, refresh };
}
