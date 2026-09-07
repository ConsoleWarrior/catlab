/**
 * Звуковые эффекты. Библиотека — @pixi/sound (WebAudio): сама снимает блокировку
 * автоплея по первому тапу и ставит звук на паузу при сворачивании вкладки.
 *
 * Весь звук игры — и эффекты, и музыка — идёт ТОЛЬКО через Web Audio, без единого
 * <audio>: медиа-элемент браузер показывает в системном плеере (панель ОС, шторка
 * уведомлений Android), а площадка это запрещает — пп. 1.6.1.6 и 1.6.2.5
 * Требований. Если Web Audio в браузере нет, игра остаётся немой (см. audioCtx).
 *
 * Записи с Pixabay сведены с очень разной громкостью, поэтому после декодирования
 * каждая нормализуется: считаем RMS «слышимой» части (без пауз и хвостов тишины)
 * и подбираем громкость так, чтобы все звучали примерно одинаково.
 *
 * Источники и лицензии файлов — src/assets/sounds/README.md.
 */
import { sound, type Sound, type IMediaInstance } from '@pixi/sound';

// Мяуканье: весь набор играет на тап по коту и взятие «за шкирку» (см. game.ts)
const meowUrls = import.meta.glob('../assets/sounds/meow/*.mp3', {
  eager: true, query: '?url', import: 'default',
}) as Record<string, string>;

// Мурлыканье: тихие зацикленные петли спящих котов — «хор» (см. livingFloor.ts)
const purrUrls = import.meta.glob('../assets/sounds/purr/*.mp3', {
  eager: true, query: '?url', import: 'default',
}) as Record<string, string>;

// Фоновая музыка «технических» комнат (Инкубатор/Генолаб/Крио-банк)
const musicUrls = import.meta.glob('../assets/sounds/background/*.mp3', {
  eager: true, query: '?url', import: 'default',
}) as Record<string, string>;

// Звуки событий: имя файла = ключ события (см. SfxEvent), один файл на событие
const eventUrls = import.meta.glob('../assets/sounds/ui/*.mp3', {
  eager: true, query: '?url', import: 'default',
}) as Record<string, string>;

/** Событие, у которого есть свой звук (= имя файла в assets/sounds/ui). */
export type SfxEvent =
  | 'levelup'   // повышение уровня лаборатории
  | 'newbreed'  // родилась порода, которой ещё не было в Котодексе
  | 'birth'     // родился котёнок
  | 'order'     // выполнен заказ
  | 'freeze'    // кот заморожен в криокапсулу
  | 'lab'       // кот сдан в лабораторию «на эксперименты»
  | 'adopt'     // кот отдан «в добрые руки»
  | 'buy'       // покупка за 💰 (кот, корм, слот, пьедестал, узел «Улучшений»)
  | 'heal';     // ветеринар восстановил вязки

// У события может не быть своего файла — тогда играем звук-донор. Звон монет один
// и тот же и когда монеты приходят («в добрые руки»), и когда уходят (покупка);
// появится отдельный buy.mp3 — достаточно убрать строчку.
const EVENT_FILE: Partial<Record<SfxEvent, SfxEvent>> = { buy: 'adopt' };

const TARGET_RMS = 0.08; // ориентир «нормальной» громкости (≈ −22 дБFS)
const GAIN_MIN = 0.25;   // пределы автоподстройки: совсем тихая запись не должна
const GAIN_MAX = 3;      //   улететь в шум, громкая — в клиппинг
const MEOW_VOL = 0.7;    // базовая громкость мяуканья после выравнивания
const MEOW_GAP_MS = 180; // тапают чаще — новые мяу не запускаем (иначе каша)

const PURR_VOL = 0.06;     // еле слышно: один кот почти не заметен, хор — заметен
const PURR_MAX = 10;       // предел одновременных петель — дальше хор уже не растёт
const PURR_FADE_IN = 1.5;  // с — мурчание «разгоняется» мягко, как засыпание
const PURR_FADE_OUT = 0.6; // с — затухание при пробуждении (без щелчка обрыва)

