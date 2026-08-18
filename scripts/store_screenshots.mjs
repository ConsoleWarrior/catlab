/**
 * Витринные скриншоты для Яндекс Игр (10 сцен × десктоп/мобила).
 * Требования площадки: ориентация альбомная, пропорции 16:9, длинная сторона
 * 1280–2560 px, формат JPEG или 24-битный PNG без альфа-канала.
 * Здесь: 1920×1080 JPEG (viewport 1280×720 × deviceScaleFactor 1.5).
 *
 * Мобильная версия снимается с hasTouch — игра сама переходит на крупный
 * мобильный масштаб (IS_TOUCH → DESIGN_H / TOUCH_ZOOM, UI_SCALE 1.2).
 *
 * Нужен DEV-сервер (window.__game только в dev-сборке):
 *   npx vite --port 5199 --strictPort
 *   node scripts/store_screenshots.mjs
 */
import { chromium } from 'playwright-core';
import { mkdirSync, statSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const BASE = process.env.BASE || 'http://localhost:5199';
const OUT = process.env.OUT || 'store_screens';
const EDGE = process.env.EDGE
  || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
// кадр меньше этого — рендерер отвалился и снял белый экран (бывает на холодном старте)
const MIN_BYTES = 60_000;

// ключи пород из каталога — для «открытых» страниц Котодекса
const BREED_KEYS = [...readFileSync('src/genetics/catalog.ts', 'utf8')
  .matchAll(/^\s*\['([a-z0-9_]+)',/gm)].map((m) => m[1]);

// Языки витрины: русская и английская локализация игры (п. 2.14 требований).
// Язык берётся из localStorage['catlab:lang'] — ставим его до загрузки страницы,
// чтобы весь UI строился сразу на нужном языке (без пересборки сцены на лету).
const DEVICES = [
  { id: 'desktop', width: 1280, height: 720, scale: 1.5, touch: false },
  { id: 'mobile', width: 1280, height: 720, scale: 1.5, touch: true },
];
const LANGS = ['ru', 'en'];
const VARIANTS = LANGS.flatMap((lang) => DEVICES.map((d) => ({
  ...d, lang, dir: lang === 'ru' ? d.id : `${d.id}-${lang}`,
})));

/** Прячем DEV-кнопки топбара (🛠 / 🎓 / 📊) — в прод-сборке их нет. */
const HIDE_DEV = () => {
  const marks = new Set(['🛠', '🎓', '📊']);
  const walk = (n) => {
    if (typeof n.text === 'string' && marks.has(n.text.trim())) {
      if (n.parent) n.parent.visible = false;
      return;
    }
    for (const c of n.children || []) walk(c);
  };
  walk(window.__game.app.stage);
};

/** Состояние «игрок в середине игры»: обучение позади, всё открыто и наполнено. */
const SEED = async (breeds) => {
  const g = window.__game;
  const s = g.state;
  const { emptySlot } = await import('/src/game/economy.ts');
  const { RECIPES, recipeKey } = await import('/src/genetics/recipes.ts');

  s.tutorial.done = true;
  s.coins = 42580; s.crystals = 146; s.dna = 3450;
  Object.assign(s.research, {
    r_nursery: 3, r_shelter: 2, r_food: 2, r_feed: 1,
    r_sel_markers: 1, r_sel_pairs: 2, r_sel_select: 1, r_sel_vitamins: 1,
    r_show: 2, r_collection: 1, r_offline: 1, r_adopt_coins: 1, r_adopt_dna: 1,
    r_order_dna: 1, r_lab_station: 1, r_lab_vet: 1, r_lab_boosts: 1, r_sel_cryo: 1,
  });
  s.discoveredBreeds = breeds.slice(0, 38);
  // открытые рецепты — чтобы «Стол исследований» не был пустой полкой
  s.knownRecipes = RECIPES.filter((_, i) => i % 3 === 0).slice(0, 16).map(recipeKey);
  // все три слота вязки открыты
  s.upgrades.slots = 2;
  while (s.slots.length < 3) s.slots.push(emptySlot());
  // все пять пьедесталов чемпионов открыты и заняты
  s.upgrades.championSlots = 4;
  const free = s.cats.filter((c) => c.location === 'nursery').map((c) => c.id);
  s.champions = [0, 1, 2, 3, 4].map((i) => free[i] ?? null);
  g.xp(20000); // уровень 10 — в HUD и в замках комнат всё открыто
};

async function capture(browser, v) {
  const dir = join(OUT, v.dir);
  mkdirSync(dir, { recursive: true });
  const ctx = await browser.newContext({
    viewport: { width: v.width, height: v.height },
    deviceScaleFactor: v.scale,
    hasTouch: v.touch, isMobile: v.touch,
    locale: v.lang === 'en' ? 'en-US' : 'ru-RU',
  });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => console.log('PAGEERROR:', e.message));
  await page.addInitScript((l) => {
    try { localStorage.setItem('catlab:lang', l); } catch { /* приватный режим */ }
  }, v.lang);

  const shot = async (name, waitMs = 800) => {
    await page.waitForTimeout(waitMs);
    await page.evaluate(HIDE_DEV);
    const path = join(dir, `${name}.jpg`);
    await page.screenshot({ path, type: 'jpeg', quality: 92 });
    const size = statSync(path).size;
    if (size < MIN_BYTES) throw new Error(`пустой кадр ${name} (${size} B) — рендерер отвалился`);
    console.log('  OK', v.dir, name, `${Math.round(size / 1024)} KB`);
  };

  await page.goto(`${BASE}/?reset`, { waitUntil: 'load' });
  await page.waitForSelector('canvas', { timeout: 20000 });
  await page.waitForFunction(() => window.__game?.app, null, { timeout: 20000 });
  await page.waitForTimeout(1200);
  const shown = await page.evaluate(() => document.documentElement.lang);
  if (shown !== v.lang) throw new Error(`язык не применился: ждали ${v.lang}, в документе «${shown}»`);
  await page.evaluate(() => window.__game.demo());
  await page.waitForTimeout(500);
  await page.evaluate(SEED, BREED_KEYS);
  await page.waitForTimeout(700);

  // 1 — Питомник: коты, пьедесталы чемпионов, стойка заказов
  await page.evaluate(() => { window.__game.closeOverlay(); window.__game.goRoom(1); });
  await shot('01-cattery', 1200);

  // 2 — Инкубатор: активная вязка (прогресс ~50%) и усилители
  await page.evaluate(() => { window.__game.closeOverlay(); window.__game.goRoom(0); });
  await shot('02-incubator', 900);

  // 3 — Приют: пристройство в добрые руки и биобанк
  await page.evaluate(() => { window.__game.closeOverlay(); window.__game.goRoom(2); });
  await shot('03-shelter', 900);

  // 4 — Доска заказов клиентов
  await page.evaluate(() => { window.__game.goRoom(1); window.__game.openOrders(); });
  await shot('04-orders', 800);

  // 5 — Генолаб: Котодекс (коллекция из 70 пород)
  await page.evaluate(() => { window.__game.closeOverlay(); window.__game.lab('codex'); });
  await shot('05-catdex', 900);

  // 6 — Генолаб: дерево улучшений
  await page.evaluate(() => { window.__game.closeOverlay(); window.__game.lab('research'); });
  await shot('06-upgrades', 900);

  // 7 — Генолаб: стол исследований и открытые рецепты
  await page.evaluate(() => { window.__game.closeOverlay(); window.__game.lab('recipes'); });
  await shot('07-recipes', 900);

  // 8 — Родословная до прадедов (поверх Питомника)
  await page.evaluate(() => { window.__game.closeOverlay(); window.__game.goRoom(1); });
  await page.waitForTimeout(600);
  await page.evaluate(() => window.__game.pedigreeDemo());
  await shot('08-pedigree', 800);

  // 9 — Карточка кота: берём самого редкого, здорового и свободного
  await page.evaluate((names) => {
    const g = window.__game;
    const rank = { common: 0, uncommon: 1, rare: 2, epic: 3, legendary: 4 };
    const busy = new Set(g.state.slots.flatMap((sl) => [sl.motherId, sl.fatherId, sl.kittenId]));
    const best = g.state.cats
      .filter((c) => c.location === 'nursery' && !busy.has(c.id))
      .sort((a, b) => rank[b.rarityTier] - rank[a.rarityTier])[0];
    if (!best) return;
    best.breedCount = 0; best.maxHearts = 5;
    best.name = best.genotype.sex === 'female' ? names[0] : names[1];
    g.xp(0);
    setTimeout(() => g.openCatMenu(best.id), 30);
  }, v.lang === 'en' ? ['Marquise', 'Marquis'] : ['Маркиза', 'Маркиз']);
  await shot('09-cat-card', 900);

  // 10 — Крио-банк (последним: заморозка забирает котов из комнат).
  // Подращиваем всех — заморозить можно только взрослых, иначе капсулы полупустые.
  // cryo() морозит максимум 8 котов за вызов — зовём трижды, чтобы витрина была полной
  for (let i = 0; i < 3; i++) {
    await page.evaluate(() => {
      const g = window.__game;
      const old = Date.now() - 30 * 24 * 3600 * 1000;
      for (const c of g.state.cats) c.bornAt = Math.min(c.bornAt, old);
      g.closeOverlay(); g.demo(); g.cryo();
    });
    await page.waitForTimeout(700);
  }
  await shot('10-cryobank', 1600);

  const info = await page.evaluate(() => ({
    level: window.__game.state.level,
    fps: Math.round(window.__game.app.ticker.FPS),
  }));
  console.log(` ${v.dir}: уровень ${info.level}, FPS ${info.fps}`);
  await ctx.close();
}

const run = async () => {
  const browser = await chromium.launch({ executablePath: EDGE, headless: true });
  for (const v of VARIANTS) {
    for (let attempt = 1; ; attempt++) {
      try { await capture(browser, v); break; } catch (e) {
        if (attempt >= 3) throw e;
        console.log(`  ! ${v.dir}: ${e.message} — повтор ${attempt + 1}/3`);
      }
    }
  }
  await browser.close();
  console.log('DONE ->', OUT);
};
run().catch((e) => { console.error(e); process.exit(1); });
