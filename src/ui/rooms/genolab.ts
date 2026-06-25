/**
 * Комната «Генолаб» — хаб для 🧬 ДНК. Разбита на под-секции (табы):
 *   📖 Котодекс    — альбом всех пород по тирам (силуэт, пока не выведена);
 *   🧪 Инженерия   — усилители следующей вязки за 🧬;
 *   🔬 Исследования — дерево постоянных бонусов лаборатории за 🧬;
 *   🧫 Клон-банк    — клонирование пристроенных котов (скоро).
 *
 * Работают Котодекс, Инженерия и Исследования; Клон-банк — заглушка «скоро».
 */

import { Container, Graphics, Sprite, Text } from 'pixi.js';
import { BREEDS, BREEDS_BY_TIER, breedName } from '../../genetics/index.js';
import type { RarityTier } from '../../genetics/index.js';
import { BOOSTS, buyBoost, boostCharges, RESEARCH, unlockResearch } from '../../game/index.js';
import type { ResearchDef } from '../../game/index.js';
import type { Room, UiContext } from '../context.js';
import { roomShell } from './shell.js';
import { Button, COLORS, FONT, label, panel, TIER_RU, TIER_COLOR, TIERS } from '../theme.js';
import { breedThumbTexture } from '../catTextures.js';

type Section = 'codex' | 'engineering' | 'research' | 'clone';

export function createGenolab(ctx: UiContext): Room {
  const shell = roomShell(ctx, 'genolab', '🔬 Генолаб');
  let section: Section = 'codex';

  function tabBar(): Container {
    const c = new Container();
    const defs: { id: Section; text: string }[] = [
      { id: 'codex', text: '📖 Котодекс' },
      { id: 'engineering', text: '🧪 Инженерия' },
      { id: 'research', text: '🔬 Иссл.' },
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
    c.on('pointertap', () => ctx.toast(open ? `${breedName(key)} · ${TIER_RU[tier]}` : 'ещё не выведена'));
    return c;
  }

  function renderCodex(): void {
    const top = 46;
    const haveCount = BREEDS.filter((b) => discovered(b.key)).length;
    const header = label(`Открыто пород: ${haveCount} / ${BREEDS.length}`, 15, COLORS.ink, '800');
    header.anchor.set(0, 0.5);
    header.position.set(2, top + 10);
    shell.body.addChild(header);

    const gridTop = top + 28;
    const gridH = shell.contentH - gridTop;
    const rowH = gridH / TIERS.length;
    const gutter = Math.min(96, shell.contentW * 0.22);
    const gap = 6;
    const maxInTier = Math.max(...TIERS.map((t) => BREEDS_BY_TIER[t].length));
    const stripW = shell.contentW - gutter;
    const cell = Math.min(rowH - 10, (stripW - gap * (maxInTier - 1)) / maxInTier);

    TIERS.forEach((tier, ti) => {
      const y = gridTop + ti * rowH;
      const list = BREEDS_BY_TIER[tier];
      const got = list.filter((b) => discovered(b.key)).length;

      const tl = label(TIER_RU[tier], 12, TIER_COLOR[tier], '800');
      tl.anchor.set(0, 0.5);
      tl.position.set(2, y + rowH / 2 - 8);
      const cnt = label(`${got}/${list.length}`, 11, COLORS.inkSoft, '700');
      cnt.anchor.set(0, 0.5);
      cnt.position.set(2, y + rowH / 2 + 8);
      shell.body.addChild(tl, cnt);

      list.forEach((b, i) => {
        const cx = gutter + i * (cell + gap) + cell / 2;
        shell.body.addChild(codexCell(b.key, tier, cx, y + rowH / 2, cell));
      });
    });
  }

  /** 🧪 Генная инженерия: зарядка усилителей следующей вязки за 🧬. */
  function renderEngineering(): void {
    const top = 52;
    const bal = label(`🧬 ${ctx.state.dna}  ·  усилят следующего котёнка из инкубатора`, 13, COLORS.ink, '700');
    bal.anchor.set(0, 0.5);
    bal.position.set(2, top);
    shell.body.addChild(bal);

    const cardH = 84;
    const gap = 10;
    let y = top + 24;
    for (const def of BOOSTS) {
      const charges = boostCharges(ctx.state, def.id);
      const p = panel(shell.contentW, cardH, COLORS.card, 14);
      p.position.set(0, y);
      shell.body.addChild(p);

      const title = label(`${def.glyph} ${def.label}`, 16, COLORS.ink, '800');
      title.anchor.set(0, 0.5);
      title.position.set(16, y + 22);
      shell.body.addChild(title);

      const desc = label(def.desc, 12.5, COLORS.inkSoft, '600');
      desc.anchor.set(0, 0.5);
      desc.position.set(16, y + 44);
      shell.body.addChild(desc);

      const ch = label(
        charges > 0 ? `⚡ заряжено: ${charges}` : 'не заряжено',
        12, charges > 0 ? COLORS.good : COLORS.inkSoft, '700',
      );
      ch.anchor.set(0, 0.5);
      ch.position.set(16, y + 65);
      shell.body.addChild(ch);

      const btn = new Button({
        text: `Зарядить\n${def.dna} 🧬`, w: 104, h: 58, color: COLORS.dna, fontSize: 13,
      });
      btn.position.set(shell.contentW - 60, y + cardH / 2);
      btn.enabled = ctx.state.dna >= def.dna;
      btn.onTap = () => {
        const r = buyBoost(ctx.state, def.id);
        if (r.ok) { ctx.commit(); ctx.toast(`${def.glyph} ${def.label} заряжен`); }
        else ctx.toast(r.reason);
      };
      shell.body.addChild(btn);
      y += cardH + gap;
    }

    const hint = label('Сработавший усилитель тратит 1 заряд при рождении.', 11, COLORS.inkSoft, '600');
    hint.anchor.set(0, 0.5);
    hint.position.set(2, y + 2);
    shell.body.addChild(hint);
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
      if (owned) { ctx.toast(`${def.title}: ${def.desc}`); return; }
      const r = unlockResearch(ctx.state, def.id);
      if (r.ok) { ctx.commit(); ctx.toast(`Изучено: ${def.title} ✅`); }
      else ctx.toast(r.reason);
    });
    return c;
  }

  /** 🔬 Дерево исследований: 3 ветки × 3 уровня, связи между узлами. */
  function renderResearch(): void {
    const top = 50;
    const header = label(`🔬 Постоянные бонусы лаборатории  ·  🧬 ${ctx.state.dna}`, 13, COLORS.ink, '700');
    header.anchor.set(0, 0.5);
    header.position.set(2, top);
    shell.body.addChild(header);

    const cols = Math.max(...RESEARCH.map((r) => r.col)) + 1;
    const rows = Math.max(...RESEARCH.map((r) => r.row)) + 1;
    const colGap = 12;
    const rowGap = 12;
    const gridTop = top + 20;
    const availH = shell.contentH - (gridTop - 0);
    const nw = (shell.contentW - colGap * (cols - 1)) / cols;
    const nh = Math.min(132, (availH - rowGap * (rows - 1)) / rows);
    const cx = (col: number): number => col * (nw + colGap) + nw / 2;
    const cy = (row: number): number => gridTop + row * (nh + rowGap) + nh / 2;

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
    shell.body.addChild(links);

    for (const def of RESEARCH) {
      const node = researchNode(def, nw, nh);
      node.position.set(cx(def.col), cy(def.row));
      shell.body.addChild(node);
    }
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
    } else if (section === 'engineering') {
      renderEngineering();
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