// Звуки событий сведены заранее (обрезка, фейды, общий уровень −19.5 LUFS с
// поправкой на «важность» события — см. assets/sounds/README.md), поэтому
// автонормализация к ним НЕ применяется: она бы стёрла эту разницу. Уровень
// подобран так, чтобы событие звучало вровень с мяуканьем и не спорило с музыкой.
const EVENT_VOL = 0.8;
const EVENT_GAP_MS = 200; // защита от дребезга: повтор ТОГО ЖЕ события — один звук

const meows: string[] = [];
const purrs: string[] = [];
let lastAt = 0;
let lastIdx = -1;
const eventAt = new Map<string, number>();

/** RMS слышимой части записи: паузы и тишину не учитываем. */
function activeRms(buf: AudioBuffer): number {
  let sum = 0;
  let n = 0;
  for (let c = 0; c < buf.numberOfChannels; c++) {
    const d = buf.getChannelData(c);
    for (let i = 0; i < d.length; i += 4) { // шаг 4 — точности достаточно
      const v = d[i] ?? 0;
      if (v > -0.01 && v < 0.01) continue;
      sum += v * v;
      n++;
    }
  }
  return n ? Math.sqrt(sum / n) : 0;
}

/** Выровнять громкость записи под TARGET_RMS (base — жанровый множитель). */
function normalize(s: Sound, base: number): void {
  // buffer есть только у WebAudio-бэкенда; HTML5-фолбэк оставляем как есть
  const buf = (s.media as { buffer?: AudioBuffer } | null)?.buffer;
  const rms = buf ? activeRms(buf) : 0;
  const gain = rms > 0 ? Math.min(GAIN_MAX, Math.max(GAIN_MIN, TARGET_RMS / rms)) : 1;
  s.volume = base * gain;
}

/**
 * AudioContext, общий с эффектами: он же снимает блокировку автоплея по первому
 * тапу и засыпает, когда игрок уходит со вкладки. Возвращает null, если браузер
 * Web Audio не поддерживает и @pixi/sound откатился на <audio>: в этом случае
 * звука не будет вовсе — системный плеер площадка запрещает (см. шапку файла).
 */
let ctxCache: AudioContext | null | undefined; // undefined — ещё не спрашивали
function audioCtx(): AudioContext | null {
  if (ctxCache === undefined) {
    // у HTML-фолбэка геттер отдаёт null и пишет предупреждение — спрашиваем один раз
    ctxCache = sound.context?.audioContext ?? null;
  }
  return ctxCache;
}

// --- общая громкость ----------------------------------------------------------
// Один множитель на все звуки: эффекты (@pixi/sound) идут через sound.volumeAll,
// музыка идёт своим узлом громкости и домножается на него в applyMusicGain.
// Хранится в localStorage — это настройка устройства, а не игровой прогресс, в
// облачный сейв она не попадает.
const VOL_KEY = 'catlab:volume';

function loadMasterVolume(): number {
  try {
    const raw = localStorage.getItem(VOL_KEY);
    if (raw !== null) {
      const v = Number(raw);
      if (Number.isFinite(v)) return Math.min(1, Math.max(0, v));
    }
  } catch { /* приватный режим — по умолчанию полная громкость */ }
  return 1;
}

let masterVol = loadMasterVolume(); // 0..1

/** Текущая общая громкость (0..1) — для инициализации ползунка настроек. */
export function getMasterVolume(): number { return masterVol; }

/** Установить общую громкость (0..1): применяется к эффектам и музыке сразу. */
export function setMasterVolume(v: number): void {
  masterVol = Math.min(1, Math.max(0, v));
  sound.volumeAll = masterVol; // мяуканье + мурлыканье
  applyMusicGain();            // и фоновая музыка
  try { localStorage.setItem(VOL_KEY, String(masterVol)); } catch { /* квота/приватный режим */ }
}

/**
 * Приглушить весь звук (эффекты, хор мурлыканья, музыку) и вернуть обратно.
 * Требование площадки: на время полноэкранной рекламы звук и игровой процесс
 * ставятся на паузу (см. GDD §6.7). Позиции не сбрасываются — после рекламы
 * мурчание и трек продолжаются с того же места.
 */
export function sfxPause(on: boolean): void {
  audioPaused = on;
  if (on) {
    sound.pauseAll();
    musicStopNode(); // позиция запомнена — после рекламы трек продолжится с неё
  } else {
    sound.resumeAll();
    if (musicOn) tryPlayMusic();
  }
}

