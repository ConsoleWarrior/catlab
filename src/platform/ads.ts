/**
 * Реклама — этап 5.6 (см. GDD.md §6.7). Единственное место, где игра вызывает
 * adv.* Яндекса. Как и весь src/platform/*: наружу не летят исключения —
 * недоступность рекламы это обычный «не получилось», не ошибка.
 *
 * Rewarded (по просьбе игрока): showRewarded() резолвится в true, ТОЛЬКО если
 * ролик реально досмотрен (сработал onRewarded). Закрыли раньше, ошибка показа,
 * реклама не подключена — false.
 *
 * Interstitial (сам, без просьбы): правила жёстче — только в логической паузе,
 * не чаще INTERSTITIAL_MS, и на время показа UI обязан поставить игру и звук на
 * паузу (это делает Game.runInterstitial — требование площадки).
 *
 * Пока открыт любой рекламный блок, повторные вызовы получают false сразу
 * (защита от даблтапа — без этого можно было бы дважды получить награду с
 * одного показа).
 */

import { isPlatform, getAdv, gameplayStop, gameplayStart } from './ysdk.js';

const DEV_MOCK_MS = 400;              // «просмотр» rewarded вне платформы
const DEV_MOCK_FULLSCREEN_MS = 1200;  // «показ» межстраничной вне платформы

/**
 * Минимум между межстраничными показами. Частоту режет и сама площадка, но свой
 * интервал нужен: без него мы дёргали бы SDK на каждой смене комнаты.
 */
const INTERSTITIAL_MS = 8 * 60_000;

/**
 * Страховка от зависшего колбэка: на время межстраничной игра стоит под шторкой,
 * и вернуть её будет нечем. По докам onClose приходит всегда (в том числе после
 * ошибки и когда реклама не открылась), так что это чистая подстраховка.
 */
const WATCHDOG_MS = 60_000;

let showing = false;

/**
 * Отсчёт интервала — с загрузки модуля, то есть со старта сессии: на входе в
 * игру площадка уже показывает свою рекламу, добавлять сразу свою нельзя.
 */
let lastInterstitialAt = Date.now();

/** Показать rewarded-ролик и дождаться результата. */
export function showRewarded(): Promise<boolean> {
  if (showing) return Promise.resolve(false);
  const adv = getAdv();
  if (!adv) return isPlatform() ? Promise.resolve(false) : devMock(DEV_MOCK_MS);

  return run((finish) => {
    let rewarded = false;
    adv.showRewardedVideo({
      callbacks: {
        onRewarded: () => { rewarded = true; },
        onClose: () => finish(rewarded),
        onError: () => finish(false),
      },
    });
  });
}

/**
 * Пора ли межстраничная реклама. Спрашивать в логической паузе — и показывать
 * шторку с предупреждением только если ответ true (см. Game.maybeInterstitial).
 */
export function interstitialDue(now = Date.now()): boolean {
  if (showing) return false;
  if (!isPlatform() && !import.meta.env.DEV) return false;
  return now - lastInterstitialAt >= INTERSTITIAL_MS;
}

/**
 * Показать межстраничную рекламу; резолвится, когда игру можно возвращать.
 * Интервал взводим по факту попытки, а не показа: площадка вправе отказать
 * (своя частота, нет заявок), и иначе шторка «Реклама…» вылезала бы на каждой
 * следующей смене комнаты.
 */
export function showInterstitial(): Promise<boolean> {
  if (showing) return Promise.resolve(false);
  lastInterstitialAt = Date.now();
  const adv = getAdv();
  if (!adv) return isPlatform() ? Promise.resolve(false) : devMock(DEV_MOCK_FULLSCREEN_MS);

  return run((finish) => {
    adv.showFullscreenAdv({
      callbacks: {
        onClose: (wasShown) => finish(wasShown === true),
        onError: () => finish(false),
      },
    });
  });
}

/**
 * Общая обвязка показа: блокировка повторных вызовов, пауза геймплея для
 * площадки, ровно один резолв (onError и onClose приходят и вместе) и
 * страховочный таймер.
 */
function run(show: (finish: (ok: boolean) => void) => void): Promise<boolean> {
  showing = true;
  gameplayStop(); // площадка реже показывает свою рекламу поверх игры
  return new Promise((resolve) => {
    let done = false;
    const finish = (ok: boolean): void => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      showing = false;
      gameplayStart();
      resolve(ok);
    };
    const timer = setTimeout(() => finish(false), WATCHDOG_MS);
    try { show(finish); } catch { finish(false); }
  });
}

/** Локальная разработка вне платформы: имитация показа без реального ролика. */
function devMock(ms: number): Promise<boolean> {
  if (!import.meta.env.DEV) return Promise.resolve(false);
  showing = true;
  return new Promise((resolve) => {
    setTimeout(() => { showing = false; resolve(true); }, ms);
  });
}
