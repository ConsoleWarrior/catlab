/**
 * Комната «Генолаб» — хаб для 🧬 ДНК. Разбита на под-секции (табы):
 *   📖 Котодекс    — альбом всех пород по тирам (силуэт, пока не выведена);
 *   🔬 Исследования — дерево постоянных бонусов за 🧬 (4 ветки: Селекция, Обучение,
 *                     Пристройство, Хозяйство); открывается уровнем лаборатории.
 *
 * Крио-банк вынесен в ОТДЕЛЬНУЮ комнату (5-я в разрезе, см. rooms/cryobank.ts) —
 * появляется после покупки узла Селекции «❄️ Криогенетика».
 * Усилители вязки («Генная инженерия») переехали к названию Инкубатора.
 */

import { Container, Graphics, Rectangle, Sprite, Text } from 'pixi.js';
import type { FederatedWheelEvent } from 'pixi.js';
import { BREEDS, BREEDS_BY_TIER, breedName } from '../../genetics/index.js';
import type { RarityTier } from '../../genetics/index.js';
import {
  RESEARCH, unlockResearch, isUnlocked, unlockLevelOf,
  researchLevel, researchOwned, researchMaxed, researchNext,
} from '../../game/index.js';
import type { ResearchDef } from '../../game/index.js';
import type { Room, UiContext } from '../context.js';
import { roomShell } from './shell.js';
import { Button, COLORS, FONT, label, panel, TIER_RU, TIER_COLOR, TIERS } from '../theme.js';
import { breedThumbTexture } from '../catTextures.js';

type Section = 'codex' | 'research';

// Активная секция и позиции скролла переживают пересборку комнаты (ресайз окна
// пересоздаёт Генолаб целиком): без этого открытые «Исследования» слетали бы
// обратно на Котодекс, а прокрутка — в начало, при каждом изменении окна.
const remembered = {
  section: 'codex' as Section,
  scroll: { codex: 0, research: 0 } as Record<'codex' | 'research', number>,
};

/** Метаданные веток дерева исследований (ряд → заголовок + валюта прокачки). */
const BRANCHES: { row: number; label: string }[] = [
  { row: 0, label: '🧪 Селекция · 🧬' },
  { row: 1, label: '🎓 Обучение · 💰' },
  { row: 2, label: '🤝 Пристройство · 💰' },
  { row: 3, label: '🏠 Хозяйство · 💰' },
];

/** Затемнить цвет: умножить RGB-компоненты на f (<1 — темнее). */
function shade(color: number, f: number): number {
  const r = Math.round(((color >> 16) & 0xff) * f);
  const g = Math.round(((color >> 8) & 0xff) * f);
  const b = Math.round((color & 0xff) * f);
  return (r << 16) | (g << 8) | b;
}

/** Осветлить цвет к белому на долю t (0 — без изменений, 1 — белый). */
function lighten(color: number, t: number): number {
  const ch = (c: number): number => Math.round(c + (255 - c) * t);
  return (ch((color >> 16) & 0xff) << 16) | (ch((color >> 8) & 0xff) << 8) | ch(color & 0xff);
}

/**
 * Подпись на полупрозрачной «таблетке» (фон под текстом) — чтобы читалась поверх
 * ИИ-фона комнаты. Сегменты выкладываются в строку, фон обтекает их по ширине.
 * Контейнер крепится за левый край; его вертикальный центр ставится на нужный y.
 */
function pillRow(segs: { text: string; size: number; color: number; weight: '400' | '600' | '700' | '800' }[]): Container {
  const c = new Container();
  const padX = 9, gap = 7;
  const parts: Text[] = [];
  let x = padX, maxSize = 0;
  for (const s of segs) {
    const t = label(s.text, s.size, s.color, s.weight);
    t.anchor.set(0, 0.5);
    t.position.set(x, 0);
    x += t.width + gap;
    maxSize = Math.max(maxSize, s.size);
    parts.push(t);
  }
  const w = x - gap + padX;
  const h = maxSize + 11;
  const bg = new Graphics();
  bg.roundRect(0, -h / 2, w, h, h / 2).fill({ color: COLORS.card, alpha: 0.9 });
  c.addChild(bg, ...parts);
  return c;
}

