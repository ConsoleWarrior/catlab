/**
 * Game — контроллер игрового UI (Этап 4).
 * Разрез лаборатории: 4 комнаты в ряд, свайп-навигация, фиксированный HUD
 * ресурсов, оверлеи (меню кота, заказы), тикер с таймерами и пассивным
 * доходом, автосейв в localStorage и офлайн-доход при возврате.
 */

import {
  Application, Container, Graphics, Rectangle,
} from 'pixi.js';
import type { Text, Texture, FederatedPointerEvent } from 'pixi.js';
import { makeRng, randomCat, expressPhenotype } from '../genetics/index.js';
import type { Rng } from '../genetics/index.js';
import { buildCat } from '../render/catSprite.js';
import {
  createInitialState, serialize, deserialize, collectIncome, collectReady,
  passiveRatePerMin, SAVE_VERSION, makeCatInstance, startBreeding, incubationDuration,
} from '../game/index.js';
import { isBusy } from '../game/index.js';
import type { Cat, GameState } from '../game/index.js';
import type { GrabOpts, Room, UiContext } from './context.js';
import { Button, COLORS, fmt, label } from './theme.js';
import { catTexture } from './catTextures.js';
import { createIncubator } from './rooms/incubator.js';
import { createNursery } from './rooms/nursery.js';
import { createShelter } from './rooms/shelter.js';
import { createGenolab } from './rooms/genolab.js';
import { buildCatMenu, buildOrdersPanel, buildHelpPanel, buildUpgradesPanel } from './overlays.js';

const SAVE_KEY = 'catlab:save:v1';

export class Game implements UiContext {
  readonly app = new Application();
  state!: GameState;
  readonly rng: Rng = makeRng(Math.floor(Math.random() * 1e9));
  roomW = 0;
  roomH = 0;
  topInset = 56;
  selection: string[] = [];
  private freshGame = false;

  private readonly world = new Container();
  private readonly hud = new Container();
  private readonly nav = new Container();
  private readonly dragLayer = new Container();
  private readonly overlayLayer = new Container();
  private readonly toastBox = new Container();
  private rooms: Room[] = [];
  private currentRoom = 0;
  private targetX = 0;

  // навигация мышью/тачем
  private pointerActive = false;
  private dragging = false;
  private startPx = 0;
  private startWorldX = 0;

  // взятие котика за шкирку
  private pendingGrab: { opts: GrabOpts; sx: number; sy: number } | null = null;
  private grab: { opts: GrabOpts; sprite: Container; x: number; y: number; px: number } | null = null;

  // HUD-ссылки
  private coinsT!: Text;
  private crystalsT!: Text;
  private dnaT!: Text;
  private levelT!: Text;
  private ordersBtn!: Button;
  private dots: Graphics[] = [];

  // прочее
  private incomeAcc = 0;
  private readyCount = 0;
  private saveTimer = 0;
  private toastT: Text | null = null;
  private toastUntil = 0;

  now(): number { return Date.now(); }

  async start(reset = false): Promise<void> {
    await this.app.init({
      background: COLORS.bg,
      resizeTo: window,
      antialias: true,
      resolution: Math.min(window.devicePixelRatio || 1, 2),
      autoDensity: true,
    });
    document.getElementById('app')!.appendChild(this.app.canvas);

    this.loadState(reset);

    this.app.stage.eventMode = 'static';
    this.app.stage.addChild(this.world, this.hud, this.nav, this.dragLayer, this.overlayLayer, this.toastBox);

    this.layout();
    this.installInput();
    this.app.ticker.add((t) => this.update(Math.min(t.deltaMS / 1000, 0.05)));

    // первый запуск — показываем инструкцию (но не во время скриншотов ?reset)
    if (this.freshGame && !reset) this.openHelp();

    // автосейв при сворачивании/закрытии
    document.addEventListener('visibilitychange', () => { if (document.hidden) this.save(); });
    window.addEventListener('beforeunload', () => this.save());
    window.addEventListener('resize', () => this.layout());

    if (import.meta.env.DEV) {
      (window as unknown as { __game: unknown }).__game = {
        app: this.app, state: this.state,
        goRoom: (i: number) => this.goRoom(i),
        openOrders: () => this.openOrders(),
        openHelp: () => this.openHelp(),
        closeOverlay: () => this.closeOverlay(),
        give: (c = 5000, x = 50, d = 500) => { this.state.coins += c; this.state.crystals += x; this.state.dna += d; this.commit(); },
        demo: () => this.demo(),
        demoGrab: () => this.demoGrab(),
        save: () => this.save(),
      };
    }
  }

