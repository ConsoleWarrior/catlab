/**
 * Признаки котов — два независимых слоя (см. дизайн-заметку «Система признаков» rev.3).
 *
 *  1. НАСЛЕДУЕМЫЕ ГЕНЫ (строение) — TraitId, 14 штук. Фиксированы за породой,
 *     одинаковы у кота и кошки. Несутся через родословную (визитка породы ∪ визитки
 *     пород-предков), дремлют у предков и вскрываются Генетическим анализом.
 *     ТОЛЬКО их читают рецепты (recipes.ts, traitAny/traitBoth) и показывает анализ.
 *
 *  2. ОБЛИК (окрас · рисунок · глаза) — Look, косметика. Ровно по одному значению
 *     в каждой категории и ЗАДАЁТСЯ ПО ПОЛУ (2 спрайта на породу = кот и кошка).
 *     В рецептах НЕ участвует; нужен для Котодекса/меню кота. У дворового (moggie)
 *     визитки нет — облик случаен, потому он и хранит лотерею скрытых генов.
 */

import { tx, type LocStr } from '../i18n.js';

// ============================================================================
//  Слой 1 — наследуемые гены строения (гейты рецептов)
// ============================================================================

export type TraitId =
  // длина шерсти (взаимоисключающие)
  | 'shorthair' | 'longhair' | 'hairless'
  // текстура
  | 'curly' | 'wirehair'
  // уши
  | 'folded_ears' | 'curled_ears'
  // строение (могут стакаться в кроссбридах)
  | 'flat_face' | 'short_tail' | 'short_legs' | 'big'
  // сигнатурный рисунок (наследуемый, определяет породу)
  | 'colorpoint' | 'ticked' | 'spotted';

export type TraitGroup = 'length' | 'texture' | 'ears' | 'body' | 'signature';

export interface TraitDef {
  id: TraitId;
  /** Подпись, пара [ru, en] — разворачивать через `tx()` (см. traitTag). */
  label: LocStr;
  emoji: string;
  group: TraitGroup;
}

/** Метаданные всех 14 наследуемых генов (порядок = порядок вывода в UI). */
export const TRAITS: readonly TraitDef[] = [
  // --- длина ---
  { id: 'shorthair', label: ['короткая шерсть', 'shorthair'], emoji: '🐈', group: 'length' },
  { id: 'longhair', label: ['длинная шерсть', 'longhair'], emoji: '🦁', group: 'length' },
  { id: 'hairless', label: ['лысый', 'hairless'], emoji: '🥚', group: 'length' },
  // --- текстура ---
  { id: 'curly', label: ['кудрявая шерсть', 'curly coat'], emoji: '🌀', group: 'texture' },
  { id: 'wirehair', label: ['жёсткая шерсть', 'wirehair'], emoji: '🧽', group: 'texture' },
  // --- уши ---
  { id: 'folded_ears', label: ['вислоухость', 'folded ears'], emoji: '📐', group: 'ears' },
  { id: 'curled_ears', label: ['уши-кёрл', 'curled ears'], emoji: '🌙', group: 'ears' },
  // --- строение ---
  { id: 'flat_face', label: ['плоская морда', 'flat face'], emoji: '😽', group: 'body' },
  { id: 'short_tail', label: ['короткий хвост', 'short tail'], emoji: '🐇', group: 'body' },
  { id: 'short_legs', label: ['короткие лапы', 'short legs'], emoji: '🦵', group: 'body' },
  { id: 'big', label: ['крупный', 'large'], emoji: '🐘', group: 'body' },
  // --- сигнатурный рисунок ---
  { id: 'colorpoint', label: ['колор-пойнт', 'colorpoint'], emoji: '🎭', group: 'signature' },
  { id: 'ticked', label: ['тикинг', 'ticked'], emoji: '🌾', group: 'signature' },
  { id: 'spotted', label: ['пятнистость', 'spotted'], emoji: '🐆', group: 'signature' },
];

export const TRAIT_BY_ID: Record<TraitId, TraitDef> = Object.fromEntries(
  TRAITS.map((t) => [t.id, t]),
) as Record<TraitId, TraitDef>;

/** Порядковый индекс гена (для стабильной сортировки списков). */
const TRAIT_ORDER: Record<TraitId, number> = Object.fromEntries(
  TRAITS.map((t, i) => [t.id, i]),
) as Record<TraitId, number>;

