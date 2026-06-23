/**
 * Этап 2 / proof-of-concept взаимодействия.
 * Пайплайн «генотип → фенотип → послойный котик» на PixiJS:
 * псевдо-3D объём, ходьба по сцене влево-вправо, взятие за шкирку
 * (поза «вис» + перетаскивание с инерцией), счётчик FPS и стресс-тест.
 */

import {
  Application, Container, Rectangle, Sprite, Text, Texture,
  type FederatedPointerEvent,
} from 'pixi.js';
import {
  randomCat, breed, expressPhenotype, calcRarity, detectBreed, isLethal,
  makeRng, type Genotype, type Rng,
} from './genetics/index.js';
import { buildCat } from './render/catSprite.js';

const RARITY_RU: Record<string, string> = {
  common: 'обычный', uncommon: 'необычный', rare: 'редкий',
  epic: 'эпический', legendary: 'легендарный',
};
const PATTERN_RU: Record<string, string> = {
  ticked: 'тикированный', spotted: 'пятнистый', mackerel: 'тигровый', classic: 'мраморный',
};
const EAR_RU: Record<string, string> = { normal: 'обычные', fold: 'вислоухие', curl: 'кёрл' };
const FACE_RU: Record<string, string> = { normal: 'обычная', round: 'круглая', wedge: 'клиновидная' };

const rng: Rng = makeRng(Math.floor(Math.random() * 1e9));

interface Entry {
  g: Genotype;
  view: Container;
  eyes: Container | null;
  label: Text;
  scale: number;
  homeY: number;
  x: number;
  targetX: number;
  facing: 1 | -1;
  phase: number;
  walking: boolean;
  nextBlink: number;
  blink: number;
  nextWander: number;
  landT: number;
  dragging: boolean;
}

const app = new Application();

