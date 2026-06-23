/**
 * «Живой пол» комнаты: котики ходят по полу, дышат, их можно взять за шкирку
 * (поза виса + перетаскивание) и тапнуть для меню действий. Как в первом тесте,
 * но поверх игровой логики. Питомник и Приют используют это вместо карточек.
 */

import { Container, Graphics } from 'pixi.js';
import type { Sprite } from 'pixi.js';
import type { Cat } from '../game/index.js';
import { isBusy } from '../game/index.js';
import type { UiContext } from './context.js';
import { catSprite } from './catTextures.js';
import { COLORS, label } from './theme.js';

export interface Band { x: number; y: number; w: number; h: number; }

interface Actor {
  cat: Cat;
  view: Container;
  sprite: Sprite;
  baseScale: number;
  busy: boolean;
  x: number;
  targetX: number;
  facing: 1 | -1;
  phase: number;
  nextWander: number;
  walking: boolean;
}

const SPEED = 64; // px/с

export function createLivingFloor(
  ctx: UiContext,
  layer: Container,
  band: Band,
  getCats: () => Cat[],
): { refresh(): void; tick(dt: number): void } {
  let actors: Actor[] = [];
  const catH = Math.max(70, Math.min(150, band.h * 0.7));
  const pad = catH * 0.45;
  const minX = band.x + pad;
  const maxX = band.x + band.w - pad;
  const baseline = band.y + band.h;

  function makeActor(cat: Cat, savedX?: number, savedFacing?: 1 | -1, savedPhase?: number): Actor {
    const busy = isBusy(ctx.state, cat.id);
    const selected = ctx.selection.includes(cat.id);
    const view = new Container();

    // тень/кружок под котиком (+ подсветка выбора для вязки)
    const ring = new Graphics();
    if (selected) ring.ellipse(0, -4, catH * 0.42, 12).fill({ color: COLORS.primary, alpha: 0.55 });
    ring.ellipse(0, -2, catH * 0.34, 8).fill({ color: 0x000000, alpha: 0.12 });
    view.addChild(ring);

    const sprite = catSprite(ctx.app, cat, catH);
    if (busy) sprite.alpha = 0.55;
    view.addChild(sprite);
    const baseScale = sprite.scale.x;

    if (selected) {
      const paw = label('🐾', 18, 0xffffff, '700');
      paw.position.set(0, -catH * 0.95);
      view.addChild(paw);
    }
    if (busy) {
      const z = label('💤', 18, COLORS.ink, '700');
      z.position.set(catH * 0.34, -catH * 0.92);
      view.addChild(z);
    }

    const x = savedX ?? (minX + Math.random() * (maxX - minX));
    view.position.set(x, baseline);
    view.eventMode = 'static';
    view.cursor = busy ? 'pointer' : 'grab';

    const actor: Actor = {
      cat, view, sprite, baseScale, busy,
      x, targetX: x, facing: savedFacing ?? 1,
      phase: savedPhase ?? Math.random() * 6,
      nextWander: 0.5 + Math.random() * 2.5, walking: false,
    };

    if (busy) {
      view.on('pointertap', () => ctx.openCatMenu(cat));
    } else {
      view.on('pointerdown', (e) => ctx.startGrab({
        cat,
        displayH: catH,
        hide: () => { view.visible = false; },
        show: () => { view.visible = true; },
        onTap: () => ctx.openCatMenu(cat),
        onDrop: (gx) => {
          const lx = layer.toLocal({ x: gx, y: 0 }).x;
          actor.x = Math.max(minX, Math.min(maxX, lx));
          actor.targetX = actor.x;
          view.x = actor.x;
        },
      }, e));
    }
    return actor;
  }

  function refresh(): void {
    const prev = new Map(actors.map((a) => [a.cat.id, a]));
    const cats = getCats();
    const keep = new Set(cats.map((c) => c.id));
    for (const a of actors) if (!keep.has(a.cat.id)) a.view.destroy({ children: true });
    actors = cats.map((cat) => {
      const p = prev.get(cat.id);
      if (p) p.view.destroy({ children: true }); // пересобираем (выбор/занятость могли измениться)
      const a = makeActor(cat, p?.x, p?.facing, p?.phase);
      layer.addChild(a.view);
      return a;
    });
  }

  function tick(dt: number): void {
    for (const a of actors) {
      a.phase += dt;
      if (a.busy || !a.view.visible) continue;
      a.nextWander -= dt;
      if (a.nextWander <= 0) {
        a.targetX = Math.max(minX, Math.min(maxX, a.x + (Math.random() - 0.5) * band.w * 0.5));
        a.nextWander = 1.4 + Math.random() * 3;
      }
      const dx = a.targetX - a.x;
      a.walking = Math.abs(dx) > 3;
      if (a.walking) {
        a.facing = (Math.sign(dx) || 1) as 1 | -1;
        a.x += a.facing * Math.min(Math.abs(dx), SPEED * dt);
      }
      a.view.x = a.x;
      const breathe = 1 + Math.sin(a.phase * (a.walking ? 9 : 2)) * (a.walking ? 0.05 : 0.02);
      a.sprite.scale.x = a.baseScale * a.facing;
      a.sprite.scale.y = a.baseScale * breathe;
      a.view.y = baseline + (a.walking ? -Math.abs(Math.sin(a.phase * 9)) * 4 : 0);
    }
  }

  return { refresh, tick };
}
