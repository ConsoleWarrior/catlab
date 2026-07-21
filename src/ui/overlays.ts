/**
 * Оверлеи поверх сцены: меню кота (действия) и панель заказов.
 * Возвращают Container с панелью; центрирование и затемнение — на Game.
 */

import { Container, Graphics, Sprite, Text } from 'pixi.js';
import type { Cat, BirthEvent, Ancestor, LiveRoom } from '../game/index.js';
import {
  isBusy, isInSlot, clearBreederSlot, moveCat, keepKittenWithParents,
  claimOrder, matchesOrder, renameCat,
  basketCat, adRefreshOrder, msUntilOrderExpiry, canAdRefreshOrder, msUntilAdRefresh,
  isAdult, growthProgress, growthRemainingMs, isOld, breedsLeft, heartsOf, isSterile,
  roomCount, nurseryCapacity, shelterCapacity, makeCatInstance,
  catAncestors, pedigreeDepth, PEDIGREE_DEPTH, BOOSTS, buyBoost, toggleBoost, boostCharges, activeBoostId,
  adoptCat, adoptReward, speedUpGrowth, adSkipGrowth, speedUpCost, AD_SKIP_MS,
  sendToLab, labReward, shelterTotals, adoptAll, sendAllToLab,
  healCat, HEAL_AD_HEARTS, HEAL_CRYSTAL_PER_HEART,
  freezeCat, cloneCat, disposeCryo, cloneCost, cryoCount, cryoCapacity,
  FREEZE_COIN_COST, FREEZE_CRYSTAL_COST, FREEZE_AD_COOLDOWN_MS,
  analyzeCat, analyzeCoinCost, KINSHIP_RU,
  pedigreeHasFog, knownAncestorBreeds, buildBreedingContext, breedChanceMult,
  breedDiscovered, knownRecipesFor, outcomeRevealed,
  RESEARCH, unlockResearch, researchLevel, researchNext, researchExtraCoins, canAffordResearch,
  LEVEL_REP_THRESHOLDS, MAX_LEVEL, levelForReputation, // DEV-меню (временное)
} from '../game/index.js';
import { breedName, breedDescription, tierOfBreed, TIER_LEVEL, breedingOutcomes, dormantTraits, traitTag } from '../genetics/index.js';
import { BREEDS, randomCat, RECIPES, recipeKey } from '../genetics/index.js';
import type { UiContext } from './context.js';
import { Button, centerRow, COLORS, FONT, fmt, label, panel, stackWords, stars, TIERS, TIER_RU, TIER_COLOR, UI_SCALE } from './theme.js';
import { describeCat, catTraits, describeReq, describeRecipe, pct } from './describe.js';
import { catSprite, breedThumbTexture } from './catTextures.js';

/**
 * Поле ввода текста поверх канваса (HTML-оверлей). Надёжнее window.prompt
 * (тот блокируется в части окружений) и даёт мобильную клавиатуру.
 * onDone(null) — отмена, иначе строка из поля.
 */
function askText(title: string, initial: string, maxLen: number, onDone: (v: string | null) => void): void {
  const wrap = document.createElement('div');
  wrap.style.cssText = 'position:fixed;inset:0;z-index:1000;display:flex;align-items:center;'
    + 'justify-content:center;background:rgba(42,35,32,.55);font-family:system-ui,sans-serif;';
  const box = document.createElement('div');
  box.style.cssText = 'background:#fffaf3;padding:18px;border-radius:16px;display:flex;flex-direction:column;'
    + 'gap:12px;min-width:240px;box-shadow:0 10px 32px rgba(0,0,0,.3);';
  const lab = document.createElement('div');
  lab.textContent = title;
  lab.style.cssText = 'font-weight:700;color:#5a4a42;font-size:16px;';
  const input = document.createElement('input');
  input.type = 'text';
  input.maxLength = maxLen;
  input.value = initial;
  input.style.cssText = 'font-size:18px;padding:9px 11px;border:2px solid #e9d8c6;border-radius:10px;'
    + 'outline:none;color:#5a4a42;background:#fff;';
  const row = document.createElement('div');
  row.style.cssText = 'display:flex;gap:8px;justify-content:flex-end;';
  const cancel = document.createElement('button');
  cancel.textContent = 'Отмена';
  cancel.style.cssText = 'font-size:15px;font-weight:700;padding:8px 16px;border:none;border-radius:10px;'
    + 'cursor:pointer;background:#e9d8c6;color:#5a4a42;';
  const ok = document.createElement('button');
  ok.textContent = 'OK';
  ok.style.cssText = 'font-size:15px;font-weight:700;padding:8px 16px;border:none;border-radius:10px;'
    + 'cursor:pointer;background:#ff9eb5;color:#fff;';
  row.append(cancel, ok);
  box.append(lab, input, row);
  wrap.append(box);
  document.body.append(wrap);
  input.focus();
  input.select();

  let done = false;
  const finish = (v: string | null): void => { if (done) return; done = true; wrap.remove(); onDone(v); };
  ok.onclick = () => finish(input.value);
  cancel.onclick = () => finish(null);
  wrap.onpointerdown = (e) => { if (e.target === wrap) finish(null); };
  input.onkeydown = (e) => {
    if (e.key === 'Enter') finish(input.value);
    else if (e.key === 'Escape') finish(null);
  };
}

/**
 * DEV: HTML-оверлей с выпадающим списком всех пород (сгруппованы по тиру) и
 * кнопкой «Заспавнить». Спавн выполняет колбэк `spawn`, возвращающий строку
 * статуса (успех/питомник заполнен) — она показывается прямо в оверлее, окно
 * не закрывается, чтобы можно было заспавнить несколько котов подряд.
 */
function askBreedSpawn(spawn: (breedKey: string) => string): void {
  const wrap = document.createElement('div');
  wrap.style.cssText = 'position:fixed;inset:0;z-index:1000;display:flex;align-items:center;'
    + 'justify-content:center;background:rgba(42,35,32,.55);font-family:system-ui,sans-serif;';
  const box = document.createElement('div');
  box.style.cssText = 'background:#fffaf3;padding:18px;border-radius:16px;display:flex;flex-direction:column;'
    + 'gap:12px;min-width:260px;box-shadow:0 10px 32px rgba(0,0,0,.3);';
  const lab = document.createElement('div');
  lab.textContent = '🐈 Заспавнить породу в питомник';
  lab.style.cssText = 'font-weight:700;color:#5a4a42;font-size:16px;';
  const select = document.createElement('select');
  select.style.cssText = 'font-size:16px;padding:9px 11px;border:2px solid #e9d8c6;border-radius:10px;'
    + 'outline:none;color:#5a4a42;background:#fff;';
  for (const tier of TIERS) {
    const group = document.createElement('optgroup');
    group.label = TIER_RU[tier];
    for (const b of BREEDS.filter((x) => x.tier === tier)) {
      const opt = document.createElement('option');
      opt.value = b.key;
      opt.textContent = b.name;
      group.append(opt);
    }
    if (group.children.length) select.append(group);
  }
  const status = document.createElement('div');
  status.style.cssText = 'font-size:14px;font-weight:700;color:#5a4a42;min-height:18px;';
  const row = document.createElement('div');
  row.style.cssText = 'display:flex;gap:8px;justify-content:flex-end;';
  const close = document.createElement('button');
  close.textContent = 'Закрыть';
  close.style.cssText = 'font-size:15px;font-weight:700;padding:8px 16px;border:none;border-radius:10px;'
    + 'cursor:pointer;background:#e9d8c6;color:#5a4a42;';
  const ok = document.createElement('button');
  ok.textContent = 'Заспавнить';
  ok.style.cssText = 'font-size:15px;font-weight:700;padding:8px 16px;border:none;border-radius:10px;'
    + 'cursor:pointer;background:#ff9eb5;color:#fff;';
  row.append(close, ok);
  box.append(lab, select, status, row);
  wrap.append(box);
  document.body.append(wrap);
  select.focus();

  let done = false;
  const finish = (): void => { if (done) return; done = true; wrap.remove(); };
  ok.onclick = () => { status.textContent = spawn(select.value); };
  close.onclick = finish;
  wrap.onpointerdown = (e) => { if (e.target === wrap) finish(); };
  window.addEventListener('keydown', function esc(e) {
    if (e.key === 'Escape') { finish(); window.removeEventListener('keydown', esc); }
  });
}

function rewardText(r: { coins: number; crystals: number; dna: number; reputation: number }): string {
  const p: string[] = [];
  if (r.coins) p.push(`💰${r.coins}`);
  if (r.crystals) p.push(`💎${r.crystals}`);
  if (r.dna) p.push(`🧬${r.dna}`);
  if (r.reputation) p.push(`⭐${r.reputation}`);
  return p.join('  ');
}

/** Оверлей-инструкция «Как играть». */
export function buildHelpPanel(ctx: UiContext, close: () => void): Container {
  const W = Math.min(ctx.roomW - 40, 640);
  const pad = 24;
  const root = new Container();

  const steps = [
    '🧬 Вязка. В Питомнике тапни котика → «Выбрать для вязки» (нужны ♀ и ♂). Затем в Инкубаторе нажми «Свести» и дождись таймера — родится котёнок.',
    '🛡 Усилители. У названия Инкубатора — чипы генной инженерии: активируй за 🧬 гены или 💎 кристаллы. Заряженный усилитель сработает на следующей вязке.',
    '🏆 Питомник. Ценные коты приносят пассивный доход 💰/мин. Тап по коту открывает меню действий.',
    '🏠 Приют. Обычных котиков пристраивай «в добрые руки» — получишь 💰 и 🧬 ДНК.',
    '🔬 Генолаб. Котодекс — рецептурник пород: тапни изученную породу и узнай её рецепты. «Улучшения» — постоянные бонусы, «Исследования» — стол, открывающий новые рецепты.',
    '🧬 Знания. Родословная скрыта туманом «???» — Генетический анализ вскроет предков и скрытые гены. Кнопка 🔮 в инкубаторе покажет шансы пары.',
    '📋 Заказы. Приведи кота нужной породы или редкости → 💰, 💎 и опыт ⭐.',
    '⭐ Опыт и уровень. Опыт дают рождения, продажи по заказам, пристройство и лаборатория. Новый уровень лаборатории открывает слоты вязки, пьедесталы, станции и исследования.',
    '🛒 Нет котиков? В Питомнике купи простого. Если котов нет совсем — первый бесплатно.',
    '👆 Листай комнаты свайпом ← → или стрелками по бокам.',
  ];

  const title = label('🐾 Как играть', 22, COLORS.ink, '800');
  let y = 58;
  const texts: Text[] = [];
  for (const s of steps) {
    const t = new Text({
      text: s,
      style: {
        fontFamily: FONT, fontSize: 15, fontWeight: '600', fill: COLORS.ink,
        wordWrap: true, wordWrapWidth: W - pad * 2, lineHeight: 21, align: 'left',
      },
    });
    t.anchor.set(0, 0);
    t.position.set(pad, y);
    texts.push(t);
    y += t.height + 11;
  }

  const closeBtn = new Button({ text: 'Понятно!', w: 200, h: 46, color: COLORS.primary, fontSize: 16 });
  closeBtn.position.set(W / 2, y + 28);
  closeBtn.onTap = close;

  const H = y + 58;
  root.addChild(panel(W, H, COLORS.hud, 18));
  title.position.set(W / 2, 32);
  root.addChild(title, ...texts, closeBtn);
  return root;
}

/**
 * Карточка рождения: показывает новорождённого (облик, пол, редкость, родословную).
 * Если родилось несколько — листаем по одному кнопкой «Следующий».
 */
