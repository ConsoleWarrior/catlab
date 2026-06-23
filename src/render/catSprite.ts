/**
 * Послойная сборка котика из фенотипа (плейсхолдер-арт на Pixi Graphics).
 * Стиль: милый, крупные глаза, псевдо-3D объём через мягкие тени/блики (AO).
 * Две позы: 'sit' (сидит спереди) и 'hang' (вис за шкирку).
 * Половой диморфизм: самец крупнее, шире морда, щёки-jowls и грозные брови;
 * самка мельче, мягче, с ресничками.
 * На Этапе 3 слои заменятся ИИ-спрайтами, но структура и логика
 * «фенотип → внешний вид» сохранится.
 */

import { Container, Graphics } from 'pixi.js';
import type { Phenotype } from '../genetics/index.js';
import {
  coatColor, eyeColor, darken, lighten, mix, SKIN_PINK, WHITE,
} from './palette.js';

export type CatPose = 'sit' | 'hang';
export type CatSex = 'male' | 'female';

interface CatColors {
  body: number;
  point: number;
  pattern: number;
}

function resolveColors(p: Phenotype): CatColors {
  if (p.white) return { body: WHITE, point: WHITE, pattern: WHITE };
  const base = coatColor(p.baseColor);
  if (p.pointed) {
    const body = lighten(base, 0.6);
    return { body, point: base, pattern: darken(base, 0.25) };
  }
  return { body: base, point: base, pattern: darken(base, 0.3) };
}

/** Эллипс с псевдо-3D объёмом: базовая заливка + нижнее AO + верхний блик. */
function volEllipse(cx: number, cy: number, hw: number, hh: number, color: number): Graphics {
  const g = new Graphics();
  g.ellipse(cx, cy, hw, hh).fill(color);
  g.ellipse(cx, cy + hh * 0.34, hw * 0.82, hh * 0.5).fill({ color: 0x000000, alpha: 0.10 });
  g.ellipse(cx - hw * 0.3, cy - hh * 0.36, hw * 0.5, hh * 0.4).fill({ color: 0xffffff, alpha: 0.16 });
  return g;
}

/**
 * Мягкий пушистый контур (длинная шерсть) вокруг эллипса.
 * Рисуется ПОЗАДИ заливки, чтобы тафты шерсти выглядывали по краю тела.
 * Не остроконечная «звезда»: много мелких тафт малой амплитуды.
 */
function furFringe(cx: number, cy: number, hw: number, hh: number, color: number, tuft = 12): Graphics {
  const g = new Graphics();
  const n = 44;
  const pts: number[] = [];
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    const out = i % 2 === 0 ? tuft : tuft * 0.25;
    pts.push(cx + Math.cos(a) * (hw + out), cy + Math.sin(a) * (hh + out));
  }
  g.poly(pts).fill(color);
  return g;
}

/** Большой выразительный глаз. */
function drawEye(cx: number, cy: number, iris: number): Graphics {
  const g = new Graphics();
  g.ellipse(cx, cy, 22, 26).fill(0xffffff);
  g.ellipse(cx, cy, 22, 26).stroke({ width: 3, color: 0x3a3330, alpha: 0.5 });
  g.circle(cx, cy + 1, 17).fill(iris);
  g.circle(cx, cy + 1, 17).fill({ color: 0x000000, alpha: 0.12 }); // лёгкое затемнение по краю радужки
  g.circle(cx, cy + 2, 9).fill(0x1c1714);
  g.circle(cx - 5, cy - 5, 5).fill({ color: 0xffffff, alpha: 0.9 });
  g.circle(cx + 4, cy + 7, 2.5).fill({ color: 0xffffff, alpha: 0.7 });
  return g;
}

/** Ухо в локальных координатах головы (центр головы = 0,0). */
function drawEar(side: -1 | 1, shape: Phenotype['earShape'], fur: number, spread = 38): Graphics {
  const g = new Graphics();
  const x = side * spread;
  const inner = mix(SKIN_PINK, fur, 0.3);
  if (shape === 'fold') {
    g.poly([x - 22, -44, x + 22, -44, x + side * 6, -20]).fill(fur);
    g.poly([x - 14, -42, x + 14, -42, x + side * 4, -26]).fill(inner);
  } else if (shape === 'curl') {
    g.poly([x - 16, -40, x + 18, -76, x + 30, -46]).fill(fur);
    g.poly([x - 8, -44, x + 14, -70, x + 22, -48]).fill(inner);
  } else {
    g.poly([x - 22, -42, x + side * 4, -92, x + 24, -38]).fill(fur);
    g.poly([x - 13, -44, x + side * 2, -80, x + 15, -42]).fill(inner);
  }
  return g;
}

