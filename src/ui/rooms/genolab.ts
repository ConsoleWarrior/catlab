/**
 * Комната «Генолаб»: тратим 🧬 ДНК — открываем гены (расширяем пространство
 * окрасов и пул заказов) и качаем мутагенез/селекцию/элитный фонд.
 */

import { Container, Graphics } from 'pixi.js';
import { GENES, unlockGene } from '../../game/index.js';
import type { Room, UiContext } from '../context.js';
import { roomShell } from './shell.js';
import { Button, COLORS, centerRow, label, panel } from '../theme.js';
import { upgradeButton } from '../upgradeButton.js';

export function createGenolab(ctx: UiContext): Room {
  const shell = roomShell(ctx, 'genolab', '🔬 Генолаб');

  function geneCard(id: string, w: number, h: number): Container {
    const def = GENES[id]!;
    const card = new Container();
    card.addChild(panel(w, h, COLORS.card, 14));
    const unlocked = ctx.state.unlockedGenes.includes(id);

    const name = label(def.label, 15, COLORS.ink, '800');
    name.position.set(w / 2, 22);
    card.addChild(name);

    if (unlocked) {
      const check = new Graphics();
      check.roundRect(8, h - 40, w - 16, 30, 10).fill({ color: COLORS.good, alpha: 0.85 });
      card.addChild(check);
      const t = label('✓ открыт', 14, 0xffffff, '700');
      t.position.set(w / 2, h - 25);
      card.addChild(t);
    } else {
      const btn = new Button({
        text: `Открыть\n${def.dna} 🧬`, w: w - 16, h: 40, color: COLORS.dna, fontSize: 13,
      });
      btn.enabled = ctx.state.dna >= def.dna;
      btn.position.set(w / 2, h - 24);
      btn.onTap = () => {
        const r = unlockGene(ctx.state, id);
        if (r.ok) { ctx.commit(); ctx.toast(`Ген открыт: ${def.label}`); }
        else ctx.toast(r.reason);
      };
      card.addChild(btn);
    }
    return card;
  }

  function refresh(): void {
    shell.body.removeChildren();

    const info = label(
      `Запас ДНК: ${Math.floor(ctx.state.dna)} 🧬   ·   открывай гены — больше окрасов и заказов`,
      15, COLORS.ink, '700',
    );
    info.anchor.set(0, 0.5);
    info.position.set(2, 12);
    shell.body.addChild(info);

    // карточки генов
    const ids = Object.keys(GENES);
    const top = 36;
    const gap = 12;
    const cols = Math.min(ids.length, Math.max(3, Math.floor(shell.contentW / 160)));
    const cw = Math.min(170, (shell.contentW - gap * (cols - 1)) / cols);
    const ch = 110;
    for (let i = 0; i < ids.length; i++) {
      const col = i % cols;
      const row = Math.floor(i / cols);
      const c = geneCard(ids[i]!, cw, ch);
      c.position.set(col * (cw + gap), top + row * (ch + gap));
      shell.body.addChild(c);
    }

    // апгрейды
    const bw = Math.min(230, (shell.contentW - 28) / 3);
    const b1 = upgradeButton(ctx, 'mutation', bw);
    const b2 = upgradeButton(ctx, 'selection', bw);
    const b3 = upgradeButton(ctx, 'eliteFund', bw);
    centerRow([b1, b2, b3], shell.contentH - 28, shell.contentW);
    shell.body.addChild(b1, b2, b3);
  }

  return { id: 'genolab', title: '🔬 Генолаб', container: shell.container, refresh };
}
