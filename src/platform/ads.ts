/**
 * Реклама — этап 5.6 (см. GDD.md §6.7). Единственное место, где игра вызывает
 * adv.* Яндекса. Как и весь src/platform/*: наружу не летят исключения —
 * недоступность рекламы это обычный «не получилось», не ошибка.
 *
 * Rewarded (по просьбе игрока): showRewarded() резолвится в true, ТОЛЬКО если
 * ролик реально досмотрен (сработал onRewarded). Закрыли раньше, ошибка показа,
 * реклама не подключена — false.
 *
 * Межстраничная (interstitial): показывается САМА, но никогда «по таймеру» —
 * только в момент НЕИГРОВОГО действия игрока (кнопки навигации, вкладки
 * Генолаба, закрытие панели заказов/карточки породы). Таймер здесь лишь
 * снимает замок: собственный интервал показа — признак фрода для РСЯ
 * (`setInterval(showFullscreenAdv)` назван так прямо в документации), да и
 * частоту полноэкранных блоков в конечном счёте регулирует сама площадка.
 * Наша игра — реального времени без уровней, поэтому по п. 4.4 реклама внутри
 * «уровня» запрещена, а после неигрового действия разрешена и предупреждающей
 * шторки не требует.
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
let lastAdEndedAt = 0; // когда закончился последний показ (для «тишины» после рекламы)

// --- Межстраничная реклама: свой замок поверх лимитов площадки ---

/** Не чаще одного показа в 15 минут (считаем от РЕАЛЬНО показанного ролика). */
export const INTERSTITIAL_GAP_MS = 15 * 60_000;
/** Разгон в начале сессии: первые минуты игрока не трогаем вовсе. */
export const INTERSTITIAL_WARMUP_MS = 3 * 60_000;
/** Площадка отказала («слишком часто») — пробуем не раньше чем через минуту. */
const INTERSTITIAL_RETRY_MS = 60_000;

const sessionStartedAt = Date.now();
let lastInterstitialAt = 0; // когда межстраничная реально показалась
let interstitialRetryAt = 0; // раньше этого момента не дёргаем площадку впустую

/**
 * Замок межстраничной снят: прошёл разгон сессии, выдержан интервал с прошлого
 * показа, нет «тишины» после rewarded и ничего не показывается прямо сейчас.
 * Момент показа выбирает игра — строго на неигровом действии игрока.
 */
export function interstitialReady(): boolean {
  const now = Date.now();
  if (showing || adRecently()) return false;
  if (now < interstitialRetryAt) return false;
  return lastInterstitialAt === 0
    ? now - sessionStartedAt >= INTERSTITIAL_WARMUP_MS
    : now - lastInterstitialAt >= INTERSTITIAL_GAP_MS;
}

/** Пауза после рекламы, в течение которой другие окна поверх игры неуместны. */
export const AD_QUIET_MS = 60_000;

/**
 * Реклама идёт прямо сейчас или только что закончилась. Нужна тем окнам, которые
 * не должны идти «в одной цепочке» с роликом, — прежде всего нативной просьбе
 * оценить игру (см. GAME.md §17.6).
 */
export function adRecently(quietMs: number = AD_QUIET_MS): boolean {
  return showing || Date.now() - lastAdEndedAt < quietMs;
}

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
 * Показать межстраничную рекламу. true — ролик реально показался (`wasShown`);
 * false — площадка отказала (слишком частый вызов), ошибка или рекламы нет.
 * Интервал в 15 минут отсчитывается только от состоявшегося показа: отказ
 * площадки не должен «съедать» окно, но и долбить её впустую нельзя.
 */
export function showInterstitial(): Promise<boolean> {
  if (showing) return Promise.resolve(false);
  const adv = getAdv();
  const shown = !adv
    ? (isPlatform() ? Promise.resolve(false) : devMock(DEV_MOCK_MS))
    : run((finish, opened) => {
      adv.showFullscreenAdv({
        callbacks: {
          onOpen: opened,
          // onClose приходит и когда ролик не открылся (частый вызов) — тогда
          // wasShown false, и замок остаётся снятым до следующей попытки.
          onClose: (wasShown) => finish(!!wasShown),
          onError: () => finish(false),
        },
      });
    });
  return shown.then((ok) => {
    if (ok) lastInterstitialAt = Date.now();
    else interstitialRetryAt = Date.now() + INTERSTITIAL_RETRY_MS;
    return ok;
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
      lastAdEndedAt = Date.now();
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
    setTimeout(() => {
      showing = false;
      lastAdEndedAt = Date.now(); // и на локалке «тишина после рекламы» настоящая
      pauseUi?.(false);
      resolve(true);
    }, ms);
  });
}
