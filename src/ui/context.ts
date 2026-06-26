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
  onDrop(globalX: number): void; // отпустили → приземлить по X
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
   * Уронили перетаскиваемого кота в этой комнате (глобальные экранные коорд.).
   * Вернуть true, если кот пристроен (состояние изменилось) — иначе он вернётся назад.
   */
  tryDropCat?(cat: Cat, globalX: number, globalY: number): boolean;
}

export interface UiContext {
  readonly app: Application;
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
  openCatMenu(cat: Cat): void;
  /** Дерево родословной кота (до прадедов). */
  openPedigree(cat: Cat): void;
  /** Карточка(и) новорождённых после «Забрать» в инкубаторе. */
  openBirthCard(events: BirthEvent[]): void;
  /** Всплывающее меню усилителя вязки (Генная инженерия у названия Инкубатора). */
  openBoostMenu(boostId: string): void;
  openOrders(): void;
  openUpgrades(title: string, ids: string[]): void;
  /** Начать взятие котика за шкирку (вызывается из pointerdown по котику). */
  startGrab(opts: GrabOpts, e: FederatedPointerEvent): void;
}
