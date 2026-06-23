/**
 * Типы игрового состояния (Этап 4). См. GAME.md.
 * Чистые данные — без графики. Сериализуются в сейв (облако Яндекса + локальный фолбэк).
 */

import type { Genotype, RarityTier } from '../genetics/index.js';

export type RoomId = 'incubator' | 'nursery' | 'shelter' | 'genolab';
export type LiveRoom = 'nursery' | 'shelter';
export type Currency = 'coins' | 'crystals' | 'dna';

/** Экземпляр кота в коллекции игрока. */
export interface Cat {
  id: string;
  genotype: Genotype;
  name?: string;
  bornAt: number;            // timestamp рождения
  location: LiveRoom;        // в какой комнате живёт
  rarityTier: RarityTier;    // кэш из calcRarity
  analyzed: boolean;         // раскрыто ли скрытое носительство (Генолаб)
}

/** Слот вязки в инкубаторе. readyAt === 0 — слот пуст. */
export interface BreedingSlot {
  motherId: string | null;
  fatherId: string | null;
  startedAt: number;
  readyAt: number;
}

/** Требования заказа к фенотипу кота (любое подмножество). */
export interface OrderReq {
  baseColor?: string;
  pattern?: string;          // TabbyPattern | 'solid'
  earShape?: string;
  coatLength?: string;
  breed?: string;
  minRarity?: RarityTier;
}

export interface OrderReward {
  coins: number;
  crystals: number;
  dna: number;
  reputation: number;
}

export interface Order {
  id: string;
  req: OrderReq;
  reward: OrderReward;
  createdAt: number;
  expiresAt: number;         // 0 — бессрочный
}

/** Полное игровое состояние. */
export interface GameState {
  version: number;
  coins: number;
  crystals: number;
  dna: number;
  level: number;
  reputation: number;
  cats: Cat[];
  slots: BreedingSlot[];
  upgrades: Record<string, number>; // id апгрейда → уровень
  unlockedGenes: string[];          // открытые гены/фичи (Генолаб)
  unlockedRooms: RoomId[];
  orders: Order[];
  lastSeenAt: number;               // для офлайн/пассивного дохода
  nextId: number;                   // счётчик уникальных id
}
