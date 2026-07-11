/**
 * Конфиг баланса (Этап 4). Все числа — первый проход, тюнятся на плейтестах.
 * Менять баланс здесь, не в логике. См. GAME.md §5–6.
 */

import type { RarityTier, BreedBoosts, KinshipLevel } from '../genetics/index.js';
import type { Currency } from './types.js';

export const SAVE_VERSION = 6; // v6: многоуровневое дерево исследований (state.research: id→уровень) — старые сейвы сбрасываются

/** Ценность кота по тиру редкости: образец (🧬), пассив питомника (💰/мин, легаси). */
export const TIER_VALUE: Record<RarityTier, { adopt: number; dna: number; incomePerMin: number }> = {
  common: { adopt: 20, dna: 1, incomePerMin: 1 },
  uncommon: { adopt: 60, dna: 3, incomePerMin: 3 },
  rare: { adopt: 200, dna: 8, incomePerMin: 10 },
  epic: { adopt: 800, dna: 20, incomePerMin: 25 },
  legendary: { adopt: 3000, dna: 60, incomePerMin: 60 },
};

// --- Рыночная ценность кота (продажа/заказы/выставка/лаборатория) ---
// Единая шкала «сколько стоит кот»: тир — главный фактор порядка величины,
// порода внутри тира (breedValueMult), родословная и здоровье уточняют цену.
// См. economy.catMarketValue.
export const TIER_MARKET_VALUE: Record<RarityTier, number> = {
  common: 50, uncommon: 160, rare: 520, epic: 2000, legendary: 7500,
};

// Родословная: +за каждое известное поколение сверх родителей, +за «породистость»
// предков (средний тир) и премия за чистую линию (без дворовых в древе).
export const PEDIGREE_VALUE_PER_GEN = 0.12;   // +12% за поколение известной родословной (сверх 1-го)
export const PEDIGREE_VALUE_PER_TIER = 0.10;  // +10% × средний тир предков
export const PEDIGREE_VALUE_PURE = 0.25;      // +25% за чистую линию
export const PEDIGREE_VALUE_MAX = 1.8;        // потолок множителя родословной

// Здоровье: полный запас сердец = ×1.0; урезанный инбридингом — дешевле как
// производитель. HEALTH_VALUE_FLOOR — множитель при 0 сердец («Бесплодный»).
export const HEALTH_VALUE_FLOOR = 0.6;

// «В добрые руки»: доля рыночной цены (в разы меньше продажи по заказу) + немного 🧬.
export const ADOPT_COIN_FRACTION = 0.25;
export const ADOPT_DNA_FRACTION = 0.5;

// --- Лаборатория (кот → 🧬 гены) ---
// Кот уезжает «на эксперименты»: главный способ добыть гены из лишних котов.
export const LAB_DNA_RATE = 0.08;             // 🧬 = round(catMarketValue × rate)
export const LAB_COIN_RATE = 0.05;            // немного 💰 сверху

// --- Корм (контейнер + мягкий голод, этап B) ---
// У кормушки есть запас `state.food`, который расходуется, пока в приюте/питомнике
// живут коты сверх бесплатного лимита. Кончился корм → пассивный доход стоит и
// новые вязки не стартуют (коты «грустят»), но сердца НЕ сгорают и казна в минус не
// уходит (мягкий голод). Механика открывается уровнем лаборатории (LAB_UNLOCKS.food).
export const FOOD_CAP_BASE = 200;             // ёмкость кормушки (ед.); расширение — узлом исследований (этап C)
export const FOOD_PER_CAT_PER_MIN = 0.2;      // расход корма на кота сверх лимита в минуту
export const FEED_FREE_CATS = 3;              // первые N котов не едят (стартовый комфорт)
export const FOOD_PACK_UNITS = 50;            // размер пакета корма (кнопка «Купить»)
export const FOOD_PACK_COST = 25;             // 💰 за пакет (цена «до полного» — пропорциональна)

