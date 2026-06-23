/**
 * Комната «Инкубатор»: слоты вязки (выбор пары → таймер → котёнок),
 * апгрейды слотов и скорости. Пара выбирается в Питомнике (ctx.selection).
 */

import { Container, Graphics } from 'pixi.js';
import type { Text } from 'pixi.js';
import type { Cat } from '../../game/index.js';
import {
  startBreeding, collectReady, incubationDuration, nurseryCapacity, catsIn,
} from '../../game/index.js';
import type { Room, UiContext } from '../context.js';
import { roomShell } from './shell.js';
import { Button, COLORS, centerRow, label, panel } from '../theme.js';
import { catSprite } from '../catTextures.js';
import { upgradeButton } from '../upgradeButton.js';

interface LiveSlot { index: number; total: number; bar: Graphics; barX: number; barY: number; barW: number; time: Text; }

function mmss(ms: number): string {
  const s = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

export function createIncubator(ctx: UiContext): Room {
  const shell = roomShell(ctx, 'incubator', '🧬 Инкубатор');
  let live: LiveSlot[] = [];

  function selectedPair(): { mother?: Cat; father?: Cat } {
    const sel = ctx.selection
      .map((id) => ctx.state.cats.find((c) => c.id === id))
      .filter((c): c is Cat => !!c);
    return {
      mother: sel.find((c) => c.genotype.sex === 'female'),
      father: sel.find((c) => c.genotype.sex === 'male'),
    };
  }

  function portrait(cat: Cat | undefined, glyph: string, x: number, y: number, size: number, parent: Container): void {
    const box = new Graphics();
    box.roundRect(x - size / 2, y - size / 2, size, size, 12)
      .fill({ color: 0xffffff, alpha: 0.6 }).stroke({ width: 2, color: COLORS.cardEdge });
    parent.addChild(box);
    if (cat) {
      const sp = catSprite(ctx.app, cat, size * 0.82);
      sp.position.set(x, y + size * 0.4);
      parent.addChild(sp);
    } else {
      const q = label(glyph, 24, COLORS.inkSoft, '700');
      q.position.set(x, y);
      parent.addChild(q);
    }
  }

  function buildSlot(i: number, w: number, h: number): Container {
    const card = new Container();
    card.addChild(panel(w, h, COLORS.card, 16));
    const slot = ctx.state.slots[i]!;
    const now = ctx.now();
    const busy = slot.readyAt > 0;
    const ready = busy && now >= slot.readyAt;

    const head = label(`Слот ${i + 1}`, 14, COLORS.inkSoft, '700');
    head.position.set(w / 2, 18);
    card.addChild(head);

    if (!busy) {
      const { mother, father } = selectedPair();
      portrait(mother, '♀ ?', w * 0.3, h * 0.42, w * 0.34, card);
      portrait(father, '♂ ?', w * 0.7, h * 0.42, w * 0.34, card);
      const heart = label('🤍', 20, COLORS.ink, '700');
      heart.position.set(w / 2, h * 0.42);
      card.addChild(heart);

      const pending = ctx.state.slots.filter((s) => s.readyAt > 0).length;
      const hasSpace = catsIn(ctx.state, 'nursery').length + pending < nurseryCapacity(ctx.state);
      const ok = !!mother && !!father && hasSpace;
      const btn = new Button({
        text: ok ? 'Свести 🐾' : (mother && father ? 'Нет места' : 'Выбрать пару'),
        w: w - 28, h: 44, color: ok ? COLORS.primary : COLORS.cardEdge,
        textColor: ok ? 0xffffff : COLORS.inkSoft, fontSize: 16,
      });
      btn.enabled = ok;
      btn.position.set(w / 2, h - 58);
      btn.onTap = () => {
        const r = startBreeding(ctx.state, i, mother!.id, father!.id, ctx.now());
        if (r.ok) { ctx.clearSelection(); ctx.commit(); ctx.toast('Вязка началась 🐾'); }
        else ctx.toast(r.reason);
      };
      card.addChild(btn);

      const hint = label('пара выбирается\nв Питомнике', 12, COLORS.inkSoft, '600');
      hint.position.set(w / 2, h - 20);
      card.addChild(hint);
    } else {
      const mom = slot.motherId ? ctx.state.cats.find((c) => c.id === slot.motherId) : undefined;
      const dad = slot.fatherId ? ctx.state.cats.find((c) => c.id === slot.fatherId) : undefined;
      portrait(mom, '♀', w * 0.3, h * 0.34, w * 0.3, card);
      portrait(dad, '♂', w * 0.7, h * 0.34, w * 0.3, card);

      const total = incubationDuration(ctx.state);
      const barX = 18;
      const barY = h * 0.64;
      const barW = w - 36;
      const barBg = new Graphics();
      barBg.roundRect(barX, barY, barW, 16, 8).fill({ color: 0x000000, alpha: 0.08 });
      card.addChild(barBg);
      const bar = new Graphics();
      card.addChild(bar);
      const time = label('', 14, COLORS.ink, '700');
      time.position.set(w / 2, barY + 32);
      card.addChild(time);
      live.push({ index: i, total, bar, barX, barY, barW, time });

      if (ready) {
        const btn = new Button({ text: 'Забрать 🐾', w: w - 28, h: 42, color: COLORS.good, fontSize: 16 });
        btn.position.set(w / 2, h - 30);
        btn.onTap = () => {
          const events = collectReady(ctx.state, ctx.now(), ctx.rng);
          ctx.commit();
          const born = events.filter((e) => e.kitten).length;
          const dead = events.filter((e) => e.stillborn).length;
          ctx.toast(born ? `Родился котёнок! 🐱` : dead ? 'Котёнок не выжил 😿' : 'Готово');
        };
        card.addChild(btn);
      }
    }
    return card;
  }

  function refresh(): void {
    shell.body.removeChildren();
    live = [];
    const n = ctx.state.slots.length;
    const gap = 14;
    const slotW = Math.min(230, (shell.contentW - gap * (n - 1)) / n);
    const slotH = Math.min(260, shell.contentH * 0.66);
    const totalW = slotW * n + gap * (n - 1);
    const startX = Math.max(0, (shell.contentW - totalW) / 2);
    for (let i = 0; i < n; i++) {
      const c = buildSlot(i, slotW, slotH);
      c.position.set(startX + i * (slotW + gap), 0);
      shell.body.addChild(c);
    }

    const bw = Math.min(248, (shell.contentW - 14) / 2);
    const b1 = upgradeButton(ctx, 'slots', bw);
    const b2 = upgradeButton(ctx, 'speed', bw);
    centerRow([b1, b2], slotH + 32, shell.contentW);
    shell.body.addChild(b1, b2);
  }

  function tick(): void {
    const now = ctx.now();
    for (const ls of live) {
      const slot = ctx.state.slots[ls.index];
      if (!slot || slot.readyAt === 0) continue;
      const remain = slot.readyAt - now;
      const prog = Math.max(0, Math.min(1, 1 - remain / ls.total));
      ls.bar.clear();
      ls.bar.roundRect(ls.barX, ls.barY, Math.max(2, ls.barW * prog), 16, 8)
        .fill(remain <= 0 ? COLORS.good : COLORS.primary);
      ls.time.text = remain <= 0 ? 'Готово! 🥚' : mmss(remain);
    }
  }

  return { id: 'incubator', title: '🧬 Инкубатор', container: shell.container, refresh, tick };
}
