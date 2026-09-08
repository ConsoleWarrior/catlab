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
  startRecipeResearch, speedUpRecipeResearch, adSkipRecipeResearch, revealRecipeResearch,
  recipeResearchCost, recipeResearchMs,
  speedUpCost, RECIPE_AD_SKIP_MS, RECIPE_SPEEDUP_CRYSTAL_PER_MIN,
} from '../../game/index.js';
import type { ResearchDef } from '../../game/index.js';
import { showRewarded } from '../../platform/ads.js';
import type { Room, UiContext } from '../context.js';
import { roomShell } from './shell.js';
import { Button, COLORS, FONT, INK, INK_SOFT, label, panel, tierName, TIER_COLOR, TIERS, V, VIVID } from '../theme.js';
import { breedThumbTexture } from '../catTextures.js';
import { sfxEvent } from '../sound.js';
import { t, tx, type LocStr } from '../../i18n.js';

type Section = 'codex' | 'research' | 'recipes';

// Активная секция и позиции скролла переживают пересборку комнаты (ресайз окна
// пересоздаёт Генолаб целиком): без этого открытые «Улучшения» слетали бы
// обратно на Котодекс, а прокрутка — в начало, при каждом изменении окна.
const remembered = {
  section: 'codex' as Section,
  scroll: { codex: 0, research: 0, recipes: 0 } as Record<Section, number>,
};

/** Метаданные веток дерева исследований (ряд → заголовок + валюта прокачки). */
// Подписи веток — парами: константа собирается при импорте, когда язык ещё не выбран,
// поэтому здесь LocStr, а перевод берётся при отрисовке через tx().
const BRANCHES: { row: number; label: LocStr }[] = [
  { row: 4, label: ['🔬 Лаборатория', '🔬 Lab'] },
  { row: 3, label: ['🏠 Хозяйство · 💰', '🏠 Household · 💰'] },
  { row: 0, label: ['🧪 Селекция · 🧬', '🧪 Selection · 🧬'] },
  { row: 1, label: ['🎓 Обучение · 💰', '🎓 Training · 💰'] },
  { row: 2, label: ['🤝 Пристройство · 💰', '🤝 Rehoming · 💰'] },
];

// Раскладка карточки узла: поля у краёв и зазор между строками. Мелкие числа,
// но общие для всех состояний — держим рядом, чтобы правились разом.
const PAD_Y = 5;    // отступ от края карточки до крайней строки
const GAP_Y = 3;    // просвет между соседними строками
const MIN_FONT = 8; // ниже этого кегля текст уже не ужимаем — лучше пусть жмётся полоса

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

// Наряд вкладок «Улучшения» и «Исследования»: карточки узлов красятся в цвет
// своей ветки, подписи контрастнее, у ценников — «монетка», у стола — рамка и
// блик. Общий рубильник V/VIVID и чернила INK/INK_SOFT живут в theme.ts.

/** Акцент ветки дерева улучшений: row → цвет (ряды см. в BRANCHES). */
const BRANCH_TINT: Record<number, number> = {
  4: 0x58c6ef, // 🔬 Лаборатория — приборный голубой
  3: 0xffa04d, // 🏠 Хозяйство — тёплый оранжевый
  0: 0xb88cff, // 🧪 Селекция — фиолетовый, как 🧬
  1: 0x6bcb8f, // 🎓 Обучение — зелёный
  2: 0xff90b2, // 🤝 Пристройство — розовый
};

/** Высота полосы прогресса стола исследований (рисуется и в render, и в tick). */
const BAR_H = V(14, 12);

/**
 * Подпись на полупрозрачной «таблетке» (фон под текстом) — чтобы читалась поверх
 * ИИ-фона комнаты. Сегменты выкладываются в строку, фон обтекает их по ширине.
 * Контейнер крепится за левый край; его вертикальный центр ставится на нужный y.
 */
function pillRow(
  segs: { text: string; size: number; color: number; weight: '400' | '600' | '700' | '800' }[],
  opts: { bg?: number; edge?: number } = {},
): Container {
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
  bg.roundRect(0, -h / 2, w, h, h / 2).fill({ color: opts.bg ?? COLORS.card, alpha: V(0.97, 0.9) });
  if (VIVID && opts.edge !== undefined) {
    bg.roundRect(0, -h / 2, w, h, h / 2).stroke({ width: 2, color: opts.edge, alpha: 0.85 });
  }
  c.addChild(bg, ...parts);
  return c;
}

