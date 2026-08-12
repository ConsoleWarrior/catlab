/**
 * Оверлеи поверх сцены: меню кота (действия) и панель заказов.
 * Возвращают Container с панелью; центрирование и затемнение — на Game.
 */

import { Container, Graphics, Rectangle, Sprite, Text } from 'pixi.js';
import type { Application, FederatedPointerEvent, Point } from 'pixi.js';
import type { Cat, BirthEvent, Ancestor, LiveRoom, OfflineIncome } from '../game/index.js';
import {
  isBusy, isInSlot, freeBreedSlot, assignBreeder, clearBreederSlot, moveCat, keepKittenWithParents,
  claimOrder, matchesOrder, renameCat,
  basketCat, adRefreshOrder, msUntilOrderExpiry, canAdRefreshOrder, msUntilAdRefresh,
  isAdult, growthProgress, growthRemainingMs, isOld, breedsLeft, heartsOf, isSterile,
  roomCount, nurseryCapacity, shelterCapacity, makeCatInstance,
  catAncestors, pedigreeDepth, PEDIGREE_DEPTH, BOOSTS, buyBoost, adChargeBoost, toggleBoost, boostCharges, activeBoostId,
  BOOST_AD_COOLDOWN_MS,
  adoptCat, adoptReward, speedUpGrowth, adSkipGrowth, speedUpCost, GROWTH_SPEEDUP_CRYSTAL_PER_MIN,
  sendToLab, labReward, shelterTotals, adoptAll, sendAllToLab,
  healCat, HEAL_AD_HEARTS, HEAL_CRYSTAL_PER_HEART,
  freezeCat, cloneCat, disposeCryo, cloneCost, cloneCostCoins, cryoCount, cryoCapacity,
  FREEZE_COIN_COST, FREEZE_CRYSTAL_COST, FREEZE_AD_COOLDOWN_MS,
  analyzeCat, freeAnalyzeCat, analyzeCoinCost, tutorialActive, kinshipName,
  claimOfflineAdBonus, offlineAdBonus, OFFLINE_AD_BONUS,
  pedigreeHasFog, knownAncestorBreeds, buildBreedingContext, breedChanceMult,
  breedDiscovered, knownRecipesFor, outcomeRevealed,
  RESEARCH, unlockResearch, researchLevel, researchNext, researchExtraCoins, canAffordResearch,
  firstPurchaseBonusAvailable, FIRST_PURCHASE_BONUS,
  LEVEL_REP_THRESHOLDS, MAX_LEVEL, levelForReputation, // DEV-меню (временное)
} from '../game/index.js';
import { shopItems, buyPack } from '../platform/payments.js';
import { showRewarded } from '../platform/ads.js';
import { breedName, breedDescription, tierOfBreed, TIER_LEVEL, breedingOutcomes, tierUpTarget, dormantTraits, traitTag } from '../genetics/index.js';
import { BREEDS, randomCat, RECIPES, recipeKey } from '../genetics/index.js';
import type { UiContext } from './context.js';
import { Button, centerRow, COLORS, FONT, fmt, label, panel, stackWords, stars, TIERS, tierName, TIER_COLOR, UI_SCALE } from './theme.js';
import { describeCat, catTraits, describeReq, describeRecipe, pct } from './describe.js';
import { catSprite, breedThumbTexture } from './catTextures.js';
import { getMasterVolume, setMasterVolume, sfxEvent, sfxMeow } from './sound.js';
import { t, tx, lang, setLang, type Lang } from '../i18n.js';

/**
 * Поле ввода текста поверх канваса (HTML-оверлей). Надёжнее window.prompt
 * (тот блокируется в части окружений) и даёт мобильную клавиатуру.
 * onDone(null) — отмена, иначе строка из поля.
 */
function askText(title: string, initial: string, maxLen: number, onDone: (v: string | null) => void): void {
  const wrap = document.createElement('div');
  wrap.style.cssText = 'position:fixed;inset:0;z-index:1000;display:flex;align-items:center;'
    + 'justify-content:center;background:rgba(42,35,32,.55);font-family:system-ui,sans-serif;';
  const box = document.createElement('div');
  box.style.cssText = 'background:#fffaf3;padding:18px;border-radius:16px;display:flex;flex-direction:column;'
    + 'gap:12px;min-width:240px;box-shadow:0 10px 32px rgba(0,0,0,.3);';
  const lab = document.createElement('div');
  lab.textContent = title;
  lab.style.cssText = 'font-weight:700;color:#5a4a42;font-size:16px;';
  const input = document.createElement('input');
  input.type = 'text';
  input.maxLength = maxLen;
  input.value = initial;
  input.style.cssText = 'font-size:18px;padding:9px 11px;border:2px solid #e9d8c6;border-radius:10px;'
    + 'outline:none;color:#5a4a42;background:#fff;';
  const row = document.createElement('div');
  row.style.cssText = 'display:flex;gap:8px;justify-content:flex-end;';
  const cancel = document.createElement('button');
  cancel.textContent = t('Отмена', 'Cancel');
  cancel.style.cssText = 'font-size:15px;font-weight:700;padding:8px 16px;border:none;border-radius:10px;'
    + 'cursor:pointer;background:#e9d8c6;color:#5a4a42;';
  const ok = document.createElement('button');
  ok.textContent = 'OK';
  ok.style.cssText = 'font-size:15px;font-weight:700;padding:8px 16px;border:none;border-radius:10px;'
    + 'cursor:pointer;background:#ff9eb5;color:#fff;';
  row.append(cancel, ok);
  box.append(lab, input, row);
  wrap.append(box);
  document.body.append(wrap);
  input.focus();
  input.select();

  let done = false;
  const finish = (v: string | null): void => { if (done) return; done = true; wrap.remove(); onDone(v); };
  ok.onclick = () => finish(input.value);
  cancel.onclick = () => finish(null);
  wrap.onpointerdown = (e) => { if (e.target === wrap) finish(null); };
  input.onkeydown = (e) => {
    if (e.key === 'Enter') finish(input.value);
    else if (e.key === 'Escape') finish(null);
  };
}

/**
 * DEV: HTML-оверлей с выпадающим списком всех пород (сгруппованы по тиру) и
 * кнопкой «Заспавнить». Спавн выполняет колбэк `spawn`, возвращающий строку
 * статуса (успех/питомник заполнен) — она показывается прямо в оверлее, окно
 * не закрывается, чтобы можно было заспавнить несколько котов подряд.
 */
function askBreedSpawn(spawn: (breedKey: string) => string): void {
  const wrap = document.createElement('div');
  wrap.style.cssText = 'position:fixed;inset:0;z-index:1000;display:flex;align-items:center;'
    + 'justify-content:center;background:rgba(42,35,32,.55);font-family:system-ui,sans-serif;';
  const box = document.createElement('div');
  box.style.cssText = 'background:#fffaf3;padding:18px;border-radius:16px;display:flex;flex-direction:column;'
    + 'gap:12px;min-width:260px;box-shadow:0 10px 32px rgba(0,0,0,.3);';
  const lab = document.createElement('div');
  lab.textContent = t('🐈 Заспавнить породу в питомник', '🐈 Spawn a breed into the cattery');
  lab.style.cssText = 'font-weight:700;color:#5a4a42;font-size:16px;';
  const select = document.createElement('select');
  select.style.cssText = 'font-size:16px;padding:9px 11px;border:2px solid #e9d8c6;border-radius:10px;'
    + 'outline:none;color:#5a4a42;background:#fff;';
  for (const tier of TIERS) {
    const group = document.createElement('optgroup');
    group.label = tierName(tier);
    for (const b of BREEDS.filter((x) => x.tier === tier)) {
      const opt = document.createElement('option');
      opt.value = b.key;
      opt.textContent = tx(b.name);
      group.append(opt);
    }
    if (group.children.length) select.append(group);
  }
  const status = document.createElement('div');
  status.style.cssText = 'font-size:14px;font-weight:700;color:#5a4a42;min-height:18px;';
  const row = document.createElement('div');
  row.style.cssText = 'display:flex;gap:8px;justify-content:flex-end;';
  const close = document.createElement('button');
  close.textContent = t('Закрыть', 'Close');
  close.style.cssText = 'font-size:15px;font-weight:700;padding:8px 16px;border:none;border-radius:10px;'
    + 'cursor:pointer;background:#e9d8c6;color:#5a4a42;';
  const ok = document.createElement('button');
  ok.textContent = t('Заспавнить', 'Spawn');
  ok.style.cssText = 'font-size:15px;font-weight:700;padding:8px 16px;border:none;border-radius:10px;'
    + 'cursor:pointer;background:#ff9eb5;color:#fff;';
  row.append(close, ok);
  box.append(lab, select, status, row);
  wrap.append(box);
  document.body.append(wrap);
  select.focus();

  let done = false;
  const finish = (): void => { if (done) return; done = true; wrap.remove(); };
  ok.onclick = () => { status.textContent = spawn(select.value); };
  close.onclick = finish;
  wrap.onpointerdown = (e) => { if (e.target === wrap) finish(); };
  window.addEventListener('keydown', function esc(e) {
    if (e.key === 'Escape') { finish(); window.removeEventListener('keydown', esc); }
  });
}

function rewardText(r: { coins: number; crystals: number; dna: number; reputation: number }): string {
  const p: string[] = [];
  if (r.coins) p.push(`💰${r.coins}`);
  if (r.crystals) p.push(`💎${r.crystals}`);
  if (r.dna) p.push(`🧬${r.dna}`);
  if (r.reputation) p.push(`⭐${r.reputation}`);
  return p.join('  ');
}

// Общая инструкция «Как играть» (buildHelpPanel) убрана 2026-07-28: её заменили
// пошаговое обучение (src/ui/tutorial.ts) и справки по комнатам (src/ui/roomHelp.ts).

/**
 * Горизонтальный ползунок 0..1 на Pixi. Перетаскивание отслеживается на stage,
 * поэтому не срывается, если палец/курсор уходит за пределы кнопки. onChange —
 * в реальном времени во время перетаскивания; onCommit — по отпусканию.
 */
function slider(
  app: Application, trackW: number, initial: number,
  onChange: (v: number) => void, onCommit?: (v: number) => void,
): Container {
  const c = new Container();
  const H = 28;
  const cy = H / 2;
  const knobR = 11;
  const x0 = knobR;                 // центр кнопки не вылезает за края трека
  const x1 = trackW - knobR;
  const span = Math.max(1, x1 - x0);
  let value = Math.min(1, Math.max(0, initial));

  const rail = new Graphics();
  const fill = new Graphics();
  const knob = new Graphics();
  c.addChild(rail, fill, knob);

  const draw = (): void => {
    const kx = x0 + span * value;
    rail.clear();
    rail.roundRect(0, cy - 3, trackW, 6, 3).fill({ color: COLORS.cardEdge });
    fill.clear();
    fill.roundRect(0, cy - 3, kx, 6, 3).fill({ color: COLORS.primary });
    knob.clear();
    knob.circle(kx, cy, knobR).fill({ color: COLORS.hud }).stroke({ width: 3, color: COLORS.primary });
  };
  draw();

  c.eventMode = 'static';
  c.cursor = 'pointer';
  c.hitArea = new Rectangle(0, 0, trackW, H);

  const applyAt = (global: Point): void => {
    const local = c.toLocal(global);
    value = Math.min(1, Math.max(0, (local.x - x0) / span));
    draw();
    onChange(value);
  };

  c.on('pointerdown', (e: FederatedPointerEvent) => {
    applyAt(e.global);
    const move = (ev: FederatedPointerEvent): void => applyAt(ev.global);
    const up = (): void => {
      app.stage.off('pointermove', move);
      app.stage.off('pointerup', up);
      app.stage.off('pointerupoutside', up);
      onCommit?.(value);
    };
    app.stage.on('pointermove', move);
    app.stage.on('pointerup', up);
    app.stage.on('pointerupoutside', up);
  });

  return c;
}

/** Оверлей настроек. Пока — общая громкость звука (эффекты + музыка). */
export function buildSettingsPanel(ctx: UiContext, close: () => void): Container {
  const W = 340;
  const pad = 24;
  const root = new Container();

  const title = label(t('⚙️ Настройки', '⚙️ Settings'), 20, COLORS.ink, '800');
  title.position.set(W / 2, 30);

  let y = 66;

  const volCap = label(t('🔊 Громкость', '🔊 Volume'), 15, COLORS.ink, '800');
  volCap.anchor.set(0, 0.5);
  volCap.position.set(pad, y);
  const pctT = label(`${Math.round(getMasterVolume() * 100)}%`, 15, COLORS.inkSoft, '800');
  pctT.anchor.set(1, 0.5);
  pctT.position.set(W - pad, y);
  y += 24;

  const sl = slider(
    ctx.app, W - pad * 2, getMasterVolume(),
    (v) => { setMasterVolume(v); pctT.text = `${Math.round(v * 100)}%`; },
    (v) => { if (v > 0) sfxMeow(); }, // отпустил — коротко мяукнуть на новой громкости
  );
  sl.position.set(pad, y);
  y += 42;

  // Язык: определяется автоматически через SDK (п. 2.14), но игрок вправе
  // переключить его сам — рекомендация п. 6.9. Флаги, а не названия языков:
  // выбрать свой язык должно быть можно, не зная текущего.
  const langCap = label(t('🌐 Язык', '🌐 Language'), 15, COLORS.ink, '800');
  langCap.anchor.set(0, 0.5);
  langCap.position.set(pad, y + 4);
  const langBtns: Button[] = [];
  const LANGS: { code: Lang; text: string }[] = [
    { code: 'ru', text: '🇷🇺 RU' },
    { code: 'en', text: '🇬🇧 EN' },
  ];
  LANGS.forEach((l, i) => {
    const on = lang() === l.code;
    const b = new Button({
      text: l.text, w: 84, h: 38,
      color: on ? COLORS.primary : COLORS.card,
      textColor: on ? 0xffffff : COLORS.ink, fontSize: 15,
    });
    b.position.set(W - pad - 42 - (LANGS.length - 1 - i) * 92, y + 4);
    b.onTap = () => { if (!on) setLang(l.code); }; // Game пересоберёт сцену (onLangChange)
    langBtns.push(b);
  });
  y += 52;

  const closeBtn = new Button({ text: t('Готово', 'Done'), w: W - pad * 2, h: 46, color: COLORS.primary, fontSize: 16 });
  closeBtn.position.set(W / 2, y + 23);
  closeBtn.onTap = close;
  y += 58;

  root.addChild(panel(W, y, COLORS.hud, 18), title, volCap, pctT, sl, langCap, ...langBtns, closeBtn);
  return root;
}

/**
 * Магазин кристаллов (инап-покупки Яндекс Игр, см. GDD.md §6).
 *
 * Цена и портальная валюта берутся строкой из каталога Консоли (ShopItem.priceText)
 * — рисовать «99 ₽» руками нельзя, это требование модерации. Панель открывается
 * только когда покупки реально доступны (ctx проверяет shopAvailable), поэтому
 * состояния «магазин не работает» здесь нет.
 */