// --- Выставка / чемпионы ---
// Пассивный 💰 приносят только коты-чемпионы (их 1..3, championSlots).
// Доход чемпиона ∝ его рыночной ценности (выгодно выставлять лучших),
// далее умножается на «Выставку» (show) и исследования дохода.
export const CHAMPION_SLOTS_BASE = 1;
export const CHAMPION_INCOME_RATE = 0.002;    // 💰/мин = catMarketValue × rate

// --- Ускорение таймеров ---
// Кристаллы завершают таймер МГНОВЕННО (цена ∝ остатку). Реклама сокращает
// остаток на фикс. величину AD_SKIP_MS (бесплатно, можно смотреть повторно).
export const SPEEDUP_CRYSTAL_PER_MIN = 1;     // 💎 за каждую начатую минуту остатка
export const SPEEDUP_CRYSTAL_MIN = 1;         // но минимум 1 💎
export const AD_SKIP_MS = 5 * 60_000;         // −5 мин за просмотр рекламы (первый прикид, тюнится)

// --- Заказы (продажа котов клиентам) ---
export const ORDER_TTL_MS = 20 * 60_000;      // 20 мин жизни заказа (ротация); 0 — бессрочно
export const ORDER_TARGET = 4;                // сколько заказов держать в списке
export const ORDER_COIN_MULT = 1.0;           // заказ платит ≈ полную рыночную цену
export const ORDER_DNA_MULT = 0.03;           // 🧬-бонус за заказ (доля ценности)
export const ORDER_REP_MULT = 0.15;           // ⭐ опыт за заказ ∝ ценности (главный источник)

// --- Опыт (репутация) за важные действия ---
// Опыт (⭐) копится не только с заказов, но и с рождений/продаж/сдачи в лабораторию.
// Награда за рождение — по тиру котёнка (гринд дворовых даёт крохи), с ×множителем за
// ПЕРВОЕ открытие породы (коллекционирование — ядро игры). Всё — первый прикид, тюнится.
export const REP_BIRTH_BY_TIER: Record<RarityTier, number> = {
  common: 2, uncommon: 5, rare: 12, epic: 30, legendary: 70,
};
export const REP_NEW_BREED_MULT = 5;          // ×к опыту за рождение, если порода открыта впервые
export const REP_ADOPT_MULT = 0.05;           // ⭐ за пристройство «в добрые руки» = доля ценности
export const REP_LAB_MULT = 0.05;             // ⭐ за сдачу кота в лабораторию = доля ценности

// --- Уровень лаборатории: гейт прогрессии (10 уровней) ---
// Уровень растёт от накопленного опыта (репутации) по НАРАСТАЮЩИМ порогам (не линейно —
// поздние действия дают много опыта, иначе верхние уровни проскакивали бы пачкой).
// Уровень сам ничего не даёт, но СНИМАЕТ ЗАМКИ: право купить слот/пьедестал, доступ к
// станциям/исследованиям/инженерии/клинике. См. economy.isUnlocked / maxSlotsForLevel.
export const LEVEL_REP_THRESHOLDS: readonly number[] = [
  0, 100, 250, 450, 700, 1000, 1400, 1900, 2500, 3200,
]; // индекс i → минимальный опыт для уровня (i+1)
export const MAX_LEVEL = LEVEL_REP_THRESHOLDS.length; // 10

// Уровни, на которых открывается покупка n-го слота вязки (для 2-го и 3-го;
// базовый слот есть с ур. 1). Максимум слотов — 3 (UPGRADES.slots.max = 2).
export const SLOT_UNLOCK_LEVELS: readonly number[] = [3, 6];
// Уровни, на которых открывается покупка n-го пьедестала (для 2..5; базовый — с ур. 1).
export const PEDESTAL_UNLOCK_LEVELS: readonly number[] = [2, 4, 6, 9];

/** Прочие фичи, гейтящиеся уровнем лаборатории (кроме слотов/пьедесталов — те по массивам выше). */
export type LabFeature =
  | 'labStation'        // станция «в лабораторию» (сдача кота на эксперименты)
  | 'food'              // кормушка и голод (этап B)
  | 'research'          // дерево «Улучшений» (Генолаб; внутренний id research — легаси, не менять)
  | 'engineering'       // усилители вязки (Генная инженерия)
  | 'clinic'            // клиника-шприц лечения (этап D)
  | 'recipeLab';        // стол исследования рецептов (вкладка «Исследования»)