/** Морда: нос, рот, щёчки, усы (локальные координаты головы). */
function drawFace(): Graphics {
  const g = new Graphics();
  g.poly([-7, 12, 7, 12, 0, 20]).fill(SKIN_PINK);              // нос
  g.circle(-36, 18, 11).fill({ color: 0xff9bb0, alpha: 0.32 });// щёчки
  g.circle(36, 18, 11).fill({ color: 0xff9bb0, alpha: 0.32 });
  g.moveTo(0, 20); g.lineTo(0, 26);
  g.moveTo(0, 26); g.quadraticCurveTo(-8, 32, -14, 26);
  g.moveTo(0, 26); g.quadraticCurveTo(8, 32, 14, 26);
  g.stroke({ width: 2.5, color: 0x4a3f3a, alpha: 0.7 });
  for (const dy of [14, 22]) {
    g.moveTo(-12, dy); g.lineTo(-52, dy - 6);
    g.moveTo(12, dy); g.lineTo(52, dy - 6);
  }
  g.stroke({ width: 1.5, color: 0x000000, alpha: 0.22 });
  return g;
}

/** Рисунок (табби) внутри заданных границ тела. */
function drawBodyPattern(p: Phenotype, c: CatColors, cx: number, cy: number, hw: number, hh: number): Graphics {
  const g = new Graphics();
  const col = c.pattern;
  if (p.pattern === 'mackerel') {
    for (let i = -2; i <= 2; i++) {
      const x = cx + i * (hw * 0.36);
      g.moveTo(x, cy - hh * 0.3);
      g.quadraticCurveTo(x + 8, cy, x, cy + hh * 0.6);
      g.stroke({ width: 7, color: col, alpha: 0.5 });
    }
  } else if (p.pattern === 'classic') {
    g.ellipse(cx, cy, hw * 0.5, hh * 0.55).stroke({ width: 8, color: col, alpha: 0.45 });
    g.ellipse(cx, cy, hw * 0.24, hh * 0.3).stroke({ width: 6, color: col, alpha: 0.45 });
  } else if (p.pattern === 'spotted') {
    const spots = [[-0.5, -0.2], [0.2, -0.3], [-0.2, 0.2], [0.45, 0.25], [-0.5, 0.5], [0.3, 0.6]];
    for (const s of spots) g.circle(cx + s[0]! * hw, cy + s[1]! * hh, 9).fill({ color: col, alpha: 0.5 });
  } else if (p.pattern === 'ticked') {
    const fl = [[-0.35, -0.1], [0.2, -0.2], [-0.1, 0.3], [0.4, 0.3], [-0.5, 0.4]];
    for (const s of fl) g.circle(cx + s[0]! * hw, cy + s[1]! * hh, 4).fill({ color: col, alpha: 0.4 });
  }
  return g;
}

/** Белые пятна внутри границ тела. */
function drawWhiteSpotting(amount: number, cx: number, cy: number, hw: number, hh: number): Graphics {
  const g = new Graphics();
  if (amount <= 0) return g;
  g.ellipse(cx, cy + hh * 0.2, hw * (0.45 + amount * 0.3), hh * (0.5 + amount * 0.3)).fill(WHITE);
  if (amount > 0.75) g.ellipse(cx, cy, hw * 0.85, hh * 0.9).fill(WHITE);
  return g;
}

/** Голова с ушами, глазами и мордой. Локальный центр головы = (0,0). */
function buildHead(p: Phenotype, c: CatColors, sex: CatSex): Container {
  const h = new Container();
  const long = p.coatLength === 'long';
  const male = sex === 'male';
  const hw = male ? 62 : 54;  // самец — шире
  const hh = male ? 50 : 54;  // самец — ниже/тяжелее, самка — округлее

  if (long) h.addChild(furFringe(0, 0, hw, hh, lighten(c.body, 0.12), 12));
  h.addChild(volEllipse(0, 0, hw, hh, c.body));

  if (p.pointed) {
    const m = new Graphics();
    m.ellipse(0, 12, 40, 28).fill({ color: c.point, alpha: 0.5 });
    h.addChild(m);
  }

  const earSpread = male ? 44 : 38;
  h.addChild(drawEar(-1, p.earShape, c.point, earSpread));
  h.addChild(drawEar(1, p.earShape, c.point, earSpread));

  // самец: тяжёлые щёки-jowls (как у взрослого кота-производителя)
  if (male) {
    const j = new Graphics();
    for (const sx of [-1, 1] as const) {
      j.ellipse(sx * 48, 24, 20, 16).fill(c.body);
      j.ellipse(sx * 48, 28, 15, 9).fill({ color: 0x000000, alpha: 0.08 });
      j.ellipse(sx * 52, 18, 8, 6).fill({ color: 0xffffff, alpha: 0.12 });
    }
    h.addChild(j);
  }

  if (!p.white && p.pattern) {
    const m = new Graphics();
    m.poly([-24, -34, -15, -22, -6, -34]).stroke({ width: 4, color: c.pattern, alpha: 0.7 });
    m.poly([6, -34, 15, -22, 24, -34]).stroke({ width: 4, color: c.pattern, alpha: 0.7 });
    h.addChild(m);
  }

  const eyes = new Container();
  eyes.label = 'eyes';
  const iris = eyeColor(p.eyeColor);
  eyes.addChild(drawEye(-24, -6, iris));
  eyes.addChild(drawEye(24, -6, p.oddEyed ? eyeColor('copper') : iris));
  // самка: реснички во внешних уголках (моргают вместе с глазами)
  if (!male) {
    const l = new Graphics();
    for (const sx of [-1, 1] as const) {
      const ex = sx * 24;
      l.moveTo(ex + sx * 20, -12); l.lineTo(ex + sx * 32, -18);
      l.moveTo(ex + sx * 21, -7); l.lineTo(ex + sx * 34, -10);
    }
    l.stroke({ width: 2.5, color: 0x3a2f2a, cap: 'round' });
    eyes.addChild(l);
  }
  h.addChild(eyes);

  // самец: грозные брови (наклон к центру вниз)
  if (male) {
    const b = new Graphics();
    b.moveTo(-42, -40); b.lineTo(-12, -30);
    b.moveTo(42, -40); b.lineTo(12, -30);
    b.stroke({ width: 6, color: darken(c.point, 0.35), cap: 'round' });
    h.addChild(b);
  }

  h.addChild(drawFace());
  return h;
}

