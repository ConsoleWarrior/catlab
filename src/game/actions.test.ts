import { describe, it, expect } from 'vitest';
import { makeRng } from '../genetics/index.js';
import {
  createInitialState, startBreeding, assignBreeder, clearBreederSlot, isInSlot,
  collectReady, adoptCat, moveCat, keepKittenWithParents,
  buyUpgrade, unlockGene, collectIncome, offlineAdBonus, claimOfflineAdBonus, incubationDuration,
  passiveRatePerMin, offlineCapMin, buyCat, buyCatCost, isRescuePair, buyBoost, adChargeBoost, toggleBoost, activeBoostId, unlockResearch,
  isOld, breedsLeft, roomCount, isAdult, growthRemainingMs, nurseryCapacity,
  revealPedigree, pedigreeHasFog, serialize, deserialize, BOOST_AD_COOLDOWN_MS,
} from './index.js';
import { STARTER_CAT_COST, MAX_HEARTS, KITTEN_GROWTH_MS, KITTEN_SLOW_FACTOR } from './config.js';
import * as C from './config.js';
import type { GameState } from './index.js';

function pair(s: GameState) {
  const female = s.cats.find((c) => c.genotype.sex === 'female')!;
  const male = s.cats.find((c) => c.genotype.sex === 'male')!;
  return { female, male };
}