export function createGenolab(ctx: UiContext): Room {
  const shell = roomShell(ctx, 'genolab', '🔬 Генолаб');
  let section: Section = remembered.section;
  // вертикальный скролл по секциям (сохраняется между перерисовками и
  // пересборками комнаты — живёт в module-level `remembered`; у каждой свой)
  const scroll = remembered.scroll;
  let suppressTap = false;  // был свайп-скролл — гасим случайную покупку по тапу

  function tabBar(): Container {
    const c = new Container();
    const defs: { id: Section; text: string }[] = [
      { id: 'codex', text: '📖 Котодекс' },
      { id: 'research', text: '🔬 Исследования' },
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
      b.onTap = () => { section = d.id; remembered.section = d.id; refresh(); };
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
    // фон всегда непрозрачный (под ним — ИИ-арт комнаты): открытая клетка светлая,
    // неоткрытая — затемнённая (силуэт-замок), без просвечивания фона.
    bg.roundRect(-size / 2, -size / 2, size, size, 8)
      .fill({ color: open ? COLORS.card : shade(COLORS.card, 0.72), alpha: 1 })
      .stroke({ width: 2, color: TIER_COLOR[tier], alpha: open ? 0.9 : 0.5 });
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
      q.alpha = 0.7;
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
    const header = pillRow([{ text: `Открыто пород: ${haveCount} / ${BREEDS.length}`, size: 15, color: COLORS.ink, weight: '800' }]);
    header.position.set(2, top + 11);
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

      const tierChip = pillRow([
        { text: TIER_RU[tier], size: 14, color: TIER_COLOR[tier], weight: '800' },
        { text: `${got} / ${list.length}`, size: 12, color: COLORS.inkSoft, weight: '700' },
      ]);
      tierChip.position.set(2, y + 9);
      content.addChild(tierChip);
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

  /** Ряд пипсов уровня узла: ● куплено (цветом валюты) / ○ осталось. */
  function levelPips(owned: number, total: number, curColor: number, dot: number): Container {
    const c = new Container();
    const gap = dot * 2.4;
    const w = (total - 1) * gap;
    for (let i = 0; i < total; i++) {
      const g = new Graphics();
      g.circle(i * gap - w / 2, 0, dot)
        .fill({ color: i < owned ? curColor : COLORS.cardEdge, alpha: i < owned ? 1 : 0.7 });
      c.addChild(g);
    }
    return c;
  }

  /**
   * Карточка узла дерева исследований (многоуровневого). Валюта своя у ветки: 🧬 у
   * Селекции, 💰 у остальных. Состояния: прокачан полностью (зелёная), доступен
   * следующий уровень (подсвечена, рамка валюты), заперт предыдущим узлом или уровнем
   * лаборатории этого уровня (приглушённая, замок). Пипсы показывают прогресс уровней.
   */
  function researchNode(def: ResearchDef, nw: number, nh: number): Container {
    const owned = researchLevel(ctx.state, def.id);
    const total = def.levels.length;
    const maxed = researchMaxed(ctx.state, def);
    const next = researchNext(ctx.state, def);
    const reqMet = def.requires.every((r) => researchOwned(ctx.state, r));
    const levelLocked = !!next && ctx.state.level < next.minLevel;   // этот уровень ещё заперт
    const curColor = def.currency === 'dna' ? COLORS.dna : COLORS.coins;
    const curGlyph = def.currency === 'dna' ? '🧬' : '💰';
    const balance = def.currency === 'dna' ? ctx.state.dna : ctx.state.coins;
    const affordable = !!next && balance >= next.cost;
    const buyable = !maxed && reqMet && !levelLocked && affordable;
    const hardLocked = !maxed && (!reqMet || levelLocked);

    const c = new Container();
    const fill = maxed ? lighten(COLORS.good, 0.5)
      : buyable ? COLORS.card
        : shade(COLORS.card, hardLocked ? 0.72 : 0.9);
    const bg = new Graphics();
    bg.roundRect(-nw / 2, -nh / 2, nw, nh, 12)
      .fill({ color: fill, alpha: 1 })
      .stroke({
        width: buyable ? 3 : 2,
        color: maxed ? COLORS.good : buyable ? curColor : COLORS.cardEdge,
        alpha: 0.95,
      });
    c.addChild(bg);

    const title = wrapped(`${def.glyph} ${def.title}`, Math.min(12.5, nh * 0.145), COLORS.ink, '800', nw - 12);
    title.position.set(0, -nh / 2 + nh * 0.19);
    c.addChild(title);

    const desc = wrapped(def.desc, Math.min(9.5, nh * 0.105), COLORS.inkSoft, '600', nw - 12);
    desc.position.set(0, -nh / 2 + nh * 0.48);
    c.addChild(desc);

    // пипсы уровней (только у многоуровневых узлов)
    if (total > 1) {
      const pips = levelPips(owned, total, curColor, Math.max(2.5, nh * 0.03));
      pips.position.set(0, nh / 2 - nh * 0.32);
      c.addChild(pips);
    }

    const status = maxed
      ? label('✓ макс', Math.min(12, nh * 0.13), COLORS.good, '800')
      : !reqMet
        ? label('🔒', Math.min(14, nh * 0.15), COLORS.inkSoft, '800')
        : levelLocked
          ? label(`🔒 ур. ${next!.minLevel}`, Math.min(11.5, nh * 0.125), COLORS.inkSoft, '800')
          : label(`${curGlyph} ${next!.cost}`, Math.min(13, nh * 0.14), affordable ? curColor : COLORS.inkSoft, '800');
    status.position.set(0, nh / 2 - nh * 0.13);
    c.addChild(status);

    c.eventMode = 'static';
    c.cursor = 'pointer';
    c.on('pointertap', () => {
      if (suppressTap) return;          // это был скролл, а не тап
      if (maxed) { ctx.toast(`${def.title}: прокачано полностью ✅`); return; }
      if (!reqMet) { ctx.toast('Сначала изучи предыдущий узел 🔒'); return; }
      if (levelLocked) { ctx.toast(`Уровень откроется на ур. ${next!.minLevel} 🔒`); return; }
      const r = unlockResearch(ctx.state, def.id);
      if (r.ok) {
        ctx.commit();
        const lvlNow = researchLevel(ctx.state, def.id);
        ctx.toast(total > 1 ? `${def.glyph} ${def.title} · ур. ${lvlNow}/${total} ✅`
          : `${def.glyph} ${def.title} изучено ✅`);
      } else ctx.toast(
        r.reason === 'locked' ? 'Исследования ещё заперты 🔒'
          : r.reason === 'не хватает ДНК' ? 'Не хватает 🧬 ДНК'
            : r.reason === 'не хватает монет' ? 'Не хватает 💰 монет' : r.reason,
      );
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
    // e.global — пиксели окна, а контент живёт в виртуальных координатах сцены
    // (она масштабируется под окно) — переводим позицию пальца в систему viewport,
    // иначе скорость прокрутки расходится с пальцем на величину масштаба
    viewport.on('pointerdown', (e) => { dragging = true; lastY = viewport.toLocal(e.global).y; startY = lastY; suppressTap = false; });
    viewport.on('globalpointermove', (e) => {
      if (!dragging) return;
      const y = viewport.toLocal(e.global).y;
      const dy = y - lastY;
      lastY = y;
      if (ctx.gestureAxis === 'h') suppressTap = true;     // ушли в свайп комнат
      if (ctx.gestureAxis !== 'v') return;                 // не решено или горизонталь — не скроллим
      apply(store[key] + dy);
      if (Math.abs(y - startY) > 6) suppressTap = true;    // двинули — это скролл, не тап
    });
    const stop = (): void => { dragging = false; };
    viewport.on('pointerup', stop);
    viewport.on('pointerupoutside', stop);

    // колесо мыши (ПК)
    viewport.on('wheel', (e: FederatedWheelEvent) => apply(store[key] - e.deltaY));
  }

  /**
   * 🔬 Исследования: дерево постоянных бонусов — 4 ветки (Селекция за 🧬; Обучение,
   * Пристройство, Хозяйство за 💰), в каждой цепочка многоуровневых узлов слева
   * направо. Всё дерево открывается уровнем лаборатории (research), а отдельные
   * УРОВНИ узлов гейтятся своим minLevel. Содержимое прокручивается по вертикали.
   */
  function renderResearch(): void {
    const viewTop = 46;
    const viewW = shell.contentW;
    const viewH = shell.contentH - viewTop;

    // Гейт: пока уровень лаборатории не открыл исследования — вместо дерева замок.
    if (!isUnlocked(ctx.state, 'research')) {
      const need = unlockLevelOf('research');
      const p = panel(viewW, Math.max(120, viewH), COLORS.card, 16);
      p.position.set(0, viewTop);
      shell.body.addChild(p);
      const cy = viewTop + viewH / 2;
      const t = label('🔬 Исследования', 18, COLORS.ink, '800');
      t.position.set(viewW / 2, cy - 28);
      const lock = label(`Откроются на уровне ${need} 🔒`, 15, COLORS.warn, '800');
      lock.position.set(viewW / 2, cy + 2);
      const hint = label('Копи опыт ⭐ за рождения, заказы и пристройство', 12, COLORS.inkSoft, '600');
      hint.position.set(viewW / 2, cy + 28);
      shell.body.addChild(t, lock, hint);
      return;
    }

    // окно прокрутки (маска) + прокручиваемое содержимое — сразу под табами
    const viewport = new Container();
    viewport.position.set(0, viewTop);
    const maskG = new Graphics();
    maskG.rect(0, 0, viewW, viewH).fill(0xffffff);
    const content = new Container();
    viewport.addChild(content, maskG);
    content.mask = maskG;
    shell.body.addChild(viewport);

    const maxCols = 5;
    const colGap = 8;
    const rowGap = 16;
    const labelH = 22;
    const nodeW = (viewW - colGap * (maxCols - 1)) / maxCols;
    const nodeH = Math.max(94, Math.min(120, viewH * 0.24));
    const cxOf = (col: number): number => col * (nodeW + colGap) + nodeW / 2;

    let y = 4;
    for (const br of BRANCHES) {
      const nodes = RESEARCH.filter((r) => r.row === br.row).sort((a, b) => a.col - b.col);
      const head = pillRow([{ text: br.label, size: 13, color: COLORS.ink, weight: '800' }]);
      head.position.set(2, y + labelH / 2);
      content.addChild(head);
      const nodeCy = y + labelH + nodeH / 2;

      // линии связей между соседними колонками (позади карточек)
      const lines = new Graphics();
      for (let i = 1; i < nodes.length; i++) {
        const a = nodes[i - 1]!, b = nodes[i]!;
        const x1 = cxOf(a.col) + nodeW / 2;
        const x2 = cxOf(b.col) - nodeW / 2;
        const owned = researchOwned(ctx.state, b.id);
        lines.moveTo(x1, nodeCy).lineTo(x2, nodeCy)
          .stroke({ width: 3, color: owned ? COLORS.good : COLORS.cardEdge, alpha: 0.8 });
      }
      content.addChild(lines);

      for (const def of nodes) {
        const node = researchNode(def, nodeW, nodeH);
        node.position.set(cxOf(def.col), nodeCy);
        content.addChild(node);
      }
      y = y + labelH + nodeH + rowGap;
    }

    setupScroll(scroll, 'research', viewport, content, viewW, viewH, y);
  }

  function refresh(): void {
    shell.body.removeChildren();
    shell.body.addChild(tabBar());
    if (section === 'codex') renderCodex();
    else renderResearch();
  }

  return {
    id: 'genolab', title: '🔬 Генолаб', container: shell.container, refresh,
    setSection: (id: string) => { section = id as Section; remembered.section = section; refresh(); },
  };
}
