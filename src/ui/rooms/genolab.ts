/**
 * Комната «Генолаб» — хаб для 🧬 ДНК. Разбита на под-секции (табы):
 *   📖 Котодекс     — рецептурник: альбом пород по тирам (цветная — выведена,
 *                     чёрный силуэт — рецепт открыт исследованием, «?» — туман);
 *                     тап по изученной породе открывает карточку с рецептами;
 *   🔬 Улучшения    — дерево постоянных бонусов (4 ветки: Селекция, Обучение,
 *                     Пристройство, Хозяйство); открывается уровнем лаборатории;
 *                     (бывш. «Исследования» — внутренний id research не меняем);
 *   🧪 Исследования — стол исследования рецептов: за 💰+🧬 таймер открывает
 *                     случайный рецепт из достижимого пула (система знаний).
 *
 * Крио-банк вынесен в ОТДЕЛЬНУЮ комнату (5-я в разрезе, см. rooms/cryobank.ts) —
 * появляется после покупки узла Селекции «❄️ Криогенетика».
 * Усилители вязки («Генная инженерия») переехали к названию Инкубатора.
 */

import { Container, Graphics, Rectangle, Sprite, Text } from 'pixi.js';
import type { FederatedWheelEvent } from 'pixi.js';
import { BREEDS, BREEDS_BY_TIER, breedName, tierOfBreed, RECIPES, recipeKey } from '../../genetics/index.js';
import type { RarityTier, Recipe } from '../../genetics/index.js';
import {
  RESEARCH, isUnlocked, unlockLevelOf,
  researchLevel, researchOwned, researchMaxed, researchNext, researchExtraCoins, canAffordResearch,
  breedDiscovered, breedStudied, researchableRecipes,
  startRecipeResearch, speedUpRecipeResearch, adSkipRecipeResearch,
  recipeResearchCost, recipeResearchMs,
  speedUpCost, RECIPE_AD_SKIP_MS, RECIPE_SPEEDUP_CRYSTAL_PER_MIN,
} from '../../game/index.js';
import type { ResearchDef } from '../../game/index.js';
import { showRewarded } from '../../platform/ads.js';
import type { Room, UiContext } from '../context.js';
import { roomShell } from './shell.js';
import { Button, COLORS, FONT, label, panel, TIER_RU, TIER_COLOR, TIERS } from '../theme.js';
import { breedThumbTexture } from '../catTextures.js';

type Section = 'codex' | 'research' | 'recipes';

// Активная секция и позиции скролла переживают пересборку комнаты (ресайз окна
// пересоздаёт Генолаб целиком): без этого открытые «Улучшения» слетали бы
// обратно на Котодекс, а прокрутка — в начало, при каждом изменении окна.
const remembered = {
  section: 'codex' as Section,
  scroll: { codex: 0, research: 0, recipes: 0 } as Record<Section, number>,
};

