/**
 * Комната «Питомник»: ценные коты ХОДЯТ по полу (можно взять за шкирку и
 * таскать, тап — меню) и служат племфондом для вязки. Вверху — 5 пьедесталов
 * ВЫСТАВКИ: поставленный на пьедестал кот становится чемпионом и приносит
 * пассивный доход (∝ своей ценности); число дохода подписано над ним.
 * Перетащил кота на пьедестал → на выставку; стащил на пол → снял с выставки.
 * У левой стены — ветеринар-шприц (💉): перетащил кота → диалог лечения вязок.
 * Улучшения — в оверлее ⚙️, чтобы не занимать пол.
 */

import { Container, Graphics } from 'pixi.js';
import type { Sprite } from 'pixi.js';
import {
  catsIn, roomCount, nurseryCapacity, buyCat, buyCatCost, isInSlot, moveCat,
  championSlots, championAt, championIncomePerMin, isChampion,
  setChampion, upgradeCost, upgradeMaxed, buyUpgrade,
  maxChampionsForLevel, nextPedestalUnlockLevel, isUnlocked,
  foodEnabled, foodCap, foodLevel, foodMinutesLeft, isStarving, buyFood, unlockLevelOf,
  foodRatePerMin, feedingCatCount, foodBuyQuote,
  cryoUnlocked,
  FOOD_PACK_UNITS, CHAMPION_SLOTS_BASE, UPGRADES,
} from '../../game/index.js';
import type { Cat } from '../../game/index.js';
import type { Room, UiContext } from '../context.js';
import { roomShell, floorPlane, cornerStation, stationBadge } from './shell.js';
import { Button, COLORS, label } from '../theme.js';
import { createLivingFloor } from '../livingFloor.js';
import { catSprite, aiSitSpriteFor, rarityGlow } from '../catTextures.js';
import { darken, lighten } from '../../render/palette.js';

// Всегда показываем все 5 пьедесталов (база 1 + до 4 апгрейдов); запертые — с замком.
function pedCountFor(_ctx: UiContext): number {
  return CHAMPION_SLOTS_BASE + UPGRADES.championSlots!.max;
}

// Правая колонка шапки: кормушка + кнопка «Купить котика» (одна ширина на обе).
// Ряд пьедесталов считает её как занятую зону и под неё не заезжает.
const COL_W = 256;
const COL_PAD = 18; // отступ оболочки комнаты (shell PAD) — от него живёт body