/**
 * Наследуемые гены строения каждой породы (одинаковы для обоих полов). Пустой
 * список у «Дворового» (moggie) — его облик случаен. Ключи совпадают с catalog.ts;
 * полнота проверяется тестом. Ни один окрас/глаза сюда не входит — это слой 2.
 */
export const BREED_GENES: Record<string, readonly TraitId[]> = {
  // --- Tier 1 ---
  moggie: [],
  domestic_shorthair: ['shorthair'],
  domestic_longhair: ['longhair'],
  // --- Tier 2 ---
  british_shorthair: ['shorthair', 'flat_face'],
  scottish_fold: ['folded_ears', 'shorthair', 'flat_face'],
  persian: ['longhair', 'flat_face'],
  siamese: ['shorthair', 'colorpoint'],
  thai: ['shorthair', 'colorpoint'],
  russian_blue: ['shorthair'],
  turkish_angora: ['longhair'],
  siberian: ['longhair', 'big'],
  neva_masquerade: ['longhair', 'big', 'colorpoint'],
  american_shorthair: ['shorthair'],
  exotic_shorthair: ['shorthair', 'flat_face'],
  abyssinian: ['shorthair', 'ticked'],
  birman: ['longhair', 'colorpoint'],
  european_shorthair: ['shorthair'],
  // --- Tier 3 ---
  maine_coon: ['longhair', 'big'],
  norwegian_forest: ['longhair', 'big'],
  ragdoll: ['longhair', 'big', 'colorpoint'],
  bengal: ['shorthair', 'spotted'],
  donskoy: ['hairless'],
  sphynx: ['hairless'],
  cornish_rex: ['shorthair', 'curly'],
  devon_rex: ['shorthair', 'curly'],
  munchkin: ['shorthair', 'short_legs'],
  kurilian_bobtail: ['longhair', 'short_tail'],
  japanese_bobtail: ['shorthair', 'short_tail'],
  burmese: ['shorthair', 'flat_face'],
  bombay: ['shorthair'],
  somali: ['longhair', 'ticked'],
  ocicat: ['shorthair', 'spotted'],
  chartreux: ['shorthair'],
  oriental_shorthair: ['shorthair'],
  tonkinese: ['shorthair', 'colorpoint'],
  himalayan: ['longhair', 'flat_face', 'colorpoint'],
  manx: ['shorthair', 'short_tail'],
  balinese: ['longhair', 'colorpoint'],
  turkish_van: ['longhair'],
  // --- Tier 4 ---
  american_curl: ['curled_ears', 'shorthair'],
  elf: ['hairless', 'curled_ears'],
  bambino: ['hairless', 'short_legs'],
  skookum: ['shorthair', 'curly', 'short_legs'],
  minskin: ['hairless', 'short_legs'],
  lykoi: ['hairless'],
  chausie: ['shorthair', 'ticked', 'big'],
  khao_manee: ['shorthair'],
  singapura: ['shorthair', 'ticked'],
  selkirk_rex: ['longhair', 'curly'],
  pixiebob: ['shorthair', 'spotted', 'short_tail', 'big'],
  toyger: ['shorthair'],
  kinkalow: ['shorthair', 'curled_ears', 'short_legs'],
  peterbald: ['hairless'],
  egyptian_mau: ['shorthair', 'spotted'],
  laperm: ['longhair', 'curly'],
  american_wirehair: ['shorthair', 'wirehair'],
  sokoke: ['shorthair'],
  burmilla: ['shorthair'],
  havana: ['shorthair'],
  ojos_azules: ['shorthair'],
  // --- Tier 5 ---
  savannah: ['shorthair', 'spotted', 'big'],
  caracat: ['shorthair', 'big'],
  ashera: ['shorthair', 'spotted', 'big'],
  dwelf: ['hairless', 'curled_ears', 'short_legs'],
  serengeti: ['shorthair', 'spotted', 'big'],
  cheetoh: ['shorthair', 'spotted'],
  safari: ['shorthair', 'spotted', 'big'],
  california_spangled: ['shorthair', 'spotted'],
  khao_manee_diamond: ['shorthair'],
  lykoi_elf: ['hairless', 'curled_ears'],
};

/** Наследуемые гены породы (пустой список у дворового и незнакомых ключей). */
export function breedTraits(breed: string): readonly TraitId[] {
  return BREED_GENES[breed] ?? [];
}

