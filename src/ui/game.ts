/**
 * Game — контроллер игрового UI (Этап 4).
 * Разрез лаборатории: 4 комнаты в ряд, свайп-навигация, фиксированный HUD
 * ресурсов, оверлеи (меню кота, заказы), тикер с таймерами и пассивным
 * доходом, автосейв в localStorage и офлайн-доход при возврате.
 */

import {
  Application, Assets, Container, Graphics, Rectangle, Sprite, Text,
} from 'pixi.js';
import type { Texture, FederatedPointerEvent } from 'pixi.js';
import { makeRng, randomCat, expressPhenotype, pick, BREEDS } from '../genetics/index.js';
import type { Recipe, Rng } from '../genetics/index.js';
import type { Sex } from '../genetics/index.js';
import { buildCat } from '../render/catSprite.js';
import {
  createInitialState, serialize, deserialize, collectIncome, collectReady,
  netIncomePerMin, SAVE_VERSION, makeCatInstance, startBreeding,
  moveCat, clearBreederSlot, keepKittenWithParents,
  nextLevelRep, unlocksAtLevel, levelCrystalReward, LEVEL_REP_THRESHOLDS, MAX_LEVEL, addReputation,
  foodRatePerMin, isStarving, autoFeedEnabled, buyFood, cryoUnlocked,
  finishRecipeResearch, refreshExpiredOrders,
  grantCrystals, isKnownPack, allBreedsBred, canAskReview, noteReviewAsked,
  tutorialActive, tutorialStep, finishTutorial, restartTutorial,
  markTutorialSeen, grantTutorialReward, TUTORIAL_REWARD_COINS, TUTORIAL_REWARD_CRYSTALS,
  OFFLINE_REPORT_MIN_MS,
} from '../game/index.js';
import { isBusy, isInSlot, isAdult, freezeCat } from '../game/index.js';
import type { Cat, GameState, BirthEvent, Ancestor } from '../game/index.js';
import type { GrabOpts, Room, UiContext } from './context.js';
import { Button, COLORS, fmt, label, setUiBlocked } from './theme.js';
import { catTexture, setAiBreedTexture, aiHeldSpriteFor, rarityGlow, GLOW_OUT } from './catTextures.js';
import { loadEyeData } from './eyeBlink.js';
import { initSfx, sfxEvent, sfxMeow, sfxMusic, sfxPause, sfxPurrSync } from './sound.js';
import { setRoomBg } from './roomArt.js';
import { setDecorTexture } from './decorArt.js';
import { Tutorial } from './tutorial.js';
import { createFpsMeter, type FpsMeter } from './devFps.js'; // ⚠️ ВРЕМЕННОЕ DEV — убрать перед релизом
import { DEVTOOLS } from './devTools.js';                    // ⚠️ ВРЕМЕННОЕ DEV — убрать перед релизом
import { createIncubator } from './rooms/incubator.js';
import { createNursery } from './rooms/nursery.js';
import { createShelter } from './rooms/shelter.js';
import { createGenolab } from './rooms/genolab.js';
import { createCryobank } from './rooms/cryobank.js';
import {
  buildCatMenu, buildOrdersPanel, buildBirthCard, buildPedigreePanel, buildTutorialDonePanel,
  buildBoostMenu, buildAdoptConfirm, buildLabConfirm, buildBulkAdoptConfirm, buildBulkLabConfirm,
  buildHealConfirm, buildCryoMenu, buildGrowConfirm,
  buildFreezeConfirm, buildAnalyzeConfirm, buildBreedCard, buildRecipeRevealPanel, buildPairPreview,
  buildDevMenu, buildResearchConfirm, buildSettingsPanel, buildShopPanel, buildOfflineReport,
  buildLevelUpPanel, buildAllBreedsPanel, buildPrivacyPanel, buildResetConfirm, buildOrderRefreshConfirm,
} from './overlays.js';
import type { OfflineReport, LevelUpInfo } from './overlays.js';
import { buildRoomHelpPanel } from './roomHelp.js';
import {
  initPlatform, loadingReady, gameplayStart, gameplayStop, setPlatformPauseHandler, platformLang,
  setLatePlayerHandler,
} from '../platform/ysdk.js';
import { canOfferReview, requestReview } from '../platform/ysdk.js';
import { loadSaveCandidates, writeSave, writeSaveAwait, adoptLatePlayer, resetSave } from '../platform/storage.js';
import { initPayments, shopAvailable, buyPack } from '../platform/payments.js';
import { setAdPauseHandler, adRecently } from '../platform/ads.js';
import { initLang, t, onLangChange, setLang } from '../i18n.js';

// --- Виртуальное разрешение (требования Яндекс Игр, п. 1.6 и 1.10) ---
// Сцена всегда DESIGN_H виртуальных пикселей в высоту; ширина = высота × аспект
// окна, зажатый в допустимый диапазон. Канвас занимает всё окно, а корневой
// контейнер (root) равномерно масштабируется и центрируется: при ресайзе окна
// вся картинка растёт/уменьшается пропорционально (п. 1.6.2.3), игровое поле
// касается краёв окна хотя бы по одной оси (п. 1.6.2.1), остаток — леттербокс
// цвета фона. Весь UI продолжает считать раскладку от roomW×roomH — но теперь
// это стабильные виртуальные размеры, а не пиксели окна.
// На тач-устройствах виртуальная высота меньше: каждый виртуальный пиксель
// физически крупнее, весь UI (текст, кнопки, коты) растёт — на телефоне 720
// было нечитаемо мелко. Вёрстка не ломается: раскладка везде считается от
// roomW×roomH. Ручка укрупнения мобильной сцены — TOUCH_ZOOM: во сколько раз
// всё крупнее, чем на ПК (1 = как на десктопе). Больше зум — крупнее текст,
// кнопки и коты, но меньше площади комнаты влезает в кадр.
const IS_TOUCH = typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches;
const TOUCH_ZOOM = 1.47;
const DESIGN_H = IS_TOUCH ? Math.round(720 / TOUCH_ZOOM) : 720;
// уже 4:3 не сжимаемся (полосы сверху/снизу) — напр. портрет на мобиле, где
// платформа при одной поддерживаемой ориентации сама показывает заглушку
const MIN_ASPECT = 4 / 3;
// на десктопе длинная сторона поля не более чем вдвое больше короткой
// (п. 1.6.2.2); на телефонах лимита нет (п. 1.6.1 — полный экран), поэтому на
// тач-устройствах заполняем экран целиком (современные телефоны ≤ ~2.4:1)
const MAX_ASPECT = IS_TOUCH ? 2.5 : 2;

// Последний срок, когда лоадер платформы снимается в любом случае (см. start()).
// Больше обычного старта с запасом: 14.6 МБ ассетов на медленной мобильной сети
// грузятся дольше, чем на стенде, а снятый раньше времени лоадер показал бы
// игроку пустую сцену.
const START_FAILSAFE_MS = 25_000;

export class Game implements UiContext {
  readonly app = new Application();
  state!: GameState;
  readonly rng: Rng = makeRng(Math.floor(Math.random() * 1e9));
  roomW = 0;
  roomH = 0;
  topInset = 56;
  selection: string[] = [];
  private freshGame = false;

  // Корень сцены — единственный узел, который масштабируется под окно (см.
  // fitRoot). Всё игровое UI живёт внутри него в виртуальных координатах.
  private readonly root = new Container();
  // Маска по границе игрового поля: без неё в полосах леттербокса просвечивают
  // соседние комнаты (лента world шире одной комнаты). Перерисовывается в layout().
  private readonly rootMask = new Graphics();
  private relayoutTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly world = new Container();
  private readonly hud = new Container();
  private readonly nav = new Container();
  private readonly dragLayer = new Container();
  private readonly overlayLayer = new Container();
  // текущий открытый оверлей (для перекладки под новый размер экрана при ресайзе,
  // см. layout()) — иначе после ресайза окна панель остаётся старого размера/
  // позиции и «уезжает» от центра или обрезается краем экрана.
  private overlayDim: Graphics | null = null;
  private overlayContent: Container | null = null;
  // Открыты ли ⚙️ Настройки: единственная панель, которую нужно вернуть на место
  // после пересборки сцены (смена языка происходит как раз из неё).
  private settingsOpen = false;
  private readonly toastBox = new Container();
  // Обучение новичка (FTUE): мягкая подсветка цели + плашка с подсказкой.
  // Слой лежит ВЫШЕ оверлеев: на шаге «второго кота» подсказка обязана читаться
  // поверх открытого меню кота, где и находится нужная кнопка.
  private tutorial!: Tutorial;
  // ⚠️ ВРЕМЕННОЕ DEV: счётчик FPS (кнопка 📊 в топбаре) — см. devFps.ts, убрать перед релизом.
  private devFps: FpsMeter | null = null;
  private adPaused = false;
  // Причины, по которым игра сейчас стоит: 'ad' — показ рекламы (наш вызов),
  // 'platform' — пауза от площадки (её реклама, окно покупок, уход со вкладки),
  // 'hidden' — вкладка свёрнута. Набор, а не флаг: причины накладываются, и
  // снимать паузу можно только когда ушла последняя.
  private readonly pauseReasons = new Set<string>();
  private rooms: Room[] = [];
  // Комнаты, чей вид отстал от состояния. Пересобирается только видимое (см.
  // commit/refreshVisibleRooms) — полная пересборка всех пяти комнат на каждое
  // действие игрока и была причиной подвисаний на мобиле.
  private roomDirty: boolean[] = [];
  private hasCryoRoom = false;   // включена ли 5-я комната Крио-банк (по cryoUnlocked)
  private cryoRebuildPending = false; // отложенная пересборка ряда при открытии крио-банка
  private currentRoom = 0;
  private targetX = 0;

  // навигация мышью/тачем
  private pointerActive = false;
  private dragging = false;
  private startPx = 0;
  private startPy = 0;
  private startWorldX = 0;
  // ось жеста: выбираем по первому движению, чтобы свайп комнат и вертикальная
  // прокрутка контента не срабатывали одновременно (см. UiContext.gestureAxis).
  private axisLock: 'none' | 'h' | 'v' = 'none';

  // фокус на коте, чьё инфо-меню открыто (см. infoFocus в UiContext)
  private catInfoFocus: { id: string; frozen: boolean; iconUntil: number } | null = null;

  // взятие котика за шкирку
  private pendingGrab: { opts: GrabOpts; sx: number; sy: number } | null = null;
  private grab: {
    opts: GrabOpts; sprite: Container; glow?: Sprite; baseScale: number;
    x: number; y: number; cx: number; cy: number; vx: number; t: number; pop: number;
    originRoom: number; edgeCd: number;
  } | null = null;

  // HUD-ссылки
  private coinsT!: Text;
  private rateT!: Text;          // доход/мин рядом с деньгами
  private crystalsT!: Text;
  private dnaT!: Text;
  private levelT!: Text;
  private levelBar!: Graphics;   // прогресс опыта до следующего уровня (под ⭐ Ур.)
  private shopBtn: Button | null = null; // «+» у счётчика 💎 (появляется, когда доступны покупки)
  private shownLevel = 1;        // последний показанный уровень (для баннера повышения)
  private dots: Graphics[] = [];
  private hudPad = 0;            // левый отступ ряда ресурсов
  private hudGap = 0;            // зазор между ресурсами в ряду
  private hudBgTex?: Texture;    // текстурный фон топ-бара

  // прочее
  private incomeAcc = 0;
  private saveTimer = 0;
  private saveDirty = false;    // есть несохранённые изменения (см. commit/update)
  private resizePending = false; // ресайз пришёл при открытом поле ввода (см. resize)
  private wasStarving = false;   // для тоста «корм закончился» ровно при переходе к голоду
  // Отчёт «С возвращением» посчитан при загрузке сейва — но сцены тогда ещё нет,
  // поэтому окно показывается в конце start() (см. applyOffline).
  private pendingOffline: OfflineReport | null = null;
  // Повышение уровня лаборатории ждёт показа панелью: копится в checkLevelUp (из
  // любого источника опыта), показывается в update, когда экран свободен от оверлеев.
  private pendingLevelUp: LevelUpInfo | null = null;
  // Финал обучения ждёт показа панелью «Обучение пройдено» с подарком и кнопкой
  // «Забрать» (ставится в Tutorial.finish, показывается в update на свободном экране).
  private pendingTutorDone = false;
  // Финал коллекции: выведены ВСЕ породы. Ставится в checkAllBreeds (флаг в сейве
  // взводится там же — панель одноразовая), показывается в update на свободном экране.
  private pendingAllBreeds = false;
  // «Пик радости» случился — можно предложить оценить игру. Показывается в update,
  // когда экран свободен от всех окон и рядом нет рекламы (см. wantReview/askReview).
  private pendingReview = false;
  private toastT: Text | null = null;
  private toastUntil = 0;

