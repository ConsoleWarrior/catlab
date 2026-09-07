/**
 * Оверлеи поверх сцены: меню кота (действия) и панель заказов.
 * Возвращают Container с панелью; центрирование и затемнение — на Game.
 */

import { Container, Graphics, Rectangle, Sprite, Text } from 'pixi.js';
import type { Application, FederatedPointerEvent, Point } from 'pixi.js';
import type { Cat, BirthEvent, Ancestor, LiveRoom, OfflineIncome, Order } from '../game/index.js';
import {
  isBusy, isInSlot, freeBreedSlot, assignBreeder, clearBreederSlot, moveCat, keepKittenWithParents,
  claimOrder, matchesOrder, renameCat,
  basketCat, adRefreshOrder, msUntilOrderExpiry, canAdRefreshOrder, msUntilAdRefresh,
  isAdult, growthProgress, growthRemainingMs, isOld, breedsLeft, heartsOf, isSterile,
  roomCount, nurseryCapacity, shelterCapacity, makeCatInstance,
  catAncestors, pedigreeDepth, PEDIGREE_DEPTH, BOOSTS, buyBoost, adChargeBoost, toggleBoost, boostCharges, activeBoostId,
  BOOST_AD_COOLDOWN_MS,
  adoptCat, adoptReward, speedUpGrowth, adSkipGrowth, speedUpCost, growthBillableMs, GROWTH_SPEEDUP_CRYSTAL_PER_MIN,
  sendToLab, labReward, shelterTotals, adoptAll, sendAllToLab,
  healCat, HEAL_AD_HEARTS, HEAL_CRYSTAL_PER_HEART,
  freezeCat, cloneCat, disposeCryo, cloneCost, cloneCostCoins, cryoCount, cryoCapacity,
  FREEZE_COIN_COST, FREEZE_CRYSTAL_COST, FREEZE_AD_COOLDOWN_MS,
  analyzeCat, freeAnalyzeCat, analyzeCost, ANALYZE_CRYSTAL_COST, FREE_ANALYZE_COUNT, kinshipName,
  freeGrowKitten, FREE_GROWTH_COUNT,
  TUTORIAL_REWARD_COINS, TUTORIAL_REWARD_CRYSTALS,
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
import type { RarityTier, Recipe } from '../genetics/index.js';
import { BREEDS, randomCat, RECIPES, recipeKey } from '../genetics/index.js';
import { DEVTOOLS } from './devTools.js';
import type { UiContext } from './context.js';
import {
  Button, centerRow, COLORS, FONT, fmt, INK, INK_SOFT, label, panel, stackWords, stars,
  TIERS, tierName, TIER_COLOR, UI_SCALE, V, VIVID,
} from './theme.js';
import { darken, lighten } from '../render/palette.js';
import { describeCat, catTraits, describeReq, describeRecipe, pct } from './describe.js';
import { catSprite, breedThumbTexture } from './catTextures.js';
import { breedFaceTexture } from './breedFace.js';
import { getMasterVolume, setMasterVolume, sfxEvent, sfxMeow } from './sound.js';
import { canOfferAuth, isAuthorized, openAuthDialog, canOfferReview, requestReview } from '../platform/ysdk.js';
import { t, tx, lang, setLang, AVAILABLE, type Lang, type LocStr } from '../i18n.js';

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

/**
 * Награда цветными сегментами (💰/💎/🧬/⭐) — каждая валюта своим цветом, чтобы
 * строка читалась одним взглядом. Крепится за ЛЕВЫЙ край, центр по вертикали.
 */
function rewardRow(r: { coins: number; crystals: number; dna: number; reputation: number }, size = 14): Container {
  const c = new Container();
  const segs: [string, number][] = [];
  if (r.coins) segs.push([`💰${r.coins}`, V(darken(COLORS.coins, 0.32), COLORS.inkSoft)]);
  if (r.crystals) segs.push([`💎${r.crystals}`, V(darken(COLORS.crystals, 0.3), COLORS.inkSoft)]);
  if (r.dna) segs.push([`🧬${r.dna}`, V(darken(COLORS.dna, 0.3), COLORS.inkSoft)]);
  if (r.reputation) segs.push([`⭐${r.reputation}`, V(darken(COLORS.warn, 0.38), COLORS.inkSoft)]);
  let x = 0;
  for (const [text, color] of segs) {
    const seg = label(text, size, color, '800');
    seg.anchor.set(0, 0.5);
    seg.position.set(x, 0);
    c.addChild(seg);
    x += seg.width + 10;
  }
  return c;
}

/** Тир, которым «пахнет» заказ: порода → её тир, «не ниже X» → сам X. */
function orderTier(req: { breed?: string; minRarity?: RarityTier }): RarityTier {
  return req.breed ? tierOfBreed(req.breed) : req.minRarity ?? 'common';
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
 * Чем ещё, кроме «отпустил палец», заканчивается перетаскивание ползунка.
 *
 * Касание забирает себе система: жест «назад» от края экрана (а тянуть громкость
 * в ноль — это как раз к левому краю), второй палец, шторка уведомлений. Тогда
 * браузер шлёт pointercancel/touchcancel, а Pixi таких событий не слушает вовсе
 * (EventSystem подписан только на pointerdown/move/up и touchstart/move/end) —
 * значит «отпускания» не придёт никогда. Без этой страховки перетаскивание не
 * заканчивалось, и следующий тап — хоть по «Готово» — ставил громкость по своему
 * x. Отсюда и был баг «убавил до нуля, а звук остался».
 */
const DRAG_END = ['pointercancel', 'touchcancel', 'pointerup', 'touchend', 'blur'] as const;

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
    if (c.destroyed) return; // панель уже закрыли — двигать нечего
    const local = c.toLocal(global);
    value = Math.min(1, Math.max(0, (local.x - x0) / span));
    draw();
    onChange(value);
  };

  c.on('pointerdown', (e: FederatedPointerEvent) => {
    applyAt(e.global);
    const move = (ev: FederatedPointerEvent): void => applyAt(ev.global);
    let ended = false;
    const up = (): void => {
      if (ended) return; // концов у перетаскивания много, конец — один
      ended = true;
      app.stage.off('pointermove', move);
      app.stage.off('pointerup', up);
      app.stage.off('pointerupoutside', up);
      DRAG_END.forEach((n) => window.removeEventListener(n, up, true));
      onCommit?.(value);
    };
    app.stage.on('pointermove', move);
    app.stage.on('pointerup', up);
    app.stage.on('pointerupoutside', up);
    DRAG_END.forEach((n) => window.addEventListener(n, up, true));
  });

  return c;
}

/**
 * Политика конфиденциальности — п. 3.5 Требований: её текст должен быть в самой
 * игре. Ссылкой это закрыть нельзя (внешние ссылки запрещены п. 8.4.2), поэтому
 * текст лежит здесь и открывается из ⚙️ Настроек.
 *
 * Текст обязан отражать правду о том, что игра делает: прогресс в облаке
 * платформы, идентификатор игрока от неё же, реклама и покупки через её SDK.
 * Названий и марок площадки в тексте нет — игра говорит «игровая платформа».
 */
const PRIVACY: LocStr[] = [
  ['Игра не собирает и не передаёт разработчику ваши персональные данные: ни имени, ни почты, ни телефона, ни платёжных реквизитов.',
   'The game does not collect or send the developer any personal data: no name, no email, no phone number, no payment details.'],
  ['Что сохраняется: игровой прогресс — коты, валюты, уровень лаборатории, настройки. Он хранится на вашем устройстве и в облаке игровой платформы, чтобы игра продолжалась с любого устройства.',
   'What is saved: your game progress — cats, currencies, lab level, settings. It is stored on your device and in the game platform cloud so you can continue from any device.'],
  ['Прогресс привязан к идентификатору игрока, который выдаёт платформа. Кто вы такой, игра не знает.',
   'Progress is tied to a player id issued by the platform. The game does not know who you are.'],
  ['Реклама и покупки кристаллов идут через SDK игровой платформы и подчиняются её правилам. Своих серверов у игры нет, наружу она ничего не отправляет.',
   'Ads and crystal purchases go through the platform SDK and follow the platform rules. The game has no servers of its own and sends nothing outside.'],
  ['Чтобы удалить прогресс, очистите данные сайта в браузере: облачную копию можно удалить через настройки вашего аккаунта на игровой платформе.',
   'To delete your progress, clear the site data in your browser; the cloud copy can be removed through your platform account settings.'],
];

