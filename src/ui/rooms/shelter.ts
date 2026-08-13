/**
 * Комната «Приют»: котики-метисы ХОДЯТ по полу и ждут, пока их пристроят
 * «в добрые руки» (переноска у двери) или сдадут в лабораторию за 🧬
 * (лабораторный слот). Тап по котику → меню. Улучшения — в оверлее ⚙️.
 *
 * Здесь же стойка заказов: кнопка 📋 у названия комнаты (со счётчиком заказов и
 * остатком до авто-смены ближайшего) и зона-корзина под ней — заказ можно закрыть
 * ТОЛЬКО котом, положенным в корзину (см. actions.claimOrder).
 */

import { Container, Graphics, Rectangle, Sprite } from 'pixi.js';
import {
  catsIn, shelterCapacity, roomCount, buyCat, buyCatCost, isRescuePair, isInSlot, isUnlocked, shelterTotals,
  isInBasket, basketCat, putCatInBasket, clearOrderBasket, msUntilOrderExpiry, matchesOrder,
} from '../../game/index.js';
import type { Cat } from '../../game/index.js';
import type { Room, UiContext } from '../context.js';
import { roomShell, floorPlane, cornerStation, stationBadge, shelfPlane, buildShelf } from './shell.js';
import { Button, COLORS, label } from '../theme.js';
import { createLivingFloor, rememberFloorPos } from '../livingFloor.js';
import { catArtTexture } from '../catTextures.js';
import { t } from '../../i18n.js';

/** Остаток до авто-смены ближайшего заказа «Ч:ММ» — подпись на кнопке доски (таймер ≤ 6 ч). */
function fmtLeft(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 60_000));
  const h = Math.floor(total / 60);
  return `${h}:${String(total % 60).padStart(2, '0')}`;
}