describe('инкубатор', () => {
  it('вязка → ожидание → котёнок появляется', () => {
    const rng = makeRng(5);
    const s = createInitialState(rng, 0);
    const { female, male } = pair(s);
    const r = startBreeding(s, 0, female.id, male.id, 0);
    expect(r.ok).toBe(true);
    const dur = incubationDuration(s);
    expect(s.slots[0]!.readyAt).toBe(dur);
    // рано — никого
    expect(collectReady(s, dur - 1, rng)).toHaveLength(0);
    // вовремя — котёнок
    const ev = collectReady(s, dur, rng);
    expect(ev).toHaveLength(1);
    expect(ev[0]!.kitten).toBeDefined();
    expect(s.cats).toHaveLength(3);
    expect(s.slots[0]!.readyAt).toBe(0); // слот освобождён
  });

  it('рождённый от изученных родителей — analyzed сразу (тумана нет, скрытые гены видны)', () => {
    const rng = makeRng(77);
    const s = createInitialState(rng, 0);
    const { female, male } = pair(s);
    // стартовые коты уже со скрытой родословной — вскрываем обоих производителей
    revealPedigree(female);
    revealPedigree(male);
    startBreeding(s, 0, female.id, male.id, 0);
    const kitten = collectReady(s, incubationDuration(s), rng)[0]!.kitten!;
    expect(pedigreeHasFog(kitten)).toBe(false); // родословная досталась целиком вскрытой
    expect(kitten.analyzed).toBe(true);         // → рождён уже изученным
  });

  it('рождённый от НЕизученных родителей — с туманом, анализ ещё нужен', () => {
    const rng = makeRng(78);
    const s = createInitialState(rng, 0);
    const { female, male } = pair(s);
    startBreeding(s, 0, female.id, male.id, 0);
    const kitten = collectReady(s, incubationDuration(s), rng)[0]!.kitten!;
    expect(pedigreeHasFog(kitten)).toBe(true);  // деды в тумане
    expect(kitten.analyzed).toBe(false);        // → предложим Генетический анализ
  });

  it('валидации: тот же кот / неверный пол', () => {
    const s = createInitialState(makeRng(6), 0);
    const { female, male } = pair(s);
    expect(startBreeding(s, 0, female.id, female.id, 0).ok).toBe(false);
    expect(startBreeding(s, 0, male.id, female.id, 0).ok).toBe(false); // мама-самец
  });

  it('занятый кот не идёт во вторую вязку', () => {
    const s = createInitialState(makeRng(7), 0);
    s.level = 10; // снимаем гейты уровня (2-й слот вязки открыт)
    s.coins = 1000;
    expect(buyUpgrade(s, 'slots').ok).toBe(true);
    const { female, male } = pair(s);
    expect(startBreeding(s, 0, female.id, male.id, 0).ok).toBe(true);
    expect(startBreeding(s, 1, female.id, male.id, 0).ok).toBe(false);
  });

  it('вязка не зависит от места в питомнике', () => {
    const s = createInitialState(makeRng(8), 0);
    const { female, male } = pair(s);
    // вместимость питомника — базовая (6, без узлов дерева); добьём до предела фиктивными котами
    while (s.cats.filter((c) => c.location === 'nursery').length < 6) {
      const clone = { ...female, id: 'x' + s.nextId++ };
      s.cats.push(clone);
    }
    // даже при переполненном питомнике вязку можно запустить
    expect(startBreeding(s, 0, female.id, male.id, 0).ok).toBe(true);
  });

  it('assignBreeder: ставит по полу, меняет местами, не трогает активный слот', () => {
    const s = createInitialState(makeRng(15), 0);
    s.level = 10; // снимаем гейты уровня
    s.coins = 1000;
    buyUpgrade(s, 'slots'); // нужен второй слот
    const { female, male } = pair(s);
    const female2 = { ...female, id: 'f2' + s.nextId++ };
    s.cats.push(female2);

    expect(assignBreeder(s, 0, female.id, 0).ok).toBe(true);
    expect(s.slots[0]!.motherId).toBe(female.id);
    expect(assignBreeder(s, 0, male.id, 0).ok).toBe(true);
    expect(s.slots[0]!.fatherId).toBe(male.id);

    // другая самка в ту же роль вытесняет первую (коты «меняются местами»)
    expect(assignBreeder(s, 0, female2.id, 0).ok).toBe(true);
    expect(s.slots[0]!.motherId).toBe(female2.id);

    // активный (идёт вязка) слот трогать нельзя
    startBreeding(s, 1, female.id, male.id, 0);
    expect(assignBreeder(s, 1, female2.id, 0).ok).toBe(false);
  });

  it('isInSlot / clearBreederSlot: кот в слоте и снятие (активную вязку не трогаем)', () => {
    const s = createInitialState(makeRng(17), 0);
    const { female, male } = pair(s);
    // поставили в слот (staged, readyAt === 0)
    expect(assignBreeder(s, 0, female.id, 0).ok).toBe(true);
    expect(isInSlot(s, female.id)).toBe(true);
    expect(isInSlot(s, male.id)).toBe(false);
    // сняли со слота
    expect(clearBreederSlot(s, female.id)).toBe(true);
    expect(isInSlot(s, female.id)).toBe(false);
    expect(clearBreederSlot(s, female.id)).toBe(false); // уже снят
    // активную вязку clearBreederSlot не разрывает
    expect(startBreeding(s, 0, female.id, male.id, 0).ok).toBe(true);
    expect(isInSlot(s, female.id)).toBe(true);
    expect(clearBreederSlot(s, female.id)).toBe(false);
    expect(isInSlot(s, female.id)).toBe(true);
  });

  it('невзрослого котёнка нельзя ни поставить в слот, ни свести', () => {
    const s = createInitialState(makeRng(16), 0);
    const { female, male } = pair(s);
    const now = 1000;
    female.bornAt = now;       // только что родилась — ещё котёнок
    expect(assignBreeder(s, 0, female.id, now).ok).toBe(false);
    expect(startBreeding(s, 0, female.id, male.id, now).ok).toBe(false);
  });
});

