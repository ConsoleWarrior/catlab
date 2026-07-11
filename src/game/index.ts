/** Публичный API игрового слоя (Этап 4). См. GAME.md. */

export * from './types.js';
export {
  SAVE_VERSION, TIER_VALUE, TIER_MARKET_VALUE, UPGRADES, GENES, BASE_GENES, levelForReputation,
  ANALYZE_COIN_COST, ANALYZE_AD_COOLDOWN_MS,
  RECIPE_RESEARCH_MS, RECIPE_RESEARCH_COST_COINS, RECIPE_RESEARCH_COST_DNA,
  BOOSTS, RESEARCH, MAX_HEARTS, PEDIGREE_DEPTH,
  HIDDEN_GENE_TIER_WEIGHTS, KINSHIP_HEALTH, AD_SKIP_MS,
  LEVEL_REP_THRESHOLDS, MAX_LEVEL, nextLevelRep, unlocksAtLevel, LAB_UNLOCKS,
  SLOT_UNLOCK_LEVELS, PEDESTAL_UNLOCK_LEVELS,
  REP_BIRTH_BY_TIER, REP_NEW_BREED_MULT, REP_ADOPT_MULT, REP_LAB_MULT,
  FOOD_CAP_BASE, FOOD_PER_CAT_PER_MIN, FOOD_PACK_UNITS, FOOD_PACK_COST, FEED_FREE_CATS,
  CHAMPION_SLOTS_BASE,
  HEAL_AD_HEARTS, HEAL_AD_COOLDOWN_MS, HEAL_CRYSTAL_PER_HEART,
  CRYO_BASE_CAP, CLONE_LAB_MULT,
} from './config.js';
export type { UpgradeDef, GeneDef, BoostDef, BoostId, ResearchDef, ResearchLevel, ResearchEffectKind, LabFeature } from './config.js';
export {
  lvl, emptySlot, slotCount, nurseryCapacity, shelterCapacity, capacityOf,
  incubationDuration, mutationRate, offlineCapMin, catsIn, roomCount, isBusy, isInSlot,
  passiveRatePerMin, netIncomePerMin, adoptReward, upgradeCost, upgradeMaxed,
  foodEnabled, foodCap, foodLevel, foodRatePerMin, isStarving, foodMinutesLeft, consumeFood,
  feedEfficiency, autoFeedEnabled, autoFeed, breedChanceMult, kinshipSafety, extraHearts, applyExtraHearts,
  makeCatInstance, buyCatCost, growthScale, growthProgress, growthRemainingMs, isAdult,
  boostCharges, activeBoosts, consumeBoosts, researchBonus,
  researchLevel, researchOwned, researchMaxed, researchNext, isOld, breedsLeft, heartsOf, isSterile,
  catMarketValue, pedigreeValueMult, healthValueMult, labReward,
  cryoUnlocked, cryoCapacity, cryoCount, cloneCost,
  championSlots, championIds, championCats, championAt, isChampion, championIncomePerMin,
  speedUpCost, effGrowthMs,
  isUnlocked, unlockLevelOf, maxSlotsForLevel, maxChampionsForLevel,
  nextSlotUnlockLevel, nextPedestalUnlockLevel,
} from './economy.js';
export { createInitialState, serialize, deserialize } from './state.js';
export {
  buildPedigree, catAncestors, pedigreeDepth, attachHiddenPedigree,
  revealPedigree, pedigreeHasFog, knownAncestorBreeds,
} from './pedigree.js';
export {
  recipeIsKnown, breedDiscovered, breedStudied, knownRecipesFor,
  researchableRecipes, outcomeRevealed,
} from './knowledge.js';
export {
  relatedness, kinshipLevel, rollKittenHearts, buildBreedingContext,
  ancestorGens, ancestorBreedList, isPureLine, KINSHIP_RU,
} from './kinship.js';
export { matchesOrder, generateOrder, refillOrders, pruneExpiredOrders } from './orders.js';
export {
  collectIncome, startBreeding, assignBreeder, clearBreederSlot, collectReady, adoptCat, moveCat,
  keepKittenWithParents, renameCat, sendToLab, setChampion, unsetChampion,
  speedUpBreeding, adSkipBreeding, speedUpGrowth, adSkipGrowth,
  buyUpgrade, unlockGene, analyzeCat, claimOrder, buyCat, buyBoost, unlockResearch,
  addReputation, buyFood, healCat, freezeCat, cloneCat, disposeCryo,
  startRecipeResearch, finishRecipeResearch, speedUpRecipeResearch, adSkipRecipeResearch,
} from './actions.js';
export type { Result, BirthEvent } from './actions.js';