export function createShelter(ctx: UiContext): Room {
  const shell = roomShell(ctx, 'shelter', t('🏠 Приют', '🏠 Shelter'));

  // Две drag-станции по нижним углам (общий образец cornerStation — короб жмётся в
  // угол с отступом ≈ полосе навигации, как ветеринар/криокапсула в Питомнике):
  // лаборатория «на эксперименты» в ЛЕВОМ углу, пристройство «в добрые руки» в ПРАВОМ.
  // Перетащил кота на станцию → соответствующий диалог (см. tryDropCat).

  // Лаборатория — левый нижний угол. Перетащил кота → сдача «на эксперименты» за 🧬
  // (sendToLab). Станция открывается ПОКУПКОЙ узла «На эксперименты» (Генолаб →
  // Улучшения → Лаборатория) — до этого замок. Слой пересобираем в refresh() (замок
  // должен сняться, когда игрок дорастёт до нужного уровня, без пересоздания комнаты).
  const labZone = cornerStation(ctx.roomW, ctx.roomH, 'left');
  const labCx = labZone.x + labZone.width / 2;
  const labLayer = new Container();
  shell.container.addChild(labLayer);

  function refreshLabStation(): void {
    labLayer.removeChildren();
    const unlocked = isUnlocked(ctx.state, 'labStation');
    const { x, y, width: sw, height: sh } = labZone;
    const box = new Graphics();
    // короб-станция (заглушка): скруглённый бокс + «столешница»
    box.roundRect(x, y, sw, sh, 14)
      .fill({ color: unlocked ? 0x2f7d78 : 0x6b7370, alpha: unlocked ? 0.85 : 0.6 })
      .stroke({ width: 3, color: unlocked ? 0x1f5c58 : 0x4a504e });
    box.roundRect(x + sw * 0.12, y + sh * 0.16, sw * 0.76, sh * 0.4, 8)
      .fill({ color: 0xbfeae6, alpha: unlocked ? 0.55 : 0.3 });
    const flask = label(unlocked ? '🧪' : '🔒', sw * 0.42, COLORS.ink, '700');
    flask.position.set(labCx, y + sh * 0.56);
    const badge = stationBadge(labCx, y, unlocked ? t('🧪 в биобанк', '🧪 to the biobank') : t('🔒 открой в Генолабе', '🔒 unlock in the Genolab'));
    labLayer.addChild(box, flask, badge);
  }

  // Пристройство «в добрые руки» — правый нижний угол (заменила переноску-декор).
  // Всегда открыта: пристройство доступно с начала игры. Перетащил кота → диалог
  // «Отдать котика в добрые руки?» (см. tryDropCat → openAdoptConfirm).
  const adoptZone = cornerStation(ctx.roomW, ctx.roomH, 'right');
  const adoptCx = adoptZone.x + adoptZone.width / 2;
  const adoptLayer = new Container();
  shell.container.addChild(adoptLayer);

  function refreshAdoptStation(): void {
    adoptLayer.removeChildren();
    const { x, y, width: sw, height: sh } = adoptZone;
    const box = new Graphics();
    // тёплый короб-станция + светлая «столешница» (в тон награды 💰)
    box.roundRect(x, y, sw, sh, 14)
      .fill({ color: 0xf1c76b, alpha: 0.9 })
      .stroke({ width: 3, color: 0xc8912f });
    box.roundRect(x + sw * 0.12, y + sh * 0.16, sw * 0.76, sh * 0.4, 8)
      .fill({ color: 0xfff3d9, alpha: 0.7 });
    const icon = label('🤝', sw * 0.42, COLORS.ink, '700');
    icon.position.set(adoptCx, y + sh * 0.56);
    const badge = stationBadge(adoptCx, y, t('🤝 в добрые руки', '🤝 give away'));
    adoptLayer.addChild(box, icon, badge);
  }

  // Кнопки-действия над населением приюта, вверху справа: покупка кота сюда (широкая
  // кнопка) + под ней массовые «Раздать всех» / «В лабораторию всех» по суммарной
  // цене (shelterTotals). Пересобираются в refresh() (цена/суммы/замок/вместимость
  // меняются по ходу игры). Массовые открывают диалог-подтверждение (bulk в ядре),
  // покупка сразу добавляет кота на пол приюта с бейджем «новый» (buyCat).
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

    // «Купить котика» — под массовыми кнопками, во всю ширину пары. Покупной кот
    // (простой дворовый) появляется на полу приюта; первый — бесплатно, если котов нет.
    // Если при этом нет и денег — выдаётся сразу пара ♀+♂ (анти-софт-лок).
    const cost = buyCatCost(ctx.state);
    const pair = isRescuePair(ctx.state);
    const full = roomCount(ctx.state, 'shelter') + (pair ? 2 : 1) > shelterCapacity(ctx.state);
    const buyBtn = new Button({
      text: cost === 0
        ? (pair ? t('🎁 Пара котиков (бесплатно)', '🎁 A pair of cats (free)') : t('🛒 Котик (бесплатно)', '🛒 A cat (free)'))
        : t(`🛒 Купить котика (${cost} 💰)`, `🛒 Buy a cat (${cost} 💰)`),
      w: BW * 2 + GAP, h: 38, color: COLORS.good, fontSize: 14,
    });
    buyBtn.position.set(rightCx - (BW + GAP) / 2, cy + BH / 2 + 8 + 19);
    buyBtn.enabled = !full && ctx.state.coins >= cost;
    buyBtn.onTap = () => {
      const r = buyCat(ctx.state, ctx.rng, ctx.now());
      if (r.ok) {
        ctx.commit();
        ctx.toast(r.cats.length > 1 ? t('Приют подарил пару: ♀ и ♂ 🐱🐱', 'The shelter gave you a pair: ♀ and ♂ 🐱🐱') : t('Новый котик в приюте 🐱', 'A new cat is in the shelter 🐱'));
      }
      else ctx.toast(r.reason);
    };

    const adoptSum = `💰${totals.adopt.coins}  🧬${totals.adopt.dna}`;
    const adoptBtn = new Button({
      text: t(`🤝 Раздать всех\n${adoptSum}`, `🤝 Give all away\n${adoptSum}`),
      w: BW, h: BH, color: COLORS.good, fontSize: 12.5,
    });
    adoptBtn.position.set(leftCx, cy);
    adoptBtn.enabled = totals.count > 0;
    adoptBtn.onTap = () => ctx.openBulkAdoptConfirm();

    const labSum = `🧬${totals.lab.dna}${totals.lab.coins > 0 ? `  💰${totals.lab.coins}` : ''}`;
    const labBtn = new Button({
      text: labOpen
        ? t(`🧪 Всех в биобанк\n${labSum}`, `🧪 All to the biobank\n${labSum}`)
        : t('🧪 Всех в биобанк\n🔒 открой в Генолабе', '🧪 All to the biobank\n🔒 unlock in the Genolab'),
      w: BW, h: BH, color: COLORS.dna, fontSize: 12.5,
    });
    labBtn.position.set(rightCx, cy);
    labBtn.enabled = labOpen && totals.count > 0;
    labBtn.onTap = () => ctx.openBulkLabConfirm();

    bulkLayer.addChild(buyBtn, adoptBtn, labBtn);
  }

  // --- Стойка заказов: кнопка 📋 у названия комнаты + корзина под ней ---
  // Кнопка ведёт на доску заказов и показывает таймер до её смены (московская
  // полночь). Корзина — drag-цель: положенный кот и есть «предъявленный клиенту»,
  // только им можно закрыть заказ. Слой пересобирается в refresh() (состав доски,
  // кот в корзине), а таймер тикает отдельно в tick() — без пересборки сцены.
  const ordersLayer = new Container();
  shell.container.addChild(ordersLayer);
  // корзина — во всю ширину кнопки «📋 Заказы» (выровнена ровно под ней),
  // повыше прежней — кот в ней читается крупно
  const ORDERS_BW = 168, ORDERS_BH = 44;
  const BASKET_W = ORDERS_BW, BASKET_H = 140;
  let basketZone = new Rectangle(0, 0, 0, 0);
  let ordersBtn: Button | null = null;

  function refreshOrdersDesk(titleW: number): void {
    ordersLayer.removeChildren();
    const BW = ORDERS_BW, BH = ORDERS_BH;
    const cx = 18 + titleW + 10 + BW / 2;      // сразу справа от плашки названия
    const cy = ctx.topInset + 8 + 22;

    const btn = new Button({ text: t('📋 Заказы', '📋 Orders'), w: BW, h: BH, color: COLORS.warn, textColor: COLORS.ink, fontSize: 13 });
    btn.position.set(cx, cy);
    btn.onTap = () => ctx.openOrders();
    ordersBtn = btn;
    ordersLayer.addChild(btn);
    updateOrdersBtn();

    // Корзина — зона во всю ширину кнопки ровно под ней. Кот в ней рисуется прямо
    // тут (крупно), поэтому визуально понятно, кого именно предъявим клиенту.
    const bx = cx - BASKET_W / 2;
    const by = cy + BH / 2 + 10;
    basketZone = new Rectangle(bx, by, BASKET_W, BASKET_H);
    const cat = basketCat(ctx.state);
    // подсветка, когда кот в корзине подходит хоть под один заказ на доске
    const fits = !!cat && ctx.state.orders.some((o) => matchesOrder(o, cat));

    const box = new Graphics();
    box.roundRect(bx, by, BASKET_W, BASKET_H, 14)
      .fill({ color: cat ? 0xfff3d9 : 0xffffff, alpha: cat ? 0.95 : 0.7 })
      .stroke({ width: fits ? 3 : 2, color: fits ? COLORS.good : COLORS.cardEdge });
    ordersLayer.addChild(box);

    // вынуть кота из корзины обратно на пол (тап по корзине/коту)
    const takeOut = (): void => {
      if (!basketCat(ctx.state)) { ctx.toast(t('Перетащи сюда кота — и открой 📋 Заказы', 'Drag a cat here — then open 📋 Orders')); return; }
      clearOrderBasket(ctx.state);
      ctx.commit();
      ctx.toast(t('Котик вернулся на пол 🐾', 'The cat is back on the floor 🐾'));
    };

    if (cat) {
      // арт-спрайт коллекции (тот же вариант, что кот показывает на полу), фолбэк — процедурный
      const sp = new Sprite(catArtTexture(cat) ?? ctx.catTexture(cat));
      const k = Math.min((BASKET_W - 22) / sp.texture.width, (BASKET_H - 30) / sp.texture.height);
      sp.scale.set(k);
      sp.anchor.set(0.5, 1);
      sp.position.set(bx + BASKET_W / 2, by + BASKET_H - 8);
      // тонкая рамка на фоне комнаты читается плохо — статус подписываем словами
      const badge = label(fits ? t('✓ подходит', '✓ matches') : t('не подходит', 'does not match'), 12, COLORS.ink, '800');
      badge.anchor.set(0.5, 0);
      const pill = new Graphics();
      const pw = badge.width + 14;
      pill.roundRect(bx + BASKET_W / 2 - pw / 2, by + BASKET_H - 2, pw, 20, 10)
        .fill({ color: fits ? COLORS.good : COLORS.cardEdge, alpha: 0.95 });
      badge.position.set(bx + BASKET_W / 2, by + BASKET_H + 1);
      ordersLayer.addChild(sp, pill, badge);

      // кота можно не только тапнуть (вынуть на пол), но и взять за шкирку —
      // утащить на пол в нужную точку или сразу на станцию (см. tryDropCat)
      sp.eventMode = 'static';
      sp.cursor = 'grab';
      sp.on('pointerdown', (e) => ctx.startGrab({
        cat,
        displayH: sp.texture.height * k, // «на весу» — того же размера, что в корзине
        hide: () => { sp.visible = false; pill.visible = false; badge.visible = false; },
        show: () => { sp.visible = true; pill.visible = true; badge.visible = true; },
        onTap: takeOut,
        onDrop: () => { /* никуда не пристроили — кот остаётся в корзине (show вернул) */ },
      }, e));
    } else {
      const hint = label(t('🧺\nкорзина\nзаказов', '🧺\norder\nbasket'), 13, COLORS.inkSoft, '700');
      hint.anchor.set(0.5);
      hint.position.set(bx + BASKET_W / 2, by + BASKET_H / 2);
      ordersLayer.addChild(hint);
    }

    // тап по корзине: с котом — вынуть обратно на пол, пустая — подсказка
    box.eventMode = 'static';
    box.cursor = cat ? 'pointer' : 'default';
    box.on('pointertap', takeOut);
  }

  /** Подпись кнопки: число заказов + остаток до авто-смены ближайшего (все слоты активны). */
  function updateOrdersBtn(): void {
    const orders = ctx.state.orders;
    const total = orders.length;
    if (total === 0) { ordersBtn?.setText(t('📋 Заказы 0', '📋 Orders 0')); return; }
    const soonest = Math.min(...orders.map((o) => msUntilOrderExpiry(o, ctx.now())));
    ordersBtn?.setText(t(`📋 Заказы ${total}\n⏳ ${fmtLeft(soonest)}`, `📋 Orders ${total}\n⏳ ${fmtLeft(soonest)}`));
  }

  const floorLayer = new Container();
  shell.container.addChild(floorLayer);

  const plane = floorPlane(ctx.roomW, ctx.roomH, ctx.topInset);

  // Настенная полка под окнами: доска уходит ЗА кошачий комплекс (он стоит перед
  // стеной), поэтому и сама доска, и коты на ней живут внутри слоя декора —
  // доска в самом низу, коты прямо ПОД спрайтом комплекса. Иначе кот, идущий по
  // доске мимо комплекса, пролетал бы перед его стойками.
  const shelf = shelfPlane(ctx.roomW, ctx.roomH, plane);
  const shelfCatLayer = new Container();
  shell.decor.addChildAt(buildShelf(shelf), 0);
  const tower = shell.decor.getChildByLabel('tower3_seed1002');
  shell.decor.addChildAt(shelfCatLayer,
    tower ? shell.decor.getChildIndex(tower) : shell.decor.children.length);

  const floor = createLivingFloor(
    ctx, floorLayer,
    plane,
    // на полу не показываем тех, кто стоит в слоте вязки (физически в инкубаторе)
    // и кто сидит в корзине заказов (его рисует сама корзина)
    () => catsIn(ctx.state, 'shelter')
      .filter((c) => !isInSlot(ctx.state, c.id) && !isInBasket(ctx.state, c.id)),
    { plane: shelf, layer: shelfCatLayer },
  );

  /**
   * Поставить кота ВОЗЛЕ станции-короба (сбоку, у ближней кромки пола) и задержать
   * там: диалог станции открывается уже после дропа, и кот должен ждать решения
   * рядом с ней, а не убегать на прежнее место (образец — Питомник).
   */
  function standByStation(cat: Cat, side: 'left' | 'right'): void {
    const zone = side === 'left' ? labZone : adoptZone;
    const gap = plane.catH * 0.42; // полкорпуса кота — короб остаётся не закрыт
    const x = side === 'left' ? zone.x + zone.width + gap : zone.x - gap;
    floor.placeAt(cat.id, x, plane.yNear, 14);
  }

  /**
   * Уронили кота на корзину → предъявим его клиентам; на лабораторию → сдача за 🧬;
   * на переноску → пристройство; иначе переезд.
   */
  function tryDropCat(cat: Cat, gx: number, gy: number): boolean {
    // gx/gy — координаты виртуальной сцены; зоны — в локальных координатах комнаты
    const lp = shell.container.toLocal({ x: gx, y: gy }, ctx.uiRoot);
    const fromBasket = isInBasket(ctx.state, cat.id); // кота тащат ИЗ корзины
    if (basketZone.contains(lp.x, lp.y)) {
      if (fromBasket) return false; // вернули на место — endGrab покажет кота в корзине
      const r = putCatInBasket(ctx.state, cat.id);
      if (!r.ok) { ctx.toast(r.reason); return false; }
      ctx.commit();
      const fits = ctx.state.orders.some((o) => matchesOrder(o, cat));
      ctx.toast(fits ? t('Котик в корзине — открой 📋 Заказы 🧺', 'The cat is in the basket — open 📋 Orders 🧺') : t('Котик в корзине, но под заказы не подходит 🧺', 'The cat is in the basket but matches no order 🧺'));
      return true;
    }
    if (labZone.contains(lp.x, lp.y)) {
      if (!isUnlocked(ctx.state, 'labStation')) {
        ctx.toast(t('Открой станцию «В биобанк» в Генолабе 🔬', 'Unlock the "To the biobank" station in the Genolab 🔬'));
        return false;             // заперто → кот вернётся на своё место
      }
      ctx.commit();               // grab-спрайт уже уничтожен — пол пересобран, кот снова виден
      standByStation(cat, 'left'); // откажешься сдавать — кот остаётся у станции
      ctx.openLabConfirm(cat);     // «Сдать в лабораторию?» (Да → sendToLab)
      return true;
    }
    if (adoptZone.contains(lp.x, lp.y)) {
      ctx.commit();
      standByStation(cat, 'right'); // откажешься отдавать — кот остаётся у переноски
      ctx.openAdoptConfirm(cat);   // «Отдать котика в добрые руки?» (Да → adoptCat)
      return true;
    }
    if (fromBasket) {
      // кота вытащили из корзины перетаскиванием — вынимаем на пол в точку сброса
      // (глубина по Y сброса, как при обычном дропе на «живом полу»)
      const nz = Math.max(0, Math.min(1, (plane.yNear - lp.y) / Math.max(1, plane.yNear - plane.yFar)));
      const half = Math.max(1, plane.nearHalfW + (plane.farHalfW - plane.nearHalfW) * nz);
      rememberFloorPos(cat.id, (lp.x - plane.centerX) / half, nz);
      clearOrderBasket(ctx.state);
      ctx.commit();
      ctx.toast(t('Котик вернулся на пол 🐾', 'The cat is back on the floor 🐾'));
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
    refreshAdoptStation(); // станция пристройства (правый угол) — всегда открыта
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
      updateOrdersBtn();
    }
  }

  return {
    id: 'shelter', title: t('🏠 Приют', '🏠 Shelter'), container: shell.container,
    refresh, tick, tryDropCat,
    /**
     * Якоря подсветки обучения (см. ui/tutorial.ts): `cat:<id>` — котик на полу,
     * 'adopt' — станция «в добрые руки» в правом углу, 'orders' — кнопка 📋.
     * Узлы отдаём живыми: комната пересобирается, а кот на полу ещё и ходит.
     */
    anchor: (key) => {
      if (key.startsWith('cat:')) return floor.nodeOf(key.slice(4));
      if (key === 'adopt') return adoptLayer.children.length > 0 ? adoptLayer : null;
      if (key === 'orders') return ordersBtn && !ordersBtn.destroyed ? ordersBtn : null;
      return null;
    },
  };
}
