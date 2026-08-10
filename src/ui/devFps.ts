/**
 * ⚠️ ВРЕМЕННАЯ DEV-ТУЛЗА: счётчик FPS (кнопка 📊 в топбаре, только import.meta.env.DEV).
 * Удалить перед релизом вместе с кнопкой в `game.ts` (см. buildHud) и полем devFps.
 *
 * Зачем: тормоза ловятся на реальном телефоне, а не на ПК. Мгновенному `ticker.FPS`
 * верить нельзя (GDD §5) — здесь считаются усреднённые значения и, главное,
 * ХУДШИЕ кадры: рывок раз в секунду убивает ощущение плавности, но на среднем FPS
 * почти не виден. Поэтому в панели есть пик времени кадра, доля «джанка» и график
 * последних кадров — просадка видна глазом сразу.
 *
 * Сам измеритель должен быть дешёвым, иначе он испортит то, что измеряет: тексты и
 * график перерисовываются раз в 200 мс, обход дерева сцены — раз в секунду, и всё
 * это только пока панель открыта.
 */

import { Container, Graphics, Text } from 'pixi.js';
import type { Application } from 'pixi.js';

const HIST = 72;           // кадров в графике
const WINDOW_MS = 3000;    // окно усреднения и поиска пика
const REDRAW_MS = 200;     // как часто обновляем текст/график
const NODES_MS = 1000;     // как часто пересчитываем узлы сцены
const JANK_MS = 20;        // кадр дольше этого считаем рывком (ниже ~50 fps)
const WARMUP_MS = 600;     // первые кадры после включения не считаем (свой же хиккап)

// Размеры — в виртуальных координатах сцены (DESIGN_H ~490 на тач): на телефоне
// сцена ужимается примерно вдвое, поэтому шрифт заведомо крупнее «десктопного».
const PANEL_W = 250;
const PANEL_H = 140;
const CHART_H = 32;

export interface FpsMeter {
  /** Слой панели — добавляется в root игры (виртуальные координаты сцены). */
  readonly layer: Container;
  /** Показать/скрыть; при показе метрики обнуляются. */
  toggle(): void;
  /** Переложить под текущий размер сцены (вызывать из layout игры). */
  place(roomW: number, topInset: number): void;
  destroy(): void;
}

