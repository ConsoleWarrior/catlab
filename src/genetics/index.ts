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
  tierOfBreed, breedName, isBaseBreed,
} from './catalog.js';
export type { BreedDef, BreedKind, BreedBoosts } from './catalog.js';
export { BREED_DESC, breedDescription } from './breedInfo.js';
export {
  RECIPES, recipesFor, recipeKey, isPedigreeRecipe, pairMatches, recipeMatches, recipeChance,
  resolveBreeding, breedingOutcomes, tierUpTarget, boostCanFire, KINSHIP_RANK, KINSHIP_RECIPE_MULT,
} from './recipes.js';
export type { Recipe, SideSpec, BreedSide, BreedingContext, KinshipLevel, BreedingOutcome } from './recipes.js';
export {
  TRAITS, TRAIT_BY_ID, BREED_GENES, breedTraits, sortTraits,
  carriedTraitSet, dormantTraits, traitTag,
  COLOR_INFO, PATTERN_INFO, EYE_INFO, BREED_LOOK,
  lookOf, colorTag, patternTag, eyeTag, lookTags,
} from './traits.js';
export type {
  TraitId, TraitGroup, TraitDef, ColorId, PatternId, EyeId, Sex, Look,
} from './traits.js';
export { breedValueMult, VALUE_MULT_MIN, VALUE_MULT_MAX } from './breedValue.js';
export { breedLevel, breedsAtLevel, BREED_LEVELS } from './breedLevel.js';
