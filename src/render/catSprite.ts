/**
 * Послойная сборка котика из фенотипа (плейсхолдер-арт на Pixi Graphics).
 * Стиль: милый, крупные глаза. На Этапе 3 слои заменятся на ИИ-спрайты,
 * но структура слоёв и логика «фенотип → внешний вид» сохранится.
 *
 * Локальные координаты центрированы у (0,0); котик ~ 220×260.
 */

import { Container, Graphics } from 'pixi.js';
import type { Phenotype } from '../genetics/index.js';
import {
  coatColor, eyeColor, darken, lighten, mix, SKIN_PINK, WHITE,
} from './palette.js';

interface CatColors {
  body: number;   // основная шерсть
  point: number;  // «точки» (уши/морда/лапы/хвост) — у колор-пойнта темнее
  pattern: number;// цвет рисунка
}

function resolveColors(p: Phenotype): CatColors {
  if (p.white) {
    return { body: WHITE, point: lighten(WHITE, 0), pattern: WHITE };
  }
  const base = coatColor(p.baseColor);
  if (p.pointed) {
    const body = lighten(base, 0.6);
    return { body, point: base, pattern: darken(base, 0.25) };
  }
  return { body: base, point: base, pattern: darken(base, 0.3) };
}

/** Большой выразительный глаз. */
function drawEye(cx: number, cy: number, iris: number): Graphics {
  const g = new Graphics();
  g.ellipse(cx, cy, 22, 26).fill(0xffffff);             // белок
  g.ellipse(cx, cy, 22, 26).stroke({ width: 3, color: 0x3a3330, alpha: 0.5 });
  g.circle(cx, cy + 1, 17).fill(iris);                  // радужка
  g.circle(cx, cy + 1, 17).stroke({ width: 2, color: darken(iris, 0.4), alpha: 0.6 });
  g.circle(cx, cy + 2, 9).fill(0x1c1714);               // зрачок
  g.circle(cx - 5, cy - 5, 5).fill({ color: 0xffffff, alpha: 0.9 }); // блик
  g.circle(cx + 4, cy + 7, 2.5).fill({ color: 0xffffff, alpha: 0.7 });
  return g;
}

function drawEar(side: -1 | 1, shape: Phenotype['earShape'], fur: number): Graphics {
  const g = new Graphics();
  const x = side * 40;
  const inner = mix(SKIN_PINK, fur, 0.3);
  if (shape === 'fold') {
    // вислоухость: маленький треугольник, загнутый вниз
    g.poly([x - 22, -78, x + 22, -78, x + side * 6, -50]).fill(fur);
    g.poly([x - 14, -76, x + 14, -76, x + side * 4, -58]).fill(inner);
  } else if (shape === 'curl') {
    // загнутые назад уши
    g.poly([x - 16, -70, x + 18, -104, x + 30, -74]).fill(fur);
    g.poly([x - 8, -74, x + 14, -98, x + 22, -76]).fill(inner);
  } else {
    // обычные стоячие уши
    g.poly([x - 22, -70, x + side * 4, -118, x + 24, -66]).fill(fur);
    g.poly([x - 13, -72, x + side * 2, -104, x + 15, -70]).fill(inner);
  }
  return g;
}

/** Рисунок (табби) поверх тела/головы. */
function drawPattern(p: Phenotype, c: CatColors): Graphics {
  const g = new Graphics();
  const col = c.pattern;
  // лоб «M» — общая табби-метка
  g.poly([-26, -78, -16, -64, -6, -78]).stroke({ width: 5, color: col, alpha: 0.7 });
  g.poly([6, -78, 16, -64, 26, -78]).stroke({ width: 5, color: col, alpha: 0.7 });

  if (p.pattern === 'mackerel') {
    for (let i = -2; i <= 2; i++) {
      const x = i * 22;
      g.moveTo(x, 30); g.quadraticCurveTo(x + 8, 70, x, 110);
      g.stroke({ width: 7, color: col, alpha: 0.55 });
    }
  } else if (p.pattern === 'classic') {
    g.ellipse(0, 70, 30, 40).stroke({ width: 8, color: col, alpha: 0.5 });
    g.ellipse(0, 70, 14, 22).stroke({ width: 6, color: col, alpha: 0.5 });
  } else if (p.pattern === 'spotted') {
    const spots = [[-30, 50], [10, 40], [-12, 80], [28, 78], [-34, 100], [20, 110]];
    for (const [x, y] of spots) g.circle(x!, y!, 9).fill({ color: col, alpha: 0.55 });
  } else if (p.pattern === 'ticked') {
    const fl = [[-20, 60], [12, 50], [-6, 90], [26, 86], [-30, 96]];
    for (const [x, y] of fl) g.circle(x!, y!, 4).fill({ color: col, alpha: 0.4 });
  }
  return g;
}