export function buildShopPanel(ctx: UiContext, close: () => void): Container {
  const W = 340;
  const pad = 20;
  const root = new Container();
  let busy = false; // идёт оплата — не даём тапнуть второй пак

  const render = (): void => {
    root.removeChildren();
    const items = shopItems();
    const parts: Container[] = [];

    const title = label(t('💎 Кристаллы', '💎 Crystals'), 20, COLORS.ink, '800');
    title.position.set(W / 2, 30);
    parts.push(title);

    const sub = label(t('Ускоряют вязку и рост, лечат котов, заряжают усилители', 'Speed up breeding and growth, heal cats, charge boosters'), 11.5, COLORS.inkSoft, '600');
    sub.position.set(W / 2, 50);
    parts.push(sub);

    let y = 66;

    if (firstPurchaseBonusAvailable(ctx.state)) {
      const bonus = Math.round(FIRST_PURCHASE_BONUS * 100);
      const banner = panel(W - pad * 2, 30, COLORS.warn, 12);
      banner.position.set(pad, y);
      const bt = label(t(`🎁 Первая покупка: +${bonus}% кристаллов`, `🎁 First purchase: +${bonus}% crystals`), 13, COLORS.ink, '800');
      bt.position.set(W / 2, y + 15);
      parts.push(banner, bt);
      y += 38;
    }

    for (const item of items) {
      const h = 54;
      const card = panel(W - pad * 2, h, COLORS.card, 12);
      card.position.set(pad, y);
      parts.push(card);

      // Точное число, без сокращения fmt: «1k» вместо «1000» в магазине недопустимо —
      // состав покупки обязан читаться ровно так, как заведён в Консоли.
      const amount = label(`💎 ${item.crystals}`, 17, COLORS.ink, '800');
      amount.anchor.set(0, 0.5);
      amount.position.set(pad + 14, y + h / 2 - (item.bonusPct > 0 ? 9 : 0));
      parts.push(amount);

      if (item.bonusPct > 0) {
        const badge = label(t(`выгоднее на ${item.bonusPct}%`, `${item.bonusPct}% better value`), 11, COLORS.inkSoft, '700');
        badge.anchor.set(0, 0.5);
        badge.position.set(pad + 14, y + h / 2 + 11);
        parts.push(badge);
      }

      const buy = new Button({
        text: item.priceText, w: 108, h: 38, color: COLORS.crystals, fontSize: 14,
      });
      buy.enabled = !busy;
      buy.position.set(W - pad - 14 - 54, y + h / 2);
      buy.onTap = () => {
        if (busy) return;
        busy = true;
        render();
        void buyPack(item.id).then((r) => {
          busy = false;
          if (r.ok) {
            ctx.commit();
            ctx.toast(t(`Спасибо! 💎 +${r.crystals ?? 0}`, `Thank you! 💎 +${r.crystals ?? 0}`));
          } else if (r.reason) {
            ctx.toast(r.reason);
          }
          render();
        });
      };
      parts.push(buy);
      y += h + 8;
    }

    if (busy) {
      const wait = label(t('Оплата…', 'Paying…'), 12, COLORS.inkSoft, '700');
      wait.position.set(W / 2, y + 8);
      parts.push(wait);
      y += 22;
    }

    const note = label(t('Покупки проходят через Яндекс Игры', 'Purchases go through Yandex Games'), 10.5, COLORS.inkSoft, '600');
    note.position.set(W / 2, y + 8);
    parts.push(note);
    y += 24;

    const closeBtn = new Button({ text: t('Закрыть', 'Close'), w: W - pad * 2, h: 42, color: COLORS.cardEdge, textColor: COLORS.ink, fontSize: 15 });
    closeBtn.enabled = !busy;
    closeBtn.position.set(W / 2, y + 21);
    closeBtn.onTap = close;
    parts.push(closeBtn);
    y += 52;

    root.addChildAt(panel(W, y, COLORS.hud, 18), 0);
    root.addChild(...parts);
  };

  render();
  return root;
}

/** Что показать в окне «С возвращением»: начисление + что ещё случилось без игрока. */
export interface OfflineReport extends OfflineIncome {
  born: number; // родившихся котят разобрали по комнатам (см. Game.applyOffline)
  rep: number;  // ⭐ за эти рождения
}

/** «2 ч 15 мин» / «45 мин» / «1 д 6 ч» — длительность отлучки по-человечески. */
function fmtAway(min: number): string {
  const total = Math.max(1, Math.round(min));
  const h = Math.floor(total / 60);
  if (h >= 24) {
    const d = Math.floor(h / 24);
    const rh = h % 24;
    return rh ? t(`${d} д ${rh} ч`, `${d}d ${rh}h`) : t(`${d} д`, `${d}d`);
  }
  const m = total % 60;
  if (h <= 0) return t(`${m} мин`, `${m} min`);
  return m ? t(`${h} ч ${m} мин`, `${h}h ${m} min`) : t(`${h} ч`, `${h}h`);
}

/**
 * «С возвращением»: сколько лаборатория заработала, пока игрока не было. Открывается
 * само при входе в игру и при возврате из фона (см. Game.applyOffline) — но только
 * после заметной отлучки и когда доход реально капнул, иначе показывается обычный тост.
 *
 * 📺 добавляет OFFLINE_AD_BONUS от уже начисленного. Награда одноразовая: кнопка
 * гаснет на время показа ролика, а после начисления окно закрывается — второй раз
 * тот же отчёт не открыть (он живёт только до закрытия окна).
 */
export function buildOfflineReport(ctx: UiContext, report: OfflineReport, close: () => void): Container {
  const W = 340;
  const pad = 24;
  const root = new Container();
  const parts: Container[] = [];

  const title = label(t('🌙 С возвращением!', '🌙 Welcome back!'), 20, COLORS.ink, '800');
  title.position.set(W / 2, 32);
  parts.push(title);

  const away = label(t(`Вас не было ${fmtAway(report.awayMin)}`, `You were away ${fmtAway(report.awayMin)}`), 13, COLORS.inkSoft, '700');
  away.position.set(W / 2, 56);
  parts.push(away);

  let y = 76;

  // главная строка отчёта — заработок на плашке цвета монет
  const plate = panel(W - pad * 2, 64, COLORS.card, 14);
  plate.position.set(pad, y);
  const cap = label(t('Лаборатория заработала', 'Your lab earned'), 12, COLORS.inkSoft, '700');
  cap.position.set(W / 2, y + 18);
  const sum = label(`💰 +${report.coins}`, 28, COLORS.coins, '800');
  sum.position.set(W / 2, y + 42);
  parts.push(plate, cap, sum);
  y += 74;

  // почему не больше: потолок офлайна важнее (его лечат улучшением), пустая
  // кормушка — вторым, показываем что-то одно, чтобы окно не превращалось в стену
  const limitNote = report.cappedByTime
    ? t(`⏳ Доход копился ${fmtAway(report.incomeMin)} — это потолок офлайна`, `⏳ Income piled up for ${fmtAway(report.incomeMin)} — that is the offline cap`)
    : report.cappedByFood
      ? t(`🍽 Корм закончился — доход шёл ${fmtAway(report.incomeMin)}`, `🍽 The food ran out — income lasted ${fmtAway(report.incomeMin)}`)
      : '';
  if (limitNote) {
    const note = label(limitNote, 11.5, COLORS.warn, '800');
    note.position.set(W / 2, y + 8);
    parts.push(note);
    y += 22;
    const hint = label(
      report.cappedByTime
        ? t('поднять потолок: 🌙 «Ночной смотритель» в Улучшениях', 'raise the cap: 🌙 «Night keeper» in Upgrades')
        : t('кормушка в Питомнике', 'the feeder is in the Cattery'),
      10.5, COLORS.inkSoft, '600',
    );
    hint.position.set(W / 2, y + 6);
    parts.push(hint);
    y += 20;
  }

  if (report.born) {
    const rep = report.rep ? `  ⭐ +${report.rep}` : '';
    const b = label(t(`🐱 Родилось котят: ${report.born}${rep}`, `🐱 Kittens born: ${report.born}${rep}`), 13, COLORS.ink, '800');
    b.position.set(W / 2, y + 10);
    parts.push(b);
    y += 26;
  }

  y += 8;
  const btnW = W - pad * 2;

  // 📺 надбавка: только если она хотя бы в одну монету (иначе кнопка-обманка)
  const bonus = offlineAdBonus(report.coins);
  if (bonus > 0) {
    const adBtn = new Button({
      text: t(
        `📺 Реклама · +${Math.round(OFFLINE_AD_BONUS * 100)}%  ·  💰 +${bonus}`,
        `📺 Ad · +${Math.round(OFFLINE_AD_BONUS * 100)}%  ·  💰 +${bonus}`,
      ),
      w: btnW, h: 48, color: COLORS.good, textColor: 0xffffff, fontSize: 15,
    });
    adBtn.position.set(W / 2, y + 24);
    adBtn.onTap = () => {
      adBtn.enabled = false; // ролик уже показывается — второй тап награды не даст
      void showRewarded().then((watched) => {
        if (!watched) { adBtn.enabled = true; ctx.toast(t('Реклама недоступна', 'Ad unavailable')); return; }
        const got = claimOfflineAdBonus(ctx.state, report.coins);
        ctx.commit();
        ctx.toast(t(`Надбавка за просмотр: 💰 +${got}`, `Bonus for watching: 💰 +${got}`));
        close();
      });
    };
    parts.push(adBtn);
    y += 56;
  }

  const closeBtn = new Button({ text: t('Закрыть', 'Close'), w: btnW, h: 42, color: COLORS.cardEdge, textColor: COLORS.ink, fontSize: 15 });
  closeBtn.position.set(W / 2, y + 21);
  closeBtn.onTap = close;
  parts.push(closeBtn);
  y += 52;

  root.addChild(panel(W, y, COLORS.hud, 18), ...parts);
  return root;
}

/** Что показать в панели повышения уровня лаборатории. */
export interface LevelUpInfo {
  level: number;      // достигнутый уровень лаборатории (итоговый, если прыгнули через несколько)
  crystals: number;   // 💎 подарок суммарно за пройденные уровни
  unlocks: string[];  // что открылось (агрегировано по всем пройденным уровням; может быть пусто)
}

/**
 * Панель повышения уровня лаборатории. Открывается сама (Game.checkLevelUp), когда
 * уровень вырос от любого источника опыта. Показывает поздравление, подарок 💎 и
 * список того, что открылось по уровню (слоты/пьедесталы/фичи/узлы «Улучшений»).
 * Кристаллы к этому моменту уже начислены (actions.addReputation) — здесь только показ.
 */
export function buildLevelUpPanel(ctx: UiContext, info: LevelUpInfo, close: () => void): Container {
  void ctx;
  const W = 340;
  const pad = 24;
  const root = new Container();
  const parts: Container[] = [];

  const title = label(t('🎉 Новый уровень!', '🎉 New level!'), 20, COLORS.ink, '800');
  title.position.set(W / 2, 32);
  parts.push(title);

  let y = 54;

  // Главная плашка: «Поздравляем! Достигнут ⭐ Уровень N лаборатории».
  const plate = panel(W - pad * 2, 62, COLORS.card, 14);
  plate.position.set(pad, y);
  const cong = label(t('Поздравляем! Достигнут', 'Congratulations! You reached'), 12.5, COLORS.inkSoft, '700');
  cong.position.set(W / 2, y + 17);
  const lvlT = label(t(`⭐ Уровень ${info.level} лаборатории`, `⭐ Lab level ${info.level}`), 19, COLORS.ink, '800');
  lvlT.position.set(W / 2, y + 41);
  parts.push(plate, cong, lvlT);
  y += 74;

  // Подарок кристаллами (на цветной плашке 💎).
  if (info.crystals > 0) {
    const gift = panel(W - pad * 2, 40, COLORS.crystals, 12);
    gift.position.set(pad, y);
    const gt = label(t(`🎁 Подарок: 💎 +${info.crystals}`, `🎁 Gift: 💎 +${info.crystals}`), 16, 0xffffff, '800');
    gt.position.set(W / 2, y + 20);
    parts.push(gift, gt);
    y += 50;
  }

  // Что открылось на этом уровне (бывает пусто — тогда просто поздравление + 💎).
  if (info.unlocks.length) {
    const head = label(t('Стало доступно:', 'Now available:'), 14, COLORS.ink, '800');
    head.anchor.set(0, 0.5);
    head.position.set(pad, y + 8);
    parts.push(head);
    y += 24;
    for (const u of info.unlocks) {
      const line = new Text({
        text: `• ${u}`,
        style: {
          fontFamily: FONT, fontSize: 14, fontWeight: '600', fill: COLORS.inkSoft,
          align: 'left', wordWrap: true, wordWrapWidth: W - pad * 2 - 12, lineHeight: 19,
        },
      });
      line.anchor.set(0, 0);
      line.position.set(pad + 6, y);
      parts.push(line);
      y += line.height + 5;
    }
    y += 6;
  } else {
    y += 4;
  }

  const closeBtn = new Button({ text: t('Отлично!', 'Great!'), w: W - pad * 2, h: 46, color: COLORS.primary, fontSize: 16 });
  closeBtn.position.set(W / 2, y + 23);
  closeBtn.onTap = close;
  parts.push(closeBtn);
  y += 58;

  root.addChild(panel(W, y, COLORS.hud, 18), ...parts);
  return root;
}

/**
 * Карточка рождения: показывает новорождённого (облик, пол, редкость, родословную).
 * Если родилось несколько — листаем по одному кнопкой «Следующий».
 */
export function buildBirthCard(ctx: UiContext, events: BirthEvent[], close: () => void): Container {
  const births = events.filter((e) => e.kitten);
  const W = 360;
  const root = new Container();
  let idx = 0;

  const render = (): void => {
    root.removeChildren();
    const ev = births[idx]!;
    const cat = ev.kitten!;

    const title = label(
      births.length > 1 ? t(`🎉 Пополнение! (${idx + 1}/${births.length})`, `🎉 New arrivals! (${idx + 1}/${births.length})`) : t('🎉 Малыш родился!', '🎉 A kitten is born!'),
      19, COLORS.ink, '800',
    );
    title.position.set(W / 2, 30);

    // «колыбель» под спрайтом, рамка в цвет тира
    const boxY = 52;
    const boxH = 150;
    const cradle = new Graphics();
    cradle.roundRect(W / 2 - 82, boxY, 164, boxH, 18)
      .fill({ color: COLORS.card })
      .stroke({ width: 3, color: TIER_COLOR[cat.rarityTier], alpha: 0.85 });

    const sp = catSprite(ctx.app, cat, boxH * 0.78);
    sp.position.set(W / 2, boxY + boxH - 14);

    let y = boxY + boxH + 18;
    // двусловное название породы — в две строки (привязка по верху, сдвигаем y на высоту)
    const name = label(stackWords(breedName(cat.breed)), 19, COLORS.ink, '800');
    name.anchor.set(0.5, 0);
    name.position.set(W / 2, y); y += name.height + 6;

    const st = stars(cat.rarityTier, 16);
    st.position.set(W / 2, y); y += 22;

    const tierT = label(tierName(cat.rarityTier), 13, TIER_COLOR[cat.rarityTier], '800');
    tierT.position.set(W / 2, y); y += 22;

    const grow = label(t('пол и имя проявятся, когда подрастёт 🌱', 'sex and name appear once it grows up 🌱'), 12, COLORS.inkSoft, '600');
    grow.position.set(W / 2, y); y += 24;

    const extra: Container[] = [];
    if (ev.motherBreed && ev.fatherBreed) {
      const line = label(
        t(`от: ${breedName(ev.motherBreed)} ♀ × ${breedName(ev.fatherBreed)} ♂`, `from: ${breedName(ev.motherBreed)} ♀ × ${breedName(ev.fatherBreed)} ♂`),
        12, COLORS.inkSoft, '600',
      );
      line.position.set(W / 2, y); extra.push(line); y += 22;

      const parentMax = Math.max(
        TIER_LEVEL[tierOfBreed(ev.motherBreed)],
        TIER_LEVEL[tierOfBreed(ev.fatherBreed)],
      );
      if (TIER_LEVEL[cat.rarityTier] > parentMax) {
        const up = label(t('🌟 редкость выше родителей!', '🌟 rarer than its parents!'), 13, COLORS.good, '800');
        up.position.set(W / 2, y); extra.push(up); y += 24;
      }
    }
    y += 8;

    const last = idx >= births.length - 1;
    const advance = (): void => { if (last) close(); else { idx++; render(); } };
    // малыш сидит в слоте инкубатора (его держит collectReady) — значит доступен
    // вариант «оставить с родителями». Для DEV-рождений (не из слота) его не будет.
    const held = ctx.state.slots.some((s) => s.kittenId === cat.id);

    // всплывающая исчезающая надпись «нет места» у кнопки переполненной комнаты
    const flashNoSpace = (atY: number): void => {
      const txt = label(t('нет места', 'no room'), 16, 0xe06a6a, '800');
      txt.position.set(W / 2, atY);
      root.addChild(txt);
      let life = 0;
      const fn = (tk: { deltaMS: number }): void => {
        if (txt.destroyed) { ctx.app.ticker.remove(fn); return; }
        const d = tk.deltaMS / 1000;
        life += d;
        txt.y -= d * 26;
        txt.alpha = Math.max(0, 1 - life / 0.9);
        if (life >= 0.9) { ctx.app.ticker.remove(fn); txt.destroy(); }
      };
      ctx.app.ticker.add(fn);
    };

    const btns: Container[] = [];

    // «В питомник» / «В приют» с текущей заполненностью; если места нет — кнопка не
    // срабатывает и над ней вспыхивает «нет места».
    const mkPlace = (text: string, color: number, room: 'nursery' | 'shelter'): Button => {
      const b = new Button({ text, w: W - 60, h: 46, color, fontSize: 16 });
      b.position.set(W / 2, y + 23);
      b.onTap = () => {
        const r = moveCat(ctx.state, cat.id, room);
        if (!r.ok) { flashNoSpace(b.y - 4); return; }
        ctx.commit();
        ctx.toast(room === 'shelter' ? t('Малыш в приюте 🏠', 'The kitten is in the shelter 🏠') : t('Малыш в питомнике 🏆', 'The kitten is in the cattery 🏆'));
        advance();
      };
      y += 54;
      return b;
    };
    btns.push(mkPlace(
      t(`🏠 В питомник (${roomCount(ctx.state, 'nursery')}/${nurseryCapacity(ctx.state)})`, `🏠 To the cattery (${roomCount(ctx.state, 'nursery')}/${nurseryCapacity(ctx.state)})`),
      COLORS.primary, 'nursery',
    ));
    btns.push(mkPlace(
      t(`🏚️ В приют (${roomCount(ctx.state, 'shelter')}/${shelterCapacity(ctx.state)})`, `🏚️ To the shelter (${roomCount(ctx.state, 'shelter')}/${shelterCapacity(ctx.state)})`),
      COLORS.secondary, 'shelter',
    ));

    // Крайний случай (мест нигде нет): оставить малыша с родителями в слоте — он
    // растёт втрое медленнее и блокирует слот, пока его не унесут в комнату.
    if (held) {
      const keep = new Button({
        text: t('🐾 Оставить с родителями', '🐾 Leave it with the parents'), w: W - 60, h: 44, color: COLORS.warn,
        textColor: COLORS.ink, fontSize: 15,
      });
      keep.position.set(W / 2, y + 22);
      keep.onTap = () => {
        keepKittenWithParents(ctx.state, cat.id, ctx.now());
        ctx.commit();
        ctx.toast(t('Малыш остался с роднёй 🐾 (растёт медленно)', 'The kitten stayed with its family 🐾 (grows slowly)'));
        advance();
      };
      btns.push(keep);
      y += 52;
    }

    root.addChild(panel(W, y, COLORS.hud, 18), title, cradle, sp, name, st, tierT, grow, ...extra, ...btns);
  };

  render();
  return root;
}