  now(): number { return Date.now(); }

  /**
   * Запуск игры. Тело вынесено в boot(): здесь стоит единственная гарантия, что
   * лоадер платформы будет снят при ЛЮБОМ исходе (п. 1.19.2).
   *
   * Без неё любая ошибка старта — нет WebGL на машине проверяющего, сбой сборки
   * комнаты, недоступное хранилище — оставляла игрока перед вечным лоадером
   * портала: `ready()` стоял в конце счастливого пути и просто не доживал.
   * Страховочный таймер закрывает и третий случай — когда старт не упал, а
   * «завис» на чём-то внешнем.
   */
  async start(reset = false): Promise<void> {
    const failsafe = setTimeout(loadingReady, START_FAILSAFE_MS);
    try {
      await this.boot(reset);
    } catch (err) {
      this.showStartupFailure(err);
    } finally {
      clearTimeout(failsafe);
      loadingReady(); // идемпотентно: повторный вызов ничего не делает
    }
  }

  /**
   * Старт не удался. Показываем человеческое сообщение вместо чёрного экрана и
   * стека в консоли: п. 1.14 — «нет технических сообщений». Рисуем средствами
   * DOM, потому что до Pixi дело могло и не дойти (например, нет WebGL).
   */
  private showStartupFailure(err: unknown): void {
    console.error('[catlab] старт не удался', err);
    const host = document.getElementById('app');
    if (!host) return;
    const box = document.createElement('div');
    box.style.cssText = 'position:fixed;inset:0;display:flex;flex-direction:column;'
      + 'align-items:center;justify-content:center;gap:14px;padding:24px;text-align:center;'
      + 'background:#fdf3e7;color:#5a4a42;font:600 18px system-ui,sans-serif;z-index:20';
    const cat = document.createElement('div');
    cat.style.fontSize = '56px';
    cat.textContent = '🙀';
    const text = document.createElement('p');
    text.textContent = t('Не получилось загрузить игру. Обновите страницу.',
      'The game could not load. Please refresh the page.');
    box.append(cat, text);
    host.appendChild(box);
  }

  private async boot(reset: boolean): Promise<void> {
    // SDK платформы поднимаем параллельно со шрифтом и ассетами: его ждёт только
    // загрузка сейва (облако), всему остальному он не нужен.
    const platform = initPlatform();

    // Ждём готовности Rubik (локальный woff2, @font-face в index.html)
    try { await document.fonts.ready; } catch { /* fallback */ }

    await this.app.init({
      background: COLORS.bg,
      antialias: true,
      resolution: Math.min(window.devicePixelRatio || 1, 2),
      autoDensity: true,
    });
    document.getElementById('app')!.appendChild(this.app.canvas);

    await platform;
    initLang(platformLang()); // язык игрока из SDK (п. 2.14) — сразу после подъёма платформы
    await this.loadState(reset);
    this.shownLevel = this.state.level; // база для баннера повышения уровня
    this.wasStarving = isStarving(this.state); // не спамить тостом «корм закончился» на первом кадре

    initSfx(); // звуки грузятся в фоне, ждать не нужно — до первого тапа успеют

    // Готовый арт коллекции: варианты всех пород `<breed>__<n>.webp` (включая
    // базовые T1: moggie и домашних), без привязки к полу. Грузим до сборки комнат;
    // вис делаем из той же текстуры. Нет ассета → кот рисуется процедурно (фолбэк).
    const breedAssets = import.meta.glob('../assets/breeds/*.webp', {
      eager: true, query: '?url', import: 'default',
    }) as Record<string, string>;

    await Promise.all(Object.entries(breedAssets).map(async ([path, url]) => {
      const name = path.split('/').pop()!.replace('.webp', ''); // <breed>__<n>
      try { setAiBreedTexture(name, await Assets.load(url)); } catch { /* фолбэк */ }
    }));
    await loadEyeData(); // свежая разметка глаз (DEV) до сборки комнат

    // Готовые фоны комнат («комната-коробка» в нашей перспективе) — по имени файла
    // = id комнаты. Нет фона → процедурная коробка (фолбэк в roomShell).
    const roomAssets = import.meta.glob('../assets/rooms/*.webp', {
      eager: true, query: '?url', import: 'default',
    }) as Record<string, string>;
    await Promise.all(Object.entries(roomAssets).map(async ([path, url]) => {
      const id = path.split('/').pop()!.replace('.webp', '');
      try { setRoomBg(id, await Assets.load(url)); } catch { /* фолбэк на коробку */ }
    }));

    // Декор комнат (интерьерные спрайты, расставленные в Декор-лабе) — по имени файла
    // = ключ текстуры. Расстановка задана в decorArt.ts; нет текстуры → спрайт пропускается.
    const decorAssets = import.meta.glob('../assets/decor/*.webp', {
      eager: true, query: '?url', import: 'default',
    }) as Record<string, string>;
    await Promise.all(Object.entries(decorAssets).map(async ([path, url]) => {
      const name = path.split('/').pop()!.replace('.webp', '');
      try { setDecorTexture(name, await Assets.load(url)); } catch { /* спрайт пропустится */ }
    }));

    // ИИ-текстуры инкубатора: фоны-боксы слотов вязки (slotbox_*) и текстуры
    // кнопок усилителей (boost_<id>). Тот же реестр decorArt, ключ = имя файла.
    const incubatorAssets = import.meta.glob('../assets/{slotbox,boost}/*.webp', {
      eager: true, query: '?url', import: 'default',
    }) as Record<string, string>;
    await Promise.all(Object.entries(incubatorAssets).map(async ([path, url]) => {
      const name = path.split('/').pop()!.replace('.webp', '');
      try { setDecorTexture(name, await Assets.load(url)); } catch { /* фолбэк на процедурный вид */ }
    }));

    // Текстура фона топ-бара HUD (пергамент/винтаж) — заменяет белый procedural fill.
    const hudAssets = import.meta.glob('../assets/hud/*.webp', {
      eager: true, query: '?url', import: 'default',
    }) as Record<string, string>;
    for (const url of Object.values(hudAssets)) {
      try { this.hudBgTex = await Assets.load(url); break; } catch { /* останется белый фон */ }
    }

    this.app.stage.eventMode = 'static';
    this.app.stage.addChild(this.root);
    this.tutorial = new Tutorial({
      ctx: this,
      roomIndexById: (id) => this.roomIndex(id),
      currentRoomIndex: () => this.currentRoom,
      anchorIn: (i, key) => this.rooms[i]?.anchor?.(key) ?? null,
      navDot: (i) => this.dots[i] ?? null,
      topReserve: () => this.rooms[this.currentRoom]?.topReserve ?? null,
      overlayOpen: () => this.overlayOpen,
      skip: () => {
        finishTutorial(this.state); this.commit();
        this.toast(t('Подсказки выключены — справка по кнопке ℹ️ у названия комнаты',
          'Hints are off — help is behind the ℹ️ button next to the room title'));
      },
      finish: () => {
        // Обучение закрываем сразу (иначе Tutorial.update звал бы finish каждый кадр),
        // а поздравление с подарком ставим в очередь: покажем панелью, когда экран
        // свободен от оверлеев. Подарок начисляется по кнопке «Забрать» в ней
        // (крестик «пропустить» подарка не даёт вовсе — см. skip выше).
        finishTutorial(this.state);
        this.commit();
        this.save();
        this.pendingTutorDone = true;
      },
    });
    this.root.addChild(
      this.world, this.hud, this.nav, this.dragLayer, this.overlayLayer,
      this.tutorial.layer, this.toastBox, this.rootMask,
    );
    this.root.mask = this.rootMask;
    // ⚠️ ВРЕМЕННОЕ DEV: панель FPS поверх всего, кроме маски (кнопка 📊 в топбаре).
    if (DEVTOOLS) {
      this.devFps = createFpsMeter(this.app);
      this.root.addChildAt(this.devFps.layer, this.root.children.indexOf(this.rootMask));
    }
    // Тост и слой «кота в руках» — чисто визуальные. Без этого пустой тост-контейнер
    // (по центру внизу, roomW/2 × roomH-56) своими границами перехватывал хит-тест и
    // не пускал тапы к кнопкам под ним — это и был баг «кнопки над навигацией не
    // кликаются» (центр-низ, и на ПК, и на мобиле). 'none' убирает весь поддерево из
    // обработки событий, на отрисовку/анимацию тоста не влияет.
    this.toastBox.eventMode = 'none';
    this.dragLayer.eventMode = 'none';

    this.resize();
    this.installInput();
    this.app.ticker.add((t) => this.update(Math.min(t.deltaMS / 1000, 0.05)));

    // Первый запуск: начинаем в Питомнике — там стартовая пара, с неё и ведёт
    // обучение (src/ui/tutorial.ts). Инструкции-стены «Как играть» больше нет
    // вовсе: её заменили пошаговый туториал и справки комнат (ℹ️).
    // При ?reset (скриншоты) не трогаем ни то, ни другое.
    if (this.freshGame && !reset) this.goRoom(this.roomIndex('nursery'));

    // сцена собрана и отвечает на тапы — платформе можно убрать свой лоадер
    loadingReady();
    gameplayStart();

    // Отчёт «С возвращением» (посчитан в applyOffline при загрузке сейва) — с
    // небольшой паузой, чтобы игрок сначала увидел свою лабораторию, а уже потом
    // окно поверх неё.
    if (this.pendingOffline) setTimeout(() => this.showOfflineReport(), 700);

    // Смена языка (⚙️ Настройки): тексты уже созданы объектами Pixi, поэтому
    // сцену пересобираем целиком — как при ресайзе. Панель настроек открываем
    // заново, чтобы игрок увидел результат там же, где переключал.
    onLangChange(() => {
      const wasSettings = this.settingsOpen;
      this.closeOverlay();
      this.layout();
      // Панель возвращаем СЛЕДУЮЩИМ тиком: сейчас мы внутри обработки тапа по
      // кнопке языка, и общий «тап мимо панели закрывает оверлей» успел бы
      // захлопнуть только что открытое окно.
      if (wasSettings) setTimeout(() => this.openSettings(), 0);
    });

    // Пауза на время рекламы 📺 за награду (п. 4.7). Висит на общей обвязке
    // показа, поэтому работает для всех восьми кнопок 📺, где бы их ни звали.
    setAdPauseHandler((on) => this.setPause('ad', on));
    // И пауза, которую присылает сама площадка: её собственная реклама поверх
    // игры, окно покупок, уход со вкладки (game_api_pause / game_api_resume).
    setPlatformPauseHandler((on) => this.setPause('platform', on));

    // SDK мог опоздать к старту (медленная сеть) — тогда игра уже идёт на
    // локальном сейве. Хранилище сверит его с облаком: если в облаке прогресс
    // свежее (играли с другого устройства), запись туда закрывается, чтобы его
    // не затереть, и мы честно говорим об этом игроку.
    setLatePlayerHandler(() => {
      void adoptLatePlayer().then((ok) => {
        if (ok) return;
        this.toast(t('В облаке есть сохранение новее — перезапустите игру, чтобы продолжить с него',
          'A newer save is in the cloud — restart the game to continue from it'));
      });
    });

    // Магазин поднимаем в фоне: пока каталог не пришёл, кнопка 💎+ просто скрыта
    // (updateHud проверяет доступность каждый кадр). Здесь же платформа отдаёт
    // зависшие покупки — их доначисление обязательно для модерации.
    void initPayments({
      grant: (productId, token) => {
        // Товар, которого эта сборка не знает, гасить нельзя — вернём 'unknown'.
        if (!isKnownPack(productId)) return { status: 'unknown', crystals: 0 };
        const r = grantCrystals(this.state, productId, token);
        return r.ok ? { status: 'granted', crystals: r.crystals } : { status: 'already', crystals: 0 };
      },
      saveAwait: () => writeSaveAwait(serialize(this.state)),
    }).then((restored) => {
      if (!restored) return;
      this.commit();
      this.toast(t(`Покупка зачислена: 💎 +${restored}`, `Purchase credited: 💎 +${restored}`));
    });

    // Автосейв при сворачивании/закрытии — с flush: облачная запись уходит
    // немедленно, дожидаться её в beforeunload всё равно нельзя. Заодно глушим
    // звук: п. 1.3 требований — «при сворачивании страницы с игрой на десктопных
    // и мобильных устройствах звук останавливается». Ждать game_api_pause от
    // площадки тут нельзя: вне платформы его не будет вовсе.
    document.addEventListener('visibilitychange', () => {
      const hidden = document.hidden;
      this.setPause('hidden', hidden); // отсюда же уходит gameplayStop/Start
      if (hidden) { this.save(true); return; }
      // вкладку разморозили: пока она была скрыта, доход не капал — доначисляем
      // за пропущенное время и показываем тот же отчёт, что и при входе в игру
      this.resumeFromBackground();
    });
    // Переход в другое окно или приложение БЕЗ сворачивания вкладки (второй
    // монитор, оконный режим) visibilitychange не даёт — а звук по п. 1.3 обязан
    // замолчать и там. Снимаем причину не только по focus: реклама и окно покупок
    // забирают фокус и не всегда возвращают его сами, поэтому любое касание сцены
    // тоже означает «игрок здесь».
    const wake = (): void => this.setPause('blur', false);
    window.addEventListener('blur', () => this.setPause('blur', true));
    window.addEventListener('focus', wake);
    this.app.canvas.addEventListener('pointerdown', wake);
    window.addEventListener('beforeunload', () => this.save(true));
    // iOS Safari при закрытии вкладки и уходе в bfcache часто не шлёт
    // beforeunload — там последний шанс сохраниться именно pagehide (п. 1.9).
    window.addEventListener('pagehide', () => this.save(true));
    // Канвас привязан к visualViewport — реально видимой области. На мобиле
    // layout-вьюпорт (window.innerHeight) часто больше: низ канваса уходит под
    // адресную строку и под навигацией появляется «пустая полоса». visualViewport
    // даёт точную видимую высоту, поэтому навигация всегда у настоящего низа.
    const onResize = (): void => this.resize();
    window.addEventListener('resize', onResize);
    // Поле ввода имени могло съесть ресайз окна (см. resize) — как только фокус
    // ушёл, догоняем пропущенное. Следующим тиком: на момент focusout поле ещё
    // числится активным.
    document.addEventListener('focusout', () => {
      if (this.resizePending) setTimeout(onResize, 0);
    });
    window.addEventListener('orientationchange', () => setTimeout(onResize, 250));
    window.visualViewport?.addEventListener('resize', onResize);
    window.visualViewport?.addEventListener('scroll', onResize);

    if (DEVTOOLS) {
      (window as unknown as { __game: unknown }).__game = {
        app: this.app, state: this.state,
        goRoom: (i: number) => this.goRoom(i),
        openOrders: () => this.openOrders(),
        orderRefresh: (id?: string) => this.openOrderRefreshConfirm(id ?? this.state.orders[0]?.id ?? ''),
        openRoomHelp: (id = 'incubator') => this.openRoomHelp(id),
        openSettings: () => this.openSettings(),
        openPrivacy: () => this.openPrivacy(),
        openReset: () => this.openResetConfirm(),
        setLang: (l: 'ru' | 'en') => setLang(l), // DEV: проверка переключения языка
        openShop: () => this.openShop(),
        shopAvailable: () => shopAvailable(),
        buyPack: (id: string) => buyPack(id).then((r) => { this.commit(); return r; }),
        openDev: () => this.openDevMenu(),
        fps: () => this.devFps?.toggle(), // панель FPS из консоли (кнопка 📊 в топбаре)
        // окно «С возвращением» без реальной отлучки (по умолчанию — обрезка потолком)
        offlineReport: (r: Partial<OfflineReport> = {}) => {
          this.pendingOffline = {
            coins: 1240, awayMin: 190, incomeMin: 120,
            cappedByTime: true, cappedByFood: false, born: 2, rep: 40, ...r,
          };
          this.showOfflineReport();
        },
        openBoostMenu: (id = 'tierUp') => this.openBoostMenu(id),
        openCatMenu: (id?: string) => {
          const c = id ? this.state.cats.find((x) => x.id === id) : this.state.cats[0];
          if (c) this.openCatMenu(c);
        },
        openHeal: (id?: string) => { // диалог ветеринара (проверка UI лечения)
          const c = id ? this.state.cats.find((x) => x.id === id) : this.state.cats[0];
          if (c) this.openHealConfirm(c);
        },
        openAdopt: (id?: string) => { // окно «в добрые руки» (проверка шага обучения)
          const c = id ? this.state.cats.find((x) => x.id === id) : this.state.cats[0];
          if (c) this.openAdoptConfirm(c);
        },
        openAnalyze: (id?: string) => { // окно Генетического анализа (💰+🧬 / 💎 / 📺)
          const c = id ? this.state.cats.find((x) => x.id === id) : this.state.cats[0];
          if (c) this.openAnalyzeConfirm(c);
        },
        openPedigree: (id?: string) => { // дерево родословной живого кота (с туманом)
          const c = id ? this.state.cats.find((x) => x.id === id) : this.state.cats[0];
          if (c) this.openPedigree(c);
        },
        pedigreeDemo: () => {
          const base = this.state.cats[0];
          if (!base) return;
          let demoId = 0;
          // known: true — демо показывает полностью вскрытое дерево (без тумана)
          const A = (breed: string, mother?: Ancestor, father?: Ancestor): Ancestor =>
            ({ id: 'demo' + demoId++, breed, known: true, mother, father });
          const demo: Cat = {
            ...base, name: undefined, breed: 'moggie', rarityTier: 'common',
            motherBreed: 'abyssinian', fatherBreed: 'manx',
            pedigree: {
              mother: A('abyssinian',
                A('persian', A('bengal'), A('american_shorthair')),
                A('siamese', A('savannah'), A('toyger'))),
              father: A('manx',
                A('sphynx', A('egyptian_mau'), A('norwegian_forest')),
                A('russian_blue', A('scottish_fold'), A('himalayan'))),
            },
          };
          this.openPedigree(demo);
        },
        closeOverlay: () => this.closeOverlay(),
        give: (c = 5000, x = 50, d = 500) => { this.state.coins += c; this.state.crystals += x; this.state.dna += d; this.commit(); },
        xp: (n = 200) => { addReputation(this.state, n); this.commit(); }, // +опыт → проверка уровней/HUD/замков

        demo: () => this.demo(),
        demoGrab: () => this.demoGrab(),
        collection: () => this.collection(),
        birth: () => this.devBirth(),
        lab: (s = 'codex') => {
          this.rooms.find((r) => r.id === 'genolab')?.setSection?.(s);
          this.goRoom(3);
        },
        cryo: () => { // открыть крио-банк, заморозить котов, перейти в комнату
          this.state.research.r_sel_cryo = 2; // 1-й ранг открывает + капсулы
          this.state.dna += 3000;
          const now = this.now();
          const pool = this.state.cats
            .filter((c) => isAdult(c, now) && !isInSlot(this.state, c.id))
            .slice(0, 8);
          // DEV: сбрасываем кулдаун 📺 перед каждой заморозкой, чтобы заморозить всех разом
          for (const c of pool) { this.state.lastFreezeAdAt = 0; freezeCat(this.state, c.id, 'ad', now); }
          this.commit(); // пересборка ряда комнат отложена на тик — переходим после неё
          setTimeout(() => this.goRoom(this.rooms.length - 1), 30);
        },
        openCryoMenu: (i = 0) => { const c = this.state.cryo[i]; if (c) this.openCryoMenu(c); },
        tutor: () => this.devToggleTutorial(), // ⚠️ ВРЕМЕННОЕ DEV: прогон обучения из консоли
        save: () => this.save(),
      };
    }
  }