// Крио-банк НЕ гейтится уровнем: комната открывается покупкой узла Селекции
// «❄️ Криогенетика» (см. RESEARCH r_sel_cryo / economy.cryoUnlocked), а его поздние
// minLevel и так держат механику в эндгейме.
// Дерево исследований открывается целиком на LAB_UNLOCKS.research; дальнейший гейт —
// на уровне ОТДЕЛЬНЫХ уровней узлов (ResearchLevel.minLevel), а не блоком колонок.
export const LAB_UNLOCKS: Record<LabFeature, number> = {
  labStation: 2,
  food: 1,              // коты хотят есть сразу — кормушка/голод с 1-го уровня
  research: 2,          // дерево открывается рано, чтобы игрок его сразу видел
  engineering: 5,
  clinic: 5,
  recipeLab: 3,         // стол рецептов — чуть позже дерева, когда есть первые породы
};
export const ORDER_DEMAND_SPREAD = 0.5;       // случайный спрос ×(1.0 .. 1.5)
export const ORDER_CRYSTAL_MIN_VALUE = 1500;  // от какой ценности заказ даёт 💎

// --- Инкубатор / здоровье ---
// Здоровье кота = сердца: одно сердце — одна вязка. Базовый запас MAX_HEARTS;
// исчерпал (breedCount ≥ maxHearts) → статус «Старый», в вязку не ставится.
// Котёнок от инбридинга может родиться с урезанным maxHearts (см. KINSHIP_HEALTH).
export const MAX_HEARTS = 5;

// --- Клиника (шприц лечения, этап D) ---
// Лечит ПОТРАЧЕННЫЕ вязки (breedCount), НЕ maxHearts: генетический потолок от
// инбридинга неизлечим, «Бесплодных» (0 ❤) не лечит. Гейт — LAB_UNLOCKS.clinic.
export const HEAL_AD_HEARTS = 1;                  // 📺 реклама восстанавливает 1 ❤
export const HEAL_AD_COOLDOWN_MS = 10 * 60_000;   // глобальный кулдаун рекламы лечения
export const HEAL_CRYSTAL_PER_HEART = 2;          // 💎 полное лечение: цена за каждое потраченное ❤

// Глубина сохраняемой родословной кота: 3 = родители → деды → прадеды.
export const PEDIGREE_DEPTH = 3;

// --- Скрытые гены стартовых котов ---
// У купленных/стартовых дворовых родословная генерируется случайно (лотерея):
// вес тира каждого скрытого предка. Легендарные предки не выпадают никогда —
// T5 достижим только реальной селекцией.
export const HIDDEN_GENE_TIER_WEIGHTS: Record<RarityTier, number> = {
  common: 0.70, uncommon: 0.20, rare: 0.08, epic: 0.02, legendary: 0,
};

// --- Инбридинг ---
// Уровень родства пары по коэффициенту родства r (сумма 0.5^(genA+genB) по общим
// id в родословных; сам партнёр в дереве тоже считается):
//   родитель×ребёнок r=0.5, брат×сестра r=0.5 → critical;
//   дед×внучка r=0.25, дядя×племянница r=0.25 → high;
//   кузены r=0.125 и любое пересечение слабее → moderate.
export const KINSHIP_CRITICAL_R = 0.49;
export const KINSHIP_HIGH_R = 0.24;
export const KINSHIP_MODERATE_R = 0.01;

// Риск здоровья котёнка от инбридинга: интервалы одного броска (p в сумме ≤ 1),
// иначе котёнок рождается с полным запасом MAX_HEARTS.
//   critical: 10% → 0 сердец («Бесплодный», родословный тупик), 50% → 1 сердце;
//   high:     30% → 3 сердца;  moderate: 10% → 4 сердца.
export const KINSHIP_HEALTH: Record<KinshipLevel, ReadonlyArray<{ p: number; hearts: number }>> = {
  none: [],
  moderate: [{ p: 0.10, hearts: 4 }],
  high: [{ p: 0.30, hearts: 3 }],
  critical: [{ p: 0.10, hearts: 0 }, { p: 0.50, hearts: 1 }],
};

