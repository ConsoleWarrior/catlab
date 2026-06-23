/**
 * Комната «Питомник»: ценные коты, пассивный доход, племфонд для вязки.
 * Тап по коту → меню (выбрать для вязки / в приют / анализ).
 */

import { Container } from 'pixi.js';
import { catsIn, nurseryCapacity, passiveRatePerMin } from '../../game/index.js';
import type { Room, UiContext } from '../context.js';
import { roomShell } from './shell.js';
import { COLORS, label } from '../theme.js';
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
    const header = new Container();
    const info = label(
      `${cats.length}/${cap} котиков   ·   💰 +${rate.toFixed(rate < 10 ? 1 : 0)}/мин   ·   выбери ♀ и ♂ для вязки`,
      15, COLORS.ink, '700',
    );
    info.anchor.set(0, 0.5);
    info.position.set(2, 12);
    header.addChild(info);
    shell.body.addChild(header);

    // сетка котов
    const gridTop = 34;
    const gridH = shell.contentH - gridTop - 66;
    layoutCatGrid(ctx, shell.body, cats, 0, gridTop, shell.contentW, gridH);

    // апгрейды снизу
    const b1 = upgradeButton(ctx, 'nurseryCap', 248);
    const b2 = upgradeButton(ctx, 'show', 248);
    b1.position.set(shell.contentW / 2 - 132, shell.contentH - 28);
    b2.position.set(shell.contentW / 2 + 132, shell.contentH - 28);
    shell.body.addChild(b1, b2);
  }

  return { id: 'nursery', title: '🏆 Питомник', container: shell.container, refresh };
}
