/**
 * «Живой пол» комнаты: котики ходят по полу, дышат, их можно взять за шкирку
 * (поза виса + перетаскивание) и тапнуть для меню действий. Как в первом тесте,
 * но поверх игровой логики. Питомник и Приют используют это вместо карточек.
 *
 * Псевдо-3D: пол — не линия, а уходящая вглубь плоскость (см. `floorPlane` в
 * rooms/shell.ts). У каждого кота есть глубина z∈[0,1]: вдали (z=1) он выше по
 * экрану, мельче и разброс по X уже; вблизи (z=0) — крупнее, ниже, шире. Ближние
 * коты рисуются поверх дальних (сортировка по экранному Y).
 */

import { Container, Graphics, Text } from 'pixi.js';
import type { Sprite } from 'pixi.js';
import type { Cat } from '../game/index.js';
import { isBusy, growthScale, isAdult } from '../game/index.js';
import { breedName } from '../genetics/index.js';
import type { UiContext } from './context.js';
import type { FloorPlane } from './rooms/shell.js';
import { catSprite, aiSitSpriteFor, rarityGlow, GLOW_OUT } from './catTextures.js';
import { COLORS, FONT, label, stackWords, TIER_COLOR } from './theme.js';

interface Actor {
  cat: Cat;
  view: Container;
  sprite: Sprite;
  glow: Sprite;              // светящийся ореол цвета редкости (под спрайтом)
  baseScale: number;
  busy: boolean;
  adult: boolean;            // вырос ли (для подписи и эффекта взросления)
  ox: number;                // смещение от центра по X (пиксели на своей глубине)
  z: number;                 // глубина 0 (ближе) … 1 (дальше)
  targetOx: number;
  targetZ: number;
  facing: 1 | -1;
  phase: number;
  nextWander: number;
  walking: boolean;
}

interface GrowFx { view: Container; sparks: Text[]; ring: Graphics; life: number; ttl: number; }

const SPEED = 64;       // px/с по горизонтали (у ближнего края; вдали медленнее)
const Z_SPEED = 0.18;   // доля глубины в секунду (медленный дрейф «вглубь/наружу»)

// Память поз котов между пересборками комнат (ресайз окна пересоздаёт «живой
// пол» целиком). Смещение по X храним нормированным (u = ox/maxOx ∈ [-1..1]),
// чтобы оно переносилось на другой размер комнаты. Без этого каждый ресайз
// рассыпал котов по новым случайным местам.
const posMemory = new Map<string, { u: number; z: number; facing: 1 | -1; phase: number }>();

const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;

