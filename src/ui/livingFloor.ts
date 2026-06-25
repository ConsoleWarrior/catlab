/**
 * «Живой пол» комнаты: котики ходят по полу, дышат, их можно взять за шкирку
 * (поза виса + перетаскивание) и тапнуть для меню действий. Как в первом тесте,
 * но поверх игровой логики. Питомник и Приют используют это вместо карточек.
 */

import { Container, Graphics, Text } from 'pixi.js';
import type { Sprite } from 'pixi.js';
import type { Cat } from '../game/index.js';
import { isBusy, growthScale, isAdult } from '../game/index.js';
import { breedName } from '../genetics/index.js';
import type { UiContext } from './context.js';
import { catSprite, aiSitSpriteFor } from './catTextures.js';
import { COLORS, FONT, label, TIER_COLOR } from './theme.js';

export interface Band { x: number; y: number; w: number; h: number; }

interface Actor {
  cat: Cat;
  view: Container;
  sprite: Sprite;
  baseScale: number;
  busy: boolean;
  adult: boolean;            // вырос ли (для подписи и эффекта взросления)
  x: number;
  targetX: number;
  facing: 1 | -1;
  phase: number;
  nextWander: number;
  walking: boolean;
}

interface GrowFx { view: Container; sparks: Text[]; ring: Graphics; life: number; ttl: number; }

const SPEED = 64; // px/с

