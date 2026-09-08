/**
 * Комната «Инкубатор»: места вязки (выбор пары → таймер → котёнок).
 * Пара выбирается в Питомнике (ctx.selection). Апгрейды слотов вязки и
 * скорости инкубации переехали в Генолаб → Улучшения (4-я ветка).
 * Справа от названия — чипы усилителей вязки (Генная инженерия): активируешь
 * за 🧬 гены или 💎 кристаллы, заряженный чип «горит» и срабатывает на первой
 * следующей вязке.
 *
 * Визуал места вязки — мини-комната с перегородкой по центру. В покое перегородка
 * опущена, коты стоят по разные стороны. По кнопке «Свести» перегородка
 * поднимается, коты сходятся к центру, встают рядышком и ласково тянутся друг к
 * другу мордочками (медленное покачивание навстречу + мягкое «дыхание»), вверх
 * всплывают сердечки. Подача намеренно «романтическая», без ритмичной тряски.
 */

import { Container, Graphics, Sprite, Text } from 'pixi.js';
import type { FederatedPointerEvent } from 'pixi.js';
import type { Cat, BoostDef } from '../../game/index.js';
import {
  startBreeding, assignBreeder, BOOSTS, boostCharges, activeBoostId, growthScale,
  moveCat, roomCount, nurseryCapacity, shelterCapacity,
  buyUpgrade, upgradeCost, upgradeMaxed,
  maxSlotsForLevel, nextSlotUnlockLevel, isUnlocked,
  kinshipLevel, kinshipName, buildBreedingContext,
} from '../../game/index.js';
import { boostCanFire } from '../../genetics/index.js';
import type { Room, UiContext } from '../context.js';
import { roomShell } from './shell.js';
import { Button, COLORS, FONT, label, panel } from '../theme.js';
import { catSprite, rarityGlow, GLOW_OUT } from '../catTextures.js';
import { decorTexture } from '../decorArt.js';
import { sfxEvent, sfxMeow } from '../sound.js';
import { darken } from '../../render/palette.js';
import { t, tx } from '../../i18n.js';

const APPROACH_MS = 900; // за это время перегородка поднимается, а коты сходятся

// Цвета главных кнопок слота. Пастельные COLORS.primary/secondary на золотисто-розовой
// полосе кнопок сливались с фоном, а darken() делал их пыльными — здесь нужны именно
// СОЧНЫЕ тона: «Свести» — розовый, «Прогноз пары» — голубой.
const BREED_BTN = 0xff6f9c;
const FORECAST_BTN = 0x5b9dff;

// ИИ-фоны боксов вязки (src/assets/slotbox/*_cut.webp) — вырезки с прозрачностью,
// используются как полноценный фон всей карточки слота. Один вариант на все слоты.
const SLOT_BOX_SPRITES = ['slotbox_glass_cut', 'slotbox_glass_cut', 'slotbox_glass_cut'];

// --- Геометрия окна вязки --------------------------------------------------
// Всё внутри слота привязано к ОПОРНЫМ ТОЧКАМ ТЕКСТУРЫ бокса (1024×896), а не к
// прямоугольнику карточки. Раньше спрайт вписывался в карточку «cover», и на
// коротких экранах (телефон-ландшафт) он ужимался по высоте: у вырезки по краям
// прозрачные поля, поэтому видимое стекло оказывалось заметно уже полосы кнопок,
// а коты повисали над подстилками — линия пола считалась от карточки, а не от
// матраса на картинке. Теперь карточка слота — это РОВНО видимое стекло: полоса
// кнопок всегда по ширине окна, а пол/места/перегородка при любом размере
// попадают в свои места на картинке.
// Координаты — в пикселях авторской текстуры; в код идут только их ОТНОШЕНИЯ,
// поэтому пережатие ассетов в другое разрешение ничего не ломает (пропорции те же).
const TEX_W = 1024, TEX_H = 896;
const BOX_L = 89, BOX_R = 941, BOX_T = 45, BOX_B = 843; // видимое стекло в текстуре
const BOX_FLOOR = 624;                   // линия лап: верх матраса (подушки прикрывают лапы спереди)
const BOX_DAD_X = 344, BOX_MOM_X = 680;  // центры мест ♂ (слева) и ♀ (справа)
const BOX_ROLE_Y = 184;                  // подписи «Отец ♂ / Мать ♀»
const BOX_PART_T = 98, BOX_PART_B = 760; // перегородка между половинами бокса
/** Высота видимого стекла относительно его ширины. */
const GLASS_RATIO = (BOX_B - BOX_T) / (BOX_R - BOX_L);
/** Высота кота относительно ширины стекла. */
const CAT_FRAC = 0.36;

// --- Раскладка триптиха ----------------------------------------------------
const CTRL_H = 86;             // высота полосы кнопок под окном
const CTRL_OVERLAP = 0.15;     // насколько полоса наезжает на низ окна (прячет перед матраса)
const SLOT_MAX_W = 315;        // потолок ширины окна — чтобы на ПК не разъезжалось
const STAND_W_FRAC = 0.78;     // ширина тумбы от ширины окна
const STAND_SEAT = 0.34;       // верх тумбы утоплен под окно/полосу кнопок
const STAND_SQUASH_MIN = 0.72; // на коротких экранах тумбу можно приплюснуть до этой доли
const STAND_MIN_FRAC = 0.26;   // минимум видимой тумбы (доля ширины окна) — под неё ужимаем окно
const STAND_NAV_OVERHANG = 18; // тумбе можно чуть зайти на полосу навигации

// Акцент свечения заряженного усилителя — в тон его текстуры (boost_<id>.webp).
// После перемаппинга: стабилизатор→зелёный, катализатор→синий, активатор→оранжевый.
// Деградатор тянет вниз, к дворовым — серо-стальной, в тон серого тира T1.
const BOOST_ACCENT: Record<string, number> = {
  degrade: 0x9aa7b4, noDown: 0x3fe08c, luckyUp: 0x59b1ff, tierUp: 0xffab3d,
};

interface Heart { view: Text; life: number; ttl: number; vx: number; }
interface Spark { view: Text; life: number; ttl: number; vx: number; vy: number; rot: number; }
/** Всплывающий красный плюсик лечения (эффект ветеринара над котом в слоте). */
interface HealPlus {
  view: Container; delay: number; life: number; ttl: number;
  x0: number; y0: number; rise: number; sway: number; phase: number;
}

