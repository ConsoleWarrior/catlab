/**
 * [ТЕСТ] Процедурное моргание глаз на статичных спрайтах.
 *
 * Идея: спрайт остаётся статичным, а поверх области глаз рисуется маленькое
 * «веко» цвета шерсти, которое быстро съезжает сверху вниз и обратно (~0.2 с).
 *
 * Позиция глаз берётся из ДВУХ источников (в порядке приоритета):
 *   1. ручная разметка `src/assets/eyes.json` — расставляется дев-тэггером
 *      (`eyes.html` → `src/tools/eyeTagger.ts`), ключ = имя файла спрайта
 *      (`<breed>__<sex>` или базовый `<sex>__<n>`);
 *   2. если для спрайта разметки нет — АВТОДЕТЕКТ по пикселям (`eyeDetect.ts`).
 * Пустой список глаз в разметке (`"eyes": []`) = «этот спрайт не моргает».
 *
 * Убрать фичу: удалить `eyeBlink.ts`, `eyeDetect.ts`, `src/tools/eyeTagger.ts`,
 * `eyes.html`, `src/assets/eyes.json`, dev-эндпоинт `/__eyes` в `vite.config.ts`
 * и строки, помеченные `[BLINK-TEST]` в `livingFloor.ts`/`catTextures.ts`/`game.ts`.
 *
 * Веко — Container-дети самого спрайта кота, поэтому оно наследует масштаб/
 * разворот/сквош из анимации «живого пола» и остаётся на месте.
 */

import { Container, Graphics } from 'pixi.js';
import type { Application, Sprite, Texture } from 'pixi.js';
import { textureKeyOf } from './catTextures.js';
import { makeEye, detectEyesFromPixels, type Eye } from './eyeDetect.js';
import eyesJson from '../assets/eyes.json';

/** Точка глаза: [x, y, r] — все нормированы (x,r к ширине текстуры, y к высоте). */
type EyeMark = [number, number, number];
const EYES = eyesJson as unknown as Record<string, { eyes: EyeMark[] } | undefined>;

/** true → глаза не моргают, но найденные позиции обводятся рамкой (отладка детекта). */
const DEBUG = false;

// фазы одного моргания, секунды: закрылось → подержали → открылось
const CLOSE = 0.07, HOLD = 0.05, OPEN = 0.09;
const DUR = CLOSE + HOLD + OPEN;

function darken(c: number, f: number): number {
  const r = Math.round(((c >> 16) & 0xff) * f);
  const g = Math.round(((c >> 8) & 0xff) * f);
  const b = Math.round((c & 0xff) * f);
  return (r << 16) | (g << 8) | b;
}

// пиксели текстуры кэшируем по uid (у дворовых ~17 текстур на всех котов)
const pixelCache = new Map<number, { d: Uint8ClampedArray; W: number; H: number } | null>();
function extractPixels(app: Application, tex: Texture): { d: Uint8ClampedArray; W: number; H: number } | null {
  let got = pixelCache.get(tex.uid);
  if (got !== undefined) return got;
  try {
    const out = app.renderer.extract.pixels(tex) as unknown as
      { pixels: Uint8ClampedArray; width: number; height: number };
    got = out.pixels && out.width ? { d: out.pixels, W: out.width, H: out.height } : null;
  } catch { got = null; }
  pixelCache.set(tex.uid, got);
  return got;
}

// финальные глаза (ручные или автодетект) кэшируем по текстуре
const eyeCache = new Map<number, Eye[]>();
function resolveEyes(app: Application, tex: Texture): Eye[] {
  const cached = eyeCache.get(tex.uid);
  if (cached) return cached;
  const px = extractPixels(app, tex);
  if (!px) { eyeCache.set(tex.uid, []); return []; }
  const { d, W, H } = px;

  const key = textureKeyOf(tex);
  const entry = key ? EYES[key] : undefined;
  // ручная разметка (пустой список = «спрайт не моргает»), иначе автодетект
  const eyes: Eye[] = entry
    ? entry.eyes.map(([nx, ny, nr]) => makeEye(d, W, H, nx * W, ny * H, nr * W, nr * W * 0.8))
    : detectEyesFromPixels(d, W, H);
  eyeCache.set(tex.uid, eyes);
  return eyes;
}

export interface Blinker { update(dt: number): void; destroy(): void; }

/**
 * Навесить моргание на спрайт кота. Возвращает Blinker (двигать в tick через
 * `update(dt)`), либо null, если глаз нет (не нашлись или помечено «без моргания»).
 * Веки — дети спрайта, так что при `sprite.destroy({children:true})` чистятся сами.
 */
export function attachBlink(app: Application, sprite: Sprite): Blinker | null {
  const eyes = resolveEyes(app, sprite.texture);
  if (eyes.length === 0) return null;

  const tex = sprite.texture;
  const W = Math.round(tex.width), H = Math.round(tex.height);
  const ax = sprite.anchor.x, ay = sprite.anchor.y;
  const toLX = (px: number) => px - ax * W; // текстурный px → локаль спрайта (учёт якоря)
  const toLY = (py: number) => py - ay * H;

  const layer = new Container();
  layer.eventMode = 'none';
  sprite.addChild(layer);

  const lids: Container[] = [];
  for (const e of eyes) {
    if (DEBUG) {
      const dbg = new Graphics();
      dbg.ellipse(toLX(e.x), toLY(e.y), e.rx, e.ry).stroke({ width: 1, color: 0xff00ff });
      layer.addChild(dbg);
      continue;
    }
    // веко: контейнер с осью у ВЕРХНЕГО края глаза → scale.y 0..1 «опускает» веко
    const lid = new Container();
    lid.position.set(toLX(e.x), toLY(e.y - e.ry));
    const g = new Graphics();
    g.ellipse(0, e.ry, e.rx, e.ry).fill({ color: e.color });               // само веко цвета шерсти
    g.ellipse(0, e.ry * 1.15, e.rx * 0.92, e.ry * 0.34)                    // тёмная кромка = линия закрытого глаза
      .fill({ color: darken(e.color, 0.55), alpha: 0.9 });
    lid.addChild(g);
    lid.scale.y = 0; // старт: глаз открыт (веко свёрнуто)
    layer.addChild(lid);
    lids.push(lid);
  }

  // расписание: рассинхрон между котами + изредка двойное моргание
  let wait = 1 + Math.random() * 3; // пауза до следующего моргания
  let t = -1;                       // <0 — пауза; >=0 — идёт моргание
  let doublePending = false;

  const setLids = (v: number) => { for (const l of lids) l.scale.y = v; };

  return {
    update(dt: number) {
      if (DEBUG) return;
      if (t < 0) { if ((wait -= dt) <= 0) t = 0; return; }
      t += dt;
      let close: number;
      if (t < CLOSE) close = t / CLOSE;
      else if (t < CLOSE + HOLD) close = 1;
      else if (t < DUR) close = 1 - (t - CLOSE - HOLD) / OPEN;
      else close = 0;
      setLids(close < 0 ? 0 : close > 1 ? 1 : close);
      if (t >= DUR) {
        setLids(0);
        t = -1;
        if (doublePending) { doublePending = false; wait = 0.13; }      // быстрый второй «хлоп»
        else { wait = 2.5 + Math.random() * 4; doublePending = Math.random() < 0.18; }
      }
    },
    destroy() { layer.destroy({ children: true }); },
  };
}
