/**
 * Декор-лаб — отдельная dev-страница (НЕ часть игры) для подбора и расстановки
 * интерьерных спрайтов в комнате. Доступна по /decor-lab.html на dev-сервере.
 *
 * Что умеет:
 *   • палитра слева — все спрайты из `src/assets/decor/*.png`;
 *   • перетащил спрайт из палитры в комнату → он появляется в точке отпускания;
 *   • тащишь спрайт → меняешь позицию; угловой маркер / колесо мыши → масштаб;
 *   • отражение по горизонтали, порядок слоёв, удаление;
 *   • фон — реальные фоны комнат игры (тот же стрейч на весь экран), поэтому
 *     координаты переносятся в игру один в один;
 *   • автосейв расстановки в localStorage (на комнату);
 *   • «Экспорт JSON» — отдаёт нормализованные координаты для магазина декора.
 *
 * Формат экспорта (на комнату): позиция — точка КАСАНИЯ ПОЛА (низ-центр спрайта)
 * в долях ширины/высоты комнаты; scale — высота спрайта в долях высоты комнаты.
 * В игре: displayH = scale·roomH; x = xN·roomW; y = yN·roomH; anchor (0.5, 1).
 */

import { Application, Assets, Container, Graphics, Sprite } from 'pixi.js';
import type { Texture } from 'pixi.js';

// ------------------------------------------------------------------ данные

interface DecorDef {
  name: string; // ключ спрайта (имя файла без .png)
  url: string;  // url для DOM-миниатюры
  tex: Texture;
}

/** Экземпляр декора в сцене. Источник правды — НОРМАЛИЗОВАННЫЕ координаты. */
interface Item {
  def: DecorDef;
  sprite: Sprite;
  xN: number; // центр по X в долях ширины комнаты (0..1)
  yN: number; // линия касания пола (низ спрайта) в долях высоты (0..1)
  sN: number; // высота спрайта в долях высоты комнаты
  flip: boolean;
}

interface Saved { sprite: string; xN: number; yN: number; sN: number; flip: boolean }

const LS_KEY = 'catlab:decorlab:v1';
const MIN_SN = 0.03;
const MAX_SN = 1.5;
const HANDLE = 11; // радиус хит-зоны углового маркера, px

// доступные фоны: id комнаты → подпись. 'blank' — без фона (тёплый цвет).
const ROOMS: Array<{ id: string; label: string }> = [
  { id: 'shelter', label: '🏠 Приют' },
  { id: 'nursery', label: '🐱 Питомник' },
  { id: 'blank', label: '▢ Пусто' },
];

// ------------------------------------------------------------------ загрузка ассетов

const decorUrls = import.meta.glob('../assets/decor/*.png', {
  eager: true, query: '?url', import: 'default',
}) as Record<string, string>;
const roomUrls = import.meta.glob('../assets/rooms/*.png', {
  eager: true, query: '?url', import: 'default',
}) as Record<string, string>;

function fileKey(path: string): string {
  return path.split('/').pop()!.replace('.png', '');
}

// ------------------------------------------------------------------ состояние редактора

const app = new Application();
const world = new Container();   // фон + спрайты
const overlay = new Graphics();  // рамка выделения и маркеры (поверх всего)
const bg = new Sprite();

let defs: DecorDef[] = [];
const roomTex = new Map<string, Texture>();
let room = ROOMS[0]!.id;
let items: Item[] = [];
let selected: Item | null = null;

type Mode = 'idle' | 'place' | 'move' | 'resize';
let mode: Mode = 'idle';
let dragDX = 0; // смещение точки касания относительно курсора при перетаскивании
let dragDY = 0;

const roomW = (): number => app.screen.width;
const roomH = (): number => app.screen.height;

// ------------------------------------------------------------------ геометрия спрайта

interface Box { cx: number; cy: number; w: number; h: number; left: number; right: number; top: number }

function box(it: Item): Box {
  const h = it.sN * roomH();
  const w = h * (it.def.tex.width / it.def.tex.height);
  const cx = it.xN * roomW();
  const cy = it.yN * roomH(); // низ (касание пола)
  return { cx, cy, w, h, left: cx - w / 2, right: cx + w / 2, top: cy - h };
}