export function createNursery(ctx: UiContext): Room {
  const shell = roomShell(ctx, 'nursery', '🏆 Питомник');
  // живые цифры кормушки: обновляем раз в FEEDER_UPDATE_S, а не каждый кадр
  const FEEDER_UPDATE_S = 0.5;
  let feederUpdate: (() => void) | null = null;
  let feederAcc = 0;
  const floorLayer = new Container();
  shell.container.addChild(floorLayer);
  // слой пьедесталов выставки — поверх пола (пьедесталы стоят у задней стены)
  const champLayer = new Container();
  shell.container.addChild(champLayer);

  // экранные прямоугольники пьедесталов (в локальных координатах комнаты) — для дропа
  let pedRects: { x: number; y: number; w: number; h: number }[] = [];

  // Две drag-станции по нижним углам (общий образец cornerStation — короб жмётся в
  // угол с отступом ≈ полосе навигации): клиника-шприц в левом углу (лечение),
  // криокапсула в правом (заморозка в крио-банк). Перетащил кота на станцию →
  // соответствующий диалог. Слои под «живым полом» (коты проходят ПЕРЕД ними);
  // пересобираются в refresh.
  const ICE_EDGE = 0x8ecae6; // морозный акцент криокапсулы

  // клиника — левый НИЖНИЙ угол; до открытия уровнем (LAB_UNLOCKS.clinic) — замок
  const clinicZone = cornerStation(ctx.roomW, ctx.roomH, 'left');
  const clinicCx = clinicZone.x + clinicZone.width / 2;
  const clinicLayer = new Container();
  shell.container.addChildAt(clinicLayer, shell.container.getChildIndex(floorLayer));

  // криокапсула — правый НИЖНИЙ угол; появляется только когда открыт крио-банк (узел «Криогенетика»)
  const cryoZone = cornerStation(ctx.roomW, ctx.roomH, 'right');
  const cryoCx = cryoZone.x + cryoZone.width / 2;
  const cryoLayer = new Container();
  shell.container.addChildAt(cryoLayer, shell.container.getChildIndex(floorLayer));

  function refreshClinic(): void {
    clinicLayer.removeChildren();
    const unlocked = isUnlocked(ctx.state, 'clinic');
    const { x, y, width: sw, height: sh } = clinicZone;
    const box = new Graphics();
    // короб-станция (заглушка): белый медицинский бокс + «кушетка»
    box.roundRect(x, y, sw, sh, 14)
      .fill({ color: unlocked ? 0xf3f6f4 : 0x6b7370, alpha: unlocked ? 0.9 : 0.6 })
      .stroke({ width: 3, color: unlocked ? 0xd66a6a : 0x4a504e });
    box.roundRect(x + sw * 0.12, y + sh * 0.16, sw * 0.76, sh * 0.4, 8)
      .fill({ color: unlocked ? 0xf7c8c8 : 0xbfbfbf, alpha: unlocked ? 0.6 : 0.3 });
    const syringe = label(unlocked ? '💉' : '🔒', sw * 0.42, COLORS.ink, '700');
    syringe.position.set(clinicCx, y + sh * 0.56);
    const badge = stationBadge(clinicCx, y,
      unlocked ? '💉 ветеринар' : '🔒 открой в Генолабе');
    clinicLayer.addChild(box, syringe, badge);
  }

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
    const badge = stationBadge(cryoCx, y, '❄️ криокапсула');
    cryoLayer.addChild(box, snow, badge);
  }

  const floor = createLivingFloor(
    ctx, floorLayer,
    floorPlane(ctx.roomW, ctx.roomH, ctx.topInset),
    // по полу гуляют коты, кроме поставленных в слот вязки и выставленных чемпионов
    () => catsIn(ctx.state, 'nursery')
      .filter((c) => !isInSlot(ctx.state, c.id) && !isChampion(ctx.state, c.id)),
  );

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
    const podW = pedW * 0.84;
    const podH = Math.round(pedW * 0.5);
    const champ = championAt(ctx.state, i);
    const gold = 0xe7b24c;
    const col = unlocked ? gold : 0xc7bdb2;

    // тумба: тело + светлая «крышка»-эллипс сверху
    const pod = new Graphics();
    pod.roundRect(cx - podW / 2, standY, podW, podH, 9)
      .fill({ color: col })
      .stroke({ width: 2, color: darken(col, 0.28) });
    pod.ellipse(cx, standY, podW / 2, podW * 0.11).fill(lighten(col, 0.12));
    // номер места на фронтоне тумбы
    const num = label(String(i + 1), podH * 0.34, unlocked ? 0x6b4a12 : COLORS.inkSoft, '800');
    num.position.set(cx, standY + podH * 0.58);
    c.addChild(pod, num);

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
            const cap = label(`Откроется\nна ур. ${need}`, 12, COLORS.inkSoft, '800');
            cap.position.set(cx, standY - catSize - 4);
            c.addChild(cap);
          }
        } else {
          const cost = upgradeCost(ctx.state, 'championSlots');
          const afford = !!cost && ctx.state.coins >= cost.amount;
          const btn = new Button({
            text: cost ? `Открыть · ${cost.amount} 💰` : 'Открыть',
            w: pedW + 8, h: 30, color: afford ? COLORS.good : COLORS.cardEdge,
            textColor: afford ? 0xffffff : COLORS.inkSoft, fontSize: 12,
          });
          btn.enabled = afford;
          btn.position.set(cx, standY - catSize - 8);
          btn.onTap = () => {
            const r = buyUpgrade(ctx.state, 'championSlots');
            if (r.ok) { ctx.commit(); ctx.toast('Новый пьедестал выставки 🏆'); }
            else ctx.toast(r.reason === 'locked' ? 'Пьедестал ещё заперт 🔒' : r.reason);
          };
          c.addChild(btn);
        }
      }
      return c;
    }

    if (champ) {
      // чемпион стоит на тумбе: спрайт (можно стащить за шкирку) + подпись дохода
      const sp = aiSitSpriteFor(champ, catSize) ?? catSprite(ctx.app, champ, catSize);
      sp.position.set(cx, standY);
      const glow: Sprite = rarityGlow(sp, champ.rarityTier, catSize);
      glow.position.copyFrom(sp.position);
      c.addChild(glow, sp);

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

      const rate = championIncomePerMin(ctx.state, champ);
      const inc = label(
        `+${rate.toFixed(rate < 10 ? 1 : 0)} 💰/мин`, 13, COLORS.good, '800',
        { color: 0x000000, width: 1 },
      );
      inc.position.set(cx, standY - catSize - 10);
      c.addChild(inc);
    } else {
      // открытый, но пустой пьедестал — приглашение поставить кота
      const hint = label('🏆 сюда', 13, COLORS.inkSoft, '800');
      hint.position.set(cx, standY - catSize * 0.5);
      c.addChild(hint);
    }
    return c;
  }

  function refreshChampions(): void {
    champLayer.removeChildren();
    pedRects = [];
    const pedCount = pedCountFor(ctx); // всегда 5 (открытые + запертые с замком)
    const w = ctx.roomW, h = ctx.roomH;
    const usable = h - ctx.topInset;
    const gap = Math.min(22, w * 0.03);
    // Полоса, доступная ряду: от левого поля до правой колонки (кормушка + покупка).
    // Ряд стоит по центру комнаты, но при нехватке ширины (узкий экран, 4:3)
    // сначала съезжает влево и лишь потом ужимает тумбы — иначе колонка накрывает
    // 5-й пьедестал (его замок/кнопку «Открыть»).
    const bandL = COL_PAD;
    const bandR = w - COL_PAD - COL_W - 12;
    const pedW = Math.min(122, (w * 0.84) / pedCount, (bandR - bandL - gap * (pedCount - 1)) / pedCount);
    const totalW = pedW * pedCount + gap * (pedCount - 1);
    const startX = Math.max(bandL, Math.min((w - totalW) / 2, bandR - totalW));
    const catSize = Math.min(90, pedW * 0.82);
    const standY = ctx.topInset + Math.round(usable * 0.32); // линия «ног» чемпиона на тумбе

    for (let i = 0; i < pedCount; i++) {
      const cx = startX + i * (pedW + gap) + pedW / 2;
      champLayer.addChild(buildPedestal(i, cx, standY, pedW, catSize));
      // зона дропа: покрывает кота над тумбой + саму тумбу
      pedRects.push({ x: cx - pedW / 2, y: standY - catSize - 14, w: pedW, h: catSize + pedW * 0.5 + 24 });
    }
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
      if (idx >= championSlots(ctx.state)) { ctx.toast('Пьедестал заперт 🔒'); return false; }
      if (championAt(ctx.state, idx)?.id === cat.id) return false; // вернулся на свой же пьедестал
      const r = setChampion(ctx.state, cat.id, idx, ctx.now());
      if (!r.ok) {
        ctx.toast(r.reason === 'нет места в лаборатории' ? 'Нет места в лаборатории 🚫' : r.reason);
        return false;
      }
      ctx.commit();
      ctx.toast('Кот на выставке 🏆 приносит доход');
      return true;
    }
    // клиника-шприц: уронили кота на станцию → диалог лечения (раньше проверки
    // «чемпион мимо пьедестала», иначе чемпиона снимет с выставки вместо лечения)
    if (clinicZone.contains(lp.x, lp.y)) {
      if (!isUnlocked(ctx.state, 'clinic')) {
        ctx.toast('Открой «Ветеринара» в Генолабе 🔬');
        return false;             // заперто → кот вернётся на своё место
      }
      ctx.commit();               // grab-спрайт уничтожен — вернём кота на пол/пьедестал
      ctx.openHealConfirm(cat);   // «Полечить?» (📺 +1 ❤ / 💎 полностью)
      return true;
    }
    // криокапсула (справа): уронили кота на станцию → диалог заморозки (📺/💰/💎).
    // Станция есть только при открытом крио-банке — иначе дроп сюда не перехватываем.
    if (cryoUnlocked(ctx.state) && cryoZone.contains(lp.x, lp.y)) {
      ctx.commit();               // grab-спрайт уничтожен — вернём кота на пол/пьедестал
      ctx.openFreezeConfirm(cat); // «Заморозить?» (📺 бесплатно / 💰 / 💎)
      return true;
    }
    if (wasChampion) {
      const r = moveCat(ctx.state, cat.id, 'nursery'); // тоже проверяет вместимость пола
      if (!r.ok) { ctx.toast(r.reason); return false; } // нет места → вернётся на пьедестал
      ctx.commit();
      ctx.toast('Кот снят с выставки');
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
      const lock = label(`🍽 Запас корма — с ур. ${unlockLevelOf('food')} 🔒`, 12.5, COLORS.inkSoft, '700');
      lock.anchor.set(0, 0.5);
      lock.position.set(12, fh / 2);
      c.addChild(lock);
      return { view: c, height: fh, update: () => { /* замок статичен */ } };
    }

    const PAD_X = 12;
    // ряд 1: заголовок карточки — по центру блока
    const title = label('🍽 Запас корма', 13, COLORS.ink, '800');
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
        if (r.ok) { ctx.commit(); ctx.toast(`Корм +${Math.round(r.added)} 🍽`); }
        else ctx.toast(r.reason);
      };
      c.addChild(btn);
      return () => {
        const quote = foodBuyQuote(ctx.state, mode);
        const full = quote.units <= 0;
        btn.setText(full ? 'полно' : `${text} · ${quote.cost}💰`);
        btn.enabled = !full && ctx.state.coins >= quote.cost;
      };
    };
    const buyUpdates = [
      mkBuy('pack', `＋${FOOD_PACK_UNITS}`, PAD_X),
      mkBuy('full', 'Полная', PAD_X + btnW + btnGap),
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
      const left = starving ? 'голод!' : mins === Infinity ? 'расхода нет' : `хватит на ~${Math.round(mins)} мин`;
      info.text = `🐱 ${feedingCatCount(ctx.state)} · ${foodRatePerMin(ctx.state).toFixed(1)} 🍽/мин · ${left}`;
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

    // Правая колонка в правом верхнем углу: кормушка сверху, кнопка покупки кота
    // под ней. Обе прижаты правым краем к contentW и выровнены по общей ширине
    // COL_W — колонка читается как единый блок (refreshChampions её обходит).
    // Верх колонки поднят на уровень плашки названия комнаты: body начинается ПОД
    // плашкой, поэтому отсчитываем вверх на её высоту с зазором (отрицательный y) —
    // так занимается пустое место под топ-баром, а не поле над пьедесталами.
    const colX = shell.contentW - COL_W;
    const colY = -(shell.titleH + 12);

    const feeder = buildFeeder(COL_W);
    feeder.view.position.set(colX, colY);
    shell.body.addChild(feeder.view);
    feederUpdate = feeder.update;

    const cost = buyCatCost(ctx.state);
    const buy = new Button({
      text: cost === 0 ? '🛒 Котик (бесплатно)' : `🛒 Купить котика (${cost} 💰)`,
      w: COL_W, h: 40, color: COLORS.good, fontSize: 14,
    });
    buy.enabled = count < cap && ctx.state.coins >= cost;
    buy.position.set(colX + COL_W / 2, colY + feeder.height + 10 + 20);
    buy.onTap = () => {
      const r = buyCat(ctx.state, ctx.rng, ctx.now());
      if (r.ok) { ctx.commit(); ctx.toast('Новый котик в питомнике 🐱'); }
      else ctx.toast(r.reason);
    };
    shell.body.addChild(buy);

    refreshChampions();
    refreshClinic(); // замок станции снимается, когда уровень дорастает
    refreshCryo();   // станция-криокапсула появляется, когда открыт крио-банк
    floor.refresh();
  }

  return {
    id: 'nursery', title: '🏆 Питомник', container: shell.container,
    refresh,
    tick: (dt) => {
      floor.tick(dt);
      feederAcc += dt;
      if (feederAcc >= FEEDER_UPDATE_S) { feederAcc = 0; feederUpdate?.(); }
    }, tryDropCat,
  };
}
