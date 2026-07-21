/**
 * Конфиг баланса (Этап 4). Все числа — первый проход, тюнятся на плейтестах.
 * Менять баланс здесь, не в логике. См. GAME.md §5–6.
 */

import type { RarityTier, BreedBoosts, KinshipLevel } from '../genetics/index.js';
import type { Currency } from './types.js';

// v9: заказы — у каждого свой таймер жизни (Order.refillAt → expiresAt, добавлено
// state.orderAdRefreshAt); слот всегда держит активный заказ, не выполнил за 6 ч → сам
// сменится. v8: per-slot кулдаун. v7: суточная доска. v6: многоуровневое дерево
// исследований (state.research: id→уровень). Старые сейвы сбрасываются загрузчиком по этой версии.
export const SAVE_VERSION = 9;

// --- Рыночная ценность кота (продажа/заказы/выставка/лаборатория) ---
// Единая шкала «сколько стоит кот»: тир — главный фактор порядка величины,
// порода внутри тира (breedValueMult), родословная и здоровье уточняют цену.
// См. economy.catMarketValue.
export const TIER_MARKET_VALUE: Record<RarityTier, number> = {
  common: 50, uncommon: 150, rare: 450, epic: 1200, legendary: 3500,
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
// Доход урезан вдвое (0.25→0.125), чтобы массовая раздача перестала быть главным
// краном 💰 и ⭐ (см. REP_ADOPT_MULT) — цель растянуть прогресс на 1-2 месяца.
// 🧬 теперь = доля от TIER_MARKET_VALUE[тир] (а не отдельная плоская таблица) — авто-следует
// за шкалой ценности: 50/150/450/1200/3500 × 0.006 → ≈ 1/1/3/7/21 🧬 по тирам.
export const ADOPT_COIN_FRACTION = 0.125;
// 🧬 теперь считается от полного catMarketValue (как 💰 и ⭐ рядом) — единообразно с
// остальными наградами пристройства/лаборатории, а не от «плоской по тиру» базы.
// Ставка снижена вдвое (0.006 → 0.005 порода в среднем ×1.2), чтобы средняя награда
// осталась той же, но теперь порода/родословная/здоровье конкретного кота её уточняют.
export const ADOPT_DNA_RATE = 0.005;          // 🧬 = round(catMarketValue × rate)

// --- Лаборатория (кот → 🧬 гены) ---
// Кот уезжает «на эксперименты»: главный способ добыть гены из лишних котов.
// Доход 🧬 урезан на 60% (0.08 → 0.032), чтобы гены не копились слишком быстро
// (растягиваем прогресс). ВНИМАНИЕ: cloneCost завязан на этот же коэффициент
// (клон = 3 × round(market × LAB_DNA_RATE)) — клон подешевел на те же 60%.
export const LAB_DNA_RATE = 0.032;            // 🧬 = round(catMarketValue × rate)
export const LAB_COIN_RATE = 0.05;            // немного 💰 сверху

// --- Корм (контейнер + мягкий голод, этап B) ---
// У кормушки есть запас `state.food`, который расходуется, пока живы коты: едят ВСЕ
// коллекции (питомник, приют, слоты вязки, пьедесталы выставки) — кроме замороженных
// в крио-банке (они физически не в state.cats). Кончился корм → пассивный доход стоит
// и новые вязки не стартуют (коты «грустят»), но сердца НЕ сгорают и казна в минус не
// уходит (мягкий голод). Механика открывается уровнем лаборатории (LAB_UNLOCKS.food).
export const FOOD_CAP_BASE = 200;             // ёмкость кормушки (ед.); расширение — узлом исследований (этап C)
// Аппетит по тиру: чем породистее кот, тем дороже его содержать (0.1 → 0.5 ед./мин).
// Это делает «свалку» дворовых дешёвой, а коллекцию легендарных — статьёй расходов.
export const FOOD_PER_MIN_BY_TIER: Record<RarityTier, number> = {
  common: 0.05, uncommon: 0.1, rare: 0.15, epic: 0.2, legendary: 0.25,
};
export const FOOD_PACK_UNITS = 50;            // размер пакета корма (кнопка «＋50»)
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
export const AD_SKIP_MS = 5 * 60_000;         // −5 мин за просмотр рекламы (вязка/стол рецептов)

// --- Заказы (продажа котов клиентам) ---
// Доска = ORDER_TARGET независимых слотов, каждый ВСЕГДА держит активный заказ. У
// каждого заказа свой таймер жизни ORDER_REFRESH_MS: не выполнил за это время — заказ
// сам сменяется новым (refreshExpiredOrders). Выполнил — слот сразу получает свежий
// заказ. Плюс раз в ORDER_AD_REFRESH_COOLDOWN_MS игрок может обновить ОДИН заказ за 📺.
export const ORDER_TARGET = 4;                         // сколько слотов на доске заказов
export const ORDER_REFRESH_MS = 6 * 60 * 60_000;       // 6 ч жизни заказа: не выполнил → сменится новым
export const ORDER_AD_REFRESH_COOLDOWN_MS = 60 * 60_000; // 📺 раз в час можно обновить один заказ
export const ORDER_COIN_MULT = 1.0;           // заказ платит ≈ полную рыночную цену
export const ORDER_DNA_MULT = 0.06;           // 🧬-бонус за заказ (доля ценности)
export const ORDER_REP_MULT = 0.15;           // ⭐ опыт за заказ ∝ ценности (главный источник)

// --- Опыт (репутация) за важные действия ---
// Опыт (⭐) копится не только с заказов, но и с рождений/продаж/сдачи в лабораторию.
// Награда за рождение — по тиру котёнка (гринд дворовых даёт крохи), с ×множителем за
// ПЕРВОЕ открытие породы (коллекционирование — ядро игры). Всё — первый прикид, тюнится.
// Теперь ⭐ за рождение = доля от TIER_MARKET_VALUE[тир] (а не плоская таблица) — авто-следует
// за шкалой ценности: 50/150/450/1200/3500 × 0.018 → ≈ 1/3/8/22/63 ⭐ по тирам.
export const REP_BIRTH_RATE = 0.027;          // ⭐ за рождение = round(TIER_MARKET_VALUE[тир] × rate)
export const REP_NEW_BREED_MULT = 5;          // ×к опыту за рождение, если порода открыта впервые
export const REP_ADOPT_MULT = 0.025;          // ⭐ за пристройство = доля ценности (урезан вдвое 0.05→0.025)
export const REP_LAB_MULT = 0.05;             // ⭐ за сдачу кота в лабораторию = доля ценности

// --- Уровень лаборатории: гейт прогрессии (10 уровней) ---
// Уровень растёт от накопленного опыта (репутации) по НАРАСТАЮЩИМ порогам (не линейно —
// поздние действия дают много опыта, иначе верхние уровни проскакивали бы пачкой).
// Уровень сам ничего не даёт, но СНИМАЕТ ЗАМКИ: право купить слот/пьедестал, доступ к
// станциям/исследованиям/инженерии/клинике. См. economy.isUnlocked / maxSlotsForLevel.
// Растянуто ×4 относительно версии «на 1-2 недели»: целевой темп — 1 час/день онлайн,
// полное прохождение за 1-2 месяца (L10 ≈ 20000 опыта, было 5000). См. [[catlab-target-session]].
export const LEVEL_REP_THRESHOLDS: readonly number[] = [
  0, 480, 1200, 2200, 3600, 5600, 8200, 11600, 15600, 20000,
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
  labStation: 2,        // теперь гейт — ПОКУПКА узла (FEATURE_RESEARCH); здесь лишь мин. уровень покупки
  food: 1,              // коты хотят есть сразу — кормушка/голод с 1-го уровня
  research: 1,          // дерево «Улучшений» открыто с 1-го уровня лаборатории (всегда доступно)
  recipeLab: 2,         // стол «Исследований» — тоже со 2-го уровня (открываются вместе с деревом)
  clinic: 3,            // ветеринар: тоже ПОКУПКА узла (FEATURE_RESEARCH); здесь лишь мин. уровень покупки
  engineering: 4,       // усилители вязки (Генная инженерия) — с 4-го уровня
};

// Фичи, которые открываются ПОКУПКОЙ узла ветки «🔬 Лаборатория» (Генолаб → Улучшения),
// а НЕ уровнем лаборатории (по образцу крио-банка → r_sel_cryo). economy.isUnlocked для
// них проверяет владение узлом; LAB_UNLOCKS[feature] задаёт минимальный уровень покупки.
export const FEATURE_RESEARCH: Partial<Record<LabFeature, string>> = {
  labStation: 'r_lab_station',
  clinic: 'r_lab_vet',
};
export const ORDER_DEMAND_SPREAD = 0.5;       // случайный спрос ×(1.0 .. 1.5)
export const ORDER_CRYSTAL_MIN_VALUE = 500;   // от какой ценности заказ даёт 💎
export const ORDER_SELL_SLOT_CHANCE = 0.5;    // доля слотов «сбыт из выведенных пород» (остальное — «цель»)

// --- Инкубатор / здоровье ---
// Здоровье кота = сердца: одно сердце — одна вязка. Базовый запас MAX_HEARTS;
// исчерпал (breedCount ≥ maxHearts) → статус «Старый», в вязку не ставится.
// Котёнок от инбридинга может родиться с урезанным maxHearts (см. KINSHIP_HEALTH).
export const MAX_HEARTS = 5;

// --- Клиника (шприц лечения, этап D) ---
// Лечит ПОТРАЧЕННЫЕ вязки (breedCount), НЕ maxHearts: генетический потолок от
// инбридинга неизлечим, «Бесплодных» (0 ❤) не лечит. Гейт — LAB_UNLOCKS.clinic.
export const HEAL_AD_HEARTS = 1;                  // 📺 реклама восстанавливает 1 ❤ (без кулдауна)
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
// Пороги уровня родства по коэффициенту r (см. game/kinship.ts):
//   critical ≥ 0.49 — родитель×ребёнок, полные брат×сестра;
//   high     ≥ 0.24 — дед×внук, дядя×племянник, полу-братья;
//   moderate ≥ 0.06 — двоюродные (0.125) и полу-двоюродные (0.0625).
// Порог moderate = 0.06 (не 0.01) намеренно отсекает троюродных и одиночных
// общих прадедов (r ≤ 0.031) — такое дальнее родство в счёт не идёт.
export const KINSHIP_CRITICAL_R = 0.49;
export const KINSHIP_HIGH_R = 0.24;
export const KINSHIP_MODERATE_R = 0.06;

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

// Продакшн-тайминг: вязка 5 мин (MIN — нижний предел под будущие ускорители, сейчас
// incubationDuration его не трогает, так что действует BASE).
export const INCUBATION_BASE_MS = 5 * 60_000;
export const INCUBATION_MIN_MS = 2 * 60_000;
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
// Клонирование стоит ×3 от выхода лаборатории того же кота (3 × round(market × LAB_DNA_RATE)):
// привязка к ценности особи + анти-луп (клон втрое дороже сдачи того же кота на опыты).
export const CLONE_LAB_MULT = 3;
// Заморозка через drag-станцию «Криокапсула» (по образцу клиники): три пути оплаты —
// 📺 реклама (бесплатно, глобальный кулдаун), 💰 монеты или 💎 кристаллы (мгновенно).
export const FREEZE_COIN_COST = 150;
export const FREEZE_CRYSTAL_COST = 3;
export const FREEZE_AD_COOLDOWN_MS = 10 * 60_000;

// --- Доход ---
// Потолок офлайн-накопления: база + узел исследований «Ночной смотритель» (offline).
export const OFFLINE_CAP_BASE_MIN = 120;   // потолок накопления, мин

// --- Покупка котов (анти-софт-лок) ---
export const STARTER_CAT_COST = 50; // простой кот из питомника; первый (когда котов нет) — бесплатно

// --- Генолаб ---

// Генетический анализ кота (система знаний): вскрывает СРАЗУ всё дерево родословной
// и список скрытых генов (пород предков). Механику не меняет — только информация.
// Цена в 💰 зависит от тира кота (породистого анализировать дороже); альтернатива —
// 📺 реклама (теперь БЕЗ кулдауна: анализ инфо-действие, не экономический кран).
export const ANALYZE_COIN_COST_BY_TIER: Record<RarityTier, number> = {
  common: 75, uncommon: 125, rare: 175, epic: 225, legendary: 300,
};
/** Цена Генетического анализа кота данного тира в 💰. */
export function analyzeCoinCost(tier: RarityTier): number {
  return ANALYZE_COIN_COST_BY_TIER[tier];
}

// --- Исследование рецептов (вкладка «Исследования» Генолаба) ---
// Стол с одним слотом-таймером: за 💰 + 🧬 выдаёт СЛУЧАЙНЫЙ ещё не открытый рецепт из
// достижимого пула (обе родительские породы уже выведены). Дубликаты исключены пулом.
// Ускорение — 📺 (−AD_SKIP_MS) или 💎 (мгновенно).
// ЦЕНА И ВРЕМЯ РАСТУТ ЛИНЕЙНО С УРОВНЕМ ЛАБОРАТОРИИ L (1..10): чем выше игрок, тем дороже
// и дольше новое знание (компенсирует растущий доход). На уровне L:
//   цена = 150×L 💰 + 5×L 🧬,   время = 5×L минут
// (L1 → 150💰+5🧬 / 5 мин … L10 → 1500💰+50🧬 / 50 мин).
export const RECIPE_RESEARCH_COINS_PER_LEVEL = 150;
export const RECIPE_RESEARCH_DNA_PER_LEVEL = 5;
export const RECIPE_RESEARCH_MS_PER_LEVEL = 5 * 60_000;

/** Стоимость запуска стола рецептов на данном уровне лаборатории (💰 + 🧬). */
export function recipeResearchCost(level: number): { coins: number; dna: number } {
  const L = Math.max(1, level);
  return { coins: RECIPE_RESEARCH_COINS_PER_LEVEL * L, dna: RECIPE_RESEARCH_DNA_PER_LEVEL * L };
}
/** Длительность исследования рецепта на данном уровне лаборатории (мс). */
export function recipeResearchMs(level: number): number {
  return RECIPE_RESEARCH_MS_PER_LEVEL * Math.max(1, level);
}

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
// Продакшн-тайминг: котёнок взрослеет за 15 мин. Реклама сокращает остаток роста на
// KITTEN_GROWTH_AD_MS (= полная длительность → одним показом малыш становится взрослым).
export const KITTEN_GROWTH_MS = 15 * 60_000;
export const KITTEN_GROWTH_AD_MS = 15 * 60_000; // 📺 −15 мин к росту котёнка (мгновенно взрослый)
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
  | 'adoptDna'         // +доля к 🧬 ТОЛЬКО за сдачу на эксперименты (лабораторию)
  | 'nurseryCap'       // +мест в питомнике
  | 'shelterCap'       // +мест в приюте
  | 'offline'          // +минут к потолку офлайн-дохода
  | 'recipeChance'     // ×множитель шанса ВСЕХ рецептов размножения (доля, +value)
  | 'kinshipSafety'    // снижение риска инбридинга для котёнка (доля, потолок 0.5)
  | 'extraHeart'       // +N ❤ новорождённым (бесплодных 0 ❤ не спасает)
  | 'orderReward'      // +доля к НАГРАДЕ заказа: 💰 монеты, 🧬 гены и ⭐ опыт (💎 не трогает)
  | 'feedEff'          // коты едят меньше корма (доля снижения расхода)
  | 'foodCap'          // +ёмкость кормушки (ед.)
  | 'autoFeed'         // автопокупка корма за 💰 при опустошении (флаг: value ≥ 1)
  | 'cryoCap'          // +капсулы крио-банка (1-й ранг ОТКРЫВАЕТ крио-банк как комнату)
  | 'unlockLab';       // узел-разблокировка функции комнаты (значение не суммируется; см. FEATURE_RESEARCH)

/** Один уровень узла: цена (в валюте узла), прибавка эффекта, гейт по уровню лаборатории. */
export interface ResearchLevel {
  cost: number;      // цена ЭТОГО уровня в ОСНОВНОЙ валюте узла (dna/coins)
  coins?: number;    // ДОП. цена в 💰 сверх основной (для ветки Селекции на 🧬 — стоит и денег)
  value: number;     // прибавка эффекта на этом уровне (суммируется по купленным уровням)
  minLevel: number;  // мин. уровень лаборатории, чтобы купить именно этот уровень
  desc?: string;     // описание ИМЕННО этого уровня (с накопленным итогом); если задано —
                     // карточка/подтверждение показывают его вместо общего ResearchDef.desc
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
  // ветка 0 — 🧪 Селекция (за 🧬 + 💰: шансы рецептов, инбридинг, здоровье, крио).
  // Порядок цепочки: Маркеры → Подбор пар → Криогенетика → Витамины роста. Каждый
  // уровень стоит основной валютой 🧬 И доп. монетами 💰 (поле coins) — Селекция
  // теперь тянет обе валюты, а не только гены.
  { id: 'r_sel_markers', glyph: '🧬', title: 'Генетические маркеры', desc: 'Риск инбридинга у котёнка ниже',
    currency: 'dna', effectKind: 'kinshipSafety', requires: [], col: 0, row: 0, levels: [
      { cost: 60, coins: 500, value: 0.25, minLevel: 2, desc: 'Риск инбридинга котёнка меньше на 25%' },
      { cost: 300, coins: 3000, value: 0.25, minLevel: 5, desc: 'Риск инбридинга котёнка меньше на 50%' },
    ] },
  { id: 'r_sel_pairs', glyph: '💞', title: 'Подбор пар', desc: 'Шансы всех рецептов +5% за уровень',
    currency: 'dna', effectKind: 'recipeChance', requires: ['r_sel_markers'], col: 1, row: 0, levels: [
      { cost: 200, coins: 2500, value: 0.05, minLevel: 4 },
      { cost: 400, coins: 5000, value: 0.05, minLevel: 6 },
      { cost: 600, coins: 10000, value: 0.05, minLevel: 8 },
    ] },
  // Витамины роста — финальный узел ветки (Криогенетика переехала в ветку «🔬 Лаборатория»).
  { id: 'r_sel_vitamins', glyph: '💊', title: 'Витамины роста', desc: 'Новорождённые котята +1 ❤',
    currency: 'dna', effectKind: 'extraHeart', requires: ['r_sel_pairs'], col: 2, row: 0, levels: [
      { cost: 1000, coins: 12500, value: 1, minLevel: 8 },
    ] },

  // ветка 1 — 🎓 Обучение (за 💰: доход пьедесталов, коллекция, офлайн)
  { id: 'r_show', glyph: '🎓', title: 'Дрессировка', desc: 'Доход котов на пьедесталах выше',
    currency: 'coins', effectKind: 'income', requires: [], col: 0, row: 1, levels: [
      { cost: 500, value: 0.20, minLevel: 2, desc: 'Доход котов на пьедесталах +20% (всего +20%)' },
      { cost: 1000, value: 0.20, minLevel: 4, desc: 'Доход котов на пьедесталах +20% (всего +40%)' },
      { cost: 2000, value: 0.20, minLevel: 6, desc: 'Доход котов на пьедесталах +20% (всего +60%)' },
      { cost: 4000, value: 0.20, minLevel: 8, desc: 'Доход котов на пьедесталах +20% (всего +80%)' },
      { cost: 8000, value: 0.20, minLevel: 10, desc: 'Доход котов на пьедесталах +20% (всего +100%)' },
    ] },
  { id: 'r_collection', glyph: '📖', title: 'Коллекционер', desc: '+0.25 💰/мин за каждую ВЫВЕДЕННУЮ породу за уровень',
    currency: 'coins', effectKind: 'collectionIncome', requires: ['r_show'], col: 1, row: 1, levels: [
      { cost: 900, value: 0.25, minLevel: 5 },
      { cost: 2600, value: 0.25, minLevel: 7 },
      { cost: 7000, value: 0.25, minLevel: 10 },
    ] },
  { id: 'r_offline', glyph: '🌙', title: 'Ночной смотритель', desc: '+60 мин к потолку офлайн-дохода за уровень',
    currency: 'coins', effectKind: 'offline', requires: ['r_collection'], col: 2, row: 1, levels: [
      // база потолка = OFFLINE_CAP_BASE_MIN (120 мин); «всего N» = 120 + накопленное
      { cost: 1000, value: 60, minLevel: 4, desc: '+60 мин к потолку времени оффлайн дохода (всего 180 минут)' },
      { cost: 2500, value: 60, minLevel: 6, desc: '+60 мин к потолку времени оффлайн дохода (всего 240 минут)' },
      { cost: 5000, value: 60, minLevel: 8, desc: '+60 мин к потолку времени оффлайн дохода (всего 300 минут)' },
      { cost: 10000, value: 60, minLevel: 10, desc: '+60 мин к потолку времени оффлайн дохода (всего 360 минут)' },
    ] },

  // ветка 2 — 🤝 Пристройство (за 💰: 💰/🧬 за отданных котов и заказы)
  { id: 'r_adopt_coins', glyph: '🤝', title: 'Добрые руки', desc: '+20% 💰 за пристройство за уровень',
    currency: 'coins', effectKind: 'adoptCoins', requires: [], col: 0, row: 2, levels: [
      { cost: 200, value: 0.20, minLevel: 2 },
      { cost: 700, value: 0.20, minLevel: 5 },
      { cost: 2400, value: 0.20, minLevel: 8 },
    ] },
  { id: 'r_adopt_dna', glyph: '🧫', title: 'Биобанк+', desc: '+15% 🧬 за сдачу на эксперименты за уровень',
    currency: 'coins', effectKind: 'adoptDna', requires: ['r_adopt_coins'], col: 1, row: 2, levels: [
      { cost: 1000, value: 0.15, minLevel: 3 },
      { cost: 2500, value: 0.15, minLevel: 6 },
      { cost: 5000, value: 0.15, minLevel: 9 },
    ] },
  { id: 'r_order_dna', glyph: '🧑‍🔬', title: 'Клиенты-заводчики', desc: '+15% награда за заказы (💰 монеты, 🧬 гены, ⭐ опыт) за уровень',
    currency: 'dna', effectKind: 'orderReward', requires: ['r_adopt_dna'], col: 2, row: 2, levels: [
      { cost: 200, coins: 2500, value: 0.15, minLevel: 4 },
      { cost: 400, coins: 5000, value: 0.15, minLevel: 6 },
    ] },

  // ветка 3 — 🏠 Хозяйство (за 💰: вместимости, кормушка, корм, автокормушка)
  { id: 'r_nursery', glyph: '🏠', title: 'Пристройка', desc: '+2 места в питомнике за уровень',
    currency: 'coins', effectKind: 'nurseryCap', requires: [], col: 0, row: 3, levels: [
      { cost: 500, value: 2, minLevel: 2 },
      { cost: 1000, value: 2, minLevel: 3 },
      { cost: 2500, value: 2, minLevel: 5 },
      { cost: 5000, value: 2, minLevel: 7 },
      { cost: 10000, value: 2, minLevel: 9 },
    ] },
  { id: 'r_shelter', glyph: '🏡', title: 'Приют+', desc: '+3 места в приюте за уровень',
    currency: 'coins', effectKind: 'shelterCap', requires: ['r_nursery'], col: 1, row: 3, levels: [
      { cost: 500, value: 3, minLevel: 2 },
      { cost: 1500, value: 3, minLevel: 4 },
      { cost: 3500, value: 3, minLevel: 6 },
      { cost: 7500, value: 3, minLevel: 8 },
      { cost: 12500, value: 3, minLevel: 10 },
    ] },
  { id: 'r_food', glyph: '🥫', title: 'Большая кормушка', desc: '+200 к ёмкости кормушки за уровень',
    currency: 'coins', effectKind: 'foodCap', requires: ['r_shelter'], col: 2, row: 3, levels: [
      { cost: 1000, value: 200, minLevel: 3 },
      { cost: 3000, value: 200, minLevel: 5 },
      { cost: 8000, value: 200, minLevel: 8 },
    ] },
  { id: 'r_feed', glyph: '🍽', title: 'Экономный рацион', desc: 'Коты едят на 15% меньше корма за уровень',
    currency: 'coins', effectKind: 'feedEff', requires: ['r_food'], col: 3, row: 3, levels: [
      { cost: 4000, value: 0.15, minLevel: 4 },
      { cost: 8000, value: 0.15, minLevel: 7 },
    ] },
  { id: 'r_autofeed', glyph: '🤖', title: 'Автокормушка', desc: 'Сама докупает корм за 💰 при опустошении',
    currency: 'coins', effectKind: 'autoFeed', requires: ['r_feed'], col: 4, row: 3, levels: [
      { cost: 15000, value: 1, minLevel: 8 },
    ] },

  // ветка 4 — 🔬 Лаборатория (оборудование лабы). Узлы ОТКРЫВАЮТ функции комнат самим
  // фактом покупки, а не уровнем: станцию «на эксперименты» в Приюте и клинику-ветеринара
  // в Питомнике (см. FEATURE_RESEARCH), а также крио-банк (r_sel_cryo — 1-й ранг открывает
  // комнату). За 💰, кроме крио (🧬 + 💰). minLevel узлов = прежние LAB_UNLOCKS этих фич.
  { id: 'r_lab_station', glyph: '🧪', title: 'На эксперименты', desc: 'Открывает в Приюте станцию сдачи котов на опыты (🧬)',
    currency: 'coins', effectKind: 'unlockLab', requires: [], col: 0, row: 4, levels: [
      { cost: 300, value: 1, minLevel: 2 },
    ] },
  { id: 'r_lab_vet', glyph: '💉', title: 'Ветеринар', desc: 'Открывает в Питомнике клинику лечения потраченных вязок',
    currency: 'coins', effectKind: 'unlockLab', requires: ['r_lab_station'], col: 1, row: 4, levels: [
      { cost: 500, value: 1, minLevel: 3 },
    ] },
  // Крио переехала сюда из «Селекции»: 1-й ранг ОТКРЫВАЕТ крио-банк (комнату) + стартовые
  // капсулы, следующие ранги наращивают вместимость до 24 (CRYO_BASE_CAP 6 + 3×6).
  // id узла НЕ меняем — по нему хранится прогресс в сейве и завязан cryoUnlocked.
  { id: 'r_sel_cryo', glyph: '❄️', title: 'Криогенетика', desc: 'Открывает крио-банк, +6 капсул за уровень',
    currency: 'dna', effectKind: 'cryoCap', requires: ['r_lab_vet'], col: 2, row: 4, levels: [
      { cost: 300, coins: 5000, value: 6, minLevel: 6 },
      { cost: 550, coins: 7500, value: 6, minLevel: 7 },
      { cost: 900, coins: 10000, value: 6, minLevel: 8 },
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
  // Цена НЕ по mult, а явным прайсом PEDESTAL_COSTS (см. economy.upgradeCost). baseCost/mult
  // тут лишь заглушки формата; max=4 задаёт число докупаемых пьедесталов.
  championSlots: { label: 'Слоты выставки', currency: 'coins', baseCost: 500, mult: 1, max: 4 },
};

// Явный прайс пьедесталов выставки: 1-й бесплатный (базовый), далее покупки 2..5
// стоят фиксированно (не по mult-кривой). Индекс = число уже купленных апгрейдов.
export const PEDESTAL_COSTS: readonly number[] = [500, 2000, 8000, 24000];

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
  // Станция «на эксперименты» и ветеринар открываются ПОКУПКОЙ узла «Лаборатории»
  // (FEATURE_RESEARCH), а не уровнем — в баннере уровня их не анонсируем.
  const featNames: Partial<Record<LabFeature, string>> = {
    food: '🍽 кормушка',
    research: '🔬 улучшения',
    engineering: '🧪 усилители вязки',
    recipeLab: '🧪 исследование рецептов',
  };
  for (const key of Object.keys(featNames) as LabFeature[]) {
    if (LAB_UNLOCKS[key] === level) out.push(featNames[key]!);
  }
  return out;
}
