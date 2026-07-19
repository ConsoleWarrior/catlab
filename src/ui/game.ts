/**
 * Game — контроллер игрового UI (Этап 4).
 * Разрез лаборатории: 4 комнаты в ряд, свайп-навигация, фиксированный HUD
 * ресурсов, оверлеи (меню кота, заказы), тикер с таймерами и пассивным
 * доходом, автосейв в localStorage и офлайн-доход при возврате.
 */

import {
  Application, Assets, Container, Graphics, Rectangle, Sprite, Text, BlurFilter,
} from 'pixi.js';
import type { Texture, FederatedPointerEvent } from 'pixi.js';
import { makeRng, randomCat, expressPhenotype, pick, BREEDS, breedName } from '../genetics/index.js';
import type { Rng } from '../genetics/index.js';
import type { Sex } from '../genetics/index.js';
import { buildCat } from '../render/catSprite.js';
import {
  createInitialState, serialize, deserialize, collectIncome, collectReady,
  netIncomePerMin, SAVE_VERSION, makeCatInstance, startBreeding, incubationDuration,
  moveCat, clearBreederSlot, keepKittenWithParents,
  nextLevelRep, unlocksAtLevel, LEVEL_REP_THRESHOLDS, MAX_LEVEL, addReputation,
  foodRatePerMin, isStarving, autoFeedEnabled, buyFood, cryoUnlocked,
  finishRecipeResearch, rollDailyOrders,
} from '../game/index.js';
import { isBusy, isInSlot, isAdult, freezeCat } from '../game/index.js';
import type { Cat, GameState, BirthEvent, Ancestor } from '../game/index.js';
import type { GrabOpts, Room, UiContext } from './context.js';
import { Button, COLORS, fmt, label } from './theme.js';
import { catTexture, setAiBreedTexture, aiHeldSpriteFor, rarityGlow, GLOW_OUT } from './catTextures.js';
import { loadEyeData } from './eyeBlink.js';
import { setRoomBg } from './roomArt.js';
import { setDecorTexture, decorZone } from './decorArt.js';
import { createIncubator } from './rooms/incubator.js';
import { createNursery } from './rooms/nursery.js';
import { createShelter } from './rooms/shelter.js';
import { createGenolab } from './rooms/genolab.js';
import { createCryobank } from './rooms/cryobank.js';
import {
  buildCatMenu, buildOrdersPanel, buildHelpPanel, buildBirthCard, buildPedigreePanel,
  buildBoostMenu, buildAdoptConfirm, buildLabConfirm, buildBulkAdoptConfirm, buildBulkLabConfirm,
  buildHealConfirm, buildCryoMenu,
  buildFreezeConfirm, buildAnalyzeConfirm, buildBreedCard, buildPairPreview,
  buildDevMenu, buildResearchConfirm,
} from './overlays.js';

const SAVE_KEY = 'catlab:save:v1';

