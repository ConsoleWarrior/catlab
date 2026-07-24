/**
 * Звуковые эффекты. Библиотека — @pixi/sound (WebAudio): сама снимает блокировку
 * автоплея по первому тапу и ставит звук на паузу при сворачивании вкладки.
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

const TARGET_RMS = 0.08; // ориентир «нормальной» громкости (≈ −22 дБFS)
const GAIN_MIN = 0.25;   // пределы автоподстройки: совсем тихая запись не должна
const GAIN_MAX = 3;      //   улететь в шум, громкая — в клиппинг
const MEOW_VOL = 0.7;    // базовая громкость мяуканья после выравнивания
const MEOW_GAP_MS = 180; // тапают чаще — новые мяу не запускаем (иначе каша)

const PURR_VOL = 0.06;     // еле слышно: один кот почти не заметен, хор — заметен
const PURR_MAX = 10;       // предел одновременных петель — дальше хор уже не растёт
const PURR_FADE_IN = 1.5;  // с — мурчание «разгоняется» мягко, как засыпание
const PURR_FADE_OUT = 0.6; // с — затухание при пробуждении (без щелчка обрыва)

const meows: string[] = [];
const purrs: string[] = [];
let lastAt = 0;
let lastIdx = -1;

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

/** Зарегистрировать и предзагрузить все звуки; вызвать один раз при старте игры. */
export function initSfx(): void {
  if (meows.length) return; // повторный вызов (resize пересоздаёт комнаты, не игру)
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
    if (!s?.isLoaded) return; // ещё грузится — заведём на следующем тике
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
// Тихий сай-фай эмбиент; треки играют по кругу по очереди. Через HTMLAudioElement
// (стриминг), а не WebAudio: длинные треки не декодируются в память целиком —
// важно для мобильных. Пауза не сбрасывает позицию: переключение между
// «музыкальными» комнатами продолжает трек с того же места.

const MUSIC_VOL = 0.22;     // негромкий фон — не спорит с мяуканьем и мурчанием
const MUSIC_FADE_IN = 1.8;  // с — мягкое появление при входе в комнату
const MUSIC_FADE_OUT = 0.8; // с — уход при выходе (пауза после затухания)

const musicList = Object.keys(musicUrls).sort().map((k) => musicUrls[k]!);
let musicEl: HTMLAudioElement | null = null;
let musicIdx = 0;
let musicOn = false;
let musicVol = 0; // огибающая фейда 0..1
let musicRaf = 0;
let musicPrev = 0;
let musicUnlockHooked = false;

function musicTick(ts: number): void {
  const dt = Math.min(0.1, (ts - musicPrev) / 1000);
  musicPrev = ts;
  musicVol += dt / (musicOn ? MUSIC_FADE_IN : -MUSIC_FADE_OUT);
  musicVol = Math.min(1, Math.max(0, musicVol));
  if (musicEl) musicEl.volume = MUSIC_VOL * musicVol;
  if (!musicOn && musicVol <= 0) { musicEl?.pause(); musicRaf = 0; return; }
  // фейд дошёл до 1 — можно не крутиться; выключение снова запустит цикл
  musicRaf = musicOn && musicVol >= 1 ? 0 : requestAnimationFrame(musicTick);
}

function musicKick(): void {
  if (!musicRaf) {
    musicPrev = performance.now();
    musicRaf = requestAnimationFrame(musicTick);
  }
}

function tryPlayMusic(): void {
  musicEl?.play().catch(() => {
    // автоплей заблокирован до первого жеста игрока — повторим по первому тапу
    if (musicUnlockHooked) return;
    musicUnlockHooked = true;
    const unlock = (): void => {
      window.removeEventListener('pointerdown', unlock);
      musicUnlockHooked = false;
      if (musicOn) tryPlayMusic();
    };
    window.addEventListener('pointerdown', unlock);
  });
}

/** Включить/выключить фоновую музыку. Идемпотентно; вызывается при смене комнаты. */
export function sfxMusic(on: boolean): void {
  if (!musicList.length || on === musicOn) return;
  musicOn = on;
  if (on) {
    if (!musicEl) {
      const el = new Audio();
      el.preload = 'auto';
      el.volume = 0;
      el.addEventListener('ended', () => { // следующий трек — по кругу
        musicIdx = (musicIdx + 1) % musicList.length;
        el.src = musicList[musicIdx]!;
        if (musicOn) tryPlayMusic();
      });
      el.src = musicList[musicIdx]!;
      musicEl = el;
      // вкладку свернули — пауза (сами эффекты @pixi/sound делают это за себя)
      document.addEventListener('visibilitychange', () => {
        if (!musicEl) return;
        if (document.hidden) musicEl.pause();
        else if (musicOn) tryPlayMusic();
      });
    }
    tryPlayMusic();
  }
  musicKick();
}
