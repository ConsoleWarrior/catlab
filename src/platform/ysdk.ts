/**
 * Слой платформы Яндекс Игр — этап 5, часть «SDK» (см. GDD.md §6).
 *
 * Единственное место, где игра знает про глобальный YaGames. Всё остальное
 * (сейв, дальше — покупки и реклама) ходит только сюда и ОБЯЗАНО работать, когда
 * SDK недоступен: локальная разработка, оффлайн, сбой загрузки лоадера, игра
 * открыта вне платформы. Поэтому наружу отсюда не летят исключения — только
 * «платформа есть / платформы нет».
 *
 * Лоадер сюда НЕ грузится: скрипт `/sdk.js` подключён тегом в заголовке
 * index.html — как в примере документации (sdk-about#connection-example), этого
 * требует п. 1.19.1 Требований платформы. Здесь мы только дожидаемся тега и
 * работаем с готовым `window.YaGames`. Вне фрейма платформы лоадер намеренно не
 * создаёт `window.YaGames` (пишет в консоль «SDK initialization outside of
 * frame») — это и есть наш признак «игра открыта не на платформе», своих
 * условий «грузить / не грузить SDK» тут быть не должно.
 */

export interface YaPlayer {
  getData(keys?: string[]): Promise<Record<string, unknown>>;
  setData(data: Record<string, unknown>, flush?: boolean): Promise<void>;
  isAuthorized(): boolean;
  getUniqueID(): string;
}

interface YaFeatures {
  LoadingAPI?: { ready(): void };
  GameplayAPI?: { start(): void; stop(): void };
}

/** Товар из Консоли разработчика (payments.getCatalog). */
export interface YaProduct {
  id: string;
  title: string;
  description: string;
  imageURI: string;
  price: string;            // «199 YAN» — готовая строка с портальной валютой
  priceValue: string;
  priceCurrencyCode: string;
  getPriceCurrencyImage?(size: 'small' | 'medium' | 'svg'): string;
}

export interface YaPurchase {
  productID: string;
  purchaseToken: string;
  developerPayload?: string;
}

export interface YaPayments {
  purchase(opts: { id: string; developerPayload?: string }): Promise<YaPurchase>;
  getPurchases(): Promise<YaPurchase[]>;
  getCatalog(): Promise<YaProduct[]>;
  consumePurchase(purchaseToken: string): Promise<void>;
}

export interface YaAdvCallbacks {
  onOpen?(): void;
  onRewarded?(): void;
  /** wasShown — реклама реально показалась; приходит и после ошибки/отказа. */
  onClose?(wasShown?: boolean): void;
  onError?(error: unknown): void;
}

export interface YaAdv {
  showRewardedVideo(opts: { callbacks: YaAdvCallbacks }): void;
  showFullscreenAdv(opts: { callbacks: YaAdvCallbacks }): void;
}

export interface Ysdk {
  getPlayer(opts?: { scopes?: boolean; signed?: boolean }): Promise<YaPlayer>;
  getPayments(opts?: { signed?: boolean }): Promise<YaPayments>;
  features?: YaFeatures;
  /** Окружение запуска: язык интерфейса игрока, домен портала и т.п. */
  environment?: { i18n?: { lang?: string; tld?: string } };
  auth?: { openAuthDialog(): Promise<void> };
  adv?: YaAdv;
  /** События платформы (game_api_pause / game_api_resume). */
  on?(event: string, cb: () => void): void;
  off?(event: string, cb: () => void): void;
}

interface YaGamesApi {
  init(opts?: { signed?: boolean }): Promise<Ysdk>;
}

declare global {
  interface Window {
    YaGames?: YaGamesApi;
    /** Обещание из index.html: тег `/sdk.js` отработал (true) или упал (false). */
    __sdkLoaded?: Promise<boolean>;
  }
}

const SCRIPT_TIMEOUT_MS = 6000;
const INIT_TIMEOUT_MS = 8000;

let sdk: Ysdk | null = null;
let player: YaPlayer | null = null;
let boot: Promise<void> | null = null;

/**
 * Поднимает SDK и объект игрока. Вызывать один раз на старте; повторные вызовы
 * возвращают то же обещание. Никогда не реджектится — при любой неудаче игра
 * просто работает в локальном режиме (isPlatform() === false).
 */
export function initPlatform(): Promise<void> {
  boot ??= bootstrap();
  return boot;
}