/** Отсортировать гены в каноническом порядке (длина → … → рисунок). */
export function sortTraits(ids: Iterable<TraitId>): TraitId[] {
  return [...new Set(ids)].sort((a, b) => TRAIT_ORDER[a] - TRAIT_ORDER[b]);
}

/**
 * Полный набор генов кота: визитка его породы ∪ визитки всех пород-предков.
 * Именно его читают рецепты (traitAny/traitBoth) — «несёт ли родитель ген».
 */
export function carriedTraitSet(ownBreed: string, ancestorBreeds: Iterable<string>): Set<TraitId> {
  const out = new Set<TraitId>(breedTraits(ownBreed));
  for (const b of ancestorBreeds) for (const t of breedTraits(b)) out.add(t);
  return out;
}

/**
 * Дремлющие («скрытые») гены — есть у предков, но НЕ у самой породы кота.
 * Это то, что вскрывает анализ. `ancestorBreeds` — известные игроку предки.
 */
export function dormantTraits(ownBreed: string, ancestorBreeds: Iterable<string>): TraitId[] {
  const own = new Set<TraitId>(breedTraits(ownBreed));
  const out = new Set<TraitId>();
  for (const b of ancestorBreeds) for (const t of breedTraits(b)) if (!own.has(t)) out.add(t);
  return sortTraits(out);
}

/** Короткая подпись гена: «🐆 пятнистость». */
export function traitTag(id: TraitId): string {
  const t = TRAIT_BY_ID[id];
  return `${t.emoji} ${tx(t.label)}`;
}

// ============================================================================
//  Слой 2 — облик (окрас · рисунок · глаза), косметика по полу
// ============================================================================

export type ColorId =
  | 'black' | 'blue' | 'white' | 'red' | 'cream' | 'brown' | 'sable' | 'chocolate'
  | 'silver' | 'bronze' | 'tortoiseshell' | 'calico' | 'red_white' | 'black_roan'
  | 'skin_pink' | 'skin_grey' | 'seal' | 'sorrel' | 'ruddy' | 'sepia';

export type PatternId = 'tiger' | 'marbled' | 'shaded' | 'spotted' | 'ticked' | 'colorpoint';

export type EyeId = 'heterochromia' | 'blue_eyes';

export type Sex = 'male' | 'female';

/** Облик одного пола породы: ровно один окрас, опц. рисунок и особые глаза. */
export interface Look {
  color: ColorId;
  pattern?: PatternId;
  eyes?: EyeId;
}

interface Tagged { label: LocStr; emoji: string; }

export const COLOR_INFO: Record<ColorId, Tagged> = {
  black: { emoji: '⚫', label: ['чёрный', 'black'] },
  blue: { emoji: '🩶', label: ['голубой', 'blue'] },
  white: { emoji: '⚪', label: ['белый', 'white'] },
  red: { emoji: '🟠', label: ['рыжий', 'red'] },
  cream: { emoji: '🟡', label: ['кремовый', 'cream'] },
  brown: { emoji: '🟤', label: ['коричневый', 'brown'] },
  sable: { emoji: '🟫', label: ['соболиный', 'sable'] },
  chocolate: { emoji: '🍫', label: ['шоколадный', 'chocolate'] },
  silver: { emoji: '⬜', label: ['серебристый', 'silver'] },
  bronze: { emoji: '🥉', label: ['бронзовый', 'bronze'] },
  tortoiseshell: { emoji: '🐢', label: ['черепаховый', 'tortoiseshell'] },
  calico: { emoji: '🎨', label: ['черепахово-белый', 'calico'] },
  red_white: { emoji: '🔶', label: ['рыже-белый', 'red & white'] },
  black_roan: { emoji: '🐺', label: ['чёрный роан', 'black roan'] },
  skin_pink: { emoji: '🩷', label: ['розовая кожа', 'pink skin'] },
  skin_grey: { emoji: '🩶', label: ['серо-голубая кожа', 'blue-grey skin'] },
  seal: { emoji: '🟤', label: ['сил-пойнт', 'seal point'] },
  sorrel: { emoji: '🍂', label: ['соррель', 'sorrel'] },
  ruddy: { emoji: '🦊', label: ['дикий (ruddy)', 'ruddy'] },
  sepia: { emoji: '🫘', label: ['сепия', 'sepia'] },
};