  /** DEV: наполнить сцену котами и активной вязкой для скриншотов/проверки. */
  private demo(): void {
    this.state.coins += 8000; this.state.crystals += 60; this.state.dna += 800;
    this.state.research.r_nursery = 5; // запас места (макс. уровень «Пристройки» в дереве)
    const now = this.now();
    const spawn = (room: 'nursery' | 'shelter'): void => {
      const b = pick(this.rng, BREEDS);
      const sex: Sex = this.rng() < 0.5 ? 'female' : 'male';
      this.state.cats.push(makeCatInstance(this.state, randomCat(this.rng, sex), now, room, b.key));
    };
    for (let i = 0; i < 6; i++) spawn('nursery');
    for (let i = 0; i < 7; i++) spawn('shelter');
    const f = this.state.cats.find((c) => c.location === 'nursery' && c.genotype.sex === 'female');
    const m = this.state.cats.find((c) => c.location === 'nursery' && c.genotype.sex === 'male');
    if (f && m) {
      const r = startBreeding(this.state, 0, f.id, m.id, now, this.rng);
      if (r.ok) {
        const slot = this.state.slots[0]!;
        const total = Math.max(1, slot.readyAt - slot.startedAt);
        slot.startedAt = now - total * 0.5;
        slot.readyAt = now + total * 0.5; // показать прогресс ~50%
      }
    }
    this.commit();
  }

  /** DEV: парад коллекции — по коту на каждую породу в Питомник (для проверки арта). */
  private collection(): void {
    // DEV-парад: максимум вместимости из дерева (рендер комнаты всё равно показывает
    // всех котов, вместимость лишь для счётчика).
    this.state.research.r_nursery = 5;
    this.state.research.r_shelter = 5;
    const now = this.now();
    // освобождаем Питомник, чтобы парад был наглядным
    this.state.cats = this.state.cats.filter((c) => c.location !== 'nursery');
    BREEDS.forEach((b, i) => {
      const sex: Sex = i % 2 === 0 ? 'female' : 'male';
      const room = i < BREEDS.length / 2 ? 'nursery' : 'shelter';
      this.state.cats.push(makeCatInstance(this.state, randomCat(this.rng, sex), now, room, b.key));
    });
    this.goRoom(1); // Питомник
    this.commit();
  }

  /** DEV: мгновенно «родить» котёнка — спавнит новорождённого и оставляет его в слоте
   * между родителями (как настоящий collectReady). Эффект-салют играет в инкубаторе. */
  private devBirth(): void {
    const now = this.now();
    const mom = pick(this.rng, BREEDS);
    const dad = pick(this.rng, BREEDS);
    const sex: Sex = this.rng() < 0.5 ? 'female' : 'male';
    const kitten = makeCatInstance(this.state, randomCat(this.rng, sex), now, 'nursery', pick(this.rng, BREEDS).key);
    kitten.bornAt = now; // настоящий новорождённый — маленький, будет расти
    kitten.motherBreed = mom.key; kitten.fatherBreed = dad.key; // родословная для карточки
    this.state.cats.push(kitten);
    // ставим родителей и малыша в слот 0 — повторяем состояние после реальной вязки
    const slot = this.state.slots[0];
    if (slot) {
      const f = this.state.cats.find((c) => c.genotype.sex === 'female' && c.id !== kitten.id);
      const m = this.state.cats.find((c) => c.genotype.sex === 'male' && c.id !== kitten.id);
      slot.motherId = f?.id ?? null;
      slot.fatherId = m?.id ?? null;
      slot.startedAt = 0; slot.readyAt = 0;
      slot.kittenId = kitten.id;
    }
    sfxEvent('birth');
    this.commit();
    this.goRoom(0); // Инкубатор — увидеть малыша с роднёй в центре слота + салют
  }

  /** DEV: показать котика «на весу» по центру (для скриншота взятия за шкирку). */
  private demoGrab(): void {
    const cat = this.state.cats.find((c) => c.location === 'nursery' && !isBusy(this.state, c.id));
    if (!cat) return;
    const cx = this.roomW / 2;
    const cy = this.roomH / 2;
    this.pendingGrab = {
      opts: { cat, displayH: 130, hide: () => {}, show: () => {}, onTap: () => {}, onDrop: () => {} },
      sx: cx, sy: cy,
    };
    this.beginGrab(cx, cy);
    if (this.grab) { this.grab.x = cx; this.grab.y = cy - 30; }
  }

  // --- состояние ---