export function buildBirthCard(ctx: UiContext, events: BirthEvent[], close: () => void): Container {
  const births = events.filter((e) => e.kitten);
  const W = 360;
  const root = new Container();
  let idx = 0;

  const render = (): void => {
    root.removeChildren();
    const ev = births[idx]!;
    const cat = ev.kitten!;

    const title = label(
      births.length > 1 ? `🎉 Пополнение! (${idx + 1}/${births.length})` : '🎉 Малыш родился!',
      19, COLORS.ink, '800',
    );
    title.position.set(W / 2, 30);

    // «колыбель» под спрайтом, рамка в цвет тира
    const boxY = 52;
    const boxH = 150;
    const cradle = new Graphics();
    cradle.roundRect(W / 2 - 82, boxY, 164, boxH, 18)
      .fill({ color: COLORS.card })
      .stroke({ width: 3, color: TIER_COLOR[cat.rarityTier], alpha: 0.85 });

    const sp = catSprite(ctx.app, cat, boxH * 0.78);
    sp.position.set(W / 2, boxY + boxH - 14);

    let y = boxY + boxH + 18;
    // двусловное название породы — в две строки (привязка по верху, сдвигаем y на высоту)
    const name = label(stackWords(breedName(cat.breed)), 19, COLORS.ink, '800');
    name.anchor.set(0.5, 0);
    name.position.set(W / 2, y); y += name.height + 6;

    const st = stars(cat.rarityTier, 16);
    st.position.set(W / 2, y); y += 22;

    const tierT = label(TIER_RU[cat.rarityTier], 13, TIER_COLOR[cat.rarityTier], '800');
    tierT.position.set(W / 2, y); y += 22;

    const grow = label('пол и имя проявятся, когда подрастёт 🌱', 12, COLORS.inkSoft, '600');
    grow.position.set(W / 2, y); y += 24;

    const extra: Container[] = [];
    if (ev.motherBreed && ev.fatherBreed) {
      const line = label(
        `от: ${breedName(ev.motherBreed)} ♀ × ${breedName(ev.fatherBreed)} ♂`,
        12, COLORS.inkSoft, '600',
      );
      line.position.set(W / 2, y); extra.push(line); y += 22;

      const parentMax = Math.max(
        TIER_LEVEL[tierOfBreed(ev.motherBreed)],
        TIER_LEVEL[tierOfBreed(ev.fatherBreed)],
      );
      if (TIER_LEVEL[cat.rarityTier] > parentMax) {
        const up = label('🌟 редкость выше родителей!', 13, COLORS.good, '800');
        up.position.set(W / 2, y); extra.push(up); y += 24;
      }
    }
    y += 8;

    const last = idx >= births.length - 1;
    const advance = (): void => { if (last) close(); else { idx++; render(); } };
    // малыш сидит в слоте инкубатора (его держит collectReady) — значит доступен
    // вариант «оставить с родителями». Для DEV-рождений (не из слота) его не будет.
    const held = ctx.state.slots.some((s) => s.kittenId === cat.id);

    // всплывающая исчезающая надпись «нет места» у кнопки переполненной комнаты
    const flashNoSpace = (atY: number): void => {
      const t = label('нет места', 16, 0xe06a6a, '800');
      t.position.set(W / 2, atY);
      root.addChild(t);
      let life = 0;
      const fn = (tk: { deltaMS: number }): void => {
        if (t.destroyed) { ctx.app.ticker.remove(fn); return; }
        const d = tk.deltaMS / 1000;
        life += d;
        t.y -= d * 26;
        t.alpha = Math.max(0, 1 - life / 0.9);
        if (life >= 0.9) { ctx.app.ticker.remove(fn); t.destroy(); }
      };
      ctx.app.ticker.add(fn);
    };

    const btns: Container[] = [];

    // «В питомник» / «В приют» с текущей заполненностью; если места нет — кнопка не
    // срабатывает и над ней вспыхивает «нет места».
    const mkPlace = (text: string, color: number, room: 'nursery' | 'shelter'): Button => {
      const b = new Button({ text, w: W - 60, h: 46, color, fontSize: 16 });
      b.position.set(W / 2, y + 23);
      b.onTap = () => {
        const r = moveCat(ctx.state, cat.id, room);
        if (!r.ok) { flashNoSpace(b.y - 4); return; }
        ctx.commit();
        ctx.toast(room === 'shelter' ? 'Малыш в приюте 🏠' : 'Малыш в питомнике 🏆');
        advance();
      };
      y += 54;
      return b;
    };
    btns.push(mkPlace(
      `🏠 В питомник (${roomCount(ctx.state, 'nursery')}/${nurseryCapacity(ctx.state)})`,
      COLORS.primary, 'nursery',
    ));
    btns.push(mkPlace(
      `🏚️ В приют (${roomCount(ctx.state, 'shelter')}/${shelterCapacity(ctx.state)})`,
      COLORS.secondary, 'shelter',
    ));

    // Крайний случай (мест нигде нет): оставить малыша с родителями в слоте — он
    // растёт втрое медленнее и блокирует слот, пока его не унесут в комнату.
    if (held) {
      const keep = new Button({
        text: '🐾 Оставить с родителями', w: W - 60, h: 44, color: COLORS.warn,
        textColor: COLORS.ink, fontSize: 15,
      });
      keep.position.set(W / 2, y + 22);
      keep.onTap = () => {
        keepKittenWithParents(ctx.state, cat.id, ctx.now());
        ctx.commit();
        ctx.toast('Малыш остался с роднёй 🐾 (растёт медленно)');
        advance();
      };
      btns.push(keep);
      y += 52;
    }

    root.addChild(panel(W, y, COLORS.hud, 18), title, cradle, sp, name, st, tierT, grow, ...extra, ...btns);
  };

  render();
  return root;
}

/**
 * Всплывающее меню усилителя вязки («Генная инженерия», кнопки у названия
 * Инкубатора): описание буста + две кнопки активации — за 🧬 гены или 💎
 * кристаллы. После активации усилитель «горит» и сработает на первой же
 * следующей вязке (в любом слоте). Перерисовывается на месте после оплаты.
 */
export function buildBoostMenu(ctx: UiContext, boostId: string, close: () => void): Container {
  const def = BOOSTS.find((b) => b.id === boostId);
  const W = 320;
  const root = new Container();
  if (!def) { root.addChild(panel(W, 80, COLORS.hud, 18)); return root; }

  const render = (): void => {
    root.removeChildren();
    const charges = boostCharges(ctx.state, def.id);       // склад зарядов этого усилителя
    const activeId = activeBoostId(ctx.state);             // какой усилитель активен (или нет)
    const active = activeId === def.id;                    // активен именно этот
    const activeDef = activeId ? BOOSTS.find((b) => b.id === activeId) : undefined;
    const items: Container[] = [];

    const title = label(`${def.glyph} ${def.label}`, 19, COLORS.ink, '800');
    title.position.set(W / 2, 30);
    items.push(title);

    const desc = new Text({
      text: def.desc,
      style: {
        fontFamily: FONT, fontSize: 14, fontWeight: '600', fill: COLORS.inkSoft,
        align: 'center', wordWrap: true, wordWrapWidth: W - 48, lineHeight: 19,
      },
    });
    desc.anchor.set(0.5, 0);
    desc.position.set(W / 2, 48);
    items.push(desc);
    let y = 48 + desc.height + 14;

    // Склад зарядов (не зависит от активности — заряды копятся, тратятся в вязке).
    const stock = label(
      charges > 0 ? `📦 В запасе: ×${charges}` : '📦 В запасе: нет зарядов',
      13, charges > 0 ? COLORS.ink : COLORS.inkSoft, '800',
    );
    stock.position.set(W / 2, y);
    items.push(stock);
    y += 22;

    // Статус активности: активен сейчас / заряжён, но не активен / другой активен.
    const status = label(
      active
        ? '⚡ активен · сработает на следующей вязке'
        : charges > 0
          ? (activeDef ? `не активен · сейчас активен ${activeDef.glyph} ${activeDef.label}` : 'не активен · включи, чтобы работал')
          : 'нет зарядов · сначала заряди',
      12, active ? COLORS.good : COLORS.inkSoft, '700',
    );
    status.position.set(W / 2, y);
    items.push(status);
    y += 20;

    // Правило: одновременно активен только один усилитель.
    const rule = label('⚖️ Активен только один усилитель за раз', 11, COLORS.inkSoft, '600');
    rule.position.set(W / 2, y);
    items.push(rule);
    y += 22;

    const buyWith = (currency: 'dna' | 'crystals'): void => {
      const r = buyBoost(ctx.state, def.id, currency);
      if (r.ok) { ctx.commit(); ctx.toast(`${def.glyph} ${def.label}: +1 заряд`); render(); }
      else ctx.toast(r.reason);
    };

    const pad = 24, gap = 12;
    // Зарядка (любых типов, помногу) — доступна всегда.
    const bw = (W - pad * 2 - gap) / 2;
    const geneBtn = new Button({ text: `Заряд\n🧬 ${def.dna}`, w: bw, h: 54, color: COLORS.dna, fontSize: 14 });
    geneBtn.enabled = ctx.state.dna >= def.dna;
    geneBtn.onTap = () => buyWith('dna');
    geneBtn.position.set(pad + bw / 2, y + 27);
    const crysBtn = new Button({ text: `Заряд\n💎 ${def.crystals}`, w: bw, h: 54, color: COLORS.crystals, fontSize: 14 });
    crysBtn.enabled = ctx.state.crystals >= def.crystals;
    crysBtn.onTap = () => buyWith('crystals');
    crysBtn.position.set(pad + bw + gap + bw / 2, y + 27);
    items.push(geneBtn, crysBtn);
    y += 66;

    // Переключатель активности (заряды НЕ тратит). Активировать можно только при
    // наличии зарядов; активный — выключить. Включение снимает активность с другого.
    const toggleBtn = new Button({
      text: active ? '🟢 Активен · выключить' : charges > 0 ? '⚡ Сделать активным' : 'Заряди, чтобы активировать',
      w: W - pad * 2, h: 42,
      color: active ? COLORS.good : charges > 0 ? COLORS.primary : COLORS.cardEdge,
      textColor: active || charges > 0 ? 0xffffff : COLORS.inkSoft, fontSize: 14.5,
    });
    toggleBtn.enabled = active || charges > 0;
    toggleBtn.position.set(W / 2, y + 21);
    toggleBtn.onTap = () => {
      const wasActive = active;
      const r = toggleBoost(ctx.state, def.id);
      if (!r.ok) { ctx.toast(r.reason === 'нет зарядов' ? 'Нет зарядов — сначала заряди' : r.reason); return; }
      ctx.commit();
      ctx.toast(wasActive ? `${def.glyph} ${def.label} выключен` : `${def.glyph} ${def.label} активен ⚡`);
      render();
    };
    items.push(toggleBtn);
    y += 52;

    const closeBtn = new Button({ text: 'Закрыть', w: W - pad * 2, h: 40, color: COLORS.cardEdge, textColor: COLORS.ink, fontSize: 14 });
    closeBtn.position.set(W / 2, y + 20);
    closeBtn.onTap = close;
    items.push(closeBtn);
    y += 50;

    root.addChild(panel(W, y, COLORS.hud, 18), ...items);
  };

  render();
  return root;
}

/**
 * Подтверждение покупки улучшения (узел дерева «Улучшения» в Генолабе). Открывается
 * тапом по доступному узлу — чтобы случайный тап не тратил валюту. Показывает эффект
 * уровня, цену и баланс; «Купить» активна только при достатке средств.
 */
