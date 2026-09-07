/**
 * Промо-видео геймплея для Яндекс Игр (поле «Горизонтальное видео» в черновике).
 * Требования площадки: 16:9, MP4, высота от 400 px, до 28 секунд, до 100 МБ;
 * не менее 70% продолжительности — реальный геймплей (пункт 5.1.1.3).
 *
 * Пишет один непрерывный дубль настоящими кликами и перетаскиваниями:
 * карточка кота → слот вязки → «Свести» → рождение малыша → заказ клиента → Котодекс.
 * Курсор рисуется своим (запись экрана системный курсор не снимает).
 *
 * Нужен DEV-сервер (window.__game есть только в dev-сборке):
 *   npx vite --port 5199 --strictPort
 *   node scripts/gameplay_video.mjs          # запись + сборка MP4
 *   DRY=1 node scripts/gameplay_video.mjs    # прогон со скриншотами, без записи
 */
import { chromium } from 'playwright-core';
import { mkdirSync, readFileSync, readdirSync, rmSync, statSync } from 'node:fs';
import { execFileSync, spawnSync } from 'node:child_process';
import { join } from 'node:path';

const BASE = process.env.BASE || 'http://localhost:5199';
const OUT = process.env.OUT || 'video';
const EDGE = process.env.EDGE
  || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const FFMPEG = process.env.FFMPEG
  || 'C:/Users/Oleg PK SSD/AppData/Local/Microsoft/WinGet/Packages/Gyan.FFmpeg_Microsoft.Winget.Source_8wekyb3d8bbwe/ffmpeg-8.1.2-full_build/bin/ffmpeg.exe';
const DRY = !!process.env.DRY;
// Кадр записи: 1280x720 — минимальное разрешение площадки для 16:9. В 1080p
// VP8-кодировщик headless-браузера не успевает за сценой и растягивает запись вдвое.
const W = 1280, H = 720;
const LIMIT = 27.8;    // предел площадки — 28 с, берём с запасом
const TITLE_AT = 24.8; // на этой секунде дубля включается титр — 3 с оформления из 28
// Фоновая музыка игры (Pixabay Content License — коммерческое использование
// разрешено, атрибуция не требуется). MUSIC=0 — записать без звука.
const MUSIC = process.env.MUSIC === '0' ? null : (process.env.MUSIC
  || 'src/assets/sounds/background/samuelfjohanns-aeolian-futuristics-music-from-the-freakn-future-01-119831.mp3');

mkdirSync(OUT, { recursive: true });
const RAW = join(OUT, 'raw');
rmSync(RAW, { recursive: true, force: true });
mkdirSync(RAW, { recursive: true });

const BREED_KEYS = [...readFileSync('src/genetics/catalog.ts', 'utf8')
  .matchAll(/^\s*\['([a-z0-9_]+)',/gm)].map((m) => m[1]);

// ─────────────────────────── подготовка страницы ───────────────────────────

/** Состояние «игрок в середине игры» — тот же сид, что у витринных скриншотов. */
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
  s.knownRecipes = RECIPES.filter((_, i) => i % 3 === 0).slice(0, 16).map(recipeKey);
  s.upgrades.slots = 2;
  while (s.slots.length < 3) s.slots.push(emptySlot());
  s.slots = s.slots.map(() => emptySlot()); // пару в кадре игрок соберёт сам
  s.upgrades.championSlots = 4;
  const free = s.cats.filter((c) => c.location === 'nursery').map((c) => c.id);
  s.champions = [0, 1, 2, 3, 4].map((i) => free[i] ?? null);
  // пьедесталы забрали почти весь Питомник — доселяем котов из Приюта, чтобы
  // комната была живой и в кадре нашлась пара разного пола
  const onStand = new Set(s.champions);
  const guests = s.cats.filter((c) => c.location === 'shelter' && !onStand.has(c.id));
  for (const sex of ['female', 'male']) {
    guests.filter((c) => c.genotype.sex === sex).slice(0, 3).forEach((c) => { c.location = 'nursery'; });
  }
  g.xp(20000);
};

