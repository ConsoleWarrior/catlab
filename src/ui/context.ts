/**
 * Контракт между Game-контроллером и комнатами/оверлеями.
 * Game реализует UiContext и передаёт себя фабрикам комнат — без циклов.
 */

import type { Application, Container, Texture } from 'pixi.js';
import type { Rng } from '../genetics/index.js';
import type { Cat, GameState } from '../game/index.js';

export interface Room {
  id: string;
  title: string;
  container: Container;
  /** Полностью пересобрать содержимое из текущего состояния. */
  refresh(): void;
  /** Покадровое обновление (таймеры, анимация). dt — секунды. */
  tick?(dt: number): void;
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
  openOrders(): void;
}