export function buildResearchConfirm(ctx: UiContext, defId: string, close: () => void): Container {
  const W = 340;
  const root = new Container();
  const def = RESEARCH.find((r) => r.id === defId);
  if (!def) { root.addChild(panel(W, 80, COLORS.hud, 18)); return root; }

  const owned = researchLevel(ctx.state, def.id);
  const total = def.levels.length;
  const next = researchNext(ctx.state, def);
  const curColor = def.currency === 'dna' ? COLORS.dna : COLORS.coins;
  const curGlyph = def.currency === 'dna' ? '🧬' : '💰';
  const balance = def.currency === 'dna' ? ctx.state.dna : ctx.state.coins;
  const cost = next?.cost ?? 0;
  const extraCoins = researchExtraCoins(def, next); // доп. 💰 у Селекции (сверх 🧬)
  const afford = canAffordResearch(ctx.state, def, next);
  const items: Container[] = [];

  let y = 24;
  const title = label(`${def.glyph} ${def.title}`, 20, COLORS.ink, '800');
  title.position.set(W / 2, y); items.push(title); y += 26;

  if (total > 1) {
    const lvl = label(`Уровень ${owned + 1} из ${total}`, 13, COLORS.inkSoft, '700');
    lvl.position.set(W / 2, y); items.push(lvl); y += 24;
  }

  const desc = new Text({
    text: next?.desc ?? def.desc,   // описание покупаемого уровня (с итогом), иначе общий
    style: {
      fontFamily: FONT, fontSize: 15, fontWeight: '600', fill: COLORS.ink,
      align: 'center', wordWrap: true, wordWrapWidth: W - 48, lineHeight: 20,
    },
  });
  desc.anchor.set(0.5, 0);
  desc.position.set(W / 2, y); items.push(desc);
  y += desc.height + 16;

  const priceText = extraCoins > 0 ? `Цена: ${curGlyph} ${cost} + 💰 ${extraCoins}` : `Цена: ${curGlyph} ${cost}`;
  const price = label(priceText, 17, afford ? curColor : COLORS.warn, '800');
  price.position.set(W / 2, y); items.push(price); y += 24;
  const balText = extraCoins > 0
    ? `У вас: ${curGlyph} ${fmt(balance)} · 💰 ${fmt(ctx.state.coins)}`
    : `У вас: ${curGlyph} ${fmt(balance)}`;
  const bal = label(balText, 13, COLORS.inkSoft, '700');
  bal.position.set(W / 2, y); items.push(bal); y += 30;

  const pad = 24, gap = 12;
  const bw = (W - pad * 2 - gap) / 2;
  const noBtn = new Button({ text: 'Отмена', w: bw, h: 50, color: COLORS.cardEdge, textColor: COLORS.ink, fontSize: 16 });
  noBtn.onTap = close;
  noBtn.position.set(pad + bw / 2, y + 25);
  const buyBtn = new Button({ text: afford ? 'Купить' : 'Не хватает', w: bw, h: 50, color: curColor, fontSize: 16 });
  buyBtn.enabled = afford;
  buyBtn.onTap = () => {
    const r = unlockResearch(ctx.state, def.id);
    if (!r.ok) {
      ctx.toast(
        r.reason === 'locked' ? 'Улучшения ещё заперты 🔒'
          : r.reason === 'не хватает ДНК' ? 'Не хватает 🧬 ДНК'
            : r.reason === 'не хватает монет' ? 'Не хватает 💰 монет' : r.reason,
      );
      return;
    }
    ctx.commit();
    const lvlNow = researchLevel(ctx.state, def.id);
    ctx.toast(total > 1 ? `${def.glyph} ${def.title} · ур. ${lvlNow}/${total} ✅`
      : `${def.glyph} ${def.title} изучено ✅`);
    close();
  };
  buyBtn.position.set(pad + bw + gap + bw / 2, y + 25);
  items.push(noBtn, buyBtn);
  y += 60;

  root.addChild(panel(W, y, COLORS.hud, 18), ...items);
  return root;
}

/**
 * Табличка котёнка: пока малыш не вырос — порода, редкость и шкала времени до
 * взросления (заполняется в реальном времени). Имя/пол и действия вязки скрыты,
 * проявятся, когда котёнок повзрослеет. По взрослении карточка сама переключится.
 */
type AddBtn = (text: string, color: number, enabled: boolean, onTap: () => void) => void;

/**
 * Кнопки переезда кота между комнатами. Кот, стоящий в слоте вязки, относится
 * к обеим комнатам сразу — показываем обе кнопки; иначе одну (в ту комнату, где
 * кота сейчас нет). addBtn — помощник конкретной карточки (он же двигает y вниз).
 */
function addMoveButtons(ctx: UiContext, cat: Cat, close: () => void, addBtn: AddBtn): void {
  const inSlot = isInSlot(ctx.state, cat.id);
  const move = (room: LiveRoom, text: string, color: number): void => {
    addBtn(text, color, true, () => {
      const r = moveCat(ctx.state, cat.id, room);
      if (!r.ok) { ctx.toast(r.reason); return; }
      clearBreederSlot(ctx.state, cat.id); // если стоял в слоте — снять со слота
      close(); ctx.commit();
      ctx.toast(room === 'nursery' ? 'Котик в питомнике 🏆' : 'Котик в приюте 🏚️');
    });
  };
  if (inSlot || cat.location === 'shelter') move('nursery', '🏠 В питомник', COLORS.primary);
  if (inSlot || cat.location === 'nursery') move('shelter', '🏚️ В приют', COLORS.secondary);
}

function buildKittenCard(ctx: UiContext, cat: Cat, close: () => void): Container {
  const W = 340;
  const root = new Container();
  const tierCol = TIER_COLOR[cat.rarityTier];

  const title = label(stackWords(breedName(cat.breed)), 19, tierCol, '800');
  title.anchor.set(0.5, 0);
  title.position.set(W / 2, 16);

  let y = 16 + title.height + 16;
  const st = stars(cat.rarityTier, 15);
  st.position.set(W / 2, y); y += 22;
  const tierT = label(`🍼 котёнок · ${TIER_RU[cat.rarityTier]}`, 13, tierCol, '800');
  tierT.position.set(W / 2, y); y += 22;
  const hint = label('пол и имя проявятся, когда подрастёт 🌱', 12, COLORS.inkSoft, '600');
  hint.position.set(W / 2, y); y += 24;

  // шкала взросления (заполняется в реальном времени)
  const barW = W - 60, barH = 14, barX = (W - barW) / 2, barY = y;
  const barBg = new Graphics();
  barBg.roundRect(barX, barY, barW, barH, 7).fill({ color: 0x000000, alpha: 0.08 });
  const bar = new Graphics();
  const timeT = label('', 13, COLORS.ink, '700');
  timeT.position.set(W / 2, barY + barH + 16);
  y = barY + barH + 34;

  // Кнопки: родословная (если известны родители) + переезд (в слоте — обе
  // комнаты) + закрыть. Малыш не занимает место навсегда — его можно переселить.
  const controls: Container[] = [];
  const btnW = W - 60;
  const addBtn: AddBtn = (text, color, _enabled, onTap) => {
    const b = new Button({ text, w: btnW, h: 42, color, fontSize: 15 });
    b.position.set(W / 2, y + 21);
    b.onTap = onTap;
    controls.push(b);
    y += 50;
  };

  if (cat.motherBreed || cat.fatherBreed) {
    addBtn('🌳 Родословная', COLORS.secondary, true, () => ctx.openPedigree(cat));
  }

  // Ускорение роста: реклама (−N мин, бесплатно) и кристаллы (вырастить мгновенно).
  const gcost = speedUpCost(growthRemainingMs(cat, ctx.now()));
  const skipMin = Math.round(AD_SKIP_MS / 60_000);
  addBtn(`📺 Ускорить рост (−${skipMin} мин)`, COLORS.secondary, true, () => {
    const r = adSkipGrowth(ctx.state, cat.id, ctx.now());
    if (!r.ok) { ctx.toast(r.reason); return; }
    ctx.commit(); close(); ctx.openCatMenu(cat);
  });
  addBtn(`💎 Вырастить сразу (${gcost})`, COLORS.primary, true, () => {
    const r = speedUpGrowth(ctx.state, cat.id, ctx.now());
    if (!r.ok) { ctx.toast(r.reason); return; }
    ctx.commit(); close(); ctx.openCatMenu(cat);
  });

  addMoveButtons(ctx, cat, close, addBtn);

  const closeBtn = new Button({ text: 'Закрыть', w: btnW, h: 40, color: COLORS.cardEdge, textColor: COLORS.ink, fontSize: 14 });
  closeBtn.position.set(W / 2, y + 20);
  closeBtn.onTap = close;
  y += 50;

  root.addChild(panel(W, y, COLORS.hud, 18), title, st, tierT, hint, barBg, bar, timeT, ...controls, closeBtn);

  const mmss = (ms: number): string => {
    const s = Math.max(0, Math.ceil(ms / 1000));
    return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
  };
  const redraw = (): void => {
    const p = growthProgress(cat, ctx.now());
    bar.clear();
    bar.roundRect(barX, barY, Math.max(2, barW * p), barH, 7).fill(COLORS.primary);
    timeT.text = `до взросления: ${mmss(growthRemainingMs(cat, ctx.now()))}`;
  };
  redraw();
  // живое обновление шкалы; как только вырос — переоткрываем как взрослого
  const fn = (): void => {
    if (!root.parent) { ctx.app.ticker.remove(fn); return; }
    if (isAdult(cat, ctx.now())) { ctx.app.ticker.remove(fn); close(); ctx.openCatMenu(cat); return; }
    redraw();
  };
  ctx.app.ticker.add(fn);

  return root;
}

/**
 * Дерево родословной кота: колонки-поколения слева направо
 * (сам кот → родители → деды → прадеды). Туман родословной: рисуются только
 * ИЗВЕСТНЫЕ узлы (known), неизвестный предок — серая ячейка «???» без намёка на
 * тир, его поддерево не раскрывается. Вскрыть всё — Генетический анализ (кнопка
 * внизу). Если столбцы не влезают — Game вписывает панель в экран (showOverlay).
 */
