/**
 * Комната «Генолаб» — хаб для 🧬 ДНК. Разбита на под-секции (табы):
 *   📖 Котодекс    — альбом всех пород по тирам (силуэт, пока не выведена);
 *   🔬 Исследования — многоуровневые апгрейды за 💰 (вместимость питомника/приюта,
 *                     слоты инкубатора); бонусные ветки за 🧬 — в планах;
 *   🧫 Клон-банк    — клонирование пристроенных котов (скоро).
 *
 * Работают Котодекс и Исследования; Клон-банк — заглушка «скоро».
 * Усилители вязки («Генная инженерия») переехали к названию Инкубатора.
 */

import { Container, Graphics, Rectangle, Sprite, Text } from 'pixi.js';
import type { FederatedWheelEvent } from 'pixi.js';
import { BREEDS, BREEDS_BY_TIER, breedName } from '../../genetics/index.js';
import type { RarityTier } from '../../genetics/index.js';
import { UPGRADES, buyUpgrade, upgradeCost, upgradeMaxed, NURSERY_CAP_STEP, SHELTER_CAP_STEP } from '../../game/index.js';
import type { Room, UiContext } from '../context.js';
import { roomShell } from './shell.js';
import { Button, COLORS, FONT, label, panel, TIER_RU, TIER_COLOR, TIERS } from '../theme.js';
import { breedThumbTexture } from '../catTextures.js';
import { CUR_GLYPH } from '../upgradeButton.js';

type Section = 'codex' | 'research' | 'clone';

// Активная секция и позиции скролла переживают пересборку комнаты (ресайз окна
// пересоздаёт Генолаб целиком): без этого открытые «Исследования» слетали бы
// обратно на Котодекс, а прокрутка — в начало, при каждом изменении окна.
const remembered = {
  section: 'codex' as Section,
  scroll: { codex: 0, research: 0 } as Record<'codex' | 'research', number>,
};

/**
 * Многоуровневые апгрейды вкладки «Исследования»: иконка, отображаемое имя и
 * прибавка за уровень (для подписи в карточке). Имена здесь — локальные, чтобы не
 * трогать `label` в config.ts (его же показывает Инкубатор и кнопки апгрейдов).
 */
const UPGRADE_INFO: Record<string, { glyph: string; name: string; perLevel: string }> = {
  nurseryCap: { glyph: '🏠', name: 'Вместимость питомника', perLevel: `+${NURSERY_CAP_STEP} места за уровень` },
  shelterCap: { glyph: '🏚️', name: 'Вместимость приюта', perLevel: `+${SHELTER_CAP_STEP} места за уровень` },
  slots: { glyph: '💞', name: 'Слоты инкубатора', perLevel: '+1 слот за уровень' },
};

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

  /**
   * Карточка многоуровневого апгрейда (за 💰): вместимость питомника/приюта и слоты
   * инкубатора. Показывает имя, прибавку за уровень, текущий уровень/макс и цену
   * следующего; по тапу покупает следующий уровень. Фон непрозрачный (под ним —
   * ИИ-арт комнаты): доступное — светлая карточка, максимум — мягко-зелёная,
   * «не по карману» — приглушённая (затемнение вместо прозрачности).
   */
  function upgradeNode(id: string, nw: number, nh: number): Container {
    const def = UPGRADES[id]!;
    const info = UPGRADE_INFO[id];
    const maxLvl = id === 'slots' ? UPGRADES.slots!.max : def.max;
    const curLvl = id === 'slots' ? ctx.state.slots.length - 1 : (ctx.state.upgrades[id] ?? 0);
    const maxed = upgradeMaxed(ctx.state, id);
    const cost = upgradeCost(ctx.state, id);
    const affordable = !!cost && ctx.state[cost.currency] >= cost.amount;
    const highlight = !maxed && affordable;

    const c = new Container();
    const fill = maxed ? lighten(COLORS.good, 0.5)
      : affordable ? COLORS.card
        : shade(COLORS.card, 0.9);
    const bg = new Graphics();
    bg.roundRect(-nw / 2, -nh / 2, nw, nh, 12)
      .fill({ color: fill, alpha: 1 })
      .stroke({
        width: highlight ? 3 : 2,
        color: maxed ? COLORS.good : affordable ? COLORS.coins : COLORS.cardEdge,
        alpha: 0.95,
      });
    c.addChild(bg);

    const title = wrapped(`${info?.glyph ?? '⚙️'} ${info?.name ?? def.label}`, Math.min(15, nh * 0.16), COLORS.ink, '800', nw - 14);
    title.position.set(0, -nh / 2 + nh * 0.2);
    c.addChild(title);

    const per = wrapped(info?.perLevel ?? '', Math.min(12, nh * 0.12), COLORS.inkSoft, '700', nw - 12);
    per.position.set(0, -nh / 2 + nh * 0.45);
    c.addChild(per);

    const lvlT = wrapped(`уровень ${curLvl} / ${maxLvl}`, Math.min(11, nh * 0.11), COLORS.inkSoft, '600', nw - 12);
    lvlT.position.set(0, -nh / 2 + nh * 0.64);
    c.addChild(lvlT);

    const status = maxed
      ? label('✓ максимум', Math.min(12, nh * 0.12), COLORS.good, '800')
      : label(`${cost!.amount} ${CUR_GLYPH[cost!.currency]}`, Math.min(14, nh * 0.14), affordable ? COLORS.coins : COLORS.inkSoft, '800');
    status.position.set(0, -nh / 2 + nh * 0.85);
    c.addChild(status);

    c.eventMode = 'static';
    c.cursor = 'pointer';
    c.on('pointertap', () => {
      if (suppressTap) return;          // это был скролл, а не тап
      const name = info?.name ?? def.label;
      if (maxed) { ctx.toast(`${name}: максимум`); return; }
      const r = buyUpgrade(ctx.state, id);
      if (r.ok) { ctx.commit(); ctx.toast(`${name} улучшено ✅`); }
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
   * 🔬 Исследования: многоуровневые апгрейды за 💰 — вместимость питомника, приюта
   * и слоты инкубатора (по одной карточке в ряд). Бонусные ветки за 🧬 убраны —
   * вернутся, когда появятся настоящие апгрейды. Содержимое прокручивается, если
   * карточки не влезают по высоте.
   */
  function renderResearch(): void {
    // окно прокрутки (маска) + прокручиваемое содержимое — сразу под табами
    // (🧬 ДНК и 💰 деньги уже показаны в верхней строке состояния)
    const viewTop = 46;
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

    const ids = ['nurseryCap', 'shelterCap', 'slots'];
    const cols = ids.length;
    const colGap = 12;
    const nw = (viewW - colGap * (cols - 1)) / cols;
    // высота карточки: вмещает 4 строки (имя, прибавка, уровень, цена), но не выше
    // разумного — иначе на десктопе карточки растягиваются на весь экран.
    const nh = Math.max(150, Math.min(200, viewH * 0.62));
    const cx = (col: number): number => col * (nw + colGap) + nw / 2;

    ids.forEach((id, i) => {
      const node = upgradeNode(id, nw, nh);
      node.position.set(cx(i), nh / 2);
      content.addChild(node);
    });

    setupScroll(scroll, 'research', viewport, content, viewW, viewH, nh);
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
    setSection: (id: string) => { section = id as Section; remembered.section = section; refresh(); },
  };
}
