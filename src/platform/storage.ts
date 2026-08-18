/**
 * Хранилище сейва: облако Яндекса + localStorage (этап 5, см. GDD.md §6).
 *
 * Зачем облако: игра с покупками ОБЯЗАНА хранить прогресс на сервере — один
 * игрок должен видеть свой прогресс со всех устройств (требования Яндекса), а
 * localStorage на своём домене (особенно iOS) периодически сбрасывается. Купил
 * кристаллы → почистил браузер → всё пропало — это возврат и жалоба.
 *
 * Схема: пишем ВСЕГДА в оба места (localStorage синхронно — он же кэш и
 * оффлайн-фолбэк, облако асинхронно), а при загрузке берём кандидатов из обоих
 * источников и отдаём отсортированными по времени записи — выбор делает игра
 * (ей ещё нужно проверить версию сейва).
 *
 * Лимиты платформы: setData — 200 КБ на игрока и 100 запросов за 5 минут.
 * Отсюда запас по размеру и склейка частых записей в одну (см. pumpCloud).
 */

import { getPlayerApi, isPlatform } from './ysdk.js';

const LOCAL_KEY = 'catlab:save:v1';
const LOCAL_AT_KEY = 'catlab:save:v1:at';
const CLOUD_SAVE_KEY = 'save';
const CLOUD_AT_KEY = 'savedAt';
// 200 КБ — жёсткий лимит setData; держим запас: кириллица в кличках это 2 байта
// на символ, плюс служебные поля самого запроса.
const CLOUD_LIMIT_BYTES = 180 * 1024;

export interface SaveRecord {
  raw: string;
  savedAt: number;
  source: 'cloud' | 'local';
}

let pending: { raw: string; flush: boolean } | null = null;
let chain: Promise<boolean> = Promise.resolve(true);
let lastCloudRaw = '';
let lastCloudOk = true;
let warnedSize = false;
let cloudBlocked = false;

/**
 * Кандидаты на загрузку — от самого свежего к старому. Игра берёт первый,
 * который разбирается и совпадает по версии сейва.
 */
export async function loadSaveCandidates(): Promise<SaveRecord[]> {
  const out: SaveRecord[] = [];

  const local = readLocal();
  if (local) out.push(local);

  const cloud = await readCloud();
  if (cloud) {
    lastCloudRaw = cloud.raw; // не переписывать облако тем же самым на первом автосейве
    out.push(cloud);
  }

  return out.sort((a, b) => b.savedAt - a.savedAt);
}

/**
 * Сохранить состояние. Локально — синхронно, в облако — в фоне (вызывается в том
 * числе из beforeunload, где ждать нельзя). flush=true — отправить в облако
 * немедленно (сворачивание/закрытие), иначе SDK может подкопить запрос.
 */
export function writeSave(raw: string, flush = false): void {
  void enqueue(raw, flush);
}

/**
 * Сохранить и ДОЖДАТЬСЯ, что запись реально легла в облако. Нужно ровно в одном
 * месте — при покупке: гасить покупку (consumePurchase) можно только после того,
 * как начисленное сохранено, иначе обрыв связи оставит игрока без товара
 * (см. GDD.md §6.4). Возвращает false, если облачная запись не удалась.
 */
export function writeSaveAwait(raw: string): Promise<boolean> {
  return enqueue(raw, true);
}

function enqueue(raw: string, flush: boolean): Promise<boolean> {
  writeLocal(raw);
  // Облака нет (или оно закрыто на эту сессию, см. adoptLatePlayer) — локальной
  // записи достаточно, прогресс игрока не теряется.
  if (!isPlatform() || cloudBlocked) return Promise.resolve(true);
  pending = { raw, flush: flush || (pending?.flush ?? false) };
  // Очередь из одного звена: записи идут строго по одной, а накопившиеся
  // схлопываются в последнюю (см. drainCloud) — так частый автосейв не упирается
  // в лимит 100 запросов / 5 минут.
  chain = chain.then(drainCloud, drainCloud);
  return chain;
}

function readLocal(): SaveRecord | null {
  try {
    const raw = localStorage.getItem(LOCAL_KEY);
    if (!raw) return null;
    const at = Number(localStorage.getItem(LOCAL_AT_KEY));
    return { raw, savedAt: Number.isFinite(at) ? at : 0, source: 'local' };
  } catch {
    return null; // приватный режим / хранилище недоступно
  }
}