/** Игра реально запущена на платформе (SDK поднялся). */
export function isPlatform(): boolean {
  return sdk !== null;
}

/** Объект игрока для облачного сейва; null — платформы нет. */
export function getPlayerApi(): YaPlayer | null {
  return player;
}

/** Игрок вошёл в Яндекс ID (гостевой прогресс теряется при чистке устройства). */
export function isAuthorized(): boolean {
  try { return player?.isAuthorized() ?? false; } catch { return false; }
}

/** Предложить вход в Яндекс ID — только по осознанному действию игрока (п. 1.2.1). */
export async function openAuthDialog(): Promise<boolean> {
  if (!sdk?.auth) return false;
  try {
    await sdk.auth.openAuthDialog();
    // После входа объект игрока берём заново: гостевой сменился на аккаунтный, и
    // облачный сейв должен идти уже в аккаунт (п. 1.13.3 — прогресс доступен с
    // разных устройств). Не получилось — останется гостевой, игра не ломается.
    try { player = await withTimeout(sdk.getPlayer({ scopes: false })); } catch { /* оставляем прежнего */ }
    return isAuthorized();
  } catch {
    return false; // игрок закрыл окно входа — обычный сценарий
  }
}

/** Вход в Яндекс ID вообще доступен (есть SDK и метод авторизации). */
export function canOfferAuth(): boolean {
  return !!sdk?.auth;
}

/**
 * Объект платежей. Ошибка = покупки для этой игры не подключены (или SDK нет) —
 * тогда магазин в игре не показывается вовсе, чтобы не было мёртвых кнопок.
 * signed: false — обрабатываем покупки на клиенте (своего бэкенда нет, см. GDD §6.4).
 */
export async function loadPayments(): Promise<YaPayments | null> {
  if (!sdk) return null;
  try { return await withTimeout(sdk.getPayments({ signed: false })); } catch { return null; }
}

/**
 * Язык интерфейса игрока по данным платформы (`environment.i18n.lang`, напр. 'ru',
 * 'en', 'tr'). Требование п. 2.14 — язык игры определяется автоматически, через SDK,
 * а не по своим догадкам. null — платформы нет: тогда язык берётся из браузера
 * (см. src/ui/i18n.ts).
 */
export function platformLang(): string | null {
  try { return sdk?.environment?.i18n?.lang ?? null; } catch { return null; }
}

/** Объект rewarded-рекламы (adv.showRewardedVideo); null — SDK нет или платформа его не даёт. */
export function getAdv(): YaAdv | null {
  return sdk?.adv ?? null;
}

let readyDone = false;
let readyWanted = false;
let gameplayOn = false;

/**
 * Убрать лоадер платформы — вызывать, когда игра готова к взаимодействию (п. 1.19.2).
 *
 * Два условия, без которых портал показывает игроку вечный лоадер. Первое: вызвать
 * РОВНО один раз — отсюда `readyDone`, звать можно откуда угодно и сколько угодно.
 * Второе: не потерять вызов, если игра собралась раньше, чем поднялся SDK (медленная
 * сеть), — тогда запоминаем намерение и снимаем лоадер сразу, как SDK появится.
 */
export function loadingReady(): void {
  if (readyDone) return;
  readyWanted = true;
  const api = sdk?.features?.LoadingAPI;
  if (!api) return; // SDK ещё нет — вызовем в flushLifecycle(), как только появится
  try { api.ready(); readyDone = true; } catch { /* метода нет — не критично */ }
}

/** Начался активный геймплей (платформа реже показывает рекламу поверх игры). */
export function gameplayStart(): void {
  gameplayOn = true;
  try { sdk?.features?.GameplayAPI?.start(); } catch { /* метода нет */ }
}

/** Геймплей приостановлен (сворачивание, пауза, оверлей). */
export function gameplayStop(): void {
  gameplayOn = false;
  try { sdk?.features?.GameplayAPI?.stop(); } catch { /* метода нет */ }
}

/** SDK поднялся — доигрываем то, что игра успела сообщить до его появления. */
function flushLifecycle(): void {
  if (readyWanted) loadingReady();
  if (gameplayOn) gameplayStart();
}

let pauseHandler: ((on: boolean) => void) | null = null;
let pauseBound = false;

/**
 * Подписаться на паузу от самой платформы (`game_api_pause` / `game_api_resume`).
 * Площадка присылает их шире, чем видят наши колбэки рекламы: своя реклама
 * поверх игры, окно покупок, переключение вкладки, сворачивание окна. По
 * документации на паузу игра обязана остановить игровой цикл и музыку.
 *
 * Регистрировать можно до подъёма SDK — подпишемся, как только он появится.
 */
