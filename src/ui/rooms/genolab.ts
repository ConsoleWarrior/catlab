/**
 * Комната «Генолаб» — хаб для 🧬 ДНК. Разбита на под-секции (табы):
 *   📖 Котодекс    — альбом всех пород по тирам (силуэт, пока не выведена);
 *   🔬 Исследования — дерево постоянных бонусов лаборатории за 🧬;
 *   🧫 Клон-банк    — клонирование пристроенных котов (скоро).
 *
 * Работают Котодекс и Исследования; Клон-банк — заглушка «скоро».
 * Усилители вязки («Генная инженерия») переехали к названию Инкубатора.
 */

import { Container, Graphics, Rectangle, Sprite, Text } from 'pixi.js';
import type { FederatedWheelEvent } from 'pixi.js';
import { BREEDS, BREEDS_BY_TIER, breedName } from '../../genetics/index.js';
import type { RarityTier } from '../../genetics/index.js';
import { RESEARCH, unlockResearch, UPGRADES, buyUpgrade, upgradeCost, upgradeMaxed } from '../../game/index.js';
import type { ResearchDef } from '../../game/index.js';
import type { Room, UiContext } from '../context.js';
import { roomShell } from './shell.js';
import { Button, COLORS, FONT, label, panel, TIER_RU, TIER_COLOR, TIERS } from '../theme.js';
import { breedThumbTexture } from '../catTextures.js';
import { CUR_GLYPH } from '../upgradeButton.js';

type Section = 'codex' | 'research' | 'clone';

/** Иконки апгрейдов Инкубатора (4-я ветка Исследований). */
const UPGRADE_GLYPH: Record<string, string> = { slots: '💞', speed: '⏩' };

