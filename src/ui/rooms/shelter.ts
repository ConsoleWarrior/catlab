/**
 * Комната «Приют»: котики-метисы ХОДЯТ по полу и ждут, пока их пристроят
 * «в добрые руки» (переноска у двери) или сдадут в лабораторию за 🧬
 * (лабораторный слот). Тап по котику → меню. Улучшения — в оверлее ⚙️.
 *
 * Стойка заказов (кнопка 📋 + корзина) отсюда ПЕРЕЕХАЛА в Питомник (rooms/nursery.ts):
 * заказы просят ценных котов, а живут они там. Кот, лежащий в корзине, здесь всё
 * равно не гуляет по полу (старые сейвы) — его рисует корзина в Питомнике.
 */

import { Container, Graphics } from 'pixi.js';
import {
  catsIn, shelterCapacity, roomCount, buyCat, buyCatCost, isRescuePair, isInSlot, isUnlocked, shelterTotals,
  isInBasket,
} from '../../game/index.js';
import type { Cat } from '../../game/index.js';
import type { Room, UiContext } from '../context.js';
import { roomShell, floorPlane, cornerStation, stationBadge, shelfPlane, buildShelf } from './shell.js';
import { Button, COLORS, label } from '../theme.js';
import { createLivingFloor, TOY_Z, type ToyTarget } from '../livingFloor.js';
import { decorPoint, decorTexture } from '../decorArt.js';
import { createHangingToy, type HangingToy } from '../hangingToy.js';
import { sfxEvent, sfxMeow } from '../sound.js';
import { t } from '../../i18n.js';

// Кошачий комплекс — единственный декор Приюта, к которому что-то подвешено.
const TOWER = 'tower3_seed1002';

/**
 * Подвесные игрушки комплекса. Помпон на витой верёвке и шарик на нитке
 * вырезаны из спрайта комплекса в свои текстуры (scripts/cut_toy.py) и качаются
 * как маятники (ui/hangingToy.ts).
 *
 * mount — пиксель ТЕКСТУРЫ КОМПЛЕКСА, где игрушка привязана (по нему decorPoint
 * находит точку подвеса в комнате при любой пропорции экрана); pivot/ball —
 * пиксели уже СВОЕЙ текстуры игрушки. Числа те же, что в scripts/cut_toy.py.
 *
 * Лапой коты гоняют обе: до какой дотянется конкретный кот, решает уже «живой
 * пол» по его росту (на телефоне сцена крупнее, и коты достают до верхнего
 * шарика тоже). `stand: true` — игрушка, под которую коты подходят вставать.
 */
const SHELTER_TOYS = [
  { sprite: 'toy_pom', mount: [467, 352], pivot: [25, 2], ball: [30, 300], ballR: 24, period: 1.15, stand: true },
  { sprite: 'toy_bead', mount: [485, 340], pivot: [14, 2], ball: [20, 107], ballR: 18, period: 0.72, stand: false },
] as const;