  /**
   * Сейв берём из двух источников (облако Яндекса и localStorage) — от самого
   * свежего к старому, первый пригодный выигрывает. Так переживаются оба
   * сценария: игра на другом устройстве (свежее облако) и локальная игра без
   * сети/вне платформы (свежий localStorage).
   */
  private async loadState(reset: boolean): Promise<void> {
    if (!reset) {
      for (const rec of await loadSaveCandidates()) {
        try {
          const s = deserialize(rec.raw);
          if (s && s.version === SAVE_VERSION) {
            this.state = s;
            this.applyOffline();
            return;
          }
        } catch { /* битый сейв — пробуем следующий источник */ }
      }
    }
    this.state = createInitialState(this.rng, this.now());
    this.freshGame = true;
    // ?reset — это дев-сброс и съёмка скриншотов (scripts/screenshots.mjs):
    // подсветка обучения не должна лезть в кадр.
    if (reset) finishTutorial(this.state);
  }

  /**
   * Офлайн-прогресс: родившиеся котята + накопленный доход. Заметную отлучку
   * (от OFFLINE_REPORT_MIN_MS) с реальным доходом показываем окном «С возвращением»
   * — там же 📺-надбавка; всё остальное (короткая пауза, нулевой доход) остаётся
   * тостом, чтобы окно не всплывало на каждой перезагрузке вкладки.
   */
  private applyOffline(): void {
    const now = this.now();
    const awayMs = now - this.state.lastSeenAt;
    const levelBefore = this.state.level; // офлайн-рождения могли поднять уровень
    const events = collectReady(this.state, now, this.rng);
    // Офлайн-рождения показать негде — расселяем малышей по комнатам (если есть
    // место), а если мест нет нигде — оставляем с роднёй в слоте (растут медленно).
    for (const e of events) {
      if (!e.kitten) continue;
      const id = e.kitten.id;
      if (!moveCat(this.state, id, 'nursery', now).ok && !moveCat(this.state, id, 'shelter', now).ok) {
        keepKittenWithParents(this.state, id, now);
      }
    }
    const born = events.filter((e) => e.kitten).length;
    const rep = events.reduce((sum, e) => sum + (e.rep ?? 0), 0);
    const inc = collectIncome(this.state, now);
    // Уровень вырос за время отсутствия — панель повышения покажется в update, когда
    // экран освободится (после окна «С возвращением», если оно есть). Кристаллы-подарок
    // уже начислены внутри collectReady (addReputation).
    if (this.state.level > levelBefore) this.queueLevelUp(levelBefore, this.state.level);

    if (inc.coins > 0 && awayMs >= OFFLINE_REPORT_MIN_MS) {
      this.pendingOffline = { ...inc, born, rep };
      return;
    }
    const parts: string[] = [];
    if (born) parts.push(t(`родилось котят: ${born} 🐱`, `kittens born: ${born} 🐱`));
    if (rep) parts.push(`+${rep} ⭐`);
    if (inc.coins) parts.push(t(`доход: +💰${inc.coins}`, `income: +💰${inc.coins}`));
    if (parts.length) setTimeout(() => this.toast(t('С возвращением! ', 'Welcome back! ') + parts.join(', ')), 600);
  }

  /** Показать посчитанный отчёт «С возвращением» (сцена к этому моменту уже собрана). */
  private showOfflineReport(): void {
    const report = this.pendingOffline;
    if (!report) return;
    this.pendingOffline = null;
    const close = (): void => this.closeOverlay();
    this.showOverlay(buildOfflineReport(this, report, close));
  }

  /**
   * Возврат из фона (свернули вкладку, заблокировали телефон). Пока страница
   * скрыта, игровой цикл стоит и lastSeenAt заморожен на моменте ухода — добираем
   * пропущенное тем же кодом, что и при запуске. Короткие переключения (меньше
   * порога отчёта) не трогаем вовсе: там и начислять нечего, и окно ни к чему.
   */
  private resumeFromBackground(): void {
    if (this.adPaused) return; // ещё на паузе (реклама/площадка) — цикл не идёт
    if (this.now() - this.state.lastSeenAt < OFFLINE_REPORT_MIN_MS) return;
    this.applyOffline();
    this.commit(); // начисленный доход и расселённые котята — в HUD и комнаты
    this.showOfflineReport();
  }

  /** flush=true — облачную запись отправить немедленно (сворачивание/закрытие). */
  save(flush = false): void {
    writeSave(serialize(this.state), flush);
  }

  // --- UiContext ---

  commit(): void {
    // Пересобираем только то, что игрок сейчас видит. Остальные комнаты помечаем
    // «отставшими» — их вид соберётся заново, когда они появятся на экране
    // (refreshVisibleRooms в update). Пересборка комнаты недешёвая: сносится всё
    // содержимое и заново создаются десятки Text/Graphics, каждый со своей
    // текстурой — делать это для четырёх невидимых комнат на каждое действие
    // означало ~200 мс залипания на любое действие игрока.
    this.roomDirty = this.rooms.map(() => true);
    this.refreshVisibleRooms();
    // Крио-банк открылся/исчез (покупка узла «Криогенетика») — состав комнат
    // изменился: пересобираем ряд целиком. Откладываем на следующий тик, т.к. commit
    // мог прийти из обработчика тапа по узлу Генолаба, а layout() уничтожает его
    // контейнер (нельзя убивать активную цель события прямо в обработчике).
    if (cryoUnlocked(this.state) !== this.hasCryoRoom && !this.cryoRebuildPending) {
      this.cryoRebuildPending = true;
      setTimeout(() => {
        this.cryoRebuildPending = false;
        this.layout();
        this.fitRoot();
      }, 0);
    }
    this.updateHud();
    this.checkLevelUp(); // повышение уровня от любого действия → баннер со списком открытий
    this.checkAllBreeds(); // Котодекс собран полностью → финальное поздравление (один раз)
    // Помечаем «есть что сохранять», но НЕ трогаем таймер: он тикает от первого
    // несохранённого действия. Раньше здесь стоял сброс, и у игрока, который
    // действует чаще раза в 8 секунд (обычный темп в Инкубаторе и заказах),
    // автосейв не наступал вовсе — краш вкладки уносил всю сессию (п. 1.9).
    this.saveDirty = true;
  }

  toast(msg: string): void {
    if (!this.toastT) return;
    // Предохранитель к п. 1.14 («никаких технических сообщений»): ядро отдаёт
    // единственный служебный код-причину — 'locked'. Все известные места его уже
    // разбирают по-человечески, но кнопка запертой механики может появиться и в
    // новой комнате — тогда игрок увидит английское служебное слово. Заменяем
    // здесь, в одной точке, через которую проходят все тосты игры.
    if (msg === 'locked') msg = t('Пока закрыто 🔒', 'Still locked 🔒');
    // Единственная подсказка про магазин: отказ «не хватает кристаллов» приходит из
    // десятка мест ядра — дописываем, куда идти, ровно здесь, ничего не открывая
    // насильно поверх действия игрока.
    if (msg.includes(t('не хватает кристаллов', 'not enough crystals')) && shopAvailable()) {
      msg = t('Не хватает 💎 — пополнить можно кнопкой «+» в шапке', 'Not enough 💎 — top up with the "+" button in the header');
    }
    this.toastT.text = msg;
    this.toastUntil = this.now() + 2400;
    this.drawToast();
  }

  catTexture(cat: Cat): Texture { return catTexture(this.app, cat); }

  get uiRoot(): Container { return this.root; }

  toggleSelect(catId: string): void {
    const i = this.selection.indexOf(catId);
    if (i >= 0) { this.selection.splice(i, 1); return; }
    this.selection.push(catId);
    while (this.selection.length > 2) this.selection.shift();
  }

  clearSelection(): void { this.selection.length = 0; }

  /**
   * Досборка «отставших» комнат — тех, что попали в кадр. Видимых всегда не
   * больше двух (текущая + соседняя, пока доезжает свайп), плюс та, к которой
   * едем. Зовётся каждый кадр, но почти всегда это лишь проверка пары флагов.
   */
  private refreshVisibleRooms(): void {
    if (this.roomW <= 0) return;
    const first = Math.floor(-this.world.x / this.roomW);
    for (const i of [first, first + 1, this.currentRoom]) {
      if (!this.roomDirty[i]) continue;
      this.roomDirty[i] = false;
      this.rooms[i]?.refresh();
    }
  }

  goRoom(index: number): void {
    this.currentRoom = Math.max(0, Math.min(this.rooms.length - 1, index));
    this.targetX = -this.currentRoom * this.roomW;
    this.updateNav();
    // Финал обучения теперь наступает по последнему шагу (кот на пьедестале) —
    // его ловит сам показ подсказок, см. Tutorial.update → TutorHost.finish.
    // тикает только текущая комната — хор спящих гасим, «пол» новой комнаты
    // сам восстановит его на первом же тике (если там кто-то спит)
    sfxPurrSync([]);
    this.updateMusic();
  }

  /**
   * Пауза игры и звука по требованию площадки (п. 4.7 — при показе
   * полноэкранной рекламы, у нас это 📺 rewarded, и п. 1.3 — при сворачивании
   * страницы). Причины складываются: пока держится хоть одна, игра стоит и звук
   * молчит.
   */
  private setPause(reason: string, on: boolean): void {
    const was = this.pauseReasons.size > 0;
    if (on) this.pauseReasons.add(reason); else this.pauseReasons.delete(reason);
    const now = this.pauseReasons.size > 0;
    if (now === was) return;
    this.adPaused = now;  // update() замирает: доход, таймеры комнат, анимация
    sfxPause(now);        // мяуканье, хор мурлыканья и фоновая музыка
    setUiBlocked(now);    // и кнопки перестают принимать нажатия (п. 4.7)
    // GameplayAPI платформы (п. 1.19.3) — ровно здесь и только на смене
    // состояния. Раньше start/stop звались ещё и из обработчика вкладки, и пара
    // «ушёл со вкладки во время рекламы — вернулся» давала платформе start при
    // открытом ролике и второй start без парного stop.
    if (now) gameplayStop(); else gameplayStart();
  }

  /** Фоновый эмбиент играет в «технических» комнатах и молчит в жилых. */
  private updateMusic(): void {
    const id = this.rooms[this.currentRoom]?.id;
    sfxMusic(id === 'incubator' || id === 'genolab' || id === 'cryobank');
  }

  openCatMenu(cat: Cat): void {
    // первое открытие инфо = кот «изучен»: снимаем бейдж «новый» и сохраняемся
    // (commit пересоберёт «живой пол» — бейдж исчезнет). Событие тапа приходит со
    // stage (см. pointerup), а не с контейнера кота — пересборка пола тут безопасна.
    if (cat.isNew) { cat.isNew = false; this.commit(); }
    const close = (): void => this.closeOverlay();
    this.showOverlay(buildCatMenu(this, cat, close));
    // «замораживаем» кота в комнате, пока меню открыто; значок ℹ️ появляется
    // сразу и держится 3 сек ПОСЛЕ закрытия меню (см. closeOverlay) — чтобы
    // не потерять кота среди других, когда снова видна комната
    this.catInfoFocus = { id: cat.id, frozen: true, iconUntil: Infinity };
  }

  infoFocus(): { id: string; frozen: boolean; iconUntil: number } | null { return this.catInfoFocus; }

  openAdoptConfirm(cat: Cat): void {
    const close = (): void => this.closeOverlay();
    // Шаг обучения «в добрые руки» закрываем уже здесь: кота донесли до станции
    // (или нашли пункт в его меню) — механика показана. Раньше флаг ставил только
    // сам adoptCat, и подсказка не отпускала, пока кота реально не отдашь.
    if (markTutorialSeen(this.state, 'adopt')) this.save();
    this.showOverlay(buildAdoptConfirm(this, cat, close));
  }

  openLabConfirm(cat: Cat): void {
    const close = (): void => this.closeOverlay();
    this.showOverlay(buildLabConfirm(this, cat, close));
  }

  openBulkAdoptConfirm(): void {
    const close = (): void => this.closeOverlay();
    this.showOverlay(buildBulkAdoptConfirm(this, close));
  }

  openBulkLabConfirm(): void {
    const close = (): void => this.closeOverlay();
    this.showOverlay(buildBulkLabConfirm(this, close));
  }

  openHealConfirm(cat: Cat, onHealed?: (hearts: number) => void): void {
    const close = (): void => this.closeOverlay();
    this.showOverlay(buildHealConfirm(this, cat, close, onHealed));
  }

  openCryoMenu(cat: Cat): void {
    const close = (): void => this.closeOverlay();
    this.showOverlay(buildCryoMenu(this, cat, close));
  }

