/**
 * Оверлеи поверх сцены: меню кота (действия) и панель заказов.
 * Возвращают Container с панелью; центрирование и затемнение — на Game.
 */

import { Container, Graphics, Text } from 'pixi.js';
import type { Cat, BirthEvent, Ancestor } from '../game/index.js';
import {
  isBusy, isInSlot, clearBreederSlot, adoptReward, adoptCat, moveCat, claimOrder, matchesOrder, renameCat,
  isAdult, growthScale, growthProgress, growthRemainingMs, isOld, breedsLeft, MAX_BREEDS,
  catAncestors, pedigreeDepth, PEDIGREE_DEPTH, BOOSTS, buyBoost, boostCharges,
} from '../game/index.js';
import { breedName, tierOfBreed, TIER_LEVEL } from '../genetics/index.js';
import type { UiContext } from './context.js';
import { Button, COLORS, FONT, label, panel, stackWords, stars, TIER_RU, TIER_COLOR } from './theme.js';
import { describeCat, catTraits, describeReq } from './describe.js';
import { catSprite } from './catTextures.js';
import { upgradeButton } from './upgradeButton.js';

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

function rewardText(r: { coins: number; crystals: number; dna: number; reputation: number }): string {
  const p: string[] = [];
  if (r.coins) p.push(`💰${r.coins}`);
  if (r.crystals) p.push(`💎${r.crystals}`);
  if (r.dna) p.push(`🧬${r.dna}`);
  if (r.reputation) p.push(`⭐${r.reputation}`);
  return p.join('  ');
}