describe('лимит вязок (статус «Старый»)', () => {
  it('каждая вязка засчитывается обоим родителям', () => {
    const rng = makeRng(70);
    const s = createInitialState(rng, 0);
    const { female, male } = pair(s);
    expect(female.breedCount).toBe(0);
    expect(startBreeding(s, 0, female.id, male.id, 0).ok).toBe(true);
    expect(female.breedCount).toBe(1);
    expect(male.breedCount).toBe(1);
  });

  it('после MAX_HEARTS вязок кот становится «Старым» и не идёт в вязку', () => {
    const rng = makeRng(71);
    const s = createInitialState(rng, 0);
    const { female, male } = pair(s);
    const dur = incubationDuration(s);
    let now = 0;
    for (let k = 0; k < MAX_HEARTS; k++) {
      expect(startBreeding(s, 0, female.id, male.id, now).ok).toBe(true);
      collectReady(s, now + dur, rng);
      s.slots[0]!.kittenId = null; // «пристроили» малыша → слот снова свободен под вязку
      now += dur;
    }
    expect(female.breedCount).toBe(MAX_HEARTS);
    expect(breedsLeft(female)).toBe(0);
    expect(isOld(female)).toBe(true);
    // «Старого» нельзя свести, но в слот он встаёт (там его лечит шприц-ветеринар)
    expect(startBreeding(s, 0, female.id, male.id, now).ok).toBe(false);
    expect(assignBreeder(s, 0, female.id, now).ok).toBe(true);
  });

  it('«Старого» блокирует только startBreeding; assignBreeder его пускает (для лечения)', () => {
    const s = createInitialState(makeRng(72), 0);
    const { female, male } = pair(s);
    female.breedCount = MAX_HEARTS; // искусственно состарили
    expect(isOld(female)).toBe(true);
    expect(assignBreeder(s, 0, female.id, 0).ok).toBe(true);
    expect(isInSlot(s, female.id)).toBe(true);
    expect(startBreeding(s, 0, female.id, male.id, 0).ok).toBe(false);
    expect(male.breedCount).toBe(0); // несостоявшаяся вязка не засчиталась партнёру
  });

  it('«Бесплодный» (0 ❤ с рождения) тоже встаёт в слот — иначе его не подлечить', () => {
    const s = createInitialState(makeRng(73), 0);
    const { female } = pair(s);
    female.maxHearts = 0; // тяжёлый инбридинг: родился без сердец
    expect(isOld(female)).toBe(true);
    expect(assignBreeder(s, 0, female.id, 0).ok).toBe(true);
  });
});

describe('комнаты', () => {
  it('пристройство даёт монеты и ДНК, кот уходит', () => {
    const s = createInitialState(makeRng(3), 0);
    const cat = s.cats[0]!;
    const before = s.coins;
    const r = adoptCat(s, cat.id);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.coins).toBeGreaterThan(0);
      expect(s.coins).toBe(before + r.coins);
      expect(s.dna).toBe(r.dna);
    }
    expect(s.cats.find((c) => c.id === cat.id)).toBeUndefined();
  });

  it('занятого кота нельзя пристроить', () => {
    const s = createInitialState(makeRng(11), 0);
    const { female, male } = pair(s);
    startBreeding(s, 0, female.id, male.id, 0);
    expect(adoptCat(s, female.id).ok).toBe(false);
  });

  it('перемещение между комнатами с учётом вместимости', () => {
    const s = createInitialState(makeRng(12), 0);
    const cat = s.cats[0]!;
    expect(moveCat(s, cat.id, 'shelter').ok).toBe(true);
    expect(cat.location).toBe('shelter');
  });

  it('нет места → moveCat не выпускает родителя вязки из слота, даже если location уже совпадает', () => {
    const s = createInitialState(makeRng(13), 0);
    const { female, male } = pair(s);
    // родитель вязки: location у него уже 'nursery' (никогда не менялся), но физически
    // он в слоте — это раньше ложно срабатывало как «уже дома», минуя проверку места
    startBreeding(s, 0, female.id, male.id, 0);
    while (roomCount(s, 'nursery') < nurseryCapacity(s)) {
      s.cats.push({ ...female, id: 'x' + s.nextId++, location: 'nursery' });
    }
    const r = moveCat(s, female.id, 'nursery');
    expect(r.ok).toBe(false);
    expect(isInSlot(s, female.id)).toBe(true); // осталась в слоте, не «просочилась» 11-й
  });
});