export const PATTERN_INFO: Record<PatternId, Tagged> = {
  tiger: { emoji: '🐅', label: ['тигровый', 'tabby'] },
  marbled: { emoji: '🪵', label: ['мраморный', 'marbled'] },
  shaded: { emoji: '✨', label: ['затушёванный', 'shaded'] },
  spotted: { emoji: '🐆', label: ['пятнистый', 'spotted'] },
  ticked: { emoji: '🌾', label: ['тикированный', 'ticked'] },
  colorpoint: { emoji: '🎭', label: ['колор-пойнт', 'colorpoint'] },
};

export const EYE_INFO: Record<EyeId, Tagged> = {
  heterochromia: { emoji: '👁', label: ['гетерохромия', 'heterochromia'] },
  blue_eyes: { emoji: '🔵', label: ['голубые глаза', 'blue eyes'] },
};

const L = (color: ColorId, pattern?: PatternId, eyes?: EyeId): Look => ({
  color,
  ...(pattern ? { pattern } : {}),
  ...(eyes ? { eyes } : {}),
});

/**
 * Облик каждой породы отдельно для кота (male) и кошки (female). Дворовый (moggie)
 * не входит — его облик случаен. Черепаховый/ми-кэ закреплён за самками (генетика),
 * сплошной рыжий — за котами. Полнота проверяется тестом.
 */