  /** DEV: наполнить сцену котами и активной вязкой для скриншотов/проверки. */
  private demo(): void {
    this.state.coins += 8000; this.state.crystals += 60; this.state.dna += 800;
    this.state.upgrades.nurseryCap = 4; // запас места
    const now = this.now();
    for (let i = 0; i < 6; i++) {
      this.state.cats.push(makeCatInstance(this.state, randomCat(this.rng), now, 'nursery'));
    }
    for (let i = 0; i < 7; i++) {
      this.state.cats.push(makeCatInstance(this.state, randomCat(this.rng), now, 'shelter'));
    }
    const f = this.state.cats.find((c) => c.location === 'nursery' && c.genotype.sex === 'female');
    const m = this.state.cats.find((c) => c.location === 'nursery' && c.genotype.sex === 'male');
    if (f && m) {
      const r = startBreeding(this.state, 0, f.id, m.id, now);
      if (r.ok) {
        const slot = this.state.slots[0]!;
        const total = incubationDuration(this.state);
        slot.startedAt = now - total * 0.5;
        slot.readyAt = now + total * 0.5; // показать прогресс ~50%
      }
    }
    this.commit();
  }

  /** DEV: показать котика «на весу» по центру (для скриншота взятия за шкирку). */
  private demoGrab(): void {
    const cat = this.state.cats.find((c) => c.location === 'nursery' && !isBusy(this.state, c.id));
    if (!cat) return;
    const cx = this.roomW / 2;
    const cy = this.roomH / 2;
    this.pendingGrab = {
      opts: { cat, displayH: 130, hide: () => {}, show: () => {}, onTap: () => {}, onDrop: () => {} },
      sx: cx, sy: cy,
    };
    this.beginGrab({ global: { x: cx, y: cy } } as FederatedPointerEvent);
    if (this.grab) { this.grab.x = cx; this.grab.y = cy - 30; }
  }

  // --- состояние ---

  private loadState(reset: boolean): void {
    if (!reset) {
      try {
        const raw = localStorage.getItem(SAVE_KEY);
        if (raw) {
          const s = deserialize(raw);
          if (s && s.version === SAVE_VERSION) {
            this.state = s;
            this.applyOffline();
            return;
          }
        }
      } catch { /* битый сейв — начинаем заново */ }
    }
    this.state = createInitialState(this.rng, this.now());
    this.freshGame = true;
  }

  /** Офлайн-прогресс: родившиеся котята + накопленный доход. */
  private applyOffline(): void {
    const now = this.now();
    const events = collectReady(this.state, now, this.rng);
    const born = events.filter((e) => e.kitten).length;
    const inc = collectIncome(this.state, now);
    const parts: string[] = [];
    if (born) parts.push(`родилось котят: ${born} 🐱`);
    if (inc.coins) parts.push(`доход: +💰${inc.coins}`);
    if (parts.length) setTimeout(() => this.toast('С возвращением! ' + parts.join(', ')), 600);
  }

  save(): void {
    try { localStorage.setItem(SAVE_KEY, serialize(this.state)); } catch { /* квота/приватный режим */ }
  }

  // --- UiContext ---

  commit(): void {
    for (const r of this.rooms) r.refresh();
    this.updateHud();
    this.saveTimer = 0; // отложенный сейв в update()
  }

  toast(msg: string): void {
    if (!this.toastT) return;
    this.toastT.text = msg;
    this.toastUntil = this.now() + 2400;
    this.drawToast();
  }

  catTexture(cat: Cat): Texture { return catTexture(this.app, cat); }

  toggleSelect(catId: string): void {
    const i = this.selection.indexOf(catId);
    if (i >= 0) { this.selection.splice(i, 1); return; }
    this.selection.push(catId);
    while (this.selection.length > 2) this.selection.shift();
  }

  clearSelection(): void { this.selection.length = 0; }

  goRoom(index: number): void {
    this.currentRoom = Math.max(0, Math.min(this.rooms.length - 1, index));
    this.targetX = -this.currentRoom * this.roomW;
    this.updateNav();
  }