describe('покупка кота (анти-софт-лок)', () => {
  // цена растёт с уровнем лаборатории: 50 + 5 × уровень (на ур.1 — 55)
  const costAtLevel1 = STARTER_CAT_COST + C.BUY_CAT_COST_PER_LEVEL;

  it('первый кот бесплатно, если котов нет; затем платно', () => {
    const rng = makeRng(20);
    const s = createInitialState(rng, 0);
    s.cats = [];                    // продал всех — тупик
    s.coins = costAtLevel1;         // но деньги есть → пары не будет, выдадут одного
    expect(buyCatCost(s)).toBe(0);
    const r1 = buyCat(s, rng, 0);
    expect(r1.ok).toBe(true);
    expect(s.cats).toHaveLength(1);
    expect(s.coins).toBe(costAtLevel1); // первый бесплатный, монеты целы
    expect(s.cats[0]!.location).toBe('shelter');
    expect(s.cats[0]!.isNew).toBe(true); // бейдж «новый» до первого открытия инфо
    // следующий уже стоит денег
    expect(buyCatCost(s)).toBe(costAtLevel1);
    expect(buyCat(s, rng, 0).ok).toBe(true);
    expect(s.coins).toBe(0);
    expect(buyCat(s, rng, 0).ok).toBe(false); // 0 монет
  });

  it('цена покупки растёт с уровнем лаборатории: 55 на ур.1 … 100 на ур.10', () => {
    const s = createInitialState(makeRng(20), 0);
    expect(s.level).toBe(1);
    expect(buyCatCost(s)).toBe(55);
    s.level = 5;  expect(buyCatCost(s)).toBe(75);
    s.level = 10; expect(buyCatCost(s)).toBe(100);
    s.research = { r_sel_select: 2 }; // потолок: 100 × 1.5
    expect(buyCatCost(s)).toBe(150);
  });

  it('ни котов, ни денег → бесплатно выдают пару ♀+♂', () => {
    const rng = makeRng(22);
    const s = createInitialState(rng, 0);
    s.cats = [];
    s.coins = costAtLevel1 - 1; // не хватает даже на одного
    expect(isRescuePair(s)).toBe(true);
    const r = buyCat(s, rng, 0);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.cats).toHaveLength(2);
    expect(s.cats).toHaveLength(2);
    expect(s.cats.map((c) => c.genotype.sex).sort()).toEqual(['female', 'male']);
    expect(s.cats.every((c) => c.location === 'shelter' && c.isNew)).toBe(true);
    expect(s.coins).toBe(costAtLevel1 - 1); // подарок ничего не стоит
    // подарок разовый: коты появились → дальше обычная платная покупка
    expect(isRescuePair(s)).toBe(false);
    expect(buyCatCost(s)).toBe(costAtLevel1);
  });

  it('купленный кот — простой (без редких генов)', () => {
    const rng = makeRng(21);
    const s = createInitialState(rng, 0);
    s.cats = [];
    const r = buyCat(s, rng, 0);
    expect(r.ok).toBe(true);
    if (r.ok) {
      const g = r.cat.genotype;
      expect(g.W).toEqual(['w', 'w']);
      expect(g.Ea).toEqual(['normal', 'normal']);
      expect(g.L).toEqual(['L', 'L']);
      expect(g.D).toEqual(['D', 'D']);
    }
  });
});

describe('прокачка и генолаб', () => {
  it('апгрейд слотов: списывает монеты и добавляет слот', () => {
    const s = createInitialState(makeRng(13), 0);
    s.level = 10; // 2-й слот вязки уже разрешён уровнем — проверяем именно оплату
    expect(buyUpgrade(s, 'slots').ok).toBe(false); // 100 < 500
    s.coins = 500;
    expect(buyUpgrade(s, 'slots').ok).toBe(true);
    expect(s.slots).toHaveLength(2);
    expect(s.coins).toBe(0);
  });

  it('открытие гена тратит ДНК', () => {
    const s = createInitialState(makeRng(14), 0);
    expect(unlockGene(s, 'dilute').ok).toBe(false); // 0 ДНК
    s.dna = 50;
    expect(unlockGene(s, 'dilute').ok).toBe(true);
    expect(s.unlockedGenes).toContain('dilute');
    expect(s.dna).toBe(0);
    expect(unlockGene(s, 'dilute').ok).toBe(false); // уже открыт
  });
});