export const BREED_LOOK: Record<string, { male: Look; female: Look }> = {
  // --- Tier 1 ---
  domestic_shorthair: { male: L('red', 'tiger'), female: L('tortoiseshell') },
  domestic_longhair: { male: L('brown', 'marbled'), female: L('tortoiseshell') },
  // --- Tier 2 ---
  british_shorthair: { male: L('blue'), female: L('silver', 'marbled') },
  scottish_fold: { male: L('blue'), female: L('silver', 'marbled') },
  persian: { male: L('white', undefined, 'blue_eyes'), female: L('calico') },
  siamese: { male: L('seal', 'colorpoint', 'blue_eyes'), female: L('blue', 'colorpoint', 'blue_eyes') },
  thai: { male: L('seal', 'colorpoint', 'blue_eyes'), female: L('seal', 'colorpoint', 'blue_eyes') },
  russian_blue: { male: L('blue'), female: L('blue') },
  turkish_angora: { male: L('white', undefined, 'heterochromia'), female: L('white', undefined, 'heterochromia') },
  siberian: { male: L('brown', 'tiger'), female: L('tortoiseshell', 'marbled') },
  neva_masquerade: { male: L('seal', 'colorpoint', 'blue_eyes'), female: L('blue', 'colorpoint', 'blue_eyes') },
  american_shorthair: { male: L('silver', 'marbled'), female: L('brown', 'tiger') },
  exotic_shorthair: { male: L('red', 'tiger'), female: L('tortoiseshell') },
  abyssinian: { male: L('ruddy', 'ticked'), female: L('sorrel', 'ticked') },
  birman: { male: L('seal', 'colorpoint', 'blue_eyes'), female: L('blue', 'colorpoint', 'blue_eyes') },
  european_shorthair: { male: L('brown', 'tiger'), female: L('tortoiseshell') },
  // --- Tier 3 ---
  maine_coon: { male: L('red', 'tiger'), female: L('black', 'marbled') },
  norwegian_forest: { male: L('brown', 'marbled'), female: L('tortoiseshell') },
  ragdoll: { male: L('seal', 'colorpoint', 'blue_eyes'), female: L('blue', 'colorpoint', 'blue_eyes') },
  bengal: { male: L('brown', 'spotted'), female: L('silver', 'spotted') },
  donskoy: { male: L('skin_pink'), female: L('skin_grey') },
  sphynx: { male: L('skin_pink'), female: L('skin_grey') },
  cornish_rex: { male: L('red_white'), female: L('blue') },
  devon_rex: { male: L('brown', 'tiger'), female: L('tortoiseshell') },
  munchkin: { male: L('red', 'tiger'), female: L('tortoiseshell') },
  kurilian_bobtail: { male: L('red', 'tiger'), female: L('tortoiseshell', 'marbled') },
  japanese_bobtail: { male: L('red_white'), female: L('calico') },
  burmese: { male: L('sable'), female: L('chocolate') },
  bombay: { male: L('black'), female: L('black') },
  somali: { male: L('ruddy', 'ticked'), female: L('sorrel', 'ticked') },
  ocicat: { male: L('brown', 'spotted'), female: L('silver', 'spotted') },
  chartreux: { male: L('blue'), female: L('blue') },
  oriental_shorthair: { male: L('black'), female: L('blue') },
  tonkinese: { male: L('brown', 'colorpoint'), female: L('chocolate', 'colorpoint') },
  himalayan: { male: L('seal', 'colorpoint', 'blue_eyes'), female: L('blue', 'colorpoint', 'blue_eyes') },
  manx: { male: L('brown', 'tiger'), female: L('tortoiseshell') },
  balinese: { male: L('seal', 'colorpoint', 'blue_eyes'), female: L('blue', 'colorpoint', 'blue_eyes') },
  turkish_van: { male: L('red_white', undefined, 'heterochromia'), female: L('red_white', undefined, 'heterochromia') },
  // --- Tier 4 ---
  american_curl: { male: L('brown', 'tiger'), female: L('tortoiseshell') },
  elf: { male: L('skin_pink'), female: L('skin_grey') },
  bambino: { male: L('skin_pink'), female: L('skin_grey') },
  skookum: { male: L('red'), female: L('tortoiseshell') },
  minskin: { male: L('skin_pink'), female: L('skin_grey') },
  lykoi: { male: L('black_roan'), female: L('black_roan') },
  chausie: { male: L('ruddy', 'ticked'), female: L('sable', 'ticked') },
  khao_manee: { male: L('white', undefined, 'heterochromia'), female: L('white', undefined, 'blue_eyes') },
  singapura: { male: L('sepia', 'ticked'), female: L('sepia', 'ticked') },
  selkirk_rex: { male: L('blue'), female: L('tortoiseshell') },
  pixiebob: { male: L('brown', 'spotted'), female: L('brown', 'spotted') },
  toyger: { male: L('red', 'tiger'), female: L('brown', 'tiger') },
  kinkalow: { male: L('blue'), female: L('tortoiseshell') },
  peterbald: { male: L('skin_pink'), female: L('skin_grey') },
  egyptian_mau: { male: L('silver', 'spotted'), female: L('bronze', 'spotted') },
  laperm: { male: L('red'), female: L('tortoiseshell') },
  american_wirehair: { male: L('red', 'tiger'), female: L('tortoiseshell') },
  sokoke: { male: L('brown', 'marbled'), female: L('brown', 'marbled') },
  burmilla: { male: L('silver', 'shaded'), female: L('silver', 'shaded') },
  havana: { male: L('chocolate'), female: L('chocolate') },
  ojos_azules: { male: L('brown', undefined, 'blue_eyes'), female: L('tortoiseshell', undefined, 'blue_eyes') },
  // --- Tier 5 ---
  savannah: { male: L('brown', 'spotted'), female: L('silver', 'spotted') },
  caracat: { male: L('ruddy'), female: L('sorrel') },
  ashera: { male: L('brown', 'spotted'), female: L('silver', 'spotted') },
  dwelf: { male: L('skin_pink'), female: L('skin_grey') },
  serengeti: { male: L('brown', 'spotted'), female: L('silver', 'spotted') },
  cheetoh: { male: L('brown', 'spotted'), female: L('silver', 'spotted') },
  safari: { male: L('brown', 'spotted'), female: L('brown', 'spotted') },
  california_spangled: { male: L('brown', 'spotted'), female: L('silver', 'spotted') },
  khao_manee_diamond: { male: L('white', undefined, 'blue_eyes'), female: L('white', undefined, 'blue_eyes') },
  lykoi_elf: { male: L('black_roan'), female: L('black_roan') },
};

/** Облик породы для указанного пола (undefined у дворового / незнакомых ключей). */
export function lookOf(breed: string, sex: Sex): Look | undefined {
  return BREED_LOOK[breed]?.[sex];
}

/** Подпись окраса: «🟤 коричневый». */
export function colorTag(id: ColorId): string {
  const c = COLOR_INFO[id];
  return `${c.emoji} ${tx(c.label)}`;
}

/** Подпись рисунка: «🐅 тигровый». */
export function patternTag(id: PatternId): string {
  const p = PATTERN_INFO[id];
  return `${p.emoji} ${tx(p.label)}`;
}

/** Подпись глаз: «👁 гетерохромия». */
export function eyeTag(id: EyeId): string {
  const e = EYE_INFO[id];
  return `${e.emoji} ${tx(e.label)}`;
}

/** Готовые подписи облика: [окрас, рисунок?, глаза?]. */
export function lookTags(look: Look): string[] {
  const out = [colorTag(look.color)];
  if (look.pattern) out.push(patternTag(look.pattern));
  if (look.eyes) out.push(eyeTag(look.eyes));
  return out;
}