  openCatMenu(cat: Cat): void {
    const close = (): void => this.closeOverlay();
    this.showOverlay(buildCatMenu(this, cat, close));
  }

  openOrders(): void {
    const close = (): void => this.closeOverlay();
    this.showOverlay(buildOrdersPanel(this, close));
  }

  openHelp(): void {
    const close = (): void => this.closeOverlay();
    this.showOverlay(buildHelpPanel(this, close));
  }

  openUpgrades(title: string, ids: string[]): void {
    const close = (): void => this.closeOverlay();
    this.showOverlay(buildUpgradesPanel(this, title, ids, close));
  }

  startGrab(opts: GrabOpts, e: FederatedPointerEvent): void {
    if (this.overlayOpen) return;
    this.pendingGrab = { opts, sx: e.global.x, sy: e.global.y };
  }

  private beginGrab(e: FederatedPointerEvent): void {
    if (!this.pendingGrab) return;
    const opts = this.pendingGrab.opts;
    opts.hide();
    const hang = buildCat(expressPhenotype(opts.cat.genotype), 'hang', opts.cat.genotype.sex);
    const s = (opts.displayH * 1.6) / Math.max(1, hang.height);
    hang.scale.set(s);
    hang.pivot.set(0, -104);
    hang.position.set(e.global.x, e.global.y);
    this.dragLayer.addChild(hang);
    this.grab = { opts, sprite: hang, x: e.global.x, y: e.global.y, px: e.global.x };
    this.app.canvas.style.cursor = 'grabbing';
  }

  private endGrab(): void {
    if (!this.grab) return;
    const gx = this.grab.x;
    this.grab.sprite.destroy({ children: true });
    this.grab.opts.show();
    this.grab.opts.onDrop(gx);
    this.grab = null;
    this.app.canvas.style.cursor = 'default';
  }

  // --- раскладка ---

  private layout(): void {
    this.roomW = this.app.screen.width;
    this.roomH = this.app.screen.height;
    this.topInset = Math.round(Math.max(48, Math.min(64, this.roomH * 0.085)));
    this.app.stage.hitArea = new Rectangle(0, 0, this.roomW, this.roomH);

    // пересобираем комнаты под новый размер
    for (const r of this.rooms) r.container.destroy({ children: true });
    this.world.removeChildren();
    this.rooms = [
      createIncubator(this),
      createNursery(this),
      createShelter(this),
      createGenolab(this),
    ];
    this.rooms.forEach((r, i) => {
      r.container.position.set(i * this.roomW, 0);
      this.world.addChild(r.container);
      r.refresh();
    });

    this.buildHud();
    this.buildNav();
    this.buildToast();

    this.currentRoom = Math.min(this.currentRoom, this.rooms.length - 1);
    this.targetX = -this.currentRoom * this.roomW;
    this.world.x = this.targetX;
    this.updateHud();
    this.updateNav();
  }

  private buildHud(): void {
    this.hud.removeChildren();
    const w = this.roomW;
    const ti = this.topInset;
    const bg = new Graphics();
    bg.rect(0, 0, w, ti).fill({ color: COLORS.hud, alpha: 0.96 });
    bg.rect(0, ti - 2, w, 2).fill({ color: COLORS.cardEdge });
    this.hud.addChild(bg);

    // адаптивные размеры под ширину экрана (один интерфейс для ПК и мобилы)
    const fs = Math.round(Math.max(13, Math.min(18, ti * 0.3)));
    const pad = Math.round(Math.max(8, Math.min(18, w * 0.014)));
    const gap = Math.max(82, Math.min(150, w / 6));
    const mk = (x: number, color: number): Text => {
      const t = label('', fs, color, '800');
      t.anchor.set(0, 0.5);
      t.position.set(x, ti / 2);
      this.hud.addChild(t);
      return t;
    };
    this.coinsT = mk(pad, 0xc9912a);
    this.crystalsT = mk(pad + gap, 0x3a93c9);
    this.dnaT = mk(pad + gap * 2, 0x7a4fd0);
    this.levelT = mk(pad + gap * 3, COLORS.ink);

    const bh = Math.round(ti * 0.72);
    const helpW = Math.round(ti * 0.92);
    const help = new Button({ text: '❓', w: helpW, h: bh, color: COLORS.secondary, fontSize: fs + 3 });
    help.position.set(w - pad - helpW / 2, ti / 2);
    help.onTap = () => this.openHelp();

    const ordW = Math.round(Math.max(120, Math.min(180, w * 0.16)));
    this.ordersBtn = new Button({ text: '📋 Заказы', w: ordW, h: bh, color: COLORS.warn, fontSize: fs });
    this.ordersBtn.position.set(w - pad - helpW - 8 - ordW / 2, ti / 2);
    this.ordersBtn.onTap = () => this.openOrders();
    this.hud.addChild(help, this.ordersBtn);
  }

