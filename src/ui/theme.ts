/**
 * Тема и базовые UI-виджеты для игрового слоя (Этап 4, UI).
 * Всё рисуется на Pixi (единый canvas, удобно для мобильного и скриншотов).
 */

import { Container, Graphics, Text } from 'pixi.js';
import type { RarityTier } from '../genetics/index.js';

export const FONT = 'system-ui, "Segoe UI", sans-serif';

/** Палитра «тёплая лаборатория». */
export const COLORS = {
  bg: 0xfdf3e7,
  hud: 0xffffff,
  card: 0xfffaf3,
  cardEdge: 0xe9d8c6,
  ink: 0x5a4a42,
  inkSoft: 0x8a7a70,
  primary: 0xff9eb5,
  secondary: 0x9ec5ff,
  warn: 0xffc56e,
  good: 0x8fd6a6,
  coins: 0xf5b740,
  crystals: 0x6ec6ff,
  dna: 0xb88cff,
  overlay: 0x2a2320,
} as const;

/** Акцент комнаты (фон-стена в разрезе). */
export const ROOM_ACCENT: Record<string, number> = {
  incubator: 0xffe3ec,
  nursery: 0xfff1d6,
  shelter: 0xe2f3e8,
  genolab: 0xe7e1fb,
};

export const TIERS: readonly RarityTier[] = ['common', 'uncommon', 'rare', 'epic', 'legendary'];
export const TIER_RU: Record<RarityTier, string> = {
  common: 'обычный', uncommon: 'необычный', rare: 'редкий',
  epic: 'эпический', legendary: 'легендарный',
};
export const TIER_COLOR: Record<RarityTier, number> = {
  common: 0xb9a99c, uncommon: 0x7bbf86, rare: 0x5aa9e6,
  epic: 0xb07be0, legendary: 0xf2a93b,
};

/**
 * Двусловное название — в две строки (читается лучше над котом и в карточках).
 * Однословные и через дефис («Мейн-кун») не трогаем; 3+ слов оставляем как есть.
 */
export function stackWords(s: string): string {
  const parts = s.trim().split(/\s+/);
  return parts.length === 2 ? parts.join('\n') : s;
}

/** Короткий формат больших чисел: 1234 → «1.2k». */
export function fmt(n: number): string {
  const v = Math.floor(n);
  if (v < 1000) return String(v);
  if (v < 1_000_000) return (v / 1000).toFixed(v < 10_000 ? 1 : 0).replace('.0', '') + 'k';
  return (v / 1_000_000).toFixed(1).replace('.0', '') + 'M';
}

export function label(
  text: string,
  size = 16,
  color: number = COLORS.ink,
  weight: '400' | '600' | '700' | '800' = '600',
): Text {
  const t = new Text({
    text,
    style: { fontFamily: FONT, fontSize: size, fontWeight: weight, fill: color, align: 'center' },
  });
  t.anchor.set(0.5);
  return t;
}

/** Скруглённая карточка-подложка. */
export function panel(w: number, h: number, color: number = COLORS.card, radius = 16, alpha = 1): Graphics {
  const g = new Graphics();
  g.roundRect(0, 0, w, h, radius).fill({ color, alpha });
  g.roundRect(0, 0, w, h, radius).stroke({ width: 2, color: COLORS.cardEdge, alpha: 0.8 });
  return g;
}

/** Звёзды ценности по тиру (1..5). */
export function stars(tier: RarityTier, size = 13): Container {
  const c = new Container();
  const n = TIERS.indexOf(tier) + 1;
  const t = label('★'.repeat(n) + '☆'.repeat(5 - n), size, TIER_COLOR[tier], '700');
  t.anchor.set(0.5);
  c.addChild(t);
  return c;
}

export interface ButtonOpts {
  text: string;
  w?: number;
  h?: number;
  color?: number;
  textColor?: number;
  fontSize?: number;
  onTap?: () => void;
}

/** Тач-кнопка с состоянием enabled и анимацией нажатия. */
export class Button extends Container {
  private readonly bg = new Graphics();
  private readonly txt: Text;
  private readonly w: number;
  private readonly h: number;
  private readonly color: number;
  private _enabled = true;
  onTap?: () => void;

  constructor(opts: ButtonOpts) {
    super();
    this.w = opts.w ?? 160;
    this.h = opts.h ?? 44;
    this.color = opts.color ?? COLORS.primary;
    this.onTap = opts.onTap;
    this.txt = label(opts.text, opts.fontSize ?? 16, opts.textColor ?? 0xffffff, '700');
    this.addChild(this.bg, this.txt);
    this.eventMode = 'static';
    this.cursor = 'pointer';
    this.redraw();
    this.on('pointertap', () => { if (this._enabled) this.onTap?.(); });
    this.on('pointerdown', () => { if (this._enabled) this.scale.set(0.95); });
    const up = (): void => { this.scale.set(1); };
    this.on('pointerup', up);
    this.on('pointerupoutside', up);
    this.on('pointerout', up);
  }

  private redraw(): void {
    this.bg.clear();
    this.bg.roundRect(-this.w / 2, -this.h / 2, this.w, this.h, 12)
      .fill({ color: this.color, alpha: this._enabled ? 1 : 0.35 });
    this.txt.alpha = this._enabled ? 1 : 0.55;
  }

  setText(t: string): void { this.txt.text = t; }

  get enabled(): boolean { return this._enabled; }
  set enabled(v: boolean) {
    if (this._enabled === v) return;
    this._enabled = v;
    this.cursor = v ? 'pointer' : 'default';
    this.redraw();
  }
}

/**
 * Горизонтальный ряд элементов (кнопок), отцентрованный по parentW.
 * Элементы позиционируются по центру (как Button), gap ужимается, чтобы влезть.
 */
export function centerRow(items: Container[], y: number, parentW: number, gap = 14): void {
  if (items.length === 0) return;
  const widths = items.map((it) => it.width);
  let total = widths.reduce((s, w) => s + w, 0) + gap * (items.length - 1);
  let g = gap;
  if (total > parentW) { // ужимаем зазор, чтобы поместиться
    g = Math.max(4, (parentW - widths.reduce((s, w) => s + w, 0)) / (items.length - 1 || 1));
    total = widths.reduce((s, w) => s + w, 0) + g * (items.length - 1);
  }
  let x = parentW / 2 - total / 2;
  items.forEach((it, i) => {
    it.position.set(x + widths[i]! / 2, y);
    x += widths[i]! + g;
  });
}

/** Значок ресурса с числом (для HUD и стоимостей). */
export function resourcePill(glyph: string, value: string, tint: number, size = 16): Container {
  const c = new Container();
  const t = label(`${glyph} ${value}`, size, tint, '800');
  t.anchor.set(0, 0.5);
  c.addChild(t);
  return c;
}