/** Оверлей улучшений комнаты (список апгрейдов). Перерисовывается после покупки. */
export function buildUpgradesPanel(
  ctx: UiContext, title: string, ids: string[], close: () => void,
): Container {
  const W = Math.min(ctx.roomW - 40, 460);
  const root = new Container();

  const render = (): void => {
    root.removeChildren();
    const titleT = label(title, 20, COLORS.ink, '800');
    titleT.position.set(W / 2, 30);
    let y = 60;
    const items: Container[] = [titleT];
    for (const id of ids) {
      const b = upgradeButton(ctx, id, W - 48);
      const orig = b.onTap;
      b.onTap = () => { orig?.(); render(); }; // обновить стоимости после покупки
      b.position.set(W / 2, y + 26);
      items.push(b);
      y += 60;
    }
    const closeBtn = new Button({ text: 'Закрыть', w: 180, h: 42, color: COLORS.cardEdge, textColor: COLORS.ink, fontSize: 15 });
    closeBtn.position.set(W / 2, y + 24);
    closeBtn.onTap = close;
    items.push(closeBtn);

    const H = y + 56;
    root.addChild(panel(W, H, COLORS.hud, 18), ...items);
  };

  render();
  return root;
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
    '🔬 Генолаб. Котодекс — альбом всех пород: собирай редких в коллекцию. Дальше — улучшения за 🧬 ДНК.',
    '📋 Заказы. Приведи кота нужной породы или редкости → 💰, 💎 и репутация. Репутация повышает уровень лаборатории.',
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

    // основная кнопка: малыш по умолчанию остаётся в питомнике (или листаем дальше)
    const btn = new Button({
      text: last ? 'В питомник 🏠' : 'Следующий →',
      w: W - 60, h: 46, color: COLORS.primary, fontSize: 16,
    });
    btn.position.set(W / 2, y + 23);
    btn.onTap = advance;
    y += 54;

    // отправить новорождённого в приют
    const toShelter = new Button({ text: '➡️ В приют', w: W - 60, h: 42, color: COLORS.secondary, fontSize: 15 });
    toShelter.position.set(W / 2, y + 21);
    toShelter.onTap = () => {
      const r = moveCat(ctx.state, cat.id, 'shelter');
      if (!r.ok) { ctx.toast(r.reason); return; }
      ctx.commit();
      ctx.toast('Малыш отправлен в приют 🏠');
      advance();
    };
    y += 50;

    root.addChild(panel(W, y, COLORS.hud, 18), title, cradle, sp, name, st, tierT, grow, ...extra, btn, toShelter);
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
    const charges = boostCharges(ctx.state, def.id);
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

    const status = label(
      charges > 0
        ? `⚡ заряжено${charges > 1 ? ` ×${charges}` : ''} · сработает на следующей вязке`
        : 'не заряжено · активируй усилитель',
      12, charges > 0 ? COLORS.good : COLORS.inkSoft, '700',
    );
    status.position.set(W / 2, y);
    items.push(status);
    y += 26;

    const buyWith = (currency: 'dna' | 'crystals'): void => {
      const r = buyBoost(ctx.state, def.id, currency);
      if (r.ok) { ctx.commit(); ctx.toast(`${def.glyph} ${def.label} заряжен`); render(); }
      else ctx.toast(r.reason);
    };

    const pad = 24, gap = 12;
    const bw = (W - pad * 2 - gap) / 2;
    const geneBtn = new Button({ text: `Гены\n🧬 ${def.dna}`, w: bw, h: 54, color: COLORS.dna, fontSize: 14 });
    geneBtn.enabled = ctx.state.dna >= def.dna;
    geneBtn.onTap = () => buyWith('dna');
    geneBtn.position.set(pad + bw / 2, y + 27);
    const crysBtn = new Button({ text: `Кристаллы\n💎 ${def.crystals}`, w: bw, h: 54, color: COLORS.crystals, fontSize: 14 });
    crysBtn.enabled = ctx.state.crystals >= def.crystals;
    crysBtn.onTap = () => buyWith('crystals');
    crysBtn.position.set(pad + bw + gap + bw / 2, y + 27);
    items.push(geneBtn, crysBtn);
    y += 66;

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
 * Табличка котёнка: пока малыш не вырос — порода, редкость и шкала времени до
 * взросления (заполняется в реальном времени). Имя/пол и действия вязки скрыты,
 * проявятся, когда котёнок повзрослеет. По взрослении карточка сама переключится.
 */
function buildKittenCard(ctx: UiContext, cat: Cat, close: () => void): Container {
  const W = 340;
  const root = new Container();
  const tierCol = TIER_COLOR[cat.rarityTier];

  const title = label(stackWords(breedName(cat.breed)), 19, tierCol, '800');
  title.anchor.set(0.5, 0);
  title.position.set(W / 2, 16);

  const boxY = 16 + title.height + 10, boxH = 130;
  const cradle = new Graphics();
  cradle.roundRect(W / 2 - 78, boxY, 156, boxH, 18)
    .fill({ color: COLORS.card })
    .stroke({ width: 3, color: tierCol, alpha: 0.85 });
  const sp = catSprite(ctx.app, cat, boxH * 0.7 * growthScale(cat, ctx.now()));
  sp.position.set(W / 2, boxY + boxH - 12);

  let y = boxY + boxH + 22;
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

  // контекстная кнопка переезда — чтобы малыш не занимал место навсегда
  const toShelter = cat.location === 'nursery';
  const moveBtn = new Button({
    text: toShelter ? '➡️ В приют' : '⬅️ В питомник',
    w: W - 60, h: 42, color: COLORS.secondary, fontSize: 15,
  });
  moveBtn.position.set(W / 2, y + 21);
  moveBtn.onTap = () => {
    const r = moveCat(ctx.state, cat.id, toShelter ? 'shelter' : 'nursery');
    if (r.ok) { close(); ctx.commit(); } else ctx.toast(r.reason);
  };
  y += 50;

  const closeBtn = new Button({ text: 'Закрыть', w: W - 60, h: 40, color: COLORS.cardEdge, textColor: COLORS.ink, fontSize: 14 });
  closeBtn.position.set(W / 2, y + 20);
  closeBtn.onTap = close;
  y += 50;

  root.addChild(panel(W, y, COLORS.hud, 18), title, cradle, sp, st, tierT, hint, barBg, bar, timeT, moveBtn, closeBtn);

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
 * (сам кот → родители → деды → прадеды). Рисуется только то, что известно;
 * с каждым поколением вязок дерево заполняется глубже. Если столбцы не влезают —
 * Game автоматически вписывает панель в экран (showOverlay масштабирует).
 */
export function buildPedigreePanel(_ctx: UiContext, cat: Cat, close: () => void): Container {
  const root = new Container();

  const ped = catAncestors(cat);
  const subject: Ancestor = { breed: cat.breed, mother: ped.mother, father: ped.father };
  const maxDepth = PEDIGREE_DEPTH; // 0=кот, 1=родители, 2=деды, 3=прадеды

  // геометрия ячеек/колонок
  const cellW = 108, cellH = 42, colGap = 16, rowGap = 9;
  const slotH = cellH + rowGap;
  const padX = 16, padTop = 64, headerY = 46;
  const colX = (d: number): number => padX + d * (cellW + colGap) + cellW / 2;

  type Placed = { node: Ancestor; depth: number; x: number; y: number; isRoot: boolean };
  const placed: Placed[] = [];
  const links: Array<[number, number, number, number]> = []; // x1,y1,x2,y2
  let leafIndex = 0;
  let usedDepth = 0;

  const layout = (node: Ancestor, depth: number, isRoot: boolean): number => {
    usedDepth = Math.max(usedDepth, depth);
    const kids: Ancestor[] = [];
    if (depth < maxDepth) {
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
  const known = pedigreeDepth(cat); // известных поколений предков

  // соединители (рисуем под ячейками)
  const wires = new Graphics();
  for (const [x1, y1, x2, y2] of links) {
    const midX = (x1 + x2) / 2;
    wires.moveTo(x1, y1).lineTo(midX, y1).lineTo(midX, y2).lineTo(x2, y2);
  }
  wires.stroke({ width: 1.5, color: COLORS.cardEdge, alpha: 0.9 });

  // ячейка-предок: рамка в цвет тира + точка тира + имя породы (с переносом)
  const cell = (p: Placed): Container => {
    const c = new Container();
    const tier = tierOfBreed(p.node.breed);
    const col = TIER_COLOR[tier];
    const g = new Graphics();
    g.roundRect(-cellW / 2, -cellH / 2, cellW, cellH, 9)
      .fill({ color: p.isRoot ? COLORS.card : COLORS.hud })
      .stroke({ width: p.isRoot ? 3 : 2, color: col, alpha: 0.95 });
    g.circle(-cellW / 2 + 11, 0, 4).fill({ color: col });
    const name = p.isRoot ? (cat.name?.trim() || breedName(p.node.breed)) : breedName(p.node.breed);
    const t = new Text({
      text: name,
      style: {
        fontFamily: FONT, fontSize: 11, fontWeight: '700', fill: COLORS.ink,
        wordWrap: true, breakWords: true, wordWrapWidth: cellW - 26, lineHeight: 12, align: 'center',
      },
    });
    t.anchor.set(0.5);
    t.position.set(5, 0);
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
  title.position.set(W / 2, 26);

  let y = treeBottom + 8;
  const footer: Container[] = [];
  if (known < maxDepth) {
    const hint = label('родословная пополняется с каждым поколением', 11, COLORS.inkSoft, '600');
    hint.position.set(W / 2, y + 8);
    footer.push(hint);
    y += 22;
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

/** Меню действий над котом. */
export function buildCatMenu(ctx: UiContext, cat: Cat, close: () => void): Container {
  if (!isAdult(cat, ctx.now())) return buildKittenCard(ctx, cat, close);
  const W = 380;
  const root = new Container();
  const busy = isBusy(ctx.state, cat.id);

  const traits = catTraits(cat);
  const H = 150 + traits.length * 20 + (busy ? 28 : 0) + 4 * 54;
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

  // строка «Возраст»: 5 сердечек — потраченные вязки закрашены чёрным (🖤),
  // оставшиеся красные (❤️). Исчерпал лимит → рядом статус «Старый».
  const left = breedsLeft(cat);
  const used = MAX_BREEDS - left;
  const ageLabel = label('Возраст ' + '🖤'.repeat(used) + '❤️'.repeat(left), 14, COLORS.inkSoft, '700');
  ageLabel.position.set(W / 2, y);
  root.addChild(ageLabel);
  if (isOld(cat)) {
    const oldT = label('Старый', 12, COLORS.warn, '800');
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

  // Перемещение между комнатами и постановка на вязку — теперь перетаскиванием
  // (взять кота за шкирку → отнести в нужную комнату / на слот инкубатора).
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

  // Родословная: дерево предков до прадедов (только если родители известны).
  if (cat.motherBreed || cat.fatherBreed) {
    addBtn('🌳 Родословная', COLORS.secondary, true, () => ctx.openPedigree(cat));
  }

  // Кот стоит в слоте вязки → быстрый возврат в питомник (без перетаскивания).
  if (!busy && isInSlot(ctx.state, cat.id)) {
    addBtn('⬅️ В питомник', COLORS.secondary, true, () => {
      const r = moveCat(ctx.state, cat.id, 'nursery');
      if (!r.ok) { ctx.toast(r.reason); return; }
      clearBreederSlot(ctx.state, cat.id);
      close(); ctx.commit(); ctx.toast('Котик в питомнике 🏆');
    });
  }

  // Пристройство «в добрые руки» (только из приюта) — это не переезд, а награда.
  if (cat.location === 'shelter') {
    const rw = adoptReward(ctx.state, cat);
    addBtn(`🏠 Пристроить (+💰${rw.coins} +🧬${rw.dna})`, COLORS.good, !busy, () => {
      clearBreederSlot(ctx.state, cat.id); // если стоял в слоте — убрать ссылку
      const r = adoptCat(ctx.state, cat.id);
      if (r.ok) { close(); ctx.commit(); ctx.toast(`Котик в добрых руках 🏠 +💰${r.coins} +🧬${r.dna}`); }
      else ctx.toast(r.reason);
    });
  }

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

/** Панель заказов: список с требованиями, наградой и кнопкой «Выполнить». */
export function buildOrdersPanel(ctx: UiContext, close: () => void): Container {
  const W = 560;
  const root = new Container();

  const title = label('📋 Заказы клиентов', 20, COLORS.ink, '800');
  title.position.set(W / 2, 28);

  const rowH = 78;
  const orders = ctx.state.orders;
  let y = 56;
  const rows = new Container();

  for (const order of orders) {
    const row = new Container();
    row.addChild(panel(W - 32, rowH - 12, COLORS.card, 12));
    const req = label(`«${describeReq(order.req)}»`, 16, COLORS.ink, '800');
    req.anchor.set(0, 0.5);
    req.position.set(16, 22);
    row.addChild(req);
    const rew = label('Награда: ' + rewardText(order.reward), 13, COLORS.inkSoft, '700');
    rew.anchor.set(0, 0.5);
    rew.position.set(16, 46);
    row.addChild(rew);

    const match = ctx.state.cats.find((c) => !isBusy(ctx.state, c.id) && matchesOrder(order, c));
    const btn = new Button({
      text: match ? 'Выполнить' : 'нет кота', w: 140, h: 44,
      color: match ? COLORS.primary : COLORS.cardEdge,
      textColor: match ? 0xffffff : COLORS.inkSoft, fontSize: 15,
    });
    btn.enabled = !!match;
    btn.position.set(W - 32 - 78, (rowH - 12) / 2);
    btn.onTap = () => {
      if (!match) return;
      const r = claimOrder(ctx.state, order.id, match.id, ctx.now());
      if (r.ok) { ctx.commit(); ctx.toast('Заказ выполнен! ' + rewardText(r.reward)); close(); ctx.openOrders(); }
      else ctx.toast(r.reason);
    };
    row.addChild(btn);

    row.position.set(16, y);
    rows.addChild(row);
    y += rowH;
  }

  if (orders.length === 0) {
    const empty = label('новых заказов пока нет', 15, COLORS.inkSoft, '600');
    empty.position.set(W / 2, y + 10);
    rows.addChild(empty);
    y += 40;
  }

  const closeBtn = new Button({ text: 'Закрыть', w: 160, h: 42, color: COLORS.cardEdge, textColor: COLORS.ink, fontSize: 15 });
  closeBtn.position.set(W / 2, y + 26);
  closeBtn.onTap = close;

  const H = y + 56;
  root.addChild(panel(W, H, COLORS.hud, 18));
  root.addChild(title, rows, closeBtn);
  return root;
}
