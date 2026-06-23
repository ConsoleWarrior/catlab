/**
 * Карточка кота для сеток Питомника/Приюта: спрайт + звёзды + пол,
 * подсветка выбора для вязки и бейдж «занят». Тап → меню кота.
 */

import { Container, Graphics } from 'pixi.js';
import type { Cat } from '../game/index.js';
import { isBusy } from '../game/index.js';
import type { UiContext } from './context.js';
import { catSprite } from './catTextures.js';
import { COLORS, label, panel, stars, TIER_COLOR } from './theme.js';
import { gridLayout } from './rooms/shell.js';

export function catCard(ctx: UiContext, cat: Cat, w: number, h: number): Container {
  const card = new Container();
  const selected = ctx.selection.includes(cat.id);
  const busy = isBusy(ctx.state, cat.id);

  card.addChild(panel(w, h, COLORS.card, 14));

  // рамка-подсветка выбранного для вязки
  if (selected) {
    const ring = new Graphics();
    ring.roundRect(1, 1, w - 2, h - 2, 13).stroke({ width: 4, color: COLORS.primary });
    card.addChild(ring);
  }

  const sp = catSprite(ctx.app, cat, h * 0.62);
  sp.position.set(w / 2, h * 0.74);
  card.addChild(sp);

  const st = stars(cat.rarityTier, 12);
  st.position.set(w / 2, h - 14);
  card.addChild(st);

  // пол в углу
  const sex = label(cat.genotype.sex === 'female' ? '♀' : '♂', 16,
    cat.genotype.sex === 'female' ? 0xe87da9 : 0x5a9be0, '800');
  sex.anchor.set(0, 0);
  sex.position.set(7, 5);
  card.addChild(sex);

  if (selected) {
    const tag = label('🐾', 15, 0xffffff, '700');
    tag.anchor.set(1, 0);
    tag.position.set(w - 6, 4);
    card.addChild(tag);
  }

  if (busy) {
    const veil = new Graphics();
    veil.roundRect(0, 0, w, h, 14).fill({ color: 0xffffff, alpha: 0.45 });
    card.addChild(veil);
    const z = label('💤', 18, COLORS.ink, '700');
    z.position.set(w / 2, h / 2);
    card.addChild(z);
  }

  // тонкая полоса цвета тира снизу
  const bar = new Graphics();
  bar.roundRect(8, h - 4, w - 16, 3, 2).fill(TIER_COLOR[cat.rarityTier]);
  card.addChild(bar);

  card.eventMode = 'static';
  card.cursor = 'pointer';
  card.on('pointertap', () => ctx.openCatMenu(cat));
  return card;
}

/** Раскладывает сетку карточек котов в прямоугольнике (x,y,w,h). */
export function layoutCatGrid(
  ctx: UiContext,
  parent: Container,
  cats: Cat[],
  x: number,
  y: number,
  w: number,
  h: number,
): void {
  if (cats.length === 0) {
    const empty = label('пока пусто', 16, COLORS.inkSoft, '600');
    empty.position.set(x + w / 2, y + h / 2);
    parent.addChild(empty);
    return;
  }
  const g = gridLayout(cats.length, w, h);
  const cellW = Math.min(g.cw, 140);
  const cellH = Math.min(g.ch, 168);
  const usedW = cellW * g.cols + g.gap * (g.cols - 1);
  const ox = x + Math.max(0, (w - usedW) / 2);
  for (let i = 0; i < cats.length; i++) {
    const col = i % g.cols;
    const row = Math.floor(i / g.cols);
    const card = catCard(ctx, cats[i]!, cellW, cellH);
    card.position.set(ox + col * (cellW + g.gap), y + row * (cellH + g.gap));
    parent.addChild(card);
  }
}