  openFreezeConfirm(cat: Cat): void {
    const close = (): void => this.closeOverlay();
    this.showOverlay(buildFreezeConfirm(this, cat, close));
  }

  openGrowConfirm(cat: Cat): void {
    const close = (): void => this.closeOverlay();
    this.showOverlay(buildGrowConfirm(this, cat, close));
  }

  openPedigree(cat: Cat): void {
    const close = (): void => this.closeOverlay();
    this.showOverlay(buildPedigreePanel(this, cat, close));
  }

  openAnalyzeConfirm(cat: Cat): void {
    const close = (): void => this.closeOverlay();
    this.showOverlay(buildAnalyzeConfirm(this, cat, close));
  }

  openBreedCard(breedKey: string): void {
    const close = (): void => this.closeOverlay();
    this.showOverlay(buildBreedCard(this, breedKey, close));
  }

  openRecipeReveal(recipe: Recipe): void {
    const close = (): void => this.closeOverlay();
    this.showOverlay(buildRecipeRevealPanel(this, recipe, close));
  }

  openPairPreview(mother: Cat, father: Cat): void {
    // шаг обучения «посмотри прогноз пары» — из состояния его не вычислить
    if (markTutorialSeen(this.state, 'preview')) this.save();
    const close = (): void => this.closeOverlay();
    this.showOverlay(buildPairPreview(this, mother, father, close));
  }

  openBirthCard(events: BirthEvent[]): void {
    if (!events.some((e) => e.kitten)) return;
    const close = (): void => this.closeOverlay();
    this.showOverlay(buildBirthCard(this, events, close));
  }

  openBoostMenu(boostId: string): void {
    const close = (): void => this.closeOverlay();
    this.showOverlay(buildBoostMenu(this, boostId, close));
  }

  openResearchConfirm(defId: string): void {
    const close = (): void => this.closeOverlay();
    this.showOverlay(buildResearchConfirm(this, defId, close));
  }

  openOrders(): void {
    // шаг обучения «загляни на доску заказов» — открытие панели состояние не меняет
    if (markTutorialSeen(this.state, 'orders')) this.save();
    const close = (): void => this.closeOverlay();
    this.showOverlay(buildOrdersPanel(this, close));
  }

  /** Подтверждение 📺-обновления заказа: и отмена, и итог возвращают на доску. */
  openOrderRefreshConfirm(orderId: string): void {
    const back = (): void => this.openOrders();
    const order = this.state.orders.find((o) => o.id === orderId);
    if (!order) { back(); return; }   // заказ успел смениться сам — просто открываем доску
    this.showOverlay(buildOrderRefreshConfirm(this, order, back));
  }

  /** Справка комнаты (ℹ️ в титульной плашке). Общей стены «Как играть» больше нет:
   *  механику объясняем там, где она перед глазами (тексты — src/ui/roomHelp.ts). */
  openRoomHelp(roomId: string): void {
    const close = (): void => this.closeOverlay();
    this.showOverlay(buildRoomHelpPanel(this, roomId, close));
  }

  /** Политика конфиденциальности (п. 3.5) — из ⚙️ Настроек, текстом в игре. */
  openPrivacy(): void {
    this.showOverlay(buildPrivacyPanel(this, () => this.closeOverlay()));
  }

  /** Подтверждение сброса прогресса (⚙️ Настройки → «🗑 Сбросить прогресс»). */
  openResetConfirm(): void {
    const close = (): void => this.closeOverlay();
    this.showOverlay(buildResetConfirm(this, close, () => void this.resetProgress()));
  }

  /**
   * Начать игру заново по требованию игрока. Обещание «прогресс можно удалить»
   * стоит в политике конфиденциальности (п. 3.5), и раньше единственным способом
   * его сдержать была чистка данных браузера — на телефоне это нереально.
   *
   * Порядок важен: сначала подменяем состояние и пересобираем сцену (комнаты
   * держат ссылки на прежние объекты котов), и только потом ждём хранилище —
   * облачная запись может идти секунды, а игрок должен увидеть результат сразу.
   * Пишем именно новое состояние, а не «удаляем сейв»: пустое облако при
   * следующем запуске уступило бы старому локальному сейву (см. resetSave).
   */
  private async resetProgress(): Promise<void> {
    // Донат-остаток переживает сброс (так и обещано в окне подтверждения): 💎
    // куплены за реальные деньги, сжигать их при «начать заново» нечестно. Флаг
    // бонуса первой покупки переносим вместе с ними — иначе +50% можно было бы
    // получать снова и снова, сбрасывая прогресс перед каждой покупкой.
    const keptCrystals = this.state.crystals;
    const keptFirstPurchase = this.state.firstPurchaseDone;
    this.state = createInitialState(this.rng, this.now());
    this.state.crystals = keptCrystals;
    this.state.firstPurchaseDone = keptFirstPurchase;
    this.freshGame = true;
    this.shownLevel = this.state.level;
    this.wasStarving = isStarving(this.state);
    // всё, что копилось от прежней партии: отчёты, выбор пары, фокус на коте
    this.pendingOffline = null;
    this.pendingLevelUp = null;
    this.pendingTutorDone = false;
    this.pendingAllBreeds = false;
    this.pendingReview = false;
    this.catInfoFocus = null;
    this.clearSelection();
    this.incomeAcc = 0;
    this.saveDirty = false;
    this.saveTimer = 0;

    this.closeOverlay();
    this.layout();   // сцена целиком под новое состояние (как при смене языка)
    this.fitRoot();
    this.goRoom(this.roomIndex('nursery')); // как на первом запуске — оттуда ведёт обучение

    const ok = await resetSave(serialize(this.state));
    this.toast(ok
      ? t('Прогресс сброшен — начинаем заново 🐾', 'Progress reset — starting over 🐾')
      : t('Сброшено на этом устройстве; облачная копия обновится позже',
        'Reset on this device; the cloud copy will update later'));
  }

  openSettings(): void {
    const close = (): void => this.closeOverlay();
    // Флаг ставим ПОСЛЕ показа: showOverlay начинается с closeOverlay(), который
    // его же и сбрасывает (нужен для возврата панели после смены языка).
    this.showOverlay(buildSettingsPanel(this, close));
    this.settingsOpen = true;
  }

  /** Магазин 💎 — только когда покупки реально доступны (без мёртвых кнопок). */
  openShop(): void {
    if (!shopAvailable()) return;
    const close = (): void => this.closeOverlay();
    this.showOverlay(buildShopPanel(this, close));
  }

  /** ⚠️ ВРЕМЕННОЕ DEV-меню (кнопка 🛠, только при DEVTOOLS) — убрать перед релизом. */
  openDevMenu(): void {
    if (!DEVTOOLS) return; // в прод-сборке ветка сворачивается, и buildDevMenu вытрясается
    const close = (): void => this.closeOverlay();
    this.showOverlay(buildDevMenu(this, close));
  }

  /**
   * ⚠️ ВРЕМЕННОЕ DEV: кнопка 🎓 — прогнать обучение по требованию (убрать перед
   * релизом вместе с кнопкой). Тумблер: идёт — выключаем, не идёт — включаем
   * заново и уводим в комнату текущего шага. Шаг считается от состояния, поэтому
   * на отыгранной партии подсветка встанет туда, куда дотянулся прогресс (скорее
   * всего сразу в конец); чтобы увидеть обучение с нуля, нужна новая игра (?reset).
   */
  devToggleTutorial(): void {
    if (tutorialActive(this.state)) {
      finishTutorial(this.state);
      this.commit();
      this.save();
      this.toast('DEV: обучение выключено');
      return;
    }
    restartTutorial(this.state);
    this.commit();
    this.save();
    const step = tutorialStep(this.state);
    if (!step) {
      finishTutorial(this.state); // всё уже сделано — заново вести некуда
      this.commit();
      this.toast('DEV: все шаги уже пройдены — с нуля только на новой игре');
      return;
    }
    this.goRoom(this.roomIndex(step === 'adopt' || step === 'orders' ? 'shelter'
      : step === 'drag' || step === 'menu' || step === 'analyze' || step === 'champion' ? 'nursery'
        : 'incubator'));
    this.toast('DEV: обучение включено 🎓');
  }

  startGrab(opts: GrabOpts, e: FederatedPointerEvent): void {
    if (this.overlayOpen) return;
    const p = this.root.toLocal(e.global); // окно → виртуальные координаты сцены
    this.pendingGrab = { opts, sx: p.x, sy: p.y };
  }

  carrying(): { cat: Cat; x: number; y: number } | null {
    const g = this.grab;
    return g ? { cat: g.opts.cat, x: g.x, y: g.y } : null;
  }

  /** Начать вис кота «в руках»; gx/gy — виртуальные координаты сцены (root). */
  private beginGrab(gx: number, gy: number): void {
    if (!this.pendingGrab) return;
    sfxMeow(); // взяли за шкирку — кот отзывается
    const opts = this.pendingGrab.opts;
    opts.hide();
    // «в руках»: спрайт породы (та же текстура, что на полу), иначе процедурный
    let sprite: Container = aiHeldSpriteFor(opts.cat, opts.displayH) ?? (() => {
      const proc = buildCat(expressPhenotype(opts.cat.genotype), 'hang', opts.cat.genotype.sex);
      proc.scale.set((opts.displayH * 1.6) / Math.max(1, proc.height));
      proc.pivot.set(0, -104);
      return proc;
    })();
    sprite.position.set(gx, gy);
    // ореол редкости под котом «в руках» (только для спрайтов из текстуры)
    let glow: Sprite | undefined;
    if (sprite instanceof Sprite) {
      glow = rarityGlow(this.app, sprite, opts.cat.rarityTier, opts.displayH);
      glow.position.set(gx, gy);
      this.dragLayer.addChild(glow);
    }
    this.dragLayer.addChild(sprite);
    this.grab = {
      opts, sprite, glow, baseScale: sprite.scale.x,
      x: gx, y: gy, cx: gx, cy: gy, vx: 0, t: 0, pop: 0,
      originRoom: this.currentRoom, edgeCd: 0,
    };
    this.app.canvas.style.cursor = 'grabbing';
  }

  private endGrab(): void {
    if (!this.grab) return;
    const g = this.grab;
    const { x: gx, y: gy, opts, originRoom } = g;
    g.glow?.destroy();
    g.sprite.destroy({ children: true });
    this.grab = null;
    this.app.canvas.style.cursor = 'default';

    // пристроить кота в текущей комнате (слот вязки / приют / питомник)
    if (this.handleCatDrop(opts.cat, gx, gy)) return; // успех → commit пересобрал комнаты
    // не пристроили — кот возвращается назад, в свою комнату
    if (this.currentRoom !== originRoom) this.goRoom(originRoom);
    opts.show();
    opts.onDrop(gx, gy);
  }

  private roomIndex(id: string): number {
    return this.rooms.findIndex((r) => r.id === id);
  }

  /** Перетаскивая кота, у края экрана листаем комнаты: влево → Инкубатор, вправо → Приют. */
  private carryEdgeScroll(dt: number): void {
    const g = this.grab;
    if (!g) return;
    g.edgeCd -= dt;
    if (g.edgeCd > 0) return;
    const edge = Math.min(72, this.roomW * 0.12);
    // над целью дропа у кромки (стойка заказов Питомника) не листаем — там ждут кота
    if (this.rooms[this.currentRoom]?.blocksEdgeScroll?.(g.x, g.y)) return;
    const lo = this.roomIndex('incubator');
    const hi = this.roomIndex('shelter');
    // 2 c между сменами комнат — чтобы не проскакивать центральную комнату насквозь
    if (g.x < edge && this.currentRoom > lo) { this.goRoom(this.currentRoom - 1); g.edgeCd = 2; }
    else if (g.x > this.roomW - edge && this.currentRoom < hi) { this.goRoom(this.currentRoom + 1); g.edgeCd = 2; }
  }

  /** Куда уронили кота: Инкубатор → слот вязки, Приют → переноска (пристройство), Приют/Питомник → переезд. */
  private handleCatDrop(cat: Cat, gx: number, gy: number): boolean {
    const room = this.rooms[this.currentRoom];
    if (!room) return false;
    // спец-зона комнаты (слот вязки в Инкубаторе / переноска в Приюте). Не сработала —
    // ниже обычный переезд по комнате.
    if (room.tryDropCat?.(cat, gx, gy)) return true;
    if (room.id === 'shelter') return this.relocateCat(cat, 'shelter');
    if (room.id === 'nursery') return this.relocateCat(cat, 'nursery');
    return false; // Генолаб и пр. — ставить некуда
  }

