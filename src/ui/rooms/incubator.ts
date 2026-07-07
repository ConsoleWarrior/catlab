/**
 * Комната «Инкубатор»: места вязки (выбор пары → таймер → котёнок).
 * Пара выбирается в Питомнике (ctx.selection). Апгрейды слотов вязки и
 * скорости инкубации переехали в Генолаб → Исследования (4-я ветка).
 * Справа от названия — чипы усилителей вязки (Генная инженерия): активируешь
 * за 🧬 гены или 💎 кристаллы, заряженный чип «горит» и срабатывает на первой
 * следующей вязке.
 *
 * Визуал места вязки — мини-комната с перегородкой по центру. В покое перегородка
 * опущена, коты стоят по разные стороны. По кнопке «Свести» перегородка
 * поднимается, коты сходятся к центру и трутся боками, вверх всплывают сердечки.
 */

import { Container, Graphics, Sprite, Text } from 'pixi.js';
import type { Cat, BoostDef } from '../../game/index.js';
import {
  startBreeding, assignBreeder, incubationDuration, BOOSTS, boostCharges, growthScale,
  moveCat, roomCount, nurseryCapacity, shelterCapacity,
  buyUpgrade, upgradeCost, upgradeMaxed,
} from '../../game/index.js';
import type { Room, UiContext } from '../context.js';
import { roomShell } from './shell.js';
import { Button, COLORS, FONT, label, panel } from '../theme.js';
import { catSprite, rarityGlow, GLOW_OUT } from '../catTextures.js';
import { decorTexture } from '../decorArt.js';
import { darken } from '../../render/palette.js';

const APPROACH_MS = 900; // за это время перегородка поднимается, а коты сходятся

// ИИ-фоны боксов вязки (src/assets/slotbox/*_cut.webp) — вырезки с прозрачностью,
// используются как полноценный фон всей карточки слота. Один вариант на все слоты.
const SLOT_BOX_SPRITES = ['slotbox_glass_cut', 'slotbox_glass_cut', 'slotbox_glass_cut'];

// Акцент свечения заряженного усилителя — в тон его текстуры (boost_<id>.webp).
// После перемаппинга: стабилизатор→зелёный, катализатор→синий, активатор→оранжевый.
const BOOST_ACCENT: Record<string, number> = {
  noDown: 0x3fe08c, luckyUp: 0x59b1ff, tierUp: 0xffab3d,
};

interface Heart { view: Text; life: number; ttl: number; vx: number; }
interface Spark { view: Text; life: number; ttl: number; vx: number; vy: number; rot: number; }

interface LiveSlot {
  index: number;
  card: Container;            // карточка слота — для попадания при перетаскивании
  total: number;
  bar?: Graphics; barX: number; barY: number; barW: number; time?: Text;
  busy: boolean;
  startedAt: number;
  partition: Graphics; partRaise: number;
  mom?: Sprite; dad?: Sprite;
  momGlow?: Sprite; dadGlow?: Sprite; kitGlow?: Sprite;  // ореолы редкости (под спрайтами)
  kitten?: Sprite; kittenBase: number; kittenCat?: Cat;  // «оставленный с роднёй» малыш в центре
  momHomeX: number; momMeetX: number; dadHomeX: number; dadMeetX: number;
  momBase: number; dadBase: number;
  catBaseY: number; catH: number;
  hearts: Container; heartObjs: Heart[]; heartTimer: number;
  // эффект рождения: малыш только что появился в слоте → искры + кольцо-вспышка + «поп»
  fx: Container; fxX: number; fxY: number;
  pendingFx: boolean; sparks: Spark[]; ring?: Graphics; ringLife: number; ringTtl: number;
  kittenPop: number;
  phase: number;
}