async function main() {
  await app.init({
    background: '#fdf3e7',
    resizeTo: window,
    antialias: true,
    resolution: Math.min(window.devicePixelRatio || 1, 2),
    autoDensity: true,
  });
  document.getElementById('app')!.appendChild(app.canvas);

  app.stage.eventMode = 'static';
  const updateHit = () => { app.stage.hitArea = new Rectangle(0, 0, app.screen.width, app.screen.height); };
  updateHit();

  const stressLayer = new Container();
  const familyLayer = new Container();
  const dragLayer = new Container();
  app.stage.addChild(stressLayer, familyLayer, dragLayer);

  let mother: Genotype = randomCat(rng, 'female');
  let father: Genotype = randomCat(rng, 'male');
  let kitten: Genotype | null = null;
  let family: Entry[] = [];
  let stress: { sprite: Sprite; phase: number; baseY: number }[] = [];

  // состояние перетаскивания
  let drag: { entry: Entry; view: Container; x: number; y: number; px: number } | null = null;

  const infoEl = document.getElementById('info')!;
  const fpsEl = document.getElementById('fps')!;

  function describe(g: Genotype): string {
    const p = expressPhenotype(g);
    const r = calcRarity(g);
    const traits = [
      `окрас: ${p.white ? 'белый' : p.baseColor}${p.isTortie ? ' (черепаховый)' : ''}`,
      `узор: ${p.pattern ? PATTERN_RU[p.pattern] : 'сплошной'}`,
      `шерсть: ${p.coatLength === 'long' ? 'длинная' : 'короткая'}`,
      `уши: ${EAR_RU[p.earShape]}, морда: ${FACE_RU[p.faceShape]}`,
      `глаза: ${p.eyeColor}${p.oddEyed ? ' (разные)' : ''}`,
      p.pointed ? `колор-пойнт: ${p.pointType}` : '',
    ].filter(Boolean);
    return `🐱 ${detectBreed(g)} · ${g.sex === 'female' ? '♀' : '♂'} · ${RARITY_RU[r.tier]} (${r.score})\n` + traits.join('\n');
  }

  function makeLabel(text: string): Text {
    const t = new Text({
      text,
      style: { fontFamily: 'system-ui', fontSize: 18, fontWeight: '700', fill: 0x5a4a42 },
    });
    t.anchor.set(0.5);
    return t;
  }

  function makeEntry(g: Genotype, x: number, homeY: number, scale: number, name: string): Entry {
    const view = buildCat(expressPhenotype(g), 'sit');
    view.scale.set(scale);
    view.position.set(x, homeY);
    view.eventMode = 'static';
    view.cursor = 'grab';
    const label = makeLabel(name);
    const entry: Entry = {
      g, view, eyes: view.getChildByLabel('eyes', true) as Container | null,
      label, scale, homeY, x, targetX: x, facing: 1, phase: Math.random() * 6,
      walking: false, nextBlink: 2 + Math.random() * 3, blink: 0,
      nextWander: 1 + Math.random() * 2, landT: 0, dragging: false,
    };
    view.on('pointerdown', (e) => startDrag(entry, e));
    familyLayer.addChild(view, label);
    return entry;
  }

  function layoutFamily() {
    cancelDrag();
    familyLayer.removeChildren();
    family = [];
    const W = app.screen.width, H = app.screen.height;
    const s = Math.min(Math.max(Math.min(W, H) / 760, 0.46), 1.0);
    family.push(makeEntry(mother, W * 0.30, H * 0.32, s, 'Мама ♀'));
    family.push(makeEntry(father, W * 0.70, H * 0.32, s, 'Папа ♂'));
    if (kitten) family.push(makeEntry(kitten, W * 0.5, H * 0.64, s, 'Котёнок'));
  }

  function newPair() {
    clearStress();
    familyLayer.visible = true;
    mother = randomCat(rng, 'female');
    father = randomCat(rng, 'male');
    kitten = null;
    layoutFamily();
    infoEl.textContent = 'Возьми котика за шкирку и потаскай 🐾\n\nРодители:\n— ' + describe(mother) + '\n\n— ' + describe(father);
  }

  function doBreed() {
    clearStress();
    familyLayer.visible = true;
    let note = '';
    let child = breed(mother, father, rng, 0.02);
    let guard = 0;
    while (isLethal(child) && guard++ < 8) {
      note = '⚠️ котёнок fold/fold не выжил — лаборатория повторила попытку\n\n';
      child = breed(mother, father, rng, 0.02);
    }
    kitten = child;
    layoutFamily();
    infoEl.textContent = note + 'Котёнок:\n' + describe(kitten);
  }

  // --- drag за шкирку ---
  function startDrag(entry: Entry, e: FederatedPointerEvent) {
    if (stress.length > 0) return;
    cancelDrag();
    entry.dragging = true;
    entry.view.visible = false;
    entry.label.visible = false;
    const view = buildCat(expressPhenotype(entry.g), 'hang');
    view.scale.set(entry.scale);
    view.pivot.set(0, -104); // держим за «шкирку» (верхняя точка)
    view.position.set(e.global.x, e.global.y);
    dragLayer.addChild(view);
    drag = { entry, view, x: e.global.x, y: e.global.y, px: e.global.x };
    app.canvas.style.cursor = 'grabbing';
  }

  function cancelDrag() {
    if (!drag) return;
    drag.view.destroy({ children: true });
    drag.entry.dragging = false;
    drag.entry.view.visible = true;
    drag.entry.label.visible = true;
    drag = null;
    app.canvas.style.cursor = 'default';
  }

  function endDrag() {
    if (!drag) return;
    const W = app.screen.width;
    const e = drag.entry;
    const dropX = Math.min(Math.max(drag.x, 80), W - 80);
    drag.view.destroy({ children: true });
    e.dragging = false;
    e.x = dropX; e.targetX = dropX;
    e.view.x = dropX;
    e.view.visible = true;
    e.label.visible = true;
    e.landT = 0.35; // анимация приземления
    drag = null;
    app.canvas.style.cursor = 'default';
  }

  app.stage.on('pointermove', (e: FederatedPointerEvent) => {
    if (drag) { drag.x = e.global.x; drag.y = e.global.y; }
  });
  app.stage.on('pointerup', endDrag);
  app.stage.on('pointerupoutside', endDrag);

  // --- стресс-тест ---
  function clearStress() { stressLayer.removeChildren(); stress = []; }

  function toggleStress() {
    if (stress.length > 0) { clearStress(); familyLayer.visible = true; return; }
    cancelDrag();
    familyLayer.visible = false;
    const W = app.screen.width, H = app.screen.height;
    const textures: Texture[] = [];
    for (let i = 0; i < 16; i++) {
      const c = buildCat(expressPhenotype(randomCat(rng)));
      textures.push(app.renderer.generateTexture(c));
      c.destroy({ children: true });
    }
    for (let i = 0; i < 200; i++) {
      const sp = new Sprite(textures[i % textures.length]);
      sp.anchor.set(0.5);
      sp.scale.set(0.22 + Math.random() * 0.12);
      const baseY = Math.random() * H;
      sp.position.set(Math.random() * W, baseY);
      stressLayer.addChild(sp);
      stress.push({ sprite: sp, phase: Math.random() * 6, baseY });
    }
    infoEl.textContent = '🔥 Стресс-тест: 200 котов. Следи за FPS справа.\nНажми кнопку ещё раз, чтобы вернуться.';
  }

  // --- анимация ---
  app.ticker.add((ticker) => {
    const dt = Math.min(ticker.deltaMS / 1000, 0.05);
    const W = app.screen.width;

    for (const a of family) {
      a.phase += dt;
      if (!a.dragging) {
        // блуждание влево-вправо
        a.nextWander -= dt;
        if (a.nextWander <= 0) {
          a.targetX = Math.min(Math.max(a.x + (Math.random() - 0.5) * 320, 90), W - 90);
          a.nextWander = 1.5 + Math.random() * 3;
        }
        const dx = a.targetX - a.x;
        a.walking = Math.abs(dx) > 3;
        if (a.walking) {
          const dir = Math.sign(dx) as 1 | -1;
          a.facing = dir;
          a.x += dir * Math.min(Math.abs(dx), 70 * dt);
        }
        a.view.x = a.x;

        // приземление после броска
        let landScale = 1;
        if (a.landT > 0) {
          a.landT -= dt;
          landScale = 1 - Math.sin((a.landT / 0.35) * Math.PI) * 0.18;
        }
        // дыхание / покачивание при ходьбе
        const breathe = 1 + Math.sin(a.phase * (a.walking ? 9 : 2)) * (a.walking ? 0.05 : 0.02);
        a.view.scale.x = a.scale * a.facing;
        a.view.scale.y = a.scale * breathe * landScale;
        a.view.y = a.homeY + (a.walking ? Math.abs(Math.sin(a.phase * 9)) * -5 : 0);

        a.label.position.set(a.x, a.homeY + 150 * a.scale);

        // моргание
        if (a.eyes) {
          a.nextBlink -= dt;
          if (a.nextBlink <= 0 && a.blink <= 0) { a.blink = 0.001; a.nextBlink = 2 + Math.random() * 3.5; }
          if (a.blink > 0) {
            a.blink += dt;
            const prog = a.blink / 0.16;
            a.eyes.scale.y = prog >= 1 ? 1 : 1 - Math.sin(Math.PI * prog) * 0.9;
            if (prog >= 1) a.blink = 0;
          }
        }
      }
    }

    // перетаскивание: следование с инерцией + раскачивание
    if (drag) {
      const v = drag.view;
      v.x += (drag.x - v.x) * Math.min(1, dt * 12);
      v.y += (drag.y - v.y) * Math.min(1, dt * 12);
      const vx = v.x - drag.px;
      drag.px = v.x;
      v.rotation += (Math.max(-0.5, Math.min(0.5, -vx * 0.03)) - v.rotation) * Math.min(1, dt * 10);
    }

    for (const s of stress) {
      s.phase += dt;
      s.sprite.y = s.baseY + Math.sin(s.phase * 2) * 10;
    }
  });

  setInterval(() => { fpsEl.textContent = 'FPS: ' + Math.round(app.ticker.FPS); }, 300);

  document.getElementById('btn-pair')!.addEventListener('click', newPair);
  document.getElementById('btn-breed')!.addEventListener('click', doBreed);
  document.getElementById('btn-stress')!.addEventListener('click', toggleStress);
  window.addEventListener('resize', () => { updateHit(); if (familyLayer.visible) layoutFamily(); });

  newPair();
}

main();
