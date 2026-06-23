/**
 * Типы генетической модели. См. GENETICS.md.
 * У кота 2 копии каждого гена (аллеля) — пара. Котёнок наследует по одной от родителя.
 */

export type Sex = 'male' | 'female';

/** Пара аллелей одного локуса (две копии гена). */
export type GenePair<T extends string> = readonly [T, T];

// --- Аллели по локусам (см. GENETICS.md §1) ---

/** Основной цвет (эумеланин): B чёрный > b шоколад > b1 циннамон. */
export type BAllele = 'B' | 'b' | 'b1';
/** Рыжий, сцеплен с полом. 'Y' — заглушка Y-хромосомы у самцов (не несёт O). */
export type OAllele = 'O' | 'o' | 'Y';
/** Разбавление: D плотный > d (dd = осветление). */
export type DAllele = 'D' | 'd';
/** Агути: A (рисунок виден) > a (солид). */
export type AAllele = 'A' | 'a';
/** Паттерн табби: тикинг > пятна > макрель > мрамор. */
export type TAllele = 'Ti' | 'Sp' | 'Mc' | 'mc';
/** Белые пятна: неполное доминирование (доза). */
export type SAllele = 'S' | 's';
/** Доминантный белый: W скрывает всё. */
export type WAllele = 'W' | 'w';
/** Колор-пойнт ряд: C полный > cb сепия > cs поинт > c альбинос. */
export type CAllele = 'C' | 'cb' | 'cs' | 'c';
/** Длина шерсти: L короткая > l длинная. */
export type LAllele = 'L' | 'l';
/** Форма ушей: fold/curl доминантны над normal (fold/fold летально). */
export type EaAllele = 'fold' | 'curl' | 'normal';
/** Форма морды: неполное доминирование round..normal..wedge. */
export type FcAllele = 'round' | 'normal' | 'wedge';
/** Базовый цвет глаз: медь > жёлтый > зелёный > голубой. */
export type EyAllele = 'copper' | 'yellow' | 'green' | 'blue';

/** Полный генотип котика. */
export interface Genotype {
  sex: Sex;
  B: GenePair<BAllele>;
  O: GenePair<OAllele>;
  D: GenePair<DAllele>;
  A: GenePair<AAllele>;
  T: GenePair<TAllele>;
  S: GenePair<SAllele>;
  W: GenePair<WAllele>;
  C: GenePair<CAllele>;
  L: GenePair<LAllele>;
  Ea: GenePair<EaAllele>;
  Fc: GenePair<FcAllele>;
  Ey: GenePair<EyAllele>;
}

/** Ключи аутосомных локусов (всё, кроме сцепленного с полом O и поля sex). */
export type AutosomalLocus =
  | 'B' | 'D' | 'A' | 'T' | 'S' | 'W' | 'C' | 'L' | 'Ea' | 'Fc' | 'Ey';

// --- Фенотип (видимый облик) ---

export type CoatLength = 'short' | 'long';
export type TabbyPattern = 'ticked' | 'spotted' | 'mackerel' | 'classic';
export type PointType = 'colorpoint' | 'sepia' | 'mink' | 'albino';
export type RarityTier = 'common' | 'uncommon' | 'rare' | 'epic' | 'legendary';

/** Вычисленный из генотипа видимый облик. Читается рендером для сборки слоёв. */
export interface Phenotype {
  /** Итоговый базовый цвет шерсти (с учётом B+D+O). */
  baseColor: string;
  /** Для черепаховых: два цвета пятен [эумеланин, феомеланин]. */
  tortieColors?: readonly [string, string];
  /** Рисунок табби или null (сплошной). */
  pattern: TabbyPattern | null;
  /** Доля белого 0..1. */
  whiteAmount: number;
  /** Черепаховый окрас (мозаика). */
  isTortie: boolean;
  /** Колор-пойнт активен. */
  pointed: boolean;
  pointType?: PointType;
  /** Полностью белый (доминантный белый). */
  white: boolean;
  coatLength: CoatLength;
  earShape: EaAllele;
  faceShape: FcAllele;
  eyeColor: string;
  /** Разные глаза. */
  oddEyed: boolean;
}
