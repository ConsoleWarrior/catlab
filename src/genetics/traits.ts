/**
 * Внешние признаки котов — «человеческий» слой скрытых генов.
 *
 * У каждой породы есть ФИКСИРОВАННАЯ визитка (один спрайт на пол/породу = один
 * облик): шерсть, уши, строение, рисунок, окрас, глаза. У кота полный набор
 * признаков = визитка его породы ∪ визитки всех пород-предков в родословной.
 * Проявленные признаки — визитка самой породы (видно сразу); дремлющие —
 * унаследованные от предков, скрыты туманом родословной и вскрываются
 * Генетическим анализом (см. game/pedigree.ts, ui/overlays).
 *
 * Рецепты (recipes.ts) читают признаки через traitAny/traitBoth: важно, что
 * признак ЕСТЬ у родителя (проявлен или дремлет) и может «выстрелить» у котёнка.
 * На рецепты влияют только НАСЛЕДУЕМЫЕ признаки (inherited: строение + сигнатурные
 * рисунки); окрас/глаза закреплены за породой для облика, но условий рецептов на
 * них нет (цвет самих родителей проверяют отдельные поля colorBoth/tabbyBoth).
 */

export type TraitId =
  // шерсть
  | 'shorthair' | 'longhair' | 'hairless' | 'curly' | 'wirehair'
  // уши
  | 'folded_ears' | 'curled_ears'
  // строение
  | 'flat_face' | 'short_tail' | 'short_legs' | 'big'
  // рисунок
  | 'colorpoint' | 'ticked' | 'spotted' | 'tiger' | 'marbled'
  // окрас
  | 'black' | 'white' | 'blue' | 'chocolate' | 'silver' | 'tortoiseshell'
  // глаза
  | 'heterochromia' | 'blue_eyes';

export type TraitGroup = 'coat' | 'ears' | 'body' | 'pattern' | 'color' | 'eyes';

export interface TraitDef {
  id: TraitId;
  /** RU-подпись. */
  label: string;
  emoji: string;
  group: TraitGroup;
  /**
   * Наследуется через родословную и может влиять на рецепты (строение + сигнатурные
   * рисунки: колор-пойнт/тикинг/пятна). Окрас/глаза — только облик (inherited: false).
   */
  inherited: boolean;
}

/** Метаданные всех 24 признаков (порядок = порядок вывода в UI). */
export const TRAITS: readonly TraitDef[] = [
  // --- шерсть ---
  { id: 'shorthair', label: 'короткая шерсть', emoji: '🐈', group: 'coat', inherited: true },
  { id: 'longhair', label: 'длинная шерсть', emoji: '🦁', group: 'coat', inherited: true },
  { id: 'hairless', label: 'бесшёрстность', emoji: '🥚', group: 'coat', inherited: true },
  { id: 'curly', label: 'кудрявость', emoji: '🌀', group: 'coat', inherited: true },
  { id: 'wirehair', label: 'жёсткая шерсть', emoji: '🧽', group: 'coat', inherited: true },
  // --- уши ---
  { id: 'folded_ears', label: 'вислоухость', emoji: '📐', group: 'ears', inherited: true },
  { id: 'curled_ears', label: 'уши-кёрл', emoji: '🌙', group: 'ears', inherited: true },
  // --- строение ---
  { id: 'flat_face', label: 'плоская морда', emoji: '😽', group: 'body', inherited: true },
  { id: 'short_tail', label: 'короткий хвост', emoji: '🐇', group: 'body', inherited: true },
  { id: 'short_legs', label: 'короткие лапы', emoji: '🦵', group: 'body', inherited: true },
  { id: 'big', label: 'крупный', emoji: '🐘', group: 'body', inherited: true },
  // --- рисунок ---
  { id: 'colorpoint', label: 'колор-пойнт', emoji: '🎭', group: 'pattern', inherited: true },
  { id: 'ticked', label: 'тикинг', emoji: '🌾', group: 'pattern', inherited: true },
  { id: 'spotted', label: 'пятнистость', emoji: '🐆', group: 'pattern', inherited: true },
  { id: 'tiger', label: 'тигровый рисунок', emoji: '🐅', group: 'pattern', inherited: false },
  { id: 'marbled', label: 'мраморный рисунок', emoji: '🪵', group: 'pattern', inherited: false },
  // --- окрас ---
  { id: 'black', label: 'чёрный окрас', emoji: '⚫', group: 'color', inherited: false },
  { id: 'white', label: 'белый окрас', emoji: '⚪', group: 'color', inherited: false },
  { id: 'blue', label: 'голубой окрас', emoji: '🔷', group: 'color', inherited: false },
  { id: 'chocolate', label: 'шоколадный окрас', emoji: '🍫', group: 'color', inherited: false },
  { id: 'silver', label: 'серебристый окрас', emoji: '✨', group: 'color', inherited: false },
  { id: 'tortoiseshell', label: 'черепаховый окрас', emoji: '🐢', group: 'color', inherited: false },
  // --- глаза ---
  { id: 'heterochromia', label: 'гетерохромия', emoji: '👁', group: 'eyes', inherited: false },
  { id: 'blue_eyes', label: 'голубые глаза', emoji: '🔵', group: 'eyes', inherited: false },
];

export const TRAIT_BY_ID: Record<TraitId, TraitDef> = Object.fromEntries(
  TRAITS.map((t) => [t.id, t]),
) as Record<TraitId, TraitDef>;

