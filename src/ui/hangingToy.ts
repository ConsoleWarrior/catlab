/**
 * Подвесная игрушка кошачьего комплекса (Приют): помпон на витой верёвке и
 * шарик на нитке. Обе вырезаны из спрайта комплекса в свои текстуры
 * (scripts/cut_toy.py) и висят на общей точке подвеса под площадкой.
 *
 * Физика — обычный математический маятник вокруг точки подвеса:
 *   ω' = −ω₀²·sin θ − k·ω,   ω₀ = 2π/период
 * Верёвка считается жёсткой (спрайт целиком поворачивается вокруг подвеса) —
 * при наших амплитудах (до ~50°) провис верёвки не читается, зато нет ни
 * скелета, ни сегментов, ни лишних текстур.
 *
 * Игрушку толкают:
 *   • коты — «живой пол» (`ToyOpts.hit` в livingFloor.ts) на пике взмаха лапой;
 *   • игрок — тапом по мячику (хит-зона кружком ездит вместе с мячиком).
 *
 * Узла два и живут они в РАЗНЫХ слоях: `view` (спрайт) — в слое пола, по глубине,
 * чтобы ближние коты проходили перед игрушкой; `hitView` (кружок тапа) — слоем
 * ПОВЕРХ котов. Иначе тап по мячику доставался коту: Pixi ищет цель спереди назад
 * и останавливается на первом, чей ПРЯМОУГОЛЬНИК накрыл точку, а у кота в этот
 * прямоугольник входит и подпись с именем над головой. На телефоне, где коты
 * относительно комнаты крупнее, мячик так вообще переставал нажиматься.
 * Между толчками игрушка сама чуть покачивается от «сквозняка», чтобы комната
 * не выглядела застывшей.
 */

import { Circle, Container, Sprite } from 'pixi.js';
import type { FederatedPointerEvent, Texture } from 'pixi.js';

export interface ToySpec {
  tex: Texture;
  /** Пиксель текстуры, которым игрушка привязана к комплексу (верх верёвки). */
  pivotX: number;
  pivotY: number;
  /** Центр мячика в пикселях текстуры и его радиус — хит-зона и цель для котов. */
  ballX: number;
  ballY: number;
  ballR: number;
  /** Нижняя граница радиуса хит-зоны, px комнаты: сам мячик мелкий, а палец нет. */
  minHitR: number;
  /** Период свободного качания, с (у длинной верёвки он больше — она «тяжелее»). */
  period: number;
}

export interface HangingToy {
  /** Спрайт игрушки: в слой пола, с глубиной комплекса. */
  view: Container;
  /** Кружок тапа по мячику: в слой ПОВЕРХ котов, в тех же координатах, что view. */
  hitView: Container;
  /** Позиция мячика в координатах слоя — по ней коты целятся лапой. */
  ballAt(): { x: number; y: number };
  tick(dt: number): void;
  /**
   * Толкнуть игрушку: dir = +1 — вправо по экрану, −1 — влево;
   * power ≈ 0…1 (лапа котёнка слабее лапы взрослого кота).
   */
  push(dir: number, power: number): void;
  /** Игрок тапнул по мячику (аргумент — куда полетел мячик). */
  onTap?: (dir: number) => void;
}

const MAX_ANGLE = 0.62;   // рад — дальше мячик улетел бы за габариты комплекса
const DAMP = 0.5;         // затухание: качается 4–6 раз и замирает
const IMPULSE = 3.4;      // рад/с при power = 1 (амплитуда ≈ ω/ω₀)
const MAX_OMEGA = 6;      // потолок скорости: серия толчков не раскручивает «пропеллер»
const BREEZE_MIN = 6, BREEZE_VAR = 10; // с — пауза между вздохами «сквозняка»

