/**
 * Скриншоты игрового UI (Этап 4) через headless Edge (playwright-core).
 * Снимает комнаты, заказы и инструкцию в двух размерах: ПК и мобильный
 * ландшафт — проверяем, что один интерфейс адаптируется под обе ширины.
 * Нужен DEV-сервер (window.__game есть только в dev-сборке):
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
  ['incubator', 0],
  ['nursery', 1],
  ['shelter', 2],
  ['genolab', 3],
];

async function shoot(browser, { width, height, prefix }) {
  const ctx = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: 2 });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => console.log('PAGEERROR:', e.message));

  await page.goto(`${BASE}/?reset`, { waitUntil: 'load' });
  await page.waitForSelector('canvas', { timeout: 15000 });
  await page.waitForFunction(() => window.__game?.app, null, { timeout: 15000 });
  await page.waitForTimeout(700);
  await page.evaluate(() => window.__game.demo());
  await page.waitForTimeout(400);

  for (const [name, idx] of ROOMS) {
    await page.evaluate((i) => { window.__game.closeOverlay(); window.__game.goRoom(i); }, idx);
    await page.waitForTimeout(650);
    await page.screenshot({ path: `${OUT}/${prefix}-${name}.png` });
  }

  await page.evaluate(() => { window.__game.goRoom(1); window.__game.openOrders(); });
  await page.waitForTimeout(450);
  await page.screenshot({ path: `${OUT}/${prefix}-orders.png` });

  await page.evaluate(() => window.__game.openHelp());
  await page.waitForTimeout(450);
  await page.screenshot({ path: `${OUT}/${prefix}-help.png` });

  const fps = await page.evaluate(() => Math.round(window.__game.app.ticker.FPS));
  console.log(`${prefix} ${width}x${height} FPS:`, fps);
  await ctx.close();
}

const run = async () => {
  const browser = await chromium.launch({ executablePath: EDGE, headless: true });
  await shoot(browser, { width: 1280, height: 800, prefix: 'pc' });
  await shoot(browser, { width: 812, height: 375, prefix: 'mob' }); // мобильный ландшафт
  await browser.close();
};
run().catch((e) => { console.error(e); process.exit(1); });