// ТЕСТ: время вязки 10 c для плейтестов. Вернуть после тестов: BASE = 5 * 60_000, MIN = 2 * 60_000.
export const INCUBATION_BASE_MS = 10_000;
export const INCUBATION_MIN_MS = 10_000;
export const MUTATION_BASE = 0.01;         // базовый шанс мутации окраса при рождении

// --- Вместимости комнат ---
// Базовые места; расширение — только деревом исследований (узлы r_nursery/r_shelter,
// шаг задан в их levels[].value: питомник +2/ур, приют +3/ур).
export const NURSERY_BASE_CAP = 6;
export const SHELTER_BASE_CAP = 8;

// --- Крио-банк (криохранилище коллекции) ---
// Заморозка кота убирает его из state.cats в state.cryo (не ест/не доход/не вязка) —
// витрина коллекции без 70 живых котов. Разморозки НЕТ (только клон или утилизация).
// Ёмкость капсул = CRYO_BASE_CAP + узел «❄️ Криогенетика» (cryoCap); к макс. рангу ~30.
export const CRYO_BASE_CAP = 6;               // стартовые капсулы (даёт 1-й ранг Криогенетики)
// Клонирование стоит ×5 от выхода лаборатории того же кота (5 × round(market × LAB_DNA_RATE)):
// привязка к ценности особи + анти-луп (клон впятеро дороже сдачи того же кота на опыты).
export const CLONE_LAB_MULT = 5;

// --- Доход ---
// Потолок офлайн-накопления: база + узел исследований «Ночной смотритель» (offline).
export const OFFLINE_CAP_BASE_MIN = 120;   // потолок накопления, мин

// --- Покупка котов (анти-софт-лок) ---
export const STARTER_CAT_COST = 50; // простой кот из питомника; первый (когда котов нет) — бесплатно

// --- Генолаб ---

// Генетический анализ кота (система знаний): вскрывает СРАЗУ всё дерево родословной
// и список скрытых генов (пород предков). Механику не меняет — только информация.
// Оплата 💰 (знание добывается игрой), альтернатива — 📺 реклама с глобальным кулдауном.
export const ANALYZE_COIN_COST = 100;
export const ANALYZE_AD_COOLDOWN_MS = 10 * 60_000;

// --- Исследование рецептов (вкладка «Исследования» Генолаба) ---
// Стол с одним слотом-таймером: за 💰 + 🧬 через RECIPE_RESEARCH_MS выдаёт СЛУЧАЙНЫЙ
// ещё не открытый рецепт из достижимого пула (обе родительские породы уже выведены).
// Дубликаты исключены пулом. Ускорение — 📺 (−AD_SKIP_MS) или 💎 (мгновенно).
// ТЕСТ: таймер 30 c для плейтестов. Вернуть после тестов: 60 * 60_000 (~1 час).
export const RECIPE_RESEARCH_MS = 30_000;
export const RECIPE_RESEARCH_COST_COINS = 300;
export const RECIPE_RESEARCH_COST_DNA = 25;

// --- Генная инженерия (усилители вязки) ---
// Кнопки усилителей живут у названия Инкубатора; активируются за 🧬 гены или 💎
// кристаллы. Заряд тратится при рождении из инкубатора (на первой подходящей вязке).
export type BoostId = keyof BreedBoosts;
export interface BoostDef {
  id: BoostId;
  glyph: string;
  label: string;
  desc: string;
  dna: number;      // цена активации за 🧬 гены
  crystals: number; // цена активации за 💎 кристаллы (премиум-альтернатива)
}
/** Усилители следующей вязки. Заряд тратится при рождении из инкубатора. */
export const BOOSTS: readonly BoostDef[] = [
  { id: 'noDown', glyph: '🛡', label: 'Стабилизатор', desc: 'Котёнок не ниже старшего родителя', dna: 15, crystals: 2 },
  { id: 'luckyUp', glyph: '🍀', label: 'Катализатор', desc: 'Шансы всех рецептов ×2 (не суммируется с инбридингом)', dna: 30, crystals: 3 },
  { id: 'tierUp', glyph: '🔼', label: 'Активатор', desc: 'Гарантия рецепта тира выше (если условия выполнены)', dna: 60, crystals: 5 },
];