// --- Виртуальное разрешение (требования Яндекс Игр, п. 1.6 и 1.10) ---
// Сцена всегда DESIGN_H виртуальных пикселей в высоту; ширина = высота × аспект
// окна, зажатый в допустимый диапазон. Канвас занимает всё окно, а корневой
// контейнер (root) равномерно масштабируется и центрируется: при ресайзе окна
// вся картинка растёт/уменьшается пропорционально (п. 1.6.2.3), игровое поле
// касается краёв окна хотя бы по одной оси (п. 1.6.2.1), остаток — леттербокс
// цвета фона. Весь UI продолжает считать раскладку от roomW×roomH — но теперь
// это стабильные виртуальные размеры, а не пиксели окна.
// На тач-устройствах виртуальная высота меньше: каждый виртуальный пиксель
// физически крупнее, весь UI (текст, кнопки, коты) растёт на ~16% — на
// телефоне 720 было нечитаемо мелко. Вёрстка не ломается: раскладка везде
// считается от roomW×roomH.
const IS_TOUCH = typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches;
const DESIGN_H = IS_TOUCH ? 580 : 720;
// уже 4:3 не сжимаемся (полосы сверху/снизу) — напр. портрет на мобиле, где
// платформа при одной поддерживаемой ориентации сама показывает заглушку
const MIN_ASPECT = 4 / 3;
// на десктопе длинная сторона поля не более чем вдвое больше короткой
// (п. 1.6.2.2); на телефонах лимита нет (п. 1.6.1 — полный экран), поэтому на
// тач-устройствах заполняем экран целиком (современные телефоны ≤ ~2.4:1)
const MAX_ASPECT = IS_TOUCH ? 2.5 : 2;

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
  private readonly toastBox = new Container();
  private rooms: Room[] = [];
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
  private shownLevel = 1;        // последний показанный уровень (для баннера повышения)
  private dots: Graphics[] = [];
  private hudPad = 0;            // левый отступ ряда ресурсов
  private hudGap = 0;            // зазор между ресурсами в ряду
  private hudBgTex?: Texture;    // текстурный фон топ-бара

  // подсветка переноски в приюте, когда кота тащат (лампа: мягкий ореол + ядро)
  private adoptGlow = new Container();
  private adoptGlowHalo = new Graphics();
  private adoptBlur = new BlurFilter({ strength: 8, quality: 3, kernelSize: 5 });

  // прочее
  private incomeAcc = 0;
  private saveTimer = 0;
  private wasStarving = false;   // для тоста «корм закончился» ровно при переходе к голоду
  private toastT: Text | null = null;
  private toastUntil = 0;

  now(): number { return Date.now(); }

  async start(reset = false): Promise<void> {
    // Ждём готовности Rubik (локальный woff2, @font-face в index.html)
    try { await document.fonts.ready; } catch { /* fallback */ }

    await this.app.init({
      background: COLORS.bg,
      antialias: true,
      resolution: Math.min(window.devicePixelRatio || 1, 2),
      autoDensity: true,
    });
    document.getElementById('app')!.appendChild(this.app.canvas);

    this.loadState(reset);
    this.shownLevel = this.state.level; // база для баннера повышения уровня
    this.wasStarving = isStarving(this.state); // не спамить тостом «корм закончился» на первом кадре

    // Готовый арт коллекции: варианты всех пород `<breed>__<n>.png` (включая
    // базовые T1: moggie и домашних), без привязки к полу. Грузим до сборки комнат;
    // вис делаем из той же текстуры. Нет ассета → кот рисуется процедурно (фолбэк).
    const breedAssets = import.meta.glob('../assets/breeds/*.png', {
      eager: true, query: '?url', import: 'default',
    }) as Record<string, string>;

    await Promise.all(Object.entries(breedAssets).map(async ([path, url]) => {
      const name = path.split('/').pop()!.replace('.png', ''); // <breed>__<n>
      try { setAiBreedTexture(name, await Assets.load(url)); } catch { /* фолбэк */ }
    }));
    await loadEyeData(); // свежая разметка глаз (DEV) до сборки комнат

    // Готовые фоны комнат («комната-коробка» в нашей перспективе) — по имени файла
    // = id комнаты. Нет фона → процедурная коробка (фолбэк в roomShell).
    const roomAssets = import.meta.glob('../assets/rooms/*.png', {
      eager: true, query: '?url', import: 'default',
    }) as Record<string, string>;
    await Promise.all(Object.entries(roomAssets).map(async ([path, url]) => {
      const id = path.split('/').pop()!.replace('.png', '');
      try { setRoomBg(id, await Assets.load(url)); } catch { /* фолбэк на коробку */ }
    }));

    // Декор комнат (интерьерные спрайты, расставленные в Декор-лабе) — по имени файла
    // = ключ текстуры. Расстановка задана в decorArt.ts; нет текстуры → спрайт пропускается.
    const decorAssets = import.meta.glob('../assets/decor/*.png', {
      eager: true, query: '?url', import: 'default',
    }) as Record<string, string>;
    await Promise.all(Object.entries(decorAssets).map(async ([path, url]) => {
      const name = path.split('/').pop()!.replace('.png', '');
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
    const hudAssets = import.meta.glob('../assets/hud/*.png', {
      eager: true, query: '?url', import: 'default',
    }) as Record<string, string>;
    for (const url of Object.values(hudAssets)) {
      try { this.hudBgTex = await Assets.load(url); break; } catch { /* останется белый фон */ }
    }

    this.app.stage.eventMode = 'static';
    this.app.stage.addChild(this.root);
    this.root.addChild(this.world, this.hud, this.nav, this.dragLayer, this.overlayLayer, this.toastBox, this.rootMask);
    this.root.mask = this.rootMask;
    // Тост и слой «кота в руках» — чисто визуальные. Без этого пустой тост-контейнер
    // (по центру внизу, roomW/2 × roomH-56) своими границами перехватывал хит-тест и
    // не пускал тапы к кнопкам под ним — это и был баг «кнопки над навигацией не
    // кликаются» (центр-низ, и на ПК, и на мобиле). 'none' убирает весь поддерево из
    // обработки событий, на отрисовку/анимацию тоста не влияет.
    this.toastBox.eventMode = 'none';
    this.dragLayer.eventMode = 'none';

    // структура подсветки переноски: мягкий ореол (BlurFilter) + яркое ядро
    this.adoptGlowHalo.filters = [this.adoptBlur];
    this.adoptGlow.addChild(this.adoptGlowHalo);
    this.adoptGlow.visible = false;

    this.resize();
    this.installInput();
    this.app.ticker.add((t) => this.update(Math.min(t.deltaMS / 1000, 0.05)));

    // первый запуск — показываем инструкцию (но не во время скриншотов ?reset)
    if (this.freshGame && !reset) this.openHelp();

    // автосейв при сворачивании/закрытии
    document.addEventListener('visibilitychange', () => { if (document.hidden) this.save(); });
    window.addEventListener('beforeunload', () => this.save());
    // Канвас привязан к visualViewport — реально видимой области. На мобиле
    // layout-вьюпорт (window.innerHeight) часто больше: низ канваса уходит под
    // адресную строку и под навигацией появляется «пустая полоса». visualViewport
    // даёт точную видимую высоту, поэтому навигация всегда у настоящего низа.
    const onResize = (): void => this.resize();
    window.addEventListener('resize', onResize);
    window.addEventListener('orientationchange', () => setTimeout(onResize, 250));
    window.visualViewport?.addEventListener('resize', onResize);
    window.visualViewport?.addEventListener('scroll', onResize);

    if (import.meta.env.DEV) {
      (window as unknown as { __game: unknown }).__game = {
        app: this.app, state: this.state,
        goRoom: (i: number) => this.goRoom(i),
        openOrders: () => this.openOrders(),
        openHelp: () => this.openHelp(),
        openDev: () => this.openDevMenu(),
        openBoostMenu: (id = 'tierUp') => this.openBoostMenu(id),
        openCatMenu: (id?: string) => {
          const c = id ? this.state.cats.find((x) => x.id === id) : this.state.cats[0];
          if (c) this.openCatMenu(c);
        },
        openHeal: (id?: string) => { // диалог клиники (проверка UI лечения)
          const c = id ? this.state.cats.find((x) => x.id === id) : this.state.cats[0];
          if (c) this.openHealConfirm(c);
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
      const r = startBreeding(this.state, 0, f.id, m.id, now);
      if (r.ok) {
        const slot = this.state.slots[0]!;
        const total = incubationDuration(this.state);
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

  private loadState(reset: boolean): void {
    if (!reset) {
      try {
        const raw = localStorage.getItem(SAVE_KEY);
        if (raw) {
          const s = deserialize(raw);
          if (s && s.version === SAVE_VERSION) {
            this.state = s;
            this.applyOffline();
            return;
          }
        }
      } catch { /* битый сейв — начинаем заново */ }
    }
    this.state = createInitialState(this.rng, this.now());
    this.freshGame = true;
  }

  /** Офлайн-прогресс: родившиеся котята + накопленный доход. */
  private applyOffline(): void {
    const now = this.now();
    const events = collectReady(this.state, now, this.rng);
    // Офлайн-рождения показать негде — расселяем малышей по комнатам (если есть
    // место), а если мест нет нигде — оставляем с роднёй в слоте (растут медленно).
    for (const e of events) {
      if (!e.kitten) continue;
      const id = e.kitten.id;
      if (!moveCat(this.state, id, 'nursery').ok && !moveCat(this.state, id, 'shelter').ok) {
        keepKittenWithParents(this.state, id, now);
      }
    }
    const born = events.filter((e) => e.kitten).length;
    const rep = events.reduce((sum, e) => sum + (e.rep ?? 0), 0);
    const inc = collectIncome(this.state, now);
    const parts: string[] = [];
    if (born) parts.push(`родилось котят: ${born} 🐱`);
    if (rep) parts.push(`+${rep} ⭐`);
    if (inc.coins) parts.push(`доход: +💰${inc.coins}`);
    if (parts.length) setTimeout(() => this.toast('С возвращением! ' + parts.join(', ')), 600);
  }

  save(): void {
    try { localStorage.setItem(SAVE_KEY, serialize(this.state)); } catch { /* квота/приватный режим */ }
  }

  // --- UiContext ---

  commit(): void {
    for (const r of this.rooms) r.refresh();
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
    this.saveTimer = 0; // отложенный сейв в update()
  }

  toast(msg: string): void {
    if (!this.toastT) return;
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

  goRoom(index: number): void {
    this.currentRoom = Math.max(0, Math.min(this.rooms.length - 1, index));
    this.targetX = -this.currentRoom * this.roomW;
    this.updateNav();
  }

  openCatMenu(cat: Cat): void {
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

  openHealConfirm(cat: Cat): void {
    const close = (): void => this.closeOverlay();
    this.showOverlay(buildHealConfirm(this, cat, close));
  }

  openCryoMenu(cat: Cat): void {
    const close = (): void => this.closeOverlay();
    this.showOverlay(buildCryoMenu(this, cat, close));
  }

  openFreezeConfirm(cat: Cat): void {
    const close = (): void => this.closeOverlay();
    this.showOverlay(buildFreezeConfirm(this, cat, close));
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

  openPairPreview(mother: Cat, father: Cat): void {
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
    const close = (): void => this.closeOverlay();
    this.showOverlay(buildOrdersPanel(this, close));
  }

  openHelp(): void {
    const close = (): void => this.closeOverlay();
    this.showOverlay(buildHelpPanel(this, close));
  }

  /** ⚠️ ВРЕМЕННОЕ DEV-меню (кнопка 🛠, только import.meta.env.DEV) — убрать перед релизом. */
  openDevMenu(): void {
    const close = (): void => this.closeOverlay();
    this.showOverlay(buildDevMenu(this, close));
  }

  startGrab(opts: GrabOpts, e: FederatedPointerEvent): void {
    if (this.overlayOpen) return;
    const p = this.root.toLocal(e.global); // окно → виртуальные координаты сцены
    this.pendingGrab = { opts, sx: p.x, sy: p.y };
  }

  /** Начать вис кота «в руках»; gx/gy — виртуальные координаты сцены (root). */
  private beginGrab(gx: number, gy: number): void {
    if (!this.pendingGrab) return;
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
      glow = rarityGlow(sprite, opts.cat.rarityTier, opts.displayH);
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
    this.updateAdoptGlow(false);

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
    const lo = this.roomIndex('incubator');
    const hi = this.roomIndex('shelter');
    // 2 c между сменами комнат — чтобы не проскакивать центральную комнату насквозь
    if (g.x < edge && this.currentRoom > lo) { this.goRoom(this.currentRoom - 1); g.edgeCd = 2; }
    else if (g.x > this.roomW - edge && this.currentRoom < hi) { this.goRoom(this.currentRoom + 1); g.edgeCd = 2; }
  }

  /** Подсветка переноски золотым свечением (как от лампы) при перетаскивании кота. */
  private updateAdoptGlow(show: boolean, t = 0): void {
    const room = this.rooms[this.currentRoom];
    if (!room || !show || room.id !== 'shelter') {
      this.adoptGlow.visible = false;
      return;
    }
    const zone = decorZone('shelter', 'adopt', this.roomW, this.roomH);
    if (!zone) { this.adoptGlow.visible = false; return; }
    const cx = zone.x + zone.width / 2;
    const cy = zone.y + zone.height / 2;

    // перекладываем в контейнер нужной комнаты (первый раз / после смены комнаты)
    if (this.adoptGlow.parent !== room.container) {
      this.adoptGlow.removeFromParent();
      // втыкаем перед декорациями, чтобы свечение было под спрайтом переноски (из-под неё)
      room.container.addChildAt(this.adoptGlow, 3);
    }

    const pulse = 0.65 + 0.35 * Math.sin(t * 2.75);
    this.adoptGlow.visible = true;

    // Мягкий круг света от переноски - BlurFilter делает края тусклыми
    this.adoptGlowHalo.clear();
    this.adoptGlowHalo
      .circle(cx, cy, Math.max(zone.width, zone.height) * 0.40)
      .fill({ color: 0xffd700, alpha: 0.5 * pulse });
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
    const r = moveCat(this.state, cat.id, room);
    if (!r.ok) { this.toast(r.reason); return false; } // нет места → вернётся в слот
    clearBreederSlot(this.state, cat.id); // если был родителем — снять (для малыша no-op)
    this.commit();
    this.toast(room === 'shelter' ? 'Котик в приюте 🏠' : 'Котик в питомнике 🏆');
    return true;
  }

  // --- раскладка ---

  /** Подгоняем рендерер под реально видимую область (см. onResize выше). */
  private resize(): void {
    // Пока в фокусе HTML-поле ввода (переименование кота), мобильная клавиатура
    // ужимает visualViewport — НЕ пересчитываем сцену, иначе игра «схлопывается»
    // под остаток экрана над клавиатурой. При закрытии поля вьюпорт вернётся и
    // придёт финальный resize, который всё восстановит.
    if (document.activeElement instanceof HTMLInputElement) return;
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

    // пересобираем комнаты под новый размер. adoptGlow — общий Game-объект,
    // который updateAdoptGlow() временно подвешивает в контейнер комнаты
    // «Приют»; открепляем его до destroy({children:true}), иначе он уничтожится
    // вместе с комнатой и следующий clear() на мёртвой Graphics уронит весь
    // тикер (после чего канвас просто перестаёт перерисовываться — снаружи это
    // выглядит как «геометрия всего съехала» при ресайзе окна).
    this.adoptGlow.removeFromParent();
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

    this.buildHud();
    this.buildNav();
    this.buildToast();

    this.currentRoom = Math.min(this.currentRoom, this.rooms.length - 1);
    this.targetX = -this.currentRoom * this.roomW;
    this.world.x = this.targetX;
    this.updateHud();
    this.updateNav();
    this.fitOverlay(); // открытая панель (если есть) — под новый размер экрана
  }

  private buildHud(): void {
    this.hud.removeChildren();
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
    this.dnaT = mk(0x7a4fd0);
    this.levelT = mk(COLORS.ink, fs);
    this.levelBar = new Graphics(); // тонкая полоска прогресса опыта под ⭐ Ур.
    this.hud.addChild(this.levelBar);

    const bh = Math.round(ti * 0.72);
    const helpW = Math.round(ti * 0.92);
    const help = new Button({ text: '❓', w: helpW, h: bh, color: COLORS.secondary, fontSize: fs + 3 });
    help.position.set(w - pad - helpW / 2, ti / 2);
    help.onTap = () => this.openHelp();

    this.hud.addChild(help);

    // ⚠️ ВРЕМЕННОЕ: кнопка режима разработчика (валюты/уровень). Только в dev-сборке
    // (в проде для Яндекса не появляется). Удалить вместе с buildDevMenu перед релизом.
    if (import.meta.env.DEV) {
      const devW = Math.round(ti * 0.92);
      const dev = new Button({ text: '🛠', w: devW, h: bh, color: COLORS.warn, textColor: COLORS.ink, fontSize: fs + 2 });
      dev.position.set(w - pad - helpW - 8 - devW / 2, ti / 2);
      dev.onTap = () => this.openDevMenu();
      this.hud.addChild(dev);
    }
  }

  private updateHud(): void {
    if (!this.coinsT) return;
    const rate = netIncomePerMin(this.state);
    this.coinsT.text = `💰 ${fmt(this.state.coins)}`;
    // при голоде доход стоит — показываем это прямо в шапке вместо ставки
    this.rateT.text = isStarving(this.state) ? '🍽 голод' : rate > 0 ? `+${rate.toFixed(rate < 10 ? 1 : 0)}/мин` : '';
    this.crystalsT.text = `💎 ${fmt(this.state.crystals)}`;
    this.dnaT.text = `🧬 ${fmt(this.state.dna)}`;
    this.levelT.text = `⭐ Ур. ${this.state.level}`;

    // ряд ресурсов слева: деньги и доход/мин стоят рядом, дальше кристаллы/ДНК/уровень.
    // Раскладка по реальной ширине текста — компактнее фиксированных слотов и без наезда.
    let x = this.hudPad;
    this.coinsT.position.x = x;
    x += this.coinsT.width + (this.rateT.text ? 8 : this.hudGap);
    if (this.rateT.text) {
      this.rateT.position.x = x;
      x += this.rateT.width + this.hudGap;
    }
    this.crystalsT.position.x = x; x += this.crystalsT.width + this.hudGap;
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
   * Баннер повышения уровня. Сверяет текущий уровень с последним показанным; при
   * росте — тост со списком того, что открылось (агрегирует все пройденные уровни,
   * если прыгнули через несколько сразу). Вызывается из commit() — ловит все
   * источники опыта (рождение/пристройство/лаборатория/заказ) единообразно.
   */
  private checkLevelUp(): void {
    if (this.state.level <= this.shownLevel) { this.shownLevel = this.state.level; return; }
    const from = this.shownLevel;
    this.shownLevel = this.state.level;
    const items: string[] = [];
    for (let lv = from + 1; lv <= this.state.level; lv++) items.push(...unlocksAtLevel(lv));
    this.toast(items.length
      ? `🎉 Уровень ${this.state.level}! Открыто: ${items.join(', ')}`
      : `🎉 Уровень ${this.state.level}!`);
  }

  private buildNav(): void {
    this.nav.removeChildren();
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
    this.toastBox.removeChildren();
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
    this.overlayLayer.removeChildren();
    this.overlayDim = null;
    this.overlayContent = null;
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
      if (this.overlayOpen) return;
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
      if (this.grab) { this.endGrab(); this.pendingGrab = null; return; }
      if (this.pendingGrab) { this.pendingGrab.opts.onTap(); this.pendingGrab = null; return; }
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
    // плавный доезд к выбранной комнате
    if (!this.dragging) {
      const d = this.targetX - this.world.x;
      if (Math.abs(d) > 0.5) this.world.x += d * Math.min(1, dt * 12);
      else this.world.x = this.targetX;
    }

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

      // подсветка переноски в приюте, когда тащим кота над комнатой
      this.updateAdoptGlow(true, g.t);
    } else {
      this.updateAdoptGlow(false);
    }

    // таймеры/анимация текущей комнаты
    this.rooms[this.currentRoom]?.tick?.(dt);

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
    if (starving && !this.wasStarving) this.toast('Корм закончился! 🍽 Покорми котов в Питомнике');
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
      const dead = events.filter((e) => e.stillborn).length;
      const rep = events.reduce((sum, e) => sum + (e.rep ?? 0), 0);
      if (born) {
        const base = born > 1 ? `Малыши родились: ${born} 🐾` : 'Малыш родился! 🐾';
        this.toast(rep ? `${base} +${rep} ⭐` : base);
      } else if (dead) this.toast('Котёнок не выжил 😿');
    }

    // доска заказов живёт сутками: в московскую полночь все слоты перевыпускаются
    // (внутри суток вызов — no-op, поэтому проверяем каждый кадр без опаски)
    if (rollDailyOrders(this.state, this.rng, this.now())) {
      this.commit();
      this.toast('📋 Новые заказы на день! Загляни в Приют');
    }

    // стол исследований (Генолаб → Исследования): таймер дошёл → открываем
    // случайный рецепт из достижимого пула (в Котодексе появится чёрный силуэт)
    if (this.state.recipeResearch?.readyAt > 0 && this.now() >= this.state.recipeResearch.readyAt) {
      const res = finishRecipeResearch(this.state, this.now(), this.rng);
      this.commit();
      if (res.recipe) this.toast(`📜 Рецепт изучен: «${breedName(res.recipe.result)}»! Загляни в Котодекс`);
      else if (res.refunded) this.toast('Исследовать нечего — все рецепты открыты, ресурсы возвращены ↩');
    }

    this.updateHud();

    // отложенный автосейв
    this.saveTimer += dt;
    if (this.saveTimer > 8) { this.saveTimer = 0; this.save(); }

    // затухание тоста
    if (this.toastBox.alpha > 0 && this.now() > this.toastUntil) {
      this.toastBox.alpha = Math.max(0, this.toastBox.alpha - dt * 2);
    }
  }
}