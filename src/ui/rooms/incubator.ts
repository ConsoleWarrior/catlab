/**
 * Комната «Инкубатор»: места вязки (выбор пары → таймер → котёнок),
 * апгрейды слотов и скорости. Пара выбирается в Питомнике (ctx.selection).
 *
 * Визуал места вязки — мини-комната с перегородкой по центру. В покое перегородка
 * опущена, коты стоят по разные стороны. По кнопке «Свести» перегородка
 * поднимается, коты сходятся к центру и трутся боками, вверх всплывают сердечки.
 */

import { Container, Graphics } from 'pixi.js';
import type { Sprite, Text } from 'pixi.js';
import type { Cat } from '../../game/index.js';
import {
  startBreeding, assignBreeder, collectReady, incubationDuration,
} from '../../game/index.js';
import type { Room, UiContext } from '../context.js';
import { roomShell } from './shell.js';
import { Button, COLORS, centerRow, label, panel } from '../theme.js';
import { catSprite } from '../catTextures.js';
import { upgradeButton } from '../upgradeButton.js';
import { darken } from '../../render/palette.js';

const APPROACH_MS = 900; // за это время перегородка поднимается, а коты сходятся

interface Heart { view: Text; life: number; ttl: number; vx: number; }

interface LiveSlot {
  index: number;
  card: Container;            // карточка слота — для попадания при перетаскивании
  total: number;
  bar?: Graphics; barX: number; barY: number; barW: number; time?: Text;
  busy: boolean;
  startedAt: number;
  partition: Graphics; partRaise: number;
  mom?: Sprite; dad?: Sprite;
  momHomeX: number; momMeetX: number; dadHomeX: number; dadMeetX: number;
  momBase: number; dadBase: number;
  catBaseY: number; catH: number;
  hearts: Container; heartObjs: Heart[]; heartTimer: number;
  phase: number;
}

