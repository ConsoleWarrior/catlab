/**
 * Реклама — этап 5.6 (см. GDD.md §6.7). Единственное место, где игра вызывает
 * adv.* Яндекса. Как и весь src/platform/*: наружу не летят исключения —
 * недоступность рекламы это обычный «не получилось», не ошибка.
 *
 * Rewarded (по просьбе игрока): showRewarded() резолвится в true, ТОЛЬКО если
 * ролик реально досмотрен (сработал onRewarded). Закрыли раньше, ошибка показа,
 * реклама не подключена — false.
 *
 * Межстраничной (interstitial, которая показывается сама) в игре сознательно
 * НЕТ: rewarded-показов и так много (заказы, усилители, анализ родословной,
 * ускорения), и навязанный ролик поверх них только раздражал бы игрока. Свою
 * рекламу на переходах площадка показывает сама.
 *
 * Пока открыт любой рекламный блок, повторные вызовы получают false сразу
 * (защита от даблтапа — без этого можно было бы дважды получить награду с
 * одного показа).
 */

import { isPlatform, getAdv, gameplayStop, gameplayStart } from './ysdk.js';

const DEV_MOCK_MS = 400; // «просмотр» rewarded вне платформы

/**
 * Страховка от зависшего колбэка: на время показа игра стоит на паузе, и
 * вернуть её будет нечем. По докам onClose приходит всегда (в том числе после
 * ошибки и когда реклама не открылась), так что это чистая подстраховка.
 */
const WATCHDOG_MS = 60_000;

let showing = false;

let pauseUi: ((on: boolean) => void) | null = null;

/**
 * Кто останавливает игру и звук на время показа. Требование площадки (п. 4.7):
 * «При показе полноэкранной рекламы (interstitial или rewarded video) звук в
 * игре и игровой процесс должны ставиться на паузу». Ставим это здесь, в общей
 * обвязке показа, чтобы пауза не зависела от того, из какого места игры позвали
 * рекламу.
 */
export function setAdPauseHandler(fn: (on: boolean) => void): void {
  pauseUi = fn;
}

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
 * Общая обвязка показа: блокировка повторных вызовов, пауза геймплея для
 * площадки, ровно один резолв (onError и onClose приходят и вместе) и
 * страховочный таймер.
 */
function run(show: (finish: (ok: boolean) => void) => void): Promise<boolean> {
  showing = true;
  gameplayStop(); // площадка реже показывает свою рекламу поверх игры
  pauseUi?.(true); // игра и звук замирают на весь показ (п. 4.7)
  return new Promise((resolve) => {
    let done = false;
    const finish = (ok: boolean): void => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      showing = false;
      gameplayStart();
      pauseUi?.(false);
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
  pauseUi?.(true); // и на локалке пауза настоящая — иначе её нечем проверить
  return new Promise((resolve) => {
    setTimeout(() => { showing = false; pauseUi?.(false); resolve(true); }, ms);
  });
}