/** Применить нормализованные координаты к спрайту (px под текущий размер окна). */
function apply(it: Item): void {
  const b = box(it);
  const s = b.h / it.def.tex.height;
  it.sprite.anchor.set(0.5, 1);
  it.sprite.scale.set(it.flip ? -s : s, s);
  it.sprite.position.set(b.cx, b.cy);
}

function relayout(): void {
  bg.position.set(0, 0);
  bg.width = roomW();
  bg.height = roomH();
  for (const it of items) apply(it);
}

// ------------------------------------------------------------------ создание / выбор

function makeItem(def: DecorDef, xN: number, yN: number, sN: number, flip = false): Item {
  const sprite = new Sprite(def.tex);
  world.addChild(sprite);
  const it: Item = { def, sprite, xN, yN, sN, flip };
  apply(it);
  return it;
}

function select(it: Item | null): void {
  selected = it;
  updateInfo();
}

function topItemAt(px: number, py: number): Item | null {
  // сверху вниз по порядку отрисовки (последние — выше)
  for (let i = items.length - 1; i >= 0; i--) {
    const it = items[i]!;
    const b = box(it);
    if (px >= b.left && px <= b.right && py >= b.top && py <= b.cy) return it;
  }
  return null;
}

function removeItem(it: Item): void {
  it.sprite.destroy();
  items = items.filter((x) => x !== it);
  if (selected === it) select(null);
  save();
}

function reorder(it: Item, toFront: boolean): void {
  items = items.filter((x) => x !== it);
  if (toFront) items.push(it); else items.unshift(it);
  // перерисовать порядок детей
  for (const x of items) world.addChild(x.sprite); // addChild перемещает в конец
  save();
}

// ------------------------------------------------------------------ ввод (drag/resize)

function canvasXY(e: PointerEvent): { x: number; y: number } {
  const r = app.canvas.getBoundingClientRect();
  return { x: e.clientX - r.left, y: e.clientY - r.top };
}

function clamp01(v: number): number { return Math.max(0, Math.min(1, v)); }

function onCanvasDown(e: PointerEvent): void {
  const { x, y } = canvasXY(e);
  // 1) угловой маркер выделенного → ресайз
  if (selected) {
    const b = box(selected);
    if (Math.hypot(x - b.right, y - b.top) <= HANDLE * 1.6) {
      mode = 'resize';
      return;
    }
  }
  // 2) спрайт под курсором → выбрать и тащить
  const hit = topItemAt(x, y);
  if (hit) {
    select(hit);
    const b = box(hit);
    dragDX = x - b.cx;
    dragDY = y - b.cy;
    mode = 'move';
    return;
  }
  // 3) пусто → снять выделение
  select(null);
  mode = 'idle';
}

function onMove(e: PointerEvent): void {
  if (mode === 'idle' || !selected) return;
  const { x, y } = canvasXY(e);
  const it = selected;
  if (mode === 'resize') {
    const b = box(it);
    const hY = b.cy - y;                                   // тянем вверх от пола
    const hX = Math.abs(x - b.cx) * 2 * (it.def.tex.height / it.def.tex.width);
    const h = Math.max(20, Math.max(hY, hX));
    it.sN = Math.max(MIN_SN, Math.min(MAX_SN, h / roomH()));
    apply(it);
    updateInfo();
  } else {
    // place / move
    const cx = x - dragDX;
    const cy = y - dragDY;
    it.xN = clamp01(cx / roomW());
    it.yN = clamp01(cy / roomH());
    apply(it);
    updateInfo();
  }
}

function onUp(): void {
  if (mode !== 'idle') save();
  mode = 'idle';
}

function onWheel(e: WheelEvent): void {
  if (!selected) return;
  e.preventDefault();
  const k = Math.exp(-e.deltaY * 0.0015);
  selected.sN = Math.max(MIN_SN, Math.min(MAX_SN, selected.sN * k));
  apply(selected);
  updateInfo();
  save();
}