// --- Рост котят ---
// ТЕСТ: котёнок взрослеет за 30 c, чтобы видеть взросление/эффект/таблички.
// Вернуть после тестов: 8 * 60_000 (~8 минут).
export const KITTEN_GROWTH_MS = 30_000;
export const KITTEN_MIN_SCALE = 0.45;       // размер новорождённого относительно взрослого
export const KITTEN_SLOW_FACTOR = 3;        // во сколько раз медленнее растёт котёнок, «оставленный с родителями»

// --- Дерево «Улучшений» (постоянные бонусы, многоуровневые узлы; бывш. «Исследования») ---
// Эффекты применяются в чистых функциях economy.ts (и в actions/genetics для
// селекции/корма). 4 ветки-ряда × цепочка узлов; узел прокачивается по уровням.
// ВАЛЮТА (принцип): ветка 🧪 Селекция — за 🧬 гены (всё про генетику/размножение);
// ветки 🎓 Обучение, 🤝 Пристройство, 🏠 Хозяйство (комнаты/доход/экономика) — за 💰.
// ГЕЙТ ПО УРОВНЯМ: у КАЖДОГО уровня узла свой `minLevel` (мин. уровень лаборатории).
// Расписание растянуто L2→L10: рано и часто открываются первые уровни, тяжёлые
// финальные уровни докупаются к концу игры (см. actions.unlockResearch, gate-хелперы).
// ВАЖНО: id узлов НЕ менять — по ним хранится прогресс в сейве (state.research: id→уровень).
export type ResearchEffectKind =
  | 'income'           // +доля к пассивному доходу (множитель)
  | 'collectionIncome' // +плоский доход за каждую открытую породу
  | 'adoptCoins'       // +доля к 💰 за пристройство
  | 'adoptDna'         // +доля к 🧬 за пристройство/лабораторию
  | 'nurseryCap'       // +мест в питомнике
  | 'shelterCap'       // +мест в приюте
  | 'offline'          // +минут к потолку офлайн-дохода
  | 'recipeChance'     // ×множитель шанса ВСЕХ рецептов размножения (доля, +value)
  | 'kinshipSafety'    // снижение риска инбридинга для котёнка (доля, потолок 0.5)
  | 'extraHeart'       // +N ❤ новорождённым (бесплодных 0 ❤ не спасает)
  | 'orderDna'         // +доля к 🧬 с выполненных заказов
  | 'feedEff'          // коты едят меньше корма (доля снижения расхода)
  | 'foodCap'          // +ёмкость кормушки (ед.)
  | 'autoFeed'         // автопокупка корма за 💰 при опустошении (флаг: value ≥ 1)
  | 'cryoCap';         // +капсулы крио-банка (1-й ранг ОТКРЫВАЕТ крио-банк как комнату)

/** Один уровень узла: цена (в валюте узла), прибавка эффекта, гейт по уровню лаборатории. */
export interface ResearchLevel {
  cost: number;      // цена ЭТОГО уровня (в валюте узла — dna/coins)
  value: number;     // прибавка эффекта на этом уровне (суммируется по купленным уровням)
  minLevel: number;  // мин. уровень лаборатории, чтобы купить именно этот уровень
}

