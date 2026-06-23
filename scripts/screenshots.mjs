/**
 * Скриншоты прототипа через headless Edge (playwright-core, без скачивания Chromium).
 * Запуск: подними `npm run preview` (или dev), затем:
 *   OUT=путь BASE=http://127.0.0.1:4173 node scripts/screenshots.mjs
 */
import { chromium } from 'playwright-core';
import { mkdirSync } from 'node:fs';

const OUT = process.env.OUT || 'screens';
const BASE = process.env.BASE || 'http://127.0.0.1:4173';
const EDGE = process.env.EDGE
  || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
mkdirSync(OUT, { recursive: true });

const run = async () => {
  const browser = await chromium.launch({ executablePath: EDGE, headless: true });
  const ctx = await browser.newContext({
    viewport: { width: 1280, height: 800 },
    deviceScaleFactor: 2,
  });
  const page = await ctx.newPage();
  page.on('console', (m) => console.log('PAGE:', m.type(), m.text()));
  page.on('pageerror', (e) => console.log('PAGEERROR:', e.message));

  const W = 1280, H = 800;
  await page.goto(BASE, { waitUntil: 'load' });
  await page.waitForSelector('canvas', { timeout: 15000 });
  await page.waitForTimeout(700);
  await page.screenshot({ path: `${OUT}/01-start.png` });

  // взять «маму» за шкирку и подержать на весу (поза hang)
  await page.mouse.move(W * 0.30, H * 0.32);
  await page.mouse.down();
  await page.mouse.move(W * 0.5, H * 0.5, { steps: 10 });
  await page.waitForTimeout(450);
  await page.screenshot({ path: `${OUT}/04-hang.png` });
  await page.mouse.up();
  await page.waitForTimeout(500);

  await page.click('#btn-breed');
  await page.waitForTimeout(800);
  await page.screenshot({ path: `${OUT}/02-kitten.png` });

  await page.click('#btn-stress');
  await page.waitForTimeout(1800);
  await page.screenshot({ path: `${OUT}/03-stress.png` });

  const fps = await page.evaluate(() => document.getElementById('fps')?.textContent);
  console.log('FPS readout:', fps);

  await browser.close();
};
run().catch((e) => { console.error(e); process.exit(1); });