export function buildPedigreePanel(ctx: UiContext, cat: Cat, close: () => void): Container {
  const root = new Container();

  const ped = catAncestors(cat);
  const subject: Ancestor = { id: cat.id, breed: cat.breed, known: true, mother: ped.mother, father: ped.father };
  const maxDepth = PEDIGREE_DEPTH; // 0=кот, 1=родители, 2=деды, 3=прадеды

  // геометрия ячеек/колонок; на таче (k=1.2) весь чертёж крупнее — ячейки И текст
  // растут вместе, чтобы длинные названия пород не вылезали. На ПК k=1 (без изменений).
  // Панель всё равно вписывается в экран (fitOverlay), так что полное 4-поколенное
  // дерево на узком экране ужмётся как раньше, а короткие деревья станут читаемее.
  const k = UI_SCALE;
  const cellW = 108 * k, cellH = 42 * k, colGap = 16 * k, rowGap = 9 * k;
  const slotH = cellH + rowGap;
  const padX = 16 * k, padTop = 64 * k, headerY = 46 * k;
  const colX = (d: number): number => padX + d * (cellW + colGap) + cellW / 2;

  type Placed = { node: Ancestor; depth: number; x: number; y: number; isRoot: boolean };
  const placed: Placed[] = [];
  const links: Array<[number, number, number, number]> = []; // x1,y1,x2,y2
  let leafIndex = 0;
  let usedDepth = 0;

  const layout = (node: Ancestor, depth: number, isRoot: boolean): number => {
    usedDepth = Math.max(usedDepth, depth);
    const kids: Ancestor[] = [];
    // в поддерево неизвестного узла не заглядываем — «???» схлопывает ветку
    if (depth < maxDepth && node.known) {
      if (node.mother) kids.push(node.mother);
      if (node.father) kids.push(node.father);
    }
    let y: number;
    if (kids.length === 0) {
      y = padTop + (leafIndex + 0.5) * slotH;
      leafIndex++;
    } else {
      const ys = kids.map((k) => layout(k, depth + 1, false));
      y = ys.reduce((a, b) => a + b, 0) / ys.length;
      for (const cy of ys) links.push([colX(depth) + cellW / 2, y, colX(depth + 1) - cellW / 2, cy]);
    }
    placed.push({ node, depth, x: colX(depth), y, isRoot });
    return y;
  };
  layout(subject, 0, true);

  const W = padX * 2 + (usedDepth + 1) * cellW + usedDepth * colGap;
  const treeBottom = padTop + leafIndex * slotH;
  const known = pedigreeDepth(cat); // поколений предков в данных (включая туман)
  const fog = pedigreeHasFog(cat);  // есть ли скрытые узлы — предложим анализ

  // соединители (рисуем под ячейками)
  const wires = new Graphics();
  for (const [x1, y1, x2, y2] of links) {
    const midX = (x1 + x2) / 2;
    wires.moveTo(x1, y1).lineTo(midX, y1).lineTo(midX, y2).lineTo(x2, y2);
  }
  wires.stroke({ width: 1.5, color: COLORS.cardEdge, alpha: 0.9 });

  // ячейка-предок: рамка в цвет тира + точка тира + имя породы (с переносом);
  // узел в тумане — серый «🔒 ???» БЕЗ цвета тира (не подсказываем редкость)
  const cell = (p: Placed): Container => {
    const c = new Container();
    const hidden = !p.isRoot && !p.node.known;
    const col = hidden ? COLORS.cardEdge : TIER_COLOR[tierOfBreed(p.node.breed)];
    const g = new Graphics();
    g.roundRect(-cellW / 2, -cellH / 2, cellW, cellH, 9)
      .fill({ color: p.isRoot ? COLORS.card : COLORS.hud, alpha: hidden ? 0.7 : 1 })
      .stroke({ width: p.isRoot ? 3 : 2, color: col, alpha: hidden ? 0.8 : 0.95 });
    g.circle(-cellW / 2 + 11 * k, 0, 4 * k).fill({ color: col });
    const name = hidden ? '🔒 ???'
      : p.isRoot ? (cat.name?.trim() || breedName(p.node.breed)) : breedName(p.node.breed);
    const t = new Text({
      text: name,
      style: {
        fontFamily: FONT, fontSize: 11 * k, fontWeight: '700', fill: hidden ? COLORS.inkSoft : COLORS.ink,
        wordWrap: true, breakWords: true, wordWrapWidth: cellW - 26 * k, lineHeight: 12 * k, align: 'center',
      },
    });
    t.anchor.set(0.5);
    t.position.set(5 * k, 0);
    c.addChild(g, t);
    c.position.set(p.x, p.y);
    return c;
  };

  // заголовки колонок поколений
  const COL_RU = ['', 'родители', 'деды', 'прадеды'];
  const headers: Container[] = [];
  for (let d = 1; d <= usedDepth; d++) {
    const h = label(COL_RU[d] ?? '', 12, COLORS.inkSoft, '800');
    h.position.set(colX(d), headerY);
    headers.push(h);
  }

  const title = label('🌳 Родословная', 18, COLORS.ink, '800');
  title.position.set(W / 2, 26 * k);

  let y = treeBottom + 8;
  const footer: Container[] = [];
  const footNote = (text: string, color: number): void => {
    const t = new Text({
      text,
      style: {
        fontFamily: FONT, fontSize: 11 * k, fontWeight: '600', fill: color,
        align: 'center', wordWrap: true, wordWrapWidth: W - 28 * k, lineHeight: 15 * k,
      },
    });
    t.anchor.set(0.5, 0);
    t.position.set(W / 2, y + 2);
    footer.push(t);
    y += t.height + 8;
  };

  if (cat.analyzed) {
    // анализ сделан: показываем «скрытые гены» как признаки, дремлющие в родословной
    // (есть у предков, но не у самой породы кота) — материал родословных рецептов.
    const hidden = dormantTraits(cat.breed, knownAncestorBreeds(cat));
    footNote(
      hidden.length > 0
        ? `🧬 скрытые гены: ${hidden.map(traitTag).join(' · ')}`
        : '🧬 скрытых генов в роду нет — родословная чистая по признакам',
      hidden.length > 0 ? COLORS.ink : COLORS.inkSoft,
    );
  } else if (fog) {
    footNote('узлы «???» скрыты — Генетический анализ вскроет всю родословную и скрытые гены', COLORS.inkSoft);
    const anBtn = new Button({ text: '🧬 Анализ', w: 170, h: 40, color: COLORS.dna, fontSize: 14 });
    anBtn.position.set(W / 2, y + 20);
    anBtn.onTap = () => ctx.openAnalyzeConfirm(cat);
    footer.push(anBtn);
    y += 48;
  }
  if (known < maxDepth) {
    footNote('родословная пополняется с каждым поколением', COLORS.inkSoft);
  }

  const closeBtn = new Button({ text: 'Закрыть', w: 160, h: 40, color: COLORS.cardEdge, textColor: COLORS.ink, fontSize: 14 });
  closeBtn.position.set(W / 2, y + 24);
  closeBtn.onTap = close;
  y += 44;

  const H = y;
  root.addChild(panel(W, H, COLORS.hud, 18), title, ...headers, wires);
  for (const p of placed) root.addChild(cell(p));
  root.addChild(...footer, closeBtn);
  return root;
}

/**
 * Подтверждение Генетического анализа (система знаний, этап B): вскрывает СРАЗУ
 * всю родословную кота и его скрытые гены (породы предков). Механику не меняет —
 * скрытые гены работали и до анализа. Оплата 💰 (цена по тиру) или 📺 (без кулдауна).
 * После успеха открывает родословную — показать игроку, что он купил.
 */
export function buildAnalyzeConfirm(ctx: UiContext, cat: Cat, close: () => void): Container {
  const W = 340;
  const root = new Container();

  const title = label('🧬 Генетический анализ', 18, COLORS.ink, '800');
  title.position.set(W / 2, 28);
  const sub = label('вскроет родословную и скрытые гены', 12.5, COLORS.inkSoft, '700');
  sub.position.set(W / 2, 50);

  const sp = catSprite(ctx.app, cat, 84);
  sp.position.set(W / 2, 158);
  const who = label(cat.name?.trim() || describeCat(cat), 14, TIER_COLOR[cat.rarityTier], '800');
  who.position.set(W / 2, 180);

  const note = new Text({
    text: 'Знание не меняет исход вязок — скрытые гены работали и в тумане. '
      + 'Анализ раскрывает родословную и признаки предков для рецептов и превью пары.',
    style: {
      fontFamily: FONT, fontSize: 11.5, fontWeight: '600', fill: COLORS.inkSoft,
      align: 'center', wordWrap: true, wordWrapWidth: W - 48, lineHeight: 16,
    },
  });
  note.anchor.set(0.5, 0);
  note.position.set(W / 2, 200);

  let y = 200 + note.height + 14;
  root.addChild(title, sub, sp, who, note);

  const btnW = W - 48;
  const done = (): void => { ctx.commit(); ctx.toast('Анализ готов 🧬 родословная вскрыта'); close(); ctx.openPedigree(cat); };

  // 💰 основная цена — по тиру кота (породистого анализировать дороже)
  const cost = analyzeCoinCost(cat.rarityTier);
  const afford = ctx.state.coins >= cost;
  const coinBtn = new Button({
    text: `💰 Провести анализ · ${cost}`,
    w: btnW, h: 44, color: afford ? COLORS.primary : COLORS.cardEdge,
    textColor: afford ? 0xffffff : COLORS.inkSoft, fontSize: 15,
  });
  coinBtn.enabled = afford;
  coinBtn.position.set(W / 2, y + 22);
  coinBtn.onTap = () => {
    const r = analyzeCat(ctx.state, cat.id, 'coins', ctx.now());
    if (!r.ok) { ctx.toast(r.reason); return; }
    done();
  };
  root.addChild(coinBtn);
  y += 52;

  // 📺 бесплатная альтернатива (кулдауна больше нет — анализ инфо-действие)
  const adBtn = new Button({
    text: '📺 Бесплатно за рекламу',
    w: btnW, h: 44, color: COLORS.good, textColor: 0xffffff, fontSize: 15,
  });
  adBtn.position.set(W / 2, y + 22);
  adBtn.onTap = () => {
    const r = analyzeCat(ctx.state, cat.id, 'ad', ctx.now());
    if (!r.ok) { ctx.toast(r.reason); return; }
    done();
  };
  root.addChild(adBtn);
  y += 52;

  const closeBtn = new Button({ text: 'Закрыть', w: btnW, h: 40, color: COLORS.cardEdge, textColor: COLORS.ink, fontSize: 14 });
  closeBtn.position.set(W / 2, y + 20);
  closeBtn.onTap = close;
  root.addChild(closeBtn);
  y += 50;

  root.addChildAt(panel(W, y, COLORS.hud, 18), 0);
  return root;
}

/**
 * Карточка породы из Котодекса-рецептурника: портрет (цветной у выведенной,
 * чёрный силуэт у известной только рецептом) + рецепты с условиями и шансами.
 * Открывается тапом по изученной клетке Котодекса.
 */
export function buildBreedCard(ctx: UiContext, breedKey: string, close: () => void): Container {
  const W = 400;
  const root = new Container();
  const tier = tierOfBreed(breedKey);
  const tierCol = TIER_COLOR[tier];
  const opened = breedDiscovered(ctx.state, breedKey);

  const title = label(stackWords(breedName(breedKey)), 19, tierCol, '800');
  title.anchor.set(0.5, 0);
  title.position.set(W / 2, 18);
  root.addChild(title);
  let y = 18 + title.height + 8;

  const st = stars(tier, 15);
  st.position.set(W / 2, y);
  root.addChild(st);
  y += 20;
  const tierT = label(TIER_RU[tier], 12.5, tierCol, '800');
  tierT.position.set(W / 2, y);
  root.addChild(tierT);
  y += 16;

  // портрет породы; не выведена (известен только рецепт) → чёрный силуэт по форме
  const boxH = 110;
  const tex = breedThumbTexture(breedKey);
  if (tex) {
    const sp = new Sprite(tex);
    sp.anchor.set(0.5, 1);
    sp.scale.set(Math.min((boxH * 0.95) / tex.height, (W * 0.5) / tex.width));
    sp.position.set(W / 2, y + boxH);
    if (!opened) sp.tint = 0x241d29; // силуэт: форма породы без окраса
    root.addChild(sp);
  }
  y += boxH + 12;

  const status = label(
    opened ? '✅ порода выведена' : '📜 рецепт изучен — порода ещё не выведена',
    12.5, opened ? COLORS.good : COLORS.inkSoft, '800',
  );
  status.position.set(W / 2, y);
  root.addChild(status);
  y += 24;

  // Рецепты породы: у выведенной — все, у силуэта — только открытые исследованием.
  const recipes = knownRecipesFor(ctx.state, breedKey);
  const addLine = (text: string, size: number, color: number, weight: '600' | '700' | '800', indent = 24): number => {
    const t = new Text({
      text,
      style: {
        fontFamily: FONT, fontSize: size, fontWeight: weight, fill: color,
        wordWrap: true, wordWrapWidth: W - indent - 20, lineHeight: size + 4, align: 'left',
      },
    });
    t.anchor.set(0, 0);
    t.position.set(indent, y);
    root.addChild(t);
    y += t.height + 3;
    return t.height;
  };

  // Энциклопедическая справка о породе (происхождение / факт / главная черта).
  const desc = breedDescription(breedKey);
  if (desc) {
    addLine(`📖 ${desc}`, 12, COLORS.ink, '700');
    y += 8;
  }

  if (recipes.length === 0) {
    addLine(breedKey === 'moggie'
      ? '🐾 Стартовая порода: дворовых котов покупают в питомнике, рецепт не нужен.'
      : '🐾 Рецептов у породы нет.', 12.5, COLORS.inkSoft, '600');
  }
  recipes.forEach((r, i) => {
    if (i > 0) {
      const div = new Graphics();
      div.moveTo(24, y + 3).lineTo(W - 24, y + 3).stroke({ width: 1, color: COLORS.cardEdge, alpha: 0.8 });
      root.addChild(div);
      y += 10;
    }
    // Единый формат карточки: родители → условия (скрытые гены/пол/родословная,
    // инбридинг) → базовый шанс. Справка о породе — выше, над рецептами.
    const { pair, conds } = describeRecipe(r);
    addLine(`🧪 ${pair}`, 13.5, COLORS.ink, '800');
    if (conds.length === 0) addLine('· без доп. условий — только породы родителей', 11.5, COLORS.inkSoft, '700');
    for (const cLine of conds) addLine(`· ${cLine}`, 11.5, COLORS.inkSoft, '700');
    addLine(`базовый шанс: ${pct(r.chance)}`, 12, COLORS.dna, '800');
    y += 4;
  });
  y += 6;

  const closeBtn = new Button({ text: 'Закрыть', w: 180, h: 40, color: COLORS.cardEdge, textColor: COLORS.ink, fontSize: 14 });
  closeBtn.position.set(W / 2, y + 20);
  closeBtn.onTap = close;
  root.addChild(closeBtn);
  y += 50;

  root.addChildAt(panel(W, y, COLORS.hud, 18), 0);
  return root;
}

