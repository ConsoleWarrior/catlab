/**
 * Слой 2 аудита под Яндекс Игры: прогон ПРОД-сборки в браузере на четырёх
 * пропорциях, где обычно ломается вёрстка (пп. 1.10.1–1.10.4, 1.6.2.2).
 *
 * Что собирается: ошибки консоли и страницы (п. 6.4 — при открытых DevTools
 * ошибок быть не должно), список внешних доменов (п. 4.1 — наружу только SDK),
 * время готовности игры и скриншот каждого разрешения.
 *
 *   npx vite preview --port 5200 --strictPort
 *   node scripts/yandex_browser_check.mjs
 *
 * Скриншоты кладутся в screens/yandex/.
 */
import { chromium } from 'playwright-core';
import { mkdirSync } from 'node:fs';

const BASE = process.env.BASE || 'http://localhost:5200';
const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const OUT = 'screens/yandex';

const VIEWS = [
  { name: 'mobile-portrait', width: 360, height: 800, mobile: true },
  { name: 'mobile-landscape', width: 800, height: 360, mobile: true },
  { name: 'desktop', width: 1366, height: 768, mobile: false },
  { name: 'wide', width: 2560, height: 1080, mobile: false },
];

mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch({ executablePath: EDGE, headless: true });
let bad = 0;

for (const v of VIEWS) {
  const ctx = await browser.newContext({
    viewport: { width: v.width, height: v.height },
    deviceScaleFactor: v.mobile ? 2 : 1, isMobile: v.mobile, hasTouch: v.mobile,
  });
  const page = await ctx.newPage();
  const errs = [];
  const hosts = new Set();
  const warns = [];
  page.on('console', (m) => {
    if (m.type() === 'error') errs.push(m.text());
    else if (m.type() === 'warning') warns.push(m.text());
  });
  page.on('pageerror', (e) => errs.push(`pageerror: ${e.message}`));
  page.on('request', (r) => { try { hosts.add(new URL(r.url()).host); } catch { /* data: */ } });

  await page.goto(BASE + '/', { waitUntil: 'commit' });
  const ready = await page.waitForFunction(
    () => performance.getEntriesByName('catlab:ready')[0]?.startTime ?? null,
    null, { timeout: 120_000, polling: 100 },
  ).then((h) => h.jsonValue()).catch(() => null);

  await page.waitForTimeout(4000); // фоновая догрузка арта + первые кадры
  await page.screenshot({ path: `${OUT}/${v.name}.png` });

  const noisy = errs.filter((e) => !/favicon|sdk\.js|Failed to load resource.*404/i.test(e));
  const ext = [...hosts].filter((h) => !h.startsWith('localhost'));
  console.log(`\n[${v.name}] ${v.width}×${v.height}`);
  console.log(`  готовность: ${ready === null ? 'НЕ ДОЖДАЛИСЬ' : (ready / 1000).toFixed(2) + ' с'}`);
  // Отказ по п. 6.4 дают ОШИБКИ. Предупреждения показываем отдельно: часть из них
  // не наша (сообщение самого sdk.js вне фрейма площадки, автоплей звука до жеста).
  console.log(`  ошибки консоли: ${noisy.length ? 'ЕСТЬ (' + noisy.length + ')' : 'нет'}`);
  noisy.slice(0, 6).forEach((e) => console.log('    ' + e.slice(0, 160)));
  console.log(`  предупреждения: ${warns.length || 'нет'}`);
  warns.slice(0, 4).forEach((e) => console.log('    ~ ' + e.slice(0, 120)));
  console.log(`  внешние домены: ${ext.length ? ext.join(', ') : 'нет (только свои файлы)'}`);
  if (noisy.length || ready === null) bad++;
  await ctx.close();
}

await browser.close();
console.log(`\nИтог: проблемных разрешений ${bad} из ${VIEWS.length}. Скриншоты — ${OUT}/`);
process.exit(bad ? 1 : 0);
