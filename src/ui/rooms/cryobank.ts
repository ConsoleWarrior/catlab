/**
 * Комната «Крио-банк» (криохранилище коллекции) — 5-я в разрезе лаборатории.
 * Появляется в ряду только после покупки узла Селекции «❄️ Криогенетика»
 * (см. game.ts / economy.cryoUnlocked). Витрина замороженных котов: сетка
 * криокапсул с голубоватым свечением. Замороженный кот не ест, не даёт доход и
 * недоступен для вязки — так вся коллекция пород помещается без 70 живых котов.
 *
 * Разморозки НЕТ: капсулу освобождает только клонирование (за 🧬) или утилизация.
 * Меню капсулы — оверлей ctx.openCryoMenu (см. overlays.buildCryoMenu). Сетка
 * прокручивается по вертикали, если капсул больше, чем влезает на экран.
 */

import { Container, Graphics, Rectangle } from 'pixi.js';
import type { FederatedWheelEvent } from 'pixi.js';
import { breedName } from '../../genetics/index.js';
import { cryoCapacity, cryoCount, RESEARCH, CRYO_BASE_CAP } from '../../game/index.js';
import type { Cat } from '../../game/index.js';
import type { Room, UiContext } from '../context.js';
import { roomShell } from './shell.js';
import { COLORS, label, TIER_COLOR } from '../theme.js';
import { aiSitSpriteFor, catSprite } from '../catTextures.js';
import { t } from '../../i18n.js';

// Позиция скролла переживает пересборку комнаты (ресайз окна пересоздаёт комнату).
const remembered = { scroll: 0 };

// Максимально возможная ёмкость (база + все ранги «Криогенетики») — до неё рисуем
// сетку: занятые капсулы, пустые (в пределах текущей ёмкости) и запертые (сверх неё).
const CRYO_MAX_CAP = CRYO_BASE_CAP
  + (RESEARCH.find((r) => r.id === 'r_sel_cryo')?.levels.reduce((s, l) => s + l.value, 0) ?? 0);

const ICE = 0x8ecae6; // морозный акцент капсул/свечения