/**
 * Превью пары «тир-тизер» (этап E системы знаний): распределение исходов вязки —
 * последовательные шансы рецептов + фолбэк-наследование (breedingOutcomes, та же
 * математика, что при рождении). Раскрытый исход показывает породу; нераскрытый —
 * только «❓ тир — X%»: рецепт надо открыть в Котодексе, а скрытые гены пары
 * вскрыть анализом. Заряженный Катализатор и бонусы «Селекции» учтены.
 */
export function buildPairPreview(ctx: UiContext, mother: Cat, father: Cat, close: () => void): Container {
  const W = 380;
  const root = new Container();

  const bctx = buildBreedingContext(mother, father);
  const lucky = boostCharges(ctx.state, 'luckyUp') > 0;
  const outcomes = breedingOutcomes(bctx, lucky, breedChanceMult(ctx.state));

  const title = label('🔮 Прогноз пары', 18, COLORS.ink, '800');
  title.position.set(W / 2, 28);
  root.addChild(title);
  // Самец первым; если пара не влезает в одну строку блока — самка переносится
  // на новую строку (× остаётся хвостом у самца как связка).
  const maleStr = `${father.name?.trim() || breedName(father.breed)} ♂`;
  const femaleStr = `${mother.name?.trim() || breedName(mother.breed)} ♀`;
  const who = label(`${maleStr} × ${femaleStr}`, 12.5, COLORS.inkSoft, '700');
  const twoLineWho = who.width > W - 40;
  if (twoLineWho) who.text = `${maleStr} ×\n${femaleStr}`;
  who.position.set(W / 2, twoLineWho ? 56 : 50);
  root.addChild(who);

  let y = who.y + who.height / 2 + 12;
  if (bctx.kinship !== 'none') {
    const kin = label(`⚠️ родство: ${KINSHIP_RU[bctx.kinship]} — родословные рецепты усилены`, 11.5,
      bctx.kinship === 'critical' ? COLORS.warn : COLORS.inkSoft, '800');
    kin.position.set(W / 2, y);
    root.addChild(kin);
    y += 20;
  }
  if (lucky) {
    const lk = label('🍀 Катализатор заряжен — шансы учтены (×2)', 11.5, COLORS.good, '800');
    lk.position.set(W / 2, y);
    root.addChild(lk);
    y += 20;
  }
  y += 6;

  // строки исходов: 🧪 рецепты (редкие первыми — как бросает игра), затем 🐾 фолбэк
  let anyHidden = false;
  for (const o of outcomes) {
    const revealed = !o.recipe || outcomeRevealed(ctx.state, mother, father, o.recipe);
    if (!revealed) anyHidden = true;
    const tierO = tierOfBreed(o.breed);
    const name = revealed
      ? `${o.recipe ? '🧪' : '🐾'} ${breedName(o.breed)}`
      : `🧪 ❓ ${TIER_RU[tierO]}`;
    const nameT = label(name, 13.5, revealed ? TIER_COLOR[tierO] : COLORS.inkSoft, '800');
    nameT.anchor.set(0, 0.5);
    nameT.position.set(28, y + 9);
    const pctT = label(pct(o.p), 13.5, COLORS.ink, '800');
    pctT.anchor.set(1, 0.5);
    pctT.position.set(W - 28, y + 9);
    root.addChild(nameT, pctT);
    y += 24;
  }
  y += 4;

  const legend = label('🧪 рецепт · 🐾 наследование породы', 11, COLORS.inkSoft, '600');
  legend.position.set(W / 2, y + 6);
  root.addChild(legend);
  y += 20;

  if (anyHidden) {
    const hint = new Text({
      text: '🧬 Генетический анализ обоих котов + рецепт в Котодексе раскроют названия «❓» исходов',
      style: {
        fontFamily: FONT, fontSize: 11, fontWeight: '600', fill: COLORS.inkSoft,
        align: 'center', wordWrap: true, wordWrapWidth: W - 40, lineHeight: 15,
      },
    });
    hint.anchor.set(0.5, 0);
    hint.position.set(W / 2, y + 2);
    root.addChild(hint);
    y += hint.height + 10;
  }

  const closeBtn = new Button({ text: 'Закрыть', w: 180, h: 40, color: COLORS.cardEdge, textColor: COLORS.ink, fontSize: 14 });
  closeBtn.position.set(W / 2, y + 22);
  closeBtn.onTap = close;
  root.addChild(closeBtn);
  y += 52;

  root.addChildAt(panel(W, y, COLORS.hud, 18), 0);
  return root;
}

/** Меню действий над котом. */
export function buildCatMenu(ctx: UiContext, cat: Cat, close: () => void): Container {
  if (!isAdult(cat, ctx.now())) return buildKittenCard(ctx, cat, close);
  const W = 380;
  const root = new Container();
  const busy = isBusy(ctx.state, cat.id);

  const traits = catTraits(cat);
  // +22 — запас на перенос длинной строки «признаки: …» (визитка породы)
  const H = 150 + traits.length * 20 + 22 + (busy ? 28 : 0) + 4 * 54;
  root.addChild(panel(W, H, COLORS.hud, 18));

  const named = cat.name?.trim();
  // Заголовок переносится по словам и не вылезает за карточку (длинные названия
  // пород); двусловное имя — в две строки. Привязка по верху — сдвигаем y на высоту.
  const title = new Text({
    text: named ? stackWords(named) : describeCat(cat),
    style: {
      fontFamily: FONT, fontSize: 17, fontWeight: '800',
      fill: named ? TIER_COLOR[cat.rarityTier] : COLORS.ink,
      align: 'center', wordWrap: true, wordWrapWidth: W - 48, lineHeight: 21,
    },
  });
  title.anchor.set(0.5, 0);
  title.position.set(W / 2, 18);
  root.addChild(title);

  let y = 18 + title.height + 10;
  if (named) {
    const sub = label(describeCat(cat), 12, COLORS.inkSoft, '700');
    sub.position.set(W / 2, y);
    root.addChild(sub);
    y += 18;
  }

  const st = stars(cat.rarityTier, 15);
  st.position.set(W / 2, y);
  root.addChild(st);
  y += 26;

  // строка «Здоровье»: сердца = запас вязок кота (maxHearts, у инбридинговых
  // котят урезан) — потраченные закрашены чёрным (🖤), оставшиеся красные (❤️).
  // Исчерпал → статус «Старый»; родился без сердец → «Бесплодный».
  const total = heartsOf(cat);
  const left = breedsLeft(cat);
  const used = Math.max(0, total - left);
  const heartsStr = total > 0 ? '🖤'.repeat(used) + '❤️'.repeat(left) : '∅';
  const ageLabel = label('Здоровье ' + heartsStr, 14, COLORS.inkSoft, '700');
  ageLabel.position.set(W / 2, y);
  root.addChild(ageLabel);
  if (isOld(cat)) {
    const oldT = label(isSterile(cat) ? 'Бесплодный' : 'Старый', 12, COLORS.warn, '800');
    oldT.anchor.set(0, 0.5);
    oldT.position.set(W / 2 + ageLabel.width / 2 + 8, y);
    root.addChild(oldT);
  }
  y += 26;

  // строки облика: перенос по словам, чтобы текст не вылезал за край меню
  for (const line of traits) {
    const t = new Text({
      text: line,
      style: {
        fontFamily: FONT, fontSize: 13, fontWeight: '600', fill: COLORS.inkSoft,
        wordWrap: true, wordWrapWidth: W - 56, lineHeight: 18, align: 'left',
      },
    });
    t.anchor.set(0, 0);
    t.position.set(28, y);
    root.addChild(t);
    y += t.height + 4;
  }
  y += 10;

  if (busy) {
    const note = label('💤 кот занят в вязке', 14, COLORS.warn, '700');
    note.position.set(W / 2, y);
    root.addChild(note);
    y += 26;
  }

  const btnW = W - 48;
  const addBtn = (text: string, color: number, enabled: boolean, onTap: () => void): void => {
    const b = new Button({ text, w: btnW, h: 44, color, fontSize: 15 });
    b.enabled = enabled;
    b.onTap = onTap;
    b.position.set(W / 2, y + 22);
    root.addChild(b);
    y += 52;
  };

  // Постановка на вязку — перетаскиванием (взять кота за шкирку → на слот
  // инкубатора); переезд между комнатами — кнопками ниже.
  addBtn(named ? '✏️ Переименовать' : '✏️ Дать имя', COLORS.warn, true, () => {
    askText('Имя котика:', cat.name ?? '', 16, (input) => {
      if (input === null) return;               // отмена — ничего не делаем
      const r = renameCat(ctx.state, cat.id, input);
      if (!r.ok) { ctx.toast(r.reason); return; }
      ctx.commit();
      close();
      ctx.openCatMenu(cat);                      // переоткрыть с новым именем
    });
  });

  // Родословная: дерево предков до прадедов (есть и у стартовых — скрытая, в тумане).
  if (cat.motherBreed || cat.fatherBreed || cat.pedigree) {
    addBtn('🌳 Родословная', COLORS.secondary, true, () => ctx.openPedigree(cat));
  }

  // Генетический анализ (система знаний): вскрыть родословную и скрытые гены.
  if (!cat.analyzed && pedigreeHasFog(cat)) {
    addBtn('🧬 Генетический анализ', COLORS.dna, true, () => ctx.openAnalyzeConfirm(cat));
  }

  // Лечение (ветеринар-шприц) и заморозка (криокапсула) — только перетаскиванием кота
  // на соответствующую станцию в Питомнике (кнопок в меню кота больше нет, чтобы не
  // засорять список и держать действия у станций). См. rooms/nursery.ts.

  // Переезд между комнатами: в слоте вязки — обе кнопки, иначе одна (в комнату,
  // где кота нет). Занятого активной вязкой кота не двигаем — он breeding'ится.
  if (!busy) addMoveButtons(ctx, cat, close, addBtn);

  const closeBtn = new Button({ text: 'Закрыть', w: btnW, h: 40, color: COLORS.cardEdge, textColor: COLORS.ink, fontSize: 14 });
  closeBtn.position.set(W / 2, y + 20);
  closeBtn.onTap = close;
  root.addChild(closeBtn);
  y += 50;

  // фактическая высота могла отличаться — подгоним подложку (перерисуем)
  root.removeChildAt(0);
  root.addChildAt(panel(W, y, COLORS.hud, 18), 0);
  return root;
}