function onKey(e: KeyboardEvent): void {
  if (!selected) return;
  const it = selected;
  if (e.key === 'Delete' || e.key === 'Backspace') { removeItem(it); return; }
  if (e.key === 'f' || e.key === 'F' || e.key === 'а' || e.key === 'А') { it.flip = !it.flip; apply(it); save(); return; }
  if (e.key === ']') { reorder(it, true); return; }
  if (e.key === '[') { reorder(it, false); return; }
  const step = (e.shiftKey ? 10 : 1);
  if (e.key === 'ArrowLeft') it.xN = clamp01(it.xN - step / roomW());
  else if (e.key === 'ArrowRight') it.xN = clamp01(it.xN + step / roomW());
  else if (e.key === 'ArrowUp') it.yN = clamp01(it.yN - step / roomH());
  else if (e.key === 'ArrowDown') it.yN = clamp01(it.yN + step / roomH());
  else return;
  e.preventDefault();
  apply(it); updateInfo(); save();
}

// перетаскивание из палитры: создаём спрайт под курсором и сразу берём в move
function onPaletteDown(def: DecorDef, e: PointerEvent): void {
  e.preventDefault();
  const { x, y } = canvasXY(e);
  const it = makeItem(def, clamp01(x / roomW()), clamp01(y / roomH()), 0.22);
  items.push(it);
  select(it);
  dragDX = 0; dragDY = 0; // точка касания — под курсором
  mode = 'place';
}

// ------------------------------------------------------------------ оверлей выделения

function drawOverlay(): void {
  overlay.clear();
  if (!selected) return;
  const b = box(selected);
  // рамка
  overlay.rect(b.left, b.top, b.w, b.h).stroke({ width: 2, color: 0xff9eb5, alpha: 0.95 });
  // точка касания пола (низ-центр)
  overlay.circle(b.cx, b.cy, 4).fill({ color: 0xff9eb5 });
  // угловой маркер масштаба (верх-право)
  overlay.roundRect(b.right - HANDLE, b.top - HANDLE, HANDLE * 2, HANDLE * 2, 4)
    .fill({ color: 0xffffff }).stroke({ width: 2, color: 0xff9eb5 });
  overlay.moveTo(b.right - 5, b.top - 5).lineTo(b.right + 5, b.top + 5).stroke({ width: 2, color: 0xff9eb5 });
}

// ------------------------------------------------------------------ persistence

function loadStore(): Record<string, Saved[]> {
  try { return JSON.parse(localStorage.getItem(LS_KEY) || '{}'); } catch { return {}; }
}

function save(): void {
  const store = loadStore();
  store[room] = items.map((it) => ({
    sprite: it.def.name, xN: it.xN, yN: it.yN, sN: it.sN, flip: it.flip,
  }));
  try { localStorage.setItem(LS_KEY, JSON.stringify(store)); } catch { /* квота */ }
}

function loadRoomItems(): void {
  for (const it of items) it.sprite.destroy();
  items = [];
  select(null);
  const saved = loadStore()[room] ?? [];
  for (const s of saved) {
    const def = defs.find((d) => d.name === s.sprite);
    if (!def) continue; // спрайт удалён из проекта — пропускаем
    items.push(makeItem(def, s.xN, s.yN, s.sN, s.flip));
  }
}

// ------------------------------------------------------------------ фон комнаты

function setRoom(id: string): void {
  room = id;
  const tex = roomTex.get(id);
  if (tex) { bg.texture = tex; bg.visible = true; }
  else { bg.visible = false; } // 'blank' — виден фон сцены (тёплый цвет)
  relayout();
  loadRoomItems();
  syncRoomButtons();
}

// ------------------------------------------------------------------ DOM: палитра, тулбар, инфо

function buildPalette(): void {
  const pal = document.getElementById('palette')!;
  for (const def of defs) {
    const el = document.createElement('div');
    el.className = 'thumb';
    el.title = def.name;
    const img = document.createElement('img');
    img.src = def.url;
    const cap = document.createElement('div');
    cap.className = 'cap';
    cap.textContent = def.name.replace(/_seed\d+$/, '').replace(/_/g, ' ');
    el.append(img, cap);
    el.addEventListener('pointerdown', (e) => onPaletteDown(def, e));
    pal.appendChild(el);
  }
}

function syncRoomButtons(): void {
  document.querySelectorAll('#rooms button').forEach((b) => {
    b.classList.toggle('on', (b as HTMLElement).dataset.id === room);
  });
}