export interface ResearchDef {
  id: string;
  glyph: string;
  title: string;
  desc: string;             // краткое описание эффекта «за уровень»
  currency: Currency;       // 'dna' (Селекция) | 'coins' (остальные ветки)
  effectKind: ResearchEffectKind;
  requires: readonly string[]; // узлы-предпосылки (нужен ≥1 уровень каждого)
  col: number;              // колонка в ветке (0 — корень цепочки)
  row: number;              // ветка: 0 — Селекция, 1 — Обучение, 2 — Пристройство, 3 — Хозяйство
  levels: readonly ResearchLevel[]; // уровни по возрастанию цены/гейта
}

export const RESEARCH: readonly ResearchDef[] = [
  // ветка 0 — 🧪 Селекция (за 🧬: шансы рецептов, инбридинг, здоровье)
  { id: 'r_sel_pairs', glyph: '💞', title: 'Подбор пар', desc: 'Шансы всех рецептов +5% за уровень',
    currency: 'dna', effectKind: 'recipeChance', requires: [], col: 0, row: 0, levels: [
      { cost: 40, value: 0.05, minLevel: 2 },
      { cost: 100, value: 0.05, minLevel: 4 },
      { cost: 220, value: 0.05, minLevel: 7 },
    ] },
  { id: 'r_sel_markers', glyph: '🧬', title: 'Генетические маркеры', desc: 'Риск инбридинга у котёнка ниже (потолок −50%)',
    currency: 'dna', effectKind: 'kinshipSafety', requires: ['r_sel_pairs'], col: 1, row: 0, levels: [
      { cost: 150, value: 0.20, minLevel: 5 },
      { cost: 320, value: 0.15, minLevel: 8 },
    ] },
  { id: 'r_sel_vitamins', glyph: '💊', title: 'Витамины роста', desc: 'Новорождённые котята +1 ❤',
    currency: 'dna', effectKind: 'extraHeart', requires: ['r_sel_markers'], col: 2, row: 0, levels: [
      { cost: 260, value: 1, minLevel: 6 },
    ] },
  // Поздний сток 🧬: 1-й ранг ОТКРЫВАЕТ крио-банк (комнату) + стартовые капсулы,
  // следующие ранги наращивают вместимость до ~30 (CRYO_BASE_CAP + Σvalue). minLevel
  // поздние (8→10), чтобы механика оставалась эндгеймом. Валюта — 🧬 (ветка Селекции).
  { id: 'r_sel_cryo', glyph: '❄️', title: 'Криогенетика', desc: 'Открывает крио-банк, +6 капсул за уровень',
    currency: 'dna', effectKind: 'cryoCap', requires: ['r_sel_vitamins'], col: 3, row: 0, levels: [
      { cost: 400, value: 6, minLevel: 8 },
      { cost: 650, value: 6, minLevel: 8 },
      { cost: 1000, value: 6, minLevel: 9 },
      { cost: 1500, value: 6, minLevel: 10 },
    ] },

  // ветка 1 — 🎓 Обучение (за 💰: доход пьедесталов, коллекция, офлайн)
  { id: 'r_show', glyph: '🎓', title: 'Дрессировка', desc: '+доход пьедесталов за уровень',
    currency: 'coins', effectKind: 'income', requires: [], col: 0, row: 1, levels: [
      { cost: 250, value: 0.20, minLevel: 2 },
      { cost: 700, value: 0.25, minLevel: 4 },
      { cost: 1800, value: 0.30, minLevel: 6 },
      { cost: 5000, value: 0.40, minLevel: 9 },
    ] },
  { id: 'r_collection', glyph: '📖', title: 'Коллекционер', desc: '+0.25 💰/мин за каждую открытую породу за уровень',
    currency: 'coins', effectKind: 'collectionIncome', requires: ['r_show'], col: 1, row: 1, levels: [
      { cost: 900, value: 0.25, minLevel: 5 },
      { cost: 2600, value: 0.25, minLevel: 7 },
      { cost: 7000, value: 0.25, minLevel: 10 },
    ] },
  { id: 'r_offline', glyph: '🌙', title: 'Ночной смотритель', desc: '+120 мин к потолку офлайна за уровень',
    currency: 'coins', effectKind: 'offline', requires: ['r_collection'], col: 2, row: 1, levels: [
      { cost: 500, value: 120, minLevel: 4 },
      { cost: 1500, value: 120, minLevel: 6 },
      { cost: 4500, value: 120, minLevel: 9 },
    ] },

  // ветка 2 — 🤝 Пристройство (за 💰: 💰/🧬 за отданных котов и заказы)
  { id: 'r_adopt_coins', glyph: '🤝', title: 'Добрые руки', desc: '+20% 💰 за пристройство за уровень',
    currency: 'coins', effectKind: 'adoptCoins', requires: [], col: 0, row: 2, levels: [
      { cost: 200, value: 0.20, minLevel: 2 },
      { cost: 700, value: 0.20, minLevel: 5 },
      { cost: 2400, value: 0.20, minLevel: 8 },
    ] },
  { id: 'r_adopt_dna', glyph: '🧫', title: 'Биобанк+', desc: '+15% 🧬 за пристройство/лабораторию за уровень',
    currency: 'coins', effectKind: 'adoptDna', requires: ['r_adopt_coins'], col: 1, row: 2, levels: [
      { cost: 350, value: 0.15, minLevel: 3 },
      { cost: 1100, value: 0.15, minLevel: 6 },
      { cost: 3600, value: 0.15, minLevel: 9 },
    ] },
  { id: 'r_order_dna', glyph: '🧑‍🔬', title: 'Клиенты-заводчики', desc: '+25% 🧬 с выполненных заказов за уровень',
    currency: 'coins', effectKind: 'orderDna', requires: ['r_adopt_dna'], col: 2, row: 2, levels: [
      { cost: 2000, value: 0.25, minLevel: 7 },
      { cost: 6500, value: 0.25, minLevel: 10 },
    ] },

  // ветка 3 — 🏠 Хозяйство (за 💰: вместимости, кормушка, корм, автокормушка)
  { id: 'r_nursery', glyph: '🏠', title: 'Пристройка', desc: '+2 места в питомнике за уровень',
    currency: 'coins', effectKind: 'nurseryCap', requires: [], col: 0, row: 3, levels: [
      { cost: 200, value: 2, minLevel: 2 },
      { cost: 450, value: 2, minLevel: 3 },
      { cost: 1000, value: 2, minLevel: 5 },
      { cost: 2400, value: 2, minLevel: 7 },
      { cost: 6000, value: 2, minLevel: 9 },
    ] },
  { id: 'r_shelter', glyph: '🏡', title: 'Приют+', desc: '+3 места в приюте за уровень',
    currency: 'coins', effectKind: 'shelterCap', requires: ['r_nursery'], col: 1, row: 3, levels: [
      { cost: 150, value: 3, minLevel: 2 },
      { cost: 380, value: 3, minLevel: 4 },
      { cost: 900, value: 3, minLevel: 6 },
      { cost: 2200, value: 3, minLevel: 8 },
      { cost: 5500, value: 3, minLevel: 10 },
    ] },
  { id: 'r_food', glyph: '🥫', title: 'Большая кормушка', desc: '+200 к ёмкости кормушки за уровень',
    currency: 'coins', effectKind: 'foodCap', requires: ['r_shelter'], col: 2, row: 3, levels: [
      { cost: 250, value: 200, minLevel: 3 },
      { cost: 800, value: 200, minLevel: 5 },
      { cost: 2500, value: 200, minLevel: 8 },
    ] },
  { id: 'r_feed', glyph: '🍽', title: 'Экономный рацион', desc: 'Коты едят на 15% меньше корма за уровень',
    currency: 'coins', effectKind: 'feedEff', requires: ['r_food'], col: 3, row: 3, levels: [
      { cost: 400, value: 0.15, minLevel: 4 },
      { cost: 1400, value: 0.15, minLevel: 7 },
    ] },
  { id: 'r_autofeed', glyph: '🤖', title: 'Автокормушка', desc: 'Сама докупает корм за 💰 при опустошении',
    currency: 'coins', effectKind: 'autoFeed', requires: ['r_feed'], col: 4, row: 3, levels: [
      { cost: 3000, value: 1, minLevel: 8 },
    ] },
];

