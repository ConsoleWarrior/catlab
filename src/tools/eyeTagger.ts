/**
 * Дев-тэггер точек глаз для процедурного моргания (`eyeBlink.ts`).
 *
 * Открывается на /eyes.html (только dev). Показывает все спрайты котов, даёт
 * кликом расставить 2 точки глаз (или пометить «без моргания»), сразу сохраняет
 * в `src/assets/eyes.json` через dev-эндпоинт `/__eyes` (см. vite.config.ts).
 * Игра перечитывает разметку при перезагрузке вкладки. Держим для разметки новых пород.
 *
 * Координаты хранятся нормированными: [nx, ny, nr] (x,r к ширине, y к высоте
 * текстуры) — не зависят от разрешения, переживают перегенерацию спрайта.
 */

import { detectEyesFromPixels, sampleFur } from '../ui/eyeDetect.js';

type EyeMark = [number, number, number];
type Entry = { eyes: EyeMark[] };

// --- список спрайтов (базовые дворовые + породы) ---
const glob = import.meta.glob('../assets/{base,breeds}/*.webp', {
  eager: true, query: '?url', import: 'default',
}) as Record<string, string>;
const sprites = Object.entries(glob)
  .map(([path, url]) => ({ key: path.split('/').pop()!.replace('.webp', ''), url }))
  .sort((a, b) => a.key.localeCompare(b.key));

// --- данные разметки (зеркало eyes.json) ---
let data: Record<string, Entry> = {};

// --- DOM ---
const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const listEl = $('list');
const cv = $<HTMLCanvasElement>('cv');
const ctx = cv.getContext('2d')!;
const titleEl = $('title'), progEl = $('prog');
const radEl = $<HTMLInputElement>('rad');

// --- состояние редактирования ---
let idx = 0;
let pts: { x: number; y: number }[] = []; // нормированные центры глаз текущего спрайта
let rad = 0.06;                            // нормированный радиус (общий на оба глаза)
let previewOn = false;
let drag = -1;                             // индекс перетаскиваемой точки, -1 — нет

// кэш картинок и их пикселей (для автодетекта/цвета века)
const imgCache = new Map<string, HTMLImageElement>();
const pxCache = new Map<string, { d: Uint8ClampedArray; W: number; H: number }>();
let scale = 1, natW = 1, natH = 1; // текущий масштаб canvas и натуральные размеры

function curKey(): string { return sprites[idx]!.key; }

function statusGlyph(key: string): { g: string; c: string } {
  const e = data[key];
  if (!e) return { g: '○', c: '#888' };            // не размечен
  if (e.eyes.length === 0) return { g: '⊘', c: '#c77' }; // без моргания
  if (e.eyes.length < 2) return { g: '◐', c: '#cc8' };   // частично
  return { g: '●', c: '#7c7' };                    // готово
}

// --- рендер списка ---
const rows: HTMLElement[] = [];
function buildList(): void {
  listEl.innerHTML = '';
  rows.length = 0;
  sprites.forEach((s, i) => {
    const row = document.createElement('div');
    row.className = 'row' + (i === idx ? ' active' : '');
    const st = statusGlyph(s.key);
    row.innerHTML = `<span class="st" style="color:${st.c}">${st.g}</span><span>${s.key}</span>`;
    row.onclick = () => select(i);
    listEl.appendChild(row);
    rows[i] = row;
  });
}
function refreshRow(i: number): void {
  const s = sprites[i]!; const st = statusGlyph(s.key);
  rows[i]!.innerHTML = `<span class="st" style="color:${st.c}">${st.g}</span><span>${s.key}</span>`;
  rows[i]!.className = 'row' + (i === idx ? ' active' : '');
}

// --- загрузка картинки + пикселей ---
function loadImage(key: string, url: string): Promise<HTMLImageElement> {
  const cached = imgCache.get(key);
  if (cached) return Promise.resolve(cached);
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      imgCache.set(key, img);
      const oc = document.createElement('canvas');
      oc.width = img.naturalWidth; oc.height = img.naturalHeight;
      const octx = oc.getContext('2d')!;
      octx.drawImage(img, 0, 0);
      const id = octx.getImageData(0, 0, oc.width, oc.height);
      pxCache.set(key, { d: id.data, W: oc.width, H: oc.height });
      resolve(img);
    };
    img.src = url;
  });
}