function buildToolbar(): void {
  const rooms = document.getElementById('rooms')!;
  for (const r of ROOMS) {
    const b = document.createElement('button');
    b.className = 'btn';
    b.textContent = r.label;
    b.dataset.id = r.id;
    b.addEventListener('click', () => setRoom(r.id));
    rooms.appendChild(b);
  }
  syncRoomButtons();

  const on = (id: string, fn: () => void): void => {
    document.getElementById(id)!.addEventListener('click', fn);
  };
  on('flip', () => { if (selected) { selected.flip = !selected.flip; apply(selected); save(); } });
  on('front', () => { if (selected) reorder(selected, true); });
  on('back', () => { if (selected) reorder(selected, false); });
  on('del', () => { if (selected) removeItem(selected); });
  on('clear', () => {
    if (!items.length || !confirm('Убрать весь декор из этой комнаты?')) return;
    for (const it of items) it.sprite.destroy();
    items = []; select(null); save();
  });
  on('exp', openExport);
  on('exp-close', () => (document.getElementById('export') as HTMLDialogElement).close());
  on('exp-copy', () => {
    const ta = document.getElementById('exp-text') as HTMLTextAreaElement;
    navigator.clipboard?.writeText(ta.value).catch(() => { ta.select(); document.execCommand('copy'); });
    const btn = document.getElementById('exp-copy')!;
    const t = btn.textContent; btn.textContent = '✓ Скопировано';
    setTimeout(() => { btn.textContent = t; }, 1200);
  });
}

function updateInfo(): void {
  const info = document.getElementById('info')!;
  if (!selected) {
    info.textContent = `Комната «${room}»: спрайтов ${items.length}. Перетащи из палитры; колесо/угол — масштаб; F — отразить; Del — удалить.`;
    return;
  }
  const it = selected;
  const px = Math.round(it.xN * roomW());
  const py = Math.round(it.yN * roomH());
  const hpx = Math.round(it.sN * roomH());
  info.textContent =
    `${it.def.name} · x ${(it.xN * 100).toFixed(1)}% (${px}px) · y ${(it.yN * 100).toFixed(1)}% (${py}px) · `
    + `высота ${(it.sN * 100).toFixed(1)}% (${hpx}px)${it.flip ? ' · ↔' : ''}`;
}

function openExport(): void {
  const data = {
    room,
    note: 'xN/yN — точка касания пола (низ-центр) в долях комнаты; scale — высота спрайта в долях высоты комнаты; anchor (0.5,1).',
    items: items.map((it) => ({
      sprite: it.def.name,
      xN: +it.xN.toFixed(4),
      yN: +it.yN.toFixed(4),
      scale: +it.sN.toFixed(4),
      flip: it.flip,
    })),
  };
  (document.getElementById('exp-text') as HTMLTextAreaElement).value = JSON.stringify(data, null, 2);
  (document.getElementById('export') as HTMLDialogElement).showModal();
}

// ------------------------------------------------------------------ старт

async function main(): Promise<void> {
  await app.init({
    background: 0xe2f3e8, // тёплый фон сцены (виден в режиме «Пусто»)
    antialias: true,
    resolution: Math.min(window.devicePixelRatio || 1, 2),
    autoDensity: true,
    resizeTo: window,
  });
  document.getElementById('stage')!.appendChild(app.canvas);

  // фоны комнат
  await Promise.all(Object.entries(roomUrls).map(async ([path, url]) => {
    try { roomTex.set(fileKey(path), await Assets.load(url)); } catch { /* нет фона — пропустим */ }
  }));

  // спрайты декора
  const entries = Object.entries(decorUrls).sort(([a], [b]) => a.localeCompare(b));
  defs = await Promise.all(entries.map(async ([path, url]) => ({
    name: fileKey(path), url, tex: await Assets.load(url) as Texture,
  })));

  app.stage.addChild(world, overlay);
  world.addChild(bg);

  buildPalette();
  buildToolbar();
  setRoom(room);

  app.canvas.addEventListener('pointerdown', onCanvasDown);
  window.addEventListener('pointermove', onMove);
  window.addEventListener('pointerup', onUp);
  app.canvas.addEventListener('wheel', onWheel, { passive: false });
  window.addEventListener('keydown', onKey);
  window.addEventListener('resize', relayout);

  app.ticker.add(drawOverlay);
  updateInfo();
}

main();