function mmss(ms: number): string {
  const s = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

const clamp01 = (v: number): number => Math.max(0, Math.min(1, v));
const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;
const easeOut = (t: number): number => 1 - (1 - t) * (1 - t);

export function createIncubator(ctx: UiContext): Room {
  const shell = roomShell(ctx, 'incubator', '🧬 Инкубатор');
  let live: LiveSlot[] = [];

  function selectedPair(): { mother?: Cat; father?: Cat } {
    const sel = ctx.selection
      .map((id) => ctx.state.cats.find((c) => c.id === id))
      .filter((c): c is Cat => !!c);
    return {
      mother: sel.find((c) => c.genotype.sex === 'female'),
      father: sel.find((c) => c.genotype.sex === 'male'),
    };
  }

  function spawnHeart(ls: LiveSlot): void {
    const t = label('💗', 13 + Math.random() * 7, 0xff6b8a, '700');
    t.x = (ls.momMeetX + ls.dadMeetX) / 2 + (Math.random() - 0.5) * ls.catH * 0.5;
    t.y = ls.catBaseY - ls.catH * (0.55 + Math.random() * 0.2);
    ls.hearts.addChild(t);
    ls.heartObjs.push({ view: t, life: 0, ttl: 1.0 + Math.random() * 0.6, vx: (Math.random() - 0.5) * 18 });
  }

  function buildSlot(i: number, w: number, h: number): Container {
    const card = new Container();
    card.addChild(panel(w, h, COLORS.card, 16));
    const slot = ctx.state.slots[i]!;
    const now = ctx.now();
    const busy = slot.readyAt > 0;
    const ready = busy && now >= slot.readyAt;

    const head = label(`Слот ${i + 1}`, 13, COLORS.inkSoft, '700');
    head.position.set(w / 2, 13);
    card.addChild(head);

    // --- геометрия мини-комнаты ---
    const titleH = 24;
    const ctrlH = 80;                       // под комнатой: прогресс + кнопка
    const rx = 9, ry = titleH;
    const rw = w - 18;
    const rh = Math.max(70, h - titleH - ctrlH);
    const cx = rx + 6, cy = ry + 4;         // внутренняя камера
    const cw = rw - 12, ch = rh - 8;
    const centerX = cx + cw / 2;
    const floorY = cy + ch - 6;             // линия пола (низ лап)
    const catH = Math.min(ch * 0.8, cw * 0.42);

    // камера с маской: всё внутри обрезается рамкой комнаты
    const chamber = new Container();
    const mask = new Graphics();
    mask.roundRect(cx, cy, cw, ch, 10).fill(0xffffff);
    card.addChild(chamber, mask);
    chamber.mask = mask;

    // задняя стена + пол
    const wallCol = 0xffeaf1;
    const bg = new Graphics();
    bg.roundRect(cx, cy, cw, ch, 10).fill(wallCol);
    bg.rect(cx, floorY - 2, cw, cy + ch - (floorY - 2)).fill(darken(wallCol, 0.12));
    bg.rect(cx, floorY - 2, cw, 3).fill({ color: 0x000000, alpha: 0.06 });
    chamber.addChild(bg);

    // позиции котов: по сторонам (покой) ↔ к центру, чуть внахлёст (вязка).
    // Самец (Отец) — слева, самка (Мать) — справа.
    const dadHomeX = cx + cw * 0.27;
    const momHomeX = cx + cw * 0.73;
    const rub = catH * 0.16;
    const dadMeetX = centerX - rub;
    const momMeetX = centerX + rub;

    // подписи ролей сторон: куда нести самца, куда самку
    const roleY = cy + 12;
    const dadRole = label('Отец ♂', 11, COLORS.inkSoft, '700');
    dadRole.position.set(dadHomeX, roleY);
    const momRole = label('Мать ♀', 11, COLORS.inkSoft, '700');
    momRole.position.set(momHomeX, roleY);
    chamber.addChild(dadRole, momRole);

    // Кто в слоте: поставленные в слот (staged/идёт вязка), иначе — превью
    // глобального выбора пары из Питомника (легаси-способ «Выбрать для вязки»).
    const momCat = slot.motherId
      ? ctx.state.cats.find((c) => c.id === slot.motherId)
      : (busy ? undefined : selectedPair().mother);
    const dadCat = slot.fatherId
      ? ctx.state.cats.find((c) => c.id === slot.fatherId)
      : (busy ? undefined : selectedPair().father);

    // Коты в слоте кликабельны: тап → инфо, а пока вязка не идёт — можно взять
    // за шкирку и утащить (как на полу комнаты). Во время активной вязки — только тап.
    const wireSlotCat = (sprite: Sprite, cat: Cat): void => {
      sprite.eventMode = 'static';
      sprite.cursor = busy ? 'pointer' : 'grab';
      if (busy) {
        sprite.on('pointertap', () => ctx.openCatMenu(cat));
      } else {
        sprite.on('pointerdown', (e) => ctx.startGrab({
          cat,
          displayH: catH,
          hide: () => { sprite.visible = false; },
          show: () => { sprite.visible = true; },
          onTap: () => ctx.openCatMenu(cat),
          onDrop: () => { /* не пристроили — кот остаётся в слоте (refresh вернёт) */ },
        }, e));
      }
    };

    let mom: Sprite | undefined, dad: Sprite | undefined;
    let momBase = 1, dadBase = 1;
    if (momCat) {
      mom = catSprite(ctx.app, momCat, catH);
      momBase = Math.abs(mom.scale.x);
      mom.scale.x = -momBase;             // справа — смотрит влево, к центру
      mom.position.set(busy ? momMeetX : momHomeX, floorY);
      chamber.addChild(mom);
      wireSlotCat(mom, momCat);
    }
    if (dadCat) {
      dad = catSprite(ctx.app, dadCat, catH);
      dadBase = Math.abs(dad.scale.x);
      dad.scale.x = dadBase;              // слева — смотрит вправо, к центру
      dad.position.set(busy ? dadMeetX : dadHomeX, floorY);
      chamber.addChild(dad);
      wireSlotCat(dad, dadCat);
    }

    // перегородка по центру (поднимается при старте вязки)
    const partW = Math.max(7, cw * 0.05);
    const partTop = cy + 2;
    const partH = floorY - partTop;
    const partCol = 0xcdb6a3;
    const partition = new Graphics();
    partition.roundRect(centerX - partW / 2, partTop, partW, partH, 4).fill(partCol);
    partition.roundRect(centerX - partW / 2, partTop, partW, partH, 4)
      .stroke({ width: 2, color: darken(partCol, 0.28) });
    partition.rect(centerX - partW / 2, partTop + partH * 0.5 - 1, partW, 2)
      .fill({ color: darken(partCol, 0.22) });
    chamber.addChild(partition);
    const partRaise = partH + 12;
    if (busy) {
      const a = easeOut(clamp01((now - slot.startedAt) / APPROACH_MS));
      partition.y = -a * partRaise;
      partition.alpha = 1 - a;
    }

    // сердечки (всплывают при вязке)
    const hearts = new Container();
    chamber.addChild(hearts);

    // подсказка, если пары нет (покой)
    if (!busy && (!momCat || !dadCat)) {
      const hint = label('перетащи\nкотов сюда', 12, COLORS.inkSoft, '600');
      hint.position.set(centerX, cy + ch * 0.42);
      chamber.addChild(hint);
    }

    // рамка комнаты поверх содержимого
    const frame = new Graphics();
    frame.roundRect(cx, cy, cw, ch, 10).stroke({ width: 2, color: COLORS.cardEdge });
    card.addChild(frame);

    // --- контролы под комнатой ---
    const barX = rx + 4;
    const barY = ry + rh + 12;
    const barW = rw - 8;
    let bar: Graphics | undefined, time: Text | undefined;

    if (busy) {
      const barBg = new Graphics();
      barBg.roundRect(barX, barY, barW, 12, 6).fill({ color: 0x000000, alpha: 0.08 });
      card.addChild(barBg);
      bar = new Graphics();
      card.addChild(bar);
      time = label('', 13, COLORS.ink, '700');
      time.position.set(w / 2, barY + 24);
      card.addChild(time);

      if (ready) {
        const btn = new Button({ text: 'Забрать 🐾', w: w - 24, h: 34, color: COLORS.good, fontSize: 15 });
        btn.position.set(w / 2, h - 19);
        btn.onTap = () => {
          const events = collectReady(ctx.state, ctx.now(), ctx.rng);
          ctx.commit();
          const born = events.filter((e) => e.kitten).length;
          const dead = events.filter((e) => e.stillborn).length;
          if (born) ctx.openBirthCard(events);          // карточка с инфо о новорождённом
          else if (dead) ctx.toast('Котёнок не выжил 😿');
          else ctx.toast('Готово');
        };
        card.addChild(btn);
      }
    } else {
      // пара = поставленные в слот коты (или превью глобального выбора)
      const mother = momCat;
      const father = dadCat;
      const ok = !!mother && !!father;
      const btn = new Button({
        text: ok ? 'Свести 🐾' : 'Перетащи пару',
        w: w - 24, h: 38, color: ok ? COLORS.primary : COLORS.cardEdge,
        textColor: ok ? 0xffffff : COLORS.inkSoft, fontSize: 15,
      });
      btn.enabled = ok;
      btn.position.set(w / 2, h - 22);
      btn.onTap = () => {
        const r = startBreeding(ctx.state, i, mother!.id, father!.id, ctx.now());
        if (r.ok) { ctx.clearSelection(); ctx.commit(); ctx.toast('Вязка началась 🐾'); }
        else ctx.toast(r.reason);
      };
      card.addChild(btn);
    }

    live.push({
      index: i,
      card,
      total: busy ? Math.max(1, slot.readyAt - slot.startedAt) : incubationDuration(ctx.state),
      bar, barX, barY, barW, time,
      busy, startedAt: slot.startedAt,
      partition, partRaise,
      mom, dad,
      momHomeX, momMeetX, dadHomeX, dadMeetX,
      momBase, dadBase,
      catBaseY: floorY, catH,
      hearts, heartObjs: [], heartTimer: 0,
      phase: Math.random() * 6,
    });

    return card;
  }

  function refresh(): void {
    for (const c of shell.body.removeChildren()) c.destroy({ children: true });
    live = [];
    const n = ctx.state.slots.length;
    const gap = 14;
    const slotW = Math.min(230, (shell.contentW - gap * (n - 1)) / n);
    const slotH = Math.min(260, shell.contentH * 0.66);
    const totalW = slotW * n + gap * (n - 1);
    const startX = Math.max(0, (shell.contentW - totalW) / 2);
    for (let i = 0; i < n; i++) {
      const c = buildSlot(i, slotW, slotH);
      c.position.set(startX + i * (slotW + gap), 0);
      shell.body.addChild(c);
    }

    const bw = Math.min(248, (shell.contentW - 14) / 2);
    const b1 = upgradeButton(ctx, 'slots', bw);
    const b2 = upgradeButton(ctx, 'speed', bw);
    centerRow([b1, b2], slotH + 32, shell.contentW);
    shell.body.addChild(b1, b2);
  }

  function tick(dt: number): void {
    const now = ctx.now();
    for (const ls of live) {
      ls.phase += dt;
      const slot = ctx.state.slots[ls.index];

      // прогресс-бар + таймер
      if (ls.bar && ls.time && slot && slot.readyAt > 0) {
        const remain = slot.readyAt - now;
        const prog = clamp01(1 - remain / ls.total);
        ls.bar.clear();
        ls.bar.roundRect(ls.barX, ls.barY, Math.max(2, ls.barW * prog), 12, 6)
          .fill(remain <= 0 ? COLORS.good : COLORS.primary);
        ls.time.text = remain <= 0 ? 'Готово! 🥚' : mmss(remain);
      }

      if (ls.busy && ls.mom && ls.dad) {
        // перегородка поднимается, коты сходятся
        const a = easeOut(clamp01((now - ls.startedAt) / APPROACH_MS));
        ls.partition.y = -a * ls.partRaise;
        ls.partition.alpha = 1 - a;
        const momX = lerp(ls.momHomeX, ls.momMeetX, a);
        const dadX = lerp(ls.dadHomeX, ls.dadMeetX, a);
        // «трутся»: лёгкое покачивание навстречу, когда уже рядом
        const s = Math.sin(ls.phase * 7);
        ls.mom.x = momX + s * ls.catH * 0.05 * a;
        ls.dad.x = dadX - s * ls.catH * 0.05 * a;
        ls.mom.scale.y = ls.momBase * (1 + s * 0.04 * a);
        ls.dad.scale.y = ls.dadBase * (1 - s * 0.04 * a);
        ls.mom.rotation = s * 0.06 * a;
        ls.dad.rotation = -s * 0.06 * a;
        // сердечки, когда коты сошлись
        if (a > 0.7) {
          ls.heartTimer -= dt;
          if (ls.heartTimer <= 0) { spawnHeart(ls); ls.heartTimer = 0.35 + Math.random() * 0.3; }
        }
      } else {
        // покой / ожидание пары: каждый поставленный кот мягко дышит и слегка
        // покачивается — он уже «живёт» в слоте, даже если стоит там один
        const b = 1 + Math.sin(ls.phase * 2) * 0.025;
        const sway = Math.sin(ls.phase * 1.6) * 0.05;
        if (ls.mom) { ls.mom.scale.y = ls.momBase * b; ls.mom.rotation = sway; }
        if (ls.dad) { ls.dad.scale.y = ls.dadBase * b; ls.dad.rotation = -sway; }
      }

      // полёт сердечек вверх с затуханием
      for (let k = ls.heartObjs.length - 1; k >= 0; k--) {
        const hh = ls.heartObjs[k]!;
        hh.life += dt;
        const t = hh.life / hh.ttl;
        hh.view.y -= dt * ls.catH * 0.7;
        hh.view.x += hh.vx * dt;
        hh.view.alpha = Math.max(0, 1 - t);
        hh.view.scale.set(0.7 + t * 0.5);
        if (hh.life >= hh.ttl) { hh.view.destroy(); ls.heartObjs.splice(k, 1); }
      }
    }
  }

  /** Кота уронили в инкубаторе: ищем слот под точкой и ставим кота в вязку. */
  function tryDropCat(cat: Cat, gx: number, gy: number): boolean {
    for (const ls of live) {
      const b = ls.card.getBounds();
      if (gx >= b.minX && gx <= b.maxX && gy >= b.minY && gy <= b.maxY) {
        const r = assignBreeder(ctx.state, ls.index, cat.id, ctx.now());
        if (!r.ok) { ctx.toast(r.reason); return false; }
        ctx.commit();
        ctx.toast(cat.genotype.sex === 'female' ? 'Кошка в слоте 💞' : 'Кот в слоте 💞');
        return true;
      }
    }
    ctx.toast('перетащи кота на слот вязки');
    return false;
  }

  return { id: 'incubator', title: '🧬 Инкубатор', container: shell.container, refresh, tick, tryDropCat };
}