describe('генная инженерия', () => {
  it('buyBoost заряжает усилитель за ДНК', () => {
    const s = createInitialState(makeRng(40), 0);
    s.level = 10; // Генная инженерия открыта уровнем
    expect(buyBoost(s, 'tierUp').ok).toBe(false); // 0 ДНК
    expect(buyBoost(s, 'bogus').ok).toBe(false);  // нет такого усилителя
    s.dna = 100;
    expect(buyBoost(s, 'tierUp').ok).toBe(true);
    expect(s.boosts.tierUp).toBe(1);
    expect(s.dna).toBe(40); // 60 🧬 списано
  });

  it('buyBoost заряжает усилитель за кристаллы (премиум-альтернатива)', () => {
    const s = createInitialState(makeRng(40), 0);
    s.level = 10; // Генная инженерия открыта уровнем
    s.crystals = 4; s.dna = 0;
    expect(buyBoost(s, 'tierUp', 'crystals').ok).toBe(false); // нужно 5 💎
    expect(buyBoost(s, 'luckyUp', 'crystals').ok).toBe(true); // 3 💎
    expect(s.boosts.luckyUp).toBe(1);
    expect(s.crystals).toBe(1); // 3 💎 списано
    expect(s.dna).toBe(0);      // гены не тронуты
  });

  it('заряды копятся любых типов; авто-активируется первый купленный', () => {
    const s = createInitialState(makeRng(40), 0);
    s.level = 10; // Генная инженерия открыта уровнем
    s.dna = 300; s.crystals = 20;
    expect(buyBoost(s, 'noDown').ok).toBe(true);
    expect(s.activeBoost).toBe('noDown'); // ничего не было активно → авто-активация
    // другой тип тоже заряжается (склад копится), но активность не меняется
    expect(buyBoost(s, 'tierUp').ok).toBe(true);
    expect(buyBoost(s, 'noDown').ok).toBe(true); // стек своего типа
    expect(s.boosts.noDown).toBe(2);
    expect(s.boosts.tierUp).toBe(1);
    expect(s.activeBoost).toBe('noDown'); // всё ещё первый
    expect(activeBoostId(s)).toBe('noDown');
  });

  it('adChargeBoost даёт бесплатный заряд за 📺 с глобальным кулдауном (🛡/🍀)', () => {
    const s = createInitialState(makeRng(40), 0);
    expect(adChargeBoost(s, 'noDown', 1000).ok).toBe(false); // Генная инженерия ещё заперта
    s.level = 10; // Генная инженерия открыта уровнем
    expect(adChargeBoost(s, 'bogus', 1000).ok).toBe(false);  // нет такого усилителя
    // первый просмотр — бесплатно, без валюты; ничего не было активно → авто-активация
    expect(adChargeBoost(s, 'noDown', 1000).ok).toBe(true);
    expect(s.boosts.noDown).toBe(1);
    expect(s.activeBoost).toBe('noDown');
    expect(s.dna).toBe(0); // валюта не тронута
    // кулдаун глобальный: сразу зарядить ДРУГОЙ усилитель тоже нельзя
    const r = adChargeBoost(s, 'luckyUp', 1000 + BOOST_AD_COOLDOWN_MS - 1);
    expect(r.ok).toBe(false);
    expect(r.ok ? undefined : r.reason).toBe('реклама ещё не готова');
    // кулдаун вышел → можно снова (другой adCharge-усилитель)
    expect(adChargeBoost(s, 'luckyUp', 1000 + BOOST_AD_COOLDOWN_MS).ok).toBe(true);
    expect(s.boosts.luckyUp).toBe(1);
    expect(s.activeBoost).toBe('noDown'); // активность не переключается, если уже есть активный
  });

  it('🔼 Активатор за 📺 не заряжается — только за валюту (adCharge: false)', () => {
    const s = createInitialState(makeRng(40), 0);
    s.level = 10; // Генная инженерия открыта уровнем
    const r = adChargeBoost(s, 'tierUp', 1000);
    expect(r.ok).toBe(false);
    expect(r.ok ? undefined : r.reason).toBe('заряжается только за валюту');
    expect(s.boosts.tierUp).toBeUndefined();
    expect(s.lastBoostAdAt).toBe(0); // отказ не сжигает кулдаун
    // за валюту — по-прежнему можно
    s.dna = 100;
    expect(buyBoost(s, 'tierUp').ok).toBe(true);
  });

  it('старый сейв без lastBoostAdAt → 0 (📺-зарядка сразу доступна)', () => {
    const s = createInitialState(makeRng(40), 0);
    const raw = JSON.parse(serialize(s)) as Record<string, unknown>;
    delete raw.lastBoostAdAt;
    const restored = deserialize(JSON.stringify(raw));
    expect(restored.lastBoostAdAt).toBe(0);
  });

  it('toggleBoost переключает активность без траты зарядов; активен только один', () => {
    const s = createInitialState(makeRng(40), 0);
    s.level = 10; // Генная инженерия открыта уровнем
    s.dna = 300;
    buyBoost(s, 'noDown'); // active = noDown
    buyBoost(s, 'tierUp'); // на складе, не активен
    // включаем другой — прежний слетает, заряды целы
    expect(toggleBoost(s, 'tierUp').ok).toBe(true);
    expect(s.activeBoost).toBe('tierUp');
    expect(s.boosts.noDown).toBe(1);
    expect(s.boosts.tierUp).toBe(1);
    // выключаем активный — активного нет, заряды целы
    expect(toggleBoost(s, 'tierUp').ok).toBe(true);
    expect(s.activeBoost).toBe(null);
    expect(activeBoostId(s)).toBeUndefined();
    expect(s.boosts.tierUp).toBe(1);
    // активировать усилитель без зарядов нельзя
    const r = toggleBoost(s, 'luckyUp');
    expect(r.ok).toBe(false);
    expect(r.ok ? undefined : r.reason).toBe('нет зарядов');
  });

  it('🔼 Форсаж в инкубаторе поднимает тир котёнка и тратит заряд', () => {
    const rng = makeRng(41);
    const s = createInitialState(rng, 0);
    s.level = 10; // Генная инженерия открыта уровнем
    const { female, male } = pair(s); // дворовые (common)
    s.dna = 100;
    buyBoost(s, 'tierUp');
    startBreeding(s, 0, female.id, male.id, 0);
    const ev = collectReady(s, incubationDuration(s), rng);
    expect(ev[0]!.kitten!.rarityTier).not.toBe('common'); // поднялся минимум на 1 тир
    expect(s.boosts.tierUp).toBe(0); // заряд списан
    expect(s.activeBoost).toBe(null); // заряды кончились → активность снята автоматически
  });

  it('заряд Форсажа не тратится впустую на легендарной паре', () => {
    const rng = makeRng(42);
    const s = createInitialState(rng, 0);
    s.level = 10; // Генная инженерия открыта уровнем
    const { female, male } = pair(s);
    female.breed = 'bengal'; female.rarityTier = 'legendary';
    male.breed = 'bengal'; male.rarityTier = 'legendary';
    s.dna = 100;
    buyBoost(s, 'tierUp');
    startBreeding(s, 0, female.id, male.id, 0);
    const ev = collectReady(s, incubationDuration(s), rng);
    expect(ev[0]!.kitten).toBeDefined();
    expect(s.boosts.tierUp).toBe(1); // не сработал → заряд сохранён
  });
});