/**
 * Причина отказа зарядки — на человеческом языке. Ядро отдаёт 'locked' кодом
 * (замок общий для нескольких проверок), а показывать игроку служебное слово
 * нельзя: п. 1.14 требований — «нет технических сообщений».
 */
function boostReasonText(reason: string | undefined): string {
  return reason === 'locked' ? t('Генная инженерия ещё заперта 🔒', 'Gene engineering is still locked 🔒') : reason ?? t('не получилось', 'did not work');
}

/**
 * Всплывающее меню усилителя вязки («Генная инженерия», кнопки у названия
 * Инкубатора): описание буста + три способа зарядки — за 🧬 гены, 💎 кристаллы
 * или 📺 рекламу (бесплатно, глобальный кулдаун BOOST_AD_COOLDOWN_MS на все три
 * усилителя). После активации усилитель «горит» и сработает на первой же
 * следующей вязке (в любом слоте). Перерисовывается на месте после оплаты.
 */
export function buildBoostMenu(ctx: UiContext, boostId: string, close: () => void): Container {
  const def = BOOSTS.find((b) => b.id === boostId);
  const W = 320;
  const root = new Container();
  if (!def) { root.addChild(panel(W, 80, COLORS.hud, 18)); return root; }

  const render = (): void => {
    root.removeChildren();
    const charges = boostCharges(ctx.state, def.id);       // склад зарядов этого усилителя
    const activeId = activeBoostId(ctx.state);             // какой усилитель активен (или нет)
    const active = activeId === def.id;                    // активен именно этот
    const activeDef = activeId ? BOOSTS.find((b) => b.id === activeId) : undefined;
    const items: Container[] = [];

    const title = label(`${def.glyph} ${tx(def.label)}`, 19, COLORS.ink, '800');
    title.position.set(W / 2, 30);
    items.push(title);

    const desc = new Text({
      text: tx(def.desc),
      style: {
        fontFamily: FONT, fontSize: 14, fontWeight: '600', fill: COLORS.inkSoft,
        align: 'center', wordWrap: true, wordWrapWidth: W - 48, lineHeight: 19,
      },
    });
    desc.anchor.set(0.5, 0);
    desc.position.set(W / 2, 48);
    items.push(desc);
    let y = 48 + desc.height + 14;

    // Склад зарядов (не зависит от активности — заряды копятся, тратятся в вязке).
    const stock = label(
      charges > 0 ? t(`📦 В запасе: ×${charges}`, `📦 In stock: ×${charges}`) : t('📦 В запасе: нет зарядов', '📦 In stock: no charges'),
      13, charges > 0 ? COLORS.ink : COLORS.inkSoft, '800',
    );
    stock.position.set(W / 2, y);
    items.push(stock);
    y += 22;

    // Статус активности: активен сейчас / заряжён, но не активен / другой активен.
    const status = label(
      active
        ? t('⚡ активен · сработает на следующей вязке', '⚡ active · fires on the next breeding')
        : charges > 0
          ? (activeDef ? t(`не активен · сейчас активен ${activeDef.glyph} ${tx(activeDef.label)}`, `not active · ${activeDef.glyph} ${tx(activeDef.label)} is active instead`) : t('не активен · включи, чтобы работал', 'not active · switch it on to use it'))
          : t('нет зарядов · сначала заряди', 'no charges · charge it first'),
      12, active ? COLORS.good : COLORS.inkSoft, '700',
    );
    status.position.set(W / 2, y);
    items.push(status);
    y += 20;

    // Правило: одновременно активен только один усилитель.
    const rule = label(t('⚖️ Активен только один усилитель за раз', '⚖️ Only one booster can be active at a time'), 11, COLORS.inkSoft, '600');
    rule.position.set(W / 2, y);
    items.push(rule);
    y += 22;

    const buyWith = (currency: 'dna' | 'crystals'): void => {
      const r = buyBoost(ctx.state, def.id, currency);
      if (r.ok) { ctx.commit(); ctx.toast(t(`${def.glyph} ${tx(def.label)}: +1 заряд`, `${def.glyph} ${tx(def.label)}: +1 charge`)); render(); }
      else ctx.toast(boostReasonText(r.reason));
    };

    const pad = 24, gap = 12;
    // Зарядка (любых типов, помногу) — доступна всегда.
    const bw = (W - pad * 2 - gap) / 2;
    const geneBtn = new Button({ text: t(`Заряд\n🧬 ${def.dna}`, `Charge\n🧬 ${def.dna}`), w: bw, h: 54, color: COLORS.dna, fontSize: 14 });
    geneBtn.enabled = ctx.state.dna >= def.dna;
    geneBtn.onTap = () => buyWith('dna');
    geneBtn.position.set(pad + bw / 2, y + 27);
    const crysBtn = new Button({ text: t(`Заряд\n💎 ${def.crystals}`, `Charge\n💎 ${def.crystals}`), w: bw, h: 54, color: COLORS.crystals, fontSize: 14 });
    crysBtn.enabled = ctx.state.crystals >= def.crystals;
    crysBtn.onTap = () => buyWith('crystals');
    crysBtn.position.set(pad + bw + gap + bw / 2, y + 27);
    items.push(geneBtn, crysBtn);
    y += 66;

    // 📺-зарядка — бесплатный третий способ, но только у 🛡/🍀 (adCharge): Активатор
    // слишком силён для бесплатного крана. Кулдаун глобальный (один на оба,
    // 0 = ещё не смотрели), поэтому кнопка гаснет сразу в обоих меню.
    if (def.adCharge) {
      const adLeft = ctx.state.lastBoostAdAt > 0
        ? BOOST_AD_COOLDOWN_MS - (ctx.now() - ctx.state.lastBoostAdAt) : 0;
      const adReady = adLeft <= 0;
      const adBtn = new Button({
        text: adReady ? t('📺 Заряд за рекламу · бесплатно', '📺 Charge for an ad · free') : t(`📺 Заряд за рекламу · через ${Math.ceil(adLeft / 60_000)} мин`, `📺 Charge for an ad · in ${Math.ceil(adLeft / 60_000)} min`),
        w: W - pad * 2, h: 40,
        color: adReady ? COLORS.good : COLORS.cardEdge,
        textColor: adReady ? 0xffffff : COLORS.inkSoft, fontSize: 13.5,
      });
      adBtn.enabled = adReady;
      adBtn.position.set(W / 2, y + 20);
      adBtn.onTap = () => {
        void showRewarded().then((watched) => {
          if (!watched) { ctx.toast(t('Реклама недоступна', 'Ad unavailable')); return; }
          const r = adChargeBoost(ctx.state, def.id, ctx.now());
          if (r.ok) { ctx.commit(); ctx.toast(t(`📺 ${def.glyph} ${tx(def.label)}: +1 заряд`, `📺 ${def.glyph} ${tx(def.label)}: +1 charge`)); render(); }
          else ctx.toast(boostReasonText(r.reason));
        });
      };
      items.push(adBtn);
      y += 50;
    } else {
      const noAd = label(t('📺-зарядка недоступна — только за 🧬/💎', 'no ad charge for this one — only 🧬/💎'), 11, COLORS.inkSoft, '600');
      noAd.position.set(W / 2, y + 8);
      items.push(noAd);
      y += 24;
    }

    // Переключатель активности (заряды НЕ тратит). Активировать можно только при
    // наличии зарядов; активный — выключить. Включение снимает активность с другого.
    const toggleBtn = new Button({
      text: active ? t('🟢 Активен · выключить', '🟢 Active · switch off') : charges > 0 ? t('⚡ Сделать активным', '⚡ Make it active') : t('Заряди, чтобы активировать', 'Charge it to activate'),
      w: W - pad * 2, h: 42,
      color: active ? COLORS.good : charges > 0 ? COLORS.primary : COLORS.cardEdge,
      textColor: active || charges > 0 ? 0xffffff : COLORS.inkSoft, fontSize: 14.5,
    });
    toggleBtn.enabled = active || charges > 0;
    toggleBtn.position.set(W / 2, y + 21);
    toggleBtn.onTap = () => {
      const wasActive = active;
      const r = toggleBoost(ctx.state, def.id);
      if (!r.ok) { ctx.toast(r.reason === t('нет зарядов', 'no charges') ? t('Нет зарядов — сначала заряди', 'No charges — charge it first') : boostReasonText(r.reason)); return; }
      ctx.commit();
      ctx.toast(wasActive ? t(`${def.glyph} ${tx(def.label)} выключен`, `${def.glyph} ${tx(def.label)} switched off`) : t(`${def.glyph} ${tx(def.label)} активен ⚡`, `${def.glyph} ${tx(def.label)} is active ⚡`));
      render();
    };
    items.push(toggleBtn);
    y += 52;

    const closeBtn = new Button({ text: t('Закрыть', 'Close'), w: W - pad * 2, h: 40, color: COLORS.cardEdge, textColor: COLORS.ink, fontSize: 14 });
    closeBtn.position.set(W / 2, y + 20);
    closeBtn.onTap = close;
    items.push(closeBtn);
    y += 50;

    root.addChild(panel(W, y, COLORS.hud, 18), ...items);
  };

  render();
  return root;
}

/**
 * Подтверждение покупки улучшения (узел дерева «Улучшения» в Генолабе). Открывается
 * тапом по доступному узлу — чтобы случайный тап не тратил валюту. Показывает эффект
 * уровня, цену и баланс; «Купить» активна только при достатке средств.
 */
export function buildResearchConfirm(ctx: UiContext, defId: string, close: () => void): Container {
  const W = 340;
  const root = new Container();
  const def = RESEARCH.find((r) => r.id === defId);
  if (!def) { root.addChild(panel(W, 80, COLORS.hud, 18)); return root; }

  const owned = researchLevel(ctx.state, def.id);
  const total = def.levels.length;
  const next = researchNext(ctx.state, def);
  const curColor = def.currency === 'dna' ? COLORS.dna : COLORS.coins;
  const curGlyph = def.currency === 'dna' ? '🧬' : '💰';
  const balance = def.currency === 'dna' ? ctx.state.dna : ctx.state.coins;
  const cost = next?.cost ?? 0;
  const extraCoins = researchExtraCoins(def, next); // доп. 💰 у Селекции (сверх 🧬)
  const afford = canAffordResearch(ctx.state, def, next);
  const items: Container[] = [];

  let y = 24;
  const title = label(`${def.glyph} ${tx(def.title)}`, 20, COLORS.ink, '800');
  title.position.set(W / 2, y); items.push(title); y += 26;

  if (total > 1) {
    const lvl = label(t(`Уровень ${owned + 1} из ${total}`, `Level ${owned + 1} of ${total}`), 13, COLORS.inkSoft, '700');
    lvl.position.set(W / 2, y); items.push(lvl); y += 24;
  }

  const desc = new Text({
    text: tx(next?.desc ?? def.desc),   // описание покупаемого уровня (с итогом), иначе общий
    style: {
      fontFamily: FONT, fontSize: 15, fontWeight: '600', fill: COLORS.ink,
      align: 'center', wordWrap: true, wordWrapWidth: W - 48, lineHeight: 20,
    },
  });
  desc.anchor.set(0.5, 0);
  desc.position.set(W / 2, y); items.push(desc);
  y += desc.height + 16;

  const priceText = extraCoins > 0 ? t(`Цена: ${curGlyph} ${cost} + 💰 ${extraCoins}`, `Price: ${curGlyph} ${cost} + 💰 ${extraCoins}`) : t(`Цена: ${curGlyph} ${cost}`, `Price: ${curGlyph} ${cost}`);
  const price = label(priceText, 17, afford ? curColor : COLORS.warn, '800');
  price.position.set(W / 2, y); items.push(price); y += 24;
  const balText = extraCoins > 0
    ? t(`У вас: ${curGlyph} ${fmt(balance)} · 💰 ${fmt(ctx.state.coins)}`, `You have: ${curGlyph} ${fmt(balance)} · 💰 ${fmt(ctx.state.coins)}`)
    : t(`У вас: ${curGlyph} ${fmt(balance)}`, `You have: ${curGlyph} ${fmt(balance)}`);
  const bal = label(balText, 13, COLORS.inkSoft, '700');
  bal.position.set(W / 2, y); items.push(bal); y += 30;

  const pad = 24, gap = 12;
  const bw = (W - pad * 2 - gap) / 2;
  const noBtn = new Button({ text: t('Отмена', 'Cancel'), w: bw, h: 50, color: COLORS.cardEdge, textColor: COLORS.ink, fontSize: 16 });
  noBtn.onTap = close;
  noBtn.position.set(pad + bw / 2, y + 25);
  const buyBtn = new Button({ text: afford ? t('Купить', 'Buy') : t('Не хватает', 'Not enough'), w: bw, h: 50, color: curColor, fontSize: 16 });
  buyBtn.enabled = afford;
  buyBtn.onTap = () => {
    const r = unlockResearch(ctx.state, def.id);
    if (!r.ok) {
      ctx.toast(
        r.reason === 'locked' ? t('Улучшения ещё заперты 🔒', 'Upgrades are still locked 🔒')
          : r.reason === t('не хватает ДНК', 'not enough DNA') ? t('Не хватает 🧬 ДНК', 'Not enough 🧬 DNA')
            : r.reason === t('не хватает монет', 'not enough coins') ? t('Не хватает 💰 монет', 'Not enough 💰 coins') : r.reason,
      );
      return;
    }
    ctx.commit();
    const lvlNow = researchLevel(ctx.state, def.id);
    ctx.toast(total > 1 ? t(`${def.glyph} ${tx(def.title)} · ур. ${lvlNow}/${total} ✅`, `${def.glyph} ${tx(def.title)} · lv. ${lvlNow}/${total} ✅`)
      : t(`${def.glyph} ${tx(def.title)} изучено ✅`, `${def.glyph} ${tx(def.title)} researched ✅`));
    close();
  };
  buyBtn.position.set(pad + bw + gap + bw / 2, y + 25);
  items.push(noBtn, buyBtn);
  y += 60;

  root.addChild(panel(W, y, COLORS.hud, 18), ...items);
  return root;
}

/**
 * Табличка котёнка: пока малыш не вырос — порода, редкость и шкала времени до
 * взросления (заполняется в реальном времени). Имя/пол и действия вязки скрыты,
 * проявятся, когда котёнок повзрослеет. По взрослении карточка сама переключится.
 */
type AddBtn = (text: string, color: number, enabled: boolean, onTap: () => void) => void;

/**
 * Кнопки переезда кота между комнатами. Кот, стоящий в слоте вязки, относится
 * к обеим комнатам сразу — показываем обе кнопки; иначе одну (в ту комнату, где
 * кота сейчас нет). addBtn — помощник конкретной карточки (он же двигает y вниз).
 */
function addMoveButtons(ctx: UiContext, cat: Cat, close: () => void, addBtn: AddBtn): void {
  const inSlot = isInSlot(ctx.state, cat.id);
  const move = (room: LiveRoom, text: string, color: number): void => {
    addBtn(text, color, true, () => {
      const r = moveCat(ctx.state, cat.id, room);
      if (!r.ok) { ctx.toast(r.reason); return; }
      clearBreederSlot(ctx.state, cat.id); // если стоял в слоте — снять со слота
      close(); ctx.commit();
      ctx.toast(room === 'nursery' ? t('Котик в питомнике 🏆', 'The cat is in the cattery 🏆') : t('Котик в приюте 🏚️', 'The cat is in the shelter 🏚️'));
    });
  };
  if (inSlot || cat.location === 'shelter') move('nursery', t('🏠 В питомник', '🏠 To the cattery'), COLORS.primary);
  if (inSlot || cat.location === 'nursery') move('shelter', t('🏚️ В приют', '🏚️ To the shelter'), COLORS.secondary);
}

/**
 * Кнопка «в добрые руки» для кота, стоящего в слоте вязки (родитель или «малыш с
 * роднёй»). Такого кота нет на полу комнаты, значит его не перетащить на переноску
 * Приюта — пристраиваем прямо из меню. Диалог и награда те же (openAdoptConfirm →
 * adoptCat), кот при этом освобождает слот (см. removeCat). Занятого активной
 * вязкой не отдаём — его и adoptCat не пустит.
 */
function addAdoptButton(ctx: UiContext, cat: Cat, addBtn: AddBtn): void {
  if (!isInSlot(ctx.state, cat.id) || isBusy(ctx.state, cat.id)) return;
  addBtn(t('🤝 В добрые руки', '🤝 Give away'), COLORS.good, true, () => ctx.openAdoptConfirm(cat));
}

function buildKittenCard(ctx: UiContext, cat: Cat, close: () => void): Container {
  const W = 340;
  const root = new Container();
  const tierCol = TIER_COLOR[cat.rarityTier];

  const title = label(stackWords(breedName(cat.breed)), 19, tierCol, '800');
  title.anchor.set(0.5, 0);
  title.position.set(W / 2, 16);

  let y = 16 + title.height + 16;
  const st = stars(cat.rarityTier, 15);
  st.position.set(W / 2, y); y += 22;
  const tierT = label(t(`🍼 котёнок · ${tierName(cat.rarityTier)}`, `🍼 kitten · ${tierName(cat.rarityTier)}`), 13, tierCol, '800');
  tierT.position.set(W / 2, y); y += 22;
  const hint = label(t('пол и имя проявятся, когда подрастёт 🌱', 'sex and name appear once it grows up 🌱'), 12, COLORS.inkSoft, '600');
  hint.position.set(W / 2, y); y += 24;

  // шкала взросления (заполняется в реальном времени)
  const barW = W - 60, barH = 14, barX = (W - barW) / 2, barY = y;
  const barBg = new Graphics();
  barBg.roundRect(barX, barY, barW, barH, 7).fill({ color: 0x000000, alpha: 0.08 });
  const bar = new Graphics();
  const timeT = label('', 13, COLORS.ink, '700');
  timeT.position.set(W / 2, barY + barH + 16);
  y = barY + barH + 34;

  // Кнопки: родословная (если известны родители) + переезд (в слоте — обе
  // комнаты) + закрыть. Малыш не занимает место навсегда — его можно переселить.
  const controls: Container[] = [];
  const btnW = W - 60;
  const addBtn: AddBtn = (text, color, _enabled, onTap) => {
    const b = new Button({ text, w: btnW, h: 42, color, fontSize: 15 });
    b.position.set(W / 2, y + 21);
    b.onTap = onTap;
    controls.push(b);
    y += 50;
  };

  if (cat.motherBreed || cat.fatherBreed) {
    addBtn(t('🌳 Родословная', '🌳 Pedigree'), COLORS.secondary, true, () => ctx.openPedigree(cat));
  }

  // Ускорение роста: одно подменю «Вырастить сейчас» — там выбор 📺 реклама или 💎 кристаллы.
  addBtn(t('🌱 Вырастить сейчас', '🌱 Grow up now'), COLORS.primary, true, () => ctx.openGrowConfirm(cat));

  addMoveButtons(ctx, cat, close, addBtn);
  addAdoptButton(ctx, cat, addBtn); // малыша из окошка вязки можно сразу пристроить

  const closeBtn = new Button({ text: t('Закрыть', 'Close'), w: btnW, h: 40, color: COLORS.cardEdge, textColor: COLORS.ink, fontSize: 14 });
  closeBtn.position.set(W / 2, y + 20);
  closeBtn.onTap = close;
  y += 50;

  root.addChild(panel(W, y, COLORS.hud, 18), title, st, tierT, hint, barBg, bar, timeT, ...controls, closeBtn);

  const mmss = (ms: number): string => {
    const s = Math.max(0, Math.ceil(ms / 1000));
    return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
  };
  const redraw = (): void => {
    const p = growthProgress(cat, ctx.now());
    bar.clear();
    bar.roundRect(barX, barY, Math.max(2, barW * p), barH, 7).fill(COLORS.primary);
    timeT.text = t(`до взросления: ${mmss(growthRemainingMs(cat, ctx.now()))}`, `grows up in: ${mmss(growthRemainingMs(cat, ctx.now()))}`);
  };
  redraw();
  // живое обновление шкалы; как только вырос — переоткрываем как взрослого
  const fn = (): void => {
    if (!root.parent) { ctx.app.ticker.remove(fn); return; }
    if (isAdult(cat, ctx.now())) { ctx.app.ticker.remove(fn); close(); ctx.openCatMenu(cat); return; }
    redraw();
  };
  ctx.app.ticker.add(fn);

  return root;
}

/**
 * Подменю «Вырастить сейчас» котёнка (из инфо-меню). Два пути ускорения роста:
 * 📺 реклама (−N мин, бесплатно, повторяемо) и 💎 кристаллы (мгновенно, цена ∝ остатку
 * роста, ставка GROWTH_SPEEDUP_CRYSTAL_PER_MIN). После действия переоткрываем меню кота:
 * если ещё котёнок — снова его карточка, если вырос — меню взрослого.
 */
export function buildGrowConfirm(ctx: UiContext, cat: Cat, close: () => void): Container {
  const W = 320;
  const root = new Container();

  const title = label(t('🌱 Вырастить сейчас', '🌱 Grow up now'), 18, COLORS.ink, '800');
  title.position.set(W / 2, 28);

  const sp = catSprite(ctx.app, cat, 84);
  sp.position.set(W / 2, 118);

  const remain = growthRemainingMs(cat, ctx.now());
  const mm = Math.max(0, Math.ceil(remain / 60_000));
  const sub = label(t(`до взросления ≈ ${mm} мин`, `grows up in ≈ ${mm} min`), 13, COLORS.inkSoft, '700');
  sub.position.set(W / 2, 162);

  let y = 186;
  root.addChild(title, sp, sub);

  const btnW = W - 48;
  const adBtn = new Button({
    text: t('📺 Реклама · вырастить бесплатно', '📺 Ad · grow up for free'), w: btnW, h: 44,
    color: COLORS.good, textColor: 0xffffff, fontSize: 14,
  });
  adBtn.position.set(W / 2, y + 22);
  adBtn.onTap = () => {
    void showRewarded().then((watched) => {
      if (!watched) { ctx.toast(t('Реклама недоступна', 'Ad unavailable')); return; }
      const r = adSkipGrowth(ctx.state, cat.id, ctx.now());
      if (!r.ok) { ctx.toast(r.reason); return; }
      ctx.commit(); close(); ctx.openCatMenu(cat);
    });
  };
  root.addChild(adBtn);
  y += 52;

  const gcost = speedUpCost(remain, GROWTH_SPEEDUP_CRYSTAL_PER_MIN);
  const afford = ctx.state.crystals >= gcost;
  const crysBtn = new Button({
    text: t(`💎 Вырастить сразу · ${gcost}`, `💎 Grow up instantly · ${gcost}`), w: btnW, h: 44,
    color: afford ? COLORS.secondary : COLORS.cardEdge,
    textColor: afford ? 0xffffff : COLORS.inkSoft, fontSize: 15,
  });
  crysBtn.enabled = afford;
  crysBtn.position.set(W / 2, y + 22);
  crysBtn.onTap = () => {
    const r = speedUpGrowth(ctx.state, cat.id, ctx.now());
    if (!r.ok) { ctx.toast(r.reason); return; }
    ctx.commit(); close(); ctx.openCatMenu(cat);
  };
  root.addChild(crysBtn);
  y += 52;

  const closeBtn = new Button({ text: t('Закрыть', 'Close'), w: btnW, h: 40, color: COLORS.cardEdge, textColor: COLORS.ink, fontSize: 14 });
  closeBtn.position.set(W / 2, y + 20);
  closeBtn.onTap = close;
  root.addChild(closeBtn);
  y += 50;

  root.addChildAt(panel(W, y, COLORS.hud, 18), 0);
  return root;
}

/**
 * Дерево родословной кота: колонки-поколения слева направо
 * (сам кот → родители → деды → прадеды). Туман родословной: рисуются только
 * ИЗВЕСТНЫЕ узлы (known), неизвестный предок — серая ячейка «???» без намёка на
 * тир, его поддерево не раскрывается. Вскрыть всё — Генетический анализ (кнопка
 * внизу). Если столбцы не влезают — Game вписывает панель в экран (showOverlay).
 */
export function buildPedigreePanel(ctx: UiContext, cat: Cat, close: () => void): Container {
  const root = new Container();

  const ped = catAncestors(cat);
  const subject: Ancestor = { id: cat.id, breed: cat.breed, known: true, mother: ped.mother, father: ped.father };
  const maxDepth = PEDIGREE_DEPTH; // 0=кот, 1=родители, 2=деды, 3=прадеды

  // геометрия ячеек/колонок; на таче (k=1.2) весь чертёж крупнее — ячейки И текст
  // растут вместе, чтобы длинные названия пород не вылезали. На ПК k=1 (без изменений).
  // Панель всё равно вписывается в экран (fitOverlay), так что полное 4-поколенное
  // дерево на узком экране ужмётся как раньше, а короткие деревья станут читаемее.
  const k = UI_SCALE;
  const cellW = 108 * k, cellH = 42 * k, colGap = 16 * k, rowGap = 9 * k;
  const slotH = cellH + rowGap;
  const padX = 16 * k, padTop = 64 * k, headerY = 46 * k;
  const colX = (d: number): number => padX + d * (cellW + colGap) + cellW / 2;

  type Placed = { node: Ancestor; depth: number; x: number; y: number; isRoot: boolean };
  const placed: Placed[] = [];
  const links: Array<[number, number, number, number]> = []; // x1,y1,x2,y2
  let leafIndex = 0;
  let usedDepth = 0;

  const layout = (node: Ancestor, depth: number, isRoot: boolean): number => {
    usedDepth = Math.max(usedDepth, depth);
    const kids: Ancestor[] = [];
    // в поддерево неизвестного узла не заглядываем — «???» схлопывает ветку
    if (depth < maxDepth && node.known) {
      if (node.mother) kids.push(node.mother);
      if (node.father) kids.push(node.father);
    }
    let y: number;
    if (kids.length === 0) {
      y = padTop + (leafIndex + 0.5) * slotH;
      leafIndex++;
    } else {
      const ys = kids.map((k) => layout(k, depth + 1, false));
      y = ys.reduce((a, b) => a + b, 0) / ys.length;
      for (const cy of ys) links.push([colX(depth) + cellW / 2, y, colX(depth + 1) - cellW / 2, cy]);
    }
    placed.push({ node, depth, x: colX(depth), y, isRoot });
    return y;
  };
  layout(subject, 0, true);

  const W = padX * 2 + (usedDepth + 1) * cellW + usedDepth * colGap;
  const treeBottom = padTop + leafIndex * slotH;
  const known = pedigreeDepth(cat); // поколений предков в данных (включая туман)
  const fog = pedigreeHasFog(cat);  // есть ли скрытые узлы — предложим анализ

  // соединители (рисуем под ячейками)
  const wires = new Graphics();
  for (const [x1, y1, x2, y2] of links) {
    const midX = (x1 + x2) / 2;
    wires.moveTo(x1, y1).lineTo(midX, y1).lineTo(midX, y2).lineTo(x2, y2);
  }
  wires.stroke({ width: 1.5, color: COLORS.cardEdge, alpha: 0.9 });

  // ячейка-предок: рамка в цвет тира + точка тира + имя породы (с переносом);
  // узел в тумане — серый «🔒 ???» БЕЗ цвета тира (не подсказываем редкость)
  const cell = (p: Placed): Container => {
    const c = new Container();
    const hidden = !p.isRoot && !p.node.known;
    const col = hidden ? COLORS.cardEdge : TIER_COLOR[tierOfBreed(p.node.breed)];
    const g = new Graphics();
    g.roundRect(-cellW / 2, -cellH / 2, cellW, cellH, 9)
      .fill({ color: p.isRoot ? COLORS.card : COLORS.hud, alpha: hidden ? 0.7 : 1 })
      .stroke({ width: p.isRoot ? 3 : 2, color: col, alpha: hidden ? 0.8 : 0.95 });
    g.circle(-cellW / 2 + 11 * k, 0, 4 * k).fill({ color: col });
    const name = hidden ? '🔒 ???'
      : p.isRoot ? (cat.name?.trim() || breedName(p.node.breed)) : breedName(p.node.breed);
    const t = new Text({
      text: name,
      style: {
        fontFamily: FONT, fontSize: 11 * k, fontWeight: '700', fill: hidden ? COLORS.inkSoft : COLORS.ink,
        wordWrap: true, breakWords: true, wordWrapWidth: cellW - 26 * k, lineHeight: 12 * k, align: 'center',
      },
    });
    t.anchor.set(0.5);
    t.position.set(5 * k, 0);
    c.addChild(g, t);
    c.position.set(p.x, p.y);
    return c;
  };

  // заголовки колонок поколений
  const COL_RU = ['', t('родители', 'parents'), t('деды', 'grandparents'), t('прадеды', 'great-grandparents')];
  const headers: Container[] = [];
  for (let d = 1; d <= usedDepth; d++) {
    const h = label(COL_RU[d] ?? '', 12, COLORS.inkSoft, '800');
    h.position.set(colX(d), headerY);
    headers.push(h);
  }

  const title = label(t('🌳 Родословная', '🌳 Pedigree'), 18, COLORS.ink, '800');
  title.position.set(W / 2, 26 * k);

  let y = treeBottom + 8;
  const footer: Container[] = [];
  const footNote = (text: string, color: number): void => {
    const t = new Text({
      text,
      style: {
        fontFamily: FONT, fontSize: 11 * k, fontWeight: '600', fill: color,
        align: 'center', wordWrap: true, wordWrapWidth: W - 28 * k, lineHeight: 15 * k,
      },
    });
    t.anchor.set(0.5, 0);
    t.position.set(W / 2, y + 2);
    footer.push(t);
    y += t.height + 8;
  };

  if (cat.analyzed) {
    // анализ сделан: показываем «скрытые гены» как признаки, дремлющие в родословной
    // (есть у предков, но не у самой породы кота) — материал родословных рецептов.
    const hidden = dormantTraits(cat.breed, knownAncestorBreeds(cat));
    footNote(
      hidden.length > 0
        ? t(`🧬 скрытые гены: ${hidden.map(traitTag).join(' · ')}`, `🧬 hidden genes: ${hidden.map(traitTag).join(' · ')}`)
        : t('🧬 скрытых генов в роду нет — родословная чистая по признакам', '🧬 no hidden genes in the line — the pedigree is clean'),
      hidden.length > 0 ? COLORS.ink : COLORS.inkSoft,
    );
  } else if (fog) {
    footNote(t('узлы «???» скрыты — Генетический анализ вскроет всю родословную и скрытые гены', '«???» nodes are hidden — a Genetic analysis reveals the whole pedigree and its hidden genes'), COLORS.inkSoft);
    const anBtn = new Button({ text: t('🧬 Анализ', '🧬 Analyse'), w: 170, h: 40, color: COLORS.dna, fontSize: 14 });
    anBtn.position.set(W / 2, y + 20);
    anBtn.onTap = () => ctx.openAnalyzeConfirm(cat);
    footer.push(anBtn);
    y += 48;
  }
  if (known < maxDepth) {
    footNote(t('родословная пополняется с каждым поколением', 'the pedigree grows with every generation'), COLORS.inkSoft);
  }

  const closeBtn = new Button({ text: t('Закрыть', 'Close'), w: 160, h: 40, color: COLORS.cardEdge, textColor: COLORS.ink, fontSize: 14 });
  closeBtn.position.set(W / 2, y + 24);
  closeBtn.onTap = close;
  y += 44;

  const H = y;
  root.addChild(panel(W, H, COLORS.hud, 18), title, ...headers, wires);
  for (const p of placed) root.addChild(cell(p));
  root.addChild(...footer, closeBtn);
  return root;
}

/**
 * Подтверждение Генетического анализа (система знаний, этап B): вскрывает СРАЗУ
 * всю родословную кота и его скрытые гены (породы предков). Механику не меняет —
 * скрытые гены работали и до анализа. Оплата 💰 (цена по тиру) или 📺 (без кулдауна);
 * самый первый анализ новичку достаётся подарком обучения (см. freeAnalyzeCat).
 * После успеха открывает родословную — показать игроку, что он купил.
 */
export function buildAnalyzeConfirm(ctx: UiContext, cat: Cat, close: () => void): Container {
  const W = 340;
  const root = new Container();

  const title = label(t('🧬 Генетический анализ', '🧬 Genetic analysis'), 18, COLORS.ink, '800');
  title.position.set(W / 2, 28);
  const sub = label(t('вскроет родословную и скрытые гены', 'reveals the pedigree and hidden genes'), 12.5, COLORS.inkSoft, '700');
  sub.position.set(W / 2, 50);

  const sp = catSprite(ctx.app, cat, 84);
  sp.position.set(W / 2, 158);
  const who = label(cat.name?.trim() || describeCat(cat), 14, TIER_COLOR[cat.rarityTier], '800');
  who.position.set(W / 2, 180);

  const note = new Text({
    text: t('Знание не меняет исход вязок — скрытые гены работали и в тумане. ', 'Knowing changes no outcome — hidden genes worked in the fog too. ')
      + t('Анализ раскрывает родословную и признаки предков для рецептов и превью пары.', 'The analysis reveals ancestors and their traits for recipes and the pair forecast.'),
    style: {
      fontFamily: FONT, fontSize: 11.5, fontWeight: '600', fill: COLORS.inkSoft,
      align: 'center', wordWrap: true, wordWrapWidth: W - 48, lineHeight: 16,
    },
  });
  note.anchor.set(0.5, 0);
  note.position.set(W / 2, 200);

  let y = 200 + note.height + 14;
  root.addChild(title, sub, sp, who, note);

  const btnW = W - 48;
  const done = (): void => { ctx.commit(); ctx.toast(t('Анализ готов 🧬 родословная вскрыта', 'Analysis done 🧬 pedigree revealed')); close(); ctx.openPedigree(cat); };

  // Подарок обучения: САМЫЙ ПЕРВЫЙ анализ бесплатный (см. freeAnalyzeCat) — новичок
  // должен увидеть, что именно даёт анализ, прежде чем платить за него 💰 или 📺.
  // Пока подарок цел, платные варианты не показываем: одно очевидное действие.
  const gift = tutorialActive(ctx.state) && !ctx.state.tutorial.freeAnalyzeUsed && !cat.analyzed;
  if (gift) {
    const freeBtn = new Button({
      text: t('🎁 Бесплатно — подарок лаборатории', '🎁 Free — a gift from the lab'),
      w: btnW, h: 44, color: COLORS.warn, textColor: COLORS.ink, fontSize: 14,
    });
    freeBtn.position.set(W / 2, y + 22);
    freeBtn.onTap = () => {
      const r = freeAnalyzeCat(ctx.state, cat.id);
      if (!r.ok) { ctx.toast(r.reason); return; }
      done();
    };
    root.addChild(freeBtn);
    y += 52;
  } else {
    // 💰 основная цена — по тиру кота (породистого анализировать дороже)
    const cost = analyzeCoinCost(cat.rarityTier);
    const afford = ctx.state.coins >= cost;
    const coinBtn = new Button({
      text: t(`💰 Провести анализ · ${cost}`, `💰 Run the analysis · ${cost}`),
      w: btnW, h: 44, color: afford ? COLORS.primary : COLORS.cardEdge,
      textColor: afford ? 0xffffff : COLORS.inkSoft, fontSize: 15,
    });
    coinBtn.enabled = afford;
    coinBtn.position.set(W / 2, y + 22);
    coinBtn.onTap = () => {
      const r = analyzeCat(ctx.state, cat.id, 'coins', ctx.now());
      if (!r.ok) { ctx.toast(r.reason); return; }
      done();
    };
    root.addChild(coinBtn);
    y += 52;

    // 📺 бесплатная альтернатива (кулдауна больше нет — анализ инфо-действие)
    const adBtn = new Button({
      text: t('📺 Бесплатно за рекламу', '📺 Free for an ad'),
      w: btnW, h: 44, color: COLORS.good, textColor: 0xffffff, fontSize: 15,
    });
    adBtn.position.set(W / 2, y + 22);
    adBtn.onTap = () => {
      void showRewarded().then((watched) => {
        if (!watched) { ctx.toast(t('Реклама недоступна', 'Ad unavailable')); return; }
        const r = analyzeCat(ctx.state, cat.id, 'ad', ctx.now());
        if (!r.ok) { ctx.toast(r.reason); return; }
        done();
      });
    };
    root.addChild(adBtn);
    y += 52;
  }

  const closeBtn = new Button({ text: t('Закрыть', 'Close'), w: btnW, h: 40, color: COLORS.cardEdge, textColor: COLORS.ink, fontSize: 14 });
  closeBtn.position.set(W / 2, y + 20);
  closeBtn.onTap = close;
  root.addChild(closeBtn);
  y += 50;

  root.addChildAt(panel(W, y, COLORS.hud, 18), 0);
  return root;
}

/**
 * Карточка породы из Котодекса-рецептурника: портрет (цветной у выведенной,
 * чёрный силуэт у известной только рецептом) + рецепты с условиями и шансами.
 * Открывается тапом по изученной клетке Котодекса.
 */
export function buildBreedCard(ctx: UiContext, breedKey: string, close: () => void): Container {
  const W = 400;
  const root = new Container();
  const tier = tierOfBreed(breedKey);
  const tierCol = TIER_COLOR[tier];
  const opened = breedDiscovered(ctx.state, breedKey);

  const title = label(stackWords(breedName(breedKey)), 19, tierCol, '800');
  title.anchor.set(0.5, 0);
  title.position.set(W / 2, 18);
  root.addChild(title);
  let y = 18 + title.height + 8;

  const st = stars(tier, 15);
  st.position.set(W / 2, y);
  root.addChild(st);
  y += 20;
  const tierT = label(tierName(tier), 12.5, tierCol, '800');
  tierT.position.set(W / 2, y);
  root.addChild(tierT);
  y += 16;

  // портрет породы; не выведена (известен только рецепт) → чёрный силуэт по форме
  const boxH = 110;
  const tex = breedThumbTexture(breedKey);
  if (tex) {
    const sp = new Sprite(tex);
    sp.anchor.set(0.5, 1);
    sp.scale.set(Math.min((boxH * 0.95) / tex.height, (W * 0.5) / tex.width));
    sp.position.set(W / 2, y + boxH);
    if (!opened) sp.tint = 0x241d29; // силуэт: форма породы без окраса
    root.addChild(sp);
  }
  y += boxH + 12;

  const status = label(
    opened ? t('✅ порода выведена', '✅ breed obtained') : t('📜 рецепт изучен — порода ещё не выведена', '📜 recipe known — breed not obtained yet'),
    12.5, opened ? COLORS.good : COLORS.inkSoft, '800',
  );
  status.position.set(W / 2, y);
  root.addChild(status);
  y += 24;

  // Рецепты породы: у выведенной — все, у силуэта — только открытые исследованием.
  const recipes = knownRecipesFor(ctx.state, breedKey);
  const addLine = (text: string, size: number, color: number, weight: '600' | '700' | '800', indent = 24): number => {
    const t = new Text({
      text,
      style: {
        fontFamily: FONT, fontSize: size, fontWeight: weight, fill: color,
        wordWrap: true, wordWrapWidth: W - indent - 20, lineHeight: size + 4, align: 'left',
      },
    });
    t.anchor.set(0, 0);
    t.position.set(indent, y);
    root.addChild(t);
    y += t.height + 3;
    return t.height;
  };

  // Энциклопедическая справка о породе (происхождение / факт / главная черта).
  const desc = breedDescription(breedKey);
  if (desc) {
    addLine(`📖 ${desc}`, 12, COLORS.ink, '700');
    y += 8;
  }

  if (recipes.length === 0) {
    addLine(breedKey === 'moggie'
      ? t('🐾 Стартовая порода: дворовых котов покупают в питомнике, рецепт не нужен.', '🐾 Starter breed: moggies are bought in the cattery, no recipe needed.')
      : t('🐾 Рецептов у породы нет.', '🐾 This breed has no recipes.'), 12.5, COLORS.inkSoft, '600');
  }
  recipes.forEach((r, i) => {
    if (i > 0) {
      const div = new Graphics();
      div.moveTo(24, y + 3).lineTo(W - 24, y + 3).stroke({ width: 1, color: COLORS.cardEdge, alpha: 0.8 });
      root.addChild(div);
      y += 10;
    }
    // Единый формат карточки: родители → условия (скрытые гены/пол/родословная,
    // инбридинг) → базовый шанс. Справка о породе — выше, над рецептами.
    const { pair, conds } = describeRecipe(r);
    addLine(`🧪 ${pair}`, 13.5, COLORS.ink, '800');
    if (conds.length === 0) addLine(t('· без доп. условий — только породы родителей', '· no extra conditions — parent breeds only'), 11.5, COLORS.inkSoft, '700');
    for (const cLine of conds) addLine(`· ${cLine}`, 11.5, COLORS.inkSoft, '700');
    addLine(t(`базовый шанс: ${pct(r.chance)}`, `base chance: ${pct(r.chance)}`), 12, COLORS.dna, '800');
    y += 4;
  });
  y += 6;

  const closeBtn = new Button({ text: t('Закрыть', 'Close'), w: 180, h: 40, color: COLORS.cardEdge, textColor: COLORS.ink, fontSize: 14 });
  closeBtn.position.set(W / 2, y + 20);
  closeBtn.onTap = close;
  root.addChild(closeBtn);
  y += 50;

  root.addChildAt(panel(W, y, COLORS.hud, 18), 0);
  return root;
}

/**
 * Превью пары «тир-тизер» (этап E системы знаний): распределение исходов вязки —
 * последовательные шансы рецептов + фолбэк-наследование (breedingOutcomes, та же
 * математика, что при рождении). Раскрытый исход показывает породу; нераскрытый —
 * только «❓ тир — X%»: рецепт надо открыть в Котодексе, а скрытые гены пары
 * вскрыть анализом. Активный усилитель-фильтр (🍀/⬇) и бонусы «Селекции» учтены.
 */
export function buildPairPreview(ctx: UiContext, mother: Cat, father: Cat, close: () => void): Container {
  const W = 380;
  const root = new Container();

  const bctx = buildBreedingContext(mother, father);
  // Отсев пород усилителем учитываем только когда он АКТИВЕН (склад ≠ активность): заряд
  // на складе при другом активном усилителе на вязку не влияет — превью не должно врать.
  const lucky = activeBoostId(ctx.state) === 'luckyUp';   // 🍀 остаются только цветные
  const degrade = activeBoostId(ctx.state) === 'degrade'; // ⬇ остаются только серые
  const outcomes = breedingOutcomes(bctx, lucky, breedChanceMult(ctx.state), degrade);

  const title = label(t('🔮 Прогноз пары', '🔮 Pair forecast'), 18, COLORS.ink, '800');
  title.position.set(W / 2, 28);
  root.addChild(title);
  // Самец первым; если пара не влезает в одну строку блока — самка переносится
  // на новую строку (× остаётся хвостом у самца как связка).
  const maleStr = `${father.name?.trim() || breedName(father.breed)} ♂`;
  const femaleStr = `${mother.name?.trim() || breedName(mother.breed)} ♀`;
  const who = label(`${maleStr} × ${femaleStr}`, 12.5, COLORS.inkSoft, '700');
  const twoLineWho = who.width > W - 40;
  if (twoLineWho) who.text = `${maleStr} ×\n${femaleStr}`;
  who.position.set(W / 2, twoLineWho ? 56 : 50);
  root.addChild(who);

  let y = who.y + who.height / 2 + 12;
  if (bctx.kinship !== 'none') {
    const kin = label(t(`⚠️ родство: ${kinshipName(bctx.kinship)} — родословные рецепты усилены`, `⚠️ kinship: ${kinshipName(bctx.kinship)} — pedigree recipes are boosted`), 11.5,
      bctx.kinship === 'critical' ? COLORS.warn : COLORS.inkSoft, '800');
    kin.position.set(W / 2, y);
    root.addChild(kin);
    y += 20;
  }
  if (lucky) {
    const lk = label(t('🍀 Катализатор активен — серые породы исключены', '🍀 Catalyst is active — grey breeds are excluded'), 11.5, COLORS.good, '800');
    lk.position.set(W / 2, y);
    root.addChild(lk);
    y += 20;
  }
  if (degrade) {
    const dg = label(t('⬇ Деградатор активен — цветные породы исключены', '⬇ Degrader is active — coloured breeds are excluded'), 11.5, COLORS.good, '800');
    dg.position.set(W / 2, y);
    root.addChild(dg);
    y += 20;
  }
  // 🔼 Активатор активен и у пары есть цель — гарантия вместо броска шансов.
  // Название породы уважает туман знаний: нераскрытый рецепт покажет только тир.
  const guaranteed = activeBoostId(ctx.state) === 'tierUp' ? tierUpTarget(bctx) : undefined;
  if (guaranteed) {
    const gOutcome = outcomes.find((o) => o.recipe && o.breed === guaranteed);
    const gRevealed = !gOutcome?.recipe || outcomeRevealed(ctx.state, mother, father, gOutcome.recipe);
    const gl = label(
      gRevealed
        ? t(`🔼 Активатор гарантирует: ${breedName(guaranteed)}`, `🔼 Activator guarantees: ${breedName(guaranteed)}`)
        : t(`🔼 Активатор гарантирует: ❓ ${tierName(tierOfBreed(guaranteed))}`, `🔼 Activator guarantees: ❓ ${tierName(tierOfBreed(guaranteed))}`),
      11.5, COLORS.good, '800',
    );
    gl.position.set(W / 2, y);
    root.addChild(gl);
    y += 20;
  }
  y += 6;

  // строки исходов: 🧪 рецепты (редкие первыми — как бросает игра), затем 🐾 фолбэк
  let anyHidden = false;
  for (const o of outcomes) {
    const revealed = !o.recipe || outcomeRevealed(ctx.state, mother, father, o.recipe);
    if (!revealed) anyHidden = true;
    const tierO = tierOfBreed(o.breed);
    const name = revealed
      ? `${o.recipe ? '🧪' : '🐾'} ${breedName(o.breed)}`
      : `🧪 ❓ ${tierName(tierO)}`;
    const nameT = label(name, 13.5, revealed ? TIER_COLOR[tierO] : COLORS.inkSoft, '800');
    nameT.anchor.set(0, 0.5);
    nameT.position.set(28, y + 9);
    const pctT = label(pct(o.p), 13.5, COLORS.ink, '800');
    pctT.anchor.set(1, 0.5);
    pctT.position.set(W - 28, y + 9);
    root.addChild(nameT, pctT);
    y += 24;
  }
  y += 4;

  const legend = label(t('🧪 рецепт · 🐾 наследование породы', '🧪 recipe · 🐾 breed inheritance'), 11, COLORS.inkSoft, '600');
  legend.position.set(W / 2, y + 6);
  root.addChild(legend);
  y += 20;

  if (anyHidden) {
    const hint = new Text({
      text: t('🧬 Генетический анализ обоих котов + рецепт в Котодексе раскроют названия «❓» исходов', '🧬 Analyse both cats and learn the recipe in the Catdex to reveal the «❓» outcomes'),
      style: {
        fontFamily: FONT, fontSize: 11, fontWeight: '600', fill: COLORS.inkSoft,
        align: 'center', wordWrap: true, wordWrapWidth: W - 40, lineHeight: 15,
      },
    });
    hint.anchor.set(0.5, 0);
    hint.position.set(W / 2, y + 2);
    root.addChild(hint);
    y += hint.height + 10;
  }

  const closeBtn = new Button({ text: t('Закрыть', 'Close'), w: 180, h: 40, color: COLORS.cardEdge, textColor: COLORS.ink, fontSize: 14 });
  closeBtn.position.set(W / 2, y + 22);
  closeBtn.onTap = close;
  root.addChild(closeBtn);
  y += 52;

  root.addChildAt(panel(W, y, COLORS.hud, 18), 0);
  return root;
}

/** Меню действий над котом. */
export function buildCatMenu(ctx: UiContext, cat: Cat, close: () => void): Container {
  if (!isAdult(cat, ctx.now())) return buildKittenCard(ctx, cat, close);
  const W = 380;
  const root = new Container();
  const busy = isBusy(ctx.state, cat.id);

  const traits = catTraits(cat);
  // +22 — запас на перенос длинной строки «признаки: …» (визитка породы)
  const H = 150 + traits.length * 20 + 22 + (busy ? 28 : 0) + 4 * 54;
  root.addChild(panel(W, H, COLORS.hud, 18));

  const named = cat.name?.trim();
  // Заголовок переносится по словам и не вылезает за карточку (длинные названия
  // пород); двусловное имя — в две строки. Привязка по верху — сдвигаем y на высоту.
  const title = new Text({
    text: named ? stackWords(named) : describeCat(cat),
    style: {
      fontFamily: FONT, fontSize: 17, fontWeight: '800',
      fill: named ? TIER_COLOR[cat.rarityTier] : COLORS.ink,
      align: 'center', wordWrap: true, wordWrapWidth: W - 48, lineHeight: 21,
    },
  });
  title.anchor.set(0.5, 0);
  title.position.set(W / 2, 18);
  root.addChild(title);

  let y = 18 + title.height + 10;
  if (named) {
    const sub = label(describeCat(cat), 12, COLORS.inkSoft, '700');
    sub.position.set(W / 2, y);
    root.addChild(sub);
    y += 18;
  }

  const st = stars(cat.rarityTier, 15);
  st.position.set(W / 2, y);
  root.addChild(st);
  y += 26;

  // строка «Здоровье»: сердца = запас вязок кота (maxHearts, у инбридинговых
  // котят урезан) — потраченные закрашены чёрным (🖤), оставшиеся красные (❤️).
  // Исчерпал → статус «Старый»; родился без сердец → «Бесплодный».
  const total = heartsOf(cat);
  const left = breedsLeft(cat);
  const used = Math.max(0, total - left);
  const heartsStr = total > 0 ? '🖤'.repeat(used) + '❤️'.repeat(left) : '∅';
  const ageLabel = label(t('Здоровье ', 'Health ') + heartsStr, 14, COLORS.inkSoft, '700');
  ageLabel.position.set(W / 2, y);
  root.addChild(ageLabel);
  if (isOld(cat)) {
    const oldT = label(isSterile(cat) ? t('Бесплодный', 'Sterile') : t('Старый', 'Old'), 12, COLORS.warn, '800');
    oldT.anchor.set(0, 0.5);
    oldT.position.set(W / 2 + ageLabel.width / 2 + 8, y);
    root.addChild(oldT);
  }
  y += 26;

  // строки облика: перенос по словам, чтобы текст не вылезал за край меню
  for (const line of traits) {
    const t = new Text({
      text: line,
      style: {
        fontFamily: FONT, fontSize: 13, fontWeight: '600', fill: COLORS.inkSoft,
        wordWrap: true, wordWrapWidth: W - 56, lineHeight: 18, align: 'left',
      },
    });
    t.anchor.set(0, 0);
    t.position.set(28, y);
    root.addChild(t);
    y += t.height + 4;
  }
  y += 10;

  if (busy) {
    const note = label(t('💤 кот занят в вязке', '💤 the cat is busy breeding'), 14, COLORS.warn, '700');
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

  // Постановка на вязку: кнопкой «в свободный слот» (в группе «куда отправить кота»,
  // ниже) либо перетаскиванием — взять кота за шкирку и уронить на нужный слот
  // инкубатора. Переезд между комнатами — там же.
  addBtn(named ? t('✏️ Переименовать', '✏️ Rename') : t('✏️ Дать имя', '✏️ Give a name'), COLORS.warn, true, () => {
    askText(t('Имя котика:', 'Cat name:'), cat.name ?? '', 16, (input) => {
      if (input === null) return;               // отмена — ничего не делаем
      const r = renameCat(ctx.state, cat.id, input);
      if (!r.ok) { ctx.toast(r.reason); return; }
      ctx.commit();
      close();
      ctx.openCatMenu(cat);                      // переоткрыть с новым именем
    });
  });

  // Родословная: дерево предков до прадедов (есть и у стартовых — скрытая, в тумане).
  if (cat.motherBreed || cat.fatherBreed || cat.pedigree) {
    addBtn(t('🌳 Родословная', '🌳 Pedigree'), COLORS.secondary, true, () => ctx.openPedigree(cat));
  }

  // Генетический анализ (система знаний): вскрыть родословную и скрытые гены.
  if (!cat.analyzed && pedigreeHasFog(cat)) {
    addBtn(t('🧬 Генетический анализ', '🧬 Genetic analysis'), COLORS.dna, true, () => ctx.openAnalyzeConfirm(cat));
  }

  // Лечение (ветеринар-шприц) и заморозка (криокапсула) — только перетаскиванием кота
  // на соответствующую станцию в Питомнике (кнопок в меню кота больше нет, чтобы не
  // засорять список и держать действия у станций). См. rooms/nursery.ts.

  // Группа «куда отправить кота»: слот вязки + переезд между комнатами.
  // Слота нет у тех, кому в нём не место: занятый вязкой и тот, кто уже стоит в слоте.
  // «Старого»/«Бесплодного» пускаем: свести его нельзя, но именно в слоте его лечит
  // шприц-ветеринар (см. assignBreeder).
  if (!busy && !isInSlot(ctx.state, cat.id)) {
    addBtn(t('💞 В свободный слот вязки', '💞 To a free breeding slot'), COLORS.primary, true, () => {
      const idx = freeBreedSlot(ctx.state, cat);
      if (idx < 0) { ctx.toast(t('Нет свободных слотов вязки 💞 — освободи слот в Инкубаторе', 'No free breeding slots 💞 — clear one in the Incubator')); return; }
      const r = assignBreeder(ctx.state, idx, cat.id, ctx.now());
      if (!r.ok) { ctx.toast(r.reason); return; }
      close();
      ctx.commit();
      ctx.toast(cat.genotype.sex === 'female' ? t('Кошка в слоте 💞', 'The female is in a slot 💞') : t('Кот в слоте 💞', 'The male is in a slot 💞'));
      ctx.goRoom(0); // Инкубатор — всегда первый в ряду комнат (см. Game.layout)
    });
  }

  // Переезд между комнатами: в слоте вязки — обе кнопки, иначе одна (в комнату,
  // где кота нет). Занятого активной вязкой кота не двигаем — он breeding'ится.
  if (!busy) addMoveButtons(ctx, cat, close, addBtn);

  // Кот из слота вязки — ещё и «в добрые руки» (на полу для этого есть переноска).
  addAdoptButton(ctx, cat, addBtn);

  const closeBtn = new Button({ text: t('Закрыть', 'Close'), w: btnW, h: 40, color: COLORS.cardEdge, textColor: COLORS.ink, fontSize: 14 });
  closeBtn.position.set(W / 2, y + 20);
  closeBtn.onTap = close;
  root.addChild(closeBtn);
  y += 50;

  // фактическая высота могла отличаться — подгоним подложку (перерисуем)
  root.removeChildAt(0);
  root.addChildAt(panel(W, y, COLORS.hud, 18), 0);
  return root;
}

/**
 * Подтверждение пристройства: «Отдать котика в добрые руки?» + награда (💰 + 🧬)
 * и кнопки Да/Нет. Открывается, когда кота перетащили на переноску в Приюте.
 * Логика и суммы — те же, что были у кнопки в меню кота (adoptCat/adoptReward).
 */
export function buildAdoptConfirm(ctx: UiContext, cat: Cat, close: () => void): Container {
  const W = 340;
  const root = new Container();
  const { coins, dna } = adoptReward(ctx.state, cat);

  const title = label(t('Отдать котика в добрые руки?', 'Give the cat away to a good home?'), 18, COLORS.ink, '800');
  title.position.set(W / 2, 30);

  // мини-портрет + имя/описание кота
  const sp = catSprite(ctx.app, cat, 84);
  sp.position.set(W / 2, 150);
  const who = label(cat.name?.trim() || describeCat(cat), 14, TIER_COLOR[cat.rarityTier], '800');
  who.position.set(W / 2, 172);

  const reward = label(t(`Вы получите:   💰 ${coins}     🧬 ${dna}`, `You get:   💰 ${coins}     🧬 ${dna}`), 16, COLORS.ink, '800');
  reward.position.set(W / 2, 206);

  const pad = 24, gap = 12;
  const bw = (W - pad * 2 - gap) / 2;
  let y = 236;
  const noBtn = new Button({ text: t('Нет', 'No'), w: bw, h: 48, color: COLORS.cardEdge, textColor: COLORS.ink, fontSize: 16 });
  noBtn.position.set(pad + bw / 2, y + 24);
  noBtn.onTap = close;
  const yesBtn = new Button({ text: t('Да 🤝', 'Yes 🤝'), w: bw, h: 48, color: COLORS.good, fontSize: 16 });
  yesBtn.position.set(pad + bw + gap + bw / 2, y + 24);
  yesBtn.onTap = () => {
    const r = adoptCat(ctx.state, cat.id);
    if (!r.ok) { ctx.toast(r.reason); close(); return; }
    sfxEvent('adopt');
    ctx.commit();
    const xp = r.rep ? `  +${r.rep} ⭐` : '';
    ctx.toast(t(`Котика пристроили 🏠  +💰${r.coins}  +🧬${r.dna}${xp}`, `The cat found a home 🏠  +💰${r.coins}  +🧬${r.dna}${xp}`));
    close();
  };
  y += 56;

  root.addChild(panel(W, y, COLORS.hud, 18), title, sp, who, reward, noBtn, yesBtn);
  return root;
}

/**
 * Подтверждение сдачи кота в лабораторию «на эксперименты»: награда (🧬 + немного 💰)
 * и кнопки Да/Нет. Открывается, когда кота перетащили на лабораторный слот в Приюте.
 * Кот уезжает — это основной способ добывать гены из лишних котов (sendToLab).
 */
export function buildLabConfirm(ctx: UiContext, cat: Cat, close: () => void): Container {
  const W = 340;
  const root = new Container();
  const { dna, coins } = labReward(ctx.state, cat);

  const title = label(t('Сдать котика в лабораторию?', 'Send the cat to the lab?'), 18, COLORS.ink, '800');
  title.position.set(W / 2, 28);
  const sub = label(t('на эксперименты — взамен 🧬 гены', 'for experiments — 🧬 genes in return'), 12.5, COLORS.inkSoft, '700');
  sub.position.set(W / 2, 50);

  const sp = catSprite(ctx.app, cat, 84);
  sp.position.set(W / 2, 158);
  const who = label(cat.name?.trim() || describeCat(cat), 14, TIER_COLOR[cat.rarityTier], '800');
  who.position.set(W / 2, 180);

  const extra = coins > 0 ? `     💰 ${coins}` : '';
  const reward = label(t(`Вы получите:   🧬 ${dna}${extra}`, `You get:   🧬 ${dna}${extra}`), 16, COLORS.ink, '800');
  reward.position.set(W / 2, 212);

  const pad = 24, gap = 12;
  const bw = (W - pad * 2 - gap) / 2;
  let y = 242;
  const noBtn = new Button({ text: t('Нет', 'No'), w: bw, h: 48, color: COLORS.cardEdge, textColor: COLORS.ink, fontSize: 16 });
  noBtn.position.set(pad + bw / 2, y + 24);
  noBtn.onTap = close;
  const yesBtn = new Button({ text: t('Да 🧪', 'Yes 🧪'), w: bw, h: 48, color: COLORS.dna, fontSize: 16 });
  yesBtn.position.set(pad + bw + gap + bw / 2, y + 24);
  yesBtn.onTap = () => {
    const r = sendToLab(ctx.state, cat.id);
    if (!r.ok) { ctx.toast(r.reason === 'locked' ? t('Лаборатория ещё заперта 🔒', 'The lab is still locked 🔒') : r.reason); close(); return; }
    sfxEvent('lab');
    ctx.commit();
    const gain = `+🧬${r.dna}${r.coins > 0 ? `  +💰${r.coins}` : ''}${r.rep ? `  +${r.rep} ⭐` : ''}`;
    ctx.toast(t(`Кот в лаборатории 🧪  ${gain}`, `The cat is in the lab 🧪  ${gain}`));
    close();
  };
  y += 56;

  root.addChild(panel(W, y, COLORS.hud, 18), title, sub, sp, who, reward, noBtn, yesBtn);
  return root;
}

/**
 * Массовое пристройство: «Раздать всех в добрые руки?» — сводка (сколько котов +
 * суммарные 💰/🧬) и Да/Нет. Открывается кнопкой «Раздать всех» вверху приюта.
 * Суммы — shelterTotals (та же цена, что поштучно); действие — adoptAll.
 */
export function buildBulkAdoptConfirm(ctx: UiContext, close: () => void): Container {
  const W = 340;
  const root = new Container();
  const { count, adopt } = shelterTotals(ctx.state);

  const title = label(t('Раздать всех в добрые руки?', 'Give away every cat?'), 18, COLORS.ink, '800');
  title.position.set(W / 2, 30);
  const sub = label(t(`Всего в приюте: ${count} 🐱`, `In the shelter: ${count} 🐱`), 13, COLORS.inkSoft, '700');
  sub.position.set(W / 2, 54);
  const reward = label(t(`Вы получите:   💰 ${adopt.coins}     🧬 ${adopt.dna}`, `You get:   💰 ${adopt.coins}     🧬 ${adopt.dna}`), 16, COLORS.ink, '800');
  reward.position.set(W / 2, 90);

  const pad = 24, gap = 12;
  const bw = (W - pad * 2 - gap) / 2;
  const y = 120;
  const noBtn = new Button({ text: t('Нет', 'No'), w: bw, h: 48, color: COLORS.cardEdge, textColor: COLORS.ink, fontSize: 16 });
  noBtn.position.set(pad + bw / 2, y + 24);
  noBtn.onTap = close;
  const yesBtn = new Button({ text: t(`Да 🤝 (${count})`, `Yes 🤝 (${count})`), w: bw, h: 48, color: COLORS.good, fontSize: 16 });
  yesBtn.position.set(pad + bw + gap + bw / 2, y + 24);
  yesBtn.onTap = () => {
    const r = adoptAll(ctx.state);
    if (!r.ok) { ctx.toast(r.reason); close(); return; }
    sfxEvent('adopt'); // на всю партию один звук, а не по коту
    ctx.commit();
    const gain = `+💰${r.coins}  +🧬${r.dna}${r.rep ? `  +${r.rep} ⭐` : ''}`;
    ctx.toast(t(`Пристроено ${r.count} 🏠  ${gain}`, `${r.count} cats rehomed 🏠  ${gain}`));
    close();
  };

  root.addChild(panel(W, y + 56, COLORS.hud, 18), title, sub, reward, noBtn, yesBtn);
  return root;
}

/**
 * Массовая сдача в лабораторию: «Сдать всех котиков на эксперименты?» — сводка
 * (сколько котов + суммарные 🧬/💰) и Да/Нет. Кнопка «В лабораторию всех» вверху
 * приюта. Суммы — shelterTotals; действие — sendAllToLab.
 */
export function buildBulkLabConfirm(ctx: UiContext, close: () => void): Container {
  const W = 340;
  const root = new Container();
  const { count, lab } = shelterTotals(ctx.state);

  const title = label(t('Сдать всех в лабораторию?', 'Send every cat to the lab?'), 18, COLORS.ink, '800');
  title.position.set(W / 2, 30);
  const sub = label(t(`на эксперименты — взамен 🧬 гены · ${count} 🐱`, `for experiments — 🧬 genes in return · ${count} 🐱`), 12.5, COLORS.inkSoft, '700');
  sub.position.set(W / 2, 54);
  const extra = lab.coins > 0 ? `     💰 ${lab.coins}` : '';
  const reward = label(t(`Вы получите:   🧬 ${lab.dna}${extra}`, `You get:   🧬 ${lab.dna}${extra}`), 16, COLORS.ink, '800');
  reward.position.set(W / 2, 90);

  const pad = 24, gap = 12;
  const bw = (W - pad * 2 - gap) / 2;
  const y = 120;
  const noBtn = new Button({ text: t('Нет', 'No'), w: bw, h: 48, color: COLORS.cardEdge, textColor: COLORS.ink, fontSize: 16 });
  noBtn.position.set(pad + bw / 2, y + 24);
  noBtn.onTap = close;
  const yesBtn = new Button({ text: t(`Да 🧪 (${count})`, `Yes 🧪 (${count})`), w: bw, h: 48, color: COLORS.dna, fontSize: 16 });
  yesBtn.position.set(pad + bw + gap + bw / 2, y + 24);
  yesBtn.onTap = () => {
    const r = sendAllToLab(ctx.state);
    if (!r.ok) { ctx.toast(r.reason === 'locked' ? t('Лаборатория ещё заперта 🔒', 'The lab is still locked 🔒') : r.reason); close(); return; }
    sfxEvent('lab'); // на всю партию один звук, а не по коту
    ctx.commit();
    const gain = `+🧬${r.dna}${r.coins > 0 ? `  +💰${r.coins}` : ''}${r.rep ? `  +${r.rep} ⭐` : ''}`;
    ctx.toast(t(`В лаборатории ${r.count} 🧪  ${gain}`, `${r.count} cats sent to the lab 🧪  ${gain}`));
    close();
  };

  root.addChild(panel(W, y + 56, COLORS.hud, 18), title, sub, reward, noBtn, yesBtn);
  return root;
}

/**
 * Ветеринар: диалог лечения кота (💉). Показывает сердца (потраченные 🖤 / оставшиеся ❤️)
 * и два способа восстановить вязки: 📺 реклама (+HEAL_AD_HEARTS ❤, без кулдауна) или
 * 💎 полное лечение (цена ∝ потраченным сердцам). maxHearts НЕ меняется — потолок
 * от инбридинга неизлечим; «Бесплодных» (0 ❤) ветеринар не берёт (healCat откажет).
 * Открывается перетаскиванием шприца-ветеринара на кота в слоте вязки (Инкубатор).
 * `onHealed` — хук комнаты: после успешного лечения (и после commit, т.е. по свежим
 * спрайтам) Инкубатор пускает над котом красные плюсики. Аргумент — сколько ❤ вернули.
 */
export function buildHealConfirm(
  ctx: UiContext, cat: Cat, close: () => void, onHealed?: (hearts: number) => void,
): Container {
  const W = 340;
  const root = new Container();

  const title = label(t('💉 Ветеринар', '💉 Vet'), 18, COLORS.ink, '800');
  title.position.set(W / 2, 28);
  const sub = label(t('восстанавливает потраченные вязки', 'restores spent breedings'), 12.5, COLORS.inkSoft, '700');
  sub.position.set(W / 2, 50);

  const sp = catSprite(ctx.app, cat, 84);
  sp.position.set(W / 2, 158);
  const who = label(cat.name?.trim() || describeCat(cat), 14, TIER_COLOR[cat.rarityTier], '800');
  who.position.set(W / 2, 180);

  const total = heartsOf(cat);
  const left = breedsLeft(cat);
  const spent = Math.max(0, total - left);
  const heartsStr = total > 0 ? '🖤'.repeat(spent) + '❤️'.repeat(left) : '∅';
  const hearts = label(t('Здоровье ', 'Health ') + heartsStr, 15, COLORS.ink, '800');
  hearts.position.set(W / 2, 210);

  let y = 236;
  root.addChild(title, sub, sp, who, hearts);

  const btnW = W - 48;
  if (isSterile(cat)) {
    // родился без сердец — генетический тупик, лечению не подлежит (решение §6)
    const note = label(t('Бесплодный — лечению не подлежит 🚫', 'Sterile — cannot be healed 🚫'), 13, COLORS.warn, '800');
    note.position.set(W / 2, y);
    root.addChild(note);
    y += 28;
  } else if (spent <= 0) {
    const note = label(t('Кот полностью здоров ✨', 'The cat is fully healthy ✨'), 13, COLORS.good, '800');
    note.position.set(W / 2, y);
    root.addChild(note);
    y += 28;
  } else {
    // 📺 реклама: +1 ❤ бесплатно, без кулдауна
    const adBtn = new Button({
      text: t(`📺 Реклама · +${HEAL_AD_HEARTS} ❤ бесплатно`, `📺 Ad · +${HEAL_AD_HEARTS} ❤ free`),
      w: btnW, h: 44, color: COLORS.good,
      textColor: 0xffffff, fontSize: 15,
    });
    adBtn.position.set(W / 2, y + 22);
    adBtn.onTap = () => {
      void showRewarded().then((watched) => {
        if (!watched) { ctx.toast(t('Реклама недоступна', 'Ad unavailable')); return; }
        const r = healCat(ctx.state, cat.id, 'ad', ctx.now());
        if (!r.ok) { ctx.toast(r.reason === 'locked' ? t('Ветеринар ещё заперт 🔒', 'The vet is still locked 🔒') : r.reason); close(); return; }
        sfxEvent('heal');
        ctx.commit();
        onHealed?.(r.healed); // плюсики над котом — после пересбора комнаты
        ctx.toast(t(`Кот подлечен 💉 +${r.healed} ❤`, `The cat is healed 💉 +${r.healed} ❤`));
        close();
      });
    };
    root.addChild(adBtn);
    y += 52;

    // 💎 полное лечение: цена пропорциональна потраченным сердцам
    const cost = HEAL_CRYSTAL_PER_HEART * spent;
    const afford = ctx.state.crystals >= cost;
    const fullBtn = new Button({
      text: t(`💎 Вылечить всё · ${cost}`, `💎 Heal everything · ${cost}`),
      w: btnW, h: 44, color: afford ? COLORS.secondary : COLORS.cardEdge,
      textColor: afford ? 0xffffff : COLORS.inkSoft, fontSize: 15,
    });
    fullBtn.enabled = afford;
    fullBtn.position.set(W / 2, y + 22);
    fullBtn.onTap = () => {
      const r = healCat(ctx.state, cat.id, 'crystals', ctx.now());
      if (!r.ok) { ctx.toast(r.reason === 'locked' ? t('Ветеринар ещё заперт 🔒', 'The vet is still locked 🔒') : r.reason); close(); return; }
      sfxEvent('heal');
      ctx.commit();
      onHealed?.(r.healed);
      ctx.toast(t(`Кот полностью здоров 💉 +${r.healed} ❤  −${r.crystals} 💎`, `The cat is fully healthy 💉 +${r.healed} ❤  −${r.crystals} 💎`));
      close();
    };
    root.addChild(fullBtn);
    y += 52;
  }

  const closeBtn = new Button({ text: t('Закрыть', 'Close'), w: btnW, h: 40, color: COLORS.cardEdge, textColor: COLORS.ink, fontSize: 14 });
  closeBtn.position.set(W / 2, y + 20);
  closeBtn.onTap = close;
  root.addChild(closeBtn);
  y += 50;

  root.addChildAt(panel(W, y, COLORS.hud, 18), 0);
  return root;
}

/**
 * Криокапсула: диалог заморозки кота (🧊). Открывается перетаскиванием кота на
 * станцию-криокапсулу в Питомнике (кнопки в меню кота больше нет). Три пути оплаты,
 * как у ветеринара/анализа: 📺 реклама (бесплатно, глобальный кулдаун), 💰 монеты или
 * 💎 кристаллы. В капсуле кот не ест и не даёт доход; разморозки нет — только клон/утиль.
 */
export function buildFreezeConfirm(ctx: UiContext, cat: Cat, close: () => void): Container {
  const W = 340;
  const root = new Container();

  const title = label(t('🧊 Заморозить кота?', '🧊 Freeze the cat?'), 18, COLORS.ink, '800');
  title.position.set(W / 2, 28);
  const sub = label(t('в криокапсулу — витрина коллекции', 'into a cryo capsule — your collection showcase'), 12.5, COLORS.inkSoft, '700');
  sub.position.set(W / 2, 50);

  const sp = catSprite(ctx.app, cat, 84);
  sp.position.set(W / 2, 150);
  const who = label(cat.name?.trim() || describeCat(cat), 14, TIER_COLOR[cat.rarityTier], '800');
  who.position.set(W / 2, 172);

  const note = new Text({
    text: t('❄️ В капсуле кот не ест и не приносит доход. Разморозки нет — освободить капсулу можно клоном 🧬 или утилизацией.', '❄️ In a capsule the cat neither eats nor earns. There is no thawing — a capsule is freed by cloning 🧬 or by recycling.'),
    style: {
      fontFamily: FONT, fontSize: 11.5, fontWeight: '600', fill: COLORS.inkSoft,
      align: 'center', wordWrap: true, wordWrapWidth: W - 48, lineHeight: 16,
    },
  });
  note.anchor.set(0.5, 0);
  note.position.set(W / 2, 192);

  let y = 192 + note.height + 14;
  root.addChild(title, sub, sp, who, note);

  const btnW = W - 48;
  const done = (r: { coins: number; crystals: number }): void => {
    sfxEvent('freeze');
    ctx.commit();
    const paid = `${r.coins ? `  −💰${r.coins}` : ''}${r.crystals ? `  −💎${r.crystals}` : ''}`;
    ctx.toast(t(`Кот в криокапсуле ❄️${paid}`, `The cat is in a cryo capsule ❄️${paid}`));
    close();
  };
  const fail = (reason: string): void => {
    ctx.toast(reason === 'locked' ? t('Крио-банк ещё закрыт 🔒', 'The cryobank is still closed 🔒')
      : reason === t('нет свободной капсулы', 'no free capsule') ? t('Нет свободной капсулы ❄️ (открой ещё в Криогенетике)', 'No free capsule ❄️ (unlock more in Cryogenetics)')
        : reason);
  };

  if (cryoCount(ctx.state) >= cryoCapacity(ctx.state)) {
    const noCap = label(t('Нет свободной капсулы ❄️ (открой ещё в Криогенетике)', 'No free capsule ❄️ (unlock more in Cryogenetics)'), 12, COLORS.warn, '800');
    noCap.position.set(W / 2, y);
    root.addChild(noCap);
    y += 28;
  } else {
    // 📺 реклама: бесплатно, но с глобальным кулдауном (0 = ещё не смотрели)
    const cdLeft = ctx.state.lastFreezeAdAt > 0
      ? FREEZE_AD_COOLDOWN_MS - (ctx.now() - ctx.state.lastFreezeAdAt) : 0;
    const adReady = cdLeft <= 0;
    const adBtn = new Button({
      text: adReady ? t('📺 Бесплатно за рекламу', '📺 Free for an ad') : t(`📺 через ${Math.ceil(cdLeft / 60_000)} мин`, `📺 in ${Math.ceil(cdLeft / 60_000)} min`),
      w: btnW, h: 44, color: adReady ? COLORS.good : COLORS.cardEdge,
      textColor: adReady ? 0xffffff : COLORS.inkSoft, fontSize: 15,
    });
    adBtn.enabled = adReady;
    adBtn.position.set(W / 2, y + 22);
    adBtn.onTap = () => {
      void showRewarded().then((watched) => {
        if (!watched) { ctx.toast(t('Реклама недоступна', 'Ad unavailable')); return; }
        const r = freezeCat(ctx.state, cat.id, 'ad', ctx.now());
        if (!r.ok) { fail(r.reason); return; }
        done(r);
      });
    };
    root.addChild(adBtn);
    y += 52;

    // 💰 монеты
    const affordCoin = ctx.state.coins >= FREEZE_COIN_COST;
    const coinBtn = new Button({
      text: t(`💰 Заморозить · ${FREEZE_COIN_COST}`, `💰 Freeze · ${FREEZE_COIN_COST}`),
      w: btnW, h: 44, color: affordCoin ? COLORS.primary : COLORS.cardEdge,
      textColor: affordCoin ? 0xffffff : COLORS.inkSoft, fontSize: 15,
    });
    coinBtn.enabled = affordCoin;
    coinBtn.position.set(W / 2, y + 22);
    coinBtn.onTap = () => { const r = freezeCat(ctx.state, cat.id, 'coins', ctx.now()); if (!r.ok) { fail(r.reason); return; } done(r); };
    root.addChild(coinBtn);
    y += 52;

    // 💎 кристаллы (премиум, мгновенно)
    const affordCrys = ctx.state.crystals >= FREEZE_CRYSTAL_COST;
    const crysBtn = new Button({
      text: t(`💎 Заморозить · ${FREEZE_CRYSTAL_COST}`, `💎 Freeze · ${FREEZE_CRYSTAL_COST}`),
      w: btnW, h: 44, color: affordCrys ? COLORS.secondary : COLORS.cardEdge,
      textColor: affordCrys ? 0xffffff : COLORS.inkSoft, fontSize: 15,
    });
    crysBtn.enabled = affordCrys;
    crysBtn.position.set(W / 2, y + 22);
    crysBtn.onTap = () => { const r = freezeCat(ctx.state, cat.id, 'crystals', ctx.now()); if (!r.ok) { fail(r.reason); return; } done(r); };
    root.addChild(crysBtn);
    y += 52;
  }

  const closeBtn = new Button({ text: t('Закрыть', 'Close'), w: btnW, h: 40, color: COLORS.cardEdge, textColor: COLORS.ink, fontSize: 14 });
  closeBtn.position.set(W / 2, y + 20);
  closeBtn.onTap = close;
  root.addChild(closeBtn);
  y += 50;

  root.addChildAt(panel(W, y, COLORS.hud, 18), 0);
  return root;
}

/**
 * Меню криокапсулы (Крио-банк): портрет замороженного кота + здоровье/родословная и
 * два действия — 🧬 клонировать (за ДНК, цена ∝ ценности особи; клон появляется в
 * питомнике) или ♻️ утилизировать (необратимо, с подтверждением). Разморозки НЕТ.
 */
export function buildCryoMenu(ctx: UiContext, cat: Cat, close: () => void): Container {
  const W = 360;
  const root = new Container();
  let confirmDispose = false;

  const render = (): void => {
    root.removeChildren();
    const tierCol = TIER_COLOR[cat.rarityTier];

    const title = label(t('❄️ Криокапсула', '❄️ Cryo capsule'), 18, COLORS.ink, '800');
    title.position.set(W / 2, 26);

    const sp = catSprite(ctx.app, cat, 92);
    sp.tint = 0xcfeaf6; // морозный тон замороженного кота
    sp.position.set(W / 2, 150);
    const who = label(cat.name?.trim() || describeCat(cat), 14, tierCol, '800');
    who.position.set(W / 2, 170);
    const st = stars(cat.rarityTier, 14);
    st.position.set(W / 2, 192);

    // здоровье (сердца) — как в меню кота: потраченные 🖤 / оставшиеся ❤️
    const total = heartsOf(cat);
    const left = breedsLeft(cat);
    const spent = Math.max(0, total - left);
    const heartsStr = total > 0 ? '🖤'.repeat(spent) + '❤️'.repeat(left) : '∅';
    const hearts = label(t('Здоровье ', 'Health ') + heartsStr, 13, COLORS.inkSoft, '700');
    hearts.position.set(W / 2, 214);

    let y = 234;
    root.addChild(title, sp, who, st, hearts);

    const btnW = W - 48;
    const addBtn = (text: string, color: number, enabled: boolean, onTap: () => void): void => {
      const b = new Button({ text, w: btnW, h: 44, color, fontSize: 15 });
      b.enabled = enabled;
      b.onTap = onTap;
      b.position.set(W / 2, y + 22);
      root.addChild(b);
      y += 52;
    };

    if (confirmDispose) {
      const warnT = label(t('Утилизировать безвозвратно?', 'Recycle for good?'), 15, COLORS.warn, '800');
      warnT.position.set(W / 2, y + 4);
      root.addChild(warnT);
      y += 24;
      const pad = 24, gap = 12;
      const bw = (W - pad * 2 - gap) / 2;
      const noBtn = new Button({ text: t('Нет', 'No'), w: bw, h: 46, color: COLORS.cardEdge, textColor: COLORS.ink, fontSize: 16 });
      noBtn.position.set(pad + bw / 2, y + 23);
      noBtn.onTap = () => { confirmDispose = false; render(); };
      const yesBtn = new Button({ text: t('♻️ Да', '♻️ Yes'), w: bw, h: 46, color: COLORS.warn, textColor: COLORS.ink, fontSize: 16 });
      yesBtn.position.set(pad + bw + gap + bw / 2, y + 23);
      yesBtn.onTap = () => {
        const r = disposeCryo(ctx.state, cat.id);
        if (!r.ok) { ctx.toast(r.reason); close(); return; }
        ctx.commit();
        ctx.toast(t('Капсула освобождена ♻️', 'The capsule is free again ♻️'));
        close();
      };
      root.addChild(noBtn, yesBtn);
      y += 54;
    } else {
      // клонирование: цена ∝ ценности особи (🧬 + 💰 = 🧬×10); нужно место в питомнике
      const cost = cloneCost(cat);
      const coinsCost = cloneCostCoins(cat);
      const noRoom = roomCount(ctx.state, 'nursery') >= nurseryCapacity(ctx.state);
      const afford = ctx.state.dna >= cost && ctx.state.coins >= coinsCost;
      addBtn(
        noRoom ? t('🧬 Клонировать · нет места', '🧬 Clone · no room') : t(`🧬 Клонировать · ${cost} · 💰${coinsCost}`, `🧬 Clone · ${cost} · 💰${coinsCost}`),
        afford && !noRoom ? COLORS.dna : COLORS.cardEdge,
        afford && !noRoom,
        () => {
          const r = cloneCat(ctx.state, cat.id, ctx.now());
          if (!r.ok) {
            ctx.toast(r.reason === t('нет места в питомнике', 'no room in the cattery') ? t('Нет места в питомнике 🚫', 'No room in the cattery 🚫')
              : r.reason === t('не хватает ДНК', 'not enough DNA') ? t('Не хватает 🧬 ДНК', 'Not enough 🧬 DNA')
              : r.reason === t('не хватает монет', 'not enough coins') ? t('Не хватает 💰 монет', 'Not enough 💰 coins') : r.reason);
            return;
          }
          ctx.commit();
          ctx.toast(t(`Клон в питомнике 🐱  −🧬${r.dna} −💰${r.coins}`, `The clone is in the cattery 🐱  −🧬${r.dna} −💰${r.coins}`));
          close();
        },
      );
      if (cat.motherBreed || cat.fatherBreed || cat.pedigree) {
        addBtn(t('🌳 Родословная', '🌳 Pedigree'), COLORS.secondary, true, () => ctx.openPedigree(cat));
      }
      // Генетический анализ доступен и в капсуле: вскрыть родословную/скрытые гены.
      if (!cat.analyzed && pedigreeHasFog(cat)) {
        addBtn(t('🧬 Генетический анализ', '🧬 Genetic analysis'), COLORS.dna, true, () => ctx.openAnalyzeConfirm(cat));
      }
      addBtn(t('♻️ Утилизировать', '♻️ Recycle'), COLORS.warn, true, () => { confirmDispose = true; render(); });
    }

    const closeBtn = new Button({ text: t('Закрыть', 'Close'), w: btnW, h: 40, color: COLORS.cardEdge, textColor: COLORS.ink, fontSize: 14 });
    closeBtn.position.set(W / 2, y + 20);
    closeBtn.onTap = close;
    root.addChild(closeBtn);
    y += 50;

    root.addChildAt(panel(W, y, COLORS.hud, 18), 0);
  };

  render();
  return root;
}

/**
 * Доска заказов (кнопка 📋 в Приюте). Каждый слот всегда держит активный заказ со своим
 * 6-часовым таймером жизни: не выполнил вовремя — заказ сам сменится (на строке виден
 * остаток «⏳ сменятся через Ч:ММ»). У каждого заказа свой часовой кулдаун 📺-обновления.
 * Выполнить заказ можно ТОЛЬКО котом из корзины: кнопка «Выполнить» активна лишь у строк,
 * под которые он подходит.
 *
 * РАСКЛАДКА строки: «Выполнить» — справа сверху, «📺 обновить» — слева снизу (по разным
 * углам карточки, чтобы не промахнуться пальцем), таймер жизни — текстом справа снизу.
 */
export function buildOrdersPanel(ctx: UiContext, close: () => void): Container {
  const W = 620;
  const root = new Container();

  const title = label(t('📋 Заказы клиентов', '📋 Client orders'), 20, COLORS.ink, '800');
  title.position.set(W / 2, 26);

  const cat = basketCat(ctx.state);
  const basket = label(
    cat ? t(`🧺 В корзине: ${cat.name?.trim() || describeCat(cat)}`, `🧺 In the basket: ${cat.name?.trim() || describeCat(cat)}`) : t('🧺 Корзина пуста — перетащи кота в корзину под кнопкой 📋 в Приюте', '🧺 The basket is empty — drag a cat into the basket under the 📋 button in the Shelter'),
    13, cat ? COLORS.ink : COLORS.inkSoft, '800',
  );
  basket.anchor.set(0.5, 0);
  basket.position.set(W / 2, 46);

  // остаток «Ч:ММ» (таймер жизни ≤ 6 ч) и «N мин» (часовой кулдаун 📺)
  const fmtHM = (ms: number): string => {
    const h = Math.floor(ms / 3_600_000);
    const m = Math.floor((ms % 3_600_000) / 60_000);
    return `${h}:${String(m).padStart(2, '0')}`;
  };
  const fmtMin = (ms: number): string => t(`${Math.max(1, Math.ceil(ms / 60_000))} мин`, `${Math.max(1, Math.ceil(ms / 60_000))} min`);
  const adHelp = label(
    t('Не выполнил за 6 ч — заказ сменится сам. Просмотр рекламы обновляет заказ досрочно (раз в час на заказ).', 'Not done within 6 h and the order changes by itself. Watching an ad refreshes an order early (once per hour per order).'),
    11.5, COLORS.inkSoft, '600');
  adHelp.anchor.set(0.5, 0);
  adHelp.position.set(W / 2, 66);

  const rowH = 100;
  const cardW = W - 32;
  const orders = ctx.state.orders;
  let y = 90;
  const rows = new Container();

  for (const order of orders) {
    const row = new Container();
    const fits = !!cat && matchesOrder(order, cat);
    const busy = !!cat && isBusy(ctx.state, cat.id);
    row.addChild(panel(cardW, rowH - 10, COLORS.card, 12));

    const req = label(`«${describeReq(order.req)}»`, 16, COLORS.ink, '800');
    req.anchor.set(0, 0.5);
    req.position.set(16, 22);
    row.addChild(req);

    const rew = label(t('Награда: ', 'Reward: ') + rewardText(order.reward), 13, COLORS.inkSoft, '700');
    rew.anchor.set(0, 0.5);
    rew.position.set(16, 46);
    row.addChild(rew);

    // таймер жизни — текстом в правом нижнем углу (под кнопкой «Выполнить»)
    const timer = label(t(`⏳ сменятся через ${fmtHM(msUntilOrderExpiry(order, ctx.now()))}`, `⏳ changes in ${fmtHM(msUntilOrderExpiry(order, ctx.now()))}`), 11.5, COLORS.inkSoft, '600');
    timer.anchor.set(1, 0.5);
    timer.position.set(cardW - 16, 70);
    row.addChild(timer);

    // главная кнопка «Выполнить» — правый верхний угол карточки
    const btnText = !cat ? t('нужен кот', 'need a cat') : busy ? t('кот занят', 'cat is busy') : fits ? t('Выполнить', 'Complete') : t('не подходит', 'does not match');
    const btn = new Button({
      text: btnText, w: 150, h: 40,
      color: fits && !busy ? COLORS.primary : COLORS.cardEdge,
      textColor: fits && !busy ? 0xffffff : COLORS.inkSoft, fontSize: 15,
    });
    btn.enabled = fits && !busy;
    btn.position.set(cardW - 16 - 75, 26);
    btn.onTap = () => {
      const r = claimOrder(ctx.state, order.id, ctx.now(), ctx.rng);
      if (r.ok) {
        sfxEvent('order');
        ctx.commit(); ctx.toast(t('Заказ выполнен! ', 'Order complete! ') + rewardText(r.reward)); close(); ctx.openOrders();
      } else ctx.toast(r.reason);
    };
    row.addChild(btn);

    // 📺-обновление — левый нижний угол, по диагонали от «Выполнить»: промахнуться нельзя.
    // Кулдаун свой у каждого заказа, поэтому состояние кнопки считается по строке.
    const adAvail = canAdRefreshOrder(order, ctx.now());
    const refBtn = new Button({
      text: adAvail ? t('📺 Реклама · обновить', '📺 Ad · refresh') : `⏳ ${fmtMin(msUntilAdRefresh(order, ctx.now()))}`, w: 178, h: 28,
      color: adAvail ? COLORS.secondary : COLORS.cardEdge,
      textColor: adAvail ? 0xffffff : COLORS.inkSoft, fontSize: 11,
    });
    refBtn.enabled = adAvail;
    refBtn.position.set(16 + 89, 70); // левый край вровень с текстом заказа (отступ 16)
    refBtn.onTap = () => {
      void showRewarded().then((watched) => {
        if (!watched) { ctx.toast(t('Реклама недоступна', 'Ad unavailable')); return; }
        const r = adRefreshOrder(ctx.state, ctx.rng, order.id, ctx.now());
        if (!r.ok) { ctx.toast(r.reason); return; }
        ctx.commit();
        ctx.toast(t('Заказ обновлён 📺', 'Order refreshed 📺'));
        close(); ctx.openOrders();
      });
    };
    row.addChild(refBtn);

    row.position.set(16, y);
    rows.addChild(row);
    y += rowH;
  }

  const closeBtn = new Button({ text: t('Закрыть', 'Close'), w: 160, h: 42, color: COLORS.cardEdge, textColor: COLORS.ink, fontSize: 15 });
  closeBtn.position.set(W / 2, y + 26);
  closeBtn.onTap = close;

  const H = y + 56;
  root.addChild(panel(W, H, COLORS.hud, 18));
  root.addChild(title, basket, adHelp, rows, closeBtn);
  return root;
}

/**
 * ⚠️ ВРЕМЕННОЕ DEV-меню (удалить перед релизом; см. openDevMenu/кнопку 🛠 в HUD).
 * Читерская панель для отладки: накидывает валюты и выставляет уровень лаборатории
 * (через порог опыта LEVEL_REP_THRESHOLDS). Показывается только при import.meta.env.DEV.
 */
export function buildDevMenu(ctx: UiContext, close: () => void): Container {
  const W = 360;
  const root = new Container();

  const render = (): void => {
    root.removeChildren();
    const s = ctx.state;
    const items: Container[] = [];

    const title = label('🛠 Режим разработчика', 19, COLORS.ink, '800');
    title.position.set(W / 2, 26);
    const sub = label('временное — убрать перед релизом', 12, COLORS.warn, '700');
    sub.position.set(W / 2, 48);
    items.push(title, sub);

    let y = 72;

    // строка ресурса: подпись «глиф имя: значение» + ряд кнопок «+N»
    const resourceRow = (glyph: string, name: string, value: number, adds: number[], apply: (n: number) => void): void => {
      const cap = label(`${glyph} ${name}: ${fmt(value)}`, 14, COLORS.ink, '800');
      cap.anchor.set(0, 0.5);
      cap.position.set(24, y);
      items.push(cap);
      y += 22;
      const btns = adds.map((n) => {
        const b = new Button({ text: `+${fmt(n)}`, w: 90, h: 38, color: COLORS.primary, fontSize: 14 });
        b.onTap = () => { apply(n); ctx.commit(); render(); };
        return b;
      });
      centerRow(btns, y + 19, W, 10);
      items.push(...btns);
      y += 48;
    };

    resourceRow('💰', 'Монеты', s.coins, [1000, 10000, 100000], (n) => { s.coins += n; });
    resourceRow('💎', 'Кристаллы', s.crystals, [50, 500, 5000], (n) => { s.crystals += n; });
    resourceRow('🧬', 'ДНК', s.dna, [1000, 10000, 100000], (n) => { s.dna += n; });

    // уровень лаборатории: задаётся через порог накопленного опыта
    const lvlCap = label(`⭐ Уровень: ${s.level} / ${MAX_LEVEL}`, 14, COLORS.ink, '800');
    lvlCap.anchor.set(0, 0.5);
    lvlCap.position.set(24, y);
    items.push(lvlCap);
    y += 22;
    const setLevel = (target: number): void => {
      const lv = Math.max(1, Math.min(MAX_LEVEL, target));
      s.reputation = LEVEL_REP_THRESHOLDS[lv - 1] ?? 0;
      s.level = levelForReputation(s.reputation);
      ctx.commit();
      render();
    };
    const lvlBtns = [
      new Button({ text: '−1', w: 70, h: 38, color: COLORS.cardEdge, textColor: COLORS.ink, fontSize: 15 }),
      new Button({ text: '+1', w: 70, h: 38, color: COLORS.good, fontSize: 15 }),
      new Button({ text: 'MAX', w: 90, h: 38, color: COLORS.secondary, fontSize: 14 }),
    ];
    lvlBtns[0]!.onTap = () => setLevel(s.level - 1);
    lvlBtns[1]!.onTap = () => setLevel(s.level + 1);
    lvlBtns[2]!.onTap = () => setLevel(MAX_LEVEL);
    centerRow(lvlBtns, y + 19, W, 10);
    items.push(...lvlBtns);
    y += 48;

    // открыть все рецепты в Котодексе (knownRecipes ← ключи всех рецептов)
    const known = (s.knownRecipes ?? []).length;
    const recipesBtn = new Button({
      text: known >= RECIPES.length ? `📖 Все рецепты открыты (${RECIPES.length})` : `📖 Открыть все рецепты (${known}/${RECIPES.length})`,
      w: W - 48, h: 42, color: COLORS.secondary, fontSize: 14,
    });
    recipesBtn.position.set(W / 2, y + 21);
    recipesBtn.onTap = () => {
      s.knownRecipes = RECIPES.map(recipeKey);
      ctx.commit();
      ctx.toast('Все рецепты открыты');
      render();
    };
    items.push(recipesBtn);
    y += 52;

    // заспавнить любую породу в питомник (если место позволяет)
    const spawnBtn = new Button({ text: '🐈 Заспавнить породу…', w: W - 48, h: 42, color: COLORS.good, fontSize: 15 });
    spawnBtn.position.set(W / 2, y + 21);
    spawnBtn.onTap = () => askBreedSpawn((breedKey) => {
      if (roomCount(s, 'nursery') >= nurseryCapacity(s)) return '🚫 Питомник заполнен';
      const sex = ctx.rng() < 0.5 ? 'female' : 'male';
      s.cats.push(makeCatInstance(s, randomCat(ctx.rng, sex), ctx.now(), 'nursery', breedKey));
      ctx.commit();
      return `✅ ${breedName(breedKey)} → питомник (${roomCount(s, 'nursery')}/${nurseryCapacity(s)})`;
    });
    items.push(spawnBtn);
    y += 52;

    const closeBtn = new Button({ text: t('Закрыть', 'Close'), w: W - 48, h: 42, color: COLORS.cardEdge, textColor: COLORS.ink, fontSize: 15 });
    closeBtn.position.set(W / 2, y + 21);
    closeBtn.onTap = close;
    items.push(closeBtn);
    y += 52;

    root.addChild(panel(W, y, COLORS.hud, 18), ...items);
  };

  render();
  return root;
}
