/**
 * Контракт между Game-контроллером и комнатами/оверлеями.
 * Game реализует UiContext и передаёт себя фабрикам комнат — без циклов.
 */

import type { Application, Container, Texture, FederatedPointerEvent } from 'pixi.js';
import type { Rng } from '../genetics/index.js';
import type { Cat, GameState, BirthEvent } from '../game/index.js';

/** Параметры взятия котика «за шкирку» (живой котик в комнате). */
export interface GrabOpts {
  cat: Cat;
  displayH: number;          // экранная высота котика (для позы виса)
  hide(): void;              // спрятать наземного котика на время виса
  show(): void;              // вернуть котика
  onTap(): void;             // тап без перетаскивания → меню кота
  onDrop(sceneX: number, sceneY?: number): void; // отпустили → приземлить (X + глубина по Y); коорд. виртуальной сцены (uiRoot)
}

export interface Room {
  id: string;
  title: string;
  container: Container;
  /** Полностью пересобрать содержимое из текущего состояния. */
  refresh(): void;
  /** Покадровое обновление (таймеры, анимация). dt — секунды. */
  tick?(dt: number): void;
  /** (Генолаб) переключить активную под-секцию — навигация/DEV. */
  setSection?(id: string): void;
  /**
   * Уронили перетаскиваемого кота в этой комнате (координаты виртуальной
   * сцены — см. UiContext.uiRoot; НЕ пиксели окна: сцена масштабируется).
   * Вернуть true, если кот пристроен (состояние изменилось) — иначе он вернётся назад.
   */
  tryDropCat?(cat: Cat, sceneX: number, sceneY: number): boolean;
  /**
   * Узел-«якорь» для подсветки обучения (см. src/ui/tutorial.ts): комната
   * отдаёт свой живой узел по ключу — `cat:<id>`, `slot`, `breed`, `freeSkip`.
   * Возвращаем сам узел, а не координаты: комнаты пересобираются, а кот на полу
   * ещё и ходит — подсветка каждый кадр берёт свежий getBounds(). Нет узла
   * (не та комната, элемента сейчас нет на экране) → null.
   */
  anchor?(key: string): Container | null;
}

export interface UiContext {
  readonly app: Application;
  /**
   * Корень виртуальной сцены. Окно и сцена — разные системы координат: сцена
   * равномерно масштабируется под окно (фикс. виртуальная высота + леттербокс).
   * Все координаты в контрактах UI (tryDropCat, onDrop) — в системе uiRoot;
   * из событий их получают как `uiRoot.toLocal(e.global)`, а в локальные
   * координаты контейнера — `container.toLocal(point, uiRoot)`.
   */
  readonly uiRoot: Container;
  /** Живое состояние (Game может заменить ссылку при загрузке/сбросе). */
  readonly state: GameState;
  readonly rng: Rng;
  /** Геометрия одной комнаты. */
  readonly roomW: number;
  readonly roomH: number;
  /** Высота верхнего HUD (контент комнаты начинается ниже). */
  readonly topInset: number;
  now(): number;
  /** Применить изменения состояния: пересобрать HUD/комнаты + автосейв. */
  commit(): void;
  toast(msg: string): void;
  catTexture(cat: Cat): Texture;
  /** Выбор пары для вязки (id котов, максимум 2). */
  readonly selection: string[];
  toggleSelect(catId: string): void;
  clearSelection(): void;
  goRoom(index: number): void;
  /**
   * Ось текущего жеста перетаскивания, выбирается по первому движению:
   *   'h' — горизонтальный свайп между комнатами (навигация ведёт его сама);
   *   'v' — вертикальная прокрутка контента внутри комнаты;
   *   'none' — ещё не решено / жеста нет.
   * Комнаты со скроллом читают её, чтобы прокрутка и навигация не срабатывали
   * одновременно (либо тянем меню вниз, либо уходим в соседнюю комнату).
   */
  readonly gestureAxis: 'none' | 'h' | 'v';
  openCatMenu(cat: Cat): void;
  /**
   * Кот, чьё инфо-меню сейчас открыто (или недавно закрылось). Пока `frozen` —
   * «живой пол» держит кота на месте; иконка ℹ️ над именем видна, пока
   * `Date.now() < iconUntil` — так кота не теряют в толпе после закрытия меню.
   */
  infoFocus(): { id: string; frozen: boolean; iconUntil: number } | null;
  /** Подтверждение пристройства кота («в добрые руки»): открывается из зоны переноски. */
  openAdoptConfirm(cat: Cat): void;
  /** Подтверждение сдачи кота в лабораторию (за 🧬): открывается из лабораторного слота. */
  openLabConfirm(cat: Cat): void;
  /** Массовое пристройство «Раздать всех» (кнопка вверху приюта). */
  openBulkAdoptConfirm(): void;
  /** Массовая сдача «В лабораторию всех» (кнопка вверху приюта). */
  openBulkLabConfirm(): void;
  /**
   * Диалог лечения у ветеринара (💉): шприц Инкубатора, притащенный на кота в слоте.
   * `onHealed` вызывается после успешного лечения (уже с обновлённым состоянием) —
   * комната играет свой эффект над котом; аргумент — сколько ❤ восстановили.
   */
  openHealConfirm(cat: Cat, onHealed?: (hearts: number) => void): void;
  /** Меню криокапсулы (Крио-банк): клонировать за 🧬 + 💰 / утилизировать / инфо. */
  openCryoMenu(cat: Cat): void;
  /** Диалог заморозки в криокапсулу (🧊 📺/💰/💎): станция-криокапсула в Питомнике. */
  openFreezeConfirm(cat: Cat): void;
  /** Подменю «Вырастить сейчас» котёнка: выбор 📺 реклама или 💎 кристаллы. */
  openGrowConfirm(cat: Cat): void;
  /** Дерево родословной кота (до прадедов; неизвестные узлы — «???», туман). */
  openPedigree(cat: Cat): void;
  /** Подтверждение Генетического анализа (💰/📺): вскрыть родословную и скрытые гены. */
  openAnalyzeConfirm(cat: Cat): void;
  /** Карточка породы из Котодекса: портрет/силуэт + рецепты с условиями и шансами. */
  openBreedCard(breedKey: string): void;
  /** Превью пары «тир-тизер»: распределение исходов вязки (кнопка 🔮 в инкубаторе). */
  openPairPreview(mother: Cat, father: Cat): void;
  /** Карточка(и) новорождённых после «Забрать» в инкубаторе. */
  openBirthCard(events: BirthEvent[]): void;
  /** Всплывающее меню усилителя вязки (Генная инженерия у названия Инкубатора). */
  openBoostMenu(boostId: string): void;
  /** Подтверждение покупки узла дерева «Улучшения» (Генолаб) — защита от случайного тапа. */
  openResearchConfirm(defId: string): void;
  openOrders(): void;
  /** Справка комнаты (кнопка ℹ️ в титульной плашке) — тексты в src/ui/roomHelp.ts. */
  openRoomHelp(roomId: string): void;
  /** Начать взятие котика за шкирку (вызывается из pointerdown по котику). */
  startGrab(opts: GrabOpts, e: FederatedPointerEvent): void;
  /**
   * Кот «в руках» прямо сейчас (перетаскивание) и его позиция в координатах
   * виртуальной сцены (uiRoot), иначе null. Комнаты читают в tick, чтобы
   * подсвечивать зоны дропа под курсором (например, ауру пьедестала).
   */
  carrying(): { cat: Cat; x: number; y: number } | null;
}