/** Зарегистрировать и предзагрузить все звуки; вызвать один раз при старте игры. */
export function initSfx(): void {
  if (meows.length) return; // повторный вызов (resize пересоздаёт комнаты, не игру)
  if (!audioCtx()) return;  // нет Web Audio — играем молча, <audio> заводить нельзя
  sound.volumeAll = masterVol; // применить сохранённую громкость к эффектам
  const reg = (urls: Record<string, string>, prefix: string, into: string[], vol: number): void => {
    Object.entries(urls).forEach(([, url], i) => {
      const alias = `${prefix}${i}`;
      into.push(alias);
      sound.add(alias, {
        url,
        preload: true,
        loaded: (_err, s) => { if (s) normalize(s, vol); },
      });
    });
  };
  reg(meowUrls, 'meow', meows, MEOW_VOL);
  reg(purrUrls, 'purr', purrs, PURR_VOL);
  // события: алиас = имя файла (levelup.mp3 → 'levelup'), громкость уже сведена
  Object.entries(eventUrls).forEach(([file, url]) => {
    sound.add(`ev:${file.replace(/^.*\/|\.mp3$/g, '')}`, { url, preload: true, volume: EVENT_VOL });
  });
}

/**
 * Звук игрового события: награда, рождение, лечение и т.п. Один файл на событие.
 * Гашение повторов считается по каждому событию отдельно: разные события
 * идут подряд по делу (пристроил кота → тут же панель «Новый уровень»), а вот
 * один и тот же звук дважды за EVENT_GAP_MS — это дребезг двойного тапа.
 */
export function sfxEvent(id: SfxEvent): void {
  const now = performance.now();
  const file = EVENT_FILE[id] ?? id; // гашение повторов считаем по ФАЙЛУ, а не по событию
  if (now - (eventAt.get(file) ?? -Infinity) < EVENT_GAP_MS) return;
  const alias = `ev:${file}`;
  if (!sound.exists(alias)) return; // initSfx ещё не звали (find бы бросил исключение)
  const s = sound.find(alias);
  if (!s.isLoaded) return; // ещё грузится — молчим, ждать событие не будет
  eventAt.set(file, now);
  s.play();
}

/** Случайное «мяу» (не то же, что в прошлый раз) со случайной высотой тона. */
export function sfxMeow(): void {
  if (!meows.length) return;
  const now = performance.now();
  if (now - lastAt < MEOW_GAP_MS) return;
  lastAt = now;
  let i = Math.floor(Math.random() * meows.length);
  if (i === lastIdx) i = (i + 1) % meows.length; // не повторяться подряд
  lastIdx = i;
  const alias = meows[i];
  if (!alias) return;
  const s = sound.find(alias);
  if (!s?.isLoaded) return; // ещё грузится — просто молчим, не ждём
  s.play({ speed: 0.92 + Math.random() * 0.16 }); // ±8% высоты — живее
}

// --- хор мурлыканья -----------------------------------------------------------
// Владелец истины — «живой пол»: каждый тик он присылает список id спящих котов
// (sfxPurrSync), а модуль сам заводит недостающие петли и мягко гасит лишние.
// Так мурчание не «утекает» при пересборке комнаты, продаже кота или уходе из
// комнаты (при смене комнаты game.ts присылает пустой список).

interface PurrEntry { inst: IMediaInstance; vol: number; out: boolean }
const purring = new Map<string, PurrEntry>();
let purrRaf = 0;
let purrPrev = 0;

/** Фейды громкости петель; крутится только пока кто-то мурчит. */
function purrTick(ts: number): void {
  const dt = Math.min(0.1, (ts - purrPrev) / 1000);
  purrPrev = ts;
  for (const [id, p] of purring) {
    p.vol += dt / (p.out ? -PURR_FADE_OUT : PURR_FADE_IN);
    if (p.out && p.vol <= 0) { p.inst.stop(); purring.delete(id); continue; }
    p.vol = Math.min(1, Math.max(0, p.vol));
    p.inst.volume = p.vol;
  }
  purrRaf = purring.size ? requestAnimationFrame(purrTick) : 0;
}

/** Сверить хор со списком спящих котов (вызывается каждый тик «живого пола»). */
export function sfxPurrSync(ids: readonly string[]): void {
  const want = new Set(ids);
  for (const [id, p] of purring) if (!want.has(id)) p.out = true; // проснулся/ушёл
  for (const id of want) {
    const cur = purring.get(id);
    if (cur) { cur.out = false; continue; } // снова заснул, пока затухал — вернуть
    if (purring.size >= PURR_MAX) break;
    const alias = purrs[Math.floor(Math.random() * purrs.length)];
    const s = alias ? sound.find(alias) : undefined;
    if (!s?.isLoaded) continue; // этот файл ещё грузится — попробуем следующего кота
    const inst = s.play({
      loop: true,
      volume: 0, // фейд поднимет до 1 (итог = volume звука × громкость петли)
      speed: 0.85 + Math.random() * 0.3,     // у каждого кота свой «тембр»,
      start: Math.random() * s.duration * 0.8, // своя фаза — петли не сливаются
    }) as IMediaInstance;
    purring.set(id, { inst, vol: 0, out: false });
  }
  if (purring.size && !purrRaf) {
    purrPrev = performance.now();
    purrRaf = requestAnimationFrame(purrTick);
  }
}

// --- фоновая музыка -----------------------------------------------------------
// Тихий сай-фай эмбиент; треки играют по кругу по очереди.
//
// Только Web Audio. Раньше трек играл через HTMLAudioElement (стриминг экономил
// память), но браузер сам заводит для любого <audio> длиннее ~5 секунд системный
// медиа-плеер: панель проигрывателя в ОС на десктопе и карточка в шторке
// уведомлений на Android. Площадка это запрещает (пп. 1.6.1.6 и 1.6.2.5
// Требований), поэтому трек декодируется и играет через AudioBufferSourceNode
// того же контекста, что и остальные звуки, — никакого медиа-элемента, а значит
// и системного плеера, в игре нет вовсе.
//
// Память: в ней держится ровно один декодированный трек (PCM тяжелее mp3 раз в
// двадцать), следующий декодируется на переходе — mp3 к тому моменту уже лежит в
// кэше браузера, так что переключение почти бесплатно.
//
// Пауза не сбрасывает позицию: переключение между «музыкальными» комнатами
// продолжает трек с того же места. Источник остановить и продолжить нельзя, но
// позицию мы считаем сами (musicOffset + прошедшее время контекста) и запускаем
// новый источник с неё.

const MUSIC_VOL = 0.22;     // негромкий фон — не спорит с мяуканьем и мурчанием
const MUSIC_FADE_IN = 1.8;  // с — мягкое появление при входе в комнату
const MUSIC_FADE_OUT = 0.8; // с — уход при выходе (пауза после затухания)

const musicList = Object.keys(musicUrls).sort().map((k) => musicUrls[k]!);
let musicIdx = 0;
let musicOn = false;
let musicVol = 0; // огибающая фейда 0..1
let musicRaf = 0;
let musicPrev = 0;
let musicUnlockHooked = false;
// Пауза висит поверх «музыка включена»: игра стоит (реклама, пауза площадки,
// свёрнутая вкладка), а комната по-прежнему «музыкальная». Держим отдельным
// флагом, потому что снять паузу вправе только sfxPause — иначе возврат на
// вкладку во время рекламного ролика запускал бы трек поверх рекламы (п. 4.7).
let audioPaused = false;

let musicGain: GainNode | null = null;              // громкость музыки, отдельно от эффектов
let musicNode: AudioBufferSourceNode | null = null; // играет прямо сейчас
let musicBuf: AudioBuffer | null = null;            // декодированный текущий трек
let musicBufIdx = -1;                               // какой трек лежит в musicBuf
let musicOffset = 0;                                // позиция в треке, с (с неё продолжим)
let musicStartedAt = 0;                             // ctx.currentTime старта musicNode
let musicLoading = false;

/** Остановить источник, запомнив позицию: продолжим ровно с этого места. */
function musicStopNode(): void {
  const node = musicNode;
  const ctx = audioCtx();
  if (!node || !ctx) return;
  musicOffset += ctx.currentTime - musicStartedAt;
  musicNode = null;
  node.onended = null; // это наша остановка, а не конец трека — не листаем дальше
  try { node.stop(); } catch { /* уже остановлен браузером */ }
  node.disconnect();
}

