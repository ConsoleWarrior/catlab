/**
 * Слой платформы Яндекс Игр — этап 5, часть «SDK» (см. GDD.md §6).
 *
 * Единственное место, где игра знает про глобальный YaGames. Всё остальное
 * (сейв, дальше — покупки и реклама) ходит только сюда и ОБЯЗАНО работать, когда
 * SDK недоступен: локальная разработка, оффлайн, сбой загрузки лоадера, игра
 * открыта вне платформы. Поэтому наружу отсюда не летят исключения — только
 * «платформа есть / платформы нет».
 *
 * Лоадер: SDK v1 платформой отключён, живёт только v2. Грузим динамически —
 * сначала относительный `/sdk.js` (рекомендованный путь для игры, залитой
 * архивом в Консоль), затем абсолютный адрес (хостинг на своём домене).
 * В dev-режиме SDK не грузим вообще (на localhost init всё равно не пройдёт и
 * только затянет старт) — принудительно включается через `?ysdk`.
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
  auth?: { openAuthDialog(): Promise<void> };
  adv?: YaAdv;
}

interface YaGamesApi {
  init(opts?: { signed?: boolean }): Promise<Ysdk>;
}

declare global {
  interface Window { YaGames?: YaGamesApi }
}

const SDK_SOURCES = ['/sdk.js', 'https://sdk.games.s3.yandex.net/sdk.js'];
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

/** Предложить вход в Яндекс ID — только по осознанному действию игрока. */
export async function openAuthDialog(): Promise<boolean> {
  if (!sdk?.auth) return false;
  try { await sdk.auth.openAuthDialog(); return isAuthorized(); } catch { return false; }
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

/** Объект rewarded-рекламы (adv.showRewardedVideo); null — SDK нет или платформа его не даёт. */
export function getAdv(): YaAdv | null {
  return sdk?.adv ?? null;
}

/** Убрать лоадер платформы — вызывать, когда игра готова к взаимодействию. */
export function loadingReady(): void {
  try { sdk?.features?.LoadingAPI?.ready(); } catch { /* метода нет — не критично */ }
}

/** Начался активный геймплей (платформа реже показывает рекламу поверх игры). */
export function gameplayStart(): void {
  try { sdk?.features?.GameplayAPI?.start(); } catch { /* метода нет */ }
}

/** Геймплей приостановлен (сворачивание, пауза, оверлей). */
export function gameplayStop(): void {
  try { sdk?.features?.GameplayAPI?.stop(); } catch { /* метода нет */ }
}

async function bootstrap(): Promise<void> {
  if (skipSdk()) return;

  const api = await loadSdkScript();
  if (!api) return;

  try {
    sdk = await withTimeout(api.init());
  } catch {
    sdk = null; // вне платформы init не проходит — это нормальный сценарий
    return;
  }

  try {
    // scopes: false — доступ к данным игрока БЕЗ запроса личных данных, т.е. без
    // всплывающего окна входа: по требованиям авторизация допустима только после
    // осознанного действия пользователя. Гостю сейв тоже сохраняется.
    player = await withTimeout(sdk.getPlayer({ scopes: false }));
  } catch {
    player = null; // облака не будет, останется localStorage
  }
}

function skipSdk(): boolean {
  // `?ysdk` — принудительно пробовать SDK (отладка загрузки лоадера).
  if (new URLSearchParams(location.search).has('ysdk')) return false;
  // Лоадер Яндекса определяет window.YaGames ТОЛЬКО внутри фрейма (вне его пишет
  // в консоль «SDK initialization outside of frame» и молча ничего не создаёт), а
  // на платформе игра всегда открыта в iframe. Значит, на странице верхнего
  // уровня грузить лоадер бессмысленно — только задержка старта на таймаутах.
  if (window === window.top) return true;
  return import.meta.env.DEV;
}

async function loadSdkScript(): Promise<YaGamesApi | null> {
  if (window.YaGames) return window.YaGames;
  for (const src of SDK_SOURCES) {
    await loadScript(src);
    if (window.YaGames) return window.YaGames;
  }
  return null;
}

/** Грузит скрипт, всегда резолвится: успех, ошибка сети и таймаут неразличимы. */
function loadScript(src: string): Promise<void> {
  return new Promise((resolve) => {
    let done = false;
    const finish = (): void => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      resolve();
    };
    const timer = setTimeout(finish, SCRIPT_TIMEOUT_MS);
    const el = document.createElement('script');
    el.src = src;
    el.onload = finish;
    el.onerror = finish;
    document.head.appendChild(el);
  });
}

/** Обещания SDK вне платформы умеют висеть вечно — страхуемся таймаутом. */
function withTimeout<T>(p: Promise<T>, ms = INIT_TIMEOUT_MS): Promise<T> {
  return Promise.race([
    p,
    new Promise<T>((_, reject) => setTimeout(() => reject(new Error('ysdk timeout')), ms)),
  ]);
}