/** DEV-кнопки топбара (🛠 🎓 📊) в прод-сборке отсутствуют — прячем их навсегда. */
const HIDE_DEV_LOOP = () => {
  const marks = new Set(['🛠', '🎓', '📊']);
  const hide = () => {
    const walk = (n) => {
      if (typeof n.text === 'string' && marks.has(n.text.trim())) {
        if (n.parent) n.parent.visible = false;
        return;
      }
      for (const c of n.children || []) walk(c);
    };
    try { walk(window.__game.app.stage); } catch { /* сцена пересобирается */ }
  };
  hide();
  window.__hideDev = setInterval(hide, 250);
};

/** Экранные координаты надписи по подстроке (мир — лента комнат, берём то, что в кадре). */
const FIND = (needle) => {
  const hits = [];
  const walk = (n) => {
    if (typeof n.text === 'string' && n.text.includes(needle)) {
      const b = n.getBounds();
      const x = Math.round(b.x + b.width / 2), y = Math.round(b.y + b.height / 2);
      if (x > 0 && x < window.innerWidth && y > 0 && y < window.innerHeight) x && hits.push({ x, y });
    }
    for (const c of n.children || []) walk(c);
  };
  walk(window.__game.app.stage);
  return hits;
};

/**
 * Коты на полу Питомника, ближние (крупные) первыми, с полом и готовностью к вязке.
 *
 * Пол нужен, чтобы собрать в одной капсуле пару: кнопка «В свободный слот вязки»
 * сажает кота на место своего пола, и два самца уедут в разные капсулы. По подписи
 * над котом пол не определить — она прячется, когда наезжает на подпись соседа,
 * поэтому спрайт связываем с состоянием игры по имени породы в текстуре
 * (`<breed>__<n>.webp`). Породы-двойники в комнате помечаем '?' и не трогаем.
 */
const FLOOR_CATS = async () => {
  const g = window.__game;
  const { isAdult } = await import('/src/game/economy.ts');
  const now = Date.now();
  const here = g.state.cats.filter((c) => c.location === 'nursery');
  const sexOf = new Map();
  for (const c of here) {
    const sex = isAdult(c, now) ? (c.genotype.sex === 'female' ? 'f' : 'm') : 'kid';
    sexOf.set(c.breed, sexOf.has(c.breed) && sexOf.get(c.breed) !== sex ? '?' : sex);
  }
  const out = [];
  const walk = (n) => {
    const src = n?.texture?.source?.label || '';
    if (typeof src === 'string' && /cats|breeds/i.test(src)) {
      const b = n.getBounds();
      const x = Math.round(b.x + b.width / 2), y = Math.round(b.y + b.height / 2);
      // пьедесталы чемпионов стоят у стены (выше по экрану) — берём только пол;
      // пороги в долях кадра, чтобы не зависеть от разрешения записи
      const vw = window.innerWidth, vh = window.innerHeight;
      if (x > vw * 0.03 && x < vw * 0.8 && y > vh * 0.55 && b.width > vw * 0.055) {
        const breed = src.split('/').pop().split('__')[0];
        out.push({ x, y, w: Math.round(b.width), breed, sex: sexOf.get(breed) ?? '?' });
      }
    }
    for (const c of n.children || []) walk(c);
  };
  walk(g.app.stage);
  return out.sort((a, b) => b.w - a.w);
};

/**
 * Кот на полу, которого примет клиент: сцена с заказом должна сойтись с первого раза.
 * Ищем спрайт кота, подходящего хоть под один заказ доски (matchesOrder — порода
 * плюс минимальная редкость). Если на полу такого нет (пара как раз уехала в
 * капсулу), подгоняем требование первого заказа под ближайшего кота — доска в этот
 * момент закрыта, а выдача дальше идёт по обычным правилам игры.
 */