  private relocateCat(cat: Cat, room: 'nursery' | 'shelter'): boolean {
    const staged = isInSlot(this.state, cat.id); // кота/малыша тащат из слота инкубатора
    // ничего не меняется (тот же пол, не из слота) — просто приземлить на полу
    if (cat.location === room && !staged) return false;
    // moveCat сам проверит место и снимет «оставленного с роднёй» малыша со слота
    const r = moveCat(this.state, cat.id, room, this.now());
    if (!r.ok) { this.toast(r.reason); return false; } // нет места → вернётся в слот
    clearBreederSlot(this.state, cat.id); // если был родителем — снять (для малыша no-op)
    this.commit();
    this.toast(room === 'shelter' ? t('Котик в приюте 🏠', 'The cat is in the shelter 🏠') : t('Котик в питомнике 🏆', 'The cat is in the cattery 🏆'));
    return true;
  }

  // --- раскладка ---

  /** Подгоняем рендерер под реально видимую область (см. onResize выше). */
  private resize(): void {
    // Пока в фокусе HTML-поле ввода (переименование кота), мобильная клавиатура
    // ужимает visualViewport — НЕ пересчитываем сцену, иначе игра «схлопывается»
    // под остаток экрана над клавиатурой.
    //
    // Пропущенный ресайз обязательно запоминаем: на мобиле вьюпорт вернётся сам и
    // пришлёт финальный resize, а вот на десктопе события больше не будет — игрок
    // потянул край окна при открытом поле, и сцена так и осталась бы обрезанной по
    // старому размеру (нет правого края комнаты и нижней навигации). Догоняем по
    // focusout, см. boot().
    if (document.activeElement instanceof HTMLInputElement) { this.resizePending = true; return; }
    this.resizePending = false;
    const vv = window.visualViewport;
    const w = Math.max(1, Math.round(vv?.width ?? window.innerWidth));
    const h = Math.max(1, Math.round(vv?.height ?? window.innerHeight));
    if (this.app.screen.width !== w || this.app.screen.height !== h) {
      this.app.renderer.resize(w, h);
    }
    // события ловим на всём окне (включая поля леттербокса)
    this.app.stage.hitArea = new Rectangle(0, 0, w, h);

    const aspect = Math.min(MAX_ASPECT, Math.max(MIN_ASPECT, w / h));
    const vw = Math.round(DESIGN_H * aspect);
    if (this.relayoutTimer) { clearTimeout(this.relayoutTimer); this.relayoutTimer = null; }
    if (this.roomW === 0) {
      // первый запуск — собираем сцену сразу
      this.roomW = vw;
      this.roomH = DESIGN_H;
      this.layout();
    } else if (vw !== this.roomW) {
      // живой ресайз: пока окно тянут, картинка лишь равномерно масштабируется
      // (fitRoot ниже) — пропорции не меняются. Пересборку под новую виртуальную
      // ширину делаем один раз, когда размер устаканился: иначе комнаты
      // пересоздаются десятки раз за жест и содержимое «прыгает».
      this.relayoutTimer = setTimeout(() => {
        this.relayoutTimer = null;
        this.roomW = vw;
        this.layout();
        this.fitRoot();
      }, 180);
    }
    this.fitRoot();
  }

  /** Равномерный масштаб + центрирование виртуальной сцены в реальном окне. */
  private fitRoot(): void {
    const w = this.app.screen.width;
    const h = this.app.screen.height;
    const s = Math.min(w / this.roomW, h / this.roomH);
    this.root.scale.set(s);
    this.root.position.set(Math.round((w - this.roomW * s) / 2), Math.round((h - this.roomH * s) / 2));
  }

  private layout(): void {
    this.topInset = Math.round(Math.max(48, Math.min(64, this.roomH * 0.085)));
    this.rootMask.clear();
    this.rootMask.rect(0, 0, this.roomW, this.roomH).fill(0xffffff);

    // комнаты сейчас пересоздадутся — прерываем перетаскивание кота, если шло:
    // его hide/show-колбэки указывают в старое, уничтожаемое дерево
    if (this.grab) {
      this.grab.glow?.destroy();
      this.grab.sprite.destroy({ children: true });
      this.grab = null;
      this.app.canvas.style.cursor = 'default';
    }
    this.pendingGrab = null;

    // пересобираем комнаты под новый размер
    for (const r of this.rooms) r.container.destroy({ children: true });
    this.world.removeChildren();
    // Крио-банк появляется 5-й в ряду только после покупки узла «❄️ Криогенетика».
    // Состав комнат пересобирается в commit(), когда cryoUnlocked меняется (см. commit).
    this.hasCryoRoom = cryoUnlocked(this.state);
    this.rooms = [
      createIncubator(this),
      createNursery(this),
      createShelter(this),
      createGenolab(this),
      ...(this.hasCryoRoom ? [createCryobank(this)] : []),
    ];
    this.rooms.forEach((r, i) => {
      r.container.position.set(i * this.roomW, 0);
      this.world.addChild(r.container);
      r.refresh();
    });
    this.roomDirty = this.rooms.map(() => false); // ряд собран заново — отставших нет

    this.buildHud();
    this.buildNav();
    this.buildToast();
    this.devFps?.place(this.roomW, this.topInset); // ⚠️ ВРЕМЕННОЕ DEV: панель FPS под топбаром

    this.currentRoom = Math.min(this.currentRoom, this.rooms.length - 1);
    this.targetX = -this.currentRoom * this.roomW;
    this.world.x = this.targetX;
    this.updateHud();
    this.updateNav();
    this.updateMusic(); // старт игры / пересборка: включить эмбиент, если мы в «технической» комнате
    this.fitOverlay(); // открытая панель (если есть) — под новый размер экрана
  }

  /**
   * Снести содержимое контейнера, освободив память. `removeChildren()` только
   * отцепляет узлы: текстуры их Text остаются висеть, и каждая пересборка сцены
   * добавляла ~1.5 МБ, которые не возвращались даже после сборки мусора (25
   * ресайзов окна = +38 МБ, 20 смен языка = +43 МБ).
   *
   * Уничтожаем следующим тиком: пересборка часто идёт прямо из обработчика тапа,
   * а убивать активную цель события внутри её же обработчика нельзя.
   */
  private clearNode(node: Container): void {
    const gone = node.removeChildren();
    if (!gone.length) return;
    setTimeout(() => {
      for (const n of gone) {
        // texture НЕ трогаем: спрайты держат общие текстуры из Assets (фон HUD,
        // коты, декор) — их уничтожение сломало бы остальную сцену.
        if (!n.destroyed) n.destroy({ children: true });
      }
    }, 0);
  }

  private buildHud(): void {
    this.clearNode(this.hud);
    const w = this.roomW;
    const ti = this.topInset;
    if (this.hudBgTex) {
      const bg = new Sprite(this.hudBgTex);
      bg.width = w;
      bg.height = ti;
      this.hud.addChild(bg);
    } else {
      const bg = new Graphics();
      bg.rect(0, 0, w, ti).fill({ color: COLORS.hud, alpha: 0.96 });
      this.hud.addChild(bg);
    }
    // нижняя линия-разделитель поверх фона
    const edge = new Graphics();
    edge.rect(0, ti - 2, w, 2).fill({ color: COLORS.cardEdge });
    this.hud.addChild(edge);

    // адаптивные размеры под ширину экрана (один интерфейс для ПК и мобилы)
    const fs = Math.round(Math.max(15, Math.min(21, ti * 0.35)));
    const pad = Math.round(Math.max(8, Math.min(18, w * 0.014)));
    this.hudPad = pad;
    // ресурсы выкладываются в ряд по реальной ширине (см. updateHud), зазор — компактный
    this.hudGap = Math.round(Math.max(16, Math.min(30, w * 0.024)));
    const mk = (color: number, size = fs, strokeW = 1): Text => {
      const t = new Text({
        text: '',
        style: {
          fontFamily: "'Rubik', sans-serif", fontSize: size, fontWeight: '700', fill: color, align: 'center',
          stroke: { color: 0x000000, width: strokeW, join: 'round' },
        },
      });
      t.anchor.set(0, 0.5);
      t.position.set(pad, ti / 2);
      this.hud.addChild(t);
      return t;
    };
    this.coinsT = mk(0xc9912a);
    this.rateT = mk(0x4f9d63, Math.max(11, fs - 3));
    this.crystalsT = mk(0x3a93c9);
    // «+» сразу за счётчиком 💎 — вход в магазин. Создаём всегда, показываем только
    // когда покупки подключены (см. updateHud): каталог приходит уже после сборки HUD.
    const shopSize = Math.round(ti * 0.5);
    this.shopBtn = new Button({
      text: '+', w: shopSize, h: shopSize, color: COLORS.crystals, fontSize: Math.round(fs * 0.95),
    });
    this.shopBtn.visible = false;
    this.shopBtn.position.set(pad, ti / 2);
    this.shopBtn.onTap = () => this.openShop();
    this.hud.addChild(this.shopBtn);
    this.dnaT = mk(0x7a4fd0);
    this.levelT = mk(COLORS.ink, fs);
    this.levelBar = new Graphics(); // тонкая полоска прогресса опыта под ⭐ Ур.
    this.hud.addChild(this.levelBar);

    // Кнопки справа выкладываются справа налево: шестерёнка → (dev). Общей
    // справки ❓ здесь нет: она разошлась по комнатам (кнопка ℹ️ в титульной
    // плашке, тексты — src/ui/roomHelp.ts).
    const bh = Math.round(ti * 0.72);
    const btnW = Math.round(ti * 0.92);
    const btnGap = 8;
    let rx = w - pad; // правый край текущей кнопки

    // Настройки (громкость и пр.) — всегда доступны.
    const gear = new Button({ text: '⚙️', w: btnW, h: bh, color: COLORS.cardEdge, textColor: COLORS.ink, fontSize: fs + 2 });
    gear.position.set(rx - btnW / 2, ti / 2);
    gear.onTap = () => this.openSettings();
    this.hud.addChild(gear);
    rx -= btnW + btnGap;

    // ⚠️ ВРЕМЕННОЕ: кнопка режима разработчика (валюты/уровень). Только на dev-сервере и
    // в тестовой сборке (в прод-архиве для Яндекса не появляется — см. devTools.ts).
    // Удалить вместе с buildDevMenu перед релизом.
    if (DEVTOOLS) {
      const dev = new Button({ text: '🛠', w: btnW, h: bh, color: COLORS.warn, textColor: COLORS.ink, fontSize: fs + 2 });
      dev.position.set(rx - btnW / 2, ti / 2);
      dev.onTap = () => this.openDevMenu();
      this.hud.addChild(dev);
      rx -= btnW + btnGap;

      // ⚠️ ВРЕМЕННОЕ: включить/выключить обучение (после ?reset оно погашено).
      const tut = new Button({ text: '🎓', w: btnW, h: bh, color: COLORS.good, fontSize: fs + 2 });
      tut.position.set(rx - btnW / 2, ti / 2);
      tut.onTap = () => this.devToggleTutorial();
      this.hud.addChild(tut);
      rx -= btnW + btnGap;

      // ⚠️ ВРЕМЕННОЕ: счётчик FPS (для замеров на телефоне) — см. devFps.ts.
      const fps = new Button({ text: '📊', w: btnW, h: bh, color: COLORS.cardEdge, textColor: COLORS.ink, fontSize: fs + 2 });
      fps.position.set(rx - btnW / 2, ti / 2);
      fps.onTap = () => this.devFps?.toggle();
      this.hud.addChild(fps);
      rx -= btnW + btnGap;
    }
  }

