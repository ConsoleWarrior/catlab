/**
 * Спрайты котов из готовой арт-коллекции.
 *
 * Порода (cat.breed) имеет несколько вариантов-спрайтов БЕЗ привязки к полу —
 * выбираем один детерминированно по id кота (стабильно между перерисовками).
 * Текстуры — финальные PNG с прозрачным фоном, грузятся в game.start() из файлов
 * `<breed>__<n>.png`. Базовый «Дворовый» (moggie) хранит варианты отдельно, по
 * полу (папка assets/base, ключ `<sex>__<n>`) — исторический набор, оставлен как есть.
 *
 * ПЕРЕКРАСКА ОТКЛЮЧЕНА: арт показывается как есть (тинт 0xffffff). Прежний
 * gradient-map по окрасу убран — он смазывал реализм спрайтов. Если текстуры нет
 * (ассет не загрузился) — отдаём процедурного кота как запасной вариант.
 */

import { BlurFilter, ColorMatrixFilter, Sprite } from 'pixi.js';
import type { Application, Texture } from 'pixi.js';
import { expressPhenotype } from '../genetics/index.js';
import type { RarityTier } from '../genetics/index.js';
import type { Cat } from '../game/index.js';
import { buildCat } from '../render/catSprite.js';
import { TIER_COLOR } from './theme.js';

/** Насколько ореол выходит за силуэт кота (множитель масштаба). Тот же
 * коэффициент использует «живой пол» в анимации — чтобы ореол повторял позу. */
export const GLOW_OUT = 1.06;

/**
 * Заливка силуэта сплошным цветом: ColorMatrixFilter ставит RGB = `color`
 * (offset-столбец), а альфу берёт из спрайта. Так силуэт окрашивается ровно в
 * цвет редкости независимо от окраса шерсти — в отличие от tint, который
 * УМНОЖАЕТ цвет (у тёмного кота ореол выходил почти чёрным).
 */
function solidFill(color: number): ColorMatrixFilter {
  const r = ((color >> 16) & 0xff) / 255;
  const g = ((color >> 8) & 0xff) / 255;
  const b = (color & 0xff) / 255;
  const cm = new ColorMatrixFilter();
  cm.matrix = [
    0, 0, 0, 0, r,
    0, 0, 0, 0, g,
    0, 0, 0, 0, b,
    0, 0, 0, 1, 0,
  ];
  return cm;
}

/**
 * Светящийся ореол цвета редкости: чуть увеличенный и размытый дубль силуэта
 * кота, залитый сплошным цветом редкости. Кладётся ПОД основной спрайт, поэтому
 * наружу выходит лишь мягкая цветная кромка. `displayH` задаёт ширину размытия.
 * У серых (common) ореол на треть тусклее, чтобы не спорил с котом.
 */
export function rarityGlow(src: Sprite, tier: RarityTier, displayH: number): Sprite {
  const glow = new Sprite(src.texture);
  glow.eventMode = 'none'; // не перехватывает тапы/перетаскивание у кота
  glow.anchor.copyFrom(src.anchor);
  glow.alpha = tier === 'common' ? 0.95 * (2 / 3) : 0.95;
  glow.scale.set(src.scale.x * GLOW_OUT, src.scale.y * GLOW_OUT);
  glow.filters = [solidFill(TIER_COLOR[tier]), new BlurFilter({
    strength: Math.max(3, Math.min(9, displayH * 0.06)),
    quality: 3,
  })];
  return glow;
}

const cache = new Map<string, Texture>();

// Варианты-текстуры пород по ключу породы (включая базовые T1: moggie и домашних).
const breedTex = new Map<string, Texture[]>();

// текстура → имя файла спрайта `<breed>__<n>` (для разметки глаз eyes.json / моргания)
const texKey = new Map<number, string>();
/** Имя файла спрайта по его текстуре (`<breed>__<n>`), либо undefined. */
export function textureKeyOf(t: Texture): string | undefined { return texKey.get(t.uid); }

/**
 * Зарегистрировать вариант-текстуру породы. Имя файла `<breed>__<n>`: порода —
 * всё до `__`, дальше номер варианта. Пол в имени не участвует.
 */
export function setAiBreedTexture(fileKey: string, t: Texture): void {
  const breed = fileKey.split('__')[0]!;
  const list = breedTex.get(breed) ?? [];
  list.push(t);
  breedTex.set(breed, list);
  texKey.set(t.uid, fileKey);
}

/** Текстура-миниатюра породы для Котодекса (первый вариант), null → нет арта. */
export function breedThumbTexture(breedKey: string): Texture | null {
  return breedTex.get(breedKey)?.[0] ?? null;
}

/** Стабильный хеш id → неотрицательное число (для выбора варианта базы). */
function idHash(id: string): number {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) | 0;
  return Math.abs(h);
}

/** Случайный (детерминированный по id) элемент массива текстур, либо null. */
function pickVariant(list: Texture[], id: string): Texture | null {
  return list.length > 0 ? list[idHash(id) % list.length]! : null;
}

/** Текстура породы для кота (вариант по id), null → процедурный фолбэк. */
function breedTexFor(cat: Cat): Texture | null {
  const breed = cat.breed || 'moggie';
  // Сид выбора варианта — artId (клон наследует его от оригинала, чтобы облик
  // совпал), иначе собственный id. Стабилен между перерисовками.
  const seed = cat.artId ?? cat.id;
  return pickVariant(breedTex.get(breed) ?? [], seed);
}

/** Арт-текстура варианта кота из коллекции (тот же вариант, что на полу), либо null. */
export function catArtTexture(cat: Cat): Texture | null {
  return breedTexFor(cat);
}

/** Сидячий спрайт кота из коллекции (если арт загружен), иначе null → процедурный. */
export function aiSitSpriteFor(cat: Cat, targetH: number): Sprite | null {
  const tex = breedTexFor(cat);
  if (!tex) return null;
  const sp = new Sprite(tex);
  sp.anchor.set(0.5, 1);
  sp.scale.set(targetH / tex.height);
  return sp;
}

/**
 * Спрайт кота «в руках» (взяли за шкирку): та же текстура породы, держим чуть
 * выше центра (за загривок), слегка крупнее обычного.
 */
export function aiHeldSpriteFor(cat: Cat, displayH: number): Sprite | null {
  const tex = breedTexFor(cat);
  if (!tex) return null;
  const sp = new Sprite(tex);
  sp.anchor.set(0.5, 0.42);                       // палец у загривка
  sp.scale.set((displayH / tex.height) * 1.12);   // в руках — чуть крупнее
  return sp;
}

/** Процедурная текстура кота (фолбэк), кэшируется по фенотипу + полу. */
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

/**
 * Готовый Sprite кота: сначала арт-коллекция (порода+пол), иначе процедурный.
 * anchor центр-низ, вписан по высоте в targetH.
 */
export function catSprite(app: Application, cat: Cat, targetH: number): Sprite {
  const ai = aiSitSpriteFor(cat, targetH);
  if (ai) return ai;
  const tex = catTexture(app, cat);
  const sp = new Sprite(tex);
  sp.anchor.set(0.5, 1);
  sp.scale.set(targetH / tex.height);
  return sp;
}
