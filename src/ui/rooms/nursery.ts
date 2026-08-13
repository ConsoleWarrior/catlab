/**
 * Комната «Питомник»: ценные коты ХОДЯТ по полу (можно взять за шкирку и
 * таскать, тап — меню) и служат племфондом для вязки. У задней стены — ДУГА
 * из 5 пьедесталов ВЫСТАВКИ (центральный выше — подиум победителя): кот на
 * пьедестале — чемпион, приносит пассивный доход (∝ ценности), доход подписан.
 * Пьедесталы заданы в НОРМАЛИЗОВАННЫХ координатах комнаты (та же система, что
 * фон и декор) и живут в y-сортируемом слое декора — на любой пропорции экрана
 * они «приклеены» к стене, а перекрытия с декором корректны по глубине.
 * Перетащил кота в зону НАД пьедесталом (корпус тумбы не ловит — зона подсвечена
 * золотой аурой, пока кот «в руках» над ней) → на выставку; стащил на пол → снял.
 * Чемпион на тумбе моргает и «красуется» — см. ChampAnim/updateChampions ниже.
 * Ветеринар (💉) переехал в Инкубатор — там шприц перетаскивают на кота в слоте вязки.
 * В правом нижнем углу — криокапсула (🧊, drag кота → заморозка в крио-банк).
 * Улучшения — в оверлее ⚙️, чтобы не занимать пол.
 */

import { Container, Graphics, Sprite } from 'pixi.js';
import type { Text } from 'pixi.js';
import {
  catsIn, roomCount, nurseryCapacity, isInSlot, moveCat,
  championSlots, championAt, championIncomePerMin, isChampion,
  setChampion, upgradeCost, upgradeMaxed, buyUpgrade,
  maxChampionsForLevel, nextPedestalUnlockLevel,
  pedestalPlace, placeIncomeMult,
  foodEnabled, foodCap, foodLevel, foodMinutesLeft, isStarving, buyFood, unlockLevelOf,
  foodRatePerMin, feedingCatCount, foodBuyQuote,
  cryoUnlocked,
  FOOD_PACK_UNITS, CHAMPION_SLOTS_BASE, UPGRADES,
} from '../../game/index.js';
import type { Cat } from '../../game/index.js';
import type { Room, UiContext } from '../context.js';
import { roomShell, floorPlane, cornerStation, stationBadge } from './shell.js';
import { decorTexture } from '../decorArt.js';
import { Button, COLORS, label } from '../theme.js';
import { createLivingFloor } from '../livingFloor.js';
import { catSprite, aiSitSpriteFor, rarityGlow, GLOW_OUT } from '../catTextures.js';
import { attachBlink, type Blinker } from '../eyeBlink.js';
import { darken, lighten } from '../../render/palette.js';
import { t } from '../../i18n.js';

// Всегда показываем все 5 пьедесталов (база 1 + до 4 апгрейдов); запертые — с замком.
function pedCountFor(_ctx: UiContext): number {
  return CHAMPION_SLOTS_BASE + UPGRADES.championSlots!.max;
}

// Правая колонка шапки: кормушка (покупка котов переехала в Приют).
const COL_W = 256;

/**
 * Дуга пьедесталов у задней стены — в долях ширины/высоты комнаты (как декор):
 * центральный подиум дальше и ВЫШЕ (место победителя), края ближе к зрителю и
 * ниже. Базы ≤ 0.715·h — гуляющие коты (ноги от 0.72·h, FLOOR_BACK_FRAC) всегда
 * ПЕРЕД пьедесталами, поэтому слой декора можно держать под «живым полом».
 *   xN/baseYN — точка касания пола (низ-центр спрайта); hN — высота тумбы;
 *   tex — ключ текстуры декора (спрайт из assets/decor, фолбэк — Graphics).
 * Порядок в массиве = порядок ПОКУПКИ и индекс слота champions, а НЕ порядок слева
 * направо: тумбы открываются от худшего места к лучшему (PEDESTAL_PLACES: V · IV ·
 * III · II · I), поэтому массив идёт «край слева → край справа → внутренняя слева →
 * внутренняя справа → центральная колонна». На дуге они всё равно стоят по xN.
 */
const PED_ARC = [
  { xN: 0.29, baseYN: 0.715, hN: 0.13, tex: 'ped_side' },    // V место — стартовая
  { xN: 0.71, baseYN: 0.715, hN: 0.13, tex: 'ped_side' },    // IV
  { xN: 0.395, baseYN: 0.703, hN: 0.145, tex: 'ped_side' },  // III
  { xN: 0.605, baseYN: 0.703, hN: 0.145, tex: 'ped_side' },  // II
  { xN: 0.5, baseYN: 0.69, hN: 0.22, tex: 'ped_center' },    // I — колонна победителя
] as const;
// Доля высоты тумбы от верхней кромки спрайта до центра площадки (перспектива
// крышки-эллипса): ноги чемпиона ставим чуть НИЖЕ верха спрайта.
const PED_TOP_INSET = 0.06;
// Места выставки подписываем римскими цифрами (крупно, с обводкой — читаются на мраморе).
const ROMAN = ['I', 'II', 'III', 'IV', 'V'] as const;

