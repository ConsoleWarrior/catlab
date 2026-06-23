/**
 * Скриншоты игрового UI (Этап 4) через headless Edge (playwright-core).
 * Снимает 4 комнаты + панель заказов. Нужен DEV-сервер (window.__game есть
 * только в dev-сборке). Запуск:
 *   npm run dev -- --port 5199 --strictPort   (в фоне)
 *   OUT=screens BASE=http://localhost:5199 node scripts/screenshots.mjs
 */
import { chromium } from 'playwright-core';
import { mkdirSync } from 'node:fs';

const OUT = process.env.OUT || 'screens';
const BASE = process.env.BASE || 'http://localhost:5199';
const EDGE = process.env.EDGE
  || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
mkdirSync(OUT, { recursive: true });

const ROOMS = [
  ['01-incubator', 0],
  ['02-nursery', 1],
  ['03-shelter', 2],
  ['04-genolab', 3],
];

const run = async () => {
  const browser = await chromium.launch({ executablePath: EDGE, headless: true });
  const ctx = await browser.newContext({
    viewport: { width: 1280, height: 800 },
    deviceScaleFactor: 2,
  });
  const page = await ctx.newPage();
  page.on('console', (m) => console.log('PAGE:', m.type(), m.text()));
  page.on('pageerror', (e) => console.log('PAGEERROR:', e.message));

  // ?reset — свежее состояние без сохранения
  await page.goto(`${BASE}/?reset`, { waitUntil: 'load' });
  await page.waitForSelector('canvas', { timeout: 15000 });
  await page.waitForFunction(() => window.__game?.app, null, { timeout: 15000 });
  await page.waitForTimeout(800); // прогрев

  // наполняем сцену котами и активной вязкой
  await page.evaluate(() => window.__game.demo());
  await page.waitForTimeout(500);

  for (const [name, idx] of ROOMS) {
    await page.evaluate((i) => window.__game.goRoom(i), idx);
    await page.waitForTimeout(700); // доезд + перерисовка
    await page.screenshot({ path: `${OUT}/${name}.png` });
  }

  // панель заказов поверх питомника
  await page.evaluate(() => window.__game.goRoom(1));
  await page.waitForTimeout(500);
  await page.evaluate(() => window.__game.openOrders());
  await page.waitForTimeout(500);
  await page.screenshot({ path: `${OUT}/05-orders.png` });

  const fps = await page.evaluate(() => Math.round(window.__game.app.ticker.FPS));
  console.log('FPS:', fps);

  await browser.close();
};
run().catch((e) => { console.error(e); process.exit(1); });