export function setPlatformPauseHandler(fn: (on: boolean) => void): void {
  pauseHandler = fn;
  bindPauseEvents();
}

function bindPauseEvents(): void {
  if (pauseBound || !pauseHandler || !sdk?.on) return;
  try {
    sdk.on('game_api_pause', () => pauseHandler?.(true));
    sdk.on('game_api_resume', () => pauseHandler?.(false));
    pauseBound = true;
  } catch { /* старый SDK без событий — остаются свои паузы вокруг рекламы */ }
}

async function bootstrap(): Promise<void> {
  const settled = await waitSdkScript();

  if (!window.YaGames) {
    // Тег `/sdk.js` не отработал. Если он просто ещё в пути (медленная сеть) —
    // не бросаем платформу насовсем: игру запускаем сейчас, на локальном сейве, а
    // SDK доподнимаем в фоне (см. lateBootstrap). Раньше здесь был тупик: SDK,
    // опоздавший на секунду, терялся вместе с рекламой, покупками и ready().
    if (!settled) void lateBootstrap();
    return; // иначе это честно «не платформа»: локалка, оффлайн, открыт вне фрейма
  }
  await connect();
}

/** Поднимает сам SDK и объект игрока. Наружу исключений не выпускает. */
async function connect(): Promise<void> {
  const api = window.YaGames;
  if (!api || sdk) return;

  try {
    sdk = await withTimeout(api.init());
  } catch {
    sdk = null; // вне платформы init не проходит — это нормальный сценарий
    return;
  }
  bindPauseEvents(); // SDK появился — вешаем паузу платформы (см. setPlatformPauseHandler)
  flushLifecycle();  // и снимаем лоадер портала, если игра готова с прошлого кадра

  try {
    // scopes: false — доступ к данным игрока БЕЗ запроса личных данных, т.е. без
    // всплывающего окна входа: по требованиям авторизация допустима только после
    // осознанного действия пользователя. Гостю сейв тоже сохраняется.
    player = await withTimeout(sdk.getPlayer({ scopes: false }));
  } catch {
    player = null; // облака не будет, останется localStorage
  }
}

/** Ждём опоздавший тег сколько потребуется — игра в это время уже играется. */
async function lateBootstrap(): Promise<void> {
  try {
    const ok = await window.__sdkLoaded;
    if (!ok || sdk) return;
    await connect();
    if (player) { lateArrived = true; lateHandler?.(); }
  } catch { /* платформы нет */ }
}

let lateHandler: (() => void) | null = null;
let lateArrived = false;

/**
 * Игрок появился уже ПОСЛЕ старта игры (только этот случай, не обычный запуск).
 * Сообщаем хранилищу: сессия идёт на локальном сейве, и писать её в облако
 * вслепую нельзя — там может лежать более свежий прогресс с другого устройства
 * (см. storage.adoptLatePlayer). Если SDK успел подняться раньше, чем игра
 * повесила обработчик, зовём его сразу — событие не теряется.
 */
export function setLatePlayerHandler(fn: () => void): void {
  lateHandler = fn;
  if (lateArrived) fn();
}

/**
 * Ждёт тег `<script async src="/sdk.js">` из index.html: при async он может
 * отработать и до, и после модуля игры. Таймаут — на случай, когда запрос висит
 * (плохая сеть): без него старт игры залипнет на ожидании платформы. Возвращает
 * true, если тег определился (успехом или ошибкой), false — если истекло время и
 * ответа всё ещё нет: тогда ожидание продолжается в фоне.
 */
function waitSdkScript(): Promise<boolean> {
  const loaded = window.__sdkLoaded;
  if (!loaded) return Promise.resolve(true); // страница без тега — просто нет платформы
  return Promise.race([
    loaded.then(() => true, () => true),
    new Promise<boolean>((r) => setTimeout(() => r(false), SCRIPT_TIMEOUT_MS)),
  ]);
}

/** Обещания SDK вне платформы умеют висеть вечно — страхуемся таймаутом. */
function withTimeout<T>(p: Promise<T>, ms = INIT_TIMEOUT_MS): Promise<T> {
  return Promise.race([
    p,
    new Promise<T>((_, reject) => setTimeout(() => reject(new Error('ysdk timeout')), ms)),
  ]);
}