export function createLivingFloor(
  ctx: UiContext,
  layer: Container,
  band: Band,
  getCats: () => Cat[],
): { refresh(): void; tick(dt: number): void } {
  let actors: Actor[] = [];
  const effects: GrowFx[] = [];
  const catH = Math.max(70, Math.min(150, band.h * 0.7));
  const pad = catH * 0.45;
  const minX = band.x + pad;
  const maxX = band.x + band.w - pad;
  const baseline = band.y + band.h;

  function makeActor(cat: Cat, savedX?: number, savedFacing?: 1 | -1, savedPhase?: number): Actor {
    const busy = isBusy(ctx.state, cat.id);
    const adult = isAdult(cat, ctx.now());
    const selected = ctx.selection.includes(cat.id);
    const view = new Container();

    // тень/кружок под котиком (+ подсветка выбора для вязки)
    const ring = new Graphics();
    if (selected) ring.ellipse(0, -4, catH * 0.42, 12).fill({ color: COLORS.primary, alpha: 0.55 });
    ring.ellipse(0, -2, catH * 0.34, 8).fill({ color: 0x000000, alpha: 0.12 });
    view.addChild(ring);

    const sprite = aiSitSpriteFor(cat, catH) ?? catSprite(ctx.app, cat, catH);
    if (busy) sprite.alpha = 0.55;
    view.addChild(sprite);
    const baseScale = sprite.scale.x;

    // подпись над котиком: имя (или порода по умолчанию, пока имя не задано) + значок пола,
    // цветом редкости с белой обводкой. Имя крупнее (1.5×), значок пола — крупнее (2×),
    // поэтому это отдельные Text в общем контейнере. У котят подписи нет — имя и пол
    // проявляются только когда котёнок вырастет.
    if (adult) {
      const tierCol = TIER_COLOR[cat.rarityTier];
      const sexGlyph = cat.genotype.sex === 'female' ? '♀' : '♂';
      const display = cat.name?.trim() || breedName(cat.breed);
      const mk = (text: string, size: number): Text => new Text({
        text,
        style: {
          fontFamily: FONT, fontSize: size, fontWeight: '800', align: 'center',
          fill: tierCol, stroke: { color: 0xffffff, width: 3 },
        },
      });
      const nameT = mk(display, 20);  // 13 × 1.5
      const sexT = mk(sexGlyph, 26);  // 13 × 2
      nameT.anchor.set(0, 0.5);
      sexT.anchor.set(0, 0.5);
      const gap = 5;
      const totalW = nameT.width + gap + sexT.width;
      const caption = new Container();
      nameT.position.set(-totalW / 2, 0);
      sexT.position.set(-totalW / 2 + nameT.width + gap, 0);
      caption.addChild(nameT, sexT);
      caption.position.set(0, -(catH + 16));
      view.addChild(caption);
    }

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
    view.scale.set(growthScale(cat, ctx.now())); // котёнок появляется маленьким
    view.eventMode = 'static';
    view.cursor = busy ? 'pointer' : 'grab';

    const actor: Actor = {
      cat, view, sprite, baseScale, busy, adult,
      x, targetX: x, facing: savedFacing ?? 1,
      phase: savedPhase ?? Math.random() * 6,
      nextWander: 0.5 + Math.random() * 2.5, walking: false,
    };

    if (busy) {
      view.on('pointertap', () => ctx.openCatMenu(cat));
    } else {
      view.on('pointerdown', (e) => ctx.startGrab({
        cat,
        displayH: catH * growthScale(cat, ctx.now()), // котёнка берём «маленьким»
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

  /** Праздничный «пых» в момент взросления котёнка: кольцо + разлетающиеся искорки. */
  function spawnGrowFx(x: number, y: number): void {
    const c = new Container();
    c.position.set(x, y);
    const ring = new Graphics();
    c.addChild(ring);
    const sparks: Text[] = [];
    for (let i = 0; i < 9; i++) {
      const s = label(Math.random() < 0.5 ? '✨' : '⭐', 13 + Math.random() * 9, 0xffd86b, '700');
      s.anchor.set(0.5);
      sparks.push(s);
      c.addChild(s);
    }
    layer.addChild(c);
    effects.push({ view: c, sparks, ring, life: 0, ttl: 1.0 });
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
    const now = ctx.now();
    const matured: Actor[] = [];
    for (const a of actors) {
      a.phase += dt;
      a.view.scale.set(growthScale(a.cat, now)); // котята подрастают со временем
      // момент взросления: эффект + пересборка актёра (появятся имя/пол над головой)
      if (!a.adult && isAdult(a.cat, now)) {
        a.adult = true;
        spawnGrowFx(a.x, baseline - catH * 0.55);
        matured.push(a);
      }
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
      const sp = a.sprite;
      if (a.walking) {
        // живой «подскок»: дуга вверх + сквош-стретч + наклон вперёд по ходу
        const hop = Math.abs(Math.sin(a.phase * 10));
        a.view.y = baseline - hop * catH * 0.07;
        const sy = 1 + (hop - 0.5) * 0.12;          // в воздухе тянется, на земле приплюснут
        sp.scale.x = a.baseScale * a.facing * (1 / sy);
        sp.scale.y = a.baseScale * sy;
        sp.rotation += (a.facing * 0.06 - sp.rotation) * Math.min(1, dt * 8);
      } else {
        // покой: мягкое дыхание, выпрямляемся
        a.view.y = baseline;
        const breathe = 1 + Math.sin(a.phase * 2) * 0.02;
        sp.scale.x = a.baseScale * a.facing;
        sp.scale.y = a.baseScale * breathe;
        sp.rotation += (0 - sp.rotation) * Math.min(1, dt * 8);
      }
    }

    // пересобираем повзрослевших — чтобы появилась подпись (имя/пол)
    for (const a of matured) {
      const i = actors.indexOf(a);
      if (i < 0) continue;
      if (!a.view.visible) continue; // кота держат за шкирку — подпись появится при refresh
      a.view.destroy({ children: true });
      const na = makeActor(a.cat, a.x, a.facing, a.phase);
      actors[i] = na;
      layer.addChild(na.view);
    }

    // анимация эффектов взросления: кольцо расходится, искорки разлетаются и гаснут
    for (let k = effects.length - 1; k >= 0; k--) {
      const fx = effects[k]!;
      fx.life += dt;
      const t = Math.min(1, fx.life / fx.ttl);
      const e = 1 - (1 - t) * (1 - t);
      const r = catH * (0.15 + e * 0.7);
      fx.ring.clear();
      fx.ring.circle(0, 0, r).stroke({ width: 3 * (1 - t), color: 0xffd86b, alpha: 0.85 * (1 - t) });
      fx.sparks.forEach((s, i) => {
        const ang = (i / fx.sparks.length) * Math.PI * 2;
        s.x = Math.cos(ang) * r;
        s.y = Math.sin(ang) * r - e * catH * 0.12;
        s.alpha = 1 - t;
        s.scale.set(0.6 + e * 0.7);
      });
      if (fx.life >= fx.ttl) { fx.view.destroy({ children: true }); effects.splice(k, 1); }
    }
  }

  return { refresh, tick };
}