describe('дерево исследований', () => {
  it('unlockResearch: пререквизиты, уровни, стоимость и неизвестный узел', () => {
    const s = createInitialState(makeRng(50), 0);
    s.level = 10; // все уровни узлов открыты (проверяем логику узлов, не гейт по уровню)
    s.coins = 10_000; // Селекция теперь стоит и 🧬, и 💰
    expect(unlockResearch(s, 'r_sel_pairs').ok).toBe(false);    // нужен r_sel_markers (корень цепочки)
    expect(unlockResearch(s, 'r_sel_markers').ok).toBe(false);  // 0 ДНК
    s.dna = 1000;
    expect(unlockResearch(s, 'r_sel_markers').ok).toBe(true);   // ур.1 корня
    expect(s.research.r_sel_markers).toBe(1);
    expect(unlockResearch(s, 'r_sel_markers').ok).toBe(true);   // ур.2 того же узла
    expect(s.research.r_sel_markers).toBe(2);
    expect(unlockResearch(s, 'r_sel_pairs').ok).toBe(true);     // пререквизит есть (≥1 ур.)
    expect(s.dna).toBe(1000 - 60 - 300 - 200);                  // ур1+ур2 «Маркеров» + ур1 «Подбора»
    expect(unlockResearch(s, 'bogus').ok).toBe(false);
  });

  it('unlockResearch: полностью прокачанный узел больше не покупается', () => {
    const s = createInitialState(makeRng(51), 0);
    s.level = 10; s.dna = 10_000; s.coins = 30_000;
    // «Витамины роста» — одноуровневый узел, финал цепочки Селекции:
    // Маркеры→Подбор→Тщательный отбор→Витамины (Криогенетика ушла в ветку «Лаборатория»).
    unlockResearch(s, 'r_sel_markers');
    unlockResearch(s, 'r_sel_pairs');
    unlockResearch(s, 'r_sel_select');
    expect(unlockResearch(s, 'r_sel_vitamins').ok).toBe(true);
    expect(unlockResearch(s, 'r_sel_vitamins')).toMatchObject({ ok: false, reason: 'уже изучено' });
  });
});

