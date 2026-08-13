/**
 * Два языка игры: русский и английский.
 *
 * Требование площадки п. 2.14 — язык определяется автоматически, через SDK
 * (`environment.i18n.lang`). Плюс п. 6.9 (рекомендация): игрок может переключить
 * язык вручную, не зная предустановленного, — флаги RU/EN в ⚙️ Настройках.
 * Приоритет: ручной выбор → платформа → браузер → русский.
 *
 * ФОРМАТ ПЕРЕВОДА — пара строк по месту:
 *
 *   label(t('💎 Кристаллы', '💎 Crystals'))
 *   ctx.toast(t(`Кот подлечен +${n} ❤`, `Cat healed +${n} ❤`))
 *
 * Никаких ключей и словарей: обе версии видны рядом, и правка русского текста
 * не может молча оставить английский старым. Для ДАННЫХ (породы, признаки,
 * усилители — всё, что объявлено один раз при импорте модуля) пара хранится
 * как `LocStr` и разворачивается при чтении через `tx()`: язык к моменту
 * импорта ещё не известен, а меняться он может и на лету.
 *
 * Модуль намеренно без зависимостей: его импортирует и игровое ядро
 * (src/game/*), которое ничего не должно знать ни про UI, ни про платформу.
 * Язык платформы приносит снаружи — `initLang(platformLang())` из ui/game.ts.
 */

export type Lang = 'ru' | 'en';

/** Пара «русский, английский» для данных: `['Активатор', 'Activator']`. */
export type LocStr = readonly [ru: string, en: string];

/** Языки, на которые игра переведена. */
export const AVAILABLE: readonly Lang[] = ['ru', 'en'];
const FALLBACK: Lang = 'ru';
const LANG_KEY = 'catlab:lang';

let current: Lang = FALLBACK;
let listeners: (() => void)[] = [];

/**
 * Определить язык на старте. `fromPlatform` — то, что сказал SDK (null вне
 * платформы). Ручной выбор игрока перевешивает: он сделан осознанно.
 */
export function initLang(fromPlatform?: string | null): void {
  current = parse(readStored()) ?? parse(fromPlatform) ?? parse(browserLang()) ?? FALLBACK;
  applyDocumentLang();
}

/** Текущий язык интерфейса. */
export function lang(): Lang {
  return current;
}

/** Переключить язык (⚙️ Настройки). Выбор запоминается на этом устройстве. */
export function setLang(next: Lang): void {
  if (next === current) return;
  current = next;
  applyDocumentLang();
  try { localStorage.setItem(LANG_KEY, next); } catch { /* приватный режим */ }
  for (const fn of listeners) fn();
}

/** Подписка на смену языка: сцена пересобирается целиком (тексты уже созданы). */
export function onLangChange(fn: () => void): void {
  listeners.push(fn);
}

/** Строка по текущему языку. Основной способ перевода в коде. */
export function t(ru: string, en: string): string {
  return current === 'en' ? en : ru;
}

/** Развернуть пару из данных (`LocStr`) в строку текущего языка. */
export function tx(s: LocStr): string {
  return current === 'en' ? s[1] : s[0];
}

/** Склонение по числу: 1 кот / 2 кота / 5 котов; в английском хватает двух форм. */
export function plural(n: number, ru: [one: string, few: string, many: string], en: [one: string, many: string]): string {
  if (current === 'en') return n === 1 ? en[0] : en[1];
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return ru[0];
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return ru[1];
  return ru[2];
}

function applyDocumentLang(): void {
  try {
    document.documentElement.lang = current;
    // Заглушка «поверни телефон» живёт в index.html и рисуется до старта Pixi —
    // единственный кусок интерфейса вне канваса, поэтому язык ей меняем отсюда.
    const rotate = document.getElementById('rotate-text');
    if (rotate) rotate.textContent = t('Поверни телефон горизонтально', 'Turn your phone sideways');
  } catch { /* вне браузера (тесты) */ }
}

function readStored(): string | null {
  try { return localStorage.getItem(LANG_KEY); } catch { return null; }
}

function browserLang(): string | null {
  try { return navigator.language; } catch { return null; }
}

/** 'ru-RU' / 'en' → Lang, если такой язык у нас есть. */
function parse(raw: string | null | undefined): Lang | null {
  const code = (raw ?? '').slice(0, 2).toLowerCase();
  return code === 'ru' || code === 'en' ? code : null;
}
