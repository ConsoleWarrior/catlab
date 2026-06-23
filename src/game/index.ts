/** Публичный API игрового слоя (Этап 4). См. GAME.md. */

export * from './types.js';
export {
  SAVE_VERSION, TIER_VALUE, UPGRADES, GENES, BASE_GENES, levelForReputation,
  ANALYZE_DNA_COST,
} from './config.js';
export type { UpgradeDef, GeneDef } from './config.js';
export {
  lvl, emptySlot, slotCount, nurseryCapacity, shelterCapacity, capacityOf,
  incubationDuration, mutationRate, offlineCapMin, catsIn, isBusy,
  passiveRatePerMin, adoptReward, upgradeCost, upgradeMaxed, makeCatInstance,
} from './economy.js';
export { createInitialState, serialize, deserialize } from './state.js';
export { matchesOrder, generateOrder, refillOrders } from './orders.js';
export {
  collectIncome, startBreeding, collectReady, adoptCat, moveCat,
  buyUpgrade, unlockGene, analyzeCat, claimOrder,
} from './actions.js';
export type { Result, BirthEvent } from './actions.js';