describe('малыш с родителями (рождение)', () => {
  function bornKitten(seed: number) {
    const rng = makeRng(seed);
    const s = createInitialState(rng, 0);
    const { female, male } = pair(s);
    const dur = incubationDuration(s);
    startBreeding(s, 0, female.id, male.id, 0);
    const ev = collectReady(s, dur, rng);
    return { s, female, male, kitten: ev[0]!.kitten! };
  }

  it('после рождения родители остаются в слоте, малыш сидит в слоте (kittenId)', () => {
    const { s, female, male, kitten } = bornKitten(100);
    expect(s.slots[0]!.motherId).toBe(female.id);
    expect(s.slots[0]!.fatherId).toBe(male.id);
    expect(s.slots[0]!.kittenId).toBe(kitten.id);
    // малыш «в слоте» — в заполненность комнаты не входит
    expect(isInSlot(s, kitten.id)).toBe(true);
    expect(roomCount(s, 'nursery')).toBe(0); // оба родителя и малыш — в слоте
  });

  it('пока малыш в слоте — нельзя ни свести, ни поставить нового кота', () => {
    const { s, female, male } = bornKitten(101);
    expect(startBreeding(s, 0, female.id, male.id, 1).ok).toBe(false);
    expect(assignBreeder(s, 0, female.id, 1).ok).toBe(false);
  });

  it('moveCat уносит малыша из слота в комнату и освобождает kittenId', () => {
    const { s, kitten } = bornKitten(102);
    const r = moveCat(s, kitten.id, 'shelter');
    expect(r.ok).toBe(true);
    expect(s.slots[0]!.kittenId).toBeNull();
    expect(kitten.location).toBe('shelter');
    expect(isInSlot(s, kitten.id)).toBe(false);
  });

  it('нет места → moveCat не уносит малыша, он остаётся с роднёй', () => {
    const { s, kitten } = bornKitten(103);
    // забиваем питомник под завязку фиктивными котами (родители/малыш в слоте не в счёт)
    while (roomCount(s, 'nursery') < nurseryCapacity(s)) {
      s.cats.push({ ...kitten, id: 'x' + s.nextId++, location: 'nursery' });
    }
    const r = moveCat(s, kitten.id, 'nursery');
    expect(r.ok).toBe(false);
    expect(s.slots[0]!.kittenId).toBe(kitten.id);
  });

  it('keepKittenWithParents включает медленный рост (втрое)', () => {
    const { s, kitten } = bornKitten(104);
    const now = 5_000;
    keepKittenWithParents(s, kitten.id, now);
    expect(kitten.growthMs).toBe(KITTEN_GROWTH_MS * KITTEN_SLOW_FACTOR);
    // в обычный срок ещё не взрослый — взрослеет только через утроенный
    expect(isAdult(kitten, now + KITTEN_GROWTH_MS)).toBe(false);
    expect(isAdult(kitten, now + KITTEN_GROWTH_MS * KITTEN_SLOW_FACTOR)).toBe(true);
    expect(growthRemainingMs(kitten, now)).toBe(KITTEN_GROWTH_MS * KITTEN_SLOW_FACTOR);
  });

  it('подросший малыш уходит родителем в соседний слот и не остаётся в родном (без раздвоения)', () => {
    const rng = makeRng(105);
    const s = createInitialState(rng, 0);
    s.level = 10; // снимаем гейты уровня (2-й слот вязки открыт)
    s.coins = 1000;
    buyUpgrade(s, 'slots'); // нужен 2-й слот вязки
    const { female, male } = pair(s);
    const dur = incubationDuration(s);
    startBreeding(s, 0, female.id, male.id, 0);
    const kitten = collectReady(s, dur, rng)[0]!.kitten!;
    expect(s.slots[0]!.kittenId).toBe(kitten.id);

    const grown = dur + KITTEN_GROWTH_MS; // малыш дорос до взрослого
    expect(isAdult(kitten, grown)).toBe(true);
    // ставим подросшего малыша в соседний слот как родителя
    expect(assignBreeder(s, 1, kitten.id, grown).ok).toBe(true);
    // он покинул родной слот 0 — kittenId очищен
    expect(s.slots[0]!.kittenId).toBeNull();
    // и числится ровно в одном слоте (не «раздвоился»)
    const inSlots = s.slots.filter(
      (sl) => sl.motherId === kitten.id || sl.fatherId === kitten.id || sl.kittenId === kitten.id,
    );
    expect(inSlots).toHaveLength(1);
    expect(isInSlot(s, kitten.id)).toBe(true);
  });
});