/** Оверлей «Конфиденциальность» — текст политики (п. 3.5). */
export function buildPrivacyPanel(ctx: UiContext, close: () => void): Container {
  const W = Math.min(ctx.roomW - 40, 620);
  const pad = 22;
  const root = new Container();

  const title = label(t('🔒 Конфиденциальность', '🔒 Privacy'), 19, COLORS.ink, '800');

  let y = 58;
  const texts: Text[] = [];
  for (const line of PRIVACY) {
    const p = new Text({
      text: `• ${tx(line)}`,
      style: {
        fontFamily: FONT, fontSize: 14, fontWeight: '600', fill: COLORS.ink,
        wordWrap: true, wordWrapWidth: W - pad * 2, lineHeight: 19, align: 'left',
      },
    });
    p.anchor.set(0, 0);
    p.position.set(pad, y);
    texts.push(p);
    y += p.height + 10;
  }

  const closeBtn = new Button({ text: t('Понятно!', 'Got it!'), w: 200, h: 46, color: COLORS.primary, fontSize: 16 });
  closeBtn.position.set(W / 2, y + 28);
  closeBtn.onTap = close;

  root.addChild(panel(W, y + 58, COLORS.hud, 18));
  title.position.set(W / 2, 32);
  root.addChild(title, ...texts, closeBtn);
  return root;
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
  // Кнопки строим из AVAILABLE (src/i18n.ts) — списка языков, на которые игра
  // реально переведена. Своего перечня здесь быть не должно: он разойдётся с тем,
  // что пишется в `<html lang>` и уходит в черновик Консоли (п. 2.10).
  const FLAGS: Record<Lang, string> = { ru: '🇷🇺 RU', en: '🇬🇧 EN' };
  const LANGS = AVAILABLE.map((code) => ({ code, text: FLAGS[code] }));
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

  const extra: Container[] = [];

  // Вход в аккаунт платформы. Строго по нажатию игрока (п. 1.2.1) и никогда не
  // обязателен: гость играет и сохраняется как прежде (п. 1.2.2). Нужен он ради
  // п. 1.13.3 — чтобы прогресс и купленные 💎 были доступны с других устройств,
  // а не жили в localStorage, который на iOS чистится сам.
  if (canOfferAuth() && !isAuthorized()) {
    const authBtn = new Button({
      text: t('🔑 Войти в аккаунт', '🔑 Sign in'),
      w: W - pad * 2, h: 44, color: COLORS.card, textColor: COLORS.ink, fontSize: 15,
    });
    authBtn.position.set(W / 2, y + 22);
    authBtn.onTap = () => {
      void openAuthDialog().then((ok) => {
        if (!ok) return;
        ctx.toast(t('Готово — прогресс теперь сохраняется в вашем аккаунте',
          'Done — your progress is now saved to your account'));
        close();
      });
    };
    extra.push(authBtn);
    y += 52;

    const hint = new Text({
      text: t('Гостевой прогресс останется на этом устройстве, пока вы не войдёте.',
        'Guest progress stays on this device until you sign in.'),
      style: {
        fontFamily: FONT, fontSize: 12, fontWeight: '600', fill: COLORS.inkSoft,
        wordWrap: true, wordWrapWidth: W - pad * 2, lineHeight: 16, align: 'center',
      },
    });
    hint.anchor.set(0.5, 0);
    hint.position.set(W / 2, y - 8);
    extra.push(hint);
    y += hint.height + 8;
  }

  // «⭐ Оценить игру» — постоянный дубль автоматической просьбы (GAME.md §17.6):
  // лояльный игрок оценит сам, и его не надо ловить пиком радости. Кнопку рисуем
  // только когда платформа реально примет оценку (canReview: не гость, ещё не
  // оценивал, в этой сессии не спрашивали) — мёртвых кнопок в игре быть не должно.
  if (canOfferReview()) {
    const rateBtn = new Button({
      text: t('⭐ Оценить игру', '⭐ Rate the game'),
      w: W - pad * 2, h: 44, color: COLORS.card, textColor: COLORS.ink, fontSize: 15,
    });
    rateBtn.position.set(W / 2, y + 22);
    rateBtn.onTap = () => {
      void requestReview().then((sent) => {
        if (!sent) return; // закрыл окно — молча, без уговоров
        ctx.toast(t('Спасибо за оценку! ❤️', 'Thank you for the review! ❤️'));
        close();
      });
    };
    extra.push(rateBtn);
    y += 52;
  }

  // Политика конфиденциальности — п. 3.5: её текст обязан быть в самой игре.
  const privacyBtn = new Button({
    text: t('🔒 Конфиденциальность', '🔒 Privacy'),
    w: W - pad * 2, h: 42, color: COLORS.card, textColor: COLORS.ink, fontSize: 14,
  });
  privacyBtn.position.set(W / 2, y + 21);
  privacyBtn.onTap = () => ctx.openPrivacy();
  extra.push(privacyBtn);
  y += 52;

  // Сброс прогресса — ТОЛЬКО в dev-сборке (DEVTOOLS): нужен для прогона обучения
  // и проверок с нуля. В релизе кнопки нет — слишком дорогая ошибка в один тап,
  // а политика (п. 3.5) обещает удаление прогресса через очистку данных сайта и
  // настройки аккаунта платформы, а не через кнопку в игре.
  // Кнопка нарочно неприметная (цвет карточки, не акцент) и ведёт в отдельное
  // подтверждение.
  if (DEVTOOLS) {
    const resetBtn = new Button({
      text: t('🗑 Сбросить прогресс', '🗑 Reset progress'),
      w: W - pad * 2, h: 42, color: COLORS.card, textColor: COLORS.inkSoft, fontSize: 14,
    });
    resetBtn.position.set(W / 2, y + 21);
    resetBtn.onTap = () => ctx.openResetConfirm();
    extra.push(resetBtn);
    y += 52;
  }

  const closeBtn = new Button({ text: t('Готово', 'Done'), w: W - pad * 2, h: 46, color: COLORS.primary, fontSize: 16 });
  closeBtn.position.set(W / 2, y + 23);
  closeBtn.onTap = close;
  y += 58;

  root.addChild(panel(W, y, COLORS.hud, 18), title, volCap, pctT, sl, langCap, ...langBtns, ...extra, closeBtn);
  return root;
}

/**
 * Подтверждение сброса прогресса (⚙️ Настройки → «🗑 Сбросить прогресс»).
 *
 * Действие необратимое и затирает в том числе облачную копию, поэтому здесь —
 * честная сводка того, что теряется, а «Отмена» стоит акцентной кнопкой. Сам
 * сброс делает Game (onConfirm): он же пересобирает сцену и ждёт записи в облако,
 * поэтому на время ожидания кнопки гаснут, а панель закрывает Game.
 */
