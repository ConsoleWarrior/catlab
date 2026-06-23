/**
 * Этап 2 — технический прототип рендера.
 * Демонстрирует пайплайн «генотип → фенотип → послойный котик» на PixiJS,
 * скрещивание родителей, idle-анимацию, счётчик FPS и стресс-тест на 60 fps.
 */

import { Application, Container, Sprite, Text, Texture } from 'pixi.js';
import {
  randomCat, breed, expressPhenotype, calcRarity, detectBreed, isLethal,
  makeRng, type Genotype, type Phenotype, type Rng,
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

interface Animated {
  view: Container;
  eyes: Container | null;
  scale: number;
  phase: number;
  nextBlink: number;
  blink: number; // 0 = открыты, >0 = идёт моргание
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

  const familyLayer = new Container();
  const stressLayer = new Container();
  app.stage.addChild(stressLayer, familyLayer);

  let mother: Genotype = randomCat(rng, 'female');
  let father: Genotype = randomCat(rng, 'male');
  let kitten: Genotype | null = null;
  let family: Animated[] = [];
  let stress: { sprite: Sprite; phase: number; baseY: number }[] = [];

  const infoEl = document.getElementById('info')!;
  const fpsEl = document.getElementById('fps')!;

  function describe(g: Genotype): string {
    const p = expressPhenotype(g);
    const r = calcRarity(g);
    const breedName = detectBreed(g);
    const traits = [
      `окрас: ${p.white ? 'белый' : p.baseColor}${p.isTortie ? ' (черепаховый)' : ''}`,
      `узор: ${p.pattern ? PATTERN_RU[p.pattern] : 'сплошной'}`,
      `шерсть: ${p.coatLength === 'long' ? 'длинная' : 'короткая'}`,
      `уши: ${EAR_RU[p.earShape]}, морда: ${FACE_RU[p.faceShape]}`,
      `глаза: ${p.eyeColor}${p.oddEyed ? ' (разные)' : ''}`,
      p.pointed ? `колор-пойнт: ${p.pointType}` : '',
    ].filter(Boolean);
    return `🐱 ${breedName} · ${g.sex === 'female' ? '♀' : '♂'} · ${RARITY_RU[r.tier]} (${r.score})\n` + traits.join('\n');
  }

  function makeView(g: Genotype, scale: number): Animated {
    const p: Phenotype = expressPhenotype(g);
    const view = buildCat(p);
    view.scale.set(scale);
    const eyes = view.getChildByLabel('eyes') as Container | null;
    return {
      view, eyes, scale, phase: Math.random() * 6,
      nextBlink: 2 + Math.random() * 3, blink: 0,
    };
  }

  function label(text: string, x: number, y: number): Text {
    const t = new Text({
      text,
      style: { fontFamily: 'system-ui', fontSize: 18, fontWeight: '700', fill: 0x5a4a42 },
    });
    t.anchor.set(0.5);
    t.position.set(x, y);
    return t;
  }

  function layoutFamily() {
    familyLayer.removeChildren();
    family = [];
    const W = app.screen.width, H = app.screen.height;
    const s = Math.min(Math.max(Math.min(W, H) / 760, 0.46), 1.0);

    const placements: { g: Genotype; x: number; y: number; name: string }[] = [
      { g: mother, x: W * 0.28, y: H * 0.32, name: 'Мама ♀' },
      { g: father, x: W * 0.72, y: H * 0.32, name: 'Папа ♂' },
    ];
    if (kitten) placements.push({ g: kitten, x: W * 0.5, y: H * 0.66, name: 'Котёнок' });

    for (const pl of placements) {
      const a = makeView(pl.g, s);
      a.view.position.set(pl.x, pl.y);
      familyLayer.addChild(a.view);
      familyLayer.addChild(label(pl.name, pl.x, pl.y + 150 * s));
      family.push(a);
    }
  }

  function newPair() {
    clearStress();
    mother = randomCat(rng, 'female');
    father = randomCat(rng, 'male');
    kitten = null;
    layoutFamily();
    infoEl.textContent = 'Родители:\n— ' + describe(mother) + '\n\n— ' + describe(father);
  }

  function doBreed() {
    clearStress();
    let note = '';
    let child = breed(mother, father, rng, 0.02);
    // демонстрация летальной комбинации fold/fold
    let guard = 0;
    while (isLethal(child) && guard++ < 8) {
      note = '⚠️ котёнок fold/fold не выжил — лаборатория повторила попытку\n\n';
      child = breed(mother, father, rng, 0.02);
    }
    kitten = child;
    layoutFamily();
    infoEl.textContent = note + 'Котёнок:\n' + describe(kitten);
  }

  function clearStress() {
    stressLayer.removeChildren();
    stress = [];
  }

  function toggleStress() {
    if (stress.length > 0) { clearStress(); return; }
    familyLayer.visible = false;
    const W = app.screen.width, H = app.screen.height;
    // строим небольшой набор уникальных текстур и переиспользуем их (батчинг спрайтов)
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
    infoEl.textContent = '🔥 Стресс-тест: 200 анимированных котов.\nСмотри на FPS справа сверху.\nНажми кнопку ещё раз, чтобы вернуться.';
  }

  // --- анимация ---
  app.ticker.add((ticker) => {
    const dt = ticker.deltaMS / 1000;
    for (const a of family) {
      a.phase += dt;
      a.view.scale.x = a.scale;
      a.view.scale.y = a.scale * (1 + Math.sin(a.phase * 2) * 0.02);
      if (a.eyes) {
        a.nextBlink -= dt;
        if (a.nextBlink <= 0 && a.blink <= 0) { a.blink = 0.001; a.nextBlink = 2 + Math.random() * 3.5; }
        if (a.blink > 0) {
          a.blink += dt;
          const prog = a.blink / 0.16; // длительность моргания
          a.eyes.scale.y = prog >= 1 ? 1 : 1 - Math.sin(Math.PI * prog) * 0.9;
          if (prog >= 1) a.blink = 0;
        }
      }
    }
    for (const s of stress) {
      s.phase += dt;
      s.sprite.y = s.baseY + Math.sin(s.phase * 2) * 10;
    }
  });

  // --- FPS ---
  setInterval(() => { fpsEl.textContent = 'FPS: ' + Math.round(app.ticker.FPS); }, 300);

  // --- кнопки ---
  document.getElementById('btn-pair')!.addEventListener('click', () => { familyLayer.visible = true; newPair(); });
  document.getElementById('btn-breed')!.addEventListener('click', () => { familyLayer.visible = true; doBreed(); });
  document.getElementById('btn-stress')!.addEventListener('click', toggleStress);

  window.addEventListener('resize', () => { if (familyLayer.visible) layoutFamily(); });

  newPair();
}

main();
