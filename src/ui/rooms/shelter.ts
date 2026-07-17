/**
 * Комната «Приют»: котики-метисы ХОДЯТ по полу и ждут, пока их пристроят
 * «в добрые руки» (переноска у двери) или сдадут в лабораторию за 🧬
 * (лабораторный слот). Тап по котику → меню. Улучшения — в оверлее ⚙️.
 *
 * Здесь же стойка заказов: кнопка 📋 у названия комнаты (с таймером до смены
 * доски в московскую полночь) и зона-корзина под ней — заказ можно закрыть
 * ТОЛЬКО котом, положенным в корзину (см. actions.claimOrder).
 */

import { Container, Graphics, Rectangle, Sprite } from 'pixi.js';
import {
  catsIn, shelterCapacity, isInSlot, isUnlocked, unlockLevelOf, shelterTotals,
  isInBasket, basketCat, putCatInBasket, clearOrderBasket, msUntilOrdersReset, matchesOrder,
} from '../../game/index.js';
import type { Cat } from '../../game/index.js';
import type { Room, UiContext } from '../context.js';
import { roomShell, floorPlane } from './shell.js';
import { Button, COLORS, label } from '../theme.js';
import { createLivingFloor } from '../livingFloor.js';
import { decorZone } from '../decorArt.js';