  private updateHud(): void {
    if (!this.coinsT) return;
    this.coinsT.text = `💰 ${fmt(this.state.coins)}`;
    this.crystalsT.text = `💎 ${fmt(this.state.crystals)}`;
    this.dnaT.text = `🧬 ${fmt(this.state.dna)}`;
    this.levelT.text = `⭐ Ур. ${this.state.level}`;
    this.ordersBtn.setText(`📋 Заказы (${this.state.orders.length})`);
  }

  private buildNav(): void {
    this.nav.removeChildren();
    this.dots = [];
    const n = this.rooms.length;
    const gap = 26;
    const y = this.roomH - 22;
    const totalW = gap * (n - 1);
    const startX = this.roomW / 2 - totalW / 2;
    for (let i = 0; i < n; i++) {
      const d = new Graphics();
      d.circle(0, 0, 7).fill(COLORS.cardEdge);
      d.position.set(startX + i * gap, y);
      d.eventMode = 'static';
      d.cursor = 'pointer';
      d.on('pointertap', () => this.goRoom(i));
      this.nav.addChild(d);
      this.dots.push(d);
    }

    // стрелки для ПК
    const left = new Button({ text: '‹', w: 40, h: 40, color: COLORS.hud, textColor: COLORS.ink, fontSize: 26 });
    left.position.set(28, this.roomH / 2);
    left.onTap = () => this.goRoom(this.currentRoom - 1);
    const right = new Button({ text: '›', w: 40, h: 40, color: COLORS.hud, textColor: COLORS.ink, fontSize: 26 });
    right.position.set(this.roomW - 28, this.roomH / 2);
    right.onTap = () => this.goRoom(this.currentRoom + 1);
    this.nav.addChild(left, right);
  }

  private updateNav(): void {
    this.dots.forEach((d, i) => {
      d.clear();
      const active = i === this.currentRoom;
      d.circle(0, 0, active ? 9 : 7).fill(active ? COLORS.primary : COLORS.cardEdge);
    });
  }

  private buildToast(): void {
    this.toastBox.removeChildren();
    const t = label('', 15, 0xffffff, '700');
    t.position.set(0, 0);
    this.toastT = t;
    const wrap = new Container();
    wrap.addChild(t);
    wrap.position.set(this.roomW / 2, this.roomH - 56);
    this.toastBox.addChild(wrap);
    this.toastBox.alpha = 0;
  }

  private drawToast(): void {
    if (!this.toastT) return;
    const wrap = this.toastT.parent;
    if (!wrap) return;
    const w = this.toastT.width + 36;
    const bgName = '__bg';
    const old = wrap.getChildByLabel(bgName);
    if (old) old.destroy();
    const bg = new Graphics();
    bg.label = bgName;
    bg.roundRect(-w / 2, -20, w, 40, 14).fill({ color: COLORS.overlay, alpha: 0.92 });
    wrap.addChildAt(bg, 0);
    this.toastBox.alpha = 1;
  }

  // --- оверлеи ---

  private showOverlay(content: Container): void {
    this.closeOverlay();
    const dim = new Graphics();
    dim.rect(0, 0, this.roomW, this.roomH).fill({ color: COLORS.overlay, alpha: 0.5 });
    dim.eventMode = 'static';
    dim.on('pointertap', () => this.closeOverlay());

    // вписываем панель в экран (на узких мобильных — уменьшаем)
    const margin = 12;
    let s = 1;
    if (content.height > this.roomH - margin * 2) s = Math.min(s, (this.roomH - margin * 2) / content.height);
    if (content.width > this.roomW - margin * 2) s = Math.min(s, (this.roomW - margin * 2) / content.width);
    content.scale.set(s);
    content.position.set((this.roomW - content.width) / 2, (this.roomH - content.height) / 2);

    this.overlayLayer.addChild(dim, content);
  }

