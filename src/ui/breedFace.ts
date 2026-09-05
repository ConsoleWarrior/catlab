/**
 * Круглые миниатюры-мордочки пород («медальоны») — для дерева родословной.
 *
 * Отдельного арта под них НЕ рисуем: морда вырезается из уже готового спрайта
 * породы (первый вариант, `breedThumbTexture`) по ручной разметке глаз
 * `src/assets/eyes.json` — той же, что двигает веки при моргании. Два глаза
 * дают и центр морды, и её масштаб (межглазное расстояние ≈ треть ширины
 * головы), поэтому кадр садится одинаково на всех 67 породах, а не «на глаз».
 * Спрайта без разметки хватает и на запасной кроп по пропорциям сидящего кота.
 *
 * Результат запекается в текстуру (кэш по породе): в дереве до 15 медальонов,
 * и живые маски-круги на каждом стоили бы отдельного прохода рендера.
 */

import { Container, Graphics, Rectangle, Sprite } from 'pixi.js';
import type { Application, Texture } from 'pixi.js';
import { breedThumbTexture, textureKeyOf } from './catTextures.js';
import { eyeMarksFor } from './eyeBlink.js';

/** Сторона запечённой текстуры-мордочки, px. Медальоны в дереве мельче (≤ 68). */
const FACE_PX = 176;

/** Ширина кадра морды в межглазных расстояниях (подобрано по спрайтам: влезают уши и щёки). */
const FACE_SPAN = 3.3;

/** Насколько ниже линии глаз стоит центр кадра (в межглазных расстояниях). */
const FACE_DROP = 0.3;

const faceCache = new Map<string, Texture | null>();

/** Прямоугольник морды в пикселях текстуры: центр + сторона квадрата. */
function faceFrame(tex: Texture): { cx: number; cy: number; side: number } {
  const W = tex.width, H = tex.height;
  const key = textureKeyOf(tex);
  const marks = key ? eyeMarksFor(key) : null;
  if (marks && marks.length >= 2) {
    const [ax, ay] = marks[0]!, [bx, by] = marks[1]!;
    const x1 = ax * W, y1 = ay * H, x2 = bx * W, y2 = by * H;
    const d = Math.hypot(x2 - x1, y2 - y1);
    if (d > 4) {
      return {
        cx: (x1 + x2) / 2,
        cy: (y1 + y2) / 2 + d * FACE_DROP,
        side: Math.min(Math.min(W, H), d * FACE_SPAN),
      };
    }
  }
  // запасной кадр: у сидящего кота голова стоит в верхней трети спрайта
  return { cx: W * 0.5, cy: H * 0.24, side: H * 0.42 };
}

/**
 * Текстура круглой мордочки породы, либо null — если арта породы нет
 * (тогда зовущий рисует запасной значок). Кэшируется на всё время игры.
 */
export function breedFaceTexture(app: Application, breedKey: string): Texture | null {
  const hit = faceCache.get(breedKey);
  if (hit !== undefined) return hit;

  const tex = breedThumbTexture(breedKey);
  if (!tex) { faceCache.set(breedKey, null); return null; }

  const { cx, cy, side } = faceFrame(tex);
  const s = FACE_PX / side;

  const holder = new Container();
  const sp = new Sprite(tex);
  sp.anchor.set(0.5);
  sp.scale.set(s);
  sp.position.set(FACE_PX / 2 - (cx - tex.width / 2) * s, FACE_PX / 2 - (cy - tex.height / 2) * s);

  // круглая маска: медальон обрезается ровно по кругу, включая фон-подложку
  const mask = new Graphics().circle(FACE_PX / 2, FACE_PX / 2, FACE_PX / 2).fill(0xffffff);
  sp.mask = mask;
  holder.addChild(mask, sp);

  const out = app.renderer.generateTexture({
    target: holder,
    frame: new Rectangle(0, 0, FACE_PX, FACE_PX),
    resolution: 1,
    antialias: true,
  });
  holder.destroy({ children: true });
  faceCache.set(breedKey, out);
  return out;
}