export function createHangingToy(spec: ToySpec, x: number, y: number, scale: number): HangingToy {
  const view = new Container();
  view.position.set(x, y);
  view.eventMode = 'passive'; // сам контейнер не ловит тапы, а хит-зона мячика — да

  const sprite = new Sprite(spec.tex);
  sprite.eventMode = 'none';  // верёвка не должна перехватывать тапы по котам за ней
  sprite.anchor.set(spec.pivotX / spec.tex.width, spec.pivotY / spec.tex.height);
  sprite.scale.set(scale);
  view.addChild(sprite);

  // мячик в локальных координатах подвеса (до поворота)
  const bx = (spec.ballX - spec.pivotX) * scale;
  const by = (spec.ballY - spec.pivotY) * scale;

  // Хит-зона тапа: пустой контейнер с круглой hitArea, который каждый кадр
  // переезжает под мячик. Круг (а не прямоугольник спрайта) — чтобы верёвка во
  // всю высоту не глушила тапы по котам, стоящим за ней. Живёт отдельным узлом
  // (hitView) — комната кладёт его поверх котов, см. шапку файла.
  const hit = new Container();
  hit.eventMode = 'static';
  hit.cursor = 'pointer';
  hit.hitArea = new Circle(0, 0, Math.max(spec.minHitR, spec.ballR * scale * 1.8));

  let theta = 0;   // угол отклонения верёвки, рад (0 — как нарисовано)
  let omega = 0;   // угловая скорость, рад/с
  let tug = 0;     // «рывок» после удара: верёвка на миг вытягивается
  let breeze = BREEZE_MIN + Math.random() * BREEZE_VAR;
  const w2 = (2 * Math.PI / spec.period) ** 2;

  const push = (dir: number, power: number): void => {
    // положительный θ уводит мячик влево (поворот вокруг подвеса при оси Y вниз)
    omega -= Math.sign(dir) * Math.abs(power) * IMPULSE;
    omega = Math.max(-MAX_OMEGA, Math.min(MAX_OMEGA, omega));
    tug = Math.min(1, tug + Math.abs(power) * 0.8);
  };

  const ballAt = (): { x: number; y: number } => {
    const c = Math.cos(theta), s = Math.sin(theta);
    return { x: x + bx * c - by * s, y: y + bx * s + by * c };
  };

  function tick(dt: number): void {
    // маятник + затухание (полушаг по скорости — устойчиво при любом dt тикера)
    omega += (-w2 * Math.sin(theta) - DAMP * omega) * dt;
    theta += omega * dt;
    if (Math.abs(theta) > MAX_ANGLE) {          // упёрлись в предел — гасим отскоком
      theta = Math.sign(theta) * MAX_ANGLE;
      omega *= -0.3;
    }
    // «сквозняк»: пока игрушка почти замерла, изредка чуть подталкиваем её,
    // чтобы верёвка жила, а не стояла как приклеенная
    breeze -= dt;
    if (breeze <= 0) {
      breeze = BREEZE_MIN + Math.random() * BREEZE_VAR;
      if (Math.abs(theta) < 0.08 && Math.abs(omega) < 0.25) push(Math.random() < 0.5 ? 1 : -1, 0.06);
    }

    tug = Math.max(0, tug - dt * 2.2);
    sprite.rotation = theta;
    sprite.scale.set(scale * (1 - tug * 0.03), scale * (1 + tug * 0.05));
    const b = ballAt();
    hit.position.set(b.x, b.y); // hitView — сосед view, координаты те же (комнаты)
  }

  const hitView = new Container();
  hitView.eventMode = 'passive';
  hitView.addChild(hit);
  hit.position.set(ballAt().x, ballAt().y);

  const toy: HangingToy = { view, hitView, ballAt, tick, push };

  hit.on('pointerdown', (e: FederatedPointerEvent) => {
    // толкаем мячик прочь от пальца: тапнул слева — улетел вправо
    const p = hitView.toLocal(e.global);
    const dir = p.x <= ballAt().x ? 1 : -1;
    push(dir, 1);
    toy.onTap?.(dir);
  });

  return toy;
}