/** Метаданные веток дерева исследований (ряд → заголовок + валюта прокачки). */
const BRANCHES: { row: number; label: string }[] = [
  { row: 4, label: '🔬 Лаборатория' },
  { row: 3, label: '🏠 Хозяйство · 💰' },
  { row: 0, label: '🧪 Селекция · 🧬' },
  { row: 1, label: '🎓 Обучение · 💰' },
  { row: 2, label: '🤝 Пристройство · 💰' },
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
      { id: 'research', text: '🔬 Улучшения' },
      { id: 'recipes', text: '🧪 Исследования' },
    ];
    const gap = 8;
    const bw = (shell.contentW - gap * (defs.length - 1)) / defs.length;
    defs.forEach((d, i) => {
      const active = d.id === section;
      const b = new Button({
        text: d.text, w: bw, h: 42,
        color: active ? COLORS.primary : COLORS.card,
        textColor: active ? 0xffffff : COLORS.ink, fontSize: 15.5,
      });
      b.position.set(bw / 2 + i * (bw + gap), 21);
      b.onTap = () => { section = d.id; remembered.section = d.id; refresh(); };
      c.addChild(b);
    });
    return c;
  }

  /**
   * Клетка Котодекса-рецептурника, три состояния (система знаний):
   *   выведена → цветной портрет; известен только рецепт → ЧЁРНЫЙ СИЛУЭТ по
   *   форме породы; не изучена → «?»-замок. Тап по изученной — карточка породы
   *   с рецептами (условия + шансы), по неизученной — подсказка-тост.
   */
  function codexCell(key: string, tier: RarityTier, cx: number, cy: number, size: number): Container {
    const c = new Container();
    c.position.set(cx, cy);
    const open = breedDiscovered(ctx.state, key);
    const studied = open || breedStudied(ctx.state, key); // силуэт: рецепт известен, порода не выведена

    const bg = new Graphics();
    // фон всегда непрозрачный (под ним — ИИ-арт комнаты): открытая клетка светлая,
    // неоткрытая — затемнённая (силуэт-замок), без просвечивания фона.
    bg.roundRect(-size / 2, -size / 2, size, size, 8)
      .fill({ color: open ? COLORS.card : shade(COLORS.card, 0.72), alpha: 1 })
      .stroke({ width: 2, color: TIER_COLOR[tier], alpha: open ? 0.9 : 0.5 });
    c.addChild(bg);

    const tex = studied ? breedThumbTexture(key) : null;
    if (tex) {
      const sp = new Sprite(tex);
      sp.anchor.set(0.5, 1);
      sp.scale.set(Math.min((size * 0.92) / tex.height, (size * 1.05) / tex.width));
      sp.position.set(0, size / 2 - 3);
      if (!open) sp.tint = 0x241d29; // чёрный силуэт: форма породы без окраса
      c.addChild(sp);
    } else if (studied) {
      const paw = label('🐾', size * 0.4, open ? COLORS.ink : shade(COLORS.ink, 0.4), '700');
      c.addChild(paw);
    } else {
      const q = label('?', size * 0.42, TIER_COLOR[tier], '800');
      q.alpha = 0.7;
      c.addChild(q);
    }

    c.eventMode = 'static';
    c.cursor = 'pointer';
    c.on('pointertap', () => {
      if (suppressTap) return;          // это был скролл/свайп, а не тап
      if (studied) ctx.openBreedCard(key);
      else ctx.toast('не изучена: выведи породу или исследуй рецепт 🧪');
    });
    return c;
  }

  /**
   * 📖 Котодекс: альбом пород по тирам. Клетки крупные и читаемые (особенно на
   * мобиле); каждый тир — подзаголовок + сетка с переносом по строкам, всё лишнее
   * уходит под вертикальную прокрутку (как в Улучшениях).
   */
  function renderCodex(): void {
    const top = 46;
    const haveCount = BREEDS.filter((b) => breedDiscovered(ctx.state, b.key)).length;
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
      const got = list.filter((b) => breedDiscovered(ctx.state, b.key)).length;

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
   * Карточка узла дерева улучшений (многоуровневого). Валюта своя у ветки: 🧬 у
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
    const extraCoins = researchExtraCoins(def, next); // доп. 💰 у Селекции (сверх 🧬)
    const affordable = canAffordResearch(ctx.state, def, next);
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

    const title = wrapped(`${def.glyph} ${def.title}`, Math.min(15.5, nh * 0.155), COLORS.ink, '800', nw - 12);
    title.position.set(0, -nh / 2 + nh * 0.19);
    c.addChild(title);

    // если у уровней есть своё описание — показываем текст СЛЕДУЮЩЕГО покупаемого
    // уровня (с накопленным итогом), а на максимуме — последнего; иначе общий desc.
    const descIdx = Math.min(owned, total - 1);
    const descText = def.levels[descIdx]?.desc ?? def.desc;
    const desc = wrapped(descText, Math.min(11.5, nh * 0.115), COLORS.inkSoft, '600', nw - 14);
    desc.position.set(0, -nh / 2 + nh * 0.47);
    c.addChild(desc);

    // пипсы уровней (только у многоуровневых узлов)
    if (total > 1) {
      const pips = levelPips(owned, total, curColor, Math.max(2.5, nh * 0.03));
      pips.position.set(0, nh / 2 - nh * 0.32);
      c.addChild(pips);
    }

    const status = maxed
      ? label('✓ макс', Math.min(14, nh * 0.14), COLORS.good, '800')
      : !reqMet
        ? label('🔒', Math.min(16, nh * 0.16), COLORS.inkSoft, '800')
        : levelLocked
          ? label(`🔒 ур. ${next!.minLevel}`, Math.min(13.5, nh * 0.135), COLORS.inkSoft, '800')
          : label(
            extraCoins > 0 ? `${curGlyph}${next!.cost}+💰${extraCoins}` : `${curGlyph} ${next!.cost}`,
            Math.min(extraCoins > 0 ? 12.5 : 15, nh * 0.15), affordable ? curColor : COLORS.inkSoft, '800',
          );
    status.position.set(0, nh / 2 - nh * 0.13);
    c.addChild(status);

    c.eventMode = 'static';
    c.cursor = 'pointer';
    c.on('pointertap', () => {
      if (suppressTap) return;          // это был скролл, а не тап
      if (maxed) { ctx.toast(`${def.title}: прокачано полностью ✅`); return; }
      if (!reqMet) { ctx.toast('Сначала изучи предыдущий узел 🔒'); return; }
      if (levelLocked) { ctx.toast(`Уровень откроется на ур. ${next!.minLevel} 🔒`); return; }
      // сама покупка — в подтверждающем окне (чтобы не купить случайным тапом)
      ctx.openResearchConfirm(def.id);
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
    store: Record<Section, number>, key: Section,
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
   * 🔬 Улучшения: дерево постоянных бонусов — 4 ветки (Селекция за 🧬; Обучение,
   * Пристройство, Хозяйство за 💰), в каждой цепочка многоуровневых узлов слева
   * направо. Всё дерево открывается уровнем лаборатории (research), а отдельные
   * УРОВНИ узлов гейтятся своим minLevel. Содержимое прокручивается по вертикали.
   */
  function renderResearch(): void {
    const viewTop = 46;
    const viewW = shell.contentW;
    const viewH = shell.contentH - viewTop;

    // Гейт: пока уровень лаборатории не открыл улучшения — вместо дерева замок.
    if (!isUnlocked(ctx.state, 'research')) {
      const need = unlockLevelOf('research');
      const p = panel(viewW, Math.max(120, viewH), COLORS.card, 16);
      p.position.set(0, viewTop);
      shell.body.addChild(p);
      const cy = viewTop + viewH / 2;
      const t = label('🔬 Улучшения', 18, COLORS.ink, '800');
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
    const nodeH = Math.max(104, Math.min(140, viewH * 0.27));
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

  // живые ссылки прогресса стола исследований (обновляются в tick, как в инкубаторе)
  let recipeBar: Graphics | null = null;
  let recipeTime: Text | null = null;
  let recipeBarGeom = { x: 0, y: 0, w: 0 };

  function mmss(ms: number): string {
    const s = Math.max(0, Math.ceil(ms / 1000));
    return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
  }

  /**
   * 🧪 Исследования: стол исследования рецептов (система знаний, этап D).
   * Один слот-таймер за 💰+🧬 выдаёт случайный ещё не открытый рецепт из
   * ДОСТИЖИМОГО пула (обе родительские породы выведены). Ускорение — 📺/💎.
   * Завершение ловит game.update (finishRecipeResearch) — тост + силуэт в Котодексе.
   * Ниже — список рецептов, уже открытых исследованием (тап → карточка породы).
   */
  function renderRecipes(): void {
    const viewTop = 46;
    const viewW = shell.contentW;
    const viewH = shell.contentH - viewTop;
    recipeBar = null;
    recipeTime = null;

    // Гейт уровнем лаборатории — как у Улучшений.
    if (!isUnlocked(ctx.state, 'recipeLab')) {
      const need = unlockLevelOf('recipeLab');
      const p = panel(viewW, Math.max(120, viewH), COLORS.card, 16);
      p.position.set(0, viewTop);
      shell.body.addChild(p);
      const cy = viewTop + viewH / 2;
      const t = label('🧪 Исследования', 18, COLORS.ink, '800');
      t.position.set(viewW / 2, cy - 28);
      const lock = label(`Откроются на уровне ${need} 🔒`, 15, COLORS.warn, '800');
      lock.position.set(viewW / 2, cy + 2);
      const hint = label('Стол исследований открывает рецепты новых пород', 12, COLORS.inkSoft, '600');
      hint.position.set(viewW / 2, cy + 28);
      shell.body.addChild(t, lock, hint);
      return;
    }

    const rr = ctx.state.recipeResearch;
    const busy = rr.readyAt > 0;
    const pool = researchableRecipes(ctx.state);

    // --- карточка стола ---
    const deskH = 158;
    const desk = panel(viewW, deskH, COLORS.card, 16);
    desk.position.set(0, viewTop);
    shell.body.addChild(desk);

    const title = label('🧪 Стол исследований', 16, COLORS.ink, '800');
    title.anchor.set(0, 0.5);
    title.position.set(18, viewTop + 24);
    shell.body.addChild(title);
    const sub = label('открывает случайный рецепт из достижимых (обе породы пары уже выведены)', 11.5, COLORS.inkSoft, '600');
    sub.anchor.set(0, 0.5);
    sub.position.set(18, viewTop + 44);
    shell.body.addChild(sub);

    if (busy) {
      // идёт исследование: прогресс-бар + время + ускорения 📺/💎 (как в слоте вязки)
      const barW = Math.round(viewW * 0.6);
      const barX = Math.round((viewW - barW) / 2);
      const barY = viewTop + 66;
      const barBg = new Graphics();
      barBg.roundRect(barX, barY, barW, 12, 6).fill({ color: 0x000000, alpha: 0.08 });
      recipeBar = new Graphics();
      recipeTime = label('', 13, COLORS.ink, '700');
      recipeTime.position.set(viewW / 2, barY + 24);
      recipeBarGeom = { x: barX, y: barY, w: barW };
      shell.body.addChild(barBg, recipeBar, recipeTime);

      const remain = Math.max(0, rr.readyAt - ctx.now());
      const cost = speedUpCost(remain, RECIPE_SPEEDUP_CRYSTAL_PER_MIN);
      const skipMin = Math.round(RECIPE_AD_SKIP_MS / 60_000);
      const bw = Math.min(200, Math.round(viewW * 0.3));
      const yy = barY + 58;
      const adBtn = new Button({ text: `📺 −${skipMin} мин`, w: bw, h: 34, color: COLORS.secondary, fontSize: 13 });
      adBtn.position.set(viewW / 2 - bw / 2 - 6, yy);
      adBtn.onTap = () => {
        void showRewarded().then((watched) => {
          if (!watched) { ctx.toast('Реклама недоступна'); return; }
          const r = adSkipRecipeResearch(ctx.state, ctx.now());
          if (r.ok) { ctx.commit(); ctx.toast(`Реклама: −${skipMin} мин ⏩`); } else ctx.toast(r.reason);
        });
      };
      const crBtn = new Button({ text: `💎 ${cost} сразу`, w: bw, h: 34, color: COLORS.primary, fontSize: 13 });
      crBtn.position.set(viewW / 2 + bw / 2 + 6, yy);
      crBtn.onTap = () => {
        const r = speedUpRecipeResearch(ctx.state, ctx.now());
        if (r.ok) { ctx.commit(); ctx.toast('Исследование завершено! 📜'); } else ctx.toast(r.reason);
      };
      shell.body.addChild(adBtn, crBtn);
    } else if (pool.length === 0) {
      // пул пуст: исследовать нечего — кнопку прячем (грейс), подсказываем путь
      const done = label('Все достижимые рецепты изучены ✅', 14, COLORS.good, '800');
      done.position.set(viewW / 2, viewTop + 84);
      const hint = label('выведи новые породы — пул исследований пополнится', 12, COLORS.inkSoft, '600');
      hint.position.set(viewW / 2, viewTop + 108);
      shell.body.addChild(done, hint);
    } else {
      // стол свободен: цена 💰+🧬 и длительность растут с уровнем лабы
      const price = recipeResearchCost(ctx.state.level);
      const durMs = recipeResearchMs(ctx.state.level);
      const durText = durMs >= 60_000
        ? `${Math.round(durMs / 60_000)} мин` : `${Math.round(durMs / 1000)} с`;
      const afford = ctx.state.coins >= price.coins && ctx.state.dna >= price.dna;
      const info = label(
        `в пуле: ${pool.length} · цена 💰 ${price.coins} + 🧬 ${price.dna} · ⏱ ${durText}`,
        12.5, COLORS.ink, '700',
      );
      info.position.set(viewW / 2, viewTop + 76);
      shell.body.addChild(info);

      const start = new Button({
        text: 'Исследовать рецепт 🧪', w: Math.min(320, viewW - 48), h: 42,
        color: afford ? COLORS.dna : COLORS.cardEdge,
        textColor: afford ? 0xffffff : COLORS.inkSoft, fontSize: 15,
      });
      start.enabled = afford;
      start.position.set(viewW / 2, viewTop + 118);
      start.onTap = () => {
        const r = startRecipeResearch(ctx.state, ctx.now());
        if (r.ok) { ctx.commit(); ctx.toast('Исследование началось 🧪'); }
        else ctx.toast(r.reason === 'locked' ? 'Стол ещё заперт 🔒' : r.reason);
      };
      shell.body.addChild(start);
    }

    // --- список рецептов, открытых исследованием (📜 силуэты в Котодексе) ---
    // новые сверху; колонки СТАБИЛЬНЫ — рецепт закрепляется за левой или правой
    // колонкой по чётности своего порядкового номера в state.knownRecipes (индекс
    // не меняется, т.к. push только добавляет в конец) и больше не «перескакивает»
    // между колонками. Новый рецепт толкает вниз только ОДНУ колонку по очереди
    // (левую, потом правую) — иначе при каждом открытии дёргалась бы вся лента.
    const listTop = viewTop + deskH + 10;
    const recipeByKey = new Map(RECIPES.map((r) => [recipeKey(r), r]));
    const leftCol: Recipe[] = [];
    const rightCol: Recipe[] = [];
    let totalOpened = 0;
    ctx.state.knownRecipes.forEach((k, idx) => {
      const r = recipeByKey.get(k);
      if (!r) return;
      totalOpened++;
      (idx % 2 === 0 ? leftCol : rightCol).push(r);
    });
    leftCol.reverse();
    rightCol.reverse();
    const head = pillRow([{ text: `Открытые рецепты · ${totalOpened}`, size: 13, color: COLORS.ink, weight: '800' }]);
    head.position.set((viewW - head.width) / 2, listTop + 10);
    shell.body.addChild(head);

    const viewport = new Container();
    viewport.position.set(0, listTop + 24);
    const listH = shell.contentH - (listTop + 24);
    const maskG = new Graphics();
    maskG.rect(0, 0, viewW, listH).fill(0xffffff);
    const content = new Container();
    viewport.addChild(content, maskG);
    content.mask = maskG;
    shell.body.addChild(viewport);

    let y = 4;
    if (totalOpened === 0) {
      const empty = label('пока пусто — исследуй первый рецепт', 12, COLORS.inkSoft, '600');
      empty.anchor.set(0, 0.5);
      empty.position.set(6, y + 14);
      content.addChild(empty);
      y += 34;
    }
    // сетка 2×N: блоки чуть крупнее прежней однорядной ленты
    const gap = 8;
    const colW = (viewW - gap) / 2;
    const rowH = 48;
    const placeCard = (r: Recipe, x: number, cardY: number): void => {
      const card = new Container();
      card.addChild(panel(colW, rowH - 6, COLORS.card, 10));
      // имя породы слева (цвет её тира), статус «выведена/силуэт» — справа, на краю блока
      const name = label(`📜 ${breedName(r.result)}`, 14, TIER_COLOR[tierOfBreed(r.result)], '800');
      name.anchor.set(0, 0.5);
      name.position.set(12, (rowH - 6) / 2);
      card.addChild(name);
      const st = ctx.state.discoveredBreeds.includes(r.result) ? '✅ выведена' : 'силуэт в Котодексе';
      const stT = label(st, 10.5, COLORS.inkSoft, '600');
      stT.anchor.set(1, 0.5);
      stT.position.set(colW - 12, (rowH - 6) / 2);
      card.addChild(stT);
      card.eventMode = 'static';
      card.cursor = 'pointer';
      card.on('pointertap', () => { if (!suppressTap) ctx.openBreedCard(r.result); });
      card.position.set(x, cardY);
      content.addChild(card);
    };
    const rows = Math.max(leftCol.length, rightCol.length);
    for (let row = 0; row < rows; row++) {
      const ly = y + row * rowH;
      const l = leftCol[row];
      const rgt = rightCol[row];
      if (l) placeCard(l, 0, ly);
      if (rgt) placeCard(rgt, colW + gap, ly);
    }
    y += rows * rowH;
    setupScroll(scroll, 'recipes', viewport, content, viewW, listH, y);
  }

  function refresh(): void {
    shell.body.removeChildren();
    recipeBar = null;
    recipeTime = null;
    shell.body.addChild(tabBar());
    if (section === 'codex') renderCodex();
    else if (section === 'research') renderResearch();
    else renderRecipes();
  }

  /** Живой прогресс стола исследований (бар + счётчик), пока открыта вкладка. */
  function tick(_dt: number): void {
    if (!recipeBar || !recipeTime) return;
    const rr = ctx.state.recipeResearch;
    if (rr.readyAt === 0) return; // завершение обработает game.update → commit → refresh
    const now = ctx.now();
    const total = Math.max(1, rr.readyAt - rr.startedAt);
    const remain = Math.max(0, rr.readyAt - now);
    const prog = Math.max(0, Math.min(1, 1 - remain / total));
    recipeBar.clear();
    recipeBar.roundRect(recipeBarGeom.x, recipeBarGeom.y, Math.max(2, recipeBarGeom.w * prog), 12, 6)
      .fill(remain <= 0 ? COLORS.good : COLORS.dna);
    recipeTime.text = remain <= 0 ? 'Готово! 📜' : mmss(remain);
  }

  return {
    id: 'genolab', title: '🔬 Генолаб', container: shell.container, refresh, tick,
    setSection: (id: string) => { section = id as Section; remembered.section = section; refresh(); },
  };
}