const ORDER_TARGET = async () => {
  const g = window.__game;
  const { matchesOrder } = await import('/src/game/orders.ts');
  const { isAdult } = await import('/src/game/economy.ts');
  const now = Date.now();
  const byBreed = new Map();
  for (const c of g.state.cats) {
    if (c.location === 'nursery' && isAdult(c, now) && !byBreed.has(c.breed)) byBreed.set(c.breed, c);
  }
  const sprites = [];
  const vw = window.innerWidth, vh = window.innerHeight;
  const walk = (n) => {
    const src = n?.texture?.source?.label || '';
    if (typeof src === 'string' && /cats|breeds/i.test(src)) {
      const b = n.getBounds();
      const x = Math.round(b.x + b.width / 2), y = Math.round(b.y + b.height / 2);
      if (x > vw * 0.03 && x < vw * 0.8 && y > vh * 0.55 && b.width > vw * 0.055) {
        sprites.push({ x, y, w: b.width, breed: src.split('/').pop().split('__')[0] });
      }
    }
    for (const c of n.children || []) walk(c);
  };
  walk(g.app.stage);
  sprites.sort((a, b) => b.w - a.w);
  for (const s of sprites) {
    const cat = byBreed.get(s.breed);
    if (cat && g.state.orders.some((o) => matchesOrder(o, cat))) {
      return { x: s.x, y: s.y, breed: s.breed, tuned: false };
    }
  }
  const first = sprites.find((s) => byBreed.has(s.breed));
  if (!first) return null;
  g.state.orders[0].req = { breed: byBreed.get(first.breed).breed };
  return { x: first.x, y: first.y, breed: first.breed, tuned: true };
};

/**
 * В переноску мог заехать не тот кот, на которого целились (коты ходят). Кнопка
 * «Выполнить» появляется только у подходящего заказа, поэтому сверяем корзину с
 * доской и, если никто не подходит, подгоняем требование заказа под этого кота.
 * Возвращает false, если корзина пуста — тогда перетаскивание надо повторить.
 */
const ENSURE_ORDER = async () => {
  const g = window.__game;
  const { matchesOrder } = await import('/src/game/orders.ts');
  const cat = g.state.cats.find((c) => c.id === g.state.orderBasket);
  if (!cat) return false;
  if (!g.state.orders.some((o) => matchesOrder(o, cat))) g.state.orders[0].req = { breed: cat.breed };
  return true;
};

/** Рисованный курсор + чёрная «хлопушка» для точной обрезки записи. */
const OVERLAY = () => {
 const build = () => {
  const cur = document.createElement('div');
  cur.id = '__cursor';
  cur.style.cssText = 'position:fixed;left:-100px;top:-100px;width:46px;height:46px;pointer-events:none;'
    + 'z-index:99998;background:url("data:image/svg+xml;utf8,'
    + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="46" height="46" viewBox="0 0 46 46">'
      + '<path d="M9 5 L9 34 L16.5 26.5 L22 38 L28 35 L22.5 24 L33 23 Z" fill="#fff" stroke="#1b1b1b" stroke-width="2.5" stroke-linejoin="round"/></svg>')
    + '") no-repeat;';
  document.body.appendChild(cur);
  document.addEventListener('mousemove', (e) => {
    cur.style.left = `${e.clientX - 5}px`;
    cur.style.top = `${e.clientY - 4}px`;
  }, true);

  const veil = document.createElement('div');
  veil.id = '__veil';
  veil.style.cssText = 'position:fixed;inset:0;background:#000;z-index:99999;pointer-events:none;opacity:1;';
  document.body.appendChild(veil);
  window.__veil = {
    // чёрный экран до старта сценария: по нему ffmpeg найдёт точку монтажной склейки
    open: () => { veil.style.transition = 'opacity .25s linear'; veil.style.opacity = '0'; },
    close: () => { veil.style.transition = 'opacity .35s linear'; veil.style.opacity = '1'; },
  };
 };
 if (document.body) build();
 else window.addEventListener('DOMContentLoaded', build);
};

/** Финальный титр: название игры (оформление, ≤30% хронометража). */
const TITLE_CARD = () => {
  const cur = document.getElementById('__cursor');
  if (cur) cur.style.display = 'none';
  const card = document.createElement('div');
  card.style.cssText = 'position:fixed;inset:0;z-index:99997;display:flex;flex-direction:column;'
    + 'align-items:center;justify-content:center;gap:1.4vw;opacity:0;transition:opacity .5s linear;'
    // палитра игры: кремовый фон COLORS.bg и тёплый тёмный COLORS.ink
    + 'background:radial-gradient(circle at 50% 45%, #fffaf3 0%, #fdf3e7 55%, #f7ddc6 100%);'
    + 'font-family:system-ui,"Segoe UI",sans-serif;';
  card.innerHTML = '<div style="font-size:7.5vw;font-weight:800;color:#5a4a42;letter-spacing:-1px;'
    + 'text-shadow:0 3px 0 rgba(255,255,255,.7)">Котолаборатория</div>'
    + '<div style="font-size:3.1vw;font-weight:600;color:#8a7268">разводи котиков — открывай породы</div>';
  document.body.appendChild(card);
  requestAnimationFrame(() => { card.style.opacity = '1'; });
};