  private closeOverlay(): void {
    this.overlayLayer.removeChildren();
  }

  private get overlayOpen(): boolean { return this.overlayLayer.children.length > 0; }

  // --- ввод (свайп) ---

  private installInput(): void {
    this.app.stage.on('pointerdown', (e: FederatedPointerEvent) => {
      if (this.overlayOpen || this.pendingGrab) return; // котика берём — комнату не свайпим
      this.pointerActive = true;
      this.dragging = false;
      this.startPx = e.global.x;
      this.startWorldX = this.world.x;
    });
    this.app.stage.on('pointermove', (e: FederatedPointerEvent) => {
      if (this.overlayOpen) return;
      // взятие котика за шкирку (приоритетнее свайпа)
      if (this.pendingGrab && !this.grab) {
        const dx = e.global.x - this.pendingGrab.sx;
        const dy = e.global.y - this.pendingGrab.sy;
        if (dx * dx + dy * dy > 64) this.beginGrab(e);
      }
      if (this.grab) { this.grab.x = e.global.x; this.grab.y = e.global.y; return; }
      // свайп комнат
      if (!this.pointerActive) return;
      const sdx = e.global.x - this.startPx;
      if (Math.abs(sdx) > 10) this.dragging = true;
      if (this.dragging) {
        const minX = -(this.rooms.length - 1) * this.roomW;
        this.world.x = Math.max(minX, Math.min(0, this.startWorldX + sdx));
      }
    });
    const up = (): void => {
      if (this.grab) { this.endGrab(); this.pendingGrab = null; return; }
      if (this.pendingGrab) { this.pendingGrab.opts.onTap(); this.pendingGrab = null; return; }
      if (!this.pointerActive) return;
      this.pointerActive = false;
      if (!this.dragging) return;
      const moved = this.startWorldX - this.world.x; // >0 — свайп влево (к следующей)
      if (Math.abs(moved) > this.roomW * 0.18) this.goRoom(this.currentRoom + Math.sign(moved));
      else this.goRoom(this.currentRoom);
      this.dragging = false;
    };
    this.app.stage.on('pointerup', up);
    this.app.stage.on('pointerupoutside', up);
  }

  // --- цикл ---

  private update(dt: number): void {
    // плавный доезд к выбранной комнате
    if (!this.dragging) {
      const d = this.targetX - this.world.x;
      if (Math.abs(d) > 0.5) this.world.x += d * Math.min(1, dt * 12);
      else this.world.x = this.targetX;
    }

    // котик на весу: следование с инерцией + раскачивание
    if (this.grab) {
      const v = this.grab.sprite;
      v.x += (this.grab.x - v.x) * Math.min(1, dt * 14);
      v.y += (this.grab.y - v.y) * Math.min(1, dt * 14);
      const vx = v.x - this.grab.px;
      this.grab.px = v.x;
      v.rotation += (Math.max(-0.5, Math.min(0.5, -vx * 0.03)) - v.rotation) * Math.min(1, dt * 10);
    }

    // таймеры/анимация текущей комнаты
    this.rooms[this.currentRoom]?.tick?.(dt);

    // пассивный доход (живое накопление)
    const rate = passiveRatePerMin(this.state);
    if (rate > 0) {
      this.incomeAcc += (rate / 60) * dt;
      const whole = Math.floor(this.incomeAcc);
      if (whole > 0) { this.state.coins += whole; this.incomeAcc -= whole; }
    }
    this.state.lastSeenAt = this.now();

    // появились готовые котята → пересобрать (чтобы показать «Забрать»)
    const ready = this.state.slots.filter((s) => s.readyAt > 0 && this.now() >= s.readyAt).length;
    if (ready !== this.readyCount) { this.readyCount = ready; this.commit(); }

    this.updateHud();

    // отложенный автосейв
    this.saveTimer += dt;
    if (this.saveTimer > 8) { this.saveTimer = 0; this.save(); }

    // затухание тоста
    if (this.toastBox.alpha > 0 && this.now() > this.toastUntil) {
      this.toastBox.alpha = Math.max(0, this.toastBox.alpha - dt * 2);
    }
  }
}