/**
 * Подтверждение пристройства: «Отдать котика в добрые руки?» + награда (💰 + 🧬)
 * и кнопки Да/Нет. Открывается, когда кота перетащили на переноску в Приюте.
 * Логика и суммы — те же, что были у кнопки в меню кота (adoptCat/adoptReward).
 */
export function buildAdoptConfirm(ctx: UiContext, cat: Cat, close: () => void): Container {
  const W = 340;
  const root = new Container();
  const { coins, dna } = adoptReward(ctx.state, cat);

  const title = label('Отдать котика в добрые руки?', 18, COLORS.ink, '800');
  title.position.set(W / 2, 30);

  // мини-портрет + имя/описание кота
  const sp = catSprite(ctx.app, cat, 84);
  sp.position.set(W / 2, 150);
  const who = label(cat.name?.trim() || describeCat(cat), 14, TIER_COLOR[cat.rarityTier], '800');
  who.position.set(W / 2, 172);

  const reward = label(`Вы получите:   💰 ${coins}     🧬 ${dna}`, 16, COLORS.ink, '800');
  reward.position.set(W / 2, 206);

  const pad = 24, gap = 12;
  const bw = (W - pad * 2 - gap) / 2;
  let y = 236;
  const noBtn = new Button({ text: 'Нет', w: bw, h: 48, color: COLORS.cardEdge, textColor: COLORS.ink, fontSize: 16 });
  noBtn.position.set(pad + bw / 2, y + 24);
  noBtn.onTap = close;
  const yesBtn = new Button({ text: 'Да 🤝', w: bw, h: 48, color: COLORS.good, fontSize: 16 });
  yesBtn.position.set(pad + bw + gap + bw / 2, y + 24);
  yesBtn.onTap = () => {
    const r = adoptCat(ctx.state, cat.id);
    if (!r.ok) { ctx.toast(r.reason); close(); return; }
    ctx.commit();
    ctx.toast(`Котика пристроили 🏠  +💰${r.coins}  +🧬${r.dna}${r.rep ? `  +${r.rep} ⭐` : ''}`);
    close();
  };
  y += 56;

  root.addChild(panel(W, y, COLORS.hud, 18), title, sp, who, reward, noBtn, yesBtn);
  return root;
}

/**
 * Подтверждение сдачи кота в лабораторию «на эксперименты»: награда (🧬 + немного 💰)
 * и кнопки Да/Нет. Открывается, когда кота перетащили на лабораторный слот в Приюте.
 * Кот уезжает — это основной способ добывать гены из лишних котов (sendToLab).
 */
export function buildLabConfirm(ctx: UiContext, cat: Cat, close: () => void): Container {
  const W = 340;
  const root = new Container();
  const { dna, coins } = labReward(ctx.state, cat);

  const title = label('Сдать котика в лабораторию?', 18, COLORS.ink, '800');
  title.position.set(W / 2, 28);
  const sub = label('на эксперименты — взамен 🧬 гены', 12.5, COLORS.inkSoft, '700');
  sub.position.set(W / 2, 50);

  const sp = catSprite(ctx.app, cat, 84);
  sp.position.set(W / 2, 158);
  const who = label(cat.name?.trim() || describeCat(cat), 14, TIER_COLOR[cat.rarityTier], '800');
  who.position.set(W / 2, 180);

  const reward = label(`Вы получите:   🧬 ${dna}${coins > 0 ? `     💰 ${coins}` : ''}`, 16, COLORS.ink, '800');
  reward.position.set(W / 2, 212);

  const pad = 24, gap = 12;
  const bw = (W - pad * 2 - gap) / 2;
  let y = 242;
  const noBtn = new Button({ text: 'Нет', w: bw, h: 48, color: COLORS.cardEdge, textColor: COLORS.ink, fontSize: 16 });
  noBtn.position.set(pad + bw / 2, y + 24);
  noBtn.onTap = close;
  const yesBtn = new Button({ text: 'Да 🧪', w: bw, h: 48, color: COLORS.dna, fontSize: 16 });
  yesBtn.position.set(pad + bw + gap + bw / 2, y + 24);
  yesBtn.onTap = () => {
    const r = sendToLab(ctx.state, cat.id);
    if (!r.ok) { ctx.toast(r.reason === 'locked' ? 'Лаборатория ещё заперта 🔒' : r.reason); close(); return; }
    ctx.commit();
    ctx.toast(`Кот в лаборатории 🧪  +🧬${r.dna}${r.coins > 0 ? `  +💰${r.coins}` : ''}${r.rep ? `  +${r.rep} ⭐` : ''}`);
    close();
  };
  y += 56;

  root.addChild(panel(W, y, COLORS.hud, 18), title, sub, sp, who, reward, noBtn, yesBtn);
  return root;
}

/**
 * Массовое пристройство: «Раздать всех в добрые руки?» — сводка (сколько котов +
 * суммарные 💰/🧬) и Да/Нет. Открывается кнопкой «Раздать всех» вверху приюта.
 * Суммы — shelterTotals (та же цена, что поштучно); действие — adoptAll.
 */
export function buildBulkAdoptConfirm(ctx: UiContext, close: () => void): Container {
  const W = 340;
  const root = new Container();
  const { count, adopt } = shelterTotals(ctx.state);

  const title = label('Раздать всех в добрые руки?', 18, COLORS.ink, '800');
  title.position.set(W / 2, 30);
  const sub = label(`Всего в приюте: ${count} 🐱`, 13, COLORS.inkSoft, '700');
  sub.position.set(W / 2, 54);
  const reward = label(`Вы получите:   💰 ${adopt.coins}     🧬 ${adopt.dna}`, 16, COLORS.ink, '800');
  reward.position.set(W / 2, 90);

  const pad = 24, gap = 12;
  const bw = (W - pad * 2 - gap) / 2;
  const y = 120;
  const noBtn = new Button({ text: 'Нет', w: bw, h: 48, color: COLORS.cardEdge, textColor: COLORS.ink, fontSize: 16 });
  noBtn.position.set(pad + bw / 2, y + 24);
  noBtn.onTap = close;
  const yesBtn = new Button({ text: `Да 🤝 (${count})`, w: bw, h: 48, color: COLORS.good, fontSize: 16 });
  yesBtn.position.set(pad + bw + gap + bw / 2, y + 24);
  yesBtn.onTap = () => {
    const r = adoptAll(ctx.state);
    if (!r.ok) { ctx.toast(r.reason); close(); return; }
    ctx.commit();
    ctx.toast(`Пристроено ${r.count} 🏠  +💰${r.coins}  +🧬${r.dna}${r.rep ? `  +${r.rep} ⭐` : ''}`);
    close();
  };

  root.addChild(panel(W, y + 56, COLORS.hud, 18), title, sub, reward, noBtn, yesBtn);
  return root;
}

/**
 * Массовая сдача в лабораторию: «Сдать всех котиков на эксперименты?» — сводка
 * (сколько котов + суммарные 🧬/💰) и Да/Нет. Кнопка «В лабораторию всех» вверху
 * приюта. Суммы — shelterTotals; действие — sendAllToLab.
 */
export function buildBulkLabConfirm(ctx: UiContext, close: () => void): Container {
  const W = 340;
  const root = new Container();
  const { count, lab } = shelterTotals(ctx.state);

  const title = label('Сдать всех в лабораторию?', 18, COLORS.ink, '800');
  title.position.set(W / 2, 30);
  const sub = label(`на эксперименты — взамен 🧬 гены · ${count} 🐱`, 12.5, COLORS.inkSoft, '700');
  sub.position.set(W / 2, 54);
  const reward = label(`Вы получите:   🧬 ${lab.dna}${lab.coins > 0 ? `     💰 ${lab.coins}` : ''}`, 16, COLORS.ink, '800');
  reward.position.set(W / 2, 90);

  const pad = 24, gap = 12;
  const bw = (W - pad * 2 - gap) / 2;
  const y = 120;
  const noBtn = new Button({ text: 'Нет', w: bw, h: 48, color: COLORS.cardEdge, textColor: COLORS.ink, fontSize: 16 });
  noBtn.position.set(pad + bw / 2, y + 24);
  noBtn.onTap = close;
  const yesBtn = new Button({ text: `Да 🧪 (${count})`, w: bw, h: 48, color: COLORS.dna, fontSize: 16 });
  yesBtn.position.set(pad + bw + gap + bw / 2, y + 24);
  yesBtn.onTap = () => {
    const r = sendAllToLab(ctx.state);
    if (!r.ok) { ctx.toast(r.reason === 'locked' ? 'Лаборатория ещё заперта 🔒' : r.reason); close(); return; }
    ctx.commit();
    ctx.toast(`В лаборатории ${r.count} 🧪  +🧬${r.dna}${r.coins > 0 ? `  +💰${r.coins}` : ''}${r.rep ? `  +${r.rep} ⭐` : ''}`);
    close();
  };

  root.addChild(panel(W, y + 56, COLORS.hud, 18), title, sub, reward, noBtn, yesBtn);
  return root;
}

/**
 * Ветеринар: диалог лечения кота (💉). Показывает сердца (потраченные 🖤 / оставшиеся ❤️)
 * и два способа восстановить вязки: 📺 реклама (+1 ❤, глобальный кулдаун) или
 * 💎 полное лечение (цена ∝ потраченным сердцам). maxHearts НЕ меняется — потолок
 * от инбридинга неизлечим; «Бесплодных» (0 ❤) ветеринар не берёт (healCat откажет).
 */