/** Порядковый индекс признака (для стабильной сортировки списков). */
const TRAIT_ORDER: Record<TraitId, number> = Object.fromEntries(
  TRAITS.map((t, i) => [t.id, i]),
) as Record<TraitId, number>;

/**
 * Фиксированная визитка каждой породы. Пустой список у «Дворового» (moggie) —
 * его облик случаен, потому он и хранит лотерею скрытых генов в родословной.
 * Ключи совпадают с catalog.ts BREEDS; полнота проверяется тестом.
 */
export const BREED_TRAITS: Record<string, readonly TraitId[]> = {
  // --- Tier 1 ---
  moggie: [],
  domestic_shorthair: ['shorthair'],
  domestic_longhair: ['longhair'],
  // --- Tier 2 ---
  british_shorthair: ['shorthair', 'blue'],
  scottish_fold: ['folded_ears', 'shorthair'],
  persian: ['longhair', 'flat_face'],
  siamese: ['shorthair', 'colorpoint'],
  thai: ['shorthair', 'colorpoint'],
  russian_blue: ['shorthair', 'blue'],
  turkish_angora: ['longhair', 'white', 'heterochromia'],
  siberian: ['longhair', 'big'],
  neva_masquerade: ['longhair', 'big', 'colorpoint'],
  american_shorthair: ['shorthair', 'tiger'],
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
  burmese: ['shorthair', 'chocolate'],
  bombay: ['shorthair', 'black'],
  somali: ['longhair', 'ticked'],
  ocicat: ['shorthair', 'spotted'],
  chartreux: ['shorthair', 'blue'],
  oriental_shorthair: ['shorthair'],
  tonkinese: ['shorthair', 'colorpoint'],
  himalayan: ['longhair', 'flat_face', 'colorpoint'],
  manx: ['shorthair', 'short_tail'],
  balinese: ['longhair', 'colorpoint'],
  turkish_van: ['longhair', 'white', 'heterochromia'],
  // --- Tier 4 ---
  american_curl: ['curled_ears', 'shorthair'],
  elf: ['hairless', 'curled_ears'],
  bambino: ['hairless', 'short_legs'],
  skookum: ['curly', 'short_legs'],
  minskin: ['hairless', 'short_legs'],
  lykoi: ['hairless'],
  chausie: ['shorthair', 'big'],
  khao_manee: ['shorthair', 'white', 'heterochromia'],
  singapura: ['shorthair', 'ticked'],
  selkirk_rex: ['longhair', 'curly'],
  pixiebob: ['shorthair', 'spotted', 'short_tail', 'big'],
  toyger: ['shorthair', 'tiger'],
  kinkalow: ['curled_ears', 'short_legs'],
  peterbald: ['hairless'],
  egyptian_mau: ['shorthair', 'spotted'],
  laperm: ['curly'],
  american_wirehair: ['shorthair', 'wirehair'],
  sokoke: ['shorthair', 'marbled'],
  burmilla: ['shorthair', 'silver'],
  havana: ['shorthair', 'chocolate'],
  ojos_azules: ['shorthair', 'blue_eyes'],
  // --- Tier 5 ---
  savannah: ['shorthair', 'spotted', 'big'],
  caracat: ['shorthair', 'big'],
  ashera: ['shorthair', 'spotted', 'big'],
  dwelf: ['hairless', 'curled_ears', 'short_legs'],
  serengeti: ['shorthair', 'spotted', 'big'],
  cheetoh: ['shorthair', 'spotted'],
  safari: ['shorthair', 'spotted', 'big'],
  california_spangled: ['shorthair', 'spotted'],
  khao_manee_diamond: ['shorthair', 'white', 'blue_eyes'],
  lykoi_elf: ['hairless', 'curled_ears'],
};

/** Визитка породы (пустой список у дворового и незнакомых ключей). */
export function breedTraits(breed: string): readonly TraitId[] {
  return BREED_TRAITS[breed] ?? [];
}

/** Отсортировать признаки в каноническом порядке (шерсть → … → глаза). */
export function sortTraits(ids: Iterable<TraitId>): TraitId[] {
  return [...new Set(ids)].sort((a, b) => TRAIT_ORDER[a] - TRAIT_ORDER[b]);
}

/**
 * Полный набор признаков кота: визитка его породы ∪ визитки всех пород-предков.
 * Именно его читают рецепты (traitAny/traitBoth) — «несёт ли родитель признак».
 */
export function carriedTraitSet(ownBreed: string, ancestorBreeds: Iterable<string>): Set<TraitId> {
  const out = new Set<TraitId>(breedTraits(ownBreed));
  for (const b of ancestorBreeds) for (const t of breedTraits(b)) out.add(t);
  return out;
}

/**
 * Дремлющие («скрытые») признаки — есть у предков, но НЕ у самой породы кота.
 * Это то, что вскрывает анализ. `ancestorBreeds` — известные игроку предки.
 */
export function dormantTraits(ownBreed: string, ancestorBreeds: Iterable<string>): TraitId[] {
  const own = new Set<TraitId>(breedTraits(ownBreed));
  const out = new Set<TraitId>();
  for (const b of ancestorBreeds) for (const t of breedTraits(b)) if (!own.has(t)) out.add(t);
  return sortTraits(out);
}

/** Короткая подпись признака: «🐆 пятнистость». */
export function traitTag(id: TraitId): string {
  const t = TRAIT_BY_ID[id];
  return `${t.emoji} ${t.label}`;
}