export function createGenolab(ctx: UiContext): Room {
  const shell = roomShell(ctx, 'genolab', t('🔬 Генолаб', '🔬 Genolab'));
  let section: Section = remembered.section;
  // вертикальный скролл по секциям (сохраняется между перерисовками и
  // пересборками комнаты — живёт в module-level `remembered`; у каждой свой)
  const scroll = remembered.scroll;
  let suppressTap = false;  // был свайп-скролл — гасим случайную покупку по тапу
  // Узлы-якоря подсветки обучения (см. Room.anchor и ui/tutorial.ts): все три
  // вкладки, обучение обходит их по очереди (см. tabBar).
  const anchors = new Map<string, Container>();

  function tabBar(): Container {
    const c = new Container();
    const defs: { id: Section; text: string }[] = [
      { id: 'codex', text: t('📖 Котодекс', '📖 Catdex') },
      { id: 'research', text: t('🔬 Улучшения', '🔬 Upgrades') },
      { id: 'recipes', text: t('🧪 Исследования', '🧪 Research') },
    ];
    const gap = 8;
    const bw = (shell.contentW - gap * (defs.length - 1)) / defs.length;
    defs.forEach((d, i) => {
      const active = d.id === section;
      const b = new Button({
        text: d.text, w: bw, h: 42,
        color: active ? COLORS.primary : V(0xffffff, COLORS.card),
        textColor: active ? 0xffffff : V(INK, COLORS.ink), fontSize: 15.5,
      });
      b.position.set(bw / 2 + i * (bw + gap), 21);
      anchors.set(d.id, b); // подсветка обучения ведёт по всем трём вкладкам
      b.onTap = () => {
        const moved = d.id !== section;
        // Шаг обучения «загляни в Генолаб» закрывается не входом в комнату
        // (заехать сюда свайпом можно и мимоходом), а осознанным тапом по каждой
        // из трёх вкладок по очереди: 📖 Котодекс → 🔬 Улучшения → 🧪 Исследования.
        // Пока идёт обучение, живая ровно одна — та, чья очередь.
        if (!ctx.tutorAllows(d.id)) return;
        ctx.noteTutorialTab(d.id);
        section = d.id; remembered.section = d.id; refresh();
        // тап по вкладке — неигровое действие (аналог кнопки «Магазин» в примерах
        // площадки): ролик приходит поверх уже переключённой вкладки
        if (moved) ctx.tryInterstitial();
      };
      c.addChild(b);
      // колба с результатом ждёт вскрытия — красная точка на вкладке, чтобы её
      // не пришлось искать (какой это рецепт, метка, разумеется, не выдаёт)
      if (d.id === 'recipes' && ctx.state.recipeResearch?.pending) {
        const dot = new Graphics();
        dot.circle(0, 0, 6).fill(0xe4695f).stroke({ width: 2, color: 0xffffff, alpha: 0.95 });
        dot.position.set(b.x + bw / 2 - 12, 9);
        c.addChild(dot);
      }
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
      else ctx.toast(t('не изучена: выведи породу или исследуй рецепт 🧪', 'not known yet: breed it or research the recipe 🧪'));
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
    const header = pillRow([{ text: t(`Открыто пород: ${haveCount} / ${BREEDS.length}`, `Breeds discovered: ${haveCount} / ${BREEDS.length}`), size: 15, color: COLORS.ink, weight: '800' }]);
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
        { text: tierName(tier), size: 14, color: TIER_COLOR[tier], weight: '800' },
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
   * То же, но с гарантией «влезет в maxH»: пока текст выше отведённой полосы,
   * кегль падает по полшага. Без этого длинная подпись просто росла в обе
   * стороны от центра и наезжала на соседнюю строку карточки — на телефоне,
   * где карточка узкая и любой заголовок ломается на две строки, это было видно
   * в каждом втором узле.
   */
  function fitted(
    text: string, size: number, color: number, weight: '600' | '700' | '800',
    maxW: number, maxH: number,
  ): Text {
    const t = wrapped(text, size, color, weight, maxW);
    let s = size;
    while (t.height > maxH && s > MIN_FONT) {
      s = Math.max(MIN_FONT, s - 0.5);
      t.style.fontSize = s;
      t.style.lineHeight = s + 2;
    }
    return t;
  }

  /** Ряд пипсов уровня узла: ● куплено (цветом валюты) / ○ осталось. */
  function levelPips(owned: number, total: number, curColor: number, dot: number): Container {
    const c = new Container();
    const gap = dot * V(2.7, 2.4);
    const w = (total - 1) * gap;
    for (let i = 0; i < total; i++) {
      const g = new Graphics();
      const cx = i * gap - w / 2;
      const on = i < owned;
      if (VIVID) {
        // белая подложка + тёмная обводка: точки уровней видно и на цветной
        // карточке, и поверх фона комнаты (раньше они сливались с краем панели)
        g.circle(cx, 0, dot + 1.2).fill({ color: 0xffffff, alpha: 0.95 });
        g.circle(cx, 0, dot)
          .fill({ color: on ? curColor : 0xf1e5da, alpha: 1 })
          .stroke({ width: 1.3, color: on ? shade(curColor, 0.65) : 0xbfa896, alpha: 0.95 });
      } else {
        g.circle(cx, 0, dot).fill({ color: on ? curColor : COLORS.cardEdge, alpha: on ? 1 : 0.7 });
      }
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
    const tint = BRANCH_TINT[def.row] ?? COLORS.primary; // карточка носит цвет своей ветки
    const fill = VIVID
      ? (maxed ? lighten(COLORS.good, 0.4)
        : buyable ? lighten(tint, 0.8)
          : shade(lighten(tint, 0.87), hardLocked ? 0.95 : 1))
      : (maxed ? lighten(COLORS.good, 0.5)
        : buyable ? COLORS.card
          : shade(COLORS.card, hardLocked ? 0.72 : 0.9));
    const bg = new Graphics();
    // ореол вокруг доступного узла — «купи меня» видно с одного взгляда
    if (VIVID && buyable) {
      bg.roundRect(-nw / 2 - 3, -nh / 2 - 3, nw + 6, nh + 6, 15)
        .stroke({ width: 4, color: curColor, alpha: 0.3 });
    }
    bg.roundRect(-nw / 2, -nh / 2, nw, nh, 12)
      .fill({ color: fill, alpha: 1 })
      .stroke({
        width: buyable ? V(3.5, 3) : V(2.5, 2),
        color: maxed ? COLORS.good : buyable ? curColor : V(lighten(tint, 0.35), COLORS.cardEdge),
        alpha: 0.95,
      });
    if (VIVID) { // глянцевый блик по верху — карточка как стекло колбы
      bg.roundRect(-nw / 2 + 3, -nh / 2 + 3, nw - 6, nh * 0.4, 10).fill({ color: 0xffffff, alpha: 0.34 });
    }
    c.addChild(bg);

    // Раскладка карточки — снизу вверх по ФАКТИЧЕСКИМ высотам строк, а не по
    // долям nh. Доли ломались на телефоне: подписи цены и «✓ макс» идут через
    // label(), а он на тач-экранах крупнее в UI_SCALE раз, тогда как заголовок и
    // описание переносятся на две-три строки — строки наезжали друг на друга.
    // Теперь цена стоит у нижнего края, над ней пипсы, заголовок — у верхнего, а
    // описанию достаётся ровно то, что осталось между ними (и оно ужимается).
    const status = maxed
      ? label(t('✓ макс', '✓ max'), Math.min(14, nh * 0.14), V(shade(COLORS.good, 0.62), COLORS.good), '800')
      : !reqMet
        ? label('🔒', Math.min(16, nh * 0.16), COLORS.inkSoft, '800')
        : levelLocked
          ? label(t(`🔒 ур. ${next!.minLevel}`, `🔒 lv. ${next!.minLevel}`), Math.min(13.5, nh * 0.135), V(INK_SOFT, COLORS.inkSoft), '800')
          : label(
            extraCoins > 0 ? `${curGlyph}${next!.cost}+💰${extraCoins}` : `${curGlyph} ${next!.cost}`,
            Math.min(extraCoins > 0 ? 12.5 : 15, nh * 0.15),
            affordable ? V(shade(curColor, 0.62), curColor) : V(INK_SOFT, COLORS.inkSoft), '800',
          );
    status.position.set(0, nh / 2 - PAD_Y - status.height / 2);
    // ценник на «монетке» цвета валюты: цифры не теряются на фоне карточки
    if (VIVID && !maxed && reqMet && !levelLocked) {
      const pw = status.width + 16, ph = status.height + 6;
      const coin = new Graphics();
      coin.roundRect(-pw / 2, status.y - ph / 2, pw, ph, ph / 2)
        .fill({ color: lighten(curColor, affordable ? 0.7 : 0.88), alpha: 1 })
        .stroke({ width: 1.5, color: affordable ? curColor : COLORS.cardEdge, alpha: 0.9 });
      c.addChild(coin);
    }
    c.addChild(status);
    let bottom = nh / 2 - PAD_Y - status.height - GAP_Y; // куда нельзя заходить сверху

    // пипсы уровней (только у многоуровневых узлов)
    if (total > 1) {
      const dot = Math.max(V(3.6, 2.5), Math.min(V(5, 3.4), nh * V(0.042, 0.03)));
      const pips = levelPips(owned, total, curColor, dot);
      pips.position.set(0, bottom - dot);
      c.addChild(pips);
      bottom -= dot * 2 + GAP_Y;
    }

    const title = fitted(
      `${def.glyph} ${tx(def.title)}`, Math.min(V(16, 15.5), nh * 0.155),
      V(hardLocked ? INK_SOFT : 0xffffff, COLORS.ink), '800',
      nw - 12, nh * 0.42, // заголовку — не больше двух с небольшим строк
    );
    title.position.set(0, -nh / 2 + PAD_Y + title.height / 2);
    // «ярлык» цвета ветки под названием: узел сразу читается как часть своей
    // цепочки, а белая надпись на нём заметна даже поверх пёстрого фона комнаты.
    // У запертых ярлыка нет (текст серый) — так видно, докуда дерево открыто.
    if (VIVID && !hardLocked) {
      const hw = nw - 8, hh = title.height + 6;
      const tag = new Graphics();
      tag.roundRect(-hw / 2, title.y - hh / 2, hw, hh, 9)
        .fill({ color: shade(maxed ? COLORS.good : tint, maxed ? 0.72 : 0.85), alpha: 0.95 });
      c.addChild(tag);
    }
    c.addChild(title);
    const top = -nh / 2 + PAD_Y + title.height + GAP_Y;

    // если у уровней есть своё описание — показываем текст СЛЕДУЮЩЕГО покупаемого
    // уровня (с накопленным итогом), а на максимуме — последнего; иначе общий desc.
    const descIdx = Math.min(owned, total - 1);
    const descText = tx(def.levels[descIdx]?.desc ?? def.desc);
    const desc = fitted(
      descText, Math.min(V(12, 11.5), nh * 0.115), V(INK_SOFT, COLORS.inkSoft), V('700', '600'),
      nw - 14, Math.max(MIN_FONT * 2, bottom - top),
    );
    desc.position.set(0, (top + bottom) / 2);
    c.addChild(desc);

    c.eventMode = 'static';
    c.cursor = 'pointer';
    c.on('pointertap', () => {
      if (suppressTap) return;          // это был скролл, а не тап
      if (maxed) { ctx.toast(t(`${tx(def.title)}: прокачано полностью ✅`, `${tx(def.title)}: fully upgraded ✅`)); return; }
      if (!reqMet) { ctx.toast(t('Сначала изучи предыдущий узел 🔒', 'Research the previous node first 🔒')); return; }
      if (levelLocked) { ctx.toast(t(`Уровень откроется на ур. ${next!.minLevel} 🔒`, `This level unlocks at lv. ${next!.minLevel} 🔒`)); return; }
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
      const head = label(t('🔬 Улучшения', '🔬 Upgrades'), V(19, 18), V(INK, COLORS.ink), '800');
      head.position.set(viewW / 2, cy - 28);
      const lock = label(t(`Откроются на уровне ${need} 🔒`, `Unlocks at level ${need} 🔒`), V(16, 15), V(shade(COLORS.warn, 0.72), COLORS.warn), '800');
      lock.position.set(viewW / 2, cy + 2);
      const hint = label(t('Копи опыт ⭐ за рождения, заказы и пристройство', 'Earn ⭐ XP from births, orders and rehoming'), V(12.5, 12), V(INK_SOFT, COLORS.inkSoft), V('700', '600'));
      hint.position.set(viewW / 2, cy + 28);
      shell.body.addChild(head, lock, hint);
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
    // Нижний предел высоты держим с запасом: в узкую колонку телефона заголовок
    // почти всегда ложится в две строки, и при 104 px описанию оставалось так
    // мало, что fitted ужимал его до нечитаемого. Ряды всё равно прокручиваются.
    const nodeH = Math.max(116, Math.min(140, viewH * 0.27));
    const cxOf = (col: number): number => col * (nodeW + colGap) + nodeW / 2;

    let y = 4;
    for (const br of BRANCHES) {
      const nodes = RESEARCH.filter((r) => r.row === br.row).sort((a, b) => a.col - b.col);
      const brTint = BRANCH_TINT[br.row] ?? COLORS.primary;
      const head = pillRow(
        [{ text: tx(br.label), size: V(13.5, 13), color: V(shade(brTint, 0.45), COLORS.ink), weight: '800' }],
        { bg: V(lighten(brTint, 0.8), COLORS.card), edge: brTint },
      );
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
          .stroke({
            width: V(4, 3),
            color: owned ? COLORS.good : V(lighten(brTint, 0.35), COLORS.cardEdge),
            alpha: V(0.9, 0.8),
          });
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
  let sealedFlask: Container | null = null; // готовая колба «дышит», пока её не вскрыли
  let sealedT = 0;

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
    sealedFlask = null;

    // Гейт уровнем лаборатории — как у Улучшений.
    if (!isUnlocked(ctx.state, 'recipeLab')) {
      const need = unlockLevelOf('recipeLab');
      const p = panel(viewW, Math.max(120, viewH), COLORS.card, 16);
      p.position.set(0, viewTop);
      shell.body.addChild(p);
      const cy = viewTop + viewH / 2;
      const head = label(t('🧪 Исследования', '🧪 Research'), V(19, 18), V(INK, COLORS.ink), '800');
      head.position.set(viewW / 2, cy - 28);
      const lock = label(t(`Откроются на уровне ${need} 🔒`, `Unlocks at level ${need} 🔒`), V(16, 15), V(shade(COLORS.warn, 0.72), COLORS.warn), '800');
      lock.position.set(viewW / 2, cy + 2);
      const hint = label(t('Стол исследований открывает рецепты новых пород', 'The research bench unlocks recipes for new breeds'), V(12.5, 12), V(INK_SOFT, COLORS.inkSoft), V('700', '600'));
      hint.position.set(viewW / 2, cy + 28);
      shell.body.addChild(head, lock, hint);
      return;
    }

    const rr = ctx.state.recipeResearch;
    const busy = rr.readyAt > 0;
    const sealed = !!rr.pending; // результат готов, но колба ещё запечатана
    const pool = researchableRecipes(ctx.state);

    // --- карточка стола ---
    const deskH = sealed ? 172 : 158; // готовой колбе нужен ряд повыше (колба + подпись + кнопка)
    const desk = panel(viewW, deskH, V(lighten(COLORS.dna, 0.87), COLORS.card), 16);
    if (VIVID) { // рамка цвета 🧬 и блик поверху: стол выглядит прибором, а не листом бумаги
      desk.roundRect(0, 0, viewW, deskH, 16).stroke({ width: 3, color: COLORS.dna, alpha: 0.5 });
      desk.roundRect(4, 4, viewW - 8, deskH * 0.34, 12).fill({ color: 0xffffff, alpha: 0.4 });
    }
    desk.position.set(0, viewTop);
    shell.body.addChild(desk);

    const title = label(t('🧪 Стол исследований', '🧪 Research bench'), V(17, 16), V(shade(COLORS.dna, 0.52), COLORS.ink), '800');
    title.anchor.set(0, 0.5);
    title.position.set(18, viewTop + 24);
    shell.body.addChild(title);
    const sub = label(t('открывает случайный рецепт из достижимых (обе породы пары уже выведены)', 'unlocks a random recipe you can reach (both parent breeds already bred)'), V(12, 11.5), V(INK_SOFT, COLORS.inkSoft), V('700', '600'));
    sub.anchor.set(0, 0.5);
    sub.position.set(18, viewTop + 44);
    shell.body.addChild(sub);

    if (sealed) {
      // Результат готов, но КАКОЙ рецепт — знает только колба: имя откроется
      // в анимации вскрытия (buildRecipeRevealPanel), а не в уведомлении.
      const flask = new Container();
      flask.position.set(54, viewTop + 104); // слева у края карточки: подпись встаёт рядом, а не поверх
      flask.scale.set(1.25);
      const g = new Graphics();
      g.circle(0, 0, 26).fill({ color: COLORS.dna, alpha: 0.18 });               // сияние
      g.roundRect(-7, -30, 14, 11, 4).fill({ color: COLORS.cardEdge }).stroke({ width: 2, color: COLORS.dna, alpha: 0.7 });
      g.roundRect(-19, -22, 38, 44, 12).fill({ color: lighten(COLORS.dna, 0.86) }).stroke({ width: 2.5, color: COLORS.dna, alpha: 0.85 });
      g.roundRect(-16, -2, 32, 21, 10).fill({ color: COLORS.dna, alpha: 0.6 });  // реактив
      g.circle(-6, 2, 3).fill({ color: 0xffffff, alpha: 0.6 });
      g.circle(5, 8, 2).fill({ color: 0xffffff, alpha: 0.5 });
      flask.addChild(g);
      const q = label('?', 17, V(shade(COLORS.dna, 0.5), COLORS.ink), '800');
      q.position.set(0, 6);
      flask.addChild(q);
      shell.body.addChild(flask);
      sealedFlask = flask;

      const ready = label(t('Результат готов!', 'The result is ready!'), V(16, 15), V(shade(COLORS.good, 0.6), COLORS.good), '800');
      ready.anchor.set(0, 0.5);
      ready.position.set(96, viewTop + 90);
      const hint = label(t('колба запечатана — вскрой, чтобы узнать рецепт', 'the flask is sealed — open it to see the recipe'), V(12, 11.5), V(INK_SOFT, COLORS.inkSoft), V('700', '600'));
      hint.anchor.set(0, 0.5);
      hint.position.set(96, viewTop + 112);
      shell.body.addChild(ready, hint);

      const open = new Button({
        text: t('🧪 Вскрыть колбу', '🧪 Open the flask'), w: Math.min(300, viewW - 48), h: 42,
        color: V(shade(COLORS.dna, 0.86), COLORS.dna), fontSize: 15,
      });
      open.position.set(viewW / 2, viewTop + 145);
      open.onTap = () => {
        const recipe = revealRecipeResearch(ctx.state);
        ctx.commit();
        if (recipe) ctx.openRecipeReveal(recipe);
        else ctx.toast(t('Колба оказалась пуста ↩', 'The flask turned out to be empty ↩'));
      };
      shell.body.addChild(open);
    } else if (busy) {
      // идёт исследование: прогресс-бар + время + ускорения 📺/💎 (как в слоте вязки)
      const barW = Math.round(viewW * 0.6);
      const barX = Math.round((viewW - barW) / 2);
      const barY = viewTop + 66;
      const barBg = new Graphics();
      if (VIVID) { // колба с «реактивом»: светлый фиолетовый жёлоб в рамке
        barBg.roundRect(barX, barY, barW, BAR_H, BAR_H / 2)
          .fill({ color: lighten(COLORS.dna, 0.84), alpha: 1 })
          .stroke({ width: 2, color: COLORS.dna, alpha: 0.55 });
      } else {
        barBg.roundRect(barX, barY, barW, BAR_H, BAR_H / 2).fill({ color: 0x000000, alpha: 0.08 });
      }
      recipeBar = new Graphics();
      recipeTime = label('', V(14, 13), V(shade(COLORS.dna, 0.5), COLORS.ink), V('800', '700'));
      recipeTime.position.set(viewW / 2, barY + 24);
      recipeBarGeom = { x: barX, y: barY, w: barW };
      shell.body.addChild(barBg, recipeBar, recipeTime);

      const remain = Math.max(0, rr.readyAt - ctx.now());
      const cost = speedUpCost(remain, RECIPE_SPEEDUP_CRYSTAL_PER_MIN);
      const skipMin = Math.round(RECIPE_AD_SKIP_MS / 60_000);
      const bw = Math.min(210, Math.round(viewW * 0.34));
      const yy = barY + 58;
      // «Реклама» в тексте — требование п. 4.5.1 (кнопка называет и ролик, и награду)
      const adBtn = new Button({ text: t(`📺 Реклама −${skipMin} мин`, `📺 Ad −${skipMin} min`), w: bw, h: 34, color: COLORS.secondary, fontSize: 12.5 });
      adBtn.position.set(viewW / 2 - bw / 2 - 6, yy);
      adBtn.onTap = () => {
        void showRewarded().then((watched) => {
          if (!watched) { ctx.toast(t('Реклама недоступна', 'Ad unavailable')); return; }
          const r = adSkipRecipeResearch(ctx.state, ctx.now());
          if (r.ok) { ctx.commit(); ctx.toast(t(`Реклама: −${skipMin} мин ⏩`, `Ad: −${skipMin} min ⏩`)); } else ctx.toast(r.reason);
        });
      };
      const crBtn = new Button({ text: t(`💎 ${cost} сразу`, `💎 ${cost} now`), w: bw, h: 34, color: COLORS.primary, fontSize: 13 });
      crBtn.position.set(viewW / 2 + bw / 2 + 6, yy);
      crBtn.onTap = () => {
        const r = speedUpRecipeResearch(ctx.state, ctx.now());
        if (r.ok) { ctx.commit(); ctx.toast(t('Исследование завершено! 📜', 'Research complete! 📜')); } else ctx.toast(r.reason);
      };
      shell.body.addChild(adBtn, crBtn);
    } else if (pool.length === 0) {
      // пул пуст: исследовать нечего — кнопку прячем (грейс), подсказываем путь
      const done = label(t('Все достижимые рецепты изучены ✅', 'Every reachable recipe is researched ✅'), V(15, 14), V(shade(COLORS.good, 0.62), COLORS.good), '800');
      done.position.set(viewW / 2, viewTop + 84);
      const hint = label(t('выведи новые породы — пул исследований пополнится', 'breed new cats — the research pool will grow'), V(12.5, 12), V(INK_SOFT, COLORS.inkSoft), V('700', '600'));
      hint.position.set(viewW / 2, viewTop + 108);
      shell.body.addChild(done, hint);
    } else {
      // стол свободен: цена 💰+🧬 и длительность растут с уровнем лабы
      const price = recipeResearchCost(ctx.state.level);
      const durMs = recipeResearchMs(ctx.state.level);
      const durText = durMs >= 60_000
        ? t(`${Math.round(durMs / 60_000)} мин`, `${Math.round(durMs / 60_000)} min`) : t(`${Math.round(durMs / 1000)} с`, `${Math.round(durMs / 1000)} s`);
      const afford = ctx.state.coins >= price.coins && ctx.state.dna >= price.dna;
      const info = label(
        t(`в пуле: ${pool.length} · цена 💰 ${price.coins} + 🧬 ${price.dna} · ⏱ ${durText}`, `in the pool: ${pool.length} · price 💰 ${price.coins} + 🧬 ${price.dna} · ⏱ ${durText}`),
        V(13.5, 12.5), V(INK, COLORS.ink), V('800', '700'),
      );
      info.position.set(viewW / 2, viewTop + 76);
      if (VIVID) { // цена — на светлой плашке, а не «висит» на панели стола
        const pw = info.width + 26, ph = info.height + 9;
        const plate = new Graphics();
        plate.roundRect(info.x - pw / 2, info.y - ph / 2, pw, ph, ph / 2)
          .fill({ color: 0xffffff, alpha: 0.92 })
          .stroke({ width: 1.5, color: COLORS.dna, alpha: 0.5 });
        shell.body.addChild(plate);
      }
      shell.body.addChild(info);

      const start = new Button({
        text: t('Исследовать рецепт 🧪', 'Research a recipe 🧪'), w: Math.min(320, viewW - 48), h: 42,
        color: afford ? V(shade(COLORS.dna, 0.86), COLORS.dna) : COLORS.cardEdge,
        textColor: afford ? 0xffffff : V(INK_SOFT, COLORS.inkSoft), fontSize: 15,
      });
      start.enabled = afford;
      start.position.set(viewW / 2, viewTop + 118);
      start.onTap = () => {
        const r = startRecipeResearch(ctx.state, ctx.now());
        if (r.ok) { sfxEvent('lab'); ctx.commit(); ctx.toast(t('Исследование началось 🧪', 'Research started 🧪')); }
        else ctx.toast(r.reason === 'locked' ? t('Стол ещё заперт 🔒', 'The bench is still locked 🔒') : r.reason);
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
    const head = pillRow(
      [{ text: t(`Открытые рецепты · ${totalOpened}`, `Known recipes · ${totalOpened}`), size: V(13.5, 13), color: V(shade(COLORS.dna, 0.5), COLORS.ink), weight: '800' }],
      { bg: V(lighten(COLORS.dna, 0.8), COLORS.card), edge: COLORS.dna },
    );
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
      const empty = label(t('пока пусто — исследуй первый рецепт', 'empty so far — research your first recipe'), V(12.5, 12), V(INK_SOFT, COLORS.inkSoft), V('700', '600'));
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
      const tc = TIER_COLOR[tierOfBreed(r.result)];
      const cardBg = panel(colW, rowH - 6, V(lighten(tc, 0.86), COLORS.card), 10);
      if (VIVID) cardBg.roundRect(0, 0, colW, rowH - 6, 10).stroke({ width: 2, color: tc, alpha: 0.75 });
      card.addChild(cardBg);
      // имя породы слева (цвет её тира), статус «выведена/силуэт» — справа, на краю блока
      const name = label(`📜 ${breedName(r.result)}`, V(14.5, 14), V(shade(tc, 0.62), tc), '800');
      name.anchor.set(0, 0.5);
      name.position.set(12, (rowH - 6) / 2);
      card.addChild(name);
      const bred = ctx.state.discoveredBreeds.includes(r.result);
      const st = bred ? t('✅ выведена', '✅ bred') : t('силуэт в Котодексе', 'silhouette in the Catdex');
      const stT = label(st, V(11, 10.5), V(bred ? shade(COLORS.good, 0.6) : INK_SOFT, COLORS.inkSoft), V('700', '600'));
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
    anchors.clear(); // узлы уничтожены вместе с телом комнаты
    recipeBar = null;
    recipeTime = null;
    sealedFlask = null;
    shell.body.addChild(tabBar());
    if (section === 'codex') renderCodex();
    else if (section === 'research') renderResearch();
    else renderRecipes();
  }

  /** Живой прогресс стола исследований (бар + счётчик), пока открыта вкладка. */
  function tick(dt: number): void {
    if (sealedFlask && !sealedFlask.destroyed) { // колба «дышит»: её ждут, а не проходят мимо
      sealedT += dt;
      sealedFlask.scale.set(1 + 0.06 * Math.sin(sealedT * 3.4));
      sealedFlask.rotation = Math.sin(sealedT * 1.7) * 0.05;
    }
    if (!recipeBar || !recipeTime) return;
    const rr = ctx.state.recipeResearch;
    if (rr.readyAt === 0) return; // завершение обработает game.update → commit → refresh
    const now = ctx.now();
    const total = Math.max(1, rr.readyAt - rr.startedAt);
    const remain = Math.max(0, rr.readyAt - now);
    const prog = Math.max(0, Math.min(1, 1 - remain / total));
    recipeBar.clear();
    const fillW = Math.max(2, recipeBarGeom.w * prog);
    recipeBar.roundRect(recipeBarGeom.x, recipeBarGeom.y, fillW, BAR_H, BAR_H / 2)
      .fill(remain <= 0 ? COLORS.good : V(shade(COLORS.dna, 0.85), COLORS.dna));
    if (VIVID) { // блик по налитой части — реактив «блестит»
      recipeBar.roundRect(recipeBarGeom.x + 2, recipeBarGeom.y + 2, Math.max(1, fillW - 4), BAR_H * 0.34, BAR_H * 0.17)
        .fill({ color: 0xffffff, alpha: 0.4 });
    }
    recipeTime.text = remain <= 0 ? t('Готово! 📜', 'Done! 📜') : mmss(remain);
  }

  return {
    id: 'genolab', title: t('🔬 Генолаб', '🔬 Genolab'), container: shell.container, refresh, tick,
    setSection: (id: string) => { section = id as Section; remembered.section = section; refresh(); },
    anchor: (key) => {
      const node = anchors.get(key);
      return node && !node.destroyed ? node : null;
    },
  };
}
