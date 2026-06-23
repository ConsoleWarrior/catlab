/** Палитра: имена окрасов/глаз из фенотипа → hex-цвета для рендера. */

/** Цвета шерсти по названию из Phenotype.baseColor / tortieColors. */
const COAT: Record<string, number> = {
  black: 0x33312f,
  blue: 0x8b94a3,      // голубой (серый)
  chocolate: 0x6b4632,
  lilac: 0xb3a6a6,
  cinnamon: 0xa56a45,
  fawn: 0xd8c3ad,
  red: 0xe8884a,       // рыжий
  cream: 0xf2d9b0,
  white: 0xfafafa,
  'albino-white': 0xfff6f1,
  tortoiseshell: 0x33312f,
  'blue-cream': 0x8b94a3,
};

/** Цвета глаз. */
const EYES: Record<string, number> = {
  copper: 0xc97b30,
  yellow: 0xe6c34d,
  green: 0x84b06a,
  blue: 0x57a8e0,
  aqua: 0x6fd0c8,
  'pale-blue': 0xd2e8f6,
};

export function coatColor(name: string): number {
  return COAT[name] ?? 0xc9a07a;
}

export function eyeColor(name: string): number {
  return EYES[name] ?? 0xc97b30;
}

/** Смешать цвет с чёрным (amt 0..1) — затемнение. */
export function darken(color: number, amt: number): number {
  return mix(color, 0x000000, amt);
}

/** Смешать цвет с белым (amt 0..1) — осветление. */
export function lighten(color: number, amt: number): number {
  return mix(color, 0xffffff, amt);
}

export function mix(a: number, b: number, t: number): number {
  const ar = (a >> 16) & 0xff, ag = (a >> 8) & 0xff, ab = a & 0xff;
  const br = (b >> 16) & 0xff, bg = (b >> 8) & 0xff, bb = b & 0xff;
  const r = Math.round(ar + (br - ar) * t);
  const g = Math.round(ag + (bg - ag) * t);
  const bl = Math.round(ab + (bb - ab) * t);
  return (r << 16) | (g << 8) | bl;
}

export const SKIN_PINK = 0xe7a6a6; // нос, ушки внутри
export const WHITE = 0xfafafa;