export interface UpgradeDef {
  label: string;
  currency: Currency;
  baseCost: number;
  mult: number;   // стоимость уровня = round(baseCost * mult^level)
  max: number;    // максимальный уровень
}

/**
 * Дерево прокачки за валюту. Слоты вязки — особый случай (см. economy.upgradeCost).
 * Вместимости питомника/приюта теперь расширяются ТОЛЬКО деревом исследований
 * (узлы r_nursery/r_shelter, многоуровневые) — легаси-апгрейды за 💰 удалены, чтобы
 * прокачка вместимости жила в одном месте.
 * Легаси-записи (скорость/мутаген/помёт/выставка/связи/биобанк/селекция/фонд/офлайн/
 * слоты-питомника/слоты-приюта) удалены — они нигде не продавались.
 */
export const UPGRADES: Record<string, UpgradeDef> = {
  slots: { label: 'Слоты вязки', currency: 'coins', baseCost: 500, mult: 4, max: 2 },
  // 1 → 5 пьедесталов (base 1 + до 4 апгрейдов), покупки гейтит уровень (PEDESTAL_UNLOCK_LEVELS).
  // ВНИМАНИЕ (тюнинг): при mult 4 верхние уровни очень дороги (~160к 💰 за 5-й) — проверить на плейтесте.
  championSlots: { label: 'Слоты выставки', currency: 'coins', baseCost: 2500, mult: 4, max: 4 },
};