/** Поза «сидит спереди». */
function buildSit(p: Phenotype, c: CatColors, sex: CatSex): Container {
  const root = new Container();
  const long = p.coatLength === 'long';
  const bw = sex === 'male' ? 62 : 54; // самец — массивнее
  const bh = 64;

  const shadow = new Graphics();
  shadow.ellipse(0, 140, bw * 1.24, 16).fill({ color: 0x000000, alpha: 0.12 });
  root.addChild(shadow);

  // хвост рисуем СЗАДИ (слева): при флипе по X он всегда трейлит за движением
  const tail = new Graphics();
  tail.moveTo(-bw * 0.8, 100);
  tail.quadraticCurveTo(-bw * 2.0, 74, -bw * 1.78, 10);
  tail.stroke({ width: long ? 34 : 24, color: c.point, cap: 'round' });
  root.addChild(tail);

  if (long) root.addChild(furFringe(0, 74, bw, bh, lighten(c.body, 0.1)));

  root.addChild(volEllipse(0, 74, bw, bh, c.body));            // тело
  const paws = new Graphics();
  for (const sx of [-1, 1] as const) paws.ellipse(sx * bw * 0.45, 122, 18, 14).fill(c.body);
  paws.ellipse(-bw * 0.45, 122, 18, 14).fill({ color: 0xffffff, alpha: 0.12 });
  root.addChild(paws);

  if (!p.white && p.pattern) root.addChild(drawBodyPattern(p, c, 0, 74, bw, bh));
  if (!p.white) root.addChild(drawWhiteSpotting(p.whiteAmount, 0, 74, bw, bh));

  // длинная шерсть: пушистый воротник на груди (вместо «звезды» на голове)
  if (long) root.addChild(furFringe(0, 30, bw * 0.95, 28, lighten(c.body, 0.14), 16));

  const head = buildHead(p, c, sex);
  head.position.set(0, -34);
  root.addChild(head);
  return root;
}

/** Поза «вис за шкирку»: тело вытянуто вниз, лапки и хвост свисают. */
function buildHang(p: Phenotype, c: CatColors, sex: CatSex): Container {
  const root = new Container();
  const long = p.coatLength === 'long';
  const bw = sex === 'male' ? 46 : 40;

  // «защип» шкирки сверху (где держит рука)
  const scruff = new Graphics();
  scruff.ellipse(0, -104, 12, 8).fill(darken(c.body, 0.25));
  root.addChild(scruff);

  // хвост свисает
  const tail = new Graphics();
  tail.moveTo(bw * 0.6, 70);
  tail.quadraticCurveTo(bw * 1.3, 130, bw * 0.9, 188);
  tail.stroke({ width: long ? 30 : 22, color: c.point, cap: 'round' });
  root.addChild(tail);

  // передние лапки болтаются
  const legs = new Graphics();
  for (const sx of [-bw * 0.55, bw * 0.55]) {
    legs.roundRect(sx - 9, 56, 18, 78, 9).fill(c.body);
    legs.circle(sx, 138, 12).fill(c.body);
  }
  root.addChild(legs);

  if (long) root.addChild(furFringe(0, 52, bw, 82, lighten(c.body, 0.1), 10));
  // вытянутое тело
  root.addChild(volEllipse(0, 52, bw, 82, c.body));
  // задние лапки внизу
  const back = new Graphics();
  back.ellipse(-15, 150, 14, 12).fill(c.body);
  back.ellipse(15, 150, 14, 12).fill(c.body);
  root.addChild(back);

  if (!p.white && p.pattern) root.addChild(drawBodyPattern(p, c, 0, 52, bw, 82));
  if (!p.white) root.addChild(drawWhiteSpotting(p.whiteAmount, 0, 52, bw, 82));

  const head = buildHead(p, c, sex);
  head.position.set(0, -56);
  root.addChild(head);
  return root;
}

/** Собирает котика в заданной позе. Глаза доступны как getChildByLabel('eyes', true). */
export function buildCat(p: Phenotype, pose: CatPose = 'sit', sex: CatSex = 'female'): Container {
  const c = resolveColors(p);
  return pose === 'hang' ? buildHang(p, c, sex) : buildSit(p, c, sex);
}