export function createGenolab(ctx: UiContext): Room {
  const shell = roomShell(ctx, 'genolab', '🔬 Генолаб');
  let section: Section = 'codex';
  // вертикальный скролл по секциям (сохраняется между перерисовками; у каждой свой)
  const scroll: Record<'codex' | 'research', number> = { codex: 0, research: 0 };
  let suppressTap = false;  // был свайп-скролл — гасим случайную покупку по тапу

  function tabBar(): Container {
    const c = new Container();
    const defs: { id: Section; text: string }[] = [
      { id: 'codex', text: '📖 Котодекс' },
      { id: 'research', text: '🔬 Исследования' },
      { id: 'clone', text: '🧫 Клон-банк' },
    ];
    const gap = 8;
    const bw = (shell.contentW - gap * (defs.length - 1)) / defs.length;
    defs.forEach((d, i) => {
      const active = d.id === section;
      const b = new Button({
        text: d.text, w: bw, h: 38,
        color: active ? COLORS.primary : COLORS.card,
        textColor: active ? 0xffffff : COLORS.ink, fontSize: 13,
      });
      b.position.set(bw / 2 + i * (bw + gap), 19);
      b.onTap = () => { section = d.id; refresh(); };
      c.addChild(b);
    });
    return c;
  }

  function discovered(key: string): boolean {
    return ctx.state.discoveredBreeds.includes(key);
  }

  /** Клетка Котодекса: портрет породы (если выведена) или силуэт-замок. */
  function codexCell(key: string, tier: RarityTier, cx: number, cy: number, size: number): Container {
    const c = new Container();
    c.position.set(cx, cy);
    const open = discovered(key);

    const bg = new Graphics();
    bg.roundRect(-size / 2, -size / 2, size, size, 8)
      .fill({ color: open ? COLORS.card : 0x000000, alpha: open ? 1 : 0.1 })
      .stroke({ width: 2, color: TIER_COLOR[tier], alpha: open ? 0.9 : 0.25 });
    c.addChild(bg);

    if (open) {
      const tex = breedThumbTexture(key);
      if (tex) {
        const sp = new Sprite(tex);
        sp.anchor.set(0.5, 1);
        sp.scale.set(Math.min((size * 0.92) / tex.height, (size * 1.05) / tex.width));
        sp.position.set(0, size / 2 - 3);
        c.addChild(sp);
      } else {
        const paw = label('🐾', size * 0.4, COLORS.ink, '700');
        c.addChild(paw);
      }
    } else {
      const q = label('?', size * 0.42, TIER_COLOR[tier], '800');
      q.alpha = 0.55;
      c.addChild(q);
    }

    c.eventMode = 'static';
    c.cursor = 'pointer';
    c.on('pointertap', () => {
      if (suppressTap) return;          // это был скролл/свайп, а не тап
      ctx.toast(open ? `${breedName(key)} · ${TIER_RU[tier]}` : 'ещё не выведена');
    });
    return c;
  }

  /**
   * 📖 Котодекс: альбом пород по тирам. Клетки крупные и читаемые (особенно на
   * мобиле); каждый тир — подзаголовок + сетка с переносом по строкам, всё лишнее
   * уходит под вертикальную прокрутку (как в Исследованиях).
   */
  function renderCodex(): void {
    const top = 46;
    const haveCount = BREEDS.filter((b) => discovered(b.key)).length;
    const header = label(`Открыто пород: ${haveCount} / ${BREEDS.length}`, 15, COLORS.ink, '800');
    header.anchor.set(0, 0.5);
    header.position.set(2, top + 10);
    shell.body.addChild(header);

    // окно прокрутки (маска) + прокручиваемое содержимое — как в renderResearch
    const viewTop = top + 28;
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

    // размер клетки: целимся в крупный читаемый размер, число колонок подбираем
    // под ширину окна. Клетки на 5% меньше «впритык», а сетку центрируем — так у
    // краёв экрана остаётся небольшой отступ, иконки не липнут к стенкам.
    const gap = 8;
    const targetCell = Math.max(84, Math.min(132, viewW * 0.16));
    const cols = Math.max(3, Math.floor((viewW + gap) / (targetCell + gap)));
    const cell = ((viewW - gap * (cols - 1)) / cols) * 0.95;
    const gridW = cols * cell + gap * (cols - 1);
    const gridX = (viewW - gridW) / 2;

    let y = 4;
    TIERS.forEach((tier) => {
      const list = BREEDS_BY_TIER[tier];
      const got = list.filter((b) => discovered(b.key)).length;

      const tl = label(TIER_RU[tier], 14, TIER_COLOR[tier], '800');
      tl.anchor.set(0, 0.5);
      tl.position.set(2, y + 9);
      const cnt = label(`${got} / ${list.length}`, 12, COLORS.inkSoft, '700');
      cnt.anchor.set(0, 0.5);              // сразу за названием редкости, не у края экрана
      cnt.position.set(2 + tl.width + 8, y + 9);
      content.addChild(tl, cnt);
      y += 26;

      list.forEach((b, i) => {
        const cx = gridX + (i % cols) * (cell + gap) + cell / 2;
        const cy = y + Math.floor(i / cols) * (cell + gap) + cell / 2;
        content.addChild(codexCell(b.key, tier, cx, cy, cell));
      });
      const rows = Math.ceil(list.length / cols);
      y += rows * (cell + gap) - gap + 16; // ряды тира + отступ до следующего тира
    });

    setupScroll(scroll, 'codex', viewport, content, viewW, viewH, y);
  }

  /** Многострочный центрированный текст (узкие узлы дерева). */
  function wrapped(text: string, size: number, color: number, weight: '600' | '700' | '800', maxW: number): Text {
    const t = new Text({
      text,
      style: {
        fontFamily: FONT, fontSize: size, fontWeight: weight, fill: color,
        align: 'center', wordWrap: true, wordWrapWidth: Math.max(40, maxW), lineHeight: size + 3,
      },
    });
    t.anchor.set(0.5);
    return t;
  }

  /** Узел дерева исследований: состояние (изучено/доступно/дорого/заблокировано) + тап. */
  function researchNode(def: ResearchDef, nw: number, nh: number): Container {
    const c = new Container();
    const owned = ctx.state.research.includes(def.id);
    const reqMet = def.requires.every((r) => ctx.state.research.includes(r));
    const affordable = ctx.state.dna >= def.dna;
    const available = reqMet && !owned;
    const highlight = owned || (available && affordable);

    const bg = new Graphics();
    bg.roundRect(-nw / 2, -nh / 2, nw, nh, 12)
      .fill({ color: owned ? COLORS.good : COLORS.card, alpha: owned ? 0.22 : available ? 1 : 0.5 })
      .stroke({
        width: highlight ? 3 : 2,
        color: owned ? COLORS.good : available && affordable ? COLORS.dna : COLORS.cardEdge,
        alpha: reqMet ? 0.95 : 0.4,
      });
    c.addChild(bg);

    // Узлы всегда широкие (игра ландшафтная), но низкие на мобиле — отступы
    // делаем пропорциональными высоте, чтобы 3 строки помещались при любом nh.
    const dim = reqMet ? 1 : 0.5;
    const title = wrapped(`${def.glyph} ${def.title}`, Math.min(14, nh * 0.2), COLORS.ink, '800', nw - 14);
    title.position.set(0, -nh / 2 + nh * 0.24);
    title.alpha = dim;
    c.addChild(title);

    const desc = wrapped(def.desc, Math.min(11, nh * 0.16), COLORS.inkSoft, '600', nw - 12);
    desc.position.set(0, -nh / 2 + nh * 0.52);
    desc.alpha = dim;
    c.addChild(desc);

    const status = owned
      ? label('✓ изучено', Math.min(11, nh * 0.16), COLORS.good, '800')
      : reqMet
        ? label(`${def.dna} 🧬`, Math.min(13, nh * 0.18), affordable ? COLORS.dna : COLORS.inkSoft, '800')
        : label('🔒', Math.min(14, nh * 0.2), COLORS.inkSoft, '700');
    status.position.set(0, -nh / 2 + nh * 0.8);
    c.addChild(status);

    c.eventMode = 'static';
    c.cursor = 'pointer';
    c.on('pointertap', () => {
      if (suppressTap) return;          // это был скролл, а не тап
      if (owned) { ctx.toast(`${def.title}: ${def.desc}`); return; }
      const r = unlockResearch(ctx.state, def.id);
      if (r.ok) { ctx.commit(); ctx.toast(`Изучено: ${def.title} ✅`); }
      else ctx.toast(r.reason);
    });
    return c;
  }

  /**
   * Узел-апгрейд Инкубатора (4-я ветка): слоты вязки / скорость инкубации.
   * В отличие от исследований — многоуровневый (за 💰), показывает уровень/макс
   * и цену следующего уровня; по тапу покупает следующий уровень.
   */
  function upgradeNode(id: string, nw: number, nh: number): Container {
    const def = UPGRADES[id]!;
    const maxLvl = id === 'slots' ? UPGRADES.slots!.max : def.max;
    const curLvl = id === 'slots' ? ctx.state.slots.length - 1 : (ctx.state.upgrades[id] ?? 0);
    const maxed = upgradeMaxed(ctx.state, id);
    const cost = upgradeCost(ctx.state, id);
    const affordable = !!cost && ctx.state[cost.currency] >= cost.amount;
    const highlight = !maxed && affordable;

    const c = new Container();
    const bg = new Graphics();
    bg.roundRect(-nw / 2, -nh / 2, nw, nh, 12)
      .fill({ color: maxed ? COLORS.good : COLORS.card, alpha: maxed ? 0.22 : 1 })
      .stroke({
        width: highlight ? 3 : 2,
        color: maxed ? COLORS.good : affordable ? COLORS.coins : COLORS.cardEdge,
        alpha: 0.95,
      });
    c.addChild(bg);

    const title = wrapped(`${UPGRADE_GLYPH[id] ?? '⚙️'} ${def.label}`, Math.min(14, nh * 0.2), COLORS.ink, '800', nw - 14);
    title.position.set(0, -nh / 2 + nh * 0.24);
    c.addChild(title);

    const lvlT = wrapped(`уровень ${curLvl} / ${maxLvl}`, Math.min(11, nh * 0.16), COLORS.inkSoft, '600', nw - 12);
    lvlT.position.set(0, -nh / 2 + nh * 0.52);
    c.addChild(lvlT);

    const status = maxed
      ? label('✓ максимум', Math.min(11, nh * 0.16), COLORS.good, '800')
      : label(`${cost!.amount} ${CUR_GLYPH[cost!.currency]}`, Math.min(13, nh * 0.18), affordable ? COLORS.coins : COLORS.inkSoft, '800');
    status.position.set(0, -nh / 2 + nh * 0.8);
    c.addChild(status);

    c.eventMode = 'static';
    c.cursor = 'pointer';
    c.on('pointertap', () => {
      if (suppressTap) return;          // это был скролл, а не тап
      if (maxed) { ctx.toast(`${def.label}: максимум`); return; }
      const r = buyUpgrade(ctx.state, id);
      if (r.ok) { ctx.commit(); ctx.toast(`${def.label} улучшено ✅`); }
      else ctx.toast(r.reason);
    });
    return c;
  }

  /**
   * Вертикальный скролл содержимого окна: drag-перетаскивание (палец/мышь),
   * колесо мыши (ПК) и тонкий индикатор справа. Позиция хранится в `store[key]`,
   * чтобы у каждой секции был свой скролл между перерисовками.
   *
   * Перетаскивание реагирует только когда жест выбран как вертикальный
   * (`ctx.gestureAxis === 'v'`): если игрок повёл вбок, навигация уводит в
   * соседнюю комнату, а контент не дёргается — либо вниз меню, либо вбок комната.
   */
  function setupScroll(
    store: Record<'codex' | 'research', number>, key: 'codex' | 'research',
    viewport: Container, content: Container, viewW: number, viewH: number, contentH: number,
  ): void {
    const maxScroll = Math.max(0, contentH - viewH);
    const clamp = (v: number): number => Math.max(-maxScroll, Math.min(0, v));
    if (maxScroll <= 0) { store[key] = 0; content.y = 0; return; }

    store[key] = clamp(store[key]);
    content.y = store[key];

    viewport.eventMode = 'static';
    viewport.hitArea = new Rectangle(0, 0, viewW, viewH);

    // тонкий индикатор прокрутки справа (поверх содержимого, сам не скроллится)
    const sbW = 4, sbX = viewW - sbW - 1;
    const thumb = new Graphics();
    viewport.addChild(thumb);
    const drawThumb = (): void => {
      const th = Math.max(24, viewH * (viewH / contentH));
      const ty = (-store[key] / maxScroll) * (viewH - th);
      thumb.clear();
      thumb.roundRect(sbX, ty, sbW, th, 2).fill({ color: COLORS.cardEdge, alpha: 0.9 });
    };
    drawThumb();

    const apply = (y: number): void => { store[key] = clamp(y); content.y = store[key]; drawThumb(); };

    let dragging = false, lastY = 0, startY = 0;
    viewport.on('pointerdown', (e) => { dragging = true; lastY = e.global.y; startY = e.global.y; suppressTap = false; });
    viewport.on('globalpointermove', (e) => {
      if (!dragging) return;
      const dy = e.global.y - lastY;
      lastY = e.global.y;
      if (ctx.gestureAxis === 'h') suppressTap = true;     // ушли в свайп комнат
      if (ctx.gestureAxis !== 'v') return;                 // не решено или горизонталь — не скроллим
      apply(store[key] + dy);
      if (Math.abs(e.global.y - startY) > 6) suppressTap = true; // двинули — это скролл, не тап
    });
    const stop = (): void => { dragging = false; };
    viewport.on('pointerup', stop);
    viewport.on('pointerupoutside', stop);

    // колесо мыши (ПК)
    viewport.on('wheel', (e: FederatedWheelEvent) => apply(store[key] - e.deltaY));
  }

  /**
   * 🔬 Дерево исследований: 3 ветки бонусов (за 🧬) + 4-я ветка апгрейдов
   * Инкубатора (за 💰). Содержимое прокручивается по вертикали, если не влезает.
   */
  function renderResearch(): void {
    const top = 50;
    const header = label(
      `🔬 Бонусы лаборатории  ·  🧬 ${ctx.state.dna}  ·  💰 ${ctx.state.coins}`,
      13, COLORS.ink, '700',
    );
    header.anchor.set(0, 0.5);
    header.position.set(2, top);
    shell.body.addChild(header);

    // окно прокрутки (маска) + прокручиваемое содержимое
    const viewTop = top + 18;
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

    // сетка: 3 ветки бонусов (строки 0..2) + ветка апгрейдов Инкубатора (строка upRow).
    // Высота узла фиксированная и читаемая — содержимое прокручивается, если не влезает.
    const cols = Math.max(...RESEARCH.map((r) => r.col)) + 1;
    const upRow = Math.max(...RESEARCH.map((r) => r.row)) + 1;
    const rows = upRow + 1;
    const colGap = 12, rowGap = 12;
    const nw = (viewW - colGap * (cols - 1)) / cols;
    const nh = Math.max(96, Math.min(126, viewH * 0.42));
    const cx = (col: number): number => col * (nw + colGap) + nw / 2;
    const cy = (row: number): number => row * (nh + rowGap) + nh / 2;

    // связи (под узлами): от предпосылки к узлу
    const links = new Graphics();
    for (const def of RESEARCH) {
      for (const reqId of def.requires) {
        const req = RESEARCH.find((r) => r.id === reqId);
        if (!req) continue;
        const owned = ctx.state.research.includes(reqId);
        links.moveTo(cx(req.col) + nw / 2, cy(req.row))
          .lineTo(cx(def.col) - nw / 2, cy(def.row))
          .stroke({ width: 3, color: owned ? COLORS.good : COLORS.cardEdge, alpha: owned ? 0.9 : 0.5 });
      }
    }
    content.addChild(links);

    for (const def of RESEARCH) {
      const node = researchNode(def, nw, nh);
      node.position.set(cx(def.col), cy(def.row));
      content.addChild(node);
    }

    // 4-я ветка: апгрейды Инкубатора (независимые, без связей между собой)
    ['slots', 'speed'].forEach((id, i) => {
      const node = upgradeNode(id, nw, nh);
      node.position.set(cx(i), cy(upRow));
      content.addChild(node);
    });

    const contentH = cy(rows - 1) + nh / 2;
    setupScroll(scroll, 'research', viewport, content, viewW, viewH, contentH);
  }

  function renderStub(title: string, desc: string[]): void {
    const top = 56;
    const p = panel(shell.contentW, Math.max(120, shell.contentH - top - 4), COLORS.card, 16);
    p.position.set(0, top);
    shell.body.addChild(p);

    const t = label(title, 18, COLORS.ink, '800');
    t.position.set(shell.contentW / 2, top + 34);
    shell.body.addChild(t);

    let y = top + 72;
    for (const line of desc) {
      const l = label(line, 14, COLORS.inkSoft, '600');
      l.position.set(shell.contentW / 2, y);
      shell.body.addChild(l);
      y += 24;
    }
    const soon = label('🔒 скоро', 16, COLORS.warn, '800');
    soon.position.set(shell.contentW / 2, y + 12);
    shell.body.addChild(soon);
  }

  function refresh(): void {
    shell.body.removeChildren();
    shell.body.addChild(tabBar());
    if (section === 'codex') {
      renderCodex();
    } else if (section === 'research') {
      renderResearch();
    } else {
      renderStub('🧫 Клон-банк ДНК', [
        'Образцы пристроенных и ушедших котов.',
        'Клонируй породу+пол обратно за 🧬 —',
        'страховка от потери редких.',
      ]);
    }
  }

  return {
    id: 'genolab', title: '🔬 Генолаб', container: shell.container, refresh,
    setSection: (id: string) => { section = id as Section; refresh(); },
  };
}
