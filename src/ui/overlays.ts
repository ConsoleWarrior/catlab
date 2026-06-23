/**
 * Оверлеи поверх сцены: меню кота (действия) и панель заказов.
 * Возвращают Container с панелью; центрирование и затемнение — на Game.
 */

import { Container, Text } from 'pixi.js';
import type { Cat } from '../game/index.js';
import {
  isBusy, adoptReward, adoptCat, moveCat, analyzeCat, claimOrder, matchesOrder,
  ANALYZE_DNA_COST,
} from '../game/index.js';
import type { UiContext } from './context.js';
import { Button, COLORS, FONT, label, panel, stars } from './theme.js';
import { describeCat, catTraits, describeReq } from './describe.js';
import { upgradeButton } from './upgradeButton.js';

const ANALYZE_COST = ANALYZE_DNA_COST;

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
    '🏆 Питомник. Ценные коты приносят пассивный доход 💰/мин. Тап по коту открывает меню действий.',
    '🏠 Приют. Обычных котиков пристраивай «в добрые руки» — получишь 💰 и 🧬 ДНК.',
    '🔬 Генолаб. Трать 🧬 ДНК на новые гены — больше окрасов и заказов.',
    '📋 Заказы. Выведи кота нужного окраса под заказ → 💰, 💎 и репутация. Репутация повышает уровень лаборатории.',
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

/** Меню действий над котом. */
export function buildCatMenu(ctx: UiContext, cat: Cat, close: () => void): Container {
  const W = 380;
  const root = new Container();
  const busy = isBusy(ctx.state, cat.id);
  const selected = ctx.selection.includes(cat.id);

  const traits = catTraits(cat);
  const H = 150 + traits.length * 20 + (busy ? 28 : 0) + 4 * 54;
  root.addChild(panel(W, H, COLORS.hud, 18));

  const title = label(describeCat(cat), 17, COLORS.ink, '800');
  title.position.set(W / 2, 28);
  root.addChild(title);

  const st = stars(cat.rarityTier, 15);
  st.position.set(W / 2, 52);
  root.addChild(st);

  let y = 78;
  for (const line of traits) {
    const t = label(line, 13, COLORS.inkSoft, '600');
    t.anchor.set(0, 0.5);
    t.position.set(28, y);
    root.addChild(t);
    y += 20;
  }
  y += 8;

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

  addBtn(
    selected ? '✓ Выбран для вязки' : '🐾 Выбрать для вязки',
    selected ? COLORS.good : COLORS.primary,
    !busy,
    () => { ctx.toggleSelect(cat.id); close(); ctx.commit(); },
  );

  if (cat.location === 'nursery') {
    addBtn('➡️ Отправить в приют', COLORS.secondary, !busy, () => {
      const r = moveCat(ctx.state, cat.id, 'shelter');
      if (r.ok) { close(); ctx.commit(); } else ctx.toast(r.reason);
    });
  } else {
    const rw = adoptReward(ctx.state, cat);
    addBtn(`🏠 Пристроить (+💰${rw.coins} +🧬${rw.dna})`, COLORS.good, !busy, () => {
      const r = adoptCat(ctx.state, cat.id);
      if (r.ok) { close(); ctx.commit(); ctx.toast(`Котик в добрых руках 🏠 +💰${r.coins} +🧬${r.dna}`); }
      else ctx.toast(r.reason);
    });
    addBtn('⬅️ Вернуть в питомник', COLORS.secondary, !busy, () => {
      const r = moveCat(ctx.state, cat.id, 'nursery');
      if (r.ok) { close(); ctx.commit(); } else ctx.toast(r.reason);
    });
  }

  if (!cat.analyzed) {
    addBtn(`🔬 Анализ носительства (${ANALYZE_COST} 🧬)`, COLORS.dna, ctx.state.dna >= ANALYZE_COST, () => {
      const r = analyzeCat(ctx.state, cat.id);
      if (r.ok) { close(); ctx.commit(); ctx.toast('Анализ выполнен 🔬'); }
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