/**
 * Чемпион на тумбе не статуя: он моргает (общий eyeBlink, как коты на полу) и
 * «красуется» — дышит, изредка прихорашивается, гордо вытягивается и
 * поворачивается к другой половине зала, а над ним вспыхивает искорка.
 * Ходить ему некуда, поэтому вся анимация — поза (scale/rotation спрайта).
 */
type ChampPose = 'pose' | 'preen' | 'proud';

const CH_TURN_DUR = 0.16;      // с — приседание при повороте к публике
const CH_TURN_SQUASH_Y = 0.05;
const CH_TURN_SQUASH_X = 0.08;
const CH_TURN_CHANCE = 0.35;   // доля смен позы, сопровождаемых поворотом
const CH_PROUD_DUR = 1.2;      // с — «гордая» потяжка вверх
const CH_SPARK_TTL = 1.2;      // с — жизнь искорки над чемпионом

interface ChampSpark { view: Text; life: number; vy: number }

interface ChampAnim {
  node: Container;   // куда сыпать искорки (сам пьедестал)
  sprite: Sprite;
  glow: Sprite;
  blink: Blinker | null;
  baseScale: number; // |scale| спрайта (знак по facing)
  glowAlpha: number;
  standY: number;    // площадка тумбы: ноги чемпиона (спрайт с anchor 0.5,1)
  catSize: number;
  phase: number;
  facing: 1 | -1;
  turnT: number;     // >0 — доигрывается приседание при развороте
  pose: ChampPose;
  poseLeft: number;
  sparkT: number;
  sparks: ChampSpark[];
}