  private updateHud(): void {
    if (!this.coinsT) return;
    const rate = netIncomePerMin(this.state);
    this.coinsT.text = `💰 ${fmt(this.state.coins)}`;
    // при голоде доход стоит — показываем это прямо в шапке вместо ставки
    this.rateT.text = isStarving(this.state) ? t('🍽 голод', '🍽 starving') : rate > 0 ? t(`+${rate.toFixed(rate < 10 ? 1 : 0)}/мин`, `+${rate.toFixed(rate < 10 ? 1 : 0)}/min`) : '';
    this.crystalsT.text = `💎 ${fmt(this.state.crystals)}`;
    this.dnaT.text = `🧬 ${fmt(this.state.dna)}`;
    this.levelT.text = t(`⭐ Ур. ${this.state.level}`, `⭐ Lv. ${this.state.level}`);

    // ряд ресурсов слева: деньги и доход/мин стоят рядом, дальше кристаллы/ДНК/уровень.
    // Раскладка по реальной ширине текста — компактнее фиксированных слотов и без наезда.
    let x = this.hudPad;
    this.coinsT.position.x = x;
    x += this.coinsT.width + (this.rateT.text ? 8 : this.hudGap);
    if (this.rateT.text) {
      this.rateT.position.x = x;
      x += this.rateT.width + this.hudGap;
    }
    this.crystalsT.position.x = x; x += this.crystalsT.width;
    if (this.shopBtn) {
      // кнопка появляется, как только пришёл каталог покупок; нет покупок — нет и места под неё
      this.shopBtn.visible = shopAvailable();
      if (this.shopBtn.visible) {
        this.shopBtn.position.x = x + 6 + this.shopBtn.width / 2;
        x += 12 + this.shopBtn.width;
      }
    }
    x += this.hudGap;
    this.dnaT.position.x = x; x += this.dnaT.width + this.hudGap;
    this.levelT.position.x = x;
    this.drawLevelBar();
  }

  /** Тонкая полоска прогресса опыта до следующего уровня, под текстом «⭐ Ур. N». */
  private drawLevelBar(): void {
    if (!this.levelBar) return;
    const bar = this.levelBar;
    bar.clear();
    const level = this.state.level;
    const x = this.levelT.position.x;
    const w = Math.max(40, this.levelT.width);
    const y = this.levelT.position.y + this.levelT.height / 2 + 2;
    const h = 4;
    // фон дорожки
    bar.roundRect(x, y, w, h, 2).fill({ color: 0x000000, alpha: 0.18 });
    const nextRep = nextLevelRep(level);
    let frac = 1;
    if (nextRep !== null) {
      const base = LEVEL_REP_THRESHOLDS[level - 1] ?? 0; // порог текущего уровня
      frac = Math.max(0, Math.min(1, (this.state.reputation - base) / Math.max(1, nextRep - base)));
    }
    const col = level >= MAX_LEVEL ? 0xe7b24c : 0x6cc07a;
    bar.roundRect(x, y, Math.max(3, w * frac), h, 2).fill({ color: col });
  }

  /**
   * Повышение уровня. Сверяет текущий уровень с последним показанным; при росте —
   * ставит в очередь панель поздравления (агрегирует все пройденные уровни, если
   * прыгнули через несколько сразу). Вызывается из commit() — ловит все источники
   * опыта (рождение/пристройство/лаборатория/заказ) единообразно.
   */
  private checkLevelUp(): void {
    if (this.state.level <= this.shownLevel) { this.shownLevel = this.state.level; return; }
    const from = this.shownLevel;
    this.shownLevel = this.state.level;
    this.queueLevelUp(from, this.state.level);
  }

  /**
   * Копит повышение уровня (уровни from+1..to) для показа панелью. Собирает сумму
   * подарка 💎 (levelCrystalReward — уже начислены в addReputation) и список того,
   * что открылось (unlocksAtLevel). Два повышения подряд до показа — объединяются.
   */
  private queueLevelUp(from: number, to: number): void {
    if (to <= from) return;
    const unlocks: string[] = [];
    let crystals = 0;
    for (let lv = from + 1; lv <= to; lv++) {
      unlocks.push(...unlocksAtLevel(lv));
      crystals += levelCrystalReward(lv);
    }
    if (this.pendingLevelUp) {
      crystals += this.pendingLevelUp.crystals;
      unlocks.unshift(...this.pendingLevelUp.unlocks);
    }
    this.pendingLevelUp = { level: to, crystals, unlocks };
    // Пик радости для просьбы об оценке: 4-5 уровень лаборатории — игра уже
    // «зашла» (петля освоена, механики открываются), но усталости ещё нет.
    // Проверяем ПЕРЕСЕЧЕНИЕ рубежа, а не итоговый уровень: после долгой отлучки
    // опыт может перебросить сразу через несколько уровней, и точное «ровно 4
    // или 5» такой момент просто терял бы.
    if (to >= 4 && from < 5) this.wantReview();
  }

  /**
   * Панель «Обучение пройдено» с подарком за прохождение. Начисление висит на
   * закрытии панели (кнопка «Забрать» и тап мимо ведут в один и тот же claim) —
   * так подарок не потеряется, даже если игрок закроет окно мимо кнопки.
   */
  private showTutorDonePanel(): void {
    this.pendingTutorDone = false;
    sfxEvent('levelup'); // фанфара под поздравление
    const claim = (): void => {
      if (grantTutorialReward(this.state)) {
        this.commit();
        this.save();
        this.toast(t(`Подарок получен: +${TUTORIAL_REWARD_COINS} 💰 и +${TUTORIAL_REWARD_CRYSTALS} 💎`,
          `Gift claimed: +${TUTORIAL_REWARD_COINS} 💰 and +${TUTORIAL_REWARD_CRYSTALS} 💎`));
      }
      this.closeOverlay();
    };
    this.showOverlay(buildTutorialDonePanel(this, claim));
    // тап по затемнению — тоже «забрать»: подарок заработан, терять его нельзя
    this.overlayDim?.removeAllListeners('pointertap');
    this.overlayDim?.on('pointertap', claim);
  }

  /**
   * Финал коллекции: последняя порода выведена. Проверяем из commit() — то есть
   * после любого действия, каким бы путём порода ни пришла (вязка, клон, заказ).
   * Флаг в сейве ставим сразу, при постановке в очередь: панель одноразовая, а
   * Котодекс остаётся полным навсегда — иначе окно всплывало бы снова и снова.
   */
  private checkAllBreeds(): void {
    if (this.state.allBreedsCongratsSeen || !allBreedsBred(this.state)) return;
    this.state.allBreedsCongratsSeen = true;
    this.pendingAllBreeds = true;
    this.save();
  }

  /** Показать поздравление с полной коллекцией (экран уже свободен от оверлеев). */
  private showAllBreedsPanel(): void {
    this.pendingAllBreeds = false;
    sfxEvent('levelup'); // та же фанфара, что и на повышении уровня
    this.showOverlay(buildAllBreedsPanel(this, () => this.closeOverlay()));
  }

  /**
   * Отметить «пик радости»: момент, в который уместно предложить оценить игру
   * (первая легендарная порода, 4-5 уровень лаборатории, крупный заказ). Само
   * окно платформы показывается позже — из update, когда экран свободен.
   */
  wantReview(): void {
    if (!this.pendingReview && canAskReview(this.state, this.now())) this.pendingReview = true;
  }

  /**
   * Нативное окно оценки (звёзды + комментарий рисует сама площадка). Своего
   * пре-диалога «Нравится игра?» намеренно нет: лишний экран только съедает
   * согласия, а окно платформы и так закрывается крестиком.
   *
   * Попытку засчитываем по факту показа, а не по результату: закрыл окно —
   * значит просить снова можно не раньше, чем через REVIEW_ASK_COOLDOWN_MS.
   * Гостю и уже оценившему платформа сама не даст (canOfferReview → canReview),
   * и такой отказ попытку не тратит.
   */
  private askReview(): void {
    this.pendingReview = false;
    if (!canOfferReview() || !canAskReview(this.state, this.now())) return;
    noteReviewAsked(this.state, this.now());
    this.save();
    void requestReview().then((sent) => {
      if (sent) this.toast(t('Спасибо за оценку! ❤️', 'Thank you for the review! ❤️'));
    });
  }

  /** Показать накопленную панель повышения уровня (экран уже свободен от оверлеев). */
  private showLevelUpPanel(): void {
    const info = this.pendingLevelUp;
    if (!info) return;
    this.pendingLevelUp = null;
    sfxEvent('levelup'); // фанфара вместе с панелью, а не в момент начисления опыта
    this.showOverlay(buildLevelUpPanel(this, info, () => this.closeOverlay()));
  }

  private buildNav(): void {
    this.clearNode(this.nav);
    this.dots = [];
    const n = this.rooms.length;
    // точки разведены шире (легче попасть пальцем) и прижаты к самому низу.
    const gap = 48;
    const y = this.roomH - 12;
    const totalW = gap * (n - 1);
    const startX = this.roomW / 2 - totalW / 2;
    for (let i = 0; i < n; i++) {
      const d = new Graphics();
      d.circle(0, 0, 8.5).fill(COLORS.cardEdge);
      d.position.set(startX + i * gap, y);
      d.eventMode = 'static';
      d.cursor = 'pointer';
      // зона тапа крупнее самой точки (точка маленькая — пальцем не попасть);
      // вверх не вылезает за низ контента (верх зоны = -14, как раньше), рост зоны
      // идёт вширь и вниз в леттербокс — чтобы не перехватывать тапы по контенту.
      d.hitArea = new Rectangle(-24, -14, 48, 30);
      d.on('pointertap', () => this.goRoom(i));
      this.nav.addChild(d);
      this.dots.push(d);
    }

    // Стрелки ‹ › стоят в той же нижней полосе, фланкируя точки. Раньше они
    // висели по центру высоты у краёв экрана — поверх контента комнаты (слой nav
    // выше world), и перехватывали тапы по контенту у левого/правого края
    // (напр. по крайним узлам Исследований). Теперь вся навигация — в нижней
    // зарезервированной полосе, контент её не касается.
    const aw = 41, ah = 28;
    const leftX = Math.max(aw / 2 + 4, startX - gap - aw / 2);
    const rightX = Math.min(this.roomW - aw / 2 - 4, startX + totalW + gap + aw / 2);
    const left = new Button({ text: '‹', w: aw, h: ah, color: COLORS.hud, textColor: COLORS.ink, fontSize: 25 });
    left.position.set(leftX, y);
    left.onTap = () => this.goRoom(this.currentRoom - 1);
    const right = new Button({ text: '›', w: aw, h: ah, color: COLORS.hud, textColor: COLORS.ink, fontSize: 25 });
    right.position.set(rightX, y);
    right.onTap = () => this.goRoom(this.currentRoom + 1);
    this.nav.addChild(left, right);
  }

  private updateNav(): void {
    this.dots.forEach((d, i) => {
      d.clear();
      const active = i === this.currentRoom;
      d.circle(0, 0, active ? 11 : 8.5).fill(active ? COLORS.primary : COLORS.cardEdge);
    });
  }

  private buildToast(): void {
    this.clearNode(this.toastBox);
    const t = label('', 15, 0xffffff, '700');
    t.position.set(0, 0);
    this.toastT = t;
    const wrap = new Container();
    wrap.addChild(t);
    wrap.position.set(this.roomW / 2, this.roomH - 56);
    this.toastBox.addChild(wrap);
    this.toastBox.alpha = 0;
  }

  private drawToast(): void {
    if (!this.toastT) return;
    const wrap = this.toastT.parent;
    if (!wrap) return;
    const w = this.toastT.width + 36;
    const bgName = '__bg';
    const old = wrap.getChildByLabel(bgName);
    if (old) old.destroy();
    const bg = new Graphics();
    bg.label = bgName;
    bg.roundRect(-w / 2, -20, w, 40, 14).fill({ color: COLORS.overlay, alpha: 0.92 });
    wrap.addChildAt(bg, 0);
    this.toastBox.alpha = 1;
  }

  // --- оверлеи ---

  private showOverlay(content: Container): void {
    this.closeOverlay();
    const dim = new Graphics();
    dim.eventMode = 'static';
    dim.on('pointertap', () => this.closeOverlay());

    this.overlayDim = dim;
    this.overlayContent = content;
    this.overlayLayer.addChild(dim, content);
    this.fitOverlay();
  }

  /** Вписывает текущий оверлей (dim + панель) в актуальные roomW/roomH — при
   * первом показе и заново при каждом ресайзе окна (см. layout()), иначе после
   * ресайза панель остаётся старого размера и «уезжает» от центра экрана. */
  private fitOverlay(): void {
    const { overlayDim: dim, overlayContent: content } = this;
    if (!dim || !content) return;
    dim.clear();
    dim.rect(0, 0, this.roomW, this.roomH).fill({ color: COLORS.overlay, alpha: 0.5 });

    // вписываем панель в экран (на узких мобильных — уменьшаем); меряем от
    // немасштабированного размера, чтобы повторный вызов не накапливал сжатие
    content.scale.set(1);
    const margin = 12;
    let s = 1;
    if (content.height > this.roomH - margin * 2) s = Math.min(s, (this.roomH - margin * 2) / content.height);
    if (content.width > this.roomW - margin * 2) s = Math.min(s, (this.roomW - margin * 2) / content.width);
    content.scale.set(s);
    content.position.set((this.roomW - content.width) / 2, (this.roomH - content.height) / 2);
  }

