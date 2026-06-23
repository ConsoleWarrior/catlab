/**
 * Точка входа «Котолаборатории» (Этап 4): запуск игрового UI.
 * Разрез лаборатории со свайпом между комнатами поверх игрового ядра (src/game).
 * Прежний proof-of-concept рендера котика живёт в src/render/catSprite.ts.
 */

import { Game } from './ui/game.js';

const reset = new URLSearchParams(location.search).has('reset');
void new Game().start(reset);