// --- выбор спрайта ---
async function select(i: number): Promise<void> {
  const prev = idx; idx = i;
  localStorage.setItem('eyeTaggerIdx', String(idx)); // резюме на том же спрайте
  refreshRow(prev); refreshRow(idx);
  rows[idx]!.scrollIntoView({ block: 'nearest' });
  const s = sprites[idx]!;
  const e = data[s.key];
  if (e && e.eyes.length > 0) { pts = e.eyes.map((m) => ({ x: m[0], y: m[1] })); rad = e.eyes[0]![2]; }
  else { pts = []; } // «без моргания» и «не размечен» — оба без точек
  radEl.value = String(Math.round(rad * 1000) / 10);
  titleEl.textContent = s.key;
  progEl.textContent = `(${idx + 1}/${sprites.length})  ●${count(2)} ◐${count(1)} ⊘${count(0)} ○${sprites.length - Object.keys(data).length}`;
  await loadImage(s.key, s.url);
  layout(); render();
}
function count(nEyes: number): number {
  return Object.values(data).filter((e) => e.eyes.length === nEyes).length;
}

// --- геометрия canvas ---
function layout(): void {
  const img = imgCache.get(curKey())!;
  natW = img.naturalWidth; natH = img.naturalHeight;
  const stage = cv.parentElement!;
  const maxW = stage.clientWidth - 40, maxH = stage.clientHeight - 40;
  scale = Math.min(maxW / natW, maxH / natH);
  cv.width = Math.round(natW * scale);
  cv.height = Math.round(natH * scale);
}
const toCanvas = (n: { x: number; y: number }) => ({ x: n.x * cv.width, y: n.y * cv.height });