  private closeOverlay(): void {
    this.clearNode(this.overlayLayer);
    this.overlayDim = null;
    this.overlayContent = null;
    this.settingsOpen = false;
    // меню закрыто — кот больше не «заморожен»; отсюда отсчитываем 3 сек до
    // исчезновения значка ℹ️ (пока меню было открыто, iconUntil = Infinity)
    if (this.catInfoFocus) {
      this.catInfoFocus.frozen = false;
      this.catInfoFocus.iconUntil = this.now() + 3000;
    }
  }

  private get overlayOpen(): boolean { return this.overlayLayer.children.length > 0; }

  get gestureAxis(): 'none' | 'h' | 'v' { return this.axisLock; }

  // --- ввод (свайп) ---

  private installInput(): void {
    this.app.stage.on('pointerdown', (e: FederatedPointerEvent) => {
      // на паузе (реклама, сворачивание вкладки) жесты не обрабатываем вовсе —
      // иначе свайп листал бы комнаты вслепую
      if (this.adPaused) return;
      if (this.overlayOpen || this.pendingGrab) return; // котика берём — комнату не свайпим
      this.pointerActive = true;
      this.dragging = false;
      this.axisLock = 'none';
      const p = this.root.toLocal(e.global); // окно → виртуальные координаты сцены
      this.startPx = p.x;
      this.startPy = p.y;
      this.startWorldX = this.world.x;
    });
    this.app.stage.on('pointermove', (e: FederatedPointerEvent) => {
      if (this.adPaused || this.overlayOpen) return;
      const p = this.root.toLocal(e.global); // окно → виртуальные координаты сцены
      // взятие котика за шкирку (приоритетнее свайпа)
      if (this.pendingGrab && !this.grab) {
        const dx = p.x - this.pendingGrab.sx;
        const dy = p.y - this.pendingGrab.sy;
        if (dx * dx + dy * dy > 64) this.beginGrab(p.x, p.y);
      }
      if (this.grab) { this.grab.x = p.x; this.grab.y = p.y; return; }
      // свайп комнат
      if (!this.pointerActive) return;
      const sdx = p.x - this.startPx;
      const sdy = p.y - this.startPy;
      // выбираем ось по первому заметному движению: преобладание X — свайп комнат,
      // преобладание Y — отдаём жест вертикальной прокрутке контента комнаты.
      if (this.axisLock === 'none' && (Math.abs(sdx) > 8 || Math.abs(sdy) > 8)) {
        this.axisLock = Math.abs(sdx) >= Math.abs(sdy) ? 'h' : 'v';
      }
      if (this.axisLock === 'h') {
        this.dragging = true;
        const minX = -(this.rooms.length - 1) * this.roomW;
        this.world.x = Math.max(minX, Math.min(0, this.startWorldX + sdx));
      }
    });
    const up = (): void => {
      if (this.adPaused) return;
      if (this.grab) { this.endGrab(); this.pendingGrab = null; return; }
      if (this.pendingGrab) { sfxMeow(); this.pendingGrab.opts.onTap(); this.pendingGrab = null; return; }
      if (!this.pointerActive) return;
      this.pointerActive = false;
      this.axisLock = 'none';
      if (!this.dragging) return;
      const moved = this.startWorldX - this.world.x; // >0 — свайп влево (к следующей)
      if (Math.abs(moved) > this.roomW * 0.18) this.goRoom(this.currentRoom + Math.sign(moved));
      else this.goRoom(this.currentRoom);
      this.dragging = false;
    };
    this.app.stage.on('pointerup', up);
    this.app.stage.on('pointerupoutside', up);
  }

  // --- цикл ---

  private update(dt: number): void {
    // на время рекламы игра стоит: ни дохода, ни таймеров комнат, ни анимации
    // (требование площадки, п. 4.7 — см. setPause)
    if (this.adPaused) return;

    // плавный доезд к выбранной комнате
    if (!this.dragging) {
      const d = this.targetX - this.world.x;
      if (Math.abs(d) > 0.5) this.world.x += d * Math.min(1, dt * 12);
      else this.world.x = this.targetX;
    }

    // комната, которую вынесло в кадр, могла отстать от состояния — дособираем
    // её здесь, до подсветки обучения (та ищет якорь в уже собранной комнате)
    this.refreshVisibleRooms();

    // котик «в руках»: взяли → чуть крупнее («поп»), мягко следует, лёгкая
    // деформация и наклон-отставание от движения
    if (this.grab) {
      const g = this.grab;
      g.t += dt;
      const v = g.sprite;
      // плавное следование за пальцем (инерция = естественное отставание корпуса)
      g.cx += (g.x - g.cx) * Math.min(1, dt * 16);
      g.cy += (g.y - g.cy) * Math.min(1, dt * 16);
      v.x = g.cx; v.y = g.cy;
      // сглаженное отставание от пальца ~ скорость (для наклона и сжатия)
      g.vx += ((g.x - g.cx) - g.vx) * Math.min(1, dt * 10);
      g.pop += (1 - g.pop) * Math.min(1, dt * 9); // «поп» масштаба при взятии
      const popK = 0.9 + 0.1 * g.pop;
      const stretch = Math.max(-1, Math.min(1, g.vx * 0.02)); // тянется по ходу
      const breathe = Math.sin(g.t * 3) * 0.015;              // лёгкое «дыхание»
      v.scale.set(
        g.baseScale * popK * (1 + Math.abs(stretch) * 0.06 - breathe),
        g.baseScale * popK * (1 - Math.abs(stretch) * 0.05 + breathe),
      );
      const targetRot = Math.max(-0.22, Math.min(0.22, g.vx * 0.004));
      v.rotation += (targetRot - v.rotation) * Math.min(1, dt * 12);
      if (g.glow) { // ореол следует за котом в руках
        g.glow.position.copyFrom(v.position);
        g.glow.scale.set(v.scale.x * GLOW_OUT, v.scale.y * GLOW_OUT);
        g.glow.rotation = v.rotation;
      }
      this.carryEdgeScroll(dt); // у края экрана — переносим кота в соседнюю комнату
    }

    // таймеры/анимация текущей комнаты
    this.rooms[this.currentRoom]?.tick?.(dt);

    // обучение новичка: подсветка догоняет цель каждый кадр (кот на полу ходит)
    this.tutorial.update(dt);

    // расход корма в реальном времени (dt — секунды; ставка — в минуту)
    const foodRate = foodRatePerMin(this.state);
    if (foodRate > 0 && this.state.food > 0) {
      this.state.food = Math.max(0, this.state.food - (foodRate / 60) * dt);
    }
    // «Автокормушка» (исследование): опустела — сама докупает корм за 💰, пока есть монеты
    if (foodRate > 0 && this.state.food <= 0 && autoFeedEnabled(this.state)) {
      const r = buyFood(this.state, 'full');
      if (r.ok) this.commit();
    }
    // тост ровно в момент опустошения кормушки (не спамим каждый кадр)
    const starving = isStarving(this.state);
    if (starving && !this.wasStarving) this.toast(t('Корм закончился! 🍽 Покорми котов в Питомнике', 'The food ran out! 🍽 Feed the cats in the Cattery'));
    this.wasStarving = starving;

    // пассивный доход (живое накопление; при голоде netIncomePerMin = 0)
    const rate = netIncomePerMin(this.state);
    if (rate > 0) {
      this.incomeAcc += (rate / 60) * dt;
      const whole = Math.floor(this.incomeAcc);
      if (whole > 0) { this.state.coins += whole; this.incomeAcc -= whole; }
    }
    this.state.lastSeenAt = this.now();

    // вязка завершилась → малыш сам появляется в слоте между родителями (красивый
    // эффект играет в инкубаторе). Кнопки «Забрать» больше нет. Мест не ищем — малыш
    // ждёт в слоте, игрок пристроит его кнопками/перетаскиванием.
    if (this.state.slots.some((s) => s.readyAt > 0 && this.now() >= s.readyAt)) {
      const events = collectReady(this.state, this.now(), this.rng);
      this.commit();
      const born = events.filter((e) => e.kitten).length;
      const rep = events.reduce((sum, e) => sum + (e.rep ?? 0), 0);
      if (born) {
        // первую в Котодексе породу отмечаем отдельной фанфарой — событие редкое,
        // обычное рождение звучит скромнее (на выводок один звук, а не по малышу)
        sfxEvent(events.some((e) => e.kitten && e.newBreed) ? 'newbreed' : 'birth');
        // Легендарная порода, открытая впервые — вершина селекции и лучший момент
        // спросить об оценке (окно придёт после карточки рождения, см. update).
        if (events.some((e) => e.newBreed && e.kitten?.rarityTier === 'legendary')) this.wantReview();
        const base = born > 1 ? t(`Малыши родились: ${born} 🐾`, `Kittens born: ${born} 🐾`) : t('Малыш родился! 🐾', 'A kitten is born! 🐾');
        this.toast(rep ? `${base} +${rep} ⭐` : base);
      }
    }

    // доска заказов: заказ, чей 6-часовой таймер жизни истёк, сам сменяется свежим
    // (внутри — no-op, если ничего не просрочено, поэтому проверяем каждый кадр)
    if (refreshExpiredOrders(this.state, this.rng, this.now())) {
      this.commit();
      this.toast(t('📋 Заказ на доске сменился! Загляни в Приют', '📋 An order on the board has changed! Check the Shelter'));
    }

    // стол исследований (Генолаб → Исследования): таймер дошёл → открываем
    // случайный рецепт из достижимого пула (в Котодексе появится чёрный силуэт)
    if (this.state.recipeResearch?.readyAt > 0 && this.now() >= this.state.recipeResearch.readyAt) {
      const res = finishRecipeResearch(this.state, this.now(), this.rng);
      this.commit();
      // какой именно рецепт достался — не говорим: колбу вскрывают руками в
      // Генолабе (стол исследований → «Вскрыть колбу»), там и раскрытие
      if (res.sealed) this.toast(t('🧪 Исследование готово! Колба ждёт в Генолабе', '🧪 Research is done! A flask is waiting in the Genolab'));
      else if (res.refunded) this.toast(t('Исследовать нечего — все рецепты открыты, ресурсы возвращены ↩', 'Nothing left to research — every recipe is known, resources refunded ↩'));
    }

    // Панель повышения уровня — когда экран свободен: не поверх другого оверлея и
    // не вместо окна «С возвращением» (у него приоритет при входе в игру).
    if (this.pendingLevelUp && !this.overlayOpen && !this.pendingOffline) this.showLevelUpPanel();
    // Поздравление с окончанием обучения — там же в очереди, после уровня: подарок
    // за обучение не должен спорить с фанфарой уровня за одного и того же кота.
    if (this.pendingTutorDone && !this.overlayOpen && !this.pendingOffline && !this.pendingLevelUp) {
      this.showTutorDonePanel();
    }
    // Финал коллекции — последним в очереди: это самая крупная новость, и она не
    // должна мелькнуть под карточкой рождения или фанфарой уровня за того же кота.
    if (this.pendingAllBreeds && !this.overlayOpen && !this.pendingOffline
      && !this.pendingLevelUp && !this.pendingTutorDone) {
      this.showAllBreedsPanel();
    }
    // Просьба оценить игру — в самом хвосте очереди: окно платформы не должно
    // накладываться ни на одно наше окно и не должно идти в одной цепочке с
    // рекламой (после ролика выдерживаем тишину, см. adRecently).
    if (this.pendingReview && !this.overlayOpen && !this.pendingOffline
      && !this.pendingLevelUp && !this.pendingTutorDone && !this.pendingAllBreeds
      && !adRecently()) {
      this.askReview();
    }

    this.updateHud();

    // отложенный автосейв: не чаще раза в 8 с, но и не реже, пока есть изменения
    if (this.saveDirty) {
      this.saveTimer += dt;
      if (this.saveTimer > 8) { this.saveTimer = 0; this.saveDirty = false; this.save(); }
    }

    // затухание тоста
    if (this.toastBox.alpha > 0 && this.now() > this.toastUntil) {
      this.toastBox.alpha = Math.max(0, this.toastBox.alpha - dt * 2);
    }
  }
}