/**
 * Комната «Приют»: котики-метисы ХОДЯТ по полу и ждут, пока их пристроят
 * «в добрые руки» (переноска у двери) или сдадут в лабораторию за 🧬
 * (лабораторный слот). Тап по котику → меню. Улучшения — в оверлее ⚙️.
 */

import { Container, Graphics, Rectangle } from 'pixi.js';
import { catsIn, shelterCapacity, isInSlot, isUnlocked, unlockLevelOf } from '../../game/index.js';
import type { Cat } from '../../game/index.js';
import type { Room, UiContext } from '../context.js';
import { roomShell, floorPlane } from './shell.js';
import { COLORS, label } from '../theme.js';
import { createLivingFloor } from '../livingFloor.js';
import { decorZone } from '../decorArt.js';

export function createShelter(ctx: UiContext): Room {
  const shell = roomShell(ctx, 'shelter', '🏠 Приют');

  // Зона пристройства — переноска у двери (декор с role:'adopt'). Перетащил кота
  // сюда → подтверждение «Отдать в добрые руки?» (см. tryDropCat). Над переноской
  // — лёгкая подпись-подсказка, чтобы зона читалась.
  const adoptZone = decorZone('shelter', 'adopt', ctx.roomW, ctx.roomH);
  if (adoptZone) {
    const tag = label('🤝 в добрые руки', 13, COLORS.ink, '800');
    const pillBg = new Graphics();
    const pw = tag.width + 18;
    pillBg.roundRect(-pw / 2, -14, pw, 26, 13).fill({ color: COLORS.hud, alpha: 0.9 });
    pillBg.roundRect(-pw / 2, -14, pw, 26, 13).stroke({ width: 2, color: COLORS.cardEdge });
    const badge = new Container();
    badge.addChild(pillBg, tag);
    badge.position.set(adoptZone.x + adoptZone.width / 2, adoptZone.y - 6);
    shell.container.addChild(badge);
  }

  // Лабораторный слот — плейсхолдер-станция у левой стены (спрайт будет позже).
  // Перетащил кота сюда → подтверждение сдачи «на эксперименты» за 🧬 (sendToLab).
  // Станция открывается уровнем лаборатории (labStation) — до этого показываем замок.
  const labW = ctx.roomW * 0.15;
  const labH = labW * 0.95;
  const labCx = ctx.roomW * 0.13;
  const labCy = ctx.roomH * 0.86; // низ-центр (как у переноски)
  const labZone = new Rectangle(labCx - labW / 2, labCy - labH, labW, labH);
  // Слой станции пересобираем в refresh() — замок должен сняться, когда игрок дорастёт
  // до нужного уровня (уровень меняется по ходу игры, комната при этом не пересоздаётся).
  const labLayer = new Container();
  shell.container.addChild(labLayer);

  function refreshLabStation(): void {
    labLayer.removeChildren();
    const unlocked = isUnlocked(ctx.state, 'labStation');
    const box = new Graphics();
    // короб-станция (заглушка): скруглённый бокс + «столешница»
    box.roundRect(labZone.x, labZone.y, labW, labH, 14)
      .fill({ color: unlocked ? 0x2f7d78 : 0x6b7370, alpha: unlocked ? 0.85 : 0.6 })
      .stroke({ width: 3, color: unlocked ? 0x1f5c58 : 0x4a504e });
    box.roundRect(labZone.x + labW * 0.12, labZone.y + labH * 0.16, labW * 0.76, labH * 0.4, 8)
      .fill({ color: 0xbfeae6, alpha: unlocked ? 0.55 : 0.3 });
    const flask = label(unlocked ? '🧪' : '🔒', labW * 0.42, COLORS.ink, '700');
    flask.position.set(labCx, labZone.y + labH * 0.56);
    const tag = label(unlocked ? '🧬 в лабораторию' : `Откроется на ур. ${unlockLevelOf('labStation')}`,
      13, COLORS.ink, '800');
    const pillBg = new Graphics();
    const pw = tag.width + 18;
    pillBg.roundRect(-pw / 2, -14, pw, 26, 13).fill({ color: COLORS.hud, alpha: 0.9 });
    pillBg.roundRect(-pw / 2, -14, pw, 26, 13).stroke({ width: 2, color: COLORS.cardEdge });
    const badge = new Container();
    badge.addChild(pillBg, tag);
    badge.position.set(labCx, labZone.y - 8);
    labLayer.addChild(box, flask, badge);
  }

  const floorLayer = new Container();
  shell.container.addChild(floorLayer);

  const floor = createLivingFloor(
    ctx, floorLayer,
    floorPlane(ctx.roomW, ctx.roomH, ctx.topInset),
    // коты, поставленные в слот вязки, физически в инкубаторе — на полу их не показываем
    () => catsIn(ctx.state, 'shelter').filter((c) => !isInSlot(ctx.state, c.id)),
  );

  /** Уронили кота на лабораторию → сдача за 🧬; на переноску → пристройство; иначе переезд. */
  function tryDropCat(cat: Cat, gx: number, gy: number): boolean {
    // gx/gy — координаты виртуальной сцены; зоны — в локальных координатах комнаты
    const lp = shell.container.toLocal({ x: gx, y: gy }, ctx.uiRoot);
    if (labZone.contains(lp.x, lp.y)) {
      if (!isUnlocked(ctx.state, 'labStation')) {
        ctx.toast(`Лаборатория откроется на ур. ${unlockLevelOf('labStation')} 🔒`);
        return false;             // заперто → кот вернётся на своё место
      }
      ctx.commit();               // grab-спрайт уже уничтожен — вернём наземного кота на пол
      ctx.openLabConfirm(cat);     // «Сдать в лабораторию?» (Да → sendToLab)
      return true;
    }
    const zone = decorZone('shelter', 'adopt', ctx.roomW, ctx.roomH);
    if (zone && zone.contains(lp.x, lp.y)) {
      ctx.commit();
      ctx.openAdoptConfirm(cat);   // «Отдать котика в добрые руки?» (Да → adoptCat)
      return true;
    }
    return false;
  }

  function refresh(): void {
    shell.body.removeChildren();
    // на полу — без тех, кто сейчас стоит в слоте инкубатора (они «в отъезде»)
    const present = catsIn(ctx.state, 'shelter').filter((c) => !isInSlot(ctx.state, c.id));
    const cap = shelterCapacity(ctx.state);
    // вместимость комнаты — счётчиком справа в плашке названия
    shell.setTitleBadge(`🐱 ${present.length}/${cap}`);

    refreshLabStation(); // замок станции снимается, когда уровень дорастает
    floor.refresh();
  }

  return {
    id: 'shelter', title: '🏠 Приют', container: shell.container,
    refresh, tick: (dt) => floor.tick(dt), tryDropCat,
  };
}
