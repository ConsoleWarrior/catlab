/** Публичный API игрового слоя (Этап 4). См. GAME.md. */

export * from './types.js';
export {
  SAVE_VERSION, TIER_MARKET_VALUE, UPGRADES, GENES, BASE_GENES, levelForReputation,
  ANALYZE_COIN_COST_BY_TIER, analyzeCoinCost,
  RECIPE_RESEARCH_COINS_PER_LEVEL, RECIPE_RESEARCH_DNA_PER_LEVEL, RECIPE_RESEARCH_MS_PER_LEVEL,
  recipeResearchCost, recipeResearchMs,
  BOOSTS, RESEARCH, MAX_HEARTS, PEDIGREE_DEPTH,
  HIDDEN_GENE_TIER_WEIGHTS, KINSHIP_HEALTH, AD_SKIP_MS, BOOST_AD_COOLDOWN_MS,
  BREED_SPEEDUP_CRYSTAL_PER_MIN, GROWTH_SPEEDUP_CRYSTAL_PER_MIN, RECIPE_SPEEDUP_CRYSTAL_PER_MIN,
  LEVEL_REP_THRESHOLDS, MAX_LEVEL, nextLevelRep, unlocksAtLevel, LAB_UNLOCKS,
  SLOT_UNLOCK_LEVELS, PEDESTAL_UNLOCK_LEVELS,
  REP_BIRTH_RATE, REP_NEW_BREED_MULT, REP_ADOPT_MULT, REP_LAB_MULT,
  FOOD_CAP_BASE, FOOD_PER_MIN_BY_TIER, FOOD_PACK_UNITS, FOOD_PACK_COST,
  CHAMPION_SLOTS_BASE,
  HEAL_AD_HEARTS, HEAL_CRYSTAL_PER_HEART,
  CRYSTAL_PACKS, FIRST_PURCHASE_BONUS, PROCESSED_PURCHASES_KEEP, packBonusPct,
  CRYO_BASE_CAP, CLONE_LAB_MULT,
  FREEZE_COIN_COST, FREEZE_CRYSTAL_COST, FREEZE_AD_COOLDOWN_MS,
  ORDER_TARGET, ORDER_REFRESH_MS, ORDER_AD_REFRESH_COOLDOWN_MS, ORDER_SELL_SLOTS, ORDER_CRYSTALS,
  ORDER_REP_BASE, ORDER_REP_GROWTH, orderRepFor,
  PEDESTAL_COSTS, PEDESTAL_PLACES, PLACE_INCOME_MULT,
} from './config.js';
export type { UpgradeDef, GeneDef, BoostDef, BoostId, ResearchDef, ResearchLevel, ResearchEffectKind, LabFeature, CrystalPack } from './config.js';
export {
  lvl, emptySlot, slotCount, nurseryCapacity, shelterCapacity, capacityOf,
  incubationDuration, mutationRate, offlineCapMin, catsIn, roomCount, isBusy, isInSlot, freeBreedSlot,
  passiveRatePerMin, netIncomePerMin, adoptReward, upgradeCost, upgradeMaxed,
  researchExtraCoins, canAffordResearch,
  foodEnabled, foodCap, foodLevel, foodRatePerMin, isStarving, foodMinutesLeft, consumeFood,
  catFoodPerMin, feedingCatCount, foodBuyQuote,
  feedEfficiency, autoFeedEnabled, autoFeed, breedChanceMult, kinshipSafety, extraHearts, applyExtraHearts,
  makeCatInstance, buyCatCost, isRescuePair, growthScale, growthProgress, growthRemainingMs, isAdult,
  boostCharges, activeBoostId, activeBoosts, consumeBoosts, researchBonus,
  researchLevel, researchOwned, researchMaxed, researchNext, isOld, breedsLeft, heartsOf, isSterile,
  catMarketValue, pedigreeValueMult, healthValueMult, labReward, shelterTotals,
  cryoUnlocked, cryoCapacity, cryoCount, cloneCost, cloneCostCoins,
  championSlots, championIds, championCats, championAt, isChampion, championIncomePerMin,
  pedestalPlace, placeIncomeMult,
  basketCat, isInBasket,
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
  relatedness, kinshipLevel, rollKittenHearts, softenKinship, buildBreedingContext,
  ancestorGens, ancestorBreedList, isPureLine, KINSHIP_RU,
} from './kinship.js';
export {
  matchesOrder, generateOrder, initOrders, refreshExpiredOrders, adRefreshOrder, replaceOrder,
  msUntilOrderExpiry, canAdRefreshOrder, msUntilAdRefresh,
} from './orders.js';
export {
  collectIncome, startBreeding, assignBreeder, clearBreederSlot, collectReady, adoptCat, moveCat,
  keepKittenWithParents, renameCat, sendToLab, adoptAll, sendAllToLab, setChampion, unsetChampion,
  speedUpBreeding, adSkipBreeding, freeSkipBreeding, speedUpGrowth, adSkipGrowth,
  putCatInBasket, clearOrderBasket,
  buyUpgrade, unlockGene, analyzeCat, claimOrder, buyCat, buyBoost, adChargeBoost, toggleBoost, unlockResearch,
  addReputation, buyFood, healCat, freezeCat, cloneCat, disposeCryo,
  startRecipeResearch, finishRecipeResearch, speedUpRecipeResearch, adSkipRecipeResearch,
  grantCrystals, firstPurchaseBonusAvailable, isKnownPack,
} from './actions.js';
export type { Result, BirthEvent } from './actions.js';
export { tutorialStep, tutorialActive, finishTutorial, restartTutorial } from './tutorial.js';
export type { TutorStep } from './tutorial.js';
