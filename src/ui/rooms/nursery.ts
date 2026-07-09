/**
 * Комната «Питомник»: ценные коты ХОДЯТ по полу (можно взять за шкирку и
 * таскать, тап — меню) и служат племфондом для вязки. Вверху — 5 пьедесталов
 * ВЫСТАВКИ: поставленный на пьедестал кот становится чемпионом и приносит
 * пассивный доход (∝ своей ценности); число дохода подписано над ним.
 * Перетащил кота на пьедестал → на выставку; стащил на пол → снял с выставки.
 * У правой стены — клиника-шприц (💉): перетащил кота → диалог лечения вязок.
 * Улучшения — в оверлее ⚙️, чтобы не занимать пол.
 */

import { Container, Graphics, Rectangle } from 'pixi.js';
import type { Sprite } from 'pixi.js';
import {
  catsIn, roomCount, nurseryCapacity, buyCat, buyCatCost, isInSlot, moveCat,
  championSlots, championAt, championIncomePerMin, isChampion,
  setChampion, upgradeCost, upgradeMaxed, buyUpgrade,
  maxChampionsForLevel, nextPedestalUnlockLevel, isUnlocked,
  foodEnabled, foodCap, foodLevel, foodMinutesLeft, isStarving, buyFood, unlockLevelOf,
  FOOD_PACK_COST, CHAMPION_SLOTS_BASE, UPGRADES,
} from '../../game/index.js';
import type { Cat } from '../../game/index.js';
import type { Room, UiContext } from '../context.js';
import { roomShell, floorPlane } from './shell.js';
import { Button, COLORS, label } from '../theme.js';
import { createLivingFloor } from '../livingFloor.js';
import { catSprite, aiSitSpriteFor, rarityGlow } from '../catTextures.js';
import { darken, lighten } from '../../render/palette.js';

// Всегда показываем все 5 пьедесталов (база 1 + до 4 апгрейдов); запертые — с замком.
function pedCountFor(_ctx: UiContext): number {
  return CHAMPION_SLOTS_BASE + UPGRADES.championSlots!.max;
}