export interface GeneDef {
  label: string;
  dna: number;
}

/** Гены, открываемые в Генолабе за ДНК. */
export const GENES: Record<string, GeneDef> = {
  pointed: { label: 'Колор-пойнт', dna: 80 },
  dilute: { label: 'Разбавление (dilute)', dna: 50 },
  longhair: { label: 'Длинная шерсть', dna: 60 },
  fold: { label: 'Вислоухость (фолд)', dna: 150 },
  curl: { label: 'Кёрл', dna: 120 },
  white: { label: 'Доминантный белый', dna: 300 },
};

/** Фичи, открытые с самого старта (базовые цвета, табби, белые пятна). */
export const BASE_GENES = ['base-colors', 'tabby', 'spotting'];

/** Уровень лаборатории по накопленному опыту (нарастающие пороги LEVEL_REP_THRESHOLDS). */
export function levelForReputation(rep: number): number {
  let level = 1;
  for (let i = 1; i < LEVEL_REP_THRESHOLDS.length; i++) {
    if (rep >= LEVEL_REP_THRESHOLDS[i]!) level = i + 1;
    else break;
  }
  return level;
}

/** Опыт, нужный для следующего уровня (null — уже максимум). Для прогресс-бара в HUD. */
export function nextLevelRep(level: number): number | null {
  return level >= MAX_LEVEL ? null : LEVEL_REP_THRESHOLDS[level]!; // порог для уровня (level+1)
}

/**
 * Что открывается РОВНО на данном уровне — строки для баннера «Уровень N!».
 * Перечисляем только уже реализованные фичи (клон-банк добавится с бэклогом).
 */
export function unlocksAtLevel(level: number): string[] {
  const out: string[] = [];
  const slotIdx = SLOT_UNLOCK_LEVELS.indexOf(level);
  if (slotIdx >= 0) out.push(`💞 слот вязки №${slotIdx + 2}`);
  const pedIdx = PEDESTAL_UNLOCK_LEVELS.indexOf(level);
  if (pedIdx >= 0) out.push(`🏆 пьедестал №${pedIdx + 2}`);
  const featNames: Partial<Record<LabFeature, string>> = {
    labStation: '🧬 станция «в лабораторию»',
    food: '🍽 кормушка',
    research: '🔬 улучшения',
    engineering: '🧪 усилители вязки',
    clinic: '💉 клиника лечения',
    recipeLab: '🧪 исследование рецептов',
  };
  for (const key of Object.keys(featNames) as LabFeature[]) {
    if (LAB_UNLOCKS[key] === level) out.push(featNames[key]!);
  }
  return out;
}