export function buildHealConfirm(ctx: UiContext, cat: Cat, close: () => void): Container {
  const W = 340;
  const root = new Container();

  const title = label('💉 Ветеринар', 18, COLORS.ink, '800');
  title.position.set(W / 2, 28);
  const sub = label('восстанавливает потраченные вязки', 12.5, COLORS.inkSoft, '700');
  sub.position.set(W / 2, 50);

  const sp = catSprite(ctx.app, cat, 84);
  sp.position.set(W / 2, 158);
  const who = label(cat.name?.trim() || describeCat(cat), 14, TIER_COLOR[cat.rarityTier], '800');
  who.position.set(W / 2, 180);

  const total = heartsOf(cat);
  const left = breedsLeft(cat);
  const spent = Math.max(0, total - left);
  const heartsStr = total > 0 ? '🖤'.repeat(spent) + '❤️'.repeat(left) : '∅';
  const hearts = label('Здоровье ' + heartsStr, 15, COLORS.ink, '800');
  hearts.position.set(W / 2, 210);

  let y = 236;
  root.addChild(title, sub, sp, who, hearts);

  const btnW = W - 48;
  if (isSterile(cat)) {
    // родился без сердец — генетический тупик, лечению не подлежит (решение §6)
    const note = label('Бесплодный — лечению не подлежит 🚫', 13, COLORS.warn, '800');
    note.position.set(W / 2, y);
    root.addChild(note);
    y += 28;
  } else if (spent <= 0) {
    const note = label('Кот полностью здоров ✨', 13, COLORS.good, '800');
    note.position.set(W / 2, y);
    root.addChild(note);
    y += 28;
  } else {
    // 📺 реклама: +1 ❤ бесплатно, без кулдауна
    const adBtn = new Button({
      text: `📺 +${HEAL_AD_HEARTS} ❤ бесплатно`,
      w: btnW, h: 44, color: COLORS.good,
      textColor: 0xffffff, fontSize: 15,
    });
    adBtn.position.set(W / 2, y + 22);
    adBtn.onTap = () => {
      const r = healCat(ctx.state, cat.id, 'ad', ctx.now());
      if (!r.ok) { ctx.toast(r.reason === 'locked' ? 'Ветеринар ещё заперт 🔒' : r.reason); close(); return; }
      ctx.commit();
      ctx.toast(`Кот подлечен 💉 +${r.healed} ❤`);
      close();
    };
    root.addChild(adBtn);
    y += 52;

    // 💎 полное лечение: цена пропорциональна потраченным сердцам
    const cost = HEAL_CRYSTAL_PER_HEART * spent;
    const afford = ctx.state.crystals >= cost;
    const fullBtn = new Button({
      text: `💎 Вылечить всё · ${cost}`,
      w: btnW, h: 44, color: afford ? COLORS.secondary : COLORS.cardEdge,
      textColor: afford ? 0xffffff : COLORS.inkSoft, fontSize: 15,
    });
    fullBtn.enabled = afford;
    fullBtn.position.set(W / 2, y + 22);
    fullBtn.onTap = () => {
      const r = healCat(ctx.state, cat.id, 'crystals', ctx.now());
      if (!r.ok) { ctx.toast(r.reason === 'locked' ? 'Ветеринар ещё заперт 🔒' : r.reason); close(); return; }
      ctx.commit();
      ctx.toast(`Кот полностью здоров 💉 +${r.healed} ❤  −${r.crystals} 💎`);
      close();
    };
    root.addChild(fullBtn);
    y += 52;
  }

  const closeBtn = new Button({ text: 'Закрыть', w: btnW, h: 40, color: COLORS.cardEdge, textColor: COLORS.ink, fontSize: 14 });
  closeBtn.position.set(W / 2, y + 20);
  closeBtn.onTap = close;
  root.addChild(closeBtn);
  y += 50;

  root.addChildAt(panel(W, y, COLORS.hud, 18), 0);
  return root;
}

/**
 * Криокапсула: диалог заморозки кота (🧊). Открывается перетаскиванием кота на
 * станцию-криокапсулу в Питомнике (кнопки в меню кота больше нет). Три пути оплаты,
 * как у ветеринара/анализа: 📺 реклама (бесплатно, глобальный кулдаун), 💰 монеты или
 * 💎 кристаллы. В капсуле кот не ест и не даёт доход; разморозки нет — только клон/утиль.
 */
export function buildFreezeConfirm(ctx: UiContext, cat: Cat, close: () => void): Container {
  const W = 340;
  const root = new Container();

  const title = label('🧊 Заморозить кота?', 18, COLORS.ink, '800');
  title.position.set(W / 2, 28);
  const sub = label('в криокапсулу — витрина коллекции', 12.5, COLORS.inkSoft, '700');
  sub.position.set(W / 2, 50);

  const sp = catSprite(ctx.app, cat, 84);
  sp.position.set(W / 2, 150);
  const who = label(cat.name?.trim() || describeCat(cat), 14, TIER_COLOR[cat.rarityTier], '800');
  who.position.set(W / 2, 172);

  const note = new Text({
    text: '❄️ В капсуле кот не ест и не приносит доход. Разморозки нет — освободить капсулу можно клоном 🧬 или утилизацией.',
    style: {
      fontFamily: FONT, fontSize: 11.5, fontWeight: '600', fill: COLORS.inkSoft,
      align: 'center', wordWrap: true, wordWrapWidth: W - 48, lineHeight: 16,
    },
  });
  note.anchor.set(0.5, 0);
  note.position.set(W / 2, 192);

  let y = 192 + note.height + 14;
  root.addChild(title, sub, sp, who, note);

  const btnW = W - 48;
  const done = (r: { coins: number; crystals: number }): void => {
    ctx.commit();
    ctx.toast(`Кот в криокапсуле ❄️${r.coins ? `  −💰${r.coins}` : ''}${r.crystals ? `  −💎${r.crystals}` : ''}`);
    close();
  };
  const fail = (reason: string): void => {
    ctx.toast(reason === 'locked' ? 'Крио-банк ещё закрыт 🔒'
      : reason === 'нет свободной капсулы' ? 'Нет свободной капсулы ❄️ (открой ещё в Криогенетике)'
        : reason);
  };

  if (cryoCount(ctx.state) >= cryoCapacity(ctx.state)) {
    const noCap = label('Нет свободной капсулы ❄️ (открой ещё в Криогенетике)', 12, COLORS.warn, '800');
    noCap.position.set(W / 2, y);
    root.addChild(noCap);
    y += 28;
  } else {
    // 📺 реклама: бесплатно, но с глобальным кулдауном (0 = ещё не смотрели)
    const cdLeft = ctx.state.lastFreezeAdAt > 0
      ? FREEZE_AD_COOLDOWN_MS - (ctx.now() - ctx.state.lastFreezeAdAt) : 0;
    const adReady = cdLeft <= 0;
    const adBtn = new Button({
      text: adReady ? '📺 Бесплатно за рекламу' : `📺 через ${Math.ceil(cdLeft / 60_000)} мин`,
      w: btnW, h: 44, color: adReady ? COLORS.good : COLORS.cardEdge,
      textColor: adReady ? 0xffffff : COLORS.inkSoft, fontSize: 15,
    });
    adBtn.enabled = adReady;
    adBtn.position.set(W / 2, y + 22);
    adBtn.onTap = () => { const r = freezeCat(ctx.state, cat.id, 'ad', ctx.now()); if (!r.ok) { fail(r.reason); return; } done(r); };
    root.addChild(adBtn);
    y += 52;

    // 💰 монеты
    const affordCoin = ctx.state.coins >= FREEZE_COIN_COST;
    const coinBtn = new Button({
      text: `💰 Заморозить · ${FREEZE_COIN_COST}`,
      w: btnW, h: 44, color: affordCoin ? COLORS.primary : COLORS.cardEdge,
      textColor: affordCoin ? 0xffffff : COLORS.inkSoft, fontSize: 15,
    });
    coinBtn.enabled = affordCoin;
    coinBtn.position.set(W / 2, y + 22);
    coinBtn.onTap = () => { const r = freezeCat(ctx.state, cat.id, 'coins', ctx.now()); if (!r.ok) { fail(r.reason); return; } done(r); };
    root.addChild(coinBtn);
    y += 52;

    // 💎 кристаллы (премиум, мгновенно)
    const affordCrys = ctx.state.crystals >= FREEZE_CRYSTAL_COST;
    const crysBtn = new Button({
      text: `💎 Заморозить · ${FREEZE_CRYSTAL_COST}`,
      w: btnW, h: 44, color: affordCrys ? COLORS.secondary : COLORS.cardEdge,
      textColor: affordCrys ? 0xffffff : COLORS.inkSoft, fontSize: 15,
    });
    crysBtn.enabled = affordCrys;
    crysBtn.position.set(W / 2, y + 22);
    crysBtn.onTap = () => { const r = freezeCat(ctx.state, cat.id, 'crystals', ctx.now()); if (!r.ok) { fail(r.reason); return; } done(r); };
    root.addChild(crysBtn);
    y += 52;
  }

  const closeBtn = new Button({ text: 'Закрыть', w: btnW, h: 40, color: COLORS.cardEdge, textColor: COLORS.ink, fontSize: 14 });
  closeBtn.position.set(W / 2, y + 20);
  closeBtn.onTap = close;
  root.addChild(closeBtn);
  y += 50;

  root.addChildAt(panel(W, y, COLORS.hud, 18), 0);
  return root;
}

/**
 * Меню криокапсулы (Крио-банк): портрет замороженного кота + здоровье/родословная и
 * два действия — 🧬 клонировать (за ДНК, цена ∝ ценности особи; клон появляется в
 * питомнике) или ♻️ утилизировать (необратимо, с подтверждением). Разморозки НЕТ.
 */
export function buildCryoMenu(ctx: UiContext, cat: Cat, close: () => void): Container {
  const W = 360;
  const root = new Container();
  let confirmDispose = false;

  const render = (): void => {
    root.removeChildren();
    const tierCol = TIER_COLOR[cat.rarityTier];

    const title = label('❄️ Криокапсула', 18, COLORS.ink, '800');
    title.position.set(W / 2, 26);

    const sp = catSprite(ctx.app, cat, 92);
    sp.tint = 0xcfeaf6; // морозный тон замороженного кота
    sp.position.set(W / 2, 150);
    const who = label(cat.name?.trim() || describeCat(cat), 14, tierCol, '800');
    who.position.set(W / 2, 170);
    const st = stars(cat.rarityTier, 14);
    st.position.set(W / 2, 192);

    // здоровье (сердца) — как в меню кота: потраченные 🖤 / оставшиеся ❤️
    const total = heartsOf(cat);
    const left = breedsLeft(cat);
    const spent = Math.max(0, total - left);
    const heartsStr = total > 0 ? '🖤'.repeat(spent) + '❤️'.repeat(left) : '∅';
    const hearts = label('Здоровье ' + heartsStr, 13, COLORS.inkSoft, '700');
    hearts.position.set(W / 2, 214);

    let y = 234;
    root.addChild(title, sp, who, st, hearts);

    const btnW = W - 48;
    const addBtn = (text: string, color: number, enabled: boolean, onTap: () => void): void => {
      const b = new Button({ text, w: btnW, h: 44, color, fontSize: 15 });
      b.enabled = enabled;
      b.onTap = onTap;
      b.position.set(W / 2, y + 22);
      root.addChild(b);
      y += 52;
    };

    if (confirmDispose) {
      const warnT = label('Утилизировать безвозвратно?', 15, COLORS.warn, '800');
      warnT.position.set(W / 2, y + 4);
      root.addChild(warnT);
      y += 24;
      const pad = 24, gap = 12;
      const bw = (W - pad * 2 - gap) / 2;
      const noBtn = new Button({ text: 'Нет', w: bw, h: 46, color: COLORS.cardEdge, textColor: COLORS.ink, fontSize: 16 });
      noBtn.position.set(pad + bw / 2, y + 23);
      noBtn.onTap = () => { confirmDispose = false; render(); };
      const yesBtn = new Button({ text: '♻️ Да', w: bw, h: 46, color: COLORS.warn, textColor: COLORS.ink, fontSize: 16 });
      yesBtn.position.set(pad + bw + gap + bw / 2, y + 23);
      yesBtn.onTap = () => {
        const r = disposeCryo(ctx.state, cat.id);
        if (!r.ok) { ctx.toast(r.reason); close(); return; }
        ctx.commit();
        ctx.toast('Капсула освобождена ♻️');
        close();
      };
      root.addChild(noBtn, yesBtn);
      y += 54;
    } else {
      // клонирование: цена ∝ ценности особи; нужно место в питомнике
      const cost = cloneCost(cat);
      const noRoom = roomCount(ctx.state, 'nursery') >= nurseryCapacity(ctx.state);
      const afford = ctx.state.dna >= cost;
      addBtn(
        noRoom ? '🧬 Клонировать · нет места' : `🧬 Клонировать · ${cost}`,
        afford && !noRoom ? COLORS.dna : COLORS.cardEdge,
        afford && !noRoom,
        () => {
          const r = cloneCat(ctx.state, cat.id, ctx.now());
          if (!r.ok) {
            ctx.toast(r.reason === 'нет места в питомнике' ? 'Нет места в питомнике 🚫'
              : r.reason === 'не хватает ДНК' ? 'Не хватает 🧬 ДНК' : r.reason);
            return;
          }
          ctx.commit();
          ctx.toast(`Клон в питомнике 🐱  −🧬${r.dna}`);
          close();
        },
      );
      if (cat.motherBreed || cat.fatherBreed || cat.pedigree) {
        addBtn('🌳 Родословная', COLORS.secondary, true, () => ctx.openPedigree(cat));
      }
      // Генетический анализ доступен и в капсуле: вскрыть родословную/скрытые гены.
      if (!cat.analyzed && pedigreeHasFog(cat)) {
        addBtn('🧬 Генетический анализ', COLORS.dna, true, () => ctx.openAnalyzeConfirm(cat));
      }
      addBtn('♻️ Утилизировать', COLORS.warn, true, () => { confirmDispose = true; render(); });
    }

    const closeBtn = new Button({ text: 'Закрыть', w: btnW, h: 40, color: COLORS.cardEdge, textColor: COLORS.ink, fontSize: 14 });
    closeBtn.position.set(W / 2, y + 20);
    closeBtn.onTap = close;
    root.addChild(closeBtn);
    y += 50;

    root.addChildAt(panel(W, y, COLORS.hud, 18), 0);
  };

  render();
  return root;
}