// ─────────────────────────────── сценарий ───────────────────────────────

const run = async () => {
  const browser = await chromium.launch({
    executablePath: EDGE, headless: true,
    args: ['--autoplay-policy=no-user-gesture-required', '--force-device-scale-factor=1'],
  });
  const ctx = await browser.newContext({
    viewport: { width: W, height: H },
    ...(DRY ? {} : { recordVideo: { dir: RAW, size: { width: W, height: H } } }),
  });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => console.log('PAGEERROR:', e.message));
  await page.addInitScript(OVERLAY);

  // ── хелперы управления «руками игрока»
  const marks = [];
  let t0 = 0;
  const mark = (name) => marks.push([name, ((Date.now() - t0) / 1000).toFixed(1)]);
  let cur = { x: W / 2, y: H / 2 };
  const wait = (ms) => page.waitForTimeout(ms);

  /** Плавный подвод курсора: ease-in-out, скорость как у живой руки. */
  const moveTo = async (x, y, ms = 500) => {
    const steps = Math.max(6, Math.round(ms / 16));
    const { x: sx, y: sy } = cur;
    for (let i = 1; i <= steps; i++) {
      const p = i / steps;
      const e = p < 0.5 ? 2 * p * p : 1 - (-2 * p + 2) ** 2 / 2;
      await page.mouse.move(sx + (x - sx) * e, sy + (y - sy) * e);
      await wait(16);
    }
    cur = { x, y };
  };
  const clickAt = async (x, y, ms = 500) => {
    await moveTo(x, y, ms);
    await wait(120);
    await page.mouse.down(); await wait(70); await page.mouse.up();
  };
  /** Клик по надписи (кнопке) — ищем по подстроке в текущем кадре. */
  const clickText = async (needle, ms = 500) => {
    const hits = await page.evaluate(FIND, needle);
    if (!hits.length) throw new Error(`не нашёл на экране: «${needle}»`);
    const { x, y } = hits[hits.length - 1];
    await clickAt(x, y, ms);
    return { x, y };
  };
  /**
   * Клик по коту нужного пола. Коты ходят, поэтому целимся дважды: сначала ведём
   * курсор к текущей позиции, потом коротко доводим по свежей — и проверяем по
   * открывшейся карточке, что попали в кота нужного пола (иначе закрываем и берём
   * следующего). Заодно это красиво в кадре: курсор «догоняет» котика.
   */
  const CARD_SEX = () => {
    let sex = null;
    const walk = (n) => {
      if (typeof n.text === 'string' && n.text.startsWith('пол:')) {
        sex = n.text.includes('самка') ? 'f' : 'm';
      }
      for (const c of n.children || []) walk(c);
    };
    walk(window.__game.app.stage);
    return sex;
  };
  const openCatCard = async (sex, approach = 700) => {
    for (let tries = 0; tries < 4; tries++) {
      const list = await page.evaluate(FLOOR_CATS);
      const want = list.filter((c) => c.sex === sex);
      if (!want.length) throw new Error(`на полу нет кота с полом ${sex}`);
      const target = want[tries % want.length];
      await moveTo(target.x, target.y, approach);
      const fresh = (await page.evaluate(FLOOR_CATS)).find((c) => c.breed === target.breed);
      if (fresh) await moveTo(fresh.x, fresh.y, 200);
      await wait(90);
      await page.mouse.down(); await wait(70); await page.mouse.up();
      await wait(700);
      const got = await page.evaluate(CARD_SEX);
      if (got === sex) return true;
      if (got) { await clickText('Закрыть', 350); await wait(500); } // не тот кот — закрываем
      approach = 450;
    }
    throw new Error(`не удалось открыть карточку кота (${sex})`);
  };

  const drag = async (from, to, ms = 800) => {
    await moveTo(from.x, from.y, 450);
    await wait(120);
    await page.mouse.down();
    const steps = Math.max(8, Math.round(ms / 24));
    for (let i = 1; i <= steps; i++) {
      const p = i / steps;
      const e = p < 0.5 ? 2 * p * p : 1 - (-2 * p + 2) ** 2 / 2;
      await page.mouse.move(from.x + (to.x - from.x) * e, from.y + (to.y - from.y) * e);
      await wait(24);
    }
    cur = { ...to };
    await wait(160);
    await page.mouse.up();
  };
  const shot = async (name) => { if (DRY) await page.screenshot({ path: join(OUT, `dry-${name}.png`) }); };

  // ── загрузка и подготовка сцены (под чёрной вуалью, в кадр не попадёт)
  await page.goto(`${BASE}/?reset`, { waitUntil: 'load' });
  await page.waitForSelector('canvas', { timeout: 30000 });
  await page.waitForFunction(() => window.__game?.app, null, { timeout: 30000 });
  await wait(1500);
  await page.evaluate(() => window.__game.demo());
  await wait(500);
  await page.evaluate(SEED, BREED_KEYS);
  await wait(600);
  await page.evaluate(HIDE_DEV_LOOP);
  // без vsync headless крутит тикер на 240 fps: кодировщик записи за ним не успевает
  await page.evaluate(() => { window.__game.app.ticker.maxFPS = 60; });
  await page.evaluate(() => { window.__game.closeOverlay(); window.__game.goRoom(1); });
  await wait(1400);

  // ═════════ дубль пошёл ═════════
  t0 = Date.now();
  await page.evaluate(() => window.__veil.open());
  await wait(700);
  mark('старт · Питомник');

  // 1. Питомник: живая комната, курсор скользит по котам
  await moveTo(W * 0.43, H * 0.70, 600);

  // 2. Карточка кошки → «В свободный слот вязки» (мать)
  console.log('коты на полу:', JSON.stringify(await page.evaluate(FLOOR_CATS)));
  await openCatCard('f', 500);
  await shot('01-card');
  mark('карточка кошки');
  await clickText('слот вязки', 400);
  await wait(600); // игра сама уводит в Инкубатор
  mark('мать в слоте');
  await shot('02-parent1');

  // 3. Отец — кот другого пола встаёт в ту же капсулу, пара собрана
  await page.evaluate(() => { window.__game.closeOverlay(); window.__game.goRoom(1); });
  await wait(550);
  await openCatCard('m', 450);
  await shot('03-card2');
  await clickText('слот вязки', 400);
  await wait(650);
  mark('отец в слоте');
  await shot('03-parent2');

  // 4. Инкубатор: «Свести» — вязка пошла
  await page.evaluate(() => { window.__game.closeOverlay(); window.__game.goRoom(0); });
  await wait(650);
  await shot('04-incubator');
  await clickText('Свести', 450);
  await wait(800);
  mark('вязка запущена');
  await shot('05-breeding');

  // 5. Малыш родился: доводим таймер слота до конца — игра сама показывает рождение
  await page.evaluate(() => {
    const g = window.__game;
    const s = g.state.slots.find((sl) => sl.readyAt && !sl.kittenId);
    if (s) s.readyAt = Date.now() - 1500;
  });
  await wait(1300);
  await shot('06-born');
  mark('малыш родился');
  await clickText('В питомник', 450);
  await wait(600);
  mark('малыш в питомнике');

  // 6. Заказ клиента: тащим кота в переноску и выдаём награду
  await page.evaluate(() => { window.__game.closeOverlay(); window.__game.goRoom(1); });
  await wait(600);
  const carrier = (await page.evaluate(FIND, 'перетащи'))[0] || { x: W * 0.9, y: H * 0.29 };
  let inBasket = false;
  for (let tries = 0; tries < 3 && !inBasket; tries++) {
    const wanted = await page.evaluate(ORDER_TARGET);
    if (!wanted) throw new Error('на полу нет взрослого кота для заказа');
    if (!tries) console.log('кот под заказ:', JSON.stringify(wanted));
    await moveTo(wanted.x, wanted.y, tries ? 300 : 450);
    // кот успел уйти, пока ехал курсор — довернём по свежей позиции
    const fresh = (await page.evaluate(FLOOR_CATS)).find((c) => c.breed === wanted.breed);
    await drag({ x: fresh?.x ?? wanted.x, y: fresh?.y ?? wanted.y }, carrier, 650);
    await wait(250);
    inBasket = await page.evaluate(ENSURE_ORDER);
  }
  if (!inBasket) throw new Error('кот не доехал до переноски');
  mark('кот в переноске');
  await shot('07-carrier');
  await clickText('Заказы клиентов', 450);
  await wait(700);
  await shot('08-orders');
  await clickText('Выполнить', 450);
  await wait(800);
  await shot('08b-reward');
  mark('заказ выполнен');

  // 7. Генолаб: Котодекс — коллекция пород
  await page.evaluate(() => { window.__game.closeOverlay(); window.__game.lab('codex'); });
  await wait(750);
  await shot('09-codex');
  await moveTo(W / 2, H * 0.65, 500);
  await wait(400);
  mark('котодекс');

  // 7б. Вкладка «Улучшения» — дерево прокачки лаборатории
  await clickText('Улучшения', 450);
  await wait(900);
  await shot('10-upgrades');
  mark('улучшения');

  // 8. Титр: ставим его так, чтобы дубль уложился ровно в 28 секунд
  const left = TITLE_AT * 1000 - (Date.now() - t0);
  if (left > 0) await wait(left); else console.log('! сцены переполнили хронометраж на', -left, 'мс');
  await page.evaluate(TITLE_CARD);
  await wait(2600);
  mark('титр');
  await page.evaluate(() => window.__veil.close());
  await wait(500);
  mark('конец дубля');

  console.log('\nхронометраж:');
  for (const [n, t] of marks) console.log(`  ${t.padStart(5)}s  ${n}`);

  await ctx.close();
  await browser.close();

  if (DRY) { console.log('\nDRY: запись не велась, скриншоты в', OUT); return; }

  // ── сборка MP4: режем всё до конца стартовой черноты, кодируем H.264
  const webm = join(RAW, readdirSync(RAW).find((f) => f.endsWith('.webm')));
  // Запись начинается вместе с контекстом, поэтому её начало — это загрузка игры под
  // чёрной вуалью. Конец последнего чёрного участка и есть первый кадр дубля.
  // Отчёт blackdetect ffmpeg пишет в stderr, а не в stdout.
  const probe = spawnSync(FFMPEG, ['-i', webm, '-vf', 'blackdetect=d=0.3:pic_th=0.98', '-f', 'null', '-'],
    { encoding: 'utf8' }).stderr || '';
  const blacks = [...probe.matchAll(/black_start:([\d.]+) black_end:([\d.]+)/g)].map((m) => +m[2]);
  const start = blacks.length ? blacks[0] + 0.35 : 0; // +0.35 с — переждать затемнение
  console.log('\nконец стартовой черноты:', start.toFixed(2), 'с');
  if (!blacks.length) console.log('! чёрной хлопушки не нашлось — режу с начала записи');
  const mp4 = join(OUT, 'gameplay-16x9.mp4');
  const video = ['-c:v', 'libx264', '-preset', 'slow', '-crf', '20', '-pix_fmt', 'yuv420p'];
  const args = MUSIC
    ? ['-y', '-v', 'error', '-ss', String(start), '-i', webm, '-i', MUSIC, '-t', String(LIMIT),
      '-filter_complex', `[0:v]fps=30,scale=${W}:${H}:flags=lanczos[v];`
        + `[1:a]afade=t=in:st=0:d=1,afade=t=out:st=${LIMIT - 1.5}:d=1.5,volume=0.55[a]`,
      '-map', '[v]', '-map', '[a]', ...video, '-c:a', 'aac', '-b:a', '128k',
      '-movflags', '+faststart', mp4]
    : ['-y', '-v', 'error', '-ss', String(start), '-i', webm, '-t', String(LIMIT),
      '-vf', `fps=30,scale=${W}:${H}:flags=lanczos`, ...video, '-movflags', '+faststart', mp4];
  execFileSync(FFMPEG, args);
  // ffmpeg без выходного файла всегда возвращает код 1 — читаем отчёт из ошибки
  let info = '';
  try { info = execFileSync(FFMPEG, ['-i', mp4], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }); }
  catch (e) { info = e.stderr || ''; }
  console.log(info.split('\n').filter((l) => /Duration|Stream #/.test(l)).join('\n').trim());
  console.log('вес:', (statSync(mp4).size / 1024 / 1024).toFixed(1), 'МБ (предел 100 МБ)');
  console.log('\nГОТОВО ->', mp4);
};

run().catch((e) => { console.error(e); process.exit(1); });
