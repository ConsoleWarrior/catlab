/**
 * Комната «Приют»: котики-метисы ждут, пока их пристроят «в добрые руки».
 * Тап по коту → меню (пристроить → 💰+🧬 / вернуть в питомник).
 */

import { catsIn, shelterCapacity } from '../../game/index.js';
import type { Room, UiContext } from '../context.js';
import { roomShell } from './shell.js';
import { COLORS, label } from '../theme.js';
import { layoutCatGrid } from '../catCard.js';
import { upgradeButton } from '../upgradeButton.js';

export function createShelter(ctx: UiContext): Room {
  const shell = roomShell(ctx, 'shelter', '🏠 Приют');

  function refresh(): void {
    shell.body.removeChildren();
    const cats = catsIn(ctx.state, 'shelter');
    const cap = shelterCapacity(ctx.state);

    const info = label(
      `${cats.length}/${cap} котиков ждут добрые руки   ·   пристрой → 💰 + 🧬`,
      15, COLORS.ink, '700',
    );
    info.anchor.set(0, 0.5);
    info.position.set(2, 12);
    shell.body.addChild(info);

    const gridTop = 34;
    const gridH = shell.contentH - gridTop - 66;
    layoutCatGrid(ctx, shell.body, cats, 0, gridTop, shell.contentW, gridH);

    const b1 = upgradeButton(ctx, 'shelterCap', 240);
    const b2 = upgradeButton(ctx, 'connections', 240);
    const b3 = upgradeButton(ctx, 'biobank', 240);
    const cx = shell.contentW / 2;
    b1.position.set(cx - 256, shell.contentH - 28);
    b2.position.set(cx, shell.contentH - 28);
    b3.position.set(cx + 256, shell.contentH - 28);
    shell.body.addChild(b1, b2, b3);
  }

  return { id: 'shelter', title: '🏠 Приют', container: shell.container, refresh };
}