/**
 * Доска заказов (кнопка 📋 в Приюте). Каждый слот всегда держит активный заказ со своим
 * 6-часовым таймером жизни: не выполнил вовремя — заказ сам сменится (на строке виден
 * остаток «⏳ обновится через Ч:ММ»). Раз в час ОДИН заказ можно обновить досрочно за 📺.
 * Выполнить заказ можно ТОЛЬКО котом из корзины: кнопка «Выполнить» активна лишь у строк,
 * под которые он подходит.
 */
export function buildOrdersPanel(ctx: UiContext, close: () => void): Container {
  const W = 620;
  const root = new Container();

  const title = label('📋 Заказы клиентов', 20, COLORS.ink, '800');
  title.position.set(W / 2, 26);

  const cat = basketCat(ctx.state);
  const basket = label(
    cat ? `🧺 В корзине: ${cat.name?.trim() || describeCat(cat)}` : '🧺 Корзина пуста — перетащи кота в корзину под кнопкой 📋 в Приюте',
    13, cat ? COLORS.ink : COLORS.inkSoft, '800',
  );
  basket.anchor.set(0.5, 0);
  basket.position.set(W / 2, 46);

  const adAvail = canAdRefreshOrder(ctx.state, ctx.now());
  // остаток «Ч:ММ» (таймер жизни ≤ 6 ч и кулдаун обновления)
  const fmtHM = (ms: number): string => {
    const h = Math.floor(ms / 3_600_000);
    const m = Math.floor((ms % 3_600_000) / 60_000);
    return `${h}:${String(m).padStart(2, '0')}`;
  };
  const adHelp = label(
    adAvail
      ? 'Не выполнил за 6 ч — заказ сменится сам. 📺 обновляет один заказ досрочно.'
      : `Не выполнил за 6 ч — заказ сменится сам. 📺-обновление снова через ${fmtHM(msUntilAdRefresh(ctx.state, ctx.now()))}.`,
    11.5, COLORS.inkSoft, '600');
  adHelp.anchor.set(0.5, 0);
  adHelp.position.set(W / 2, 66);

  const rowH = 96;
  const orders = ctx.state.orders;
  let y = 90;
  const rows = new Container();

  for (const order of orders) {
    const row = new Container();
    const fits = !!cat && matchesOrder(order, cat);
    const busy = !!cat && isBusy(ctx.state, cat.id);
    row.addChild(panel(W - 32, rowH - 12, COLORS.card, 12));

    const req = label(`«${describeReq(order.req)}»`, 16, COLORS.ink, '800');
    req.anchor.set(0, 0.5);
    req.position.set(16, 20);
    row.addChild(req);

    const rew = label('Награда: ' + rewardText(order.reward), 13, COLORS.inkSoft, '700');
    rew.anchor.set(0, 0.5);
    rew.position.set(16, 44);
    row.addChild(rew);

    const timer = label(`⏳ обновится через ${fmtHM(msUntilOrderExpiry(order, ctx.now()))}`, 11.5, COLORS.inkSoft, '600');
    timer.anchor.set(0, 0.5);
    timer.position.set(16, 66);
    row.addChild(timer);

    // главная кнопка «Выполнить» (сверху) + маленькая «📺 обновить» (снизу)
    const btnText = !cat ? 'нужен кот' : busy ? 'кот занят' : fits ? 'Выполнить' : 'не подходит';
    const btn = new Button({
      text: btnText, w: 150, h: 40,
      color: fits && !busy ? COLORS.primary : COLORS.cardEdge,
      textColor: fits && !busy ? 0xffffff : COLORS.inkSoft, fontSize: 15,
    });
    btn.enabled = fits && !busy;
    btn.position.set(W - 32 - 88, 26);
    btn.onTap = () => {
      const r = claimOrder(ctx.state, order.id, ctx.now(), ctx.rng);
      if (r.ok) { ctx.commit(); ctx.toast('Заказ выполнен! ' + rewardText(r.reward)); close(); ctx.openOrders(); }
      else ctx.toast(r.reason);
    };
    row.addChild(btn);

    const refBtn = new Button({
      text: adAvail ? '📺 обновить' : '⏳ обновление позже', w: 150, h: 30,
      color: adAvail ? COLORS.secondary : COLORS.cardEdge,
      textColor: adAvail ? 0xffffff : COLORS.inkSoft, fontSize: 12.5,
    });
    refBtn.enabled = adAvail;
    refBtn.position.set(W - 32 - 88, 60);
    refBtn.onTap = () => {
      const r = adRefreshOrder(ctx.state, ctx.rng, order.id, ctx.now());
      if (!r.ok) { ctx.toast(r.reason); return; }
      ctx.commit();
      ctx.toast('Заказ обновлён 📺');
      close(); ctx.openOrders();
    };
    row.addChild(refBtn);

    row.position.set(16, y);
    rows.addChild(row);
    y += rowH;
  }

  const closeBtn = new Button({ text: 'Закрыть', w: 160, h: 42, color: COLORS.cardEdge, textColor: COLORS.ink, fontSize: 15 });
  closeBtn.position.set(W / 2, y + 26);
  closeBtn.onTap = close;

  const H = y + 56;
  root.addChild(panel(W, H, COLORS.hud, 18));
  root.addChild(title, basket, adHelp, rows, closeBtn);
  return root;
}

/**
 * ⚠️ ВРЕМЕННОЕ DEV-меню (удалить перед релизом; см. openDevMenu/кнопку 🛠 в HUD).
 * Читерская панель для отладки: накидывает валюты и выставляет уровень лаборатории
 * (через порог опыта LEVEL_REP_THRESHOLDS). Показывается только при import.meta.env.DEV.
 */
export function buildDevMenu(ctx: UiContext, close: () => void): Container {
  const W = 360;
  const root = new Container();

  const render = (): void => {
    root.removeChildren();
    const s = ctx.state;
    const items: Container[] = [];

    const title = label('🛠 Режим разработчика', 19, COLORS.ink, '800');
    title.position.set(W / 2, 26);
    const sub = label('временное — убрать перед релизом', 12, COLORS.warn, '700');
    sub.position.set(W / 2, 48);
    items.push(title, sub);

    let y = 72;

    // строка ресурса: подпись «глиф имя: значение» + ряд кнопок «+N»
    const resourceRow = (glyph: string, name: string, value: number, adds: number[], apply: (n: number) => void): void => {
      const cap = label(`${glyph} ${name}: ${fmt(value)}`, 14, COLORS.ink, '800');
      cap.anchor.set(0, 0.5);
      cap.position.set(24, y);
      items.push(cap);
      y += 22;
      const btns = adds.map((n) => {
        const b = new Button({ text: `+${fmt(n)}`, w: 90, h: 38, color: COLORS.primary, fontSize: 14 });
        b.onTap = () => { apply(n); ctx.commit(); render(); };
        return b;
      });
      centerRow(btns, y + 19, W, 10);
      items.push(...btns);
      y += 48;
    };

    resourceRow('💰', 'Монеты', s.coins, [1000, 10000, 100000], (n) => { s.coins += n; });
    resourceRow('💎', 'Кристаллы', s.crystals, [50, 500, 5000], (n) => { s.crystals += n; });
    resourceRow('🧬', 'ДНК', s.dna, [1000, 10000, 100000], (n) => { s.dna += n; });

    // уровень лаборатории: задаётся через порог накопленного опыта
    const lvlCap = label(`⭐ Уровень: ${s.level} / ${MAX_LEVEL}`, 14, COLORS.ink, '800');
    lvlCap.anchor.set(0, 0.5);
    lvlCap.position.set(24, y);
    items.push(lvlCap);
    y += 22;
    const setLevel = (target: number): void => {
      const lv = Math.max(1, Math.min(MAX_LEVEL, target));
      s.reputation = LEVEL_REP_THRESHOLDS[lv - 1] ?? 0;
      s.level = levelForReputation(s.reputation);
      ctx.commit();
      render();
    };
    const lvlBtns = [
      new Button({ text: '−1', w: 70, h: 38, color: COLORS.cardEdge, textColor: COLORS.ink, fontSize: 15 }),
      new Button({ text: '+1', w: 70, h: 38, color: COLORS.good, fontSize: 15 }),
      new Button({ text: 'MAX', w: 90, h: 38, color: COLORS.secondary, fontSize: 14 }),
    ];
    lvlBtns[0]!.onTap = () => setLevel(s.level - 1);
    lvlBtns[1]!.onTap = () => setLevel(s.level + 1);
    lvlBtns[2]!.onTap = () => setLevel(MAX_LEVEL);
    centerRow(lvlBtns, y + 19, W, 10);
    items.push(...lvlBtns);
    y += 48;

    // открыть все рецепты в Котодексе (knownRecipes ← ключи всех рецептов)
    const known = (s.knownRecipes ?? []).length;
    const recipesBtn = new Button({
      text: known >= RECIPES.length ? `📖 Все рецепты открыты (${RECIPES.length})` : `📖 Открыть все рецепты (${known}/${RECIPES.length})`,
      w: W - 48, h: 42, color: COLORS.secondary, fontSize: 14,
    });
    recipesBtn.position.set(W / 2, y + 21);
    recipesBtn.onTap = () => {
      s.knownRecipes = RECIPES.map(recipeKey);
      ctx.commit();
      ctx.toast('Все рецепты открыты');
      render();
    };
    items.push(recipesBtn);
    y += 52;

    // заспавнить любую породу в питомник (если место позволяет)
    const spawnBtn = new Button({ text: '🐈 Заспавнить породу…', w: W - 48, h: 42, color: COLORS.good, fontSize: 15 });
    spawnBtn.position.set(W / 2, y + 21);
    spawnBtn.onTap = () => askBreedSpawn((breedKey) => {
      if (roomCount(s, 'nursery') >= nurseryCapacity(s)) return '🚫 Питомник заполнен';
      const sex = ctx.rng() < 0.5 ? 'female' : 'male';
      s.cats.push(makeCatInstance(s, randomCat(ctx.rng, sex), ctx.now(), 'nursery', breedKey));
      ctx.commit();
      return `✅ ${breedName(breedKey)} → питомник (${roomCount(s, 'nursery')}/${nurseryCapacity(s)})`;
    });
    items.push(spawnBtn);
    y += 52;

    const closeBtn = new Button({ text: 'Закрыть', w: W - 48, h: 42, color: COLORS.cardEdge, textColor: COLORS.ink, fontSize: 15 });
    closeBtn.position.set(W / 2, y + 21);
    closeBtn.onTap = close;
    items.push(closeBtn);
    y += 52;

    root.addChild(panel(W, y, COLORS.hud, 18), ...items);
  };

  render();
  return root;
}
