/**
 * Типы игрового состояния (Этап 4). См. GAME.md.
 * Чистые данные — без графики. Сериализуются в сейв (облако Яндекса + локальный фолбэк).
 */

import type { Genotype, RarityTier } from '../genetics/index.js';

export type RoomId = 'incubator' | 'nursery' | 'shelter' | 'genolab' | 'cryobank';
export type LiveRoom = 'nursery' | 'shelter';
export type Currency = 'coins' | 'crystals' | 'dna';

/**
 * Узел родословной: УНИКАЛЬНЫЙ id предка + его порода и (опц.) его собственные
 * родители — вглубь до прадедов. По совпадению id в деревьях пары игра
 * определяет родственников (инбридинг, см. kinship.ts). У сгенерированных
 * «скрытых» предков стартовых котов id тоже уникальны — ложных совпадений нет.
 *
 * `known` — «туман родословной»: узел РАСКРЫТ игроку (виден в UI). Отсутствие
 * флага = туман («???»). Известность — снимок на момент рождения котёнка:
 * родители известны по факту вязки, глубже — что было известно у родителя.
 * Механику известность НЕ меняет: скрытые гены влияют на рецепты всегда,
 * Генетический анализ лишь раскрывает информацию (revealPedigree).
 */
export interface Ancestor {
  id: string;
  breed: string;
  known?: boolean;
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
  analyzed: boolean;         // сделан ли Генетический анализ (вскрыты родословная и скрытые гены)
  breedCount: number;        // сколько раз участвовал в вязке (≥ maxHearts → «Старый»)
  // Запас здоровья (сердца) = лимит вязок. По умолчанию MAX_HEARTS (5); котёнок
  // от инбридинга может родиться с 3/1 сердцами или 0 (сразу «Бесплодный»).
  maxHearts: number;
  motherBreed?: string;      // родословная: порода матери (если рождён в инкубаторе)
  fatherBreed?: string;      // родословная: порода отца
  pedigree?: { mother?: Ancestor; father?: Ancestor }; // дерево предков до прадедов (для родословной)
  // Сид выбора базового арта («Дворовый» имеет несколько вариантов окраса). По
  // умолчанию используется id кота; клон наследует сид оригинала, чтобы выглядеть
  // идентично, несмотря на собственный уникальный id. См. ui/catTextures.breedTexFor.
  artId?: string;
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

/**
 * Заказ клиента = один слот доски. Слот ВСЕГДА держит активный заказ. У заказа свой
 * таймер жизни: expiresAt = createdAt + ORDER_REFRESH_MS (6 ч). Не выполнил за это время
 * — заказ сам сменяется новым (orders.refreshExpiredOrders). Выполнил — слот сразу
 * получает свежий (claimOrder). Раз в час один заказ можно обновить за 📺 (adRefreshOrder).
 */
export interface Order {
  id: string;
  req: OrderReq;
  reward: OrderReward;
  createdAt: number;
  expiresAt: number;         // момент авто-смены заказа (createdAt + ORDER_REFRESH_MS)
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
  boosts: Record<string, number>;   // склад зарядов усилителей (id → сколько куплено), любых типов
  activeBoost: string | null;       // какой усилитель СЕЙЧАС активен (сработает в вязке); единовременно только один
  research: Record<string, number>; // id узла дерева «Улучшений» → купленный уровень (0/нет — не начат)
  // Система знаний: рецепты, открытые ИССЛЕДОВАНИЕМ (ключи recipeKey; выведенные
  // породы отдельно — discoveredBreeds). Порода «изучена» = выведена ИЛИ рецепт открыт.
  knownRecipes: string[];
  // Стол исследования рецептов (вкладка «Исследования» Генолаба): 1 слот-таймер.
  // readyAt === 0 — стол свободен. По завершении finishRecipeResearch выдаёт
  // случайный рецепт из достижимого пула (researchableRecipes). paidCoins/paidDna —
  // фактически уплаченная цена запуска (зависит от уровня лабы); нужна для точного
  // возврата, если пул опустеет за время исследования (уровень мог вырасти).
  recipeResearch: { startedAt: number; readyAt: number; paidCoins: number; paidDna: number };
  cryo: Cat[];                      // замороженные коты в криокапсулах (крио-банк): не едят/не доход/не вязка
  unlockedRooms: RoomId[];
  orders: Order[];                  // ORDER_TARGET слотов, каждый с активным заказом (см. orders.ts)
  orderAdRefreshAt: number;         // глобальный кулдаун 📺-обновления заказа (0 — доступно)
  // Корзина заказов (зона в Приюте): кот, которым можно закрыть заказ. Выполнить
  // заказ можно ТОЛЬКО котом из корзины — id, либо null, если корзина пуста.
  orderBasket: string | null;
  champions: (string | null)[];     // id кота-чемпиона по индексу пьедестала (null — слот пуст)
  food: number;                     // запас корма в кормушке (ед.); мягкий голод при 0
  lastSeenAt: number;               // для офлайн/пассивного дохода
  lastHealAdAt: number;             // факт последнего 📺-лечения в клинике (кулдауна нет)
  lastAnalyzeAdAt: number;          // глобальный кулдаун 📺-варианта Генетического анализа
  lastFreezeAdAt: number;           // глобальный кулдаун 📺-варианта заморозки в крио-банке
  nextId: number;                   // счётчик уникальных id
}
