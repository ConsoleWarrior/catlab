/** Публичный API игрового слоя (Этап 4). См. GAME.md. */

export * from './types.js';
export {
  SAVE_VERSION, TIER_VALUE, UPGRADES, GENES, BASE_GENES, levelForReputation,
  ANALYZE_DNA_COST, BOOSTS, RESEARCH, MAX_BREEDS, PEDIGREE_TIER_BONUS, PEDIGREE_GEN_FALLOFF, PEDIGREE_DEPTH,
} from './config.js';
export type { UpgradeDef, GeneDef, BoostDef, BoostId, ResearchDef, ResearchEffectKind } from './config.js';
export {
  lvl, emptySlot, slotCount, nurseryCapacity, shelterCapacity, capacityOf,
  incubationDuration, mutationRate, offlineCapMin, catsIn, isBusy, isInSlot,
  passiveRatePerMin, adoptReward, upgradeCost, upgradeMaxed, makeCatInstance,
  buyCatCost, growthScale, growthProgress, growthRemainingMs, isAdult, boostCharges,
  activeBoosts, consumeBoosts, researchBonus, isOld, breedsLeft, pedigreeBonus,
} from './economy.js';
export { createInitialState, serialize, deserialize } from './state.js';
export { buildPedigree, catAncestors, pedigreeDepth } from './pedigree.js';
export { matchesOrder, generateOrder, refillOrders } from './orders.js';
export {
  collectIncome, startBreeding, assignBreeder, clearBreederSlot, collectReady, adoptCat, moveCat, renameCat,
  buyUpgrade, unlockGene, analyzeCat, claimOrder, buyCat, buyBoost, unlockResearch,
} from './actions.js';
export type { Result, BirthEvent } from './actions.js';