export function buildResetConfirm(ctx: UiContext, close: () => void, onConfirm: () => void): Container {
  const W = 340;
  const pad = 22;
  const root = new Container();

  const title = label(t('Сбросить прогресс?', 'Reset progress?'), 19, COLORS.ink, '800');
  title.position.set(W / 2, 30);

  const cats = ctx.state.cats.length;
  const sub = label(
    t(`Сейчас: ⭐ Ур. ${ctx.state.level},  🐱 ${cats}`, `Now: ⭐ Lv. ${ctx.state.level},  🐱 ${cats}`),
    13, COLORS.inkSoft, '700',
  );
  sub.position.set(W / 2, 54);

  const body = new Text({
    text: t(
      'Игра начнётся с нуля: котики, монеты, гены, уровень лаборатории, открытые породы и рецепты пропадут.\n\n'
      + 'Сбрасывается и облачная копия — вернуть прогресс с другого устройства будет нельзя. '
      + 'Кристаллы 💎 на счету сохранятся, но потраченные не возвращаются.',
      'The game starts over: cats, coins, genes, lab level, discovered breeds and recipes will be gone.\n\n'
      + 'The cloud copy is reset too — progress cannot be restored from another device. '
      + 'Your 💎 balance carries over, but spent crystals are not refunded.',
    ),
    style: {
      fontFamily: FONT, fontSize: 13, fontWeight: '600', fill: COLORS.ink,
      wordWrap: true, wordWrapWidth: W - pad * 2, lineHeight: 18, align: 'left',
    },
  });
  body.anchor.set(0, 0);
  body.position.set(pad, 78);

  let y = 78 + body.height + 16;
  const gap = 12;
  const bw = (W - pad * 2 - gap) / 2;
  const noBtn = new Button({ text: t('Отмена', 'Cancel'), w: bw, h: 48, color: COLORS.primary, fontSize: 16 });
  noBtn.position.set(pad + bw / 2, y + 24);
  noBtn.onTap = close;
  const yesBtn = new Button({
    text: t('Сбросить', 'Reset'), w: bw, h: 48, color: COLORS.card, textColor: COLORS.ink, fontSize: 16,
  });
  yesBtn.position.set(pad + bw + gap + bw / 2, y + 24);
  yesBtn.onTap = () => {
    yesBtn.enabled = false;
    noBtn.enabled = false;
    yesBtn.setText(t('Сбрасываю…', 'Resetting…'));
    onConfirm();
  };
  y += 56;

  root.addChild(panel(W, y, COLORS.hud, 18), title, sub, body, noBtn, yesBtn);
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

    const sub = label(t('Ускоряют рост и рецепты, лечат котов, заряжают усилители', 'Speed up growth and recipes, heal cats, charge boosters'), 11.5, COLORS.inkSoft, '600');
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

    const note = label(t('Покупки проходят через игровую платформу', 'Purchases go through the game platform'), 10.5, COLORS.inkSoft, '600');
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
        ? t('поднять потолок: 🌙 «Ночной смотритель» в Улучшениях', 'raise the cap: 🌙 "Night keeper" in Upgrades')
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

/**
 * Панель «Обучение пройдено»: поздравление + подарок за прохождение (💰 + 💎) с
 * кнопкой «Забрать». Тостом такой момент не подать — он живёт пару секунд и
 * теряется среди прочих; финал обучения заслуживает отдельного окна.
 * Начисление висит на `claim` (его же зовёт закрытие окна — подарок не теряется).
 */
export function buildTutorialDonePanel(ctx: UiContext, claim: () => void): Container {
  void ctx;
  const W = 340;
  const pad = 24;
  const root = new Container();
  const parts: Container[] = [];

  const title = label(t('🎓 Обучение пройдено!', '🎓 Tutorial complete!'), 20, COLORS.ink, '800');
  title.position.set(W / 2, 32);
  parts.push(title);

  let y = 54;

  const plate = panel(W - pad * 2, 76, COLORS.card, 14);
  plate.position.set(pad, y);
  const cong = new Text({
    text: t('Поздравляем! Ты прошёл всю петлю лаборатории: анализ → вязка → малыш → пристройство → заказы → выставка.',
      'Congratulations! You have been through the whole lab loop: analysis → breeding → kitten → giving away → orders → the show.'),
    style: {
      fontFamily: FONT, fontSize: 12.5, fontWeight: '700', fill: COLORS.inkSoft,
      align: 'center', wordWrap: true, wordWrapWidth: W - pad * 2 - 20, lineHeight: 17,
    },
  });
  cong.anchor.set(0.5, 0.5);
  cong.position.set(W / 2, y + 38);
  parts.push(plate, cong);
  y += 88;

  // Подарок — на золотой плашке, как главный герой окна.
  const gift = panel(W - pad * 2, 44, COLORS.coins, 12);
  gift.position.set(pad, y);
  const gt = label(
    t(`🎁 Подарок: 💰 +${TUTORIAL_REWARD_COINS} и 💎 +${TUTORIAL_REWARD_CRYSTALS}`,
      `🎁 Gift: 💰 +${TUTORIAL_REWARD_COINS} and 💎 +${TUTORIAL_REWARD_CRYSTALS}`),
    16, 0xffffff, '800',
  );
  gt.position.set(W / 2, y + 22);
  parts.push(gift, gt);
  y += 56;

  const next = new Text({
    text: t('Дальше — Генолаб: 📖 Котодекс и рецепты пород. Подсказки всегда под кнопкой ℹ️ у названия комнаты.',
      'Next stop — the Genolab: 📖 the Catdex and breed recipes. Help is always behind the ℹ️ button next to the room title.'),
    style: {
      fontFamily: FONT, fontSize: 11.5, fontWeight: '600', fill: COLORS.inkSoft,
      align: 'center', wordWrap: true, wordWrapWidth: W - pad * 2, lineHeight: 16,
    },
  });
  next.anchor.set(0.5, 0);
  next.position.set(W / 2, y);
  parts.push(next);
  y += next.height + 14;

  const claimBtn = new Button({ text: t('🎁 Забрать', '🎁 Claim'), w: W - pad * 2, h: 48, color: COLORS.good, textColor: 0xffffff, fontSize: 17 });
  claimBtn.position.set(W / 2, y + 24);
  claimBtn.onTap = claim;
  parts.push(claimBtn);
  y += 60;

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
 * Финал коллекции: выведены ВСЕ породы каталога. Панель одноразовая — её ставит
 * в очередь Game.checkAllBreeds, он же взводит флаг state.allBreedsCongratsSeen.
 * Вид — золотая витрина: салют по шапке, три легендарные мордочки-медальона,
 * счётчик «N / N» и благодарность за игру.
 */
export function buildAllBreedsPanel(ctx: UiContext, close: () => void): Container {
  const W = 360;
  const pad = 22;
  const GOLD = TIER_COLOR.legendary; // цвет легендарного тира — он же цвет финала
  const root = new Container();
  const parts: Container[] = [];

  // --- шапка: золотая лента с салютом, кубком и заголовком ---
  const bandH = 104;
  const band = new Graphics();
  band.roundRect(0, 0, W, bandH, 18).fill({ color: GOLD });
  band.rect(0, bandH - 20, W, 20).fill({ color: GOLD }); // низ ленты — прямой, стык с панелью
  // салют: звёздочки и конфетти (фиксированные точки — картинка одна и та же
  // при каждом показе, случайность здесь ничего не даёт)
  const confetti: ReadonlyArray<readonly [x: number, y: number, r: number]> = [
    [26, 22, 3], [58, 46, 2], [92, 18, 2.5], [128, 40, 2], [300, 24, 3],
    [268, 48, 2], [332, 44, 2.5], [232, 20, 2], [196, 52, 2], [160, 26, 2.5],
  ];
  for (const [cx, cy, r] of confetti) band.circle(cx, cy, r).fill({ color: 0xffffff, alpha: 0.5 });
  for (const [sx, sy, sr] of [[36, 62, 9], [324, 70, 8], [70, 24, 7]] as const) {
    band.star(sx, sy, 5, sr, sr * 0.45).fill({ color: 0xffffff, alpha: 0.42 });
  }
  parts.push(band);

  const cup = label('🏆', 34, 0xffffff, '800');
  cup.position.set(W / 2, 38);
  const title = label(t('Коллекция собрана!', 'The collection is complete!'), 21, 0xffffff, '800');
  title.position.set(W / 2, bandH - 26);
  parts.push(cup, title);

  let y = bandH + 14;

  // --- три легендарные мордочки в золотых кольцах (парад вершины селекции) ---
  const trio = BREEDS.filter((b) => b.tier === 'legendary').slice(0, 3);
  const r = 34;
  const gap = 26;
  let mx = W / 2 - ((r * 2 * trio.length + gap * (trio.length - 1)) / 2) + r;
  for (const b of trio) {
    const m = new Container();
    const back = new Graphics();
    back.circle(0, 0, r * 1.16).fill({ color: GOLD, alpha: 0.16 });
    back.circle(0, 3, r).fill({ color: COLORS.ink, alpha: 0.12 });
    back.circle(0, 0, r).fill({ color: mixColor(COLORS.hud, GOLD, 0.16) });
    m.addChild(back);
    const face = breedFaceTexture(ctx.app, b.key);
    if (face) {
      const sp = new Sprite(face);
      sp.anchor.set(0.5);
      sp.scale.set((r * 2) / face.width);
      m.addChild(sp);
    } else {
      m.addChild(label('🐾', r * 0.9, COLORS.inkSoft, '700'));
    }
    m.addChild(new Graphics().circle(0, 0, r).stroke({ width: 3, color: GOLD }));
    m.position.set(mx, y + r);
    parts.push(m);
    mx += r * 2 + gap;
  }
  y += r * 2 + 14;

  // --- счётчик пород: все до единой ---
  const countPlate = panel(W - pad * 2, 40, mixColor(COLORS.card, GOLD, 0.18), 12);
  countPlate.position.set(pad, y);
  const countT = label(
    t(`🐈 ${BREEDS.length} / ${BREEDS.length} пород выведено`, `🐈 ${BREEDS.length} / ${BREEDS.length} breeds obtained`),
    16, INK, '800',
  );
  countT.position.set(W / 2, y + 20);
  parts.push(countPlate, countT);
  y += 52;

  // --- поздравление и благодарность ---
  const wrapText = (text: string, size: number, color: number, weight: '700' | '800'): Text => new Text({
    text,
    style: {
      fontFamily: FONT, fontSize: size, fontWeight: weight, fill: color,
      align: 'center', wordWrap: true, wordWrapWidth: W - pad * 2 - 20, lineHeight: size + 5,
    },
  });

  const cong = wrapText(
    t('Поздравляем! Вы вывели все существующие породы кошек!',
      'Congratulations! You have bred every cat breed there is!'),
    15, INK, '800',
  );
  cong.anchor.set(0.5, 0);
  const thanks = wrapText(
    t('На этом пока всё, благодарим вас за игру! ❤️',
      'That is all for now — thank you for playing! ❤️'),
    13, INK_SOFT, '700',
  );
  thanks.anchor.set(0.5, 0);

  const textH = cong.height + 10 + thanks.height;
  const textPlate = panel(W - pad * 2, textH + 28, COLORS.card, 14);
  textPlate.position.set(pad, y);
  cong.position.set(W / 2, y + 14);
  thanks.position.set(W / 2, y + 14 + cong.height + 10);
  parts.push(textPlate, cong, thanks);
  y += textH + 40;

  const btn = new Button({ text: t('❤️ Спасибо!', '❤️ Thank you!'), w: W - pad * 2, h: 48, color: GOLD, textColor: 0xffffff, fontSize: 17 });
  btn.position.set(W / 2, y + 24);
  btn.onTap = close;
  parts.push(btn);
  y += 60;

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

    const grow = label(t('пол проявится, когда подрастёт 🌱', 'the sex appears once it grows up 🌱'), 12, COLORS.inkSoft, '600');
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
        const r = moveCat(ctx.state, cat.id, room, ctx.now());
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
    // растёт вдвое медленнее и блокирует слот, пока его не унесут в комнату.
    if (held) {
      const keep = new Button({
        text: t('🐾 Оставить с родителями', '🐾 Leave it with the parents'), w: W - 60, h: 44, color: COLORS.warn,
        textColor: COLORS.ink, fontSize: 15,
      });
      keep.position.set(W / 2, y + 22);
      keep.onTap = () => {
        keepKittenWithParents(ctx.state, cat.id, ctx.now());
        ctx.commit();
        ctx.toast(t('Малыш остался с роднёй 🐾 (в слоте растёт вдвое дольше)', 'The kitten stayed with its family 🐾 (in the slot it grows twice as long)'));
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
    sfxEvent('buy');
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
      const r = moveCat(ctx.state, cat.id, room, ctx.now());
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

  const title = label(stackWords(breedName(cat.breed)), V(20, 19), tierCol, '800');
  title.anchor.set(0.5, 0);
  title.position.set(W / 2, 16);

  let y = 16 + title.height + 16;
  const st = stars(cat.rarityTier, 15);
  st.position.set(W / 2, y); y += 22;
  const tierT = label(t(`🍼 котёнок · ${tierName(cat.rarityTier)}`, `🍼 kitten · ${tierName(cat.rarityTier)}`), 13, tierCol, '800');
  tierT.position.set(W / 2, y); y += 22;
  const hint = label(t('пол проявится, когда подрастёт 🌱', 'the sex appears once it grows up 🌱'), V(12.5, 12), V(INK_SOFT, COLORS.inkSoft), V('700', '600'));
  hint.position.set(W / 2, y); y += 24;

  // шкала взросления (заполняется в реальном времени)
  const barW = W - 60, barH = 14, barX = (W - barW) / 2, barY = y;
  const barBg = new Graphics();
  if (VIVID) { // светлый жёлоб в рамке: видно и пустую шкалу роста
    barBg.roundRect(barX, barY, barW, barH, 7)
      .fill({ color: 0xffffff, alpha: 0.95 })
      .stroke({ width: 2, color: COLORS.primary, alpha: 0.5 });
  } else {
    barBg.roundRect(barX, barY, barW, barH, 7).fill({ color: 0x000000, alpha: 0.08 });
  }
  const bar = new Graphics();
  const timeT = label('', V(13.5, 13), V(INK, COLORS.ink), V('800', '700'));
  timeT.position.set(W / 2, barY + barH + 16);
  y = barY + barH + 34;

  // Малышу, «оставленному с роднёй», срок удвоен (KITTEN_SLOW_FACTOR) — таймер выше
  // показывает уже растянутый остаток, поэтому строкой поясняем причину и выход.
  const slowNote: Container[] = [];
  if (cat.growthMs) {
    const note = label(
      t('в слоте растёт вдвое дольше', 'in the slot it grows twice as long'),
      V(12, 11.5), V(INK_SOFT, COLORS.inkSoft), V('700', '600'),
    );
    note.position.set(W / 2, y);
    slowNote.push(note);
    y += 20;
  }

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

  // Ускорение роста: одно подменю «Вырастить сейчас» — там подарок 🎁 (пока запас цел),
  // иначе выбор 📺 реклама или 💎 кристаллы. Счётчик подарков — сразу на кнопке.
  const growFree = ctx.state.freeGrowthLeft;
  addBtn(growFree > 0
    ? t(`🌱 Вырастить сейчас · 🎁 ${growFree}`, `🌱 Grow up now · 🎁 ${growFree}`)
    : t('🌱 Вырастить сейчас', '🌱 Grow up now'),
  COLORS.primary, true, () => ctx.openGrowConfirm(cat));

  addMoveButtons(ctx, cat, close, addBtn);
  addAdoptButton(ctx, cat, addBtn); // малыша из окошка вязки можно сразу пристроить

  const closeBtn = new Button({ text: t('Закрыть', 'Close'), w: btnW, h: 40, color: COLORS.cardEdge, textColor: COLORS.ink, fontSize: 14 });
  closeBtn.position.set(W / 2, y + 20);
  closeBtn.onTap = close;
  y += 50;

  const kitBg = panel(W, y, V(lighten(tierCol, 0.92), COLORS.hud), 18);
  if (VIVID) kitBg.roundRect(0, 0, W, y, 18).stroke({ width: 3, color: tierCol, alpha: 0.5 });
  root.addChild(kitBg, title, st, tierT, hint, barBg, bar, timeT, ...slowNote, ...controls, closeBtn);

  const mmss = (ms: number): string => {
    const s = Math.max(0, Math.ceil(ms / 1000));
    return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
  };
  const redraw = (): void => {
    const p = growthProgress(cat, ctx.now());
    bar.clear();
    const bw = Math.max(2, barW * p);
    bar.roundRect(barX, barY, bw, barH, 7).fill(COLORS.primary);
    if (VIVID) bar.roundRect(barX + 2, barY + 2, Math.max(1, bw - 4), barH * 0.34, 4).fill({ color: 0xffffff, alpha: 0.38 });
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
 * Подменю «Вырастить сейчас» котёнка (из инфо-меню). Пути ускорения роста: подарочный
 * (первые FREE_GROWTH_COUNT котят — бесплатно и мгновенно, `freeGrowKitten`; пока запас
 * цел, платных вариантов не показываем), затем 📺 реклама (−N мин, повторяемо) и
 * 💎 кристаллы (мгновенно, цена ∝ остатку роста, ставка GROWTH_SPEEDUP_CRYSTAL_PER_MIN).
 * После действия переоткрываем меню кота: если ещё котёнок — снова его карточка,
 * если вырос — меню взрослого (там уже видны пол, имя и облик).
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

  // Подарок новой игры: пол, имя и облик проявляются только у взрослого — первые
  // FREE_GROWTH_COUNT котят растим бесплатно, счётчик остатка на кнопке и в тосте.
  const freeLeft = ctx.state.freeGrowthLeft;
  if (freeLeft > 0) {
    // Счётчик — строкой над кнопкой (не под заголовком: там он налезал бы на котёнка).
    const counter = label(
      t(`🎁 Бесплатных ускорений роста: ${freeLeft} из ${FREE_GROWTH_COUNT}`, `🎁 Free grow-ups left: ${freeLeft} of ${FREE_GROWTH_COUNT}`),
      12.5, COLORS.ink, '800',
    );
    counter.position.set(W / 2, y);
    y += 22;
    const freeBtn = new Button({
      text: t(`🎁 Бесплатно · осталось ${freeLeft}`, `🎁 Free · ${freeLeft} left`),
      w: btnW, h: 44, color: COLORS.warn, textColor: COLORS.ink, fontSize: 14,
    });
    freeBtn.position.set(W / 2, y + 22);
    freeBtn.onTap = () => {
      const r = freeGrowKitten(ctx.state, cat.id, ctx.now());
      if (!r.ok) { ctx.toast(r.reason); return; }
      ctx.commit();
      ctx.toast(r.left > 0
        ? t(`Котик вырос! 🌱 бесплатных осталось ${r.left}`, `The cat has grown up! 🌱 ${r.left} free left`)
        : t('Котик вырос! 🌱 подарки кончились — дальше 📺 или 💎', 'The cat has grown up! 🌱 no free ones left — next: 📺 or 💎'));
      close(); ctx.openCatMenu(cat);
    };
    root.addChild(counter, freeBtn);
    y += 52;

    const closeOnly = new Button({ text: t('Закрыть', 'Close'), w: btnW, h: 40, color: COLORS.cardEdge, textColor: COLORS.ink, fontSize: 14 });
    closeOnly.position.set(W / 2, y + 20);
    closeOnly.onTap = close;
    root.addChild(closeOnly);
    y += 50;

    root.addChildAt(panel(W, y, COLORS.hud, 18), 0);
    return root;
  }

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

  // Цена — от остатка в обычном масштабе: за тесноту слота игрок не доплачивает
  // (полный скип = те же 3 💎, хоть у малыша на таймере и 30 мин).
  const gcost = speedUpCost(growthBillableMs(cat, ctx.now()), GROWTH_SPEEDUP_CRYSTAL_PER_MIN);
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

/** Смешать два цвета: f=0 → a, f=1 → b (мягкие подложки медальонов). */
function mixColor(a: number, b: number, f: number): number {
  const ch = (sh: number): number => {
    const x = Math.round((((a >> sh) & 0xff) * (1 - f)) + (((b >> sh) & 0xff) * f));
    return Math.max(0, Math.min(255, x));
  };
  return (ch(16) << 16) | (ch(8) << 8) | ch(0);
}

/**
 * Дерево родословной кота — вертикальное: сам кот стоит корнем внизу, предки
 * растут кроной вверх (родители → деды → прадеды). Узел — круглый медальон с
 * мордочкой своей породы (вырезается из спрайта, см. ui/breedFace.ts) в кольце
 * цвета тира; чем ближе поколение к коту, тем медальон крупнее. Мать всегда
 * слева, отец справа — на медальоне это ещё и бейдж ♀/♂.
 *
 * Туман родословной: рисуются только ИЗВЕСТНЫЕ узлы (known), неизвестный предок —
 * серый медальон с силуэтом и «?» БЕЗ намёка на тир, его ветка не раскрывается.
 * Вскрыть всё — Генетический анализ (кнопка внизу). Панель шире экрана? Game
 * вписывает её целиком (showOverlay → fitOverlay).
 */
export function buildPedigreePanel(ctx: UiContext, cat: Cat, close: () => void): Container {
  const root = new Container();

  const ped = catAncestors(cat);
  const subject: Ancestor = { id: cat.id, breed: cat.breed, known: true, mother: ped.mother, father: ped.father };
  const maxDepth = PEDIGREE_DEPTH; // 0=кот, 1=родители, 2=деды, 3=прадеды

  // Геометрию дерева НЕ множим на UI_SCALE: полная родословная — это восемь
  // прадедов в ряд, и на телефоне раздутую панель fitOverlay всё равно сжал бы
  // обратно, только вместе с текстом. Растут (k) лишь подписи.
  const k = UI_SCALE;
  const R = [38, 29, 25, 22];                                  // радиус медальона по поколению
  const rOf = (d: number): number => R[Math.min(d, R.length - 1)]!;
  const rowH = 112;                                            // шаг поколений
  // Шаг соседей: в полном дереве восемь прадедов в ряд — там он минимальный, а в
  // коротком (родители известны, деды ещё нет) медальонам дают больше воздуха.
  const colW = pedigreeDepth(cat) >= 3 ? 80 : pedigreeDepth(cat) === 2 ? 90 : 106;
  const padX = 14, padTop = 52;
  const capH = 30;                                             // табличка с названием под медальоном

  // Раскладка — строгая генеалогическая сетка: у каждого узла свой слот (мать —
  // левая половина отрезка отца-и-матери, отец — правая), поэтому дерево всегда
  // симметрично, кот стоит ровно по центру, а пропуски (предок неизвестен либо
  // его вовсе нет в данных) остаются честными пустотами, а не перекашивают ряды.
  type Placed = { node: Ancestor; depth: number; slot: number; isRoot: boolean; sex: 'female' | 'male' | null };
  const placed: Placed[] = [];
  const links: Array<[number, number, number]> = [];           // слот ребёнка, его глубина, слот родителя
  let usedDepth = 0;

  const layout = (node: Ancestor, depth: number, slot: number, isRoot: boolean, sex: Placed['sex']): void => {
    usedDepth = Math.max(usedDepth, depth);
    placed.push({ node, depth, slot, isRoot, sex });
    // в поддерево неизвестного узла не заглядываем — «???» схлопывает ветку
    if (depth >= maxDepth || !node.known) return;
    if (node.mother) { links.push([slot, depth, slot * 2]); layout(node.mother, depth + 1, slot * 2, false, 'female'); }
    if (node.father) { links.push([slot, depth, slot * 2 + 1]); layout(node.father, depth + 1, slot * 2 + 1, false, 'male'); }
  };
  layout(subject, 0, 0, true, cat.genotype.sex === 'male' ? 'male' : 'female');

  // ряд d считаем снизу вверх: 0 (кот) — самый нижний
  const yOf = (d: number): number => padTop + (usedDepth - d) * rowH + rOf(0);
  // ширина слота удваивается с каждым поколением вниз: корень занимает всю крону
  const spanOf = (d: number): number => colW * Math.pow(2, usedDepth - d);
  const treeW = padX * 2 + spanOf(0);
  const W = Math.max(392, treeW);
  const dx = (W - treeW) / 2;
  const xOf = (d: number, slot: number): number => padX + dx + (slot + 0.5) * spanOf(d);
  const treeBottom = yOf(0) + rOf(0) + capH + 6;
  const known = pedigreeDepth(cat); // поколений предков в данных (включая туман)
  const fog = pedigreeHasFog(cat);  // есть ли скрытые узлы — предложим анализ

  // полки-подложки поколений: мягкая полоса за каждым рядом (у корня — в цвет
  // его тира), чтобы поколения читались рядами, а не россыпью кружков
  const shelves = new Graphics();
  const rootX = xOf(0, 0);
  for (let d = 0; d <= usedDepth; d++) {
    const r = rOf(d);
    const yc = yOf(d);
    if (d === 0) {
      // у корня полка короткая — постамент под самим котом, а не пустая полоса
      const w = Math.max(224, colW * 2);
      shelves.roundRect(rootX - w / 2, yc - r - 10, w, r * 2 + capH + 14, 18)
        .fill({ color: mixColor(COLORS.card, TIER_COLOR[tierOfBreed(cat.breed)], 0.2), alpha: 0.95 });
    } else {
      shelves.roundRect(padX, yc - r - 8, W - padX * 2, r * 2 + capH + 10, 16)
        .fill({ color: COLORS.card, alpha: 0.6 });
    }
  }

  // Ветки: от макушки ребёнка вверх, развилка идёт НИЗОМ коридора (сразу над
  // ребёнком) и лишь потом поднимается к родителю. Так горизонталь не режет
  // таблички с названиями — они висят под медальонами родителей, а концы веток
  // прячутся под ними: медальоны рисуются поверх проводов.
  const wires = new Graphics();
  for (const [cSlot, cd, pSlot] of links) {
    const x1 = xOf(cd, cSlot), x2 = xOf(cd + 1, pSlot);
    const yTop = yOf(cd) - rOf(cd) - 2;          // макушка ребёнка
    const yBot = yOf(cd + 1) + rOf(cd + 1) - 2;  // низ родителя (уходит под кольцо)
    const yBand = yTop - 13;                     // полоса развилки
    wires.moveTo(x1, yTop).lineTo(x1, yBand);
    if (Math.abs(x2 - x1) < 1) {
      wires.lineTo(x2, yBot);
    } else {
      const rr = Math.min(14, Math.abs(x2 - x1) / 2, Math.max(2, (yBand - yBot) / 2));
      wires.moveTo(x1, yBand).arcTo(x2, yBand, x2, yBot, rr).lineTo(x2, yBot);
    }
  }
  wires.stroke({ width: 2.5, color: mixColor(COLORS.cardEdge, COLORS.ink, 0.28), alpha: 1 });

  // силуэт мордочки для узла в тумане — ушки + голова, без намёка на породу
  const unknownFace = (r: number): Graphics => {
    const g = new Graphics();
    const s = r / 22;
    g.moveTo(-11 * s, -2 * s).lineTo(-9 * s, -13 * s).lineTo(-1 * s, -6 * s).closePath();
    g.moveTo(11 * s, -2 * s).lineTo(9 * s, -13 * s).lineTo(1 * s, -6 * s).closePath();
    g.circle(0, 2 * s, 10 * s);
    g.fill({ color: COLORS.inkSoft, alpha: 0.26 });
    return g;
  };

  // медальон: тень → подложка в цвет тира → мордочка породы → кольцо → бейдж ♀/♂
  const medallion = (p: Placed): Container => {
    const c = new Container();
    const r = rOf(p.depth);
    const hidden = !p.isRoot && !p.node.known;
    const tier = tierOfBreed(p.node.breed);
    const col = hidden ? COLORS.cardEdge : TIER_COLOR[tier];

    const back = new Graphics();
    if (!hidden && (tier === 'epic' || tier === 'legendary')) {
      back.circle(0, 0, r * 1.3).fill({ color: col, alpha: 0.10 });
      back.circle(0, 0, r * 1.15).fill({ color: col, alpha: 0.14 });
    }
    back.circle(0, 3, r).fill({ color: COLORS.ink, alpha: 0.12 });
    back.circle(0, 0, r).fill({ color: hidden ? COLORS.card : mixColor(COLORS.hud, col, 0.16) });
    c.addChild(back);

    if (hidden) {
      c.addChild(unknownFace(r));
      const q = label('?', r * 0.95, COLORS.inkSoft, '800');
      q.alpha = 0.85;
      c.addChild(q);
    } else {
      const face = breedFaceTexture(ctx.app, p.node.breed);
      if (face) {
        const sp = new Sprite(face);
        sp.anchor.set(0.5);
        sp.scale.set((r * 2) / face.width);
        c.addChild(sp);
      } else {
        c.addChild(label('🐾', r * 0.9, COLORS.inkSoft, '700'));
      }
    }

    const ring = new Graphics()
      .circle(0, 0, r)
      .stroke({ width: p.isRoot ? 4 : 3, color: col, alpha: hidden ? 0.8 : 1 });
    c.addChild(ring);

    if (p.sex) {
      const br = r * 0.36;
      const bx = r * 0.72, by = r * 0.72;
      const badge = new Graphics()
        .circle(bx, by, br)
        .fill({ color: p.sex === 'female' ? COLORS.primary : COLORS.secondary })
        .stroke({ width: 2, color: COLORS.hud });
      const sign = label(p.sex === 'female' ? '♀' : '♂', br * 1.5, COLORS.hud, '800');
      sign.position.set(bx, by);
      c.addChild(badge, sign);
    }

    // Табличка с названием: у корня — кличка кота, у предков — порода (в тумане
    // «???»). Плашка непрозрачная и рисуется поверх веток — конец провода уходит
    // под неё, поэтому длинные названия не спорят с чертежом.
    const name = hidden ? '???'
      : p.isRoot ? (cat.name?.trim() || breedName(p.node.breed)) : breedName(p.node.breed);
    // Длинные породы («Домашняя короткошёрстная») уводило в три строки с разрывом
    // слова, и таблички соседей смыкались — поэтому кегль подбираем под две строки.
    const capW = p.isRoot ? 160 : colW - 2;
    const mkCap = (size: number): Text => new Text({
      text: name,
      style: {
        fontFamily: FONT, fontSize: size, fontWeight: p.isRoot ? '800' : '700',
        fill: hidden ? COLORS.inkSoft : COLORS.ink, wordWrap: true, breakWords: true,
        wordWrapWidth: capW, lineHeight: size + 1.5, align: 'center',
      },
    });
    let cap = mkCap(p.isRoot ? 13 : p.depth >= 2 ? 10 : 10.5);
    for (const size of [9.5, 8.5]) {
      if (p.isRoot || cap.height <= (cap.style.lineHeight as number) * 2 + 1) break;
      cap.destroy();
      cap = mkCap(size);
    }
    cap.anchor.set(0.5, 0);
    cap.position.set(0, r + 6);
    // у кота с кличкой порода уходит второй строкой — иначе её негде прочитать
    const sub = p.isRoot && cat.name?.trim()
      ? label(breedName(p.node.breed), 10, COLORS.inkSoft, '700')
      : null;
    if (sub) { sub.anchor.set(0.5, 0); sub.position.set(0, r + 6 + cap.height + 2); }
    const textH = cap.height + (sub ? sub.height + 2 : 0);
    const plateW = Math.min(p.isRoot ? 180 : colW + 4, Math.max(cap.width, sub?.width ?? 0) + 14);
    const plate = new Graphics()
      .roundRect(-plateW / 2, r + 2, plateW, textH + 8, 8)
      .fill({ color: COLORS.hud, alpha: 0.97 });
    c.addChild(plate, cap);
    if (sub) c.addChild(sub);

    c.position.set(xOf(p.depth, p.slot), yOf(p.depth));
    return c;
  };

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
    footNote(t('узлы «???» скрыты — Генетический анализ вскроет всю родословную и скрытые гены', '"???" nodes are hidden — a Genetic analysis reveals the whole pedigree and its hidden genes'), COLORS.inkSoft);
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
  root.addChild(panel(W, H, COLORS.hud, 18), title, shelves, wires);
  for (const p of placed) root.addChild(medallion(p));
  root.addChild(...footer, closeBtn);
  return root;
}

/**
 * Подпись кнопки анализа в меню кота (Питомник и криокапсула): пока цел запас
 * подарочных анализов — со счётчиком 🎁, чтобы бесплатные было видно ещё до открытия
 * окна, а их исчерпание не выглядело внезапным подорожанием.
 */
function analyzeBtnLabel(ctx: UiContext): string {
  const left = ctx.state.freeAnalyzeLeft;
  return left > 0
    ? t(`🧬 Генетический анализ · 🎁 ${left}`, `🧬 Genetic analysis · 🎁 ${left}`)
    : t('🧬 Генетический анализ', '🧬 Genetic analysis');
}

/**
 * Подтверждение Генетического анализа (система знаний, этап B): вскрывает СРАЗУ
 * всю родословную кота и его скрытые гены (породы предков). Механику не меняет —
 * скрытые гены работали и до анализа. Оплата 💰 + 🧬 (цена по уровню лаборатории),
 * 💎 (ANALYZE_CRYSTAL_COST) или 📺 (бесплатно, без кулдауна); первые
 * FREE_ANALYZE_COUNT анализов в новой игре — подарок (см. freeAnalyzeCat).
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
  // Звук — ровно в момент готового анализа, вместе с открытием дерева: просто
  // «🌳 Родословная» из меню кота открывает то же окно молча (sfxEvent там нет).
  const done = (): void => { ctx.commit(); sfxEvent('analyze'); ctx.toast(t('Анализ готов 🧬 родословная вскрыта', 'Analysis done 🧬 pedigree revealed')); close(); ctx.openPedigree(cat); };

  // Подарок новой игры: первые FREE_ANALYZE_COUNT анализов бесплатны (см. freeAnalyzeCat) —
  // новичок должен успеть сравнить несколько родословных, прежде чем платить 💰 или 📺.
  // Пока подарки не кончились, платные варианты не показываем: одно очевидное действие.
  const left = ctx.state.freeAnalyzeLeft;
  const gift = left > 0 && !cat.analyzed;
  if (gift) {
    // Счётчик подарков — прямо над кнопкой: игрок должен видеть, сколько их осталось,
    // а не обнаружить цену внезапно, когда запас кончится.
    const counter = label(
      t(`🎁 Бесплатных анализов: ${left} из ${FREE_ANALYZE_COUNT}`, `🎁 Free analyses left: ${left} of ${FREE_ANALYZE_COUNT}`),
      13, COLORS.ink, '800',
    );
    counter.position.set(W / 2, 74);
    const freeBtn = new Button({
      text: t(`🎁 Бесплатно · осталось ${left}`, `🎁 Free · ${left} left`),
      w: btnW, h: 44, color: COLORS.warn, textColor: COLORS.ink, fontSize: 14,
    });
    freeBtn.position.set(W / 2, y + 22);
    freeBtn.onTap = () => {
      const r = freeAnalyzeCat(ctx.state, cat.id);
      if (!r.ok) { ctx.toast(r.reason); return; }
      ctx.commit();
      sfxEvent('analyze'); // подарочный анализ звучит так же, как платный
      // Тост вместо стандартного: после подарка сразу называем остаток запаса.
      ctx.toast(r.left > 0
        ? t(`Анализ готов 🧬 бесплатных осталось ${r.left}`, `Analysis done 🧬 ${r.left} free left`)
        : t('Анализ готов 🧬 подарки кончились — дальше 💰/🧬, 💎 или 📺', 'Analysis done 🧬 no free ones left — next: 💰/🧬, 💎 or 📺'));
      close();
      ctx.openPedigree(cat);
    };
    root.addChild(counter, freeBtn);
    y += 52;
  } else {
    // Основная цена — 💰 + 🧬 по УРОВНЮ ЛАБОРАТОРИИ (не по тиру кота): анализируют
    // каждого нового кота, и на старте цена должна быть посильной без рекламы.
    const price = analyzeCost(ctx.state.level);
    const afford = ctx.state.coins >= price.coins && ctx.state.dna >= price.dna;
    const payBtn = new Button({
      // Шрифт с запасом: на тач-экранах label крупнее в UI_SCALE раз, а самая
      // длинная цена (ур. 10 — 💰 150 + 🧬 50) должна влезать в кнопку целиком.
      text: t(`Провести · 💰 ${price.coins} + 🧬 ${price.dna}`, `Analyse · 💰 ${price.coins} + 🧬 ${price.dna}`),
      w: btnW, h: 44, color: afford ? COLORS.primary : COLORS.cardEdge,
      textColor: afford ? 0xffffff : COLORS.inkSoft, fontSize: 13,
    });
    payBtn.enabled = afford;
    payBtn.position.set(W / 2, y + 22);
    payBtn.onTap = () => {
      const r = analyzeCat(ctx.state, cat.id, 'pay', ctx.now());
      if (!r.ok) { ctx.toast(r.reason); return; }
      done();
    };
    root.addChild(payBtn);
    y += 52;

    // Две альтернативы в один ряд: 💎 (когда кончились монеты/гены) и 📺 бесплатно
    // без кулдауна. Ряд, а не две широкие кнопки: основное действие — оплата валютой.
    const halfW = (btnW - 8) / 2;
    const crystalOk = ctx.state.crystals >= ANALYZE_CRYSTAL_COST;
    const crystalBtn = new Button({
      text: `💎 ${ANALYZE_CRYSTAL_COST}`,
      w: halfW, h: 42, color: crystalOk ? COLORS.crystals : COLORS.cardEdge,
      textColor: crystalOk ? 0xffffff : COLORS.inkSoft, fontSize: 14,
    });
    crystalBtn.enabled = crystalOk;
    crystalBtn.position.set(W / 2 - halfW / 2 - 4, y + 21);
    crystalBtn.onTap = () => {
      const r = analyzeCat(ctx.state, cat.id, 'crystals', ctx.now());
      if (!r.ok) { ctx.toast(r.reason); return; }
      done();
    };
    // «Реклама» в тексте — требование п. 4.5.1: кнопка называет и ролик, и награду.
    // Две строки: в половинную ширину одна строка с обоими словами не влезает на тач.
    const adBtn = new Button({
      text: t('📺 Реклама\nбесплатно', '📺 Ad\nfree'),
      w: halfW, h: 42, color: COLORS.good, textColor: 0xffffff, fontSize: 11.5,
    });
    adBtn.position.set(W / 2 + halfW / 2 + 4, y + 21);
    adBtn.onTap = () => {
      void showRewarded().then((watched) => {
        if (!watched) { ctx.toast(t('Реклама недоступна', 'Ad unavailable')); return; }
        const r = analyzeCat(ctx.state, cat.id, 'ad', ctx.now());
        if (!r.ok) { ctx.toast(r.reason); return; }
        done();
      });
    };
    root.addChild(crystalBtn, adBtn);
    y += 50;
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
 * 🧪 Вскрытие колбы стола исследований — ЕДИНСТВЕННОЕ место, где называется
 * изученный рецепт: уведомление о готовности его намеренно не раскрывает, иначе
 * вскрывать было бы нечего. Панель собирается сразу целиком (высота не скачет),
 * анимация лишь показывает её по частям: колба кипит и дрожит → вспышка с
 * искрами → портрет породы «выпрыгивает» из света (в цвете, а затем застывает
 * силуэтом, если породу ещё не вывели) → имя, рецепт и кнопки. Тикер снимает
 * себя сам, когда оверлей закрыли (root.destroyed).
 */
export function buildRecipeRevealPanel(ctx: UiContext, recipe: Recipe, close: () => void): Container {
  const W = 340;
  const root = new Container();
  const breedKey = recipe.result;
  const tier = tierOfBreed(breedKey);
  const tierCol = TIER_COLOR[tier];
  const bred = breedDiscovered(ctx.state, breedKey);

  const title = label(t('🧪 Колба вскрыта', '🧪 The flask is open'), 18, COLORS.ink, '800');
  title.position.set(W / 2, 28);

  // --- сцена раскрытия ---
  const stageTop = 48;
  const stageH = 158;
  const cx = W / 2;
  const cy = stageTop + stageH / 2;
  const stageBg = new Graphics();
  stageBg.roundRect(cx - 120, stageTop, 240, stageH, 18)
    .fill({ color: lighten(COLORS.dna, 0.9) })
    .stroke({ width: 3, color: COLORS.dna, alpha: 0.5 });

  const glow = new Graphics();   // сияние под колбой, потом ореол портрета
  const burst = new Graphics();  // вспышка, кольцо и искры (рисуются покадрово)
  const flaskG = new Graphics();
  const flask = new Container();
  flask.addChild(flaskG);
  flask.position.set(cx, cy);

  // Портрет породы: силуэт (рецепт знаем, породу ещё не вывели) или цветной, если
  // порода уже выведена. Контейнер закреплён «по земле» — pop растит его вверх.
  const tex = breedThumbTexture(breedKey);
  const portrait = new Container();
  portrait.position.set(cx, stageTop + stageH - 12);
  let ghost: Sprite | null = null;
  if (tex) {
    const sp = new Sprite(tex);
    sp.anchor.set(0.5, 1);
    sp.scale.set(Math.min((stageH * 0.82) / tex.height, (W * 0.46) / tex.width));
    if (!bred) sp.tint = 0x241d29;
    portrait.addChild(sp);
    if (!bred) { // цветной «призрак» поверх силуэта: в свете вспышки порода видна вся
      ghost = new Sprite(tex);
      ghost.anchor.set(0.5, 1);
      ghost.scale.copyFrom(sp.scale);
      portrait.addChild(ghost);
    }
  } else {
    const paw = label('🐾', 52, bred ? COLORS.ink : darken(COLORS.ink, 0.55), '800');
    paw.position.set(0, -stageH * 0.36);
    portrait.addChild(paw);
  }
  portrait.alpha = 0;
  portrait.scale.set(0.3);

  root.addChild(title, stageBg, glow, portrait, flask, burst);

  // --- подписи (проявляются после вспышки) ---
  const info = new Container();
  let y = stageTop + stageH + 12;
  const name = label(stackWords(breedName(breedKey)), 19, tierCol, '800');
  name.anchor.set(0.5, 0);
  name.position.set(W / 2, y);
  info.addChild(name);
  y += name.height + 6;

  const st = stars(tier, 15);
  st.position.set(W / 2, y);
  info.addChild(st);
  y += 20;

  const tierT = label(tierName(tier), 12.5, tierCol, '800');
  tierT.position.set(W / 2, y);
  info.addChild(tierT);
  y += 20;

  const pairT = new Text({
    text: `🧪 ${describeRecipe(recipe).pair}`,
    style: {
      fontFamily: FONT, fontSize: 13 * UI_SCALE, fontWeight: '800', fill: COLORS.ink,
      wordWrap: true, wordWrapWidth: W - 48, lineHeight: 17 * UI_SCALE, align: 'center',
    },
  });
  pairT.anchor.set(0.5, 0);
  pairT.position.set(W / 2, y);
  info.addChild(pairT);
  y += pairT.height + 6;

  const status = label(
    bred ? t('📜 рецепт записан в Котодекс', '📜 the recipe is written into the Catdex')
      : t('📜 рецепт записан — породу ещё предстоит вывести', '📜 recipe written — the breed is yet to be bred'),
    12, COLORS.inkSoft, '700',
  );
  status.position.set(W / 2, y);
  info.addChild(status);
  y += 22;
  root.addChild(info);

  // --- кнопки (включаются, когда раскрытие доиграло) ---
  const btns = new Container();
  const openBtn = new Button({
    text: t('📖 Посмотреть в Котодексе', '📖 Open in the Catdex'), w: W - 60, h: 42,
    color: COLORS.primary, fontSize: 15,
  });
  openBtn.position.set(W / 2, y + 21);
  openBtn.onTap = () => ctx.openBreedCard(breedKey);
  y += 50;
  const okBtn = new Button({
    text: t('Отлично!', 'Great!'), w: 180, h: 40, color: COLORS.cardEdge,
    textColor: COLORS.ink, fontSize: 14,
  });
  okBtn.position.set(W / 2, y + 20);
  okBtn.onTap = close;
  y += 50;
  btns.addChild(openBtn, okBtn);
  root.addChild(btns);

  info.alpha = 0;
  btns.alpha = 0;
  btns.eventMode = 'none'; // пока раскрытие играет, по кнопкам не тыкают вслепую

  root.addChildAt(panel(W, y, COLORS.hud, 18), 0);

  // --- анимация ---
  const BOIL = 0.95; // сколько колба кипит и дрожит до вспышки
  const bubbles = Array.from({ length: 7 }, () => ({
    x: -24 + Math.random() * 48, r: 2.2 + Math.random() * 3, sp: 0.55 + Math.random() * 0.7, ph: Math.random(),
  }));
  interface Spark { x: number; y: number; vx: number; vy: number; r: number; col: number; life: number; max: number }
  const sparks: Spark[] = [];
  let tm = 0;
  let popped = false;

  /** Колба: стекло, реактив и поднимающиеся пузырьки (k — «накал» 0..1). */
  const drawFlask = (k: number): void => {
    flaskG.clear();
    const body = lighten(COLORS.dna, 0.86);
    flaskG.roundRect(-14, -66, 28, 22, 7).fill({ color: body }).stroke({ width: 3, color: COLORS.dna, alpha: 0.8 });
    flaskG.roundRect(-20, -76, 40, 12, 5).fill({ color: COLORS.cardEdge }).stroke({ width: 2, color: COLORS.dna, alpha: 0.5 });
    flaskG.roundRect(-44, -50, 88, 100, 26).fill({ color: body }).stroke({ width: 3, color: COLORS.dna, alpha: 0.8 });
    // реактив: уровень слегка «дышит» вместе с кипением
    const lvl = 6 + Math.sin(tm * 7) * 2 * k;
    flaskG.roundRect(-38, -6 - lvl, 76, 50 + lvl, 22).fill({ color: COLORS.dna, alpha: 0.6 });
    for (const b of bubbles) {
      const p = (tm * b.sp * (0.6 + k) + b.ph) % 1;
      flaskG.circle(b.x + Math.sin(p * 6.3) * 3, 40 - p * 52, b.r * (0.5 + p * 0.6))
        .fill({ color: 0xffffff, alpha: 0.55 * (1 - p * 0.7) });
    }
    flaskG.roundRect(-34, -44, 12, 40, 6).fill({ color: 0xffffff, alpha: 0.45 }); // блик на стекле
  };

  const tick = (tk: { deltaMS: number }): void => {
    if (root.destroyed) { ctx.app.ticker.remove(tick); return; }
    const dt = Math.min(0.05, tk.deltaMS / 1000);
    tm += dt;
    const q = tm - BOIL; // < 0 — колба ещё кипит

    if (q < 0) {
      const k = tm / BOIL;
      flask.x = cx + Math.sin(tm * 34) * (1 + 3.5 * k * k); // дрожь нарастает
      flask.rotation = Math.sin(tm * 27) * 0.035 * k;
      flask.scale.set(1 + 0.07 * k * k);
      glow.clear();
      glow.circle(cx, cy, 52 + 14 * k).fill({ color: COLORS.dna, alpha: 0.1 + 0.3 * k * k });
      drawFlask(k);
    } else {
      if (!popped) { // вспышка: колба «раскрывается» светом и брызгами
        popped = true;
        for (let i = 0; i < 16; i++) {
          const a = (i / 16) * Math.PI * 2 + Math.random() * 0.4;
          const v = 130 + Math.random() * 190;
          sparks.push({
            x: cx, y: cy, vx: Math.cos(a) * v, vy: Math.sin(a) * v - 40,
            r: 2.5 + Math.random() * 3.5, col: i % 2 ? tierCol : COLORS.dna,
            life: 0, max: 0.55 + Math.random() * 0.35,
          });
        }
      }
      const f = Math.min(1, q / 0.22);
      flask.alpha = 1 - f;
      flask.scale.set(1 + 0.55 * f);
      if (f >= 1) flask.visible = false;

      // портрет выпрыгивает из света (лёгкий перелёт масштаба)
      const p = Math.max(0, Math.min(1, (q - 0.05) / 0.45));
      const c1 = 1.70158;
      const eb = 1 + (c1 + 1) * Math.pow(p - 1, 3) + c1 * Math.pow(p - 1, 2);
      portrait.alpha = Math.min(1, p * 1.8);
      portrait.scale.set(0.3 + 0.7 * eb);
      if (ghost) ghost.alpha = 1 - Math.max(0, Math.min(1, (q - 0.5) / 0.45)); // цвет гаснет в силуэт

      glow.clear();
      const pulse = 0.16 + 0.06 * Math.sin(tm * 3.2);
      glow.circle(cx, cy + 12, 58 + 6 * Math.sin(tm * 3.2)).fill({ color: tierCol, alpha: pulse * portrait.alpha });

      const ia = Math.max(0, Math.min(1, (q - 0.3) / 0.35));
      info.alpha = ia;
      info.y = 14 * (1 - ia);
      const ba = Math.max(0, Math.min(1, (q - 0.55) / 0.35));
      btns.alpha = ba;
      if (ba >= 1 && btns.eventMode === 'none') btns.eventMode = 'auto';
    }

    burst.clear();
    if (popped) {
      const fq = Math.min(1, q / 0.4);
      if (fq < 1) burst.circle(cx, cy, 24 + 150 * fq).fill({ color: 0xffffff, alpha: 0.85 * (1 - fq) });
      const rq = Math.min(1, q / 0.6);
      if (rq < 1) burst.circle(cx, cy, 30 + 110 * rq).stroke({ width: 1 + 4 * (1 - rq), color: tierCol, alpha: 0.8 * (1 - rq) });
      for (const s of sparks) {
        s.life += dt;
        if (s.life >= s.max) continue;
        s.x += s.vx * dt;
        s.y += s.vy * dt;
        s.vy += 240 * dt; // искры оседают
        s.vx *= 0.98;
        const a = 1 - s.life / s.max;
        burst.circle(s.x, s.y, s.r * a + 0.5).fill({ color: s.col, alpha: a });
      }
    }
  };

  drawFlask(0);
  ctx.app.ticker.add(tick);
  sfxEvent('lab'); // булькание реактива — тот же звук, что при передаче кота в биобанк
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
      text: t('🧬 Генетический анализ обоих котов + рецепт в Котодексе раскроют названия «❓» исходов', '🧬 Analyse both cats and learn the recipe in the Catdex to reveal the "❓" outcomes'),
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
  // Подложка карточки: в «нарядном» виде — лёгкий тон тира кота и рамка его
  // цветом, так редкость видна раньше, чем прочитано название породы.
  const tierCol = TIER_COLOR[cat.rarityTier];
  const cardBg = (h: number): Graphics => {
    const g = panel(W, h, V(lighten(tierCol, 0.92), COLORS.hud), 18);
    if (VIVID) g.roundRect(0, 0, W, h, 18).stroke({ width: 3, color: tierCol, alpha: 0.5 });
    return g;
  };
  root.addChild(cardBg(H));

  const named = cat.name?.trim();
  // Заголовок переносится по словам и не вылезает за карточку (длинные названия
  // пород); двусловное имя — в две строки. Привязка по верху — сдвигаем y на высоту.
  const title = new Text({
    text: named ? stackWords(named) : describeCat(cat),
    style: {
      fontFamily: FONT, fontSize: V(18, 17), fontWeight: '800',
      fill: named ? tierCol : V(darken(tierCol, 0.45), COLORS.ink),
      align: 'center', wordWrap: true, wordWrapWidth: W - 48, lineHeight: 21,
    },
  });
  title.anchor.set(0.5, 0);
  title.position.set(W / 2, 18);
  root.addChild(title);

  let y = 18 + title.height + 10;
  if (named) {
    const sub = label(describeCat(cat), V(12.5, 12), V(INK_SOFT, COLORS.inkSoft), '700');
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
  const ageLabel = label(t('Здоровье ', 'Health ') + heartsStr, V(14.5, 14), V(INK, COLORS.inkSoft), '700');
  ageLabel.position.set(W / 2, y);
  if (VIVID) { // сердца на светлой плашке — запас вязок не теряется среди строк облика
    const pw = ageLabel.width + 22, ph = ageLabel.height + 8;
    const plate = new Graphics();
    plate.roundRect(W / 2 - pw / 2, y - ph / 2, pw, ph, ph / 2)
      .fill({ color: 0xffffff, alpha: 0.9 })
      .stroke({ width: 1.5, color: tierCol, alpha: 0.45 });
    root.addChild(plate);
  }
  root.addChild(ageLabel);
  if (isOld(cat)) {
    const oldT = label(isSterile(cat) ? t('Бесплодный', 'Sterile') : t('Старый', 'Old'), 12, V(darken(COLORS.warn, 0.35), COLORS.warn), '800');
    oldT.anchor.set(0, 0.5);
    oldT.position.set(W / 2 + ageLabel.width / 2 + 8, y);
    root.addChild(oldT);
  }
  y += 26;

  // строки облика: перенос по словам, чтобы текст не вылезал за край меню
  const traitsTop = y;
  for (const line of traits) {
    const t = new Text({
      text: line,
      style: {
        fontFamily: FONT, fontSize: V(13.5, 13), fontWeight: V('700', '600'), fill: V(INK_SOFT, COLORS.inkSoft),
        wordWrap: true, wordWrapWidth: W - 56, lineHeight: 18, align: 'left',
      },
    });
    t.anchor.set(0, 0);
    t.position.set(28, y);
    root.addChild(t);
    y += t.height + 4;
  }
  if (VIVID && traits.length > 0) { // облик — отдельным светлым блоком (подложка под текст)
    const bg = new Graphics();
    bg.roundRect(20, traitsTop - 8, W - 40, y - traitsTop + 10, 12).fill({ color: 0xffffff, alpha: 0.6 });
    root.addChildAt(bg, 1);
  }
  y += 10;

  if (busy) {
    const note = label(t('💤 кот занят в вязке', '💤 the cat is busy breeding'), 14, V(darken(COLORS.warn, 0.35), COLORS.warn), '700');
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
  // Пока цел запас подарочных анализов — счётчик 🎁 прямо на кнопке (см. freeAnalyzeCat).
  if (!cat.analyzed && pedigreeHasFog(cat)) {
    addBtn(analyzeBtnLabel(ctx), COLORS.dna, true, () => ctx.openAnalyzeConfirm(cat));
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
  root.addChildAt(cardBg(y), 0);
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

  const title = label(t('Передать котика в биобанк?', 'Send the cat to the biobank?'), 18, COLORS.ink, '800');
  title.position.set(W / 2, 28);
  const sub = label(t('на изучение — взамен 🧬 гены', 'for research — 🧬 genes in return'), 12.5, COLORS.inkSoft, '700');
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

  const title = label(t('Передать всех в биобанк?', 'Send every cat to the biobank?'), 18, COLORS.ink, '800');
  title.position.set(W / 2, 30);
  const sub = label(t(`на изучение — взамен 🧬 гены · ${count} 🐱`, `for research — 🧬 genes in return · ${count} 🐱`), 12.5, COLORS.inkSoft, '700');
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
    text: t('❄️ В капсуле кот не ест и не приносит доход. Разморозки нет — капсулу освобождает клон 🧬 или отправка кота в биобанк.', '❄️ In a capsule the cat neither eats nor earns. There is no thawing — a capsule is freed by cloning 🧬 or by sending the cat to the biobank.'),
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
      const warnT = label(t('Освободить капсулу навсегда?', 'Free the cell for good?'), 15, COLORS.warn, '800');
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
        addBtn(analyzeBtnLabel(ctx), COLORS.dna, true, () => ctx.openAnalyzeConfirm(cat));
      }
      addBtn(t('♻️ Освободить капсулу', '♻️ Free the cell'), COLORS.warn, true, () => { confirmDispose = true; render(); });
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
 * Доска заказов (кнопка 📋 в Питомнике). Каждый слот всегда держит активный заказ со своим
 * 6-часовым таймером жизни: не выполнил вовремя — заказ сам сменится (на строке виден
 * остаток «⏳ сменятся через Ч:ММ»). У каждого заказа свой часовой кулдаун 📺-обновления.
 * Выполнить заказ можно ТОЛЬКО котом из корзины: кнопка «Выполнить» активна лишь у строк,
 * под которые он подходит.
 *
 * РАСКЛАДКА строки: правая колонка сверху вниз — «Выполнить», таймер жизни, «📺 обновить».
 * Главная кнопка стоит отдельно сверху (её жали чаще всего и промахивались по соседней
 * 📺), а таймер жизни разделяет их прослойкой. 📺-обновление спрашивает подтверждение.
 */
export function buildOrdersPanel(ctx: UiContext, close: () => void): Container {
  const W = 620;
  const root = new Container();

  const title = label(t('📋 Заказы клиентов', '📋 Client orders'), V(21, 20), V(INK, COLORS.ink), '800');
  title.position.set(W / 2, 26);

  const cat = basketCat(ctx.state);
  const basket = label(
    cat ? t(`🧺 В корзине: ${cat.name?.trim() || describeCat(cat)}`, `🧺 In the basket: ${cat.name?.trim() || describeCat(cat)}`) : t('🧺 Корзина пуста — перетащи кота в корзину под кнопкой 📋 в Питомнике', '🧺 The basket is empty — drag a cat into the basket under the 📋 button in the Cattery'),
    V(13.5, 13), cat ? V(INK, COLORS.ink) : V(INK_SOFT, COLORS.inkSoft), '800',
  );
  // Английские строки шапки длиннее русских, а на мобильном масштабе (UI_SCALE)
  // ещё и крупнее — в панель фиксированной ширины они не влезали и вылезали
  // текстом на комнату. Переносим по ширине панели, а всё, что ниже, считаем от
  // фактической высоты шапки: у RU она в одну строку, у EN может стать в две.
  basket.style.wordWrap = true;
  basket.style.wordWrapWidth = W - 48;
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
    V(12, 11.5), V(INK_SOFT, COLORS.inkSoft), V('700', '600'));
  adHelp.style.wordWrap = true;
  adHelp.style.wordWrapWidth = W - 48;
  adHelp.anchor.set(0.5, 0);
  adHelp.position.set(W / 2, basket.y + basket.height + 6);

  // Карточка заказа поделена на две колонки: СЛЕВА — кто нужен и что за это дают,
  // СПРАВА — таймер жизни, кнопка «Выполнить» и 📺-обновление. Раньше эти четыре
  // элемента стояли крест-накрест по углам, и взгляд метался по карточке.
  const rowH = V(108, 100);
  const cardW = W - 32;
  const COL_W = V(196, 178);              // правая колонка (обе кнопки во всю её ширину)
  const orders = ctx.state.orders;
  let y = adHelp.y + adHelp.height + 10;
  const rows = new Container();

  for (const order of orders) {
    const row = new Container();
    const fits = !!cat && matchesOrder(order, cat);
    const busy = !!cat && isBusy(ctx.state, cat.id);
    const ch = rowH - 10;
    const tc = TIER_COLOR[orderTier(order.req)]; // карточка носит цвет тира заказа
    const ready = fits && !busy;
    const card = panel(cardW, ch, V(lighten(tc, 0.88), COLORS.card), 12);
    if (VIVID) {
      card.roundRect(0, 0, cardW, ch, 12)
        .stroke({ width: ready ? 3.5 : 2.5, color: ready ? COLORS.good : tc, alpha: 0.8 });
      card.roundRect(4, 4, cardW - 8, ch * 0.32, 9).fill({ color: 0xffffff, alpha: 0.35 });
    }
    row.addChild(card);

    const colCx = cardW - 16 - COL_W / 2;   // центр правой колонки
    const leftW = colCx - COL_W / 2 - 28;   // сколько остаётся тексту слева

    const req = new Text({
      text: `"${describeReq(order.req)}"`,
      style: {
        fontFamily: FONT, fontSize: V(16.5, 16), fontWeight: '800',
        fill: V(darken(tc, 0.55), COLORS.ink),
        wordWrap: true, wordWrapWidth: leftW, lineHeight: V(21, 20),
      },
    });
    req.anchor.set(0, 0);
    req.position.set(16, V(14, 12));
    row.addChild(req);

    if (VIVID) {
      const rew = rewardRow(order.reward, 14.5);
      rew.position.set(16, Math.max(req.y + req.height + 14, ch - 26));
      row.addChild(rew);
    } else {
      const rew = label(t('Награда: ', 'Reward: ') + rewardText(order.reward), 13, COLORS.inkSoft, '700');
      rew.anchor.set(0, 0.5);
      rew.position.set(16, 46);
      row.addChild(rew);
    }

    // таймер жизни — между кнопками, в правой колонке (заодно разводит их по краям)
    const timer = label(t(`⏳ сменится через ${fmtHM(msUntilOrderExpiry(order, ctx.now()))}`, `⏳ changes in ${fmtHM(msUntilOrderExpiry(order, ctx.now()))}`), V(12, 11.5), V(INK_SOFT, COLORS.inkSoft), V('700', '600'));
    timer.anchor.set(1, 0.5);
    timer.position.set(cardW - 16, V(58, 70));
    row.addChild(timer);

    // главная кнопка «Выполнить» — в правой колонке сверху, подальше от 📺
    const btnText = !cat ? t('нужен кот', 'need a cat') : busy ? t('кот занят', 'cat is busy') : fits ? t('Выполнить', 'Complete') : t('не подходит', 'does not match');
    const btn = new Button({
      text: btnText, w: V(COL_W, 150), h: V(36, 40),
      color: ready ? V(COLORS.good, COLORS.primary) : COLORS.cardEdge,
      textColor: ready ? 0xffffff : V(INK_SOFT, COLORS.inkSoft), fontSize: 15,
    });
    btn.enabled = ready;
    btn.position.set(V(colCx, cardW - 16 - 75), V(29, 26));
    btn.onTap = () => {
      const r = claimOrder(ctx.state, order.id, ctx.now(), ctx.rng);
      if (r.ok) {
        sfxEvent('order');
        // Крупный заказ (тот, что платит 💎) — пик радости: подходящий момент
        // предложить оценить игру. Само окно покажет Game, когда экран освободится.
        if (r.reward.crystals > 0) ctx.wantReview();
        ctx.commit(); ctx.toast(t('Заказ выполнен! ', 'Order complete! ') + rewardText(r.reward)); close(); ctx.openOrders();
      } else ctx.toast(r.reason);
    };
    row.addChild(btn);

    // 📺-обновление — в самом низу колонки, под таймером.
    // Кулдаун свой у каждого заказа, поэтому состояние кнопки считается по строке.
    const adAvail = canAdRefreshOrder(order, ctx.now());
    const refBtn = new Button({
      text: adAvail ? t('📺 Реклама · обновить', '📺 Ad · refresh') : `⏳ ${fmtMin(msUntilAdRefresh(order, ctx.now()))}`,
      w: V(COL_W, 178), h: V(27, 28),
      color: adAvail ? V(darken(COLORS.secondary, 0.1), COLORS.secondary) : COLORS.cardEdge,
      textColor: adAvail ? 0xffffff : V(INK_SOFT, COLORS.inkSoft), fontSize: 11,
    });
    refBtn.enabled = adAvail;
    refBtn.position.set(V(colCx, 16 + 89), V(81, 70));
    // Не обновляем сразу: заказ вместе с наградой пропадает безвозвратно, а кнопка
    // соседствует с «Выполнить» — сначала спрашиваем (см. buildOrderRefreshConfirm).
    refBtn.onTap = () => { close(); ctx.openOrderRefreshConfirm(order.id); };
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
 * Подтверждение 📺-обновления заказа («Реклама · обновить» на доске заказов).
 *
 * Раньше тап сразу запускал рекламу и подменял заказ, а кнопка соседствует с
 * «Выполнить» — промах стоил игроку уже присмотренной награды. Оверлей в игре
 * один, поэтому и «Отмена», и итог обновления возвращают на доску (back).
 */
export function buildOrderRefreshConfirm(ctx: UiContext, order: Order, back: () => void): Container {
  const W = 340;
  const pad = 22;
  const root = new Container();
  const tc = TIER_COLOR[orderTier(order.req)];

  const title = label(t('📺 Обновить заказ?', '📺 Refresh the order?'), 19, COLORS.ink, '800');
  title.position.set(W / 2, 30);

  const req = new Text({
    text: `"${describeReq(order.req)}"`,
    style: {
      fontFamily: FONT, fontSize: 15.5 * UI_SCALE, fontWeight: '800',
      fill: V(darken(tc, 0.55), COLORS.ink),
      align: 'center', wordWrap: true, wordWrapWidth: W - pad * 2, lineHeight: 20 * UI_SCALE,
    },
  });
  req.anchor.set(0.5, 0);
  req.position.set(W / 2, 56);

  const rew = rewardRow(order.reward, 14.5);
  rew.position.set((W - rew.width) / 2, req.y + req.height + 16);

  const body = new Text({
    text: t(
      'Этот заказ пропадёт — на его месте появится другой, случайный. Награда может оказаться и меньше нынешней.\n\n'
      + 'За просмотр рекламы. Обновить заказ можно раз в час.',
      'This order disappears — a different, random one takes its place. The reward may turn out smaller than the current one.\n\n'
      + 'Costs an ad view. An order can be refreshed once per hour.',
    ),
    style: {
      fontFamily: FONT, fontSize: 13 * UI_SCALE, fontWeight: '600', fill: COLORS.inkSoft,
      wordWrap: true, wordWrapWidth: W - pad * 2, lineHeight: 18 * UI_SCALE, align: 'left',
    },
  });
  body.anchor.set(0, 0);
  body.position.set(pad, rew.y + rew.height + 16);

  let y = body.y + body.height + 16;
  const gap = 12;
  const bw = (W - pad * 2 - gap) / 2;
  const noBtn = new Button({ text: t('Отмена', 'Cancel'), w: bw, h: 48, color: COLORS.cardEdge, textColor: COLORS.ink, fontSize: 16 });
  noBtn.position.set(pad + bw / 2, y + 24);
  noBtn.onTap = back;
  const yesBtn = new Button({
    text: t('📺 Обновить', '📺 Refresh'), w: bw, h: 48,
    color: V(darken(COLORS.secondary, 0.1), COLORS.secondary), fontSize: 16,
  });
  yesBtn.position.set(pad + bw + gap + bw / 2, y + 24);
  yesBtn.onTap = () => {
    yesBtn.enabled = false;
    noBtn.enabled = false;
    void showRewarded().then((watched) => {
      if (!watched) { ctx.toast(t('Реклама недоступна', 'Ad unavailable')); back(); return; }
      const r = adRefreshOrder(ctx.state, ctx.rng, order.id, ctx.now());
      if (!r.ok) { ctx.toast(r.reason); back(); return; }
      ctx.commit();
      ctx.toast(t('Заказ обновлён 📺', 'Order refreshed 📺'));
      back();
    });
  };
  y += 56;

  root.addChild(panel(W, y, COLORS.hud, 18), title, req, rew, body, noBtn, yesBtn);
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