interface LiveSlot {
  index: number;
  card: Container;            // карточка слота — для попадания при перетаскивании
  cardW: number; cardH: number; // её габарит (окно + полоса кнопок) для хит-теста
  status?: Text;              // подпись «Вязка идёт…» (полосы прогресса нет — выдала бы тир)
  busy: boolean;
  startedAt: number;
  partition: Graphics; partRaise: number;
  mom?: Sprite; dad?: Sprite;
  momCat?: Cat; dadCat?: Cat;  // коты в слоте — цель для шприца-ветеринара
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

/**
 * Подпись-замок поверх пёстрого ИИ-фона комнаты (закрытые слоты, «Усилители —
 * с ур. N»). Серый текст на полупрозрачной карточке тонул в фоне, поэтому пишем
 * белым жирным с тёмной обводкой — тем же приёмом, что и названия чипов.
 */
const lockHint = (text: string, size = 12): Text =>
  label(text, size, 0xffffff, '800', { color: 0x2c2438, width: 3.5 });

/**
 * Медицинский плюсик для эффекта лечения. Рисуем крест ОДНОЙ фигурой (а не двумя
 * прямоугольниками) — иначе белый кант рвётся линиями на стыке лучей. Под крестом
 * мягкое розовое свечение, чтобы плюсики читались на любом ИИ-фоне бокса.
 */
function healPlusIcon(size: number): Container {
  const c = new Container();
  const h = size / 2;      // половина размаха креста
  const t = size * 0.17;   // половина толщины луча
  const glow = new Graphics();
  glow.circle(0, 0, size * 0.62).fill({ color: 0xff5b7a, alpha: 0.22 });
  const g = new Graphics();
  g.poly([-t, -h, t, -h, t, -t, h, -t, h, t, t, t, t, h, -t, h, -t, t, -h, t, -h, -t, -t, -t])
    .fill(0xff3b5c)
    .stroke({ width: Math.max(1.5, size * 0.09), color: 0xffffff, alpha: 0.95, join: 'round' });
  c.addChild(glow, g);
  return c;
}

/** Ужимает подпись под ширину полосы кнопок (на узком экране слот уже текста). */
function fitLabel(t: Text, maxW: number): void {
  if (t.width > maxW) t.scale.set(maxW / t.width);
}

export function createIncubator(ctx: UiContext): Room {
  const shell = roomShell(ctx, 'incubator', t('🧬 Инкубатор', '🧬 Incubator'));
  let live: LiveSlot[] = [];
  // id малышей, чьё «рождение» уже отпраздновали эффектом — чтобы не повторять
  // вспышку на каждом пересборе. Эффект играет один раз, когда малыш виден.
  const celebrated = new Set<string>();
  // Узлы-якоря подсветки обучения (см. Room.anchor): первый слот и его кнопки.
  // Пересобираются вместе с комнатой — карта чистится в refresh().
  const anchors = new Map<string, Container>();

  // --- Усилители вязки (Генная инженерия) у названия комнаты ---
  // Кнопки-чипы справа от заголовка. Заряженный усилитель «горит» (яркая
  // заливка + пульсирующий ореол) и сработает на первой следующей вязке.
  const boostBar = new Container();
  shell.titleBar.addChild(boostBar);
  let boostGlows: { halo: Graphics; phase: number }[] = [];
  // мигающие ярлыки «⚡ готов» (активный буст реально выстрелит на паре в слоте)
  let readyPulses: { view: Container; phase: number }[] = [];

  // Чип усилителя — кнопка с ИИ-текстурой (boost_<id>.webp) и читаемым названием.
  const CHIP_W = 118, CHIP_H = 38;

  function boostChip(def: BoostDef, activeId?: string, fireReady = false): Container {
    const c = new Container();
    const charges = boostCharges(ctx.state, def.id); // склад зарядов (можно копить любых)
    const active = activeId === def.id;              // активен ИМЕННО этот (сработает в вязке)
    const stocked = charges > 0;                     // есть заряды на складе
    const accent = BOOST_ACCENT[def.id] ?? COLORS.dna;
    const w = CHIP_W, h = CHIP_H;

    // Ореол «горит» — только у активного усилителя.
    if (active) {
      const halo = new Graphics();
      halo.roundRect(-w / 2 - 5, -h / 2 - 5, w + 10, h + 10, 14)
        .fill({ color: accent, alpha: 0.68 });
      c.addChild(halo);
      boostGlows.push({ halo, phase: Math.random() * 6 });
    }

    const tex = decorTexture(`boost_${def.id}`);
    if (tex) {
      // текстурная подложка: cover-вписывание + скруглённая маска. Пустой (без зарядов)
      // чип «потушен» (серый тинт); есть заряды — в полный цвет; активный ещё и в ободке.
      const sp = new Sprite(tex);
      sp.anchor.set(0.5);
      sp.scale.set(Math.max(w / tex.width, h / tex.height));
      const m = new Graphics();
      m.roundRect(-w / 2, -h / 2, w, h, 11).fill(0xffffff);
      sp.mask = m;
      if (!stocked) { sp.tint = 0x8f8f8f; sp.alpha = 0.85; }
      const edge = new Graphics();
      edge.roundRect(-w / 2, -h / 2, w, h, 11)
        .stroke({ width: active ? 2.5 : 2, color: active ? 0xffffff : stocked ? accent : COLORS.cardEdge, alpha: active ? 0.98 : stocked ? 0.85 : 0.8 });
      c.addChild(sp, m, edge);
    } else {
      const bg = new Graphics();
      bg.roundRect(-w / 2, -h / 2, w, h, 11)
        .fill({ color: COLORS.card, alpha: stocked ? 1 : 0.9 })
        .stroke({ width: active ? 2.5 : 2, color: active ? 0xffffff : stocked ? accent : COLORS.cardEdge, alpha: active ? 0.98 : stocked ? 0.85 : 0.8 });
      c.addChild(bg);
    }

    // название — белым с тёмной обводкой: читается на любой текстуре
    const name = new Text({
      text: tx(def.label),
      style: {
        fontFamily: FONT, fontSize: 13.5, fontWeight: '800', fill: 0xffffff,
        stroke: { color: 0x2c2438, width: 3, join: 'round' }, align: 'center',
      },
    });
    name.anchor.set(0.5);
    name.position.set(0, 0);
    if (!stocked && !active) name.alpha = 0.75;
    c.addChild(name);

    // Счётчик склада (справа сверху) — сколько зарядов накоплено.
    if (stocked) {
      const badge = new Graphics();
      badge.circle(w / 2 - 3, -h / 2 + 3, 8).fill({ color: active ? COLORS.good : accent });
      const cnt = label(String(charges), 11, 0xffffff, '800');
      cnt.position.set(w / 2 - 3, -h / 2 + 3);
      c.addChild(badge, cnt);
    }
    // Метка активности (слева сверху) — сразу видно, какой усилитель сейчас работает.
    if (active) {
      const on = label('⚡', 12, 0xffffff, '800');
      on.position.set(-w / 2 + 9, -h / 2 + 9);
      c.addChild(on);
    }
    // «⚡ готов»: активный усилитель реально сработает на одной из пар в слотах —
    // мигающий ярлык под чипом (игрок учится понимать механику без вики).
    if (active && fireReady) {
      const pw = 66, ph = 15;
      const pill = new Container();
      const bgP = new Graphics();
      bgP.roundRect(-pw / 2, -ph / 2, pw, ph, ph / 2)
        .fill({ color: accent })
        .stroke({ width: 1.5, color: 0xffffff, alpha: 0.9 });
      const txt = label(t('⚡ готов', '⚡ ready'), 10, 0xffffff, '800');
      pill.addChild(bgP, txt);
      pill.position.set(0, h / 2 + 1);
      c.addChild(pill);
      readyPulses.push({ view: pill, phase: Math.random() * 6 });
    }

    c.eventMode = 'static';
    c.cursor = 'pointer';
    // Тап открывает меню усилителя: заряд (склад) + переключатель активности.
    c.on('pointertap', () => ctx.openBoostMenu(def.id));
    return c;
  }

  function renderBoostChips(plateW: number): void {
    boostBar.removeChildren();
    boostGlows = [];
    readyPulses = [];
    const gap = 8;
    // чипы стоят справа от плашки названия, вплотную (boostBar — в локальных
    // координатах titleBar; plateW — ширина плашки со счётчиком слотов).
    const firstCx = plateW + 12 + CHIP_W / 2;
    // Генная инженерия открывается покупкой узла «🥼 Учёный» в Улучшениях (Генолаб),
    // доступного с ур. LAB_UNLOCKS.engineering — до покупки вместо чипов замок.
    if (!isUnlocked(ctx.state, 'engineering')) {
      const hint = lockHint(t('🧪 Усилители — открой «Учёного» 🔒', '🧪 Boosters — unlock the "Scientist" 🔒'), 13);
      hint.anchor.set(0, 0.5);
      hint.position.set(firstCx - CHIP_W / 2, shell.titleH / 2);
      boostBar.addChild(hint);
      return;
    }
    const activeId = activeBoostId(ctx.state); // единовременно активен только один усилитель
    // «⚡ готов»: активный усилитель реально выстрелит на одной из пар в слотах —
    // поставленных или уже в вязке (буст срабатывает при рождении).
    let fireReady = false;
    if (activeId) {
      for (const slot of ctx.state.slots) {
        const m = slot.motherId ? ctx.state.cats.find((c) => c.id === slot.motherId) : undefined;
        const f = slot.fatherId ? ctx.state.cats.find((c) => c.id === slot.fatherId) : undefined;
        if (m && f && boostCanFire(activeId, buildBreedingContext(m, f))) { fireReady = true; break; }
      }
    }
    BOOSTS.forEach((def, i) => {
      const chip = boostChip(def, activeId, fireReady);
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

  /**
   * Окно вязки. `w` — ширина ВИДИМОГО стекла бокса; высота стекла из неё же
   * (GLASS_RATIO), полоса кнопок — сразу под ним, той же ширины.
   */
  function buildSlot(i: number, w: number): Container {
    const card = new Container();
    // ИИ-бокс слота (вырезка с прозрачностью) — фон окна. Масштаб такой, чтобы
    // видимое стекло (BOX_L..BOX_R × BOX_T..BOX_B) легло ровно в (0,0,w,glassH).
    const boxTex = decorTexture(SLOT_BOX_SPRITES[i % SLOT_BOX_SPRITES.length]!);
    const hasBoxTex = !!boxTex;
    const s = w / (BOX_R - BOX_L);
    const tx = (x: number): number => (x - BOX_L) * s; // текстура → карточка
    const ty = (y: number): number => (y - BOX_T) * s;
    const glassH = ty(BOX_B);
    // верх полосы кнопок: чуть заходит на низ окна (прячет перед матраса)
    const stripY = glassH * (1 - CTRL_OVERLAP);
    const h = stripY + CTRL_H;             // полный габарит карточки

    if (hasBoxTex) {
      const bgSp = new Sprite(boxTex);
      bgSp.anchor.set(0.5);
      bgSp.scale.set(w / ((BOX_R - BOX_L) * (boxTex.width / TEX_W)));
      bgSp.position.set(tx(TEX_W / 2), ty(TEX_H / 2));
      card.addChild(bgSp);
    } else {
      card.addChild(panel(w, glassH, COLORS.card, 16));
    }

    const slot = ctx.state.slots[i]!;
    const now = ctx.now();
    const busy = slot.readyAt > 0;
    // «оставленный с роднёй» малыш сидит в центре слота: перегородка поднята,
    // родители по бокам остаются, слот блокирован под новую пару.
    const heldKitten = slot.kittenId ? ctx.state.cats.find((c) => c.id === slot.kittenId) : undefined;
    const hasKitten = !!heldKitten && !busy;

    // --- геометрия мини-комнаты (всё от опорных точек картинки бокса) ---
    const centerX = tx(TEX_W / 2);
    const floorY = ty(BOX_FLOOR);   // линия пола = низ лап котов
    const catH = w * CAT_FRAC;

    // камера с маской: всё внутри обрезается (коты не вылезают за края стекла)
    const chamber = new Container();
    const mask = new Graphics();
    mask.roundRect(0, 0, w, glassH, 14).fill(0xffffff);
    card.addChild(chamber, mask);
    chamber.mask = mask;

    if (!hasBoxTex) {
      // задняя стена + пол (процедурный фолбэк)
      const wallCol = 0xffeaf1;
      const bg = new Graphics();
      bg.roundRect(0, 0, w, glassH, 14).fill(wallCol);
      bg.rect(0, floorY - 2, w, glassH - (floorY - 2)).fill(darken(wallCol, 0.12));
      bg.rect(0, floorY - 2, w, 3).fill({ color: 0x000000, alpha: 0.06 });
      chamber.addChild(bg);
    }

    // позиции котов: по сторонам (покой) ↔ рядышком у центра (вязка).
    // Самец (Отец) — слева, самка (Мать) — справа; при встрече стоят бок о бок,
    // повёрнутые друг к другу, и тянутся мордочками (без «один за другим»).
    const dadHomeX = tx(BOX_DAD_X);
    const momHomeX = tx(BOX_MOM_X);
    const lean = catH * 0.2;             // насколько отходят от центра при встрече
    const dadMeetX = centerX - lean;
    const momMeetX = centerX + lean;

    // подписи ролей сторон: куда нести самца, куда самку. Под ними — белые
    // плашки, чтобы надписи «Отец/Мать» читались на любом ИИ-фоне бокса.
    const roleY = ty(BOX_ROLE_Y);
    const dadRole = label(t('Отец ♂', 'Father ♂'), 11, COLORS.ink, '700');
    const momRole = label(t('Мать ♀', 'Mother ♀'), 11, COLORS.ink, '700');
    dadRole.position.set(dadHomeX, roleY);
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
      anchors.set(`cat:${cat.id}`, sprite); // подсветка обучения: «тапни этого кота»
      if (busy) {
        sprite.on('pointertap', () => { sfxMeow(); ctx.openCatMenu(cat); });
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
    // Коты встают друг напротив друга. Отца добавляем первым (он рисуется под
    // самкой) — при лёгком касании мордочек нахлёст так выглядит аккуратнее.
    if (dadCat) {
      dad = catSprite(ctx.app, dadCat, catH);
      dadBase = Math.abs(dad.scale.x);
      dad.scale.x = dadBase;              // слева — смотрит вправо, к центру
      dad.position.set(busy ? dadMeetX : dadHomeX, floorY + catH * 0.03);
      dadGlow = rarityGlow(ctx.app, dad, dadCat.rarityTier, catH);
      dadGlow.position.copyFrom(dad.position);
      chamber.addChild(dadGlow, dad);
      wireSlotCat(dad, dadCat, dadGlow);
    }
    if (momCat) {
      mom = catSprite(ctx.app, momCat, catH);
      momBase = Math.abs(mom.scale.x);
      mom.scale.x = -momBase;             // справа — смотрит влево, к центру
      mom.position.set(busy ? momMeetX : momHomeX, floorY + catH * 0.03);
      momGlow = rarityGlow(ctx.app, mom, momCat.rarityTier, catH);
      momGlow.position.copyFrom(mom.position);
      chamber.addChild(momGlow, mom);
      wireSlotCat(mom, momCat, momGlow);
    }

    // перегородка по центру (поднимается при старте вязки)
    const partW = Math.max(7, w * 0.045);
    const partTop = ty(BOX_PART_T);
    const partR = Math.max(3, partW * 0.5);        // пилюля: полукруглый верх и низ
    const partH = ty(BOX_PART_B) - partTop;
    const partCol = 0xcdb6a3;
    const partition = new Graphics();
    partition.roundRect(centerX - partW / 2, partTop, partW, partH, partR).fill(partCol);
    partition.roundRect(centerX - partW / 2, partTop, partW, partH, partR)
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

    // «оставленный с роднёй» малыш — в центре, маленький, растёт вдвое медленнее.
    // Берётся за шкирку → унести в комнату (или тап → меню кота).
    let kitten: Sprite | undefined;
    let kitGlow: Sprite | undefined;
    let kittenBase = 1;
    if (hasKitten && heldKitten) {
      kitten = catSprite(ctx.app, heldKitten, catH);
      kittenBase = Math.abs(kitten.scale.x);
      kitten.scale.set(kittenBase * growthScale(heldKitten, now));
      kitten.position.set(centerX, floorY + catH * 0.15);
      kitGlow = rarityGlow(ctx.app, kitten, heldKitten.rarityTier, catH);
      kitGlow.position.copyFrom(kitten.position);
      chamber.addChild(kitGlow, kitten);
      const kCat = heldKitten;
      const ksp = kitten;
      ksp.eventMode = 'static';
      ksp.cursor = 'grab';
      anchors.set(`cat:${kCat.id}`, ksp); // подсветка обучения: «тапни малыша → вырастить»
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
      frame.roundRect(0, 0, w, glassH, 14).stroke({ width: 2, color: COLORS.cardEdge });
      card.addChild(frame);
    }

    // слой эффекта рождения — поверх камеры (искры могут вылетать за пределы)
    const fx = new Container();
    card.addChild(fx);

    // --- контролы под окном (полоса ровно по ширине видимого стекла) ---
    // Фон полосы управления (только для ИИ-бокса — на panel он уже есть)
    if (hasBoxTex) {
      const GOLDEN_ROSE = 0xedc8b0; // золотисто-розовый, в тон краёв слота
      const R = 12;
      const ctrlBg = new Graphics();
      // путь: верх прямой (без скруглений), низ скруглён
      ctrlBg.moveTo(0, stripY);
      ctrlBg.lineTo(w, stripY);
      ctrlBg.lineTo(w, h - R);
      ctrlBg.quadraticCurveTo(w, h, w - R, h);
      ctrlBg.lineTo(R, h);
      ctrlBg.quadraticCurveTo(0, h, 0, h - R);
      ctrlBg.closePath();
      ctrlBg.fill({ color: GOLDEN_ROSE })
         .stroke({ width: 2, color: COLORS.cardEdge, alpha: 0.85 });
      card.addChild(ctrlBg);
    }

    let status: Text | undefined;

    if (busy) {
      // Во время вязки в полосе только подпись — по центру, в две строки.
      // Ни кнопок ускорения, ни «Забрать», ни таймера, ни полосы прогресса: длительность
      // считается по тиру будущего котёнка (config.BREED_MS_BY_TIER), и любой индикатор
      // хода выдал бы игроку тир задолго до рождения. По окончании малыш появится в
      // центре слота сам (game.update → collectReady) — с эффектом-салютом.
      status = label('', 13, COLORS.ink, '700');
      status.position.set(w / 2, stripY + Math.round(CTRL_H / 2) - 4);
      card.addChild(status);
    } else if (hasKitten) {
      // малыш с роднёй: подсказка + быстрые кнопки пристройства (слот блокирован под пару).
      // Перетаскивать малыша тоже можно — берётся за шкирку и несётся в любую комнату.
      const hint = label(t('🐾 малыш с роднёй — пристрой его', '🐾 the kitten is with family — move it out'), 12, COLORS.inkSoft, '700');
      fitLabel(hint, w - 12);
      hint.position.set(w / 2, stripY + 14);
      card.addChild(hint);

      const placeBtn = (text: string, room: 'nursery' | 'shelter', color: number, yy: number): void => {
        const b = new Button({ text, w: Math.round(w * 0.78), h: 28, color, fontSize: 12.5 });
        b.position.set(w / 2, yy);
        b.onTap = () => {
          if (!heldKitten) return;
          const r = moveCat(ctx.state, heldKitten.id, room, ctx.now());
          if (!r.ok) { ctx.toast(r.reason); return; }
          ctx.commit();
          ctx.toast(room === 'shelter' ? t('Малыш в приюте 🏠', 'The kitten is in the shelter 🏠') : t('Малыш в питомнике 🏆', 'The kitten is in the cattery 🏆'));
        };
        card.addChild(b);
        // якоря подсветки обучения: «освободи слот — в Питомник» и «унеси в Приют»
        if (i === 0) anchors.set(room === 'shelter' ? 'toShelter' : 'toNursery', b);
      };
      placeBtn(t(`🏠 В питомник (${roomCount(ctx.state, 'nursery')}/${nurseryCapacity(ctx.state)})`, `🏠 To the cattery (${roomCount(ctx.state, 'nursery')}/${nurseryCapacity(ctx.state)})`),
        'nursery', COLORS.primary, stripY + 38);
      placeBtn(t(`🏚️ В приют (${roomCount(ctx.state, 'shelter')}/${shelterCapacity(ctx.state)})`, `🏚️ To the shelter (${roomCount(ctx.state, 'shelter')}/${shelterCapacity(ctx.state)})`),
        'shelter', COLORS.secondary, stripY + 70);
    } else {
      // пара = поставленные в слот коты (или превью глобального выбора)
      const mother = momCat;
      const father = dadCat;
      const ok = !!mother && !!father;
      if (ok) {
        // предупреждение об инбридинге: пара — родственники (шанс редких
        // родословных рецептов выше, но котёнок рискует здоровьем)
        const kin = kinshipLevel(mother!, father!);
        if (kin !== 'none') {
          // На золотисто-розовой полосе кнопок бледный COLORS.warn не читался:
          // критическое родство — тревожный красный, остальное — тёмная охра,
          // и обоим белая обводка-ореол, чтобы буквы отделялись от полосы.
          const warn = label(t(`⚠️ родство: ${kinshipName(kin)}`, `⚠️ kinship: ${kinshipName(kin)}`), 12,
            kin === 'critical' ? 0xd42a2a : 0x8a5a1e, '800', { color: 0xffffff, width: 3 });
          fitLabel(warn, w - 20);
          // Предупреждение переехало на низ стекла (пустой край матраса, под лапами
          // котов): всю полосу кнопок теперь занимают две крупные кнопки.
          warn.position.set(w / 2, stripY - 14);
          const warnPlate = new Graphics();
          warnPlate.roundRect(w / 2 - warn.width / 2 - 9, stripY - 25, warn.width + 18, 22, 8)
            .fill({ color: 0xffffff, alpha: 0.82 });
          card.addChild(warnPlate, warn);
        }
        // Главные кнопки слота — «Свести» и «🔮 Прогноз пары» (превью исходов,
        // breedingOutcomes). Раньше они делили одну строку, а прогноз был
        // безымянным квадратиком 46 px — на телефоне две мелкие цели вплотную.
        // Теперь обе идут друг под другом во всю ширину полосы.
        const bw = Math.round(w - 16);
        const btnY = stripY + 27;
        // Ореол под главной кнопкой: на золотисто-розовой полосе пастельный
        // розовый сливался с фоном, а это главное действие комнаты.
        const glow = new Graphics();
        glow.roundRect(w / 2 - bw / 2 - 2, btnY - 17, bw + 4, 44, 14)
          .fill({ color: darken(BREED_BTN, 0.5), alpha: 0.3 });
        glow.roundRect(w / 2 - bw / 2 - 3, btnY - 24, bw + 6, 48, 15)
          .stroke({ width: 2.5, color: 0xffffff, alpha: 0.85 });
        card.addChild(glow);
        const btn = new Button({
          text: t('Свести 🐾', 'Breed 🐾'),
          w: bw, h: 42, color: BREED_BTN, // сочный розовый: darken() давал пыльный оттенок
          textColor: 0xffffff, fontSize: Math.max(14, Math.min(18, bw / 10.5)),
        });
        btn.position.set(w / 2, btnY);
        if (i === 0) anchors.set('breed', btn); // якорь подсветки обучения
        btn.onTap = () => {
          const r = startBreeding(ctx.state, i, mother!.id, father!.id, ctx.now(), ctx.rng);
          if (r.ok) { ctx.clearSelection(); ctx.commit(); sfxEvent('breed'); ctx.toast(t('Вязка началась 🐾', 'Breeding has started 🐾')); }
          else ctx.toast(r.reason);
        };
        const pv = new Button({
          text: t('🔮 Прогноз пары', '🔮 Pair forecast'),
          w: bw, h: 32, color: FORECAST_BTN,
          textColor: 0xffffff, fontSize: Math.max(10.5, Math.min(14, bw / 12.5)),
        });
        pv.position.set(w / 2, stripY + 67);
        if (i === 0) anchors.set('preview', pv); // якорь подсветки обучения
        pv.onTap = () => ctx.openPairPreview(mother!, father!);
        card.addChild(btn, pv);
      } else {
        const hint = label(t('Добавь котов для скрещивания', 'Add cats to breed'), 13, COLORS.inkSoft, '600');
        fitLabel(hint, w - 12);
        hint.position.set(w / 2, stripY + 64);
        card.addChild(hint);
      }
    }

    if (i === 0) anchors.set('slot', card); // якорь подсветки обучения (первый слот)

    live.push({
      index: i,
      card, cardW: w, cardH: h,
      status,
      busy, startedAt: slot.startedAt,
      partition, partRaise,
      mom, dad,
      momCat, dadCat,
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
   * апгрейд «Слоты вязки», что и в Генолабе → Улучшения); более дальний — ждёт,
   * пока откроют предыдущий.
   */
  function buildLockedSlot(i: number, w: number, h: number): Container {
    const card = new Container();
    card.addChild(panel(w, h, COLORS.card, 16, 0.55));

    const lock = label('🔒', Math.min(w, h) * 0.26, COLORS.inkSoft, '700');
    lock.alpha = 0.5;
    lock.position.set(w / 2, h * 0.42);
    card.addChild(lock);

    const isNext = i === ctx.state.slots.length && !upgradeMaxed(ctx.state, 'slots');
    if (isNext) {
      const levelAllows = ctx.state.slots.length < maxSlotsForLevel(ctx.state);
      if (!levelAllows) {
        // слот заперт уровнем лаборатории — подсказка «Откроется на ур. N»
        const need = nextSlotUnlockLevel(ctx.state);
        const hint = lockHint(need ? t(`Откроется на ур. ${need}`, `Unlocks at lv. ${need}`) : t('Максимум слотов', 'All slots unlocked'));
        hint.position.set(w / 2, h - 26);
        card.addChild(hint);
      } else {
        const cost = upgradeCost(ctx.state, 'slots');
        const afford = !!cost && ctx.state.coins >= cost.amount;
        const btn = new Button({
          text: cost ? t(`Открыть · ${cost.amount} 💰`, `Unlock · ${cost.amount} 💰`) : t('Открыть слот', 'Unlock slot'),
          w: w - 24, h: 38, color: afford ? COLORS.good : COLORS.cardEdge,
          textColor: afford ? 0xffffff : COLORS.inkSoft, fontSize: 14,
        });
        btn.enabled = afford;
        btn.position.set(w / 2, h - 26);
        btn.onTap = () => {
          const r = buyUpgrade(ctx.state, 'slots');
          if (r.ok) { sfxEvent('buy'); ctx.commit(); ctx.toast(t('Новый слот вязки 💞', 'A new breeding slot 💞')); }
          else ctx.toast(r.reason === 'locked' ? t('Слот ещё заперт 🔒', 'The slot is still locked 🔒') : r.reason);
        };
        card.addChild(btn);
      }
    } else {
      const hint = lockHint(t('откроется после предыдущего', 'unlocks after the previous one'), 11.5);
      hint.position.set(w / 2, h - 26);
      card.addChild(hint);
    }
    return card;
  }

  // ============ Шприц-ветеринар ============
  // Механика ветеринара переехала сюда из Питомника: плавающий шприц в правом
  // верхнем углу Инкубатора. Тащишь его на кота в слоте вязки → «рабочее меню»
  // лечения (ctx.openHealConfirm): 📺 восполняет HEAL_AD_HEARTS ❤, 💎 — полностью.
  // Гейт прежний — узел «💉 Ветеринар» (LAB_UNLOCKS.clinic): пока не куплен, шприц
  // притушён и на попытку тащить подсказывает открыть его в Генолабе.
  const SYRINGE_H = 40;
  const syringeLayer = new Container();   // «домашний» шприц (пересобирается в refresh)
  shell.container.addChild(syringeLayer);
  const dragOverlay = new Container();    // призрак-шприц + подсветка цели во время виса
  dragOverlay.eventMode = 'none';
  shell.container.addChild(dragOverlay);

  let syrArtNode: Container | null = null; // тело шприца дома (для «дыхания» в tick)
  let syrPhase = 0;
  let syrGhost: Container | null = null;   // призрак, что летит за курсором
  let syrHover: Graphics | null = null;    // кольцо-подсветка кота под курсором

  // Эффект укола: пачка красных плюсиков + кольцо-вспышка + упругий «поп» кота.
  // Живёт в своём слое на container комнаты (НЕ в body): лечение делает commit,
  // а тот пересобирает тело комнаты — эффект в body умер бы, не начавшись.
  const HEAL_PULSE_S = 0.55;               // длительность «попа» вылеченного кота
  const healLayer = new Container();
  healLayer.eventMode = 'none';
  shell.container.addChild(healLayer);
  const healPluses: HealPlus[] = [];
  let healRing: { g: Graphics; x: number; y: number; r: number; life: number; ttl: number } | null = null;
  let healPulseId: string | null = null;   // кот, который сейчас «подпрыгивает»
  let healPulse = 0;

  /** Рисуем шприц (иглой вниз-влево, «на котов»). h — высота иконки. */
  function syringeArt(h: number, locked: boolean): Container {
    const c = new Container();
    const g = new Graphics();
    const L = h * 2.15;              // длина по оси шприца
    const bt = h * 0.46;            // толщина колбы
    const x0 = -L / 2;              // остриё иглы (слева)
    const metal = locked ? 0x9aa3ab : 0xc2ccd6;
    const glass = locked ? 0xcfd4d9 : 0xffffff;
    const edge = locked ? 0x9aa3ab : 0x8fa6c4;
    const liquid = locked ? 0xa8aeb4 : 0xff6b8a; // «здоровье» в тон сердечек

    const xHub = x0 + L * 0.22;
    const bx = xHub + h * 0.14;      // начало колбы
    const xBarrelR = x0 + L * 0.66;  // конец колбы = фланец
    const xRodEnd = x0 + L * 0.9;
    const xThumb = x0 + L * 0.98;

    // игла + хаб-конус
    g.moveTo(x0, 0).lineTo(xHub, 0).stroke({ width: Math.max(2, h * 0.06), color: metal, cap: 'round' });
    g.moveTo(xHub, -bt * 0.26).lineTo(bx, -bt * 0.4).lineTo(bx, bt * 0.4).lineTo(xHub, bt * 0.26).closePath().fill(metal);
    // колба (стекло) + жидкость + деления
    g.roundRect(bx, -bt / 2, xBarrelR - bx, bt, bt * 0.18).fill({ color: glass, alpha: 0.92 }).stroke({ width: Math.max(1.5, h * 0.03), color: edge });
    g.roundRect(bx + 2, -bt / 2 + 3, (xBarrelR - bx) * 0.6, bt - 6, bt * 0.14).fill({ color: liquid, alpha: 0.92 });
    for (let i = 1; i <= 3; i++) {
      const tx = bx + (xBarrelR - bx) * (i / 4);
      g.moveTo(tx, -bt * 0.3).lineTo(tx, -bt * 0.1).stroke({ width: 1.2, color: edge, alpha: 0.7 });
    }
    // фланец, шток поршня, упор большого пальца
    g.roundRect(xBarrelR - h * 0.04, -bt * 0.62, h * 0.12, bt * 1.24, 3).fill(metal);
    g.moveTo(xBarrelR, 0).lineTo(xRodEnd, 0).stroke({ width: Math.max(2.5, h * 0.09), color: locked ? 0x8a9096 : 0xd7dde3, cap: 'round' });
    g.roundRect(xThumb - h * 0.05, -bt * 0.5, h * 0.14, bt, 4).fill(metal);
    if (!locked) g.roundRect(bx + 3, -bt / 2 + 3, xBarrelR - bx - 6, bt * 0.16, 4).fill({ color: 0xffffff, alpha: 0.5 });

    c.addChild(g);
    c.rotation = -0.5; // остриё смотрит вниз-вправо (наклон «/»)
    return c;
  }

  /** Кот под точкой (координаты сцены uiRoot) в одном из слотов — цель лечения. */
  function healTargetAt(gx: number, gy: number): { cat: Cat; sprite: Sprite; catH: number } | null {
    for (const ls of live) {
      const p = ls.card.toLocal({ x: gx, y: gy }, ctx.uiRoot);
      if (p.x < 0 || p.x > ls.cardW || p.y < 0 || p.y > ls.cardH) continue;
      // выбираем ближайшего по X из стоящих в слоте родителей (chamber без смещения,
      // поэтому sprite.x сопоставим с p.x — координаты карточки)
      const cands: { cat: Cat; sprite: Sprite }[] = [];
      if (ls.dad && ls.dadCat) cands.push({ cat: ls.dadCat, sprite: ls.dad });
      if (ls.mom && ls.momCat) cands.push({ cat: ls.momCat, sprite: ls.mom });
      if (!cands.length) continue;
      let best = cands[0]!, bestD = Infinity;
      for (const cd of cands) { const d = Math.abs(cd.sprite.x - p.x); if (d < bestD) { bestD = d; best = cd; } }
      return { cat: best.cat, sprite: best.sprite, catH: ls.catH };
    }
    return null;
  }

  /** Куда «ставить укол»: грудка кота с таким id в одном из слотов вязки. */
  function healSpotOf(catId: string): { x: number; y: number; catH: number } | null {
    for (const ls of live) {
      const sp = ls.momCat?.id === catId ? ls.mom : ls.dadCat?.id === catId ? ls.dad : undefined;
      if (!sp) continue;
      const p = shell.container.toLocal(sp.getGlobalPosition()); // спрайт стоит лапами в position
      return { x: p.x, y: p.y - ls.catH * 0.55, catH: ls.catH };
    }
    return null;
  }

  /**
   * Мини-анимация лечения: из кота выпрыгивает пачка красных плюсиков и всплывает
   * вверх, расходясь веером и покачиваясь; вдогонку — красное кольцо-вспышка, а сам
   * кот делает упругий «поп». Плюсиков тем больше, чем больше ❤ вернул ветеринар.
   * Зовётся из диалога ветеринара уже ПОСЛЕ commit — по свежим спрайтам слотов.
   */
  function playHealFx(catId: string, hearts: number): void {
    const spot = healSpotOf(catId);
    if (!spot) return; // кота уже нет в слоте (лечили из dev-консоли) — эффекту негде играть
    const { x, y, catH } = spot;
    healPulseId = catId;
    healPulse = HEAL_PULSE_S;

    healRing?.g.destroy();
    const ring = new Graphics();
    healLayer.addChild(ring);
    healRing = { g: ring, x, y, r: catH, life: 0, ttl: 0.45 };

    const n = Math.min(14, 7 + Math.max(1, hearts) * 2);
    for (let i = 0; i < n; i++) {
      const view = healPlusIcon(catH * (0.16 + Math.random() * 0.12));
      view.visible = false; // покажется, когда дойдёт очередь (delay) — пачка идёт волной
      healLayer.addChild(view);
      healPluses.push({
        view, delay: i * 0.055 + Math.random() * 0.04,
        life: 0, ttl: 0.85 + Math.random() * 0.5,
        x0: x + (Math.random() - 0.5) * catH * 0.55,
        y0: y + (Math.random() - 0.5) * catH * 0.18,
        // подъём меряем от груди кота и держим в пределах стекла бокса: плюсики,
        // всплывающие поверх рамки окна, читаются как «мусор вне слота»
        rise: catH * (0.55 + Math.random() * 0.45),
        sway: catH * (0.06 + Math.random() * 0.1) * (Math.random() < 0.5 ? -1 : 1),
        phase: Math.random() * Math.PI * 2,
      });
    }
  }

  function moveSyringeGhost(e: FederatedPointerEvent): void {
    if (!syrGhost) return;
    const p = shell.container.toLocal(e.global);
    syrGhost.position.set(p.x, p.y);
    // подсветка кота-цели под курсором
    const uiP = ctx.uiRoot.toLocal(e.global);
    const target = healTargetAt(uiP.x, uiP.y);
    if (target && syrHover) {
      const gp = shell.container.toLocal(target.sprite.getGlobalPosition());
      syrHover.clear();
      syrHover.circle(gp.x, gp.y - target.catH * 0.35, target.catH * 0.62)
        .stroke({ width: 4, color: 0x7ee0a6, alpha: 0.95 });
      syrHover.visible = true;
    } else if (syrHover) {
      syrHover.visible = false;
    }
  }

  function dropSyringe(e: FederatedPointerEvent): void {
    ctx.app.stage.off('globalpointermove', moveSyringeGhost);
    ctx.app.stage.off('pointerup', dropSyringe);
    ctx.app.stage.off('pointerupoutside', dropSyringe);
    ctx.app.canvas.style.cursor = 'default';
    syrGhost?.destroy({ children: true }); syrGhost = null;
    syrHover?.destroy(); syrHover = null;
    if (syrArtNode) syrArtNode.visible = true;
    const uiP = ctx.uiRoot.toLocal(e.global);
    const target = healTargetAt(uiP.x, uiP.y);
    if (!target) { ctx.toast(t('Наведи шприц на кота в слоте вязки 💉', 'Point the syringe at a cat in a breeding slot 💉')); return; }
    const healed = target.cat;
    // «рабочее меню ветеринара»; вылечили — играем плюсики над этим котом
    ctx.openHealConfirm(healed, (hearts) => playHealFx(healed.id, hearts));
  }

  function startSyringeDrag(e: FederatedPointerEvent): void {
    if (syrGhost) return;
    e.stopPropagation();                 // не даём начаться свайпу комнат
    if (!isUnlocked(ctx.state, 'clinic')) { ctx.toast(t('Открой «Ветеринара» в Генолабе 🔬', 'Unlock the "Vet" in the Genolab 🔬')); return; }
    ctx.app.canvas.style.cursor = 'grabbing';
    if (syrArtNode) syrArtNode.visible = false; // прячем домашний шприц на время виса
    syrGhost = syringeArt(SYRINGE_H * 1.15, false);
    dragOverlay.addChild(syrGhost);
    syrHover = new Graphics();
    syrHover.visible = false;
    dragOverlay.addChild(syrHover);
    moveSyringeGhost(e);
    ctx.app.stage.on('globalpointermove', moveSyringeGhost);
    ctx.app.stage.on('pointerup', dropSyringe);
    ctx.app.stage.on('pointerupoutside', dropSyringe);
  }

  function renderSyringe(cx: number, cy: number): void {
    syringeLayer.removeChildren();
    syrArtNode = null;
    const unlocked = isUnlocked(ctx.state, 'clinic');
    const wrap = new Container();
    // прозрачная хит-область побольше (шприц тонкий — по тонкой игле не попасть)
    const hit = new Graphics();
    hit.circle(0, 0, SYRINGE_H * 0.95).fill({ color: 0xffffff, alpha: 0.001 });
    const art = syringeArt(SYRINGE_H, !unlocked);
    const cap = unlocked
      ? label(t('💉 лечить', '💉 heal'), 12, 0xffffff, '800', { color: 0x2c2438, width: 3 })
      : lockHint(t('🔒 в Генолабе', '🔒 in the Genolab'), 11);
    cap.position.set(0, SYRINGE_H * 0.98);
    wrap.addChild(hit, art, cap);
    syrArtNode = art;
    wrap.position.set(cx, cy);
    wrap.eventMode = 'static';
    wrap.cursor = 'grab';
    wrap.on('pointerdown', startSyringeDrag);
    syringeLayer.addChild(wrap);
  }

  function refresh(): void {
    for (const c of shell.body.removeChildren()) c.destroy({ children: true });
    live = [];
    anchors.clear(); // узлы уничтожены вместе с телом комнаты
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

    // Ширина окна = ширина видимого стекла бокса. Ограничена и колонкой, и высотой:
    // по вертикали должны уложиться само окно, полоса кнопок (она наезжает на низ
    // окна) и хотя бы кусочек тумбы. На телефоне-ландшафте упирается именно в
    // высоту — раньше в этом месте окно ужималось «cover'ом» и переставало
    // совпадать по ширине с полосой кнопок.
    const colW = (shell.contentW - gap * (N - 1)) / N;
    const budget = shell.contentH + STAND_NAV_OVERHANG; // тумбе можно чуть свеситься
    const byH = (budget - CTRL_H) / (GLASS_RATIO * (1 - CTRL_OVERLAP) + STAND_MIN_FRAC);
    const slotW = Math.max(140, Math.min(colW, SLOT_MAX_W, byH));
    const glassH = slotW * GLASS_RATIO;
    const bodyH = glassH * (1 - CTRL_OVERLAP) + CTRL_H; // окно + полоса кнопок

    // Тумба под окном. Её верх утоплен под окно и полосу кнопок (STAND_SEAT) — видна
    // только нижняя часть. Если места под полосой мало (телефон-ландшафт), тумбу
    // сперва слегка приплющиваем (читается как более пологий ракурс), и только
    // потом сужаем — иначе под широким окном оставался бы тонкий столбик.
    const standNatW = slotW * STAND_W_FRAC;
    const standNatUnder = (standNatW / standAspect) * (1 - STAND_SEAT);
    const standUnder = Math.max(0, Math.min(standNatUnder, budget - bodyH));
    const standW = Math.min(standNatW,
      (standUnder / ((1 - STAND_SEAT) * STAND_SQUASH_MIN)) * standAspect);
    const standSquash = standW > 0
      ? standUnder / ((standW / standAspect) * (1 - STAND_SEAT))
      : 1;

    const blockH = bodyH + standUnder;
    const totalW = slotW * N + gap * (N - 1);
    const startX = Math.max(0, (shell.contentW - totalW) / 2);
    const startY = Math.max(0, (shell.contentH - blockH) / 2);
    const colX = (i: number): number => startX + i * (slotW + gap) + slotW / 2;

    // Подставки рисуем первыми — они под окнами (окно перекрывает верх платформы).
    if (standTex) {
      for (let i = 0; i < N; i++) {
        const s = new Sprite(standTex);
        s.anchor.set(0.5, 1);
        const sx = standW / standTex.width;
        s.scale.set(sx, sx * standSquash);
        s.position.set(colX(i), startY + blockH); // низ подставки = низ блока
        shell.body.addChild(s);
      }
    }

    for (let i = 0; i < N; i++) {
      const locked = i >= owned;
      const c = locked ? buildLockedSlot(i, slotW, bodyH) : buildSlot(i, slotW);
      c.position.set(startX + i * (slotW + gap), startY);
      shell.body.addChild(c);
    }

    renderBoostChips(plateW); // подсветка чипов усилителей зависит от зарядов
    // Шприц-ветеринар — над правым краем последнего (3-го) слота вязки; по высоте —
    // примерно на середине зазора от топбара (низ topInset) до верха окна слота.
    // Клампим по X, чтобы не ушёл за край комнаты.
    const syrX = Math.min(ctx.roomW - 34, colX(N - 1) + slotW * 0.4);
    // startY отсчитан от body; верх окна слота в координатах комнаты — с учётом
    // смещения body (topInset + 8 + titleH + 12). Ставим шприц на середину между
    // низом топбара (topInset) и верхом окна слота.
    const slotTopY = ctx.topInset + 8 + shell.titleH + 12 + startY;
    const syrY = (ctx.topInset + slotTopY) / 2;
    renderSyringe(syrX, syrY); // замок шприца снимается, когда куплен узел «Ветеринар»
  }

  function tick(dt: number): void {
    const now = ctx.now();

    // пульс ореола заряженных усилителей у названия комнаты («ярко горит»)
    for (const bg of boostGlows) {
      bg.phase += dt;
      bg.halo.alpha = 0.38 + 0.56 * (0.5 + 0.5 * Math.sin(bg.phase * 4));
    }
    // мигание ярлыка «⚡ готов» — заметнее ровного свечения
    for (const rp of readyPulses) {
      rp.phase += dt;
      rp.view.alpha = 0.55 + 0.45 * Math.sin(rp.phase * 5);
    }
    // «дыхание» домашнего шприца — лёгкое парение + покачивание вокруг наклона
    if (syrArtNode && syrArtNode.visible) {
      syrPhase += dt;
      syrArtNode.y = Math.sin(syrPhase * 2) * 3;
      syrArtNode.rotation = -0.5 + Math.sin(syrPhase * 1.3) * 0.05;
    }

    for (const ls of live) {
      ls.phase += dt;
      const slot = ctx.state.slots[ls.index];

      // подпись вязки: ни цифр, ни прогресса (выдали бы тир) — только «дышащее»
      // многоточие, чтобы слот не выглядел зависшим
      if (ls.status && slot && slot.readyAt > 0) {
        const remain = slot.readyAt - now;
        const dots = '.'.repeat(1 + (Math.floor(now / 400) % 3));
        ls.status.text = remain <= 0
          ? t('Готово! 🥚', 'Done! 🥚')
          : t(`Пара ждёт потомства.
Вязка идёт${dots}`, `The pair is expecting.
Breeding${dots}`);
      }

      if (ls.busy && ls.mom && ls.dad) {
        // перегородка поднимается, коты сходятся к центру
        const a = easeOut(clamp01((now - ls.startedAt) / APPROACH_MS));
        ls.partition.y = -a * ls.partRaise;
        ls.partition.alpha = 1 - a;
        const momX = lerp(ls.momHomeX, ls.momMeetX, a);
        const dadX = lerp(ls.dadHomeX, ls.dadMeetX, a);
        // Романтическая подача: коты стоят рядышком и ласково тянутся друг к другу
        // мордочками. Медленное покачивание навстречу + мягкое «дыхание» — никакой
        // ритмичной тряски, чтобы сцена читалась как нежность, а не как садка.
        const nuzzle = (0.5 + 0.5 * Math.sin(ls.phase * 1.7)) * a; // 0..1, плавно
        const breath = 1 + Math.sin(ls.phase * 2.1) * 0.03;
        ls.mom.x = momX - nuzzle * ls.catH * 0.05;   // мягко тянется к центру
        ls.dad.x = dadX + nuzzle * ls.catH * 0.05;
        ls.mom.scale.y = ls.momBase * breath;
        ls.dad.scale.y = ls.dadBase * breath;
        // головы чуть склоняются друг к другу — «трутся мордочками»
        ls.mom.rotation = -nuzzle * 0.09;
        ls.dad.rotation = nuzzle * 0.09;
        // сердечки — весь процесс, гуще в момент, когда прижались
        if (a > 0.55) {
          ls.heartTimer -= dt;
          if (ls.heartTimer <= 0) {
            spawnHeart(ls);
            ls.heartTimer = (0.5 - nuzzle * 0.22) + Math.random() * 0.3;
          }
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

      // «поп» только что вылеченного кота — короткий упругий рывок вместе с плюсиками.
      // Масштаб задаём от базы (не домножаем текущий), иначе за кадры накопится.
      if (healPulse > 0 && healPulseId) {
        const k = 1 + Math.sin(clamp01(1 - healPulse / HEAL_PULSE_S) * Math.PI) * 0.18;
        if (ls.mom && ls.momCat?.id === healPulseId) ls.mom.scale.set(-ls.momBase * k, ls.mom.scale.y * k);
        if (ls.dad && ls.dadCat?.id === healPulseId) ls.dad.scale.set(ls.dadBase * k, ls.dad.scale.y * k);
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

    // --- эффект укола ветеринара (общий для комнаты, живёт поверх слотов) ---
    if (healPulse > 0) {
      healPulse = Math.max(0, healPulse - dt);
      if (healPulse === 0) healPulseId = null;
    }
    if (healRing) {
      const hr = healRing;
      hr.life += dt;
      const t = clamp01(hr.life / hr.ttl);
      hr.g.clear();
      hr.g.circle(hr.x, hr.y, hr.r * (0.25 + t * 0.85))
        .stroke({ width: Math.max(1.5, hr.r * 0.09 * (1 - t)), color: 0xff5b7a, alpha: 0.8 * (1 - t) });
      if (t >= 1) { hr.g.destroy(); healRing = null; }
    }
    for (let k = healPluses.length - 1; k >= 0; k--) {
      const p = healPluses[k]!;
      if (p.delay > 0) { p.delay -= dt; if (p.delay > 0) continue; }
      p.view.visible = true;
      p.life += dt;
      const t = clamp01(p.life / p.ttl);
      p.view.y = p.y0 - p.rise * easeOut(t);                 // всплывает, замедляясь
      p.view.x = p.x0 + Math.sin(p.phase + t * 4) * p.sway;  // покачивается по дороге
      const pop = clamp01(t / 0.18);                          // выпрыгивает с перелётом
      p.view.scale.set((0.35 + 0.65 * easeOut(pop)) * (1 + Math.sin(pop * Math.PI) * 0.18));
      p.view.alpha = t < 0.65 ? 1 : 1 - (t - 0.65) / 0.35;
      p.view.rotation = Math.sin(p.phase + t * 3) * 0.22;
      if (p.life >= p.ttl) { p.view.destroy({ children: true }); healPluses.splice(k, 1); }
    }
  }

  /** Кота уронили в инкубаторе: ищем слот под точкой и ставим кота в вязку. */
  function tryDropCat(cat: Cat, gx: number, gy: number): boolean {
    // Точка приходит в координатах виртуальной сцены. Сравниваем в СВОИХ координатах
    // карточки (getBounds() не годится: спрайт бокса шире видимого стекла — прозрачные
    // поля вырезки, и зоны соседних слотов налезали бы друг на друга).
    for (const ls of live) {
      const p = ls.card.toLocal({ x: gx, y: gy }, ctx.uiRoot);
      if (p.x >= 0 && p.x <= ls.cardW && p.y >= 0 && p.y <= ls.cardH) {
        const r = assignBreeder(ctx.state, ls.index, cat.id, ctx.now());
        if (!r.ok) { ctx.toast(r.reason); return false; }
        ctx.commit();
        ctx.toast(cat.genotype.sex === 'female' ? t('Кошка в слоте 💞', 'The female is in a slot 💞') : t('Кот в слоте 💞', 'The male is in a slot 💞'));
        return true;
      }
    }
    ctx.toast(t('перетащи кота на слот вязки', 'drag a cat onto a breeding slot'));
    return false;
  }

  return {
    id: 'incubator', title: t('🧬 Инкубатор', '🧬 Incubator'), container: shell.container, refresh, tick, tryDropCat,
    // Обучение новичка: 'slot' — карточка первого слота, 'breed' — «Свести»,
    // 'preview' — 🔮 прогноз пары,
    // 'toNursery'/'toShelter' — кнопки «куда унести» у родившегося малыша,
    // `cat:<id>` — сам кот в окошке вязки (малыш или родитель), см. ui/tutorial.ts.
    anchor: (key) => {
      const node = anchors.get(key);
      return node && !node.destroyed ? node : null;
    },
  };
}
