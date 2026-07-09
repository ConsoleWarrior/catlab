/**
 * Глифы валют для подписей стоимости в UI. (Прежняя универсальная «кнопка апгрейда»
 * и панель `buildUpgradesPanel` удалены на этапе C0 — апгрейды покупаются напрямую
 * в комнатах, а вместимости переехали в дерево исследований.)
 */

import type { Currency } from '../game/index.js';

export const CUR_GLYPH: Record<Currency, string> = { coins: '💰', crystals: '💎', dna: '🧬' };