export function createNursery(ctx: UiContext): Room {
  const shell = roomShell(ctx, 'nursery', t('🏆 Питомник', '🏆 Cattery'));
  // живые цифры кормушки: обновляем раз в FEEDER_UPDATE_S, а не каждый кадр
  const FEEDER_UPDATE_S = 0.5;
  let feederUpdate: (() => void) | null = null;
  let feederAcc = 0;
  const floorLayer = new Container();
  shell.container.addChild(floorLayer);
  // Пьедесталы выставки живут в СЛОЕ ДЕКОРА (под «живым полом»): он y-сортируемый,
  // поэтому тумбы, шкафы и тележки перекрываются корректно по «дальше/ближе»,
  // а гуляющие коты (ноги всегда ниже баз дуги) рисуются перед пьедесталами.
  shell.decor.sortableChildren = true;
  let pedNodes: Container[] = [];

  // экранные прямоугольники зон дропа НАД пьедесталами (в локальных координатах комнаты)
  let pedRects: { x: number; y: number; w: number; h: number }[] = [];
  // невидимые узлы-якоря тех же зон — по ним обучение рисует кольцо «сюда ставить»
  // (сам корпус тумбы кота не ловит, кольцо вокруг него врало бы; см. ui/tutorial.ts)
  let pedMarks: Graphics[] = [];
  // золотые ауры зон дропа (по одной на пьедестал): видима, пока таскаемый кот над зоной
  let pedAuras: Graphics[] = [];
  let auraT = 0; // время для «дыхания» ауры
  // анимация чемпионов на тумбах (моргание + позы), пересобирается вместе с пьедесталами
  let champAnims: ChampAnim[] = [];

  // Drag-станция криокапсулы в правом нижнем углу (заморозка в крио-банк):
  // перетащил кота → диалог. Ветеринар отсюда убран — он теперь шприц в Инкубаторе.
  // Слой под «живым полом» (коты проходят ПЕРЕД ним); пересобирается в refresh.
  const ICE_EDGE = 0x8ecae6; // морозный акцент криокапсулы

  // криокапсула — правый НИЖНИЙ угол; появляется только когда открыт крио-банк (узел «Криогенетика»)
  const cryoZone = cornerStation(ctx.roomW, ctx.roomH, 'right');
  const cryoCx = cryoZone.x + cryoZone.width / 2;
  const cryoLayer = new Container();
  shell.container.addChildAt(cryoLayer, shell.container.getChildIndex(floorLayer));

  /** Станция-криокапсула (правый угол): только когда крио-банк открыт узлом «Криогенетика». */
  function refreshCryo(): void {
    cryoLayer.removeChildren();
    if (!cryoUnlocked(ctx.state)) return; // до открытия крио-банка станции нет
    const { x, y, width: sw, height: sh } = cryoZone;
    const box = new Graphics();
    // морозный короб + внутренняя «колба» криокапсулы
    box.roundRect(x, y, sw, sh, 14)
      .fill({ color: 0xe8f6fb, alpha: 0.92 })
      .stroke({ width: 3, color: ICE_EDGE });
    box.roundRect(x + sw * 0.24, y + sh * 0.14, sw * 0.52, sh * 0.62, 12)
      .fill({ color: 0xbfe6f2, alpha: 0.6 });
    const snow = label('🧊', sw * 0.42, COLORS.ink, '700');
    snow.position.set(cryoCx, y + sh * 0.5);
    const badge = stationBadge(cryoCx, y, t('❄️ криокапсула', '❄️ cryo capsule'));
    cryoLayer.addChild(box, snow, badge);
  }

  const plane = floorPlane(ctx.roomW, ctx.roomH, ctx.topInset);
  const floor = createLivingFloor(
    ctx, floorLayer,
    plane,
    // по полу гуляют коты, кроме поставленных в слот вязки и выставленных чемпионов
    () => catsIn(ctx.state, 'nursery')
      .filter((c) => !isInSlot(ctx.state, c.id) && !isChampion(ctx.state, c.id)),
  );

  /**
   * Поставить кота ВОЗЛЕ криокапсулы (сбоку от короба, у ближней кромки пола) и
   * задержать там: диалог заморозки открывается уже после дропа, и кот должен ждать
   * решения рядом с капсулой, а не убегать на своё прежнее место.
   */
  function standByStation(cat: Cat): void {
    const gap = plane.catH * 0.42; // полкорпуса кота — короб остаётся не закрыт
    const x = cryoZone.x - gap;
    floor.placeAt(cat.id, x, plane.yNear, 14); // 14 с — хватит и на диалог, и на «постоял рядом»
  }

  /** Индекс пьедестала под точкой (в локальных координатах комнаты) или -1. */
  function pedestalAt(lx: number, ly: number): number {
    for (let i = 0; i < pedRects.length; i++) {
      const r = pedRects[i]!;
      if (lx >= r.x && lx <= r.x + r.w && ly >= r.y && ly <= r.y + r.h) return i;
    }
    return -1;
  }

  /** Рисует одну тумбу-пьедестал (открытую/запертую) + чемпиона или подсказку. */
  function buildPedestal(i: number, cx: number, standY: number, pedW: number, catSize: number): Container {
    const c = new Container();
    const unlocked = i < championSlots(ctx.state);
    const slot = PED_ARC[i]!;
    const baseY = slot.baseYN * ctx.roomH;
    const pedH = slot.hN * ctx.roomH;
    const champ = championAt(ctx.state, i);
    const gold = 0xe7b24c;
    const col = unlocked ? gold : 0xc7bdb2;

    const tex = decorTexture(slot.tex);
    if (tex) {
      // контактная тень, чтобы тумба не «парила» над кафелем
      const shadow = new Graphics();
      shadow.ellipse(cx, baseY - 2, pedW * 0.56, pedW * 0.13)
        .fill({ color: 0x000000, alpha: 0.1 });
      c.addChild(shadow);
      // ИИ-спрайт тумбы (мрамор с золотом); запертая — приглушена серым
      const sp = new Sprite(tex);
      sp.anchor.set(0.5, 1);
      sp.scale.set(pedH / tex.height);
      sp.position.set(cx, baseY);
      if (!unlocked) sp.tint = 0x9fa4a6;
      c.addChild(sp);
    } else {
      // фолбэк: процедурная тумба (текстура не подгрузилась)
      const podW = pedW * 0.84;
      const podH = baseY - standY;
      const pod = new Graphics();
      pod.roundRect(cx - podW / 2, standY, podW, podH, 9)
        .fill({ color: col })
        .stroke({ width: 2, color: darken(col, 0.28) });
      pod.ellipse(cx, standY, podW / 2, podW * 0.11).fill(lighten(col, 0.12));
      c.addChild(pod);
    }
    // МЕСТО выставки римской цифрой на фронтоне тумбы (чем выше тумба — тем выше
    // место) + мелкой подписью бонус места к доходу кота: I → +50%, V → +10%.
    const place = pedestalPlace(i);
    const numSize = Math.max(17, pedH * 0.21);
    const num = label(ROMAN[place - 1] ?? String(place), numSize,
      unlocked ? 0xfff3d4 : 0xe9e9e9, '800',
      { color: unlocked ? 0x5a3c0c : 0x6f6a63, width: Math.max(3, numSize * 0.2) });
    // антиква с засечками: «I» без них читается просто как палочка
    num.style.fontFamily = 'Georgia, "Times New Roman", serif';
    num.position.set(cx, baseY - pedH * 0.36);
    c.addChild(num);
    const bonus = label(`+${Math.round((placeIncomeMult(i) - 1) * 100)}%`,
      Math.max(10, pedH * 0.11), unlocked ? 0xfff3d4 : 0xe9e9e9, '800',
      { color: unlocked ? 0x5a3c0c : 0x6f6a63, width: 2.5 });
    bonus.position.set(cx, baseY - pedH * 0.14);
    c.addChild(bonus);

    if (!unlocked) {
      // запертый пьедестал: замок. На «следующем» — либо кнопка «Открыть» за 💰 (если
      // уровень лаборатории уже позволяет), либо подпись «Откроется на ур. N».
      const lock = label('🔒', catSize * 0.5, COLORS.inkSoft, '700');
      lock.position.set(cx, standY - catSize * 0.4);
      c.addChild(lock);
      const isNext = i === championSlots(ctx.state) && !upgradeMaxed(ctx.state, 'championSlots');
      if (isNext) {
        const levelAllows = championSlots(ctx.state) < maxChampionsForLevel(ctx.state);
        if (!levelAllows) {
          const need = nextPedestalUnlockLevel(ctx.state);
          if (need) {
            const cap = label(t(`Откроется\nна ур. ${need}`, `Unlocks\nat lv. ${need}`), 12, COLORS.inkSoft, '800');
            cap.position.set(cx, standY - catSize - 4);
            c.addChild(cap);
          }
        } else {
          const cost = upgradeCost(ctx.state, 'championSlots');
          const afford = !!cost && ctx.state.coins >= cost.amount;
          const btn = new Button({
            text: cost ? t(`Открыть · ${cost.amount} 💰`, `Unlock · ${cost.amount} 💰`) : t('Открыть', 'Unlock'),
            w: pedW + 8, h: 30, color: afford ? COLORS.good : COLORS.cardEdge,
            textColor: afford ? 0xffffff : COLORS.inkSoft, fontSize: 12,
          });
          btn.enabled = afford;
          btn.position.set(cx, standY - catSize - 8);
          btn.onTap = () => {
            const r = buyUpgrade(ctx.state, 'championSlots');
            if (r.ok) {
              ctx.commit();
              ctx.toast(t(`Открыт пьедестал — ${place}-е место 🏆 (+${Math.round((placeIncomeMult(i) - 1) * 100)}% дохода)`, `Pedestal unlocked — place ${place} 🏆 (+${Math.round((placeIncomeMult(i) - 1) * 100)}% income)`));
            }
            else ctx.toast(r.reason === 'locked' ? t('Пьедестал ещё заперт 🔒', 'The pedestal is still locked 🔒') : r.reason);
          };
          c.addChild(btn);
        }
      }
      return c;
    }

    if (champ) {
      // чемпион стоит на тумбе: спрайт (можно стащить за шкирку) + подпись дохода
      const aiSp = aiSitSpriteFor(champ, catSize);
      const sp = aiSp ?? catSprite(ctx.app, champ, catSize);
      sp.position.set(cx, standY);
      const glow: Sprite = rarityGlow(ctx.app, sp, champ.rarityTier, catSize);
      glow.position.copyFrom(sp.position);
      c.addChild(glow, sp);

      // моргание — только по готовому арту породы (у процедурного фолбэка глаз нет)
      const anim: ChampAnim = {
        node: c, sprite: sp, glow,
        blink: aiSp ? attachBlink(ctx.app, sp) : null,
        baseScale: sp.scale.x, glowAlpha: glow.alpha,
        standY, catSize,
        phase: Math.random() * 6,          // рассинхрон поз между тумбами
        facing: 1, turnT: 0,
        pose: 'pose', poseLeft: 1 + Math.random() * 3,
        sparkT: 3 + Math.random() * 8,
        sparks: [],
      };
      champAnims.push(anim);

      sp.eventMode = 'static';
      sp.cursor = 'grab';
      sp.on('pointerdown', (e) => ctx.startGrab({
        cat: champ,
        displayH: catSize,
        hide: () => { sp.visible = false; glow.visible = false; },
        show: () => { sp.visible = true; glow.visible = true; },
        onTap: () => ctx.openCatMenu(champ),
        onDrop: () => { /* уронили мимо пьедестала → tryDropCat снимет с выставки */ },
      }, e));

      const rate = championIncomePerMin(ctx.state, champ, i); // с бонусом места
      const inc = label(
        t(`+${rate.toFixed(rate < 10 ? 1 : 0)} 💰/мин`, `+${rate.toFixed(rate < 10 ? 1 : 0)} 💰/min`), 13, COLORS.good, '800',
        { color: 0x000000, width: 1 },
      );
      inc.position.set(cx, standY - catSize - 10);
      c.addChild(inc);
    } else {
      // открытый, но пустой пьедестал — приглашение поставить кота
      const hint = label(t('🏆 сюда', '🏆 here'), 13, COLORS.inkSoft, '800');
      hint.position.set(cx, standY - catSize * 0.5);
      c.addChild(hint);
    }
    return c;
  }

  /** Золотая аура зоны дропа: мягкое свечение + кольцо-посадка на площадке.
   *  Яркая намеренно: аура лежит в слое декора, а сверху её накрывает цветной
   *  ореол редкости кота «в руках» — сквозь него подсветка должна читаться. */
  function buildAura(cx: number, standY: number, pedW: number,
    zone: { x: number; y: number; w: number; h: number }): Graphics {
    const a = new Graphics();
    // мягкое свечение: концентрические эллипсы, прозрачность копится к центру
    const ecy = zone.y + zone.h / 2 - 4;
    for (let k = 4; k >= 1; k--) {
      a.ellipse(cx, ecy, zone.w * 0.62 * (k / 4), zone.h * 0.56 * (k / 4))
        .fill({ color: 0xf6d98a, alpha: 0.252 }); // ×3 к прежней яркости
    }
    // кольцо на площадке — куда встанут лапы чемпиона; широкий внешний
    // ореол + яркий тонкий контур поверх, чтобы кольцо не терялось на мраморе
    a.ellipse(cx, standY, pedW * 0.4, pedW * 0.1)
      .stroke({ width: 9, color: 0xf6d98a, alpha: 0.45 });
    a.ellipse(cx, standY, pedW * 0.4, pedW * 0.1)
      .stroke({ width: 4, color: 0xffe08a, alpha: 1 });
    a.visible = false;
    a.zIndex = 2000; // подсказка-подсветка — поверх всех тумб слоя декора
    return a;
  }

  /** Пока кот «в руках» над зоной дропа — показать ауру этого пьедестала. */
  function updateAuras(dt: number): void {
    auraT += dt;
    const carry = ctx.carrying();
    let hover = -1;
    if (carry) {
      const lp = shell.container.toLocal({ x: carry.x, y: carry.y }, ctx.uiRoot);
      hover = pedestalAt(lp.x, lp.y);
      if (hover >= championSlots(ctx.state)) hover = -1; // запертый не манит
    }
    for (let i = 0; i < pedAuras.length; i++) {
      const a = pedAuras[i]!;
      a.visible = i === hover;
      if (a.visible) a.alpha = 0.92 + Math.sin(auraT * 5) * 0.08; // «дыхание», без просадки яркости
    }
  }

  /** Следующая поза чемпиона; иногда вместе с поворотом к другой половине зала. */
  function nextChampPose(a: ChampAnim): void {
    const r = Math.random();
    if (r < 0.55) { a.pose = 'pose'; a.poseLeft = 3 + Math.random() * 4; }        // просто стоит и дышит
    else if (r < 0.8) { a.pose = 'preen'; a.poseLeft = 1.4 + Math.random() * 1.6; } // прихорашивается
    else { a.pose = 'proud'; a.poseLeft = CH_PROUD_DUR; }                          // гордо вытянулся
    if (Math.random() < CH_TURN_CHANCE) { a.facing = -a.facing as 1 | -1; a.turnT = CH_TURN_DUR; }
  }

  /** Искорка над чемпионом: «блеск» победителя, всплывает и гаснет. */
  function spawnChampSpark(a: ChampAnim): void {
    const s = label(Math.random() < 0.7 ? '✨' : '⭐', 13 + Math.random() * 6, 0xffe08a, '700',
      { color: 0x7a5410, width: 2 });
    s.position.set(
      a.sprite.x + (Math.random() * 2 - 1) * a.catSize * 0.42,
      a.standY - a.catSize * (0.8 + Math.random() * 0.25),
    );
    a.node.addChild(s);
    a.sparks.push({ view: s, life: 0, vy: -16 - Math.random() * 10 });
  }

  /** Чемпионы «красуются»: моргание + смена поз + искорки (спрятанного — в руках — пропускаем). */
  function updateChampions(dt: number): void {
    for (const a of champAnims) {
      const sp = a.sprite;
      if (!sp.visible) continue; // кота держат за шкирку — на тумбе его сейчас нет

      a.phase += dt;
      a.blink?.update(dt);
      a.turnT = Math.max(0, a.turnT - dt);
      if ((a.poseLeft -= dt) <= 0) nextChampPose(a);

      const turnDip = a.turnT > 0 ? Math.sin((1 - a.turnT / CH_TURN_DUR) * Math.PI) : 0;
      let sx = 1, sy = 1, rot = 0, lift = 0;
      switch (a.pose) {
        case 'preen': // умывается: быстрое покачивание головой
          sy = 1 + Math.sin(a.phase * 3) * 0.03;
          rot = Math.sin(a.phase * 8) * 0.07;
          break;
        case 'proud': { // потянулся вверх и слегка качнулся — «смотрите на меня»
          const t = 1 - Math.max(0, Math.min(1, a.poseLeft / CH_PROUD_DUR));
          const curve = Math.sin(t * Math.PI); // 0 → 1 → 0
          sy = 1 + curve * 0.1;
          sx = 1 - curve * 0.05;
          rot = a.facing * curve * 0.05;
          lift = curve * a.catSize * 0.05;
          break;
        }
        default: // 'pose' — дыхание + ленивое покачивание
          sy = 1 + Math.sin(a.phase * 1.6) * 0.022;
          rot = Math.sin(a.phase * 0.8) * 0.022;
      }
      sy *= 1 - turnDip * CH_TURN_SQUASH_Y;
      sx *= 1 - turnDip * CH_TURN_SQUASH_X;

      sp.scale.x = a.baseScale * a.facing * sx;
      sp.scale.y = a.baseScale * sy;
      sp.rotation += (rot - sp.rotation) * Math.min(1, dt * 8);
      sp.y = a.standY - lift;
      // ореол редкости повторяет позу и «дышит» вместе с котом — свет рампы
      a.glow.scale.set(sp.scale.x * GLOW_OUT, sp.scale.y * GLOW_OUT);
      a.glow.rotation = sp.rotation;
      a.glow.y = sp.y;
      a.glow.alpha = a.glowAlpha * (0.85 + Math.sin(a.phase * 1.4) * 0.15);

      if ((a.sparkT -= dt) <= 0) { a.sparkT = 6 + Math.random() * 8; spawnChampSpark(a); }
      for (let k = a.sparks.length - 1; k >= 0; k--) {
        const s = a.sparks[k]!;
        s.life += dt;
        const t = Math.min(1, s.life / CH_SPARK_TTL);
        s.view.y += s.vy * dt;
        s.view.alpha = 1 - t;
        s.view.scale.set(0.7 + t * 0.4);
        if (t >= 1) { s.view.destroy(); a.sparks.splice(k, 1); }
      }
    }
  }

  function refreshChampions(): void {
    for (const a of champAnims) a.blink?.destroy();
    champAnims = [];
    for (const n of pedNodes) n.destroy();
    pedNodes = [];
    for (const a of pedAuras) a.destroy();
    pedAuras = [];
    for (const m of pedMarks) m.destroy();
    pedMarks = [];
    pedRects = [];
    const pedCount = pedCountFor(ctx); // всегда 5 (открытые + запертые с замком)
    const w = ctx.roomW, h = ctx.roomH;

    for (let i = 0; i < pedCount; i++) {
      const slot = PED_ARC[i]!;
      const cx = slot.xN * w;
      const baseY = slot.baseYN * h;
      const pedH = slot.hN * h;
      const standY = baseY - pedH * (1 - PED_TOP_INSET); // ноги чемпиона на площадке
      // ширина тумбы — от реального спрайта (или фолбэк-пропорция 0.62 от высоты)
      const tex = decorTexture(slot.tex);
      const pedW = tex ? (pedH / tex.height) * tex.width : pedH * 0.62;
      // чемпион крупнее на высоком центральном подиуме, мельче на крайних
      const catSize = Math.round(Math.min(92, Math.max(56, pedH * 0.68)));

      const node = buildPedestal(i, cx, standY, pedW, catSize);
      node.zIndex = slot.baseYN * 1000; // глубина в y-сортируемом слое декора
      shell.decor.addChild(node);
      pedNodes.push(node);
      // Зона дропа — ТОЛЬКО место над площадкой (низ ≈ уровень площадки standY):
      // корпус тумбы кота не ловит, иначе при обычном переносе по комнате котов
      // случайно «забрасывало» на выставку — тумбы начинаются от самого пола.
      const dropW = Math.max(pedW, catSize) + 10;
      const zone = {
        x: cx - dropW / 2, y: standY - catSize - 16,
        w: dropW, h: catSize + 26,
      };
      pedRects.push(zone);
      const aura = buildAura(cx, standY, pedW, zone);
      shell.decor.addChild(aura);
      pedAuras.push(aura);
      // Прозрачный «обмер» зоны дропа для подсветки обучения: рисует ничего
      // (alpha 0), но даёт честные getBounds; для событий выключен целиком.
      const mark = new Graphics();
      mark.rect(zone.x, zone.y, zone.w, zone.h).fill({ color: 0xffffff, alpha: 0 });
      mark.eventMode = 'none';
      shell.decor.addChild(mark);
      pedMarks.push(mark);
    }
  }

  /**
   * Узел-якорь пьедестала для обучения: первая ОТКРЫТАЯ и свободная тумба
   * (иначе — просто первая открытая). Отдаём зону дропа, а не корпус тумбы.
   */
  function tutorPedestalMark(): Container | null {
    const open = championSlots(ctx.state);
    for (let i = 0; i < Math.min(open, pedMarks.length); i++) {
      if (!championAt(ctx.state, i)) return pedMarks[i]!;
    }
    return pedMarks[0] ?? null;
  }

  /**
   * Уронили кота на пьедестал → на ИМЕННО ЭТОТ пьедестал (setChampion со slotIndex);
   * если там уже кто-то стоял — меняются местами (или снятый чемпион уезжает в
   * питомник/приют, если кот пришёл из слота вязки — см. setChampion). Стащили
   * чемпиона мимо пьедестала → снять с выставки (moveCat в питомник — тоже проверяет
   * вместимость пола, иначе чемпион «просочится» сверх лимита). Обычный кот мимо
   * пьедестала — false: пусть сработает обычный переезд/приземление на полу.
   */
  function tryDropCat(cat: Cat, gx: number, gy: number): boolean {
    const lp = shell.container.toLocal({ x: gx, y: gy }, ctx.uiRoot);
    const idx = pedestalAt(lp.x, lp.y);
    const wasChampion = isChampion(ctx.state, cat.id);
    if (idx >= 0) {
      if (idx >= championSlots(ctx.state)) { ctx.toast(t('Пьедестал заперт 🔒', 'The pedestal is locked 🔒')); return false; }
      if (championAt(ctx.state, idx)?.id === cat.id) return false; // вернулся на свой же пьедестал
      const r = setChampion(ctx.state, cat.id, idx, ctx.now());
      if (!r.ok) {
        ctx.toast(r.reason === t('нет места в лаборатории', 'no room in the lab') ? t('Нет места в лаборатории 🚫', 'No room in the lab 🚫') : r.reason);
        return false;
      }
      ctx.commit();
      ctx.toast(t('Кот на выставке 🏆 приносит доход', 'The cat is at the show 🏆 and brings income'));
      return true;
    }
    // криокапсула (справа): уронили кота на станцию → диалог заморозки (📺/💰/💎).
    // Станция есть только при открытом крио-банке — иначе дроп сюда не перехватываем.
    // (Ветеринар отсюда убран — теперь это шприц в Инкубаторе, на кота в слоте вязки.)
    if (cryoUnlocked(ctx.state) && cryoZone.contains(lp.x, lp.y)) {
      ctx.commit();               // grab-спрайт уничтожен — пол пересобран, кот снова виден
      standByStation(cat);        // откажешься морозить — кот остаётся у капсулы
      ctx.openFreezeConfirm(cat); // «Заморозить?» (📺 бесплатно / 💰 / 💎)
      return true;
    }
    if (wasChampion) {
      const r = moveCat(ctx.state, cat.id, 'nursery'); // тоже проверяет вместимость пола
      if (!r.ok) { ctx.toast(r.reason); return false; } // нет места → вернётся на пьедестал
      ctx.commit();
      ctx.toast(t('Кот снят с выставки', 'The cat is off the show'));
      return true;
    }
    return false;
  }

  /**
   * Виджет-кормушка (правый верх, над кнопкой покупки кота): полоса запаса корма,
   * справка «сколько ртов и сколько съедают в минуту» + две кнопки докупки
   * (пакет / до полного). До открытия механики уровнем (LAB_UNLOCKS.food) — замок.
   * При голоде полоса краснеет. Расход корма считает economy/game.ts, тут только показ.
   * Раскладка вертикальная (полоса → справка → кнопки): карточка стоит в узкой
   * правой колонке шириной FEEDER_W, в один ряд с кнопками уже не помещается.
   */
  function buildFeeder(fw: number): { view: Container; height: number; update: () => void } {
    const c = new Container();
    const fh = foodEnabled(ctx.state) ? 110 : 38;
    const bg = new Graphics();
    bg.roundRect(0, 0, fw, fh, 12).fill({ color: COLORS.card, alpha: 0.92 }).stroke({ width: 2, color: COLORS.cardEdge });
    c.addChild(bg);

    if (!foodEnabled(ctx.state)) {
      const lock = label(t(`🍽 Запас корма — с ур. ${unlockLevelOf('food')} 🔒`, `🍽 Food supply — from lv. ${unlockLevelOf('food')} 🔒`), 12.5, COLORS.inkSoft, '700');
      lock.anchor.set(0, 0.5);
      lock.position.set(12, fh / 2);
      c.addChild(lock);
      return { view: c, height: fh, update: () => { /* замок статичен */ } };
    }

    const PAD_X = 12;
    // ряд 1: заголовок карточки — по центру блока
    const title = label(t('🍽 Запас корма', '🍽 Food supply'), 13, COLORS.ink, '800');
    title.anchor.set(0.5);
    title.position.set(fw / 2, 17);
    c.addChild(title);

    // ряд 2: полоса запаса с числом «корм/ёмкость» — во всю ширину карточки
    const barX = PAD_X, barW = fw - PAD_X * 2, barY = 30, barH = 15;
    const barBg = new Graphics();
    barBg.roundRect(barX, barY, barW, barH, 7).fill({ color: 0x000000, alpha: 0.15 });
    const barFill = new Graphics();
    c.addChild(barBg, barFill);

    const amt = label('', 11, COLORS.ink, '700');
    amt.anchor.set(0.5);
    amt.position.set(barX + barW / 2, barY + barH / 2);
    c.addChild(amt);

    // ряд 3: сколько ртов, сколько едят в минуту и на сколько хватит запаса
    const info = label('', 10.5, COLORS.inkSoft, '700');
    info.anchor.set(0, 0.5);
    info.position.set(PAD_X, 59);
    c.addChild(info);

    // ряд 4: кнопки докупки — во всю ширину карточки, поровну
    const btnGap = 8;
    const btnW = (fw - PAD_X * 2 - btnGap) / 2;
    const mkBuy = (mode: 'pack' | 'full', text: string, x: number): (() => void) => {
      const btn = new Button({ text: '', w: btnW, h: 28, color: COLORS.good, fontSize: 11.5 });
      btn.position.set(x + btnW / 2, 86);
      btn.onTap = () => {
        const r = buyFood(ctx.state, mode);
        if (r.ok) { ctx.commit(); ctx.toast(t(`Корм +${Math.round(r.added)} 🍽`, `Food +${Math.round(r.added)} 🍽`)); }
        else ctx.toast(r.reason);
      };
      c.addChild(btn);
      return () => {
        const quote = foodBuyQuote(ctx.state, mode);
        const full = quote.units <= 0;
        btn.setText(full ? t('полно', 'full') : `${text} · ${quote.cost}💰`);
        btn.enabled = !full && ctx.state.coins >= quote.cost;
      };
    };
    const buyUpdates = [
      mkBuy('pack', `＋${FOOD_PACK_UNITS}`, PAD_X),
      mkBuy('full', t('Полная', 'Full'), PAD_X + btnW + btnGap),
    ];

    // Корм тает каждый кадр, поэтому цифры перерисовываем по таймеру комнаты, а не
    // только на commit — иначе полоса и «хватит на ~N мин» врут до первого действия.
    const update = (): void => {
      const cap = foodCap(ctx.state);
      const food = foodLevel(ctx.state);
      const frac = Math.max(0, Math.min(1, food / cap));
      const starving = isStarving(ctx.state);
      const col = starving ? 0xd9534f : frac < 0.25 ? 0xe0a13a : 0x6cc07a;
      barFill.clear().roundRect(barX, barY, Math.max(3, barW * frac), barH, 7).fill({ color: col });
      amt.text = `${Math.round(food)}/${cap}`;

      const mins = foodMinutesLeft(ctx.state);
      const left = starving ? t('голод!', 'starving!') : mins === Infinity ? t('расхода нет', 'nothing eaten') : t(`хватит на ~${Math.round(mins)} мин`, `lasts ~${Math.round(mins)} min`);
      info.text = t(`🐱 ${feedingCatCount(ctx.state)} · ${foodRatePerMin(ctx.state).toFixed(1)} 🍽/мин · ${left}`, `🐱 ${feedingCatCount(ctx.state)} · ${foodRatePerMin(ctx.state).toFixed(1)} 🍽/min · ${left}`);
      info.style.fill = starving ? 0xd9534f : COLORS.inkSoft;
      for (const u of buyUpdates) u();
    };
    update();
    return { view: c, height: fh, update };
  }

  function refresh(): void {
    shell.body.removeChildren();
    // заполненность комнаты: без слотовых (инкубатор) и без чемпионов (выставка)
    const count = roomCount(ctx.state, 'nursery');
    const cap = nurseryCapacity(ctx.state);
    // вместимость комнаты — счётчиком справа в плашке названия
    shell.setTitleBadge(`🐱 ${count}/${cap}`);

    // Правая колонка в правом верхнем углу: только кормушка (покупка котов теперь
    // в Приюте). Прижата правым краем к contentW, ширина COL_W. Верх поднят на
    // уровень плашки названия комнаты: body начинается ПОД плашкой, поэтому
    // отсчитываем вверх на её высоту с зазором (отрицательный y) — так занимается
    // пустое место под топ-баром, а не поле над пьедесталами.
    const colX = shell.contentW - COL_W;
    const colY = -(shell.titleH + 12);

    const feeder = buildFeeder(COL_W);
    feeder.view.position.set(colX, colY);
    shell.body.addChild(feeder.view);
    feederUpdate = feeder.update;

    refreshChampions();
    refreshCryo();   // станция-криокапсула появляется, когда открыт крио-банк
    floor.refresh();
  }

  return {
    id: 'nursery', title: t('🏆 Питомник', '🏆 Cattery'), container: shell.container,
    refresh,
    tick: (dt) => {
      floor.tick(dt);
      updateChampions(dt); // чемпионы моргают и красуются на тумбах
      updateAuras(dt); // золотая аура зоны дропа под котом «в руках»
      feederAcc += dt;
      if (feederAcc >= FEEDER_UPDATE_S) { feederAcc = 0; feederUpdate?.(); }
    }, tryDropCat,
    // Обучение новичка (см. ui/tutorial.ts): `cat:<id>` — котик на полу,
    // 'pedestal' — зона дропа свободной тумбы выставки.
    anchor: (key) => {
      if (key.startsWith('cat:')) return floor.nodeOf(key.slice(4));
      if (key === 'pedestal') return tutorPedestalMark();
      return null;
    },
  };
}