/** Остаток до смены заказов «Ч:ММ:СС» — подпись на кнопке доски. */
function fmtLeft(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return `${h}:${String(m).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
}

export function createShelter(ctx: UiContext): Room {
  const shell = roomShell(ctx, 'shelter', '🏠 Приют');

  // Зона пристройства — переноска у двери (декор с role:'adopt'). Перетащил кота
  // сюда → подтверждение «Отдать в добрые руки?» (см. tryDropCat). Над переноской
  // — лёгкая подпись-подсказка, чтобы зона читалась.
  const adoptZone = decorZone('shelter', 'adopt', ctx.roomW, ctx.roomH);
  if (adoptZone) {
    const tag = label('🤝 в добрые руки', 13, COLORS.ink, '800');
    const pillBg = new Graphics();
    const pw = tag.width + 18;
    pillBg.roundRect(-pw / 2, -14, pw, 26, 13).fill({ color: COLORS.hud, alpha: 0.9 });
    pillBg.roundRect(-pw / 2, -14, pw, 26, 13).stroke({ width: 2, color: COLORS.cardEdge });
    const badge = new Container();
    badge.addChild(pillBg, tag);
    badge.position.set(adoptZone.x + adoptZone.width / 2, adoptZone.y - 6);
    shell.container.addChild(badge);
  }

  // Лабораторный слот — плейсхолдер-станция у левой стены (спрайт будет позже).
  // Перетащил кота сюда → подтверждение сдачи «на эксперименты» за 🧬 (sendToLab).
  // Станция открывается уровнем лаборатории (labStation) — до этого показываем замок.
  const labW = ctx.roomW * 0.15;
  const labH = labW * 0.95;
  const labCx = ctx.roomW * 0.13;
  const labCy = ctx.roomH * 0.86; // низ-центр (как у переноски)
  const labZone = new Rectangle(labCx - labW / 2, labCy - labH, labW, labH);
  // Слой станции пересобираем в refresh() — замок должен сняться, когда игрок дорастёт
  // до нужного уровня (уровень меняется по ходу игры, комната при этом не пересоздаётся).
  const labLayer = new Container();
  shell.container.addChild(labLayer);

  function refreshLabStation(): void {
    labLayer.removeChildren();
    const unlocked = isUnlocked(ctx.state, 'labStation');
    const box = new Graphics();
    // короб-станция (заглушка): скруглённый бокс + «столешница»
    box.roundRect(labZone.x, labZone.y, labW, labH, 14)
      .fill({ color: unlocked ? 0x2f7d78 : 0x6b7370, alpha: unlocked ? 0.85 : 0.6 })
      .stroke({ width: 3, color: unlocked ? 0x1f5c58 : 0x4a504e });
    box.roundRect(labZone.x + labW * 0.12, labZone.y + labH * 0.16, labW * 0.76, labH * 0.4, 8)
      .fill({ color: 0xbfeae6, alpha: unlocked ? 0.55 : 0.3 });
    const flask = label(unlocked ? '🧪' : '🔒', labW * 0.42, COLORS.ink, '700');
    flask.position.set(labCx, labZone.y + labH * 0.56);
    const tag = label(unlocked ? '🧬 в лабораторию' : `Откроется на ур. ${unlockLevelOf('labStation')}`,
      13, COLORS.ink, '800');
    const pillBg = new Graphics();
    const pw = tag.width + 18;
    pillBg.roundRect(-pw / 2, -14, pw, 26, 13).fill({ color: COLORS.hud, alpha: 0.9 });
    pillBg.roundRect(-pw / 2, -14, pw, 26, 13).stroke({ width: 2, color: COLORS.cardEdge });
    const badge = new Container();
    badge.addChild(pillBg, tag);
    badge.position.set(labCx, labZone.y - 8);
    labLayer.addChild(box, flask, badge);
  }

  // Массовые кнопки вверху справа: «Раздать всех» / «В лабораторию всех» — по
  // суммарной цене (shelterTotals). Пересобираются в refresh() (суммы/замок/пусто
  // меняются по ходу игры). Открывают диалог-подтверждение (bulk-действие в ядре).
  const bulkLayer = new Container();
  shell.container.addChild(bulkLayer);

  function refreshBulkButtons(): void {
    bulkLayer.removeChildren();
    const totals = shelterTotals(ctx.state);
    const labOpen = isUnlocked(ctx.state, 'labStation');

    const BW = 176, BH = 44, GAP = 10, RPAD = 18;
    const cy = ctx.topInset + 8 + 22;              // центр по титульной плашке комнаты
    const rightCx = ctx.roomW - RPAD - BW / 2;
    const leftCx = rightCx - BW - GAP;

    const adoptBtn = new Button({
      text: `🤝 Раздать всех\n💰${totals.adopt.coins}  🧬${totals.adopt.dna}`,
      w: BW, h: BH, color: COLORS.good, fontSize: 12.5,
    });
    adoptBtn.position.set(leftCx, cy);
    adoptBtn.enabled = totals.count > 0;
    adoptBtn.onTap = () => ctx.openBulkAdoptConfirm();

    const labBtn = new Button({
      text: labOpen
        ? `🧪 В лабораторию всех\n🧬${totals.lab.dna}${totals.lab.coins > 0 ? `  💰${totals.lab.coins}` : ''}`
        : `🧪 В лабораторию всех\n🔒 с ур. ${unlockLevelOf('labStation')}`,
      w: BW, h: BH, color: COLORS.dna, fontSize: 12.5,
    });
    labBtn.position.set(rightCx, cy);
    labBtn.enabled = labOpen && totals.count > 0;
    labBtn.onTap = () => ctx.openBulkLabConfirm();

    bulkLayer.addChild(adoptBtn, labBtn);
  }

  // --- Стойка заказов: кнопка 📋 у названия комнаты + корзина под ней ---
  // Кнопка ведёт на доску заказов и показывает таймер до её смены (московская
  // полночь). Корзина — drag-цель: положенный кот и есть «предъявленный клиенту»,
  // только им можно закрыть заказ. Слой пересобирается в refresh() (состав доски,
  // кот в корзине), а таймер тикает отдельно в tick() — без пересборки сцены.
  const ordersLayer = new Container();
  shell.container.addChild(ordersLayer);
  const BASKET_W = 104, BASKET_H = 96;
  let basketZone = new Rectangle(0, 0, 0, 0);
  let ordersBtn: Button | null = null;

  function refreshOrdersDesk(titleW: number): void {
    ordersLayer.removeChildren();
    const BW = 168, BH = 44;
    const cx = 18 + titleW + 10 + BW / 2;      // сразу справа от плашки названия
    const cy = ctx.topInset + 8 + 22;
    const doneCount = ctx.state.orders.filter((o) => o.done).length;

    const btn = new Button({ text: '📋 Заказы', w: BW, h: BH, color: COLORS.warn, textColor: COLORS.ink, fontSize: 13 });
    btn.position.set(cx, cy);
    btn.onTap = () => ctx.openOrders();
    ordersBtn = btn;
    ordersLayer.addChild(btn);
    updateOrdersBtn(doneCount);

    // Корзина — «небольшая зона» ровно под кнопкой. Кот в ней рисуется прямо тут,
    // поэтому визуально понятно, кого именно предъявим клиенту.
    const bx = cx - BASKET_W / 2;
    const by = cy + BH / 2 + 10;
    basketZone = new Rectangle(bx, by, BASKET_W, BASKET_H);
    const cat = basketCat(ctx.state);
    // подсветка, когда кот в корзине подходит хоть под один невыполненный заказ
    const fits = !!cat && ctx.state.orders.some((o) => !o.done && matchesOrder(o, cat));

    const box = new Graphics();
    box.roundRect(bx, by, BASKET_W, BASKET_H, 14)
      .fill({ color: cat ? 0xfff3d9 : 0xffffff, alpha: cat ? 0.95 : 0.7 })
      .stroke({ width: fits ? 3 : 2, color: fits ? COLORS.good : COLORS.cardEdge });
    ordersLayer.addChild(box);

    if (cat) {
      const sp = new Sprite(ctx.catTexture(cat));
      const k = Math.min((BASKET_W - 18) / sp.texture.width, (BASKET_H - 26) / sp.texture.height);
      sp.scale.set(k);
      sp.anchor.set(0.5, 1);
      sp.position.set(bx + BASKET_W / 2, by + BASKET_H - 6);
      ordersLayer.addChild(sp);
      // тонкая рамка на фоне комнаты читается плохо — статус подписываем словами
      const badge = label(fits ? '✓ подходит' : 'не подходит', 11, COLORS.ink, '800');
      badge.anchor.set(0.5, 0);
      const pill = new Graphics();
      const pw = badge.width + 14;
      pill.roundRect(bx + BASKET_W / 2 - pw / 2, by + BASKET_H - 2, pw, 20, 10)
        .fill({ color: fits ? COLORS.good : COLORS.cardEdge, alpha: 0.95 });
      badge.position.set(bx + BASKET_W / 2, by + BASKET_H + 1);
      ordersLayer.addChild(pill, badge);
    } else {
      const hint = label('🧺\nкорзина\nзаказов', 11.5, COLORS.inkSoft, '700');
      hint.anchor.set(0.5);
      hint.position.set(bx + BASKET_W / 2, by + BASKET_H / 2);
      ordersLayer.addChild(hint);
    }

    // тап по корзине: с котом — вынуть обратно на пол, пустая — подсказка
    box.eventMode = 'static';
    box.cursor = cat ? 'pointer' : 'default';
    box.on('pointertap', () => {
      if (!basketCat(ctx.state)) { ctx.toast('Перетащи сюда кота — и открой 📋 Заказы'); return; }
      clearOrderBasket(ctx.state);
      ctx.commit();
      ctx.toast('Котик вернулся на пол 🐾');
    });
  }

  /** Подпись кнопки: сколько заказов ещё открыто + остаток до смены доски. */
  function updateOrdersBtn(doneCount: number): void {
    const total = ctx.state.orders.length;
    ordersBtn?.setText(`📋 Заказы ${total - doneCount}/${total}\n⏳ ${fmtLeft(msUntilOrdersReset(ctx.now()))}`);
  }

  const floorLayer = new Container();
  shell.container.addChild(floorLayer);

  const floor = createLivingFloor(
    ctx, floorLayer,
    floorPlane(ctx.roomW, ctx.roomH, ctx.topInset),
    // на полу не показываем тех, кто стоит в слоте вязки (физически в инкубаторе)
    // и кто сидит в корзине заказов (его рисует сама корзина)
    () => catsIn(ctx.state, 'shelter')
      .filter((c) => !isInSlot(ctx.state, c.id) && !isInBasket(ctx.state, c.id)),
  );

  /**
   * Уронили кота на корзину → предъявим его клиентам; на лабораторию → сдача за 🧬;
   * на переноску → пристройство; иначе переезд.
   */
  function tryDropCat(cat: Cat, gx: number, gy: number): boolean {
    // gx/gy — координаты виртуальной сцены; зоны — в локальных координатах комнаты
    const lp = shell.container.toLocal({ x: gx, y: gy }, ctx.uiRoot);
    if (basketZone.contains(lp.x, lp.y)) {
      const r = putCatInBasket(ctx.state, cat.id);
      if (!r.ok) { ctx.toast(r.reason); return false; }
      ctx.commit();
      const fits = ctx.state.orders.some((o) => !o.done && matchesOrder(o, cat));
      ctx.toast(fits ? 'Котик в корзине — открой 📋 Заказы 🧺' : 'Котик в корзине, но под сегодняшние заказы не подходит 🧺');
      return true;
    }
    if (labZone.contains(lp.x, lp.y)) {
      if (!isUnlocked(ctx.state, 'labStation')) {
        ctx.toast(`Лаборатория откроется на ур. ${unlockLevelOf('labStation')} 🔒`);
        return false;             // заперто → кот вернётся на своё место
      }
      ctx.commit();               // grab-спрайт уже уничтожен — вернём наземного кота на пол
      ctx.openLabConfirm(cat);     // «Сдать в лабораторию?» (Да → sendToLab)
      return true;
    }
    const zone = decorZone('shelter', 'adopt', ctx.roomW, ctx.roomH);
    if (zone && zone.contains(lp.x, lp.y)) {
      ctx.commit();
      ctx.openAdoptConfirm(cat);   // «Отдать котика в добрые руки?» (Да → adoptCat)
      return true;
    }
    return false;
  }

  function refresh(): void {
    shell.body.removeChildren();
    // на полу — без тех, кто сейчас стоит в слоте инкубатора (они «в отъезде»)
    const present = catsIn(ctx.state, 'shelter').filter((c) => !isInSlot(ctx.state, c.id));
    const cap = shelterCapacity(ctx.state);
    // вместимость комнаты — счётчиком справа в плашке названия; плашка при этом
    // расширяется, поэтому кнопку заказов ставим по её ИТОГОВОЙ ширине
    const titleW = shell.setTitleBadge(`🐱 ${present.length}/${cap}`);

    refreshLabStation(); // замок станции снимается, когда уровень дорастает
    refreshBulkButtons(); // суммы/замок/доступность кнопок «…всех»
    refreshOrdersDesk(titleW); // доска заказов: кнопка с таймером + корзина
    floor.refresh();
  }

  // Таймер до смены доски тикает раз в секунду — пересобирать сцену ради него не нужно.
  let tickAcc = 0;
  function tick(dt: number): void {
    floor.tick(dt);
    tickAcc += dt;
    if (tickAcc >= 1) {
      tickAcc = 0;
      updateOrdersBtn(ctx.state.orders.filter((o) => o.done).length);
    }
  }

  return {
    id: 'shelter', title: '🏠 Приют', container: shell.container,
    refresh, tick, tryDropCat,
  };
}