/** Запустить текущий буфер с сохранённой позиции. */
function musicStartNode(ctx: AudioContext, gain: GainNode): void {
  if (!musicBuf || musicNode) return;
  if (musicOffset >= musicBuf.duration) musicOffset = 0; // пауза пережила конец трека
  const node = ctx.createBufferSource();
  node.buffer = musicBuf;
  node.connect(gain);
  node.onended = (): void => { // трек доиграл — следующий по кругу
    if (musicNode !== node) return;
    musicNode = null;
    musicOffset = 0;
    musicIdx = (musicIdx + 1) % musicList.length;
    if (musicOn) tryPlayMusic();
  };
  musicStartedAt = ctx.currentTime;
  node.start(0, musicOffset);
  musicNode = node;
}

/** Скачать и декодировать трек idx (в памяти остаётся только он). */
async function musicLoad(ctx: AudioContext, idx: number): Promise<boolean> {
  if (musicBufIdx === idx && musicBuf) return true;
  const url = musicList[idx];
  if (!url || musicLoading) return false;
  musicLoading = true;
  try {
    const raw = await (await fetch(url)).arrayBuffer();
    const buf = await ctx.decodeAudioData(raw);
    musicBuf = buf;      // прежний буфер осиротел — его заберёт сборщик мусора
    musicBufIdx = idx;
    musicOffset = 0;
    return true;
  } catch {
    return false; // сеть отвалилась или файл битый — просто играем без музыки
  } finally {
    musicLoading = false;
  }
}

function musicTick(ts: number): void {
  const dt = Math.min(0.1, (ts - musicPrev) / 1000);
  musicPrev = ts;
  musicVol += dt / (musicOn ? MUSIC_FADE_IN : -MUSIC_FADE_OUT);
  musicVol = Math.min(1, Math.max(0, musicVol));
  applyMusicGain();
  if (!musicOn && musicVol <= 0) { musicStopNode(); musicRaf = 0; return; }
  // фейд дошёл до 1 — можно не крутиться; выключение снова запустит цикл
  musicRaf = musicOn && musicVol >= 1 ? 0 : requestAnimationFrame(musicTick);
}

function musicKick(): void {
  if (!musicRaf) {
    musicPrev = performance.now();
    musicRaf = requestAnimationFrame(musicTick);
  }
}

/** Применить громкость музыки (своя огибающая фейда × общий ползунок). */
function applyMusicGain(): void {
  if (musicGain) musicGain.gain.value = MUSIC_VOL * musicVol * masterVol;
}

function tryPlayMusic(): void {
  if (audioPaused || !musicOn) return; // пауза уйдёт — вернёт sfxPause(false)
  const ctx = audioCtx();
  if (!ctx) return;                    // без Web Audio музыки не будет (см. выше)

  if (!musicGain) {
    musicGain = ctx.createGain();
    musicGain.gain.value = 0;
    musicGain.connect(ctx.destination);
    applyMusicGain();
  }
  // до первого жеста игрока контекст спит: будим его и на всякий случай
  // повторяем попытку по первому тапу — обещание resume() может и не сбыться
  if (ctx.state !== 'running') {
    void ctx.resume().catch(() => { /* жеста ещё не было */ });
    if (!musicUnlockHooked) {
      musicUnlockHooked = true;
      const unlock = (): void => {
        window.removeEventListener('pointerdown', unlock);
        musicUnlockHooked = false;
        if (musicOn) tryPlayMusic();
      };
      window.addEventListener('pointerdown', unlock);
    }
  }

  if (musicBufIdx !== musicIdx || !musicBuf) {
    const want = musicIdx;
    void musicLoad(ctx, want).then((ok) => {
      // пока декодировали, комнату могли сменить или включить паузу
      if (ok && musicOn && musicIdx === want) tryPlayMusic();
    });
    return;
  }
  musicStartNode(ctx, musicGain);
}

/** Включить/выключить фоновую музыку. Идемпотентно; вызывается при смене комнаты. */
export function sfxMusic(on: boolean): void {
  if (!musicList.length || on === musicOn) return;
  musicOn = on;
  if (on) tryPlayMusic();
  musicKick();
}
