/**
 * [ТЕСТ] Чистая логика поиска глаз по пикселям (без Pixi и без данных разметки).
 * Общая для рантайма моргания (`eyeBlink.ts`) и дев-тэггера (`tools/eyeTagger.ts`),
 * чтобы автодетект в тэггере совпадал с тем, что видит игра. Часть фичи моргания —
 * удаляется вместе с ней.
 */

export interface Eye { x: number; y: number; rx: number; ry: number; color: number; }

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

/** Средний цвет непрозрачных пикселей в маленьком патче (цвет века = шерсть). */
export function sampleFur(d: Uint8ClampedArray, W: number, H: number, x: number, y: number): number {
  let r = 0, g = 0, b = 0, n = 0;
  for (let dy = -2; dy <= 2; dy++) {
    for (let dx = -2; dx <= 2; dx++) {
      const px = Math.round(x + dx), py = Math.round(y + dy);
      if (px < 0 || py < 0 || px >= W || py >= H) continue;
      const i = (py * W + px) * 4;
      if (d[i + 3]! < 128) continue;
      r += d[i]!; g += d[i + 1]!; b += d[i + 2]!; n++;
    }
  }
  if (!n) return -1;
  return (Math.round(r / n) << 16) | (Math.round(g / n) << 8) | Math.round(b / n);
}

/** Собрать глаз с центром (x,y) и радиусами (rx,ry), взяв цвет века из шерсти над ним. */
export function makeEye(d: Uint8ClampedArray, W: number, H: number,
                        x: number, y: number, rx: number, ry: number): Eye {
  let color = sampleFur(d, W, H, x, y - ry * 2); // шерсть чуть выше глаза (лоб)
  if (color < 0) color = sampleFur(d, W, H, x, y);
  if (color < 0) color = 0x9a8f86; // нейтральный серо-бежевый на крайний случай
  return { x, y, rx, ry, color };
}

/**
 * Автодетект двух глаз по RGBA-пикселям. Всегда возвращает 2 глаза: если детект
 * не уверен — ставит их по пропорциям морды симметрично (либо [] если силуэта нет).
 */
export function detectEyesFromPixels(d: Uint8ClampedArray, W: number, H: number): Eye[] {
  // 1) bbox непрозрачного силуэта
  let minX = W, minY = H, maxX = 0, maxY = 0;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      if (d[(y * W + x) * 4 + 3]! > 128) {
        if (x < minX) minX = x; if (x > maxX) maxX = x;
        if (y < minY) minY = y; if (y > maxY) maxY = y;
      }
    }
  }
  if (maxX <= minX || maxY <= minY) return [];
  const bw = maxX - minX, bh = maxY - minY, cx = (minX + maxX) / 2;

  // 2) полоса глаз: верх морды без самых краёв (уши/щёки) и без средней линии (нос)
  const y0 = Math.floor(minY + bh * 0.14), y1 = Math.floor(minY + bh * 0.46);
  const x0 = Math.floor(minX + bw * 0.12), x1 = Math.floor(maxX - bw * 0.12);
  const midSkip = bw * 0.05;

  // 3) кандидаты-«радужки»: насыщенный цвет, не белый блик и не почти-чёрный зрачок
  let lx = 0, ly = 0, lx2 = 0, ly2 = 0, ln = 0;
  let rx = 0, ry = 0, rx2 = 0, ry2 = 0, rn = 0;
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      if (Math.abs(x - cx) < midSkip) continue;
      const i = (y * W + x) * 4;
      if (d[i + 3]! < 128) continue;
      const R = d[i]!, G = d[i + 1]!, B = d[i + 2]!;
      const mx = Math.max(R, G, B), mn = Math.min(R, G, B);
      const v = mx / 255, s = mx === 0 ? 0 : (mx - mn) / mx;
      if (s < 0.33 || v < 0.28 || v > 0.97) continue;
      if (x < cx) { lx += x; ly += y; lx2 += x * x; ly2 += y * y; ln++; }
      else { rx += x; ry += y; rx2 += x * x; ry2 += y * y; rn++; }
    }
  }

  const MIN = 6;
  if (ln >= MIN && rn >= MIN) {
    const lcx = lx / ln, lcy = ly / ln, rcx = rx / rn, rcy = ry / rn;
    if (Math.abs(lcy - rcy) < bh * 0.14 && lcx < cx && rcx >= cx) {
      const std = (s2: number, sum: number, n: number) => Math.sqrt(Math.max(0, s2 / n - (sum / n) ** 2));
      return [
        makeEye(d, W, H, lcx, lcy, clamp(std(lx2, lx, ln) * 2.0, bw * 0.04, bw * 0.10), clamp(std(ly2, ly, ln) * 2.2, bw * 0.03, bw * 0.08)),
        makeEye(d, W, H, rcx, rcy, clamp(std(rx2, rx, rn) * 2.0, bw * 0.04, bw * 0.10), clamp(std(ry2, ry, rn) * 2.2, bw * 0.03, bw * 0.08)),
      ];
    }
  }

  // 4) фолбэк — глаза по пропорциям морды
  const ey = minY + bh * 0.30, ex = bw * 0.15;
  return [
    makeEye(d, W, H, cx - ex, ey, bw * 0.06, bw * 0.045),
    makeEye(d, W, H, cx + ex, ey, bw * 0.06, bw * 0.045),
  ];
}
