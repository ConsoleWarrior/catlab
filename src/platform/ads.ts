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
 *
 * Два срока намеренно разные. Пока ролик не открылся, ждать долго незачем.
 * А вот после onOpen отсчёт начинается заново и с большим запасом: ролик с
 * интерактивным энд-кардом легко живёт дольше минуты, и прежний общий сторож на
 * 60 с срабатывал прямо поверх открытой рекламы — снимал паузу (музыка играла
 * под ролик, нарушение п. 4.7), съедал награду за досмотр и разрешал запустить
 * второй показ поверх первого.
 */
const WATCHDOG_MS = 30_000;
const WATCHDOG_OPEN_MS = 240_000;

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

  return run((finish, opened) => {
    let rewarded = false;
    adv.showRewardedVideo({
      callbacks: {
        onOpen: opened,   // ролик реально пошёл — сторожу нужен другой срок
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
function run(show: (finish: (ok: boolean) => void, opened: () => void) => void): Promise<boolean> {
  showing = true;
  gameplayStop(); // площадка реже показывает свою рекламу поверх игры
  pauseUi?.(true); // игра и звук замирают на весь показ (п. 4.7)
  return new Promise((resolve) => {
    let done = false;
    let timer: ReturnType<typeof setTimeout>;
    const finish = (ok: boolean): void => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      showing = false;
      gameplayStart();
      pauseUi?.(false);
      resolve(ok);
    };
    // Ролик открылся: колбэки живы, значит onClose придёт — сторож нужен только
    // на случай совсем зависшего плеера, и ждать он должен дольше самого ролика.
    const opened = (): void => {
      if (done) return;
      clearTimeout(timer);
      timer = setTimeout(() => finish(false), WATCHDOG_OPEN_MS);
    };
    timer = setTimeout(() => finish(false), WATCHDOG_MS);
    try { show(finish, opened); } catch { finish(false); }
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
