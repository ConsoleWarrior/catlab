/**
 * Замер времени первой загрузки игры (то, что видит игрок на портале как лоадер).
 *
 * Меряется от начала навигации до метки `catlab:ready` — момента, когда игра
 * зовёт LoadingAPI.ready() и портал убирает свой лоадер (см. src/platform/ysdk.ts).
 * Заодно считается, сколько байт и запросов игра успевает утянуть ДО этой метки:
 * именно они и есть «критический путь» загрузки, всё остальное догружается фоном.
 *
 *   node scripts/loadtime.mjs                 # профиль 4g (по умолчанию)
 *   NET=3g node scripts/loadtime.mjs          # медленный мобильный интернет
 *   NET=none node scripts/loadtime.mjs        # без ограничения канала
 *   BASE=http://localhost:5200 node scripts/loadtime.mjs
 *
 * Перед запуском нужен поднятый прод-препросмотр: npx vite preview --port 5200
 */
import { chromium } from 'playwright-core';

const BASE = process.env.BASE || 'http://localhost:5200';
const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const NET = process.env.NET || '4g';

// Профили канала: близко к тому, что даёт мобильный интернет в городе.
const NETS = {
  none: null,
  '4g': { downloadThroughput: (8 * 1024 * 1024) / 8, uploadThroughput: (2 * 1024 * 1024) / 8, latency: 60 },
  '3g': { downloadThroughput: (1.6 * 1024 * 1024) / 8, uploadThroughput: (750 * 1024) / 8, latency: 150 },
};

const browser = await chromium.launch({ executablePath: EDGE, headless: true });
const ctx = await browser.newContext({
  viewport: { width: 812, height: 375 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true,
});
const page = await ctx.newPage();
page.on('pageerror', (e) => console.log('PAGEERROR:', e.message));

const cdp = await ctx.newCDPSession(page);
await cdp.send('Network.enable');
if (NETS[NET]) {
  await cdp.send('Network.emulateNetworkConditions', { offline: false, ...NETS[NET] });
}
// Кэш выключен: нас интересует именно ПЕРВЫЙ заход игрока.
await cdp.send('Network.setCacheDisabled', { cacheDisabled: true });

const started = Date.now();
const reqs = new Map(); // requestId → { url, bytes, doneAt }
cdp.on('Network.requestWillBeSent', (e) => {
  reqs.set(e.requestId, { url: e.request.url, bytes: 0, doneAt: 0 });
});
cdp.on('Network.loadingFinished', (e) => {
  const r = reqs.get(e.requestId);
  if (r) { r.bytes = e.encodedDataLength; r.doneAt = Date.now() - started; }
});

// Картинки Pixi тянет из воркера (createImageBitmap), и в Network-события
// страницы они не попадают — их ловим отдельно, событиями Playwright.
const wreqs = [];
page.on('requestfinished', async (req) => {
  const sizes = await req.sizes().catch(() => null);
  wreqs.push({ url: req.url(), bytes: sizes ? sizes.responseBodySize + sizes.responseHeadersSize : 0,
    doneAt: Date.now() - started });
});

await page.goto(BASE + '/', { waitUntil: 'commit' });

// Ждём метку готовности (её ставит loadingReady). Таймаут щедрый: на 3g загрузка
// «всё сразу» легко переваливает за минуту — это и есть предмет замера.
const ready = await page.waitForFunction(
  () => performance.getEntriesByName('catlab:ready')[0]?.startTime ?? null,
  null, { timeout: 180_000, polling: 100 },
).then((h) => h.jsonValue());

// Даём фоновой догрузке доиграть, чтобы посчитать полный вес.
await page.waitForTimeout(1500);
await page.waitForLoadState('networkidle').catch(() => {});

const seen = new Set([...reqs.values()].map((r) => r.url));
const all = [...reqs.values()].filter((r) => r.doneAt > 0)
  .concat(wreqs.filter((r) => !seen.has(r.url)));
const before = all.filter((r) => r.doneAt <= ready + 150);
const kind = (u) => (u.endsWith('.webp') ? 'webp' : u.endsWith('.mp3') ? 'mp3'
  : u.endsWith('.js') ? 'js' : u.endsWith('/') || u.endsWith('.html') ? 'html' : 'прочее');
const sum = (list) => list.reduce((t, r) => t + r.bytes, 0);
const group = (list) => {
  const m = {};
  for (const r of list) { const k = kind(r.url); m[k] = m[k] || { n: 0, b: 0 }; m[k].n++; m[k].b += r.bytes; }
  return Object.entries(m).sort((a, b) => b[1].b - a[1].b)
    .map(([k, v]) => `${k}: ${v.n} шт / ${(v.b / 1048576).toFixed(2)} МБ`).join(', ');
};

console.log(`\n=== Загрузка (канал ${NET}, кэш пустой) ===`);
console.log(`Игра готова к игроку:      ${(ready / 1000).toFixed(2)} с`);
console.log(`До готовности загружено:   ${before.length} запросов / ${(sum(before) / 1048576).toFixed(2)} МБ`);
console.log(`   ${group(before)}`);
console.log(`Всего за сессию:           ${all.length} запросов / ${(sum(all) / 1048576).toFixed(2)} МБ`);
console.log(`   ${group(all)}`);

await browser.close();
