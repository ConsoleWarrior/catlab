/** Публичный API генетического движка. */

export * from './types.js';
export { makeRng, hashGenotype, rngForGenotype, chance, pick } from './random.js';
export type { Rng } from './random.js';
export { DOMINANCE, dominantOf, ALLELE_FREQ, freqOf } from './loci.js';
export { breed, isLethal } from './breed.js';
export { expressPhenotype } from './phenotype.js';
export { calcRarity } from './rarity.js';
export type { Rarity } from './rarity.js';
export {
  wildType, makeCat, randomCat, simpleCat, detectBreed, BREED_PRESETS,
} from './factory.js';
export {
  BREEDS, PEDIGREE_BREEDS, BREED_BY_KEY, BREEDS_BY_TIER, TIER_LEVEL, LEVEL_TIER,
  tierOfBreed, breedName, isBaseBreed, breedKitten,
} from './catalog.js';
export type { BreedDef, BreedKind, BreedBoosts } from './catalog.js';
