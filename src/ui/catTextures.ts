/**
 * Кэш текстур котиков. buildCat (Pixi Graphics) → RenderTexture один раз
 * на уникальный фенотип; в сценах используем лёгкие Sprite. Держит ≥60 fps.
 */

import { Sprite } from 'pixi.js';
import type { Application, Texture } from 'pixi.js';
import { expressPhenotype } from '../genetics/index.js';
import type { Cat } from '../game/index.js';
import { buildCat } from '../render/catSprite.js';

const cache = new Map<string, Texture>();

/** Текстура кота (кэшируется по фенотипу + полу). */
export function catTexture(app: Application, cat: Cat): Texture {
  const p = expressPhenotype(cat.genotype);
  const key = cat.genotype.sex + '|' + JSON.stringify(p);
  let tex = cache.get(key);
  if (!tex) {
    const c = buildCat(p, 'sit', cat.genotype.sex);
    tex = app.renderer.generateTexture(c);
    c.destroy({ children: true });
    cache.set(key, tex);
  }
  return tex;
}

/** Готовый Sprite кота, вписанный по высоте в targetH (anchor центр-низ). */
export function catSprite(app: Application, cat: Cat, targetH: number): Sprite {
  const tex = catTexture(app, cat);
  const sp = new Sprite(tex);
  sp.anchor.set(0.5, 1);
  const s = targetH / tex.height;
  sp.scale.set(s);
  return sp;
}