export function createCryobank(ctx: UiContext): Room {
  const shell = roomShell(ctx, 'cryobank', t('🧫 Крио-банк', '🧫 Cryobank'));
  let suppressTap = false; // был свайп-скролл — гасим случайный тап по капсуле

  /** Одна криокапсула: занятая (кот в голубом свечении), пустая «＋» или запертая 🔒. */
  function capsule(cat: Cat | null, locked: boolean, cx: number, cy: number, w: number, h: number): Container {
    const c = new Container();
    c.position.set(cx, cy);

    // колба: капсульная форма (сильно скруглённые углы), морозное стекло
    const glassCol = locked ? 0x2f4a55 : cat ? 0xe8f6fb : 0xeef4f6;
    const edgeCol = locked ? 0x3a5560 : ICE;
    const r = Math.min(w, h) * 0.32;
    const glass = new Graphics();
    glass.roundRect(-w / 2, -h / 2, w, h, r)
      .fill({ color: glassCol, alpha: locked ? 0.6 : 0.95 })
      .stroke({ width: 2.5, color: edgeCol, alpha: locked ? 0.6 : 0.9 });
    c.addChild(glass);

    if (locked) {
      const lock = label('🔒', Math.min(w, h) * 0.34, 0xbcd7e0, '700');
      lock.position.set(0, -h * 0.06);
      const cap = label(t('капсула', 'capsule'), 10, 0xbcd7e0, '700');
      cap.position.set(0, h * 0.28);
      c.addChild(lock, cap);
      c.eventMode = 'static';
      c.cursor = 'pointer';
      c.on('pointertap', () => { if (!suppressTap) ctx.toast(t('Больше капсул — узел ❄️ Криогенетика в Генолабе', 'More capsules — the ❄️ Cryogenetics node in the Genolab')); });
      return c;
    }

    if (!cat) {
      const plus = label('＋', Math.min(w, h) * 0.4, ICE, '700');
      plus.position.set(0, -h * 0.06);
      const hint = label(t('пусто', 'empty'), 10, COLORS.inkSoft, '700');
      hint.position.set(0, h * 0.28);
      c.addChild(plus, hint);
      c.eventMode = 'static';
      c.cursor = 'pointer';
      c.on('pointertap', () => { if (!suppressTap) ctx.toast(t('Заморозь кота: в его меню — «🧊 Заморозить»', 'Freeze a cat: «🧊 Freeze» in its menu')); });
      return c;
    }

    // морозное свечение под котом
    const catH = h * 0.6;
    const halo = new Graphics();
    halo.ellipse(0, -h * 0.02, w * 0.34, catH * 0.34).fill({ color: ICE, alpha: 0.4 });
    c.addChild(halo);

    // спрайт кота (по породе+полу), тонирован в лёд
    const sp = aiSitSpriteFor(cat, catH) ?? catSprite(ctx.app, cat, catH);
    sp.tint = 0xcfeaf6;
    sp.position.set(0, h * 0.20);
    c.addChild(sp);

    // подпись породы (в цвет тира) на морозной таблетке; длинные названия ужимаем
    // по ширине капсулы, чтобы соседние подписи не наезжали друг на друга
    const nameT = label(breedName(cat.breed), 10.5, TIER_COLOR[cat.rarityTier], '800');
    const maxNameW = w - 8;
    if (nameT.width > maxNameW) nameT.scale.set(maxNameW / nameT.width);
    const pw = nameT.width + 10;
    const pillBg = new Graphics();
    pillBg.roundRect(-pw / 2, h * 0.5 - 20, pw, 17, 8).fill({ color: COLORS.card, alpha: 0.92 });
    nameT.position.set(0, h * 0.5 - 11);
    c.addChild(pillBg, nameT);

    c.eventMode = 'static';
    c.cursor = 'pointer';
    c.on('pointertap', () => { if (!suppressTap) ctx.openCryoMenu(cat); });
    return c;
  }

  /** Вертикальный скролл содержимого окна (drag + колесо + индикатор). */
  function setupScroll(viewport: Container, content: Container, viewW: number, viewH: number, contentH: number): void {
    const maxScroll = Math.max(0, contentH - viewH);
    const clamp = (v: number): number => Math.max(-maxScroll, Math.min(0, v));
    if (maxScroll <= 0) { remembered.scroll = 0; content.y = 0; return; }

    remembered.scroll = clamp(remembered.scroll);
    content.y = remembered.scroll;

    viewport.eventMode = 'static';
    viewport.hitArea = new Rectangle(0, 0, viewW, viewH);

    const sbW = 4, sbX = viewW - sbW - 1;
    const thumb = new Graphics();
    viewport.addChild(thumb);
    const drawThumb = (): void => {
      const th = Math.max(24, viewH * (viewH / contentH));
      const ty = (-remembered.scroll / maxScroll) * (viewH - th);
      thumb.clear();
      thumb.roundRect(sbX, ty, sbW, th, 2).fill({ color: COLORS.cardEdge, alpha: 0.9 });
    };
    drawThumb();

    const apply = (y: number): void => { remembered.scroll = clamp(y); content.y = remembered.scroll; drawThumb(); };
    let dragging = false, lastY = 0, startY = 0;
    viewport.on('pointerdown', (e) => { dragging = true; lastY = viewport.toLocal(e.global).y; startY = lastY; suppressTap = false; });
    viewport.on('globalpointermove', (e) => {
      if (!dragging) return;
      const y = viewport.toLocal(e.global).y;
      const dy = y - lastY;
      lastY = y;
      if (ctx.gestureAxis === 'h') suppressTap = true;   // ушли в свайп комнат
      if (ctx.gestureAxis !== 'v') return;
      apply(remembered.scroll + dy);
      if (Math.abs(y - startY) > 6) suppressTap = true;   // это скролл, не тап
    });
    const stop = (): void => { dragging = false; };
    viewport.on('pointerup', stop);
    viewport.on('pointerupoutside', stop);
    viewport.on('wheel', (e: FederatedWheelEvent) => apply(remembered.scroll - e.deltaY));
  }

  function refresh(): void {
    shell.body.removeChildren();
    const cap = cryoCapacity(ctx.state);
    const count = cryoCount(ctx.state);
    shell.setTitleBadge(`❄️ ${count}/${cap}`);

    // подсказка сверху
    const top = 6;
    const header = label(t('Заморозь кота (🧊 в его меню) — витрина без живого кота. Клонируй за 🧬 или утилизируй.', 'Freeze a cat (🧊 in its menu) — a showcase without a living cat. Clone it for 🧬 or recycle it.'),
      12.5, COLORS.inkSoft, '600');
    header.anchor.set(0, 0.5);
    header.position.set(2, top + 10);
    shell.body.addChild(header);

    // окно прокрутки (маска) + прокручиваемое содержимое
    const viewTop = top + 26;
    const viewW = shell.contentW;
    const viewH = shell.contentH - viewTop;
    const viewport = new Container();
    viewport.position.set(0, viewTop);
    const maskG = new Graphics();
    maskG.rect(0, 0, viewW, viewH).fill(0xffffff);
    const content = new Container();
    viewport.addChild(content, maskG);
    content.mask = maskG;
    shell.body.addChild(viewport);

    // сетка капсул: число колонок под ширину, капсула вертикальная (колба)
    const gap = 10;
    const targetW = Math.max(78, Math.min(120, viewW * 0.15));
    const cols = Math.max(3, Math.floor((viewW + gap) / (targetW + gap)));
    const cw = (viewW - gap * (cols - 1)) / cols;
    const ch = cw * 1.32;

    const cryo = ctx.state.cryo ?? [];
    // рисуем сетку до максимально возможной ёмкости: занятые + пустые (в пределах
    // текущей cap) + запертые (сверх неё, с замком «+капсулы в Криогенетике»)
    const slots = Math.max(CRYO_MAX_CAP, cap);
    const y = ch / 2 + 2;
    for (let i = 0; i < slots; i++) {
      const cx = (i % cols) * (cw + gap) + cw / 2;
      const cy = y + Math.floor(i / cols) * (ch + gap);
      const cat = i < cryo.length ? cryo[i]! : null;
      const locked = i >= cap;
      content.addChild(capsule(cat, locked, cx, cy, cw, ch));
    }
    const rows = Math.ceil(slots / cols);
    const contentH = rows * (ch + gap) - gap + 8;
    setupScroll(viewport, content, viewW, viewH, contentH);
  }

  return { id: 'cryobank', title: t('🧫 Крио-банк', '🧫 Cryobank'), container: shell.container, refresh };
}