function writeLocal(raw: string): void {
  try {
    localStorage.setItem(LOCAL_KEY, raw);
    localStorage.setItem(LOCAL_AT_KEY, String(Date.now()));
  } catch { /* квота/приватный режим — остаётся облако */ }
}

async function readCloud(): Promise<SaveRecord | null> {
  const p = getPlayerApi();
  if (!p) return null;
  try {
    const data = await p.getData([CLOUD_SAVE_KEY, CLOUD_AT_KEY]);
    const raw = data[CLOUD_SAVE_KEY];
    if (typeof raw !== 'string' || !raw) return null;
    const at = data[CLOUD_AT_KEY];
    // Без отметки времени всё равно считаем облако свежее «безвременного»
    // локального сейва (такие остались от версии игры без облака).
    return { raw, savedAt: typeof at === 'number' ? at : 1, source: 'cloud' };
  } catch {
    return null; // сеть/лимит запросов — играем на локальном сейве
  }
}

/** Одно звено очереди: отправляет последнее накопившееся состояние в облако. */
async function drainCloud(): Promise<boolean> {
  const job = pending;
  pending = null;
  // Нас опередило соседнее звено — оно унесло в облако в том числе и наши данные,
  // поэтому отдаём ЕГО результат, а не голое «да». Раньше здесь стояло `true`, и
  // при неудачной записи покупка гасилась (consumePurchase) без сохранения.
  if (!job) return lastCloudOk;
  if (job.raw === lastCloudRaw) return true;   // ничего не изменилось

  const p = getPlayerApi();
  if (!p) return (lastCloudOk = false);
  if (tooBigForCloud(job.raw)) return (lastCloudOk = false);

  try {
    await p.setData({ [CLOUD_SAVE_KEY]: job.raw, [CLOUD_AT_KEY]: Date.now() }, job.flush);
    lastCloudRaw = job.raw;
    return (lastCloudOk = true);
  } catch {
    // лимит/сеть: данные уже в localStorage, повторим на следующем сейве
    return (lastCloudOk = false);
  }
}

/**
 * Полный сброс прогресса по требованию игрока (⚙️ Настройки → «Начать заново»).
 * Пишем новое (начальное) состояние поверх ОБОИХ хранилищ, а не удаляем записи:
 * пустое облако при следующем запуске просто уступило бы старому локальному
 * сейву, и прогресс бы «воскрес».
 *
 * Снимаем и cloudBlocked: он ставится, когда в облаке сейв новее локального (см.
 * adoptLatePlayer), но сброс — осознанное решение затереть всё, в том числе
 * прогресс с другого устройства. lastCloudRaw обнуляем, чтобы drainCloud не счёл
 * запись «ничем не изменившейся».
 *
 * Возвращает false, если облачную запись сделать не удалось (нет сети/лимит) —
 * локально сброс уже произошёл, но на других устройствах останется старый сейв.
 */
export function resetSave(raw: string): Promise<boolean> {
  cloudBlocked = false;
  lastCloudRaw = '';
  return enqueue(raw, true);
}

/**
 * Игрок появился уже после старта игры: SDK опоздал, и сессия идёт на локальном
 * сейве. Писать её в облако вслепую нельзя — там может лежать прогресс свежее,
 * с другого устройства, и первый же автосейв затёр бы его. Поэтому сверяем время
 * и, если облако новее, в этой сессии облачную запись запрещаем совсем.
 *
 * Возвращает true, если облако подхвачено штатно; false — прогресс в облаке
 * новее, играть можно, но синхронизация вернётся только после перезапуска.
 */
export async function adoptLatePlayer(): Promise<boolean> {
  const cloud = await readCloud();
  if (!cloud) return true; // облака нет — пишем как обычно

  const local = readLocal();
  if (cloud.savedAt <= (local?.savedAt ?? 0)) {
    lastCloudRaw = cloud.raw; // облако не новее — просто не переписываем тем же
    return true;
  }
  cloudBlocked = true;
  return false;
}

function tooBigForCloud(raw: string): boolean {
  const bytes = new TextEncoder().encode(raw).length;
  if (bytes <= CLOUD_LIMIT_BYTES) return false;
  if (!warnedSize) {
    warnedSize = true;
    console.warn(`[storage] сейв ${Math.round(bytes / 1024)} КБ > лимита облака 200 КБ — облачное сохранение отключено`);
  }
  return true;
}