describe('пассивный доход', () => {
  it('начисляется со временем и упирается в потолок офлайна', () => {
    const s = createInitialState(makeRng(9), 0);
    s.champions = [s.cats[0]!.id]; // доход приносит кот-чемпион
    const rate = passiveRatePerMin(s);
    s.lastSeenAt = 0;
    const r1 = collectIncome(s, 60_000); // 1 минута
    expect(r1.coins).toBe(Math.floor(rate * 1));
    expect(s.lastSeenAt).toBe(60_000);

    s.lastSeenAt = 0;
    const cap = offlineCapMin(s);
    const r2 = collectIncome(s, cap * 60_000 * 5); // далеко за потолком
    expect(r2.coins).toBe(Math.floor(rate * cap));
  });

  it('отчёт для окна «С возвращением»: время отлучки и причина обрезки', () => {
    const s = createInitialState(makeRng(9), 0);
    s.champions = [s.cats[0]!.id];
    const cap = offlineCapMin(s);

    // уложились в потолок и корма хватило — обрезки нет
    s.lastSeenAt = 0;
    const short = collectIncome(s, 30 * 60_000);
    expect(short.awayMin).toBeCloseTo(30);
    expect(short.incomeMin).toBeCloseTo(30);
    expect(short.cappedByTime).toBe(false);
    expect(short.cappedByFood).toBe(false);

    // ушли надолго — доход обрезан потолком офлайна
    s.food = C.FOOD_CAP_BASE;
    s.lastSeenAt = 0;
    const long = collectIncome(s, (cap + 60) * 60_000);
    expect(long.awayMin).toBeCloseTo(cap + 60);
    expect(long.incomeMin).toBeCloseTo(cap);
    expect(long.cappedByTime).toBe(true);

    // кормушка пуста — доход обрезан голодом
    s.food = 0;
    s.lastSeenAt = 0;
    const hungry = collectIncome(s, 30 * 60_000);
    expect(hungry.coins).toBe(0);
    expect(hungry.cappedByFood).toBe(true);
  });

  it('📺-надбавка добавляет 20% от начисленного за отсутствие', () => {
    const s = createInitialState(makeRng(9), 0);
    s.coins = 1000;
    expect(offlineAdBonus(250)).toBe(50);
    expect(offlineAdBonus(4)).toBe(0);   // меньше монеты — кнопки в окне не будет
    expect(offlineAdBonus(-10)).toBe(0); // отчёт без дохода награды не даёт

    expect(claimOfflineAdBonus(s, 250)).toBe(50);
    expect(s.coins).toBe(1050);
  });
});