export function createNursery(ctx: UiContext): Room {
  const shell = roomShell(ctx, 'nursery', '🏆 Питомник');
  const floorLayer = new Container();
  shell.container.addChild(floorLayer);
  // слой пьедесталов выставки — поверх пола (пьедесталы стоят у задней стены)
  const champLayer = new Container();
  shell.container.addChild(champLayer);

  // экранные прямоугольники пьедесталов (в локальных координатах комнаты) — для дропа
  let pedRects: { x: number; y: number; w: number; h: number }[] = [];

  // Клиника-шприц — drag-станция у правой стены (по образцу станции «в лабораторию»
  // в Приюте; спрайт будет позже). Перетащил кота → диалог лечения (openHealConfirm).
  // До открытия уровнем (LAB_UNLOCKS.clinic) — замок; слой пересобирается в refresh.
  const clinicW = ctx.roomW * 0.15;
  const clinicH = clinicW * 0.95;
  const clinicCx = ctx.roomW * 0.87;
  const clinicZone = new Rectangle(clinicCx - clinicW / 2, ctx.roomH * 0.86 - clinicH, clinicW, clinicH);
  // станция под «живым полом» (коты проходят ПЕРЕД ней, как у станции в Приюте)
  const clinicLayer = new Container();
  shell.container.addChildAt(clinicLayer, shell.container.getChildIndex(floorLayer));

  function refreshClinic(): void {
    clinicLayer.removeChildren();
    const unlocked = isUnlocked(ctx.state, 'clinic');
    const box = new Graphics();
    // короб-станция (заглушка): белый медицинский бокс + «кушетка»
    box.roundRect(clinicZone.x, clinicZone.y, clinicW, clinicH, 14)
      .fill({ color: unlocked ? 0xf3f6f4 : 0x6b7370, alpha: unlocked ? 0.9 : 0.6 })
      .stroke({ width: 3, color: unlocked ? 0xd66a6a : 0x4a504e });
    box.roundRect(clinicZone.x + clinicW * 0.12, clinicZone.y + clinicH * 0.16, clinicW * 0.76, clinicH * 0.4, 8)
      .fill({ color: unlocked ? 0xf7c8c8 : 0xbfbfbf, alpha: unlocked ? 0.6 : 0.3 });
    const syringe = label(unlocked ? '💉' : '🔒', clinicW * 0.42, COLORS.ink, '700');
    syringe.position.set(clinicCx, clinicZone.y + clinicH * 0.56);
    const tag = label(unlocked ? '💉 клиника' : `Откроется на ур. ${unlockLevelOf('clinic')}`,
      13, COLORS.ink, '800');
    const pillBg = new Graphics();
    const pw = tag.width + 18;
    pillBg.roundRect(-pw / 2, -14, pw, 26, 13).fill({ color: COLORS.hud, alpha: 0.9 });
    pillBg.roundRect(-pw / 2, -14, pw, 26, 13).stroke({ width: 2, color: COLORS.cardEdge });
    const badge = new Container();
    badge.addChild(pillBg, tag);
    badge.position.set(clinicCx, clinicZone.y - 8);
    clinicLayer.addChild(box, syringe, badge);
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
    const pedW = Math.min(122, (w * 0.84) / pedCount);
    const gap = Math.min(22, w * 0.03);
    const totalW = pedW * pedCount + gap * (pedCount - 1);
    const startX = (w - totalW) / 2;
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
        ctx.toast(`Клиника откроется на ур. ${unlockLevelOf('clinic')} 🔒`);
        return false;             // заперто → кот вернётся на своё место
      }
      ctx.commit();               // grab-спрайт уничтожен — вернём кота на пол/пьедестал
      ctx.openHealConfirm(cat);   // «Полечить?» (📺 +1 ❤ / 💎 полностью)
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
   * Виджет-кормушка (левый верх шапки): полоса запаса корма + «~N мин» + кнопка
   * докупки пакета. До открытия механики уровнем (LAB_UNLOCKS.food) — замок.
   * При голоде полоса краснеет. Расход корма — в economy/game.ts, тут только показ.
   */
  function buildFeeder(): Container {
    const c = new Container();
    const fw = Math.min(260, ctx.roomW * 0.42);
    const fh = 40;
    const bg = new Graphics();
    bg.roundRect(0, 0, fw, fh, 12).fill({ color: COLORS.card, alpha: 0.92 }).stroke({ width: 2, color: COLORS.cardEdge });
    c.addChild(bg);

    if (!foodEnabled(ctx.state)) {
      const lock = label(`🍽 Кормушка — с ур. ${unlockLevelOf('food')} 🔒`, 12.5, COLORS.inkSoft, '700');
      lock.anchor.set(0, 0.5);
      lock.position.set(12, fh / 2);
      c.addChild(lock);
      return c;
    }

    const cap = foodCap(ctx.state);
    const food = foodLevel(ctx.state);
    const frac = Math.max(0, Math.min(1, food / cap));
    const starving = isStarving(ctx.state);

    const icon = label('🍽', 18, COLORS.ink, '700');
    icon.anchor.set(0.5);
    icon.position.set(18, fh / 2);
    c.addChild(icon);

    const barX = 32, barW = fw - 132, barY = fh / 2 - 7, barH = 14;
    const barBg = new Graphics();
    barBg.roundRect(barX, barY, barW, barH, 7).fill({ color: 0x000000, alpha: 0.15 });
    const col = starving ? 0xd9534f : frac < 0.25 ? 0xe0a13a : 0x6cc07a;
    const barFill = new Graphics();
    barFill.roundRect(barX, barY, Math.max(3, barW * frac), barH, 7).fill({ color: col });
    c.addChild(barBg, barFill);

    const mins = foodMinutesLeft(ctx.state);
    const amt = label(mins === Infinity ? `${Math.round(food)}/${cap}` : `~${Math.round(mins)} мин`, 11, COLORS.ink, '700');
    amt.anchor.set(0.5);
    amt.position.set(barX + barW / 2, fh / 2);
    c.addChild(amt);

    const full = food >= cap;
    const afford = ctx.state.coins >= FOOD_PACK_COST;
    const btn = new Button({
      text: full ? 'полно' : `＋${FOOD_PACK_COST}💰`,
      w: 86, h: 30, color: full ? COLORS.cardEdge : COLORS.good,
      textColor: full || !afford ? COLORS.inkSoft : 0xffffff, fontSize: 13,
    });
    btn.enabled = !full && afford;
    btn.position.set(fw - 48, fh / 2);
    btn.onTap = () => {
      const r = buyFood(ctx.state, 'pack');
      if (r.ok) { ctx.commit(); ctx.toast(`Корм +${r.added} 🍽`); }
      else ctx.toast(r.reason);
    };
    c.addChild(btn);
    return c;
  }

  function refresh(): void {
    shell.body.removeChildren();
    // заполненность комнаты: без слотовых (инкубатор) и без чемпионов (выставка)
    const count = roomCount(ctx.state, 'nursery');
    const cap = nurseryCapacity(ctx.state);
    // вместимость комнаты — счётчиком справа в плашке названия
    shell.setTitleBadge(`🐱 ${count}/${cap}`);

    const cost = buyCatCost(ctx.state);
    const buy = new Button({
      text: cost === 0 ? '🛒 Котик (бесплатно)' : `🛒 Купить котика (${cost} 💰)`,
      w: 220, h: 40, color: COLORS.good, fontSize: 14,
    });
    buy.enabled = count < cap && ctx.state.coins >= cost;
    buy.position.set(shell.contentW - 114, 16);
    buy.onTap = () => {
      const r = buyCat(ctx.state, ctx.rng, ctx.now());
      if (r.ok) { ctx.commit(); ctx.toast('Новый котик в питомнике 🐱'); }
      else ctx.toast(r.reason);
    };
    shell.body.addChild(buy);

    // кормушка — слева в шапке (напротив кнопки покупки кота)
    const feeder = buildFeeder();
    feeder.position.set(0, 16);
    shell.body.addChild(feeder);

    refreshChampions();
    refreshClinic(); // замок станции снимается, когда уровень дорастает
    floor.refresh();
  }

  return {
    id: 'nursery', title: '🏆 Питомник', container: shell.container,
    refresh, tick: (dt) => floor.tick(dt), tryDropCat,
  };
}
