/**
 * Инап-покупки Яндекс Игр — этап 5.3 (см. GDD.md §6).
 *
 * Здесь только оркестрация платежа. Начисление — чистая функция игрового ядра
 * (game/actions.grantCrystals), она же отвечает за идемпотентность по
 * purchaseToken. Порядок операций жёсткий и нарушать его нельзя:
 *
 *   purchase() → начислить → СОХРАНИТЬ → consumePurchase()
 *
 * После консумирования покупка удаляется у платформы безвозвратно: погасив её до
 * сохранения, при обрыве связи мы оставим игрока без оплаченного товара. Если же
 * сохранение прошло, а гашение нет — платформа вернёт покупку в getPurchases при
 * следующем запуске, и её доначислит restorePurchases (повтор отсечёт токен).
 *
 * Цены НЕ хардкодим: строка цены и портальная валюта берутся из getCatalog —
 * это требование модерации (данные в игре должны совпадать с Консолью).
 */

import { loadPayments } from './ysdk.js';
import type { YaPayments, YaProduct, YaPurchase } from './ysdk.js';
import { CRYSTAL_PACKS, packBonusPct } from '../game/config.js';

/** Что игра делает с подтверждённой покупкой. Реализует Game (см. ui/game.ts). */
export interface PurchaseHost {
  /** Начислить пак в состояние. 'unknown' — товар игре неизвестен (гасить нельзя). */
  grant(productId: string, purchaseToken: string): { status: 'granted' | 'already' | 'unknown'; crystals: number };
  /** Сохранить состояние и дождаться подтверждения записи. false — не сохранилось. */
  saveAwait(): Promise<boolean>;
}

/** Карточка витрины: цена — строкой из каталога Консоли. */
export interface ShopItem {
  id: string;
  crystals: number;
  priceText: string;
  bonusPct: number;
}

export interface PurchaseResult {
  ok: boolean;
  crystals?: number;
  reason?: string;
}

let api: YaPayments | null = null;
let host: PurchaseHost | null = null;
let items: ShopItem[] = [];

/**
 * Поднимает платежи и витрину. Вызывать один раз на старте, ждать не обязательно:
 * пока каталог не пришёл, магазин просто недоступен (кнопка скрыта). Возвращает,
 * сколько 💎 доначислено по зависшим покупкам, — игре есть что сказать игроку.
 */
export async function initPayments(h: PurchaseHost): Promise<number> {
  host = h;
  api = await loadPayments() ?? devMockPayments();
  if (!api) return 0;

  let catalog: YaProduct[];
  try {
    catalog = await api.getCatalog();
  } catch {
    api = null; // без цен витрину показывать нельзя
    return 0;
  }

  const priceById = new Map(catalog.map((p) => [p.id, p.price]));
  // Показываем только пересечение «паки игры × товары Консоли»: товар без цены в
  // Консоли купить нельзя, а цена без пака в игре нам неизвестна как начислять.
  items = CRYSTAL_PACKS
    .filter((p) => priceById.has(p.id))
    .map((p) => ({ id: p.id, crystals: p.crystals, priceText: priceById.get(p.id)!, bonusPct: packBonusPct(p) }));

  // Доначисляем всё, что зависло с прошлого раза — обязательный пункт модерации.
  return restorePurchases();
}

/** Есть ли что показывать в магазине (иначе кнопку 💎+ не рисуем вовсе). */
export function shopAvailable(): boolean {
  return api !== null && items.length > 0;
}

export function shopItems(): readonly ShopItem[] {
  return items;
}

/** Купить пак. Отмена окна, нехватка янов и отсутствие товара неразличимы. */
export async function buyPack(id: string): Promise<PurchaseResult> {
  if (!api || !host) return { ok: false, reason: 'магазин недоступен' };
  let purchase: YaPurchase;
  try {
    purchase = await api.purchase({ id });
  } catch {
    return { ok: false, reason: 'покупка не завершена' };
  }
  return settle(purchase);
}

/**
 * Необработанные покупки (оплачены, но не начислены — обрыв связи, закрытая
 * вкладка). Вызывается на старте; возвращает, сколько 💎 доначислено.
 */
export async function restorePurchases(): Promise<number> {
  if (!api || !host) return 0;
  let list: YaPurchase[];
  try {
    list = await api.getPurchases();
  } catch {
    return 0;
  }
  let total = 0;
  for (const p of list) {
    const r = await settle(p);
    if (r.ok && r.crystals) total += r.crystals;
  }
  return total;
}

/** Начислить → сохранить → погасить. Единый путь и для покупки, и для восстановления. */
async function settle(purchase: YaPurchase): Promise<PurchaseResult> {
  const granted = host!.grant(purchase.productID, purchase.purchaseToken);

  // Товар этой версии игры неизвестен: не начисляем и НЕ гасим — пусть дождётся
  // сборки, которая про него знает, чем пропадёт бесследно.
  if (granted.status === 'unknown') return { ok: false, reason: 'неизвестный товар' };

  if (granted.status === 'granted' && !await host!.saveAwait()) {
    // Не сохранилось — гасить нельзя: покупка останется у платформы и доначислится
    // при следующем запуске (токен уже в состоянии — второй раз не начислит).
    return { ok: true, crystals: granted.crystals };
  }

  try {
    await api!.consumePurchase(purchase.purchaseToken);
  } catch { /* не погасили — повторим при следующем запуске, начисление идемпотентно */ }

  return { ok: true, crystals: granted.crystals };
}

/**
 * Заглушка платежей для локальной разработки: настоящий SDK на localhost не
 * поднимается, а витрину и весь путь покупки проверять надо. В прод-сборке не
 * существует (import.meta.env.DEV вырезает ветку целиком).
 */
function devMockPayments(): YaPayments | null {
  if (!import.meta.env.DEV) return null;
  console.info('[payments] DEV-заглушка магазина: покупки бесплатны и ничего не списывают');
  let n = 0;
  return {
    getCatalog: () => Promise.resolve(CRYSTAL_PACKS.map((p) => ({
      id: p.id,
      title: `${p.crystals} кристаллов`,
      description: '',
      imageURI: '',
      price: `${p.yans} YAN`,
      priceValue: String(p.yans),
      priceCurrencyCode: 'YAN',
    }))),
    purchase: ({ id }) => Promise.resolve({ productID: id, purchaseToken: `dev-${Date.now()}-${n++}` }),
    getPurchases: () => Promise.resolve([]),
    consumePurchase: () => Promise.resolve(),
  };
}