/** Белые пятна (грудь/живот/мордочка/лапки) по доле белого. */
function drawWhiteSpotting(amount: number): Graphics {
  const g = new Graphics();
  if (amount <= 0) return g;
  // грудка/живот
  g.ellipse(0, 78, 26 + amount * 18, 34 + amount * 22).fill(WHITE);
  if (amount > 0.4) {
    g.ellipse(0, 4, 30, 22).fill(WHITE);          // белая мордочка
    g.ellipse(-26, 116, 14, 12).fill(WHITE);      // лапки
    g.ellipse(26, 116, 14, 12).fill(WHITE);
  }
  if (amount > 0.75) {
    g.ellipse(0, 60, 50, 60).fill(WHITE);         // почти весь корпус белый
  }
  return g;
}

/** Собирает котика из слоёв. Возвращает Container; глаза помечены label='eyes'. */
export function buildCat(p: Phenotype): Container {
  const c = resolveColors(p);
  const root = new Container();

  // тень под котиком
  const shadow = new Graphics();
  shadow.ellipse(0, 132, 70, 16).fill({ color: 0x000000, alpha: 0.12 });
  root.addChild(shadow);

  // хвост
  const tail = new Graphics();
  tail.moveTo(46, 96);
  tail.quadraticCurveTo(120, 70, 104, 8);
  tail.stroke({ width: p.coatLength === 'long' ? 34 : 24, color: c.point, cap: 'round' });
  root.addChild(tail);

  // пушистый «воротник» для длинношёрстных
  if (p.coatLength === 'long') {
    const ruff = new Graphics();
    const pts: number[] = [];
    const N = 22;
    for (let i = 0; i < N; i++) {
      const a = (i / N) * Math.PI * 2;
      const r = 78 + (i % 2 === 0 ? 10 : -2);
      pts.push(Math.cos(a) * r, -30 + Math.sin(a) * r);
    }
    ruff.poly(pts).fill(lighten(c.body, 0.12));
    root.addChild(ruff);
  }

  // тело
  const body = new Graphics();
  body.ellipse(0, 70, 58, 64).fill(c.body);
  root.addChild(body);

  // лапки
  const paws = new Graphics();
  paws.ellipse(-26, 118, 18, 14).fill(c.body);
  paws.ellipse(26, 118, 18, 14).fill(c.body);
  root.addChild(paws);

  // голова
  const head = new Graphics();
  head.circle(0, -32, 60).fill(c.body);
  root.addChild(head);

  // колор-пойнт: затемнённая «маска» на морде
  if (p.pointed) {
    const mask = new Graphics();
    mask.ellipse(0, -18, 40, 34).fill({ color: c.point, alpha: 0.55 });
    root.addChild(mask);
  }

  // уши
  root.addChild(drawEar(-1, p.earShape, c.point));
  root.addChild(drawEar(1, p.earShape, c.point));

  // рисунок
  if (!p.white && p.pattern) root.addChild(drawPattern(p, c));

  // белые пятна
  if (!p.white) root.addChild(drawWhiteSpotting(p.whiteAmount));

  // глаза (отдельный слой для моргания)
  const eyes = new Container();
  eyes.label = 'eyes';
  const iris = eyeColor(p.eyeColor);
  eyes.addChild(drawEye(-26, -34, iris));
  if (p.oddEyed) {
    eyes.addChild(drawEye(26, -34, eyeColor('copper'))); // второй глаз другого цвета
  } else {
    eyes.addChild(drawEye(26, -34, iris));
  }
  root.addChild(eyes);

  // нос, рот, румянец, усы
  const face = new Graphics();
  face.poly([-7, -8, 7, -8, 0, 0]).fill(SKIN_PINK);            // нос
  face.moveTo(0, 0); face.lineTo(0, 6);
  face.moveTo(0, 6); face.quadraticCurveTo(-8, 12, -14, 6);
  face.moveTo(0, 6); face.quadraticCurveTo(8, 12, 14, 6);
  face.stroke({ width: 2.5, color: 0x4a3f3a, alpha: 0.7 });
  face.circle(-40, -6, 11).fill({ color: 0xff9bb0, alpha: 0.35 });  // щёчки
  face.circle(40, -6, 11).fill({ color: 0xff9bb0, alpha: 0.35 });
  // усы
  for (const dy of [-2, 6]) {
    face.moveTo(-12, dy); face.lineTo(-54, dy - 6);
    face.moveTo(12, dy); face.lineTo(54, dy - 6);
  }
  face.stroke({ width: 1.5, color: 0x000000, alpha: 0.25 });
  root.addChild(face);

  return root;
}
