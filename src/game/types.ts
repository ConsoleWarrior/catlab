/**
 * Типы игрового состояния (Этап 4). См. GAME.md.
 * Чистые данные — без графики. Сериализуются в сейв (облако Яндекса + локальный фолбэк).
 */

import type { Genotype, RarityTier } from '../genetics/index.js';

export type RoomId = 'incubator' | 'nursery' | 'shelter' | 'genolab';
export type LiveRoom = 'nursery' | 'shelter';
export type Currency = 'coins' | 'crystals' | 'dna';

/** Узел родословной: порода предка и (опц.) его собственные родители — вглубь до прадедов. */
export interface Ancestor {
  breed: string;
  mother?: Ancestor;
  father?: Ancestor;
}

/** Экземпляр кота в коллекции игрока. */
export interface Cat {
  id: string;
  genotype: Genotype;
  breed: string;             // ключ породы из каталога (moggie | persian | ...)
  name?: string;
  bornAt: number;            // timestamp рождения
  growthMs?: number;         // индивидуальная длительность взросления (медленный рост у «оставленных с роднёй»); по умолчанию KITTEN_GROWTH_MS
  location: LiveRoom;        // в какой комнате живёт
  rarityTier: RarityTier;    // кэш: тир из каталога породы
  analyzed: boolean;         // раскрыто ли скрытое носительство (Генолаб)
  breedCount: number;        // сколько раз участвовал в вязке (≥ MAX_BREEDS → «Старый»)
  motherBreed?: string;      // родословная: порода матери (если рождён в инкубаторе)
  fatherBreed?: string;      // родословная: порода отца
  pedigree?: { mother?: Ancestor; father?: Ancestor }; // дерево предков до прадедов (для родословной)
}

/** Слот вязки в инкубаторе. readyAt === 0 — слот пуст. */
export interface BreedingSlot {
  motherId: string | null;
  fatherId: string | null;
  startedAt: number;
  readyAt: number;
  // id новорождённого, «оставленного с родителями»: сидит в центре слота, растёт
  // втрое медленнее и блокирует постановку новых котов, пока его не унесут в комнату.
  kittenId: string | null;
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
  unlockedGenes: string[];          // открытые гены/фичи (Генолаб, легаси)
  discoveredBreeds: string[];       // когда-либо полученные породы (Котодекс)
  boosts: Record<string, number>;   // заряды генной инженерии (применяются при рождении)
  research: string[];               // изученные узлы дерева исследований (постоянные бонусы)
  unlockedRooms: RoomId[];
  orders: Order[];
  lastSeenAt: number;               // для офлайн/пассивного дохода
  nextId: number;                   // счётчик уникальных id
}