// Правая колонка шапки приюта: пара массовых кнопок и «Купить котика» под ними.
// Ширина колонки нужна и раскладке кнопок, и подсказке обучения (Room.topReserve).
const BULK_BW = 176;
const BULK_GAP = 10;
const BULK_RPAD = 18;
const BULK_COL_W = BULK_BW * 2 + BULK_GAP + BULK_RPAD;

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

    const BW = BULK_BW, BH = 44, GAP = BULK_GAP, RPAD = BULK_RPAD;
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
        sfxEvent('buy'); // звон монет — как и на всякой другой покупке
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
  const tower = shell.decor.getChildByLabel(TOWER);
  shell.decor.addChildAt(shelfCatLayer,
    tower ? shell.decor.getChildIndex(tower) : shell.decor.children.length);

  // Подвесные игрушки комплекса. Живут в слое пола (а не в декоре), глубина —
  // чуть ближе зрителя, чем место играющего кота: мячик висит ровно на уровне
  // кошачьей головы, и за спинами игроков его было бы не видно. Коты, идущие
  // ещё ближе к зрителю, рисуются поверх — но до этой высоты они не достают.
  const toyDepth = plane.yNear + (plane.yFar - plane.yNear) * (TOY_Z - 0.06);
  // Слой хит-зон игрушек — ПОВЕРХ котов (floorLayer): кружок тапа по мячику
  // должен выигрывать у кота, который стоит ближе к зрителю и накрывает мячик
  // своим прямоугольником (вместе с подписью над головой). Сами спрайты игрушек
  // при этом остаются в слое пола, по глубине.
  const toyTapLayer = new Container();
  const toys: HangingToy[] = [];
  const toyTargets: ToyTarget[] = [];
  let toyOx: number | null = null;
  for (const spec of SHELTER_TOYS) {
    const tex = decorTexture(spec.sprite);
    const at = decorPoint('shelter', TOWER, spec.mount[0], spec.mount[1], ctx.roomW, ctx.roomH);
    if (!tex || !at) continue; // текстуру не подгрузили — игрушки просто нет
    const toy = createHangingToy({
      tex,
      pivotX: spec.pivot[0], pivotY: spec.pivot[1],
      ballX: spec.ball[0], ballY: spec.ball[1], ballR: spec.ballR,
      period: spec.period,
      minHitR: ctx.roomH * 0.038, // мелкий мячик — палец крупнее, зону расширяем
    }, at.x, at.y, at.scale);
    toy.view.zIndex = Math.round(toyDepth);
    floorLayer.addChild(toy.view);
    toyTapLayer.addChild(toy.hitView);
    toys.push(toy);
    // обе игрушки — цели для лап; «живой пол» сам решит, до какой кот дотянется
    toyTargets.push({ ballAt: () => toy.ballAt(), hit: (dir, power) => toy.push(dir, power) });
    if (spec.stand) toyOx = toy.ballAt().x - plane.centerX; // мячик в покое — сюда и идут
  }

  shell.container.addChild(toyTapLayer); // после floorLayer — значит, поверх котов

  const floor = createLivingFloor(
    ctx, floorLayer,
    plane,
    // на полу не показываем тех, кто стоит в слоте вязки (физически в инкубаторе)
    // и кто сидит в корзине заказов (его рисует сама корзина)
    () => catsIn(ctx.state, 'shelter')
      .filter((c) => !isInSlot(ctx.state, c.id) && !isInBasket(ctx.state, c.id)),
    { plane: shelf, layer: shelfCatLayer },
    toyOx === null ? undefined : { ox: toyOx, targets: toyTargets },
  );

  // Тап по мячику: он улетает от пальца, а пара ближайших котов бросает свои
  // дела и идёт играть — вокруг игрушки собирается компания.
  for (const toy of toys) {
    toy.onTap = () => { if (floor.callToToy(2) > 0) sfxMeow(); };
  }

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
   * Уронили кота на лабораторию → сдача за 🧬; на переноску → пристройство;
   * иначе переезд. (Корзина заказов уехала в Питомник — здесь её зоны нет.)
   */
  function tryDropCat(cat: Cat, gx: number, gy: number): boolean {
    // gx/gy — координаты виртуальной сцены; зоны — в локальных координатах комнаты
    const lp = shell.container.toLocal({ x: gx, y: gy }, ctx.uiRoot);
    if (labZone.contains(lp.x, lp.y)) {
      if (!ctx.tutorAllows('lab')) return false; // обучение ведёт только на станцию 🤝
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
      if (!ctx.tutorAllows('adopt')) return false; // обучение: пристройство — свой шаг
      ctx.commit();
      standByStation(cat, 'right'); // откажешься отдавать — кот остаётся у переноски
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
    // вместимость комнаты — счётчиком справа в плашке названия
    shell.setTitleBadge(`🐱 ${present.length}/${cap}`);

    refreshLabStation(); // замок станции снимается, когда уровень дорастает
    refreshAdoptStation(); // станция пристройства (правый угол) — всегда открыта
    refreshBulkButtons(); // суммы/замок/доступность кнопок «…всех»
    floor.refresh();
  }

  function tick(dt: number): void {
    floor.tick(dt);
    for (const toy of toys) toy.tick(dt);
  }

  return {
    id: 'shelter', title: t('🏠 Приют', '🏠 Shelter'), container: shell.container,
    refresh, tick, tryDropCat,
    /**
     * Якоря подсветки обучения (см. ui/tutorial.ts): `cat:<id>` — котик на полу,
     * 'adopt' — станция «в добрые руки» в правом углу.
     * Узлы отдаём живыми: комната пересобирается, а кот на полу ещё и ходит.
     */
    anchor: (key) => {
      if (key.startsWith('cat:')) return floor.nodeOf(key.slice(4));
      if (key === 'adopt') return adoptLayer.children.length > 0 ? adoptLayer : null;
      return null;
    },
    // Справа вверху — массовые кнопки и «Купить котика» (см. refreshBulkButtons):
    // подсказка обучения обязана встать левее, а не поверх них (п. 1.10.3).
    topReserve: { left: 0, right: BULK_COL_W },
  };
}