// --- отрисовка ---
function drawBase(): void {
  const T = 12;
  for (let y = 0; y < cv.height; y += T) for (let x = 0; x < cv.width; x += T) {
    ctx.fillStyle = ((x / T + y / T) & 1) ? '#3a3a40' : '#45454c';
    ctx.fillRect(x, y, T, T);
  }
  ctx.drawImage(imgCache.get(curKey())!, 0, 0, cv.width, cv.height);
}
function drawMarkers(): void {
  const rxC = rad * cv.width, ryC = rad * 0.8 * cv.width;
  ctx.lineWidth = 1.5;
  pts.forEach((p) => {
    const c = toCanvas(p);
    ctx.strokeStyle = 'rgba(255,220,60,.95)';
    ctx.beginPath(); ctx.ellipse(c.x, c.y, rxC, ryC, 0, 0, Math.PI * 2); ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(c.x - 6, c.y); ctx.lineTo(c.x + 6, c.y);
    ctx.moveTo(c.x, c.y - 6); ctx.lineTo(c.x, c.y + 6); ctx.stroke();
  });
}
function drawPreview(): void {
  const px = pxCache.get(curKey()); if (!px) return;
  const phase = (performance.now() / 1000) % 1.8;
  const DUR = 0.21;
  let close = 0;
  if (phase < 0.07) close = phase / 0.07;
  else if (phase < 0.12) close = 1;
  else if (phase < DUR) close = 1 - (phase - 0.12) / 0.09;
  const rxC = rad * cv.width, ryC = rad * 0.8 * cv.width;
  pts.forEach((p) => {
    const c = toCanvas(p);
    const colInt = sampleFur(px.d, px.W, px.H, p.x * px.W, p.y * px.H - rad * px.W * 0.8 * 2);
    const col = colInt < 0 ? 0x9a8f86 : colInt;
    const css = '#' + col.toString(16).padStart(6, '0');
    ctx.save();
    ctx.translate(c.x, c.y - ryC);
    ctx.scale(1, close);
    ctx.fillStyle = css;
    ctx.beginPath(); ctx.ellipse(0, ryC, rxC, ryC, 0, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
  });
}
function render(): void {
  drawBase();
  if (previewOn) drawPreview(); else drawMarkers();
}
function loop(): void { if (previewOn) { render(); requestAnimationFrame(loop); } }

// --- сохранение (дебаунс) ---
let saveT = 0;
function save(): void {
  clearTimeout(saveT);
  saveT = window.setTimeout(() => {
    fetch('/__eyes', { method: 'POST', body: JSON.stringify(data) }).catch(() => {});
  }, 150);
}
function commitPoints(): void {
  data[curKey()] = { eyes: pts.map((p) => [p.x, p.y, rad] as EyeMark) };
  refreshRow(idx); save();
}

// --- действия ---
function autodetect(): void {
  const px = pxCache.get(curKey()); if (!px) return;
  const eyes = detectEyesFromPixels(px.d, px.W, px.H);
  if (eyes.length < 2) return;
  pts = eyes.slice(0, 2).map((e) => ({ x: e.x / px.W, y: e.y / px.H }));
  rad = Math.max(0.02, Math.min(0.14, eyes[0]!.rx / px.W));
  radEl.value = String(Math.round(rad * 1000) / 10);
  commitPoints(); render();
}
function clearEyes(): void { pts = []; delete data[curKey()]; refreshRow(idx); save(); render(); }
function skipEyes(): void { pts = []; data[curKey()] = { eyes: [] }; refreshRow(idx); save(); render(); }
function setPreview(on: boolean): void {
  previewOn = on;
  $('preview').textContent = on ? '⏸ Превью' : '▶ Превью';
  if (on) loop(); else render();
}

// --- ввод мышью на canvas ---
function evPos(e: MouseEvent): { x: number; y: number } {
  const r = cv.getBoundingClientRect();
  return { x: (e.clientX - r.left) / cv.width, y: (e.clientY - r.top) / cv.height };
}
function hit(n: { x: number; y: number }): number {
  const rPx = Math.max(10, rad * cv.width);
  for (let i = 0; i < pts.length; i++) {
    const dx = (pts[i]!.x - n.x) * cv.width, dy = (pts[i]!.y - n.y) * cv.height;
    if (Math.hypot(dx, dy) < rPx) return i;
  }
  return -1;
}
cv.addEventListener('mousedown', (e) => {
  const n = evPos(e);
  const h = hit(n);
  if (h >= 0) { drag = h; return; }
  if (pts.length >= 2) pts = [];   // третий клик — начинаем заново
  pts.push(n);
  commitPoints(); render();
});
window.addEventListener('mousemove', (e) => {
  if (drag < 0) return;
  pts[drag] = evPos(e);
  render(); commitPoints();
});
window.addEventListener('mouseup', () => { drag = -1; });
cv.addEventListener('wheel', (e) => {
  e.preventDefault();
  rad = Math.max(0.02, Math.min(0.14, rad + (e.deltaY < 0 ? 0.004 : -0.004)));
  radEl.value = String(Math.round(rad * 1000) / 10);
  if (pts.length) commitPoints();
  render();
}, { passive: false });

// --- кнопки/слайдер/клавиши ---
radEl.oninput = () => { rad = Number(radEl.value) / 100; if (pts.length) commitPoints(); render(); };
$('auto').onclick = autodetect;
$('clear').onclick = clearEyes;
$('skip').onclick = skipEyes;
$('preview').onclick = () => setPreview(!previewOn);
$('prev').onclick = () => select((idx - 1 + sprites.length) % sprites.length);
$('next').onclick = () => select((idx + 1) % sprites.length);
window.addEventListener('keydown', (e) => {
  if (e.key === 'ArrowLeft') select((idx - 1 + sprites.length) % sprites.length);
  else if (e.key === 'ArrowRight') select((idx + 1) % sprites.length);
  else if (e.key === 'a' || e.key === 'ф') autodetect();
  else if (e.key === 'c' || e.key === 'с') clearEyes();
  else if (e.key === 's' || e.key === 'ы') skipEyes();
  else if (e.key === 'p' || e.key === 'з') setPreview(!previewOn);
});
window.addEventListener('resize', () => { if (imgCache.has(curKey())) { layout(); render(); } });

// --- старт ---
async function boot(): Promise<void> {
  try { data = await (await fetch('/__eyes')).json(); } catch { data = {}; }
  if (!sprites.length) { titleEl.textContent = 'Спрайтов не найдено в src/assets/{base,breeds}'; return; }
  buildList();
  const saved = Number(localStorage.getItem('eyeTaggerIdx')) || 0;
  await select(Math.max(0, Math.min(saved, sprites.length - 1)));
}
void boot();