function mmss(ms: number): string {
  const s = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

/** Ореол редкости повторяет позу своего кота (положение/сквош/наклон). */
function syncGlow(sp?: Sprite, g?: Sprite): void {
  if (!sp || !g) return;
  g.position.copyFrom(sp.position);
  g.scale.set(sp.scale.x * GLOW_OUT, sp.scale.y * GLOW_OUT);
  g.rotation = sp.rotation;
}

const clamp01 = (v: number): number => Math.max(0, Math.min(1, v));
const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;
const easeOut = (t: number): number => 1 - (1 - t) * (1 - t);

export function createIncubator(ctx: UiContext): Room {
  const shell = roomShell(ctx, 'incubator', '🧬 Инкубатор');
  let live: LiveSlot[] = [];
  // id малышей, чьё «рождение» уже отпраздновали эффектом — чтобы не повторять
  // вспышку на каждом пересборе. Эффект играет один раз, когда малыш виден.
  const celebrated = new Set<string>();

  // --- Усилители вязки (Генная инженерия) у названия комнаты ---
  // Кнопки-чипы справа от заголовка. Заряженный усилитель «горит» (яркая
  // заливка + пульсирующий ореол) и сработает на первой следующей вязке.
  const boostBar = new Container();
  shell.titleBar.addChild(boostBar);
  let boostGlows: { halo: Graphics; phase: number }[] = [];

  // Чип усилителя — кнопка с ИИ-текстурой (boost_<id>.webp) и читаемым названием.
  const CHIP_W = 118, CHIP_H = 38;

  function boostChip(def: BoostDef): Container {
    const c = new Container();
    const charges = boostCharges(ctx.state, def.id);
    const active = charges > 0;
    const accent = BOOST_ACCENT[def.id] ?? COLORS.dna;
    const w = CHIP_W, h = CHIP_H;

    if (active) {
      const halo = new Graphics();
      halo.roundRect(-w / 2 - 5, -h / 2 - 5, w + 10, h + 10, 14)
        .fill({ color: accent, alpha: 0.68 });
      c.addChild(halo);
      boostGlows.push({ halo, phase: Math.random() * 6 });
    }

    const tex = decorTexture(`boost_${def.id}`);
    if (tex) {
      // текстурная подложка: cover-вписывание + скруглённая маска.
      // Незаряженный чип «потушен» (серый тинт), заряженный горит в полный цвет.
      const sp = new Sprite(tex);
      sp.anchor.set(0.5);
      sp.scale.set(Math.max(w / tex.width, h / tex.height));
      const m = new Graphics();
      m.roundRect(-w / 2, -h / 2, w, h, 11).fill(0xffffff);
      sp.mask = m;
      if (!active) { sp.tint = 0x8f8f8f; sp.alpha = 0.9; }
      const edge = new Graphics();
      edge.roundRect(-w / 2, -h / 2, w, h, 11)
        .stroke({ width: 2, color: active ? 0xffffff : COLORS.cardEdge, alpha: active ? 0.95 : 0.9 });
      c.addChild(sp, m, edge);
    } else {
      const bg = new Graphics();
      bg.roundRect(-w / 2, -h / 2, w, h, 11)
        .fill({ color: active ? COLORS.dna : COLORS.card, alpha: active ? 1 : 0.92 })
        .stroke({ width: 2, color: active ? 0xffffff : COLORS.cardEdge, alpha: active ? 0.95 : 0.8 });
      c.addChild(bg);
    }

    const glyph = label(def.glyph, 15, 0xffffff, '700');
    glyph.position.set(-w / 2 + 15, 0);
    glyph.alpha = active ? 1 : 0.85;
    // название — белым с тёмной обводкой: читается на любой текстуре
    const name = new Text({
      text: def.label,
      style: {
        fontFamily: FONT, fontSize: 11.5, fontWeight: '800', fill: 0xffffff,
        stroke: { color: 0x2c2438, width: 3, join: 'round' }, align: 'center',
      },
    });
    name.anchor.set(0.5);
    name.position.set(8, 0);
    c.addChild(glyph, name);

    if (charges > 1) {
      const badge = new Graphics();
      badge.circle(w / 2 - 3, -h / 2 + 3, 8).fill({ color: COLORS.good });
      const cnt = label(String(charges), 11, 0xffffff, '800');
      cnt.position.set(w / 2 - 3, -h / 2 + 3);
      c.addChild(badge, cnt);
    }

    c.eventMode = 'static';
    c.cursor = 'pointer';
    c.on('pointertap', () => ctx.openBoostMenu(def.id));
    return c;
  }

  function renderBoostChips(plateW: number): void {
    boostBar.removeChildren();
    boostGlows = [];
    const gap = 8;
    // чипы стоят справа от плашки названия, вплотную (boostBar — в локальных
    // координатах titleBar; plateW — ширина плашки со счётчиком слотов).
    const firstCx = plateW + 12 + CHIP_W / 2;
    BOOSTS.forEach((def, i) => {
      const chip = boostChip(def);
      chip.position.set(firstCx + i * (CHIP_W + gap), shell.titleH / 2);
      boostBar.addChild(chip);
    });
  }

  function selectedPair(): { mother?: Cat; father?: Cat } {
    const sel = ctx.selection
      .map((id) => ctx.state.cats.find((c) => c.id === id))
      .filter((c): c is Cat => !!c);
    return {
      mother: sel.find((c) => c.genotype.sex === 'female'),
      father: sel.find((c) => c.genotype.sex === 'male'),
    };
  }

  function spawnHeart(ls: LiveSlot): void {
    const t = label('💗', 13 + Math.random() * 7, 0xff6b8a, '700');
    t.x = (ls.momMeetX + ls.dadMeetX) / 2 + (Math.random() - 0.5) * ls.catH * 0.5;
    t.y = ls.catBaseY - ls.catH * (0.55 + Math.random() * 0.2);
    ls.hearts.addChild(t);
    ls.heartObjs.push({ view: t, life: 0, ttl: 1.0 + Math.random() * 0.6, vx: (Math.random() - 0.5) * 18 });
  }

  // Красивый «салют» при появлении малыша в слоте: кольцо-вспышка + венок искр
  // во все стороны. Малыш в этот момент делает упругий «поп» (см. tick).
  function startBornFx(ls: LiveSlot): void {
    const ring = new Graphics();
    ls.fx.addChild(ring);
    ls.ring = ring; ls.ringLife = 0; ls.ringTtl = 0.5;
    const glyphs = ['✨', '💫', '⭐', '🌟'];
    const n = 12;
    for (let i = 0; i < n; i++) {
      const ang = (i / n) * Math.PI * 2 + Math.random() * 0.4;
      const speed = ls.catH * (1.0 + Math.random() * 0.8);
      const t = label(glyphs[i % glyphs.length]!, 11 + Math.random() * 8, 0xffffff, '700');
      t.position.set(ls.fxX, ls.fxY);
      ls.fx.addChild(t);
      ls.sparks.push({
        view: t, life: 0, ttl: 0.6 + Math.random() * 0.4,
        vx: Math.cos(ang) * speed, vy: Math.sin(ang) * speed - ls.catH * 0.3,
        rot: (Math.random() - 0.5) * 8,
      });
    }
  }

  function buildSlot(i: number, w: number, h: number): Container {
    const card = new Container();
    // ИИ-бокс слота (вырезка с прозрачностью): полный фон всей карточки.
    // Нет текстуры → процедурный panel-фолбэк.
    const boxTex = decorTexture(SLOT_BOX_SPRITES[i % SLOT_BOX_SPRITES.length]!);
    const hasBoxTex = !!boxTex;

    if (hasBoxTex) {
      const bgSp = new Sprite(boxTex);
      bgSp.anchor.set(0.5);
      bgSp.scale.set(Math.max(w / boxTex.width, h / boxTex.height));
      bgSp.position.set(w / 2, h / 2);
      card.addChild(bgSp);
    } else {
      card.addChild(panel(w, h, COLORS.card, 16));
    }

    const slot = ctx.state.slots[i]!;
    const now = ctx.now();
    const busy = slot.readyAt > 0;
    // «оставленный с роднёй» малыш сидит в центре слота: перегородка поднята,
    // родители по бокам остаются, слот блокирован под новую пару.
    const heldKitten = slot.kittenId ? ctx.state.cats.find((c) => c.id === slot.kittenId) : undefined;
    const hasKitten = !!heldKitten && !busy;

    const head = label(`Слот ${i + 1}`, 13, COLORS.inkSoft, '700');
    head.position.set(w / 2, 13);
    card.addChild(head);

    // --- геометрия мини-комнаты ---
    const titleH = 24;
    const ctrlH = 80;                       // под комнатой: прогресс + кнопка
    const ctrlShift = hasBoxTex ? Math.round((ctrlH + 6) / 2) : 0; // сдвиг панели вниз (≈43px)
    const rx = 9, ry = titleH;
    const rw = w - 18;
    const rh = Math.max(70, h - titleH - ctrlH);
    const cx = rx + 6, cy = ry + 4;         // внутренняя камера
    const cw = rw - 12, ch = rh - 8;
    const centerX = cx + cw / 2;
    // линия пола (низ лап): на ИИ-фоне чуть выше — лапы встают на подстилки
    const floorY = hasBoxTex ? cy + ch * 0.9 : cy + ch - 6;
    const catH = Math.min(ch * 0.8, cw * 0.42);

    // камера с маской: всё внутри обрезается (коты не вылезают за края)
    const chamber = new Container();
    const mask = new Graphics();
    mask.roundRect(cx, cy, cw, ch, 10).fill(0xffffff);
    card.addChild(chamber, mask);
    chamber.mask = mask;

    if (!hasBoxTex) {
      // задняя стена + пол (процедурный фолбэк)
      const wallCol = 0xffeaf1;
      const bg = new Graphics();
      bg.roundRect(cx, cy, cw, ch, 10).fill(wallCol);
      bg.rect(cx, floorY - 2, cw, cy + ch - (floorY - 2)).fill(darken(wallCol, 0.12));
      bg.rect(cx, floorY - 2, cw, 3).fill({ color: 0x000000, alpha: 0.06 });
      chamber.addChild(bg);
    }

    // позиции котов: по сторонам (покой) ↔ к центру, чуть внахлёст (вязка).
    // Самец (Отец) — слева, самка (Мать) — справа.
    const dadHomeX = cx + cw * 0.27;
    const momHomeX = cx + cw * 0.73;
    const rub = catH * 0.16;
    const dadMeetX = centerX - rub;
    const momMeetX = centerX + rub;

    // подписи ролей сторон: куда нести самца, куда самку. Под ними — белые
    // плашки, чтобы надписи «Отец/Мать» читались на любом ИИ-фоне бокса.
    const roleY = cy + 12;
    const dadRole = label('Отец ♂', 11, COLORS.ink, '700');
    dadRole.position.set(dadHomeX, roleY);
    const momRole = label('Мать ♀', 11, COLORS.ink, '700');
    momRole.position.set(momHomeX, roleY);
    const rolePlate = new Graphics();
    for (const r of [dadRole, momRole]) {
      rolePlate.roundRect(r.x - r.width / 2 - 7, r.y - r.height / 2 - 2, r.width + 14, r.height + 4, 8)
        .fill({ color: 0xffffff, alpha: 0.72 });
    }
    chamber.addChild(rolePlate, dadRole, momRole);

    // Кто в слоте: поставленные в слот (staged/идёт вязка), иначе — превью
    // глобального выбора пары из Питомника (легаси-способ «Выбрать для вязки»).
    const momCat = slot.motherId
      ? ctx.state.cats.find((c) => c.id === slot.motherId)
      : (busy ? undefined : selectedPair().mother);
    const dadCat = slot.fatherId
      ? ctx.state.cats.find((c) => c.id === slot.fatherId)
      : (busy ? undefined : selectedPair().father);

    // Коты в слоте кликабельны: тап → инфо, а пока вязка не идёт — можно взять
    // за шкирку и утащить (как на полу комнаты). Во время активной вязки — только тап.
    const wireSlotCat = (sprite: Sprite, cat: Cat, glow?: Sprite): void => {
      sprite.eventMode = 'static';
      sprite.cursor = busy ? 'pointer' : 'grab';
      if (busy) {
        sprite.on('pointertap', () => ctx.openCatMenu(cat));
      } else {
        sprite.on('pointerdown', (e) => ctx.startGrab({
          cat,
          displayH: catH,
          // ореол прячем вместе с котом — иначе он остаётся висеть в слоте
          hide: () => { sprite.visible = false; if (glow) glow.visible = false; },
          show: () => { sprite.visible = true; if (glow) glow.visible = true; },
          onTap: () => ctx.openCatMenu(cat),
          onDrop: () => { /* не пристроили — кот остаётся в слоте (refresh вернёт) */ },
        }, e));
      }
    };

    let mom: Sprite | undefined, dad: Sprite | undefined;
    let momGlow: Sprite | undefined, dadGlow: Sprite | undefined;
    let momBase = 1, dadBase = 1;
    // Отца добавляем первым — он стоит ЗА самкой, поэтому во время вязки
    // (когда коты сходятся внахлёст) спрайт отца оказывается сзади.
    if (dadCat) {
      dad = catSprite(ctx.app, dadCat, catH);
      dadBase = Math.abs(dad.scale.x);
      dad.scale.x = dadBase;              // слева — смотрит вправо, к центру
      dad.position.set(busy ? dadMeetX : dadHomeX, floorY);
      dadGlow = rarityGlow(dad, dadCat.rarityTier, catH);
      dadGlow.position.copyFrom(dad.position);
      chamber.addChild(dadGlow, dad);
      wireSlotCat(dad, dadCat, dadGlow);
    }
    if (momCat) {
      mom = catSprite(ctx.app, momCat, catH);
      momBase = Math.abs(mom.scale.x);
      mom.scale.x = -momBase;             // справа — смотрит влево, к центру
      mom.position.set(busy ? momMeetX : momHomeX, floorY);
      momGlow = rarityGlow(mom, momCat.rarityTier, catH);
      momGlow.position.copyFrom(mom.position);
      chamber.addChild(momGlow, mom);
      wireSlotCat(mom, momCat, momGlow);
    }

    // перегородка по центру (поднимается при старте вязки)
    const partW = Math.max(7, cw * 0.05);
    const partTop = cy + 2;
    const partH = (floorY - partTop) * 1.1;
    const partCol = 0xcdb6a3;
    const partition = new Graphics();
    partition.roundRect(centerX - partW / 2, partTop, partW, partH, 4).fill(partCol);
    partition.roundRect(centerX - partW / 2, partTop, partW, partH, 4)
      .stroke({ width: 2, color: darken(partCol, 0.28) });
    partition.rect(centerX - partW / 2, partTop + partH * 0.5 - 1, partW, 2)
      .fill({ color: darken(partCol, 0.22) });
    chamber.addChild(partition);
    const partRaise = partH + 12;
    if (busy) {
      const a = easeOut(clamp01((now - slot.startedAt) / APPROACH_MS));
      partition.y = -a * partRaise;
      partition.alpha = 1 - a;
    } else if (hasKitten) {
      // перегородка не опускается — стоит поднятой, в центре сидит малыш
      partition.y = -partRaise;
      partition.alpha = 0;
    }

    // сердечки (всплывают при вязке)
    const hearts = new Container();
    chamber.addChild(hearts);

    // «оставленный с роднёй» малыш — в центре, маленький, растёт втрое медленнее.
    // Берётся за шкирку → унести в комнату (или тап → меню кота).
    let kitten: Sprite | undefined;
    let kitGlow: Sprite | undefined;
    let kittenBase = 1;
    if (hasKitten && heldKitten) {
      kitten = catSprite(ctx.app, heldKitten, catH);
      kittenBase = Math.abs(kitten.scale.x);
      kitten.scale.set(kittenBase * growthScale(heldKitten, now));
      kitten.position.set(centerX, floorY + catH * 0.25);
      kitGlow = rarityGlow(kitten, heldKitten.rarityTier, catH);
      kitGlow.position.copyFrom(kitten.position);
      chamber.addChild(kitGlow, kitten);
      const kCat = heldKitten;
      const ksp = kitten;
      ksp.eventMode = 'static';
      ksp.cursor = 'grab';
      ksp.on('pointerdown', (e) => ctx.startGrab({
        cat: kCat,
        displayH: catH * growthScale(kCat, ctx.now()),
        hide: () => { ksp.visible = false; if (kitGlow) kitGlow.visible = false; },
        show: () => { ksp.visible = true; if (kitGlow) kitGlow.visible = true; },
        onTap: () => ctx.openCatMenu(kCat),
        onDrop: () => { /* не унесли — малыш остаётся в слоте (refresh вернёт) */ },
      }, e));
    }

    // Рамка камеры — только в процедурном фолбэке (на ИИ-боксе нет лишних рамок)
    if (!hasBoxTex) {
      const frame = new Graphics();
      frame.roundRect(cx, cy, cw, ch, 10).stroke({ width: 2, color: COLORS.cardEdge });
      card.addChild(frame);
    }

    // слой эффекта рождения — поверх камеры (искры могут вылетать за пределы)
    const fx = new Container();
    card.addChild(fx);

    // --- контролы под комнатой ---
    const barW = Math.round((rw - 8) * 0.85);
    const barX = rx + 4 + Math.round(((rw - 8) - barW) / 2);
    const barY = ry + rh + 12 + ctrlShift;

    // Фон полосы управления (только для ИИ-бокса — на panel он уже есть)
    if (hasBoxTex) {
      const stripH = ctrlH + 6;
      const stripW = Math.round(w * 0.92);
      const stripX = Math.round((w - stripW) / 2);
      const stripY = h - ctrlH - 6 + ctrlShift;
      const GREEN_LIGHT = 0xc8f0da;
      const GREEN_EDGE = 0xa8e0b8;
      const ctrlBg = new Graphics();
      ctrlBg.roundRect(stripX, stripY, stripW, stripH, 12)
        .fill({ color: GREEN_LIGHT });
      ctrlBg.roundRect(stripX, stripY, stripW, stripH, 12)
        .stroke({ width: 1.5, color: GREEN_EDGE, alpha: 0.55 });
      // тонкая линия-разделитель над полосой
      ctrlBg.rect(stripX, stripY, stripW, 2)
        .fill({ color: GREEN_EDGE, alpha: 0.35 });
      card.addChild(ctrlBg);
    }

    let bar: Graphics | undefined, time: Text | undefined;

    if (busy) {
      const barBg = new Graphics();
      barBg.roundRect(barX, barY, barW, 12, 6).fill({ color: 0x000000, alpha: 0.08 });
      card.addChild(barBg);
      bar = new Graphics();
      card.addChild(bar);
      time = label('', 13, COLORS.ink, '700');
      time.position.set(w / 2, barY + 24);
      card.addChild(time);
      // Кнопки «Забрать» нет: по окончании таймера малыш сам появится в центре слота
      // (см. game.update → collectReady) с эффектом-салютом.
    } else if (hasKitten) {
      // малыш с роднёй: подсказка + быстрые кнопки пристройства (слот блокирован под пару).
      // Перетаскивать малыша тоже можно — берётся за шкирку и несётся в любую комнату.
      const stripTop = h - ctrlH - 6 + ctrlShift;
      const hint = label('🐾 малыш с роднёй — пристрой его', 12, COLORS.inkSoft, '700');
      hint.position.set(w / 2, stripTop + 14);
      card.addChild(hint);

      const placeBtn = (text: string, room: 'nursery' | 'shelter', color: number, yy: number): void => {
        const b = new Button({ text, w: Math.round((w - 24) * 0.85), h: 28, color, fontSize: 12.5 });
        b.position.set(w / 2, yy);
        b.onTap = () => {
          if (!heldKitten) return;
          const r = moveCat(ctx.state, heldKitten.id, room);
          if (!r.ok) { ctx.toast(r.reason); return; }
          ctx.commit();
          ctx.toast(room === 'shelter' ? 'Малыш в приюте 🏠' : 'Малыш в питомнике 🏆');
        };
        card.addChild(b);
      };
      placeBtn(`🏠 В питомник (${roomCount(ctx.state, 'nursery')}/${nurseryCapacity(ctx.state)})`,
        'nursery', COLORS.primary, stripTop + 38);
      placeBtn(`🏚️ В приют (${roomCount(ctx.state, 'shelter')}/${shelterCapacity(ctx.state)})`,
        'shelter', COLORS.secondary, stripTop + 70);
    } else {
      // пара = поставленные в слот коты (или превью глобального выбора)
      const mother = momCat;
      const father = dadCat;
      const ok = !!mother && !!father;
      const btn = new Button({
        text: ok ? 'Свести 🐾' : 'Перетащи пару',
        w: Math.round((w - 24) * 0.85), h: 38, color: ok ? COLORS.primary : COLORS.cardEdge,
        textColor: ok ? 0xffffff : COLORS.inkSoft, fontSize: 15,
      });
      btn.enabled = ok;
      btn.position.set(w / 2, h - 22 + ctrlShift);
      btn.onTap = () => {
        const r = startBreeding(ctx.state, i, mother!.id, father!.id, ctx.now());
        if (r.ok) { ctx.clearSelection(); ctx.commit(); ctx.toast('Вязка началась 🐾'); }
        else ctx.toast(r.reason);
      };
      card.addChild(btn);
    }

    live.push({
      index: i,
      card,
      total: busy ? Math.max(1, slot.readyAt - slot.startedAt) : incubationDuration(ctx.state),
      bar, barX, barY, barW, time,
      busy, startedAt: slot.startedAt,
      partition, partRaise,
      mom, dad,
      momGlow, dadGlow, kitGlow,
      kitten, kittenBase, kittenCat: heldKitten,
      momHomeX, momMeetX, dadHomeX, dadMeetX,
      momBase, dadBase,
      catBaseY: floorY, catH,
      hearts, heartObjs: [], heartTimer: 0,
      fx, fxX: centerX, fxY: floorY - catH * 0.32,
      pendingFx: hasKitten && !!heldKitten && !celebrated.has(heldKitten.id),
      sparks: [], ringLife: 0, ringTtl: 0,
      kittenPop: 0,
      phase: Math.random() * 6,
    });

    return card;
  }

  /**
   * Закрытое окно вязки (слот ещё не куплен). Выглядит как притушённая мини-комната
   * с замком. Следующий по очереди слот можно открыть прямо здесь за 💰 (тот же
   * апгрейд «Слоты вязки», что и в Генолабе → Исследования); более дальний — ждёт,
   * пока откроют предыдущий.
   */
  function buildLockedSlot(i: number, w: number, h: number): Container {
    const card = new Container();
    card.addChild(panel(w, h, COLORS.card, 16, 0.55));

    const head = label(`Слот ${i + 1}`, 13, COLORS.inkSoft, '700');
    head.position.set(w / 2, 13);
    card.addChild(head);

    const lock = label('🔒', Math.min(w, h) * 0.26, COLORS.inkSoft, '700');
    lock.alpha = 0.5;
    lock.position.set(w / 2, h * 0.42);
    card.addChild(lock);

    const isNext = i === ctx.state.slots.length && !upgradeMaxed(ctx.state, 'slots');
    if (isNext) {
      const cost = upgradeCost(ctx.state, 'slots');
      const afford = !!cost && ctx.state.coins >= cost.amount;
      const btn = new Button({
        text: cost ? `Открыть · ${cost.amount} 💰` : 'Открыть слот',
        w: w - 24, h: 38, color: afford ? COLORS.good : COLORS.cardEdge,
        textColor: afford ? 0xffffff : COLORS.inkSoft, fontSize: 14,
      });
      btn.enabled = afford;
      btn.position.set(w / 2, h - 26);
      btn.onTap = () => {
        const r = buyUpgrade(ctx.state, 'slots');
        if (r.ok) { ctx.commit(); ctx.toast('Новый слот вязки 💞'); }
        else ctx.toast(r.reason);
      };
      card.addChild(btn);
    } else {
      const hint = label('откроется после предыдущего', 11.5, COLORS.inkSoft, '600');
      hint.position.set(w / 2, h - 26);
      card.addChild(hint);
    }
    return card;
  }

  function refresh(): void {
    for (const c of shell.body.removeChildren()) c.destroy({ children: true });
    live = [];
    // Всегда показываем 3 аккуратных окна вязки (триптих по центру). Открытые —
    // рабочие слоты, ещё не купленные — притушённые с замком. Под каждым окном —
    // спрайт-подставка, чтобы окна «стояли на тумбах».
    const N = 3;
    const owned = ctx.state.slots.length;
    const gap = 18;
    // счётчик открытых/всего слотов вязки — справа в плашке названия
    const plateW = shell.setTitleBadge(`💞 ${owned}/${N}`);

    const standTex = decorTexture('slotstand');
    const standAspect = standTex ? standTex.width / standTex.height : 480 / 330; // ширина/высота

    const colW = (shell.contentW - gap * (N - 1)) / N;
    const slotW = Math.min(300, colW);

    // Подставка чуть уже окна; её видимая (торчащая ниже окна) высота ограничена,
    // чтобы на коротких экранах окна не схлопывались. Окно «утоплено» в платформу.
    const seatFrac = 0.12;
    const fullStandW = slotW * 0.96;
    const fullUnder = (fullStandW / standAspect) * (1 - seatFrac);
    const standUnder = Math.min(fullUnder, shell.contentH * 0.26);
    const standH = standUnder / (1 - seatFrac);
    const standW = standH * standAspect;

    // Высота окна — под оставшееся место, с потолком (чтобы на ПК не разъезжалось).
    const slotH = Math.min(slotW * 1.15, shell.contentH - standUnder);

    const blockH = slotH + standUnder;
    const totalW = slotW * N + gap * (N - 1);
    const startX = Math.max(0, (shell.contentW - totalW) / 2);
    const startY = Math.max(0, (shell.contentH - blockH) / 2);
    const colX = (i: number): number => startX + i * (slotW + gap) + slotW / 2;

    // Подставки рисуем первыми — они под окнами (окно перекрывает верх платформы).
    if (standTex) {
      for (let i = 0; i < N; i++) {
        const s = new Sprite(standTex);
        s.anchor.set(0.5, 1);
        s.scale.set(standW / standTex.width);
        s.position.set(colX(i), startY + slotH + standUnder); // низ подставки = низ блока
        shell.body.addChild(s);
      }
    }

    for (let i = 0; i < N; i++) {
      const c = i < owned ? buildSlot(i, slotW, slotH) : buildLockedSlot(i, slotW, slotH);
      c.position.set(startX + i * (slotW + gap), startY);
      shell.body.addChild(c);
    }

    renderBoostChips(plateW); // подсветка чипов усилителей зависит от зарядов
  }

  function tick(dt: number): void {
    const now = ctx.now();

    // пульс ореола заряженных усилителей у названия комнаты («ярко горит»)
    for (const bg of boostGlows) {
      bg.phase += dt;
      bg.halo.alpha = 0.38 + 0.56 * (0.5 + 0.5 * Math.sin(bg.phase * 4));
    }

    for (const ls of live) {
      ls.phase += dt;
      const slot = ctx.state.slots[ls.index];

      // прогресс-бар + таймер
      if (ls.bar && ls.time && slot && slot.readyAt > 0) {
        const remain = slot.readyAt - now;
        const prog = clamp01(1 - remain / ls.total);
        ls.bar.clear();
        ls.bar.roundRect(ls.barX, ls.barY, Math.max(2, ls.barW * prog), 12, 6)
          .fill(remain <= 0 ? COLORS.good : COLORS.primary);
        ls.time.text = remain <= 0 ? 'Готово! 🥚' : mmss(remain);
      }

      if (ls.busy && ls.mom && ls.dad) {
        // перегородка поднимается, коты сходятся
        const a = easeOut(clamp01((now - ls.startedAt) / APPROACH_MS));
        ls.partition.y = -a * ls.partRaise;
        ls.partition.alpha = 1 - a;
        const momX = lerp(ls.momHomeX, ls.momMeetX, a);
        const dadX = lerp(ls.dadHomeX, ls.dadMeetX, a);
        // «трутся»: лёгкое покачивание навстречу, когда уже рядом
        const s = Math.sin(ls.phase * 7);
        ls.mom.x = momX + s * ls.catH * 0.05 * a;
        ls.dad.x = dadX - s * ls.catH * 0.05 * a;
        ls.mom.scale.y = ls.momBase * (1 + s * 0.04 * a);
        ls.dad.scale.y = ls.dadBase * (1 - s * 0.04 * a);
        ls.mom.rotation = s * 0.06 * a;
        ls.dad.rotation = -s * 0.06 * a;
        // сердечки, когда коты сошлись
        if (a > 0.7) {
          ls.heartTimer -= dt;
          if (ls.heartTimer <= 0) { spawnHeart(ls); ls.heartTimer = 0.35 + Math.random() * 0.3; }
        }
      } else {
        // покой / ожидание пары: каждый поставленный кот мягко дышит и слегка
        // покачивается — он уже «живёт» в слоте, даже если стоит там один
        const b = 1 + Math.sin(ls.phase * 2) * 0.025;
        const sway = Math.sin(ls.phase * 1.6) * 0.05;
        if (ls.mom) { ls.mom.scale.y = ls.momBase * b; ls.mom.rotation = sway; }
        if (ls.dad) { ls.dad.scale.y = ls.dadBase * b; ls.dad.rotation = -sway; }
      }

      // эффект рождения: малыш только что появился в слоте (и виден) → салют один раз
      if (ls.pendingFx && ls.kittenCat) {
        ls.pendingFx = false;
        celebrated.add(ls.kittenCat.id);
        ls.kittenPop = 0.6;
        startBornFx(ls);
      }
      if (ls.kittenPop > 0) ls.kittenPop = Math.max(0, ls.kittenPop - dt);

      // малыш «с роднёй» в центре: подрастает + лёгкое дыхание + упругий «поп» при рождении
      if (ls.kitten && ls.kittenCat && ls.kitten.visible) {
        const gs = growthScale(ls.kittenCat, now);
        const breathe = 1 + Math.sin(ls.phase * 2.4) * 0.03;
        const pop = ls.kittenPop > 0 ? 1 + Math.sin((1 - ls.kittenPop / 0.6) * Math.PI) * 0.35 : 1;
        ls.kitten.scale.set(ls.kittenBase * gs * pop, ls.kittenBase * gs * breathe * pop);
      }

      // ореолы редкости повторяют позы котов этого слота
      syncGlow(ls.mom, ls.momGlow);
      syncGlow(ls.dad, ls.dadGlow);
      syncGlow(ls.kitten, ls.kitGlow);

      // искры салюта: разлетаются, чуть падают, тают
      for (let k = ls.sparks.length - 1; k >= 0; k--) {
        const sp = ls.sparks[k]!;
        sp.life += dt;
        const t = sp.life / sp.ttl;
        sp.view.x += sp.vx * dt;
        sp.view.y += sp.vy * dt;
        sp.vy += ls.catH * 1.4 * dt;          // лёгкая гравитация
        sp.view.rotation += sp.rot * dt;
        sp.view.alpha = Math.max(0, 1 - t);
        sp.view.scale.set(0.5 + t * 0.6);
        if (sp.life >= sp.ttl) { sp.view.destroy(); ls.sparks.splice(k, 1); }
      }

      // кольцо-вспышка: расширяется и гаснет
      if (ls.ring) {
        ls.ringLife += dt;
        const t = clamp01(ls.ringLife / ls.ringTtl);
        ls.ring.clear();
        ls.ring.circle(ls.fxX, ls.fxY, ls.catH * (0.2 + t * 0.8))
          .stroke({ width: Math.max(1, ls.catH * 0.07 * (1 - t)), color: 0xffe27a, alpha: 0.75 * (1 - t) });
        if (t >= 1) { ls.ring.destroy(); ls.ring = undefined; }
      }

      // полёт сердечек вверх с затуханием
      for (let k = ls.heartObjs.length - 1; k >= 0; k--) {
        const hh = ls.heartObjs[k]!;
        hh.life += dt;
        const t = hh.life / hh.ttl;
        hh.view.y -= dt * ls.catH * 0.7;
        hh.view.x += hh.vx * dt;
        hh.view.alpha = Math.max(0, 1 - t);
        hh.view.scale.set(0.7 + t * 0.5);
        if (hh.life >= hh.ttl) { hh.view.destroy(); ls.heartObjs.splice(k, 1); }
      }
    }
  }

  /** Кота уронили в инкубаторе: ищем слот под точкой и ставим кота в вязку. */
  function tryDropCat(cat: Cat, gx: number, gy: number): boolean {
    for (const ls of live) {
      const b = ls.card.getBounds();
      if (gx >= b.minX && gx <= b.maxX && gy >= b.minY && gy <= b.maxY) {
        const r = assignBreeder(ctx.state, ls.index, cat.id, ctx.now());
        if (!r.ok) { ctx.toast(r.reason); return false; }
        ctx.commit();
        ctx.toast(cat.genotype.sex === 'female' ? 'Кошка в слоте 💞' : 'Кот в слоте 💞');
        return true;
      }
    }
    ctx.toast('перетащи кота на слот вязки');
    return false;
  }

  return { id: 'incubator', title: '🧬 Инкубатор', container: shell.container, refresh, tick, tryDropCat };
}