export function createLivingFloor(
  ctx: UiContext,
  layer: Container,
  plane: FloorPlane,
  getCats: () => Cat[],
): { refresh(): void; tick(dt: number): void } {
  let actors: Actor[] = [];
  const effects: GrowFx[] = [];
  const { centerX, yNear, yFar, nearHalfW, farHalfW, catH, farScale } = plane;
  layer.sortableChildren = true; // ближние коты (больший Y) рисуются поверх дальних

  // геометрия глубины
  const yAt = (z: number): number => lerp(yNear, yFar, z);
  const depthScale = (z: number): number => lerp(1, farScale, z);
  // максимальное смещение по X на данной глубине (с отступом под полспрайта,
  // чтобы кот не «вылезал» на боковую стену)
  const maxOx = (z: number): number => {
    const pad = catH * 0.3 * depthScale(z);
    return Math.max(10, lerp(nearHalfW, farHalfW, z) - pad);
  };

  function makeActor(cat: Cat, savedOx?: number, savedZ?: number, savedFacing?: 1 | -1, savedPhase?: number): Actor {
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
    // ореол редкости — под спрайтом, чтобы наружу выходила лишь цветная кромка
    const glow = rarityGlow(sprite, cat.rarityTier, catH);
    if (busy) glow.alpha *= 0.5;
    view.addChild(glow);
    view.addChild(sprite);
    const baseScale = sprite.scale.x;

    // подпись над котиком: имя (или порода по умолчанию, пока имя не задано) + значок пола,
    // цветом редкости с белой обводкой. Имя крупнее (1.5×), значок пола — крупнее (2×),
    // поэтому это отдельные Text в общем контейнере. У котят подписи нет — имя и пол
    // проявляются только когда котёнок вырастет.
    if (adult) {
      const tierCol = TIER_COLOR[cat.rarityTier];
      const sexGlyph = cat.genotype.sex === 'female' ? '♀' : '♂';
      const display = stackWords(cat.name?.trim() || breedName(cat.breed));
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

    const mem = posMemory.get(cat.id);
    const z = savedZ ?? mem?.z ?? Math.random();
    const ox = savedOx ?? (mem ? mem.u * maxOx(z) : (Math.random() * 2 - 1) * maxOx(z));
    view.position.set(centerX + ox, yAt(z));
    view.scale.set(growthScale(cat, ctx.now()) * depthScale(z)); // котёнок мал + перспектива
    view.zIndex = Math.round(yAt(z));
    view.eventMode = 'static';
    view.cursor = busy ? 'pointer' : 'grab';

    const actor: Actor = {
      cat, view, sprite, glow, baseScale, busy, adult,
      ox, z, targetOx: ox, targetZ: z, facing: savedFacing ?? mem?.facing ?? 1,
      phase: savedPhase ?? mem?.phase ?? Math.random() * 6,
      nextWander: 0.5 + Math.random() * 2.5, walking: false,
    };

    if (busy) {
      view.on('pointertap', () => ctx.openCatMenu(cat));
    } else {
      view.on('pointerdown', (e) => ctx.startGrab({
        cat,
        // «на весу» кот того же размера, что и на полу (с учётом роста и глубины)
        displayH: catH * growthScale(cat, ctx.now()) * depthScale(actor.z),
        hide: () => { view.visible = false; },
        show: () => { view.visible = true; },
        onTap: () => ctx.openCatMenu(cat),
        onDrop: (gx, gy) => {
          // gx/gy — координаты виртуальной сцены (uiRoot) → в систему слоя пола
          const lp = layer.toLocal({ x: gx, y: gy ?? 0 }, ctx.uiRoot);
          if (gy === undefined) lp.y = yAt(actor.z);
          // глубина из точки сброса по Y (вне диапазона — прижимаем к краю)
          const nz = Math.max(0, Math.min(1, (yNear - lp.y) / Math.max(1, yNear - yFar)));
          const m = maxOx(nz);
          actor.z = nz;
          actor.ox = Math.max(-m, Math.min(m, lp.x - centerX));
          actor.targetZ = nz;
          actor.targetOx = actor.ox;
          view.scale.set(growthScale(cat, ctx.now()) * depthScale(nz));
          view.position.set(centerX + actor.ox, yAt(nz));
          view.zIndex = Math.round(yAt(nz));
        },
      }, e));
    }
    return actor;
  }

  /** Праздничный «пых» в момент взросления котёнка: кольцо + разлетающиеся искорки. */
  function spawnGrowFx(x: number, y: number): void {
    const c = new Container();
    c.position.set(x, y);
    c.zIndex = 1e6; // искорки поверх всех котов
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
      const a = makeActor(cat, p?.ox, p?.z, p?.facing, p?.phase);
      layer.addChild(a.view);
      return a;
    });
  }

  function tick(dt: number): void {
    const now = ctx.now();
    const matured: Actor[] = [];
    for (const a of actors) {
      a.phase += dt;
      const ds = depthScale(a.z);
      a.view.scale.set(growthScale(a.cat, now) * ds); // котята подрастают + перспектива
      a.view.zIndex = Math.round(yAt(a.z));
      // запоминаем позу — переживает пересборку комнаты при ресайзе окна
      posMemory.set(a.cat.id, { u: a.ox / Math.max(1, maxOx(a.z)), z: a.z, facing: a.facing, phase: a.phase });
      // момент взросления: эффект + пересборка актёра (появятся имя/пол над головой)
      if (!a.adult && isAdult(a.cat, now)) {
        a.adult = true;
        spawnGrowFx(centerX + a.ox, yAt(a.z) - catH * 0.55 * ds);
        matured.push(a);
      }
      if (a.busy || !a.view.visible) continue;
      a.nextWander -= dt;
      if (a.nextWander <= 0) {
        a.targetZ = Math.random();
        a.targetOx = (Math.random() * 2 - 1) * maxOx(a.targetZ);
        a.nextWander = 1.4 + Math.random() * 3;
      }
      // дрейф вглубь/наружу
      const dz = a.targetZ - a.z;
      const movingZ = Math.abs(dz) > 0.01;
      if (movingZ) a.z += Math.sign(dz) * Math.min(Math.abs(dz), Z_SPEED * dt);
      const dsz = depthScale(a.z);
      // ход по горизонтали (скорость в пикселях падает с глубиной)
      const dox = a.targetOx - a.ox;
      const movingX = Math.abs(dox) > 3;
      if (movingX) {
        a.facing = (Math.sign(dox) || 1) as 1 | -1;
        a.ox += a.facing * Math.min(Math.abs(dox), SPEED * dsz * dt);
      }
      const m = maxOx(a.z);
      a.ox = Math.max(-m, Math.min(m, a.ox));
      a.walking = movingX || movingZ;

      a.view.x = centerX + a.ox;
      const baseY = yAt(a.z);
      const sp = a.sprite;
      if (a.walking) {
        // живой «подскок»: дуга вверх + сквош-стретч + наклон вперёд по ходу
        const hop = Math.abs(Math.sin(a.phase * 10));
        a.view.y = baseY - hop * catH * 0.07 * dsz;
        const sy = 1 + (hop - 0.5) * 0.12;          // в воздухе тянется, на земле приплюснут
        sp.scale.x = a.baseScale * a.facing * (1 / sy);
        sp.scale.y = a.baseScale * sy;
        sp.rotation += (a.facing * 0.06 - sp.rotation) * Math.min(1, dt * 8);
      } else {
        // покой: мягкое дыхание, выпрямляемся
        a.view.y = baseY;
        const breathe = 1 + Math.sin(a.phase * 2) * 0.02;
        sp.scale.x = a.baseScale * a.facing;
        sp.scale.y = a.baseScale * breathe;
        sp.rotation += (0 - sp.rotation) * Math.min(1, dt * 8);
      }
      // ореол повторяет позу кота (разворот/сквош/наклон)
      a.glow.scale.set(sp.scale.x * GLOW_OUT, sp.scale.y * GLOW_OUT);
      a.glow.rotation = sp.rotation;
    }

    // пересобираем повзрослевших — чтобы появилась подпись (имя/пол)
    for (const a of matured) {
      const i = actors.indexOf(a);
      if (i < 0) continue;
      if (!a.view.visible) continue; // кота держат за шкирку — подпись появится при refresh
      a.view.destroy({ children: true });
      const na = makeActor(a.cat, a.ox, a.z, a.facing, a.phase);
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