export function createFpsMeter(app: Application): FpsMeter {
  const layer = new Container();
  layer.eventMode = 'none'; // панель не должна перехватывать тапы (см. баг toastBox в game.ts)
  layer.visible = false;

  const bg = new Graphics();
  bg.roundRect(0, 0, PANEL_W, PANEL_H, 10).fill({ color: 0x000000, alpha: 0.66 });
  layer.addChild(bg);

  const text = new Text({
    text: '',
    style: {
      fontFamily: 'monospace', fontSize: 16, fontWeight: '700',
      fill: 0xffffff, lineHeight: 21,
    },
  });
  text.position.set(10, 9);
  layer.addChild(text);

  const chart = new Graphics();
  chart.position.set(10, PANEL_H - CHART_H - 8);
  layer.addChild(chart);

  // --- накопление метрик ---
  const hist: number[] = [];          // время последних кадров, мс (для графика)
  let frames = 0;                     // кадров в текущем окне
  let sumMs = 0;                      // сумма их длительностей
  let peakMs = 0;                     // худший кадр окна
  let jank = 0;                       // сколько кадров окна дольше JANK_MS
  let windowMs = 0;                   // накоплено времени в окне
  let lastAvg = 0, lastPeak = 0, lastJankPct = 0;
  let sinceRedraw = 0;
  let sinceNodes = 0;
  let nodes = 0;
  let warmup = 0;                     // прогрев: пропускаем кадры сразу после включения

  const reset = (): void => {
    hist.length = 0;
    frames = sumMs = peakMs = jank = windowMs = 0;
    lastAvg = lastPeak = lastJankPct = 0;
    sinceRedraw = REDRAW_MS; // первый кадр после открытия — сразу с цифрами
    sinceNodes = NODES_MS;
    warmup = WARMUP_MS;
  };

  /** Узлов в сцене: косвенный признак «слишком много объектов» при просадке. */
  const countNodes = (c: Container): number => {
    let n = 1;
    for (const child of c.children) n += countNodes(child as Container);
    return n;
  };

  const redraw = (): void => {
    const fpsNow = hist.length ? Math.round(1000 / (hist[hist.length - 1] || 16.7)) : 0;
    const avgFps = lastAvg > 0 ? Math.round(1000 / lastAvg) : 0;
    const res = app.renderer.resolution;
    const px = `${app.screen.width}×${app.screen.height}@${res % 1 === 0 ? res : res.toFixed(1)}`;

    text.text = [
      `FPS ${fpsNow}   средн ${avgFps}`,
      `кадр ${(hist[hist.length - 1] ?? 0).toFixed(1)} мс · пик ${lastPeak.toFixed(1)}`,
      `рывки ${lastJankPct}% (>${JANK_MS} мс)`,
      `узлов ${nodes} · ${px}`,
    ].join('\n');

    // цвет по среднему: зелёный ≥55, жёлтый ≥40, красный ниже
    text.style.fill = avgFps >= 55 ? 0x7ee08a : avgFps >= 40 ? 0xffd166 : 0xff6b6b;

    // график времени кадра: чем выше столбик, тем дольше кадр (потолок — 50 мс)
    chart.clear();
    const w = PANEL_W - 20;
    const step = w / HIST;
    chart.rect(0, 0, w, CHART_H).fill({ color: 0xffffff, alpha: 0.07 });
    // отсечка 16.7 мс (60 fps) — под ней всё хорошо
    const y60 = CHART_H - (16.7 / 50) * CHART_H;
    chart.rect(0, y60, w, 1).fill({ color: 0xffffff, alpha: 0.25 });
    for (let i = 0; i < hist.length; i++) {
      const ms = Math.min(hist[i]!, 50);
      const h = Math.max(1, (ms / 50) * CHART_H);
      chart
        .rect(i * step, CHART_H - h, Math.max(1, step - 0.5), h)
        .fill({ color: ms > JANK_MS ? 0xff6b6b : ms > 18 ? 0xffd166 : 0x7ee08a });
    }
  };

  const onTick = (): void => {
    if (!layer.visible) return;
    const ms = app.ticker.deltaMS;
    // включение панели само по себе даёт длинный кадр (создание текста/графики) —
    // он бы навсегда осел в «пике», поэтому первые кадры не учитываем
    if (warmup > 0) { warmup -= ms; return; }

    hist.push(ms);
    if (hist.length > HIST) hist.shift();

    frames++;
    sumMs += ms;
    windowMs += ms;
    if (ms > peakMs) peakMs = ms;
    if (ms > JANK_MS) jank++;
    // окно закрылось — фиксируем итоги и начинаем копить заново
    if (windowMs >= WINDOW_MS) {
      lastAvg = sumMs / frames;
      lastPeak = peakMs;
      lastJankPct = Math.round((jank / frames) * 100);
      frames = sumMs = peakMs = jank = windowMs = 0;
    }

    sinceNodes += ms;
    if (sinceNodes >= NODES_MS) {
      sinceNodes = 0;
      nodes = countNodes(app.stage);
    }

    sinceRedraw += ms;
    if (sinceRedraw >= REDRAW_MS) {
      sinceRedraw = 0;
      // пока первое окно не закрылось, показываем то, что уже накоплено
      if (lastAvg === 0 && frames > 0) {
        lastAvg = sumMs / frames;
        lastPeak = peakMs;
        lastJankPct = Math.round((jank / frames) * 100);
      }
      redraw();
    }
  };
  app.ticker.add(onTick);

  return {
    layer,
    toggle(): void {
      layer.visible = !layer.visible;
      if (layer.visible) reset();
    },
    place(roomW: number, topInset: number): void {
      // по центру под топбаром: слева титульная плашка комнаты с кнопкой ℹ️,
      // справа — панель корма, центр свободен во всех комнатах
      layer.position.set(Math.round((roomW - PANEL_W) / 2), topInset + 8);
    },
    destroy(): void {
      app.ticker.remove(onTick);
      layer.destroy({ children: true });
    },
  };
}
