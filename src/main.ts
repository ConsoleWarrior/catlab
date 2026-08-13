/**
 * Точка входа «Котолаборатории» (Этап 4): запуск игрового UI.
 * Разрез лаборатории со свайпом между комнатами поверх игрового ядра (src/game).
 * Прежний proof-of-concept рендера котика живёт в src/render/catSprite.ts.
 */

import { Game } from './ui/game.js';

const reset = new URLSearchParams(location.search).has('reset');
// start() сам разбирается с ошибками старта и в любом случае снимает лоадер
// платформы (п. 1.19.2). Этот catch — последний рубеж, чтобы в консоль не улетал
// необработанный промис, если сломается уже сам обработчик ошибки.
new Game().start(reset).catch((err) => console.error('[catlab] запуск прерван', err));
