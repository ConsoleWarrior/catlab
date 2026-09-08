import { describe, it, expect } from 'vitest';
import { makeRng } from '../genetics/index.js';
import {
  createInitialState, assignBreeder, startBreeding, collectReady,
  freeAnalyzeCat, freeGrowKitten, adoptCat, moveCat, clearBreederSlot, setChampion, analyzeTarget,
  tutorialStep, tutorialActive, finishTutorial, restartTutorial,
  markTutorialSeen, tutorialMenuGate, shelterTarget, growTarget,
  isAdult, effGrowthMs,
  grantTutorialReward, TUTORIAL_REWARD_COINS, TUTORIAL_REWARD_CRYSTALS,
  FREE_ANALYZE_COUNT, FREE_GROWTH_COUNT,
  serialize, deserialize,
} from './index.js';
import type { GameState } from './index.js';

/** Сейв старой версии: подарки жили одноразовыми флагами внутри tutorial. */
type LegacySave = {
  tutorial: Record<string, boolean>;
  freeAnalyzeLeft?: number; freeSkipLeft?: number; freeGrowthLeft?: number;
};

function pair(s: GameState) {
  const female = s.cats.find((c) => c.genotype.sex === 'female')!;
  const male = s.cats.find((c) => c.genotype.sex === 'male')!;
  return { female, male };
}

/** Первый шаг (подарочный анализ обоих котов) — не тема теста: проходим его. */
function skipAnalyze(s: GameState): void {
  for (const c of s.cats) freeAnalyzeCat(s, c.id);
}

describe('обучение новичка (шаги)', () => {
  it('новая игра начинается с шага «генетический анализ»', () => {
    const s = createInitialState(makeRng(1), 0);
    expect(tutorialStep(s)).toBe('analyze');
    expect(tutorialActive(s)).toBe(true);
    // изучить надо ОБОИХ: по одному родителю ни прогноза, ни родословной котёнка
    freeAnalyzeCat(s, s.cats[0]!.id);
    expect(tutorialStep(s)).toBe('analyze');
    expect(analyzeTarget(s)?.id).toBe(s.cats[1]!.id); // подсветка перешла на второго
    freeAnalyzeCat(s, s.cats[1]!.id);
    expect(tutorialStep(s)).toBe('drag'); // изучены оба → тащим пару в слот
  });

  it('подарочные анализы кончились — шаг «изучи» пропускается (платить не заставляем)', () => {
    const s = createInitialState(makeRng(24), 0);
    s.freeAnalyzeLeft = 0;
    expect(tutorialStep(s)).toBe('drag');
  });

  it('в меню кота на шаге остаётся ровно одна кнопка — та, о которой подсказка', () => {
    const s = createInitialState(makeRng(25), 0);
    const { female, male } = pair(s);
    expect(tutorialMenuGate(s, female)).toEqual({ open: true, actions: ['analyze'] });
    skipAnalyze(s);
    // шаг 'drag' — это ЖЕСТ: меню не открывается вовсе, вместо него тост
    expect(tutorialMenuGate(s, female)).toEqual({ open: false, actions: [] });
    assignBreeder(s, 0, female.id, 0);
    expect(tutorialMenuGate(s, male)).toEqual({ open: true, actions: ['slot'] });
    // вне обучения меню обычное — ядро не вмешивается
    finishTutorial(s);
    expect(tutorialMenuGate(s, male)).toBeNull();
  });

  it('DEV-перезапуск возвращает обучение, подарки и отметки просмотров', () => {
    const s = createInitialState(makeRng(11), 0);
    finishTutorial(s);
    s.freeAnalyzeLeft = 0;
    s.freeGrowthLeft = 0;
    s.tutorial.previewSeen = true;
    expect(tutorialActive(s)).toBe(false);

    restartTutorial(s);
    expect(tutorialStep(s)).toBe('analyze');
    expect(s.freeAnalyzeLeft).toBe(FREE_ANALYZE_COUNT);
    expect(s.freeGrowthLeft).toBe(FREE_GROWTH_COUNT);
    expect(s.tutorial.previewSeen).toBe(false);
  });

  it('один кот в слоте → второго кнопкой из меню; пара → 🔮 прогноз → «Свести»', () => {
    const s = createInitialState(makeRng(2), 0);
    skipAnalyze(s);
    const { female, male } = pair(s);
    assignBreeder(s, 0, female.id, 0);
    expect(tutorialStep(s)).toBe('menu');
    assignBreeder(s, 0, male.id, 0);
    expect(tutorialStep(s)).toBe('preview');
    markTutorialSeen(s, 'preview');
    expect(tutorialStep(s)).toBe('breed');
  });

  it('шаг не зависит от того, кого поставили первым (кота или кошку)', () => {
    const s = createInitialState(makeRng(3), 0);
    skipAnalyze(s);
    const { male } = pair(s);
    assignBreeder(s, 0, male.id, 0);
    expect(tutorialStep(s)).toBe('menu');
  });

  it('идёт вязка → «жди» (ускорять нечем: вязка длится секунды)', () => {
    const s = createInitialState(makeRng(4), 0);
    const { female, male } = pair(s);
    startBreeding(s, 0, female.id, male.id, 0);
    expect(tutorialStep(s)).toBe('wait');
    s.slots[0]!.readyAt = 999_999;             // хоть долгая, хоть короткая — шаг тот же
    expect(tutorialStep(s)).toBe('wait');
  });

  it('после котёнка: вырастить → в питомник → отца в приют → «в добрые руки» → заказы → генолаб → пьедестал', () => {
    const rng = makeRng(5);
    const s = createInitialState(rng, 0);
    const { female, male } = pair(s);
    startBreeding(s, 0, female.id, male.id, 0, rng);
    const now = s.slots[0]!.readyAt;
    const kitten = collectReady(s, now, rng)[0]!.kitten!;
    expect(kitten.motherBreed).toBeTruthy();

    // новорождённый в окошке вязки — сперва растим его (пол виден только у взрослого)
    expect(tutorialStep(s, now)).toBe('grow');
    expect(freeGrowKitten(s, kitten.id, now).ok).toBe(true);

    // вырос, но всё ещё в окошке — освобождаем слот, унося его в Питомник
    expect(tutorialStep(s, now)).toBe('kitten');
    expect(moveCat(s, kitten.id, 'nursery').ok).toBe(true);

    // слот свободен, Приют пуст — уводим туда отца (он остался стоять в слоте)
    expect(tutorialStep(s, now)).toBe('toShelter');
    expect(shelterTarget(s)?.id).toBe(male.id);
    expect(moveCat(s, male.id, 'shelter').ok).toBe(true);
    clearBreederSlot(s, male.id);
    expect(tutorialStep(s, now)).toBe('adopt');

    // отдали «в добрые руки» — шаг отмечен самим действием (кот из состояния исчез)
    expect(adoptCat(s, male.id).ok).toBe(true);
    expect(s.tutorial.adoptDone).toBe(true);
    expect(tutorialStep(s, now)).toBe('orders');

    markTutorialSeen(s, 'orders');
    expect(tutorialStep(s, now)).toBe('genolab');   // где Котодекс и рецепты — тоже показываем
    markTutorialSeen(s, 'genolab');
    expect(tutorialStep(s, now)).toBe('champion');

    // мать осталась в слоте — забираем её и ставим на пьедестал
    clearBreederSlot(s, female.id);
    expect(setChampion(s, female.id, 0, now).ok).toBe(true);
    expect(tutorialStep(s, now)).toBeNull(); // шагов больше нет — показ закроет обучение
  });

  it('запас подарочных ускорений роста пуст — шаг «вырастить» пропускается', () => {
    const rng = makeRng(12);
    const s = createInitialState(rng, 0);
    const { female, male } = pair(s);
    startBreeding(s, 0, female.id, male.id, 0, rng);
    const now = s.slots[0]!.readyAt;
    const kitten = collectReady(s, now, rng)[0]!.kitten!;
    s.freeGrowthLeft = 0;
    expect(tutorialStep(s, now)).toBe('kitten'); // платить 📺/💎 обучение не заставляет
    expect(moveCat(s, kitten.id, 'nursery').ok).toBe(true);
    expect(tutorialStep(s, now)).toBe('toShelter');
  });

  it('малыша унесли из окошка сами — шаг «вырастить» догоняет его в комнате', () => {
    const rng = makeRng(12);
    const s = createInitialState(rng, 0);
    const { female, male } = pair(s);
    startBreeding(s, 0, female.id, male.id, 0, rng);
    const now = s.slots[0]!.readyAt;
    const kitten = collectReady(s, now, rng)[0]!.kitten!;
    expect(moveCat(s, kitten.id, 'shelter').ok).toBe(true); // карточка рождения → «в приют»
    expect(tutorialStep(s, now)).toBe('grow');
    expect(growTarget(s, now)?.id).toBe(kitten.id);
    expect(freeGrowKitten(s, kitten.id, now).ok).toBe(true);
    expect(tutorialStep(s, now)).toBe('adopt');            // слот пуст, кот в Приюте
  });

  it('дошёл до заказов — подсказка «в добрые руки» назад не возвращается', () => {
    const rng = makeRng(13);
    const s = createInitialState(rng, 0);
    const { female, male } = pair(s);
    startBreeding(s, 0, female.id, male.id, 0, rng);
    const kitten = collectReady(s, s.slots[0]!.readyAt, rng)[0]!.kitten!;
    moveCat(s, kitten.id, 'nursery');
    markTutorialSeen(s, 'orders');
    markTutorialSeen(s, 'genolab');
    moveCat(s, kitten.id, 'shelter'); // кот снова в приюте, но шаг уже позади
    expect(tutorialStep(s)).toBe('champion');
  });

  it('донёс кота до станции 🤝 — шаг засчитан, даже если отдавать передумал', () => {
    const rng = makeRng(14);
    const s = createInitialState(rng, 0);
    const { female, male } = pair(s);
    startBreeding(s, 0, female.id, male.id, 0, rng);
    const kitten = collectReady(s, s.slots[0]!.readyAt, rng)[0]!.kitten!;
    moveCat(s, kitten.id, 'shelter');
    freeGrowKitten(s, kitten.id, s.slots[0]!.readyAt);
    expect(tutorialStep(s)).toBe('adopt');

    // открытие диалога «в добрые руки» = шаг пройден; кот остаётся у игрока
    expect(markTutorialSeen(s, 'adopt')).toBe(true);
    expect(s.cats.some((c) => c.id === kitten.id)).toBe(true);
    expect(tutorialStep(s)).toBe('orders');
    expect(markTutorialSeen(s, 'adopt')).toBe(false); // повторно сейв не пачкаем
  });

  it('игрок, обогнавший подсказку, проскакивает шаги (шаг = функция состояния)', () => {
    const rng = makeRng(6);
    const s = createInitialState(rng, 0);
    const { female, male } = pair(s);
    // собрал пару и свёл, ни разу не дождавшись подсказки (и не изучив кота)
    startBreeding(s, 0, female.id, male.id, 0);
    expect(tutorialStep(s)).toBe('wait'); // не 'analyze', не 'drag' и не 'menu'
  });
});

describe('подарочные ускорения роста', () => {
  /** Свести пару и забрать новорождённого: возвращает состояние, малыша и время. */
  function newborn(seed: number) {
    const rng = makeRng(seed);
    const s = createInitialState(rng, 0);
    const { female, male } = pair(s);
    startBreeding(s, 0, female.id, male.id, 0, rng);
    const now = s.slots[0]!.readyAt;
    const kitten = collectReady(s, now, rng)[0]!.kitten!;
    return { s, kitten, now };
  }

  it('новая игра начинается с запаса FREE_GROWTH_COUNT', () => {
    const s = createInitialState(makeRng(19), 0);
    expect(s.freeGrowthLeft).toBe(FREE_GROWTH_COUNT);
  });

  it('котёнок мгновенно взрослеет и списывает один подарок из запаса', () => {
    const { s, kitten, now } = newborn(20);
    expect(isAdult(kitten, now)).toBe(false);
    expect(freeGrowKitten(s, kitten.id, now)).toMatchObject({ ok: true, left: FREE_GROWTH_COUNT - 1 });
    expect(isAdult(kitten, now)).toBe(true);
  });

  it('кончившийся запас больше не растит — остаются 📺/💎', () => {
    const { s, kitten, now } = newborn(21);
    s.freeGrowthLeft = 0;
    expect(freeGrowKitten(s, kitten.id, now).ok).toBe(false);
    expect(isAdult(kitten, now)).toBe(false);
    expect(s.freeGrowthLeft).toBe(0);            // в минус не уходит
  });

  it('на уже взрослом подарок не сгорает', () => {
    const { s, kitten, now } = newborn(22);
    const grown = now + effGrowthMs(kitten);
    expect(freeGrowKitten(s, kitten.id, grown).ok).toBe(true); // уже вырос сам — no-op
    expect(s.freeGrowthLeft).toBe(FREE_GROWTH_COUNT);
  });
});

describe('подарочные Генетические анализы', () => {
  it('новая игра начинается с запаса FREE_ANALYZE_COUNT', () => {
    const s = createInitialState(makeRng(13), 0);
    expect(s.freeAnalyzeLeft).toBe(FREE_ANALYZE_COUNT);
  });

  it('вскрывает кота бесплатно и списывает один подарок из запаса', () => {
    const s = createInitialState(makeRng(14), 0);
    const coins = s.coins;
    const { female, male } = pair(s);
    expect(freeAnalyzeCat(s, female.id)).toMatchObject({ ok: true, left: FREE_ANALYZE_COUNT - 1 });
    expect(female.analyzed).toBe(true);
    expect(s.coins).toBe(coins);                 // подарок — денег не берёт
    expect(freeAnalyzeCat(s, male.id).ok).toBe(true); // запас ещё есть — второй тоже даром
    expect(s.freeAnalyzeLeft).toBe(FREE_ANALYZE_COUNT - 2);
  });

  it('кончившийся запас больше не выдаёт бесплатных анализов', () => {
    const s = createInitialState(makeRng(14), 0);
    s.freeAnalyzeLeft = 0;
    const { female } = pair(s);
    expect(freeAnalyzeCat(s, female.id).ok).toBe(false);
    expect(female.analyzed).toBe(false);
    expect(s.freeAnalyzeLeft).toBe(0);           // в минус не уходит
  });

  it('на уже изученном коте не срабатывает и подарок не сгорает', () => {
    const s = createInitialState(makeRng(15), 0);
    const { female } = pair(s);
    female.analyzed = true;
    expect(freeAnalyzeCat(s, female.id).ok).toBe(false);
    expect(s.freeAnalyzeLeft).toBe(FREE_ANALYZE_COUNT);
  });
});

describe('подарок за пройденное обучение', () => {
  it('начисляет 💰/💎 ровно один раз', () => {
    const s = createInitialState(makeRng(16), 0);
    const coins = s.coins;
    expect(s.crystals).toBe(0);                  // на старте кристаллов нет
    expect(grantTutorialReward(s)).toBe(true);
    expect(s.coins).toBe(coins + TUTORIAL_REWARD_COINS);
    expect(s.crystals).toBe(TUTORIAL_REWARD_CRYSTALS);
    expect(grantTutorialReward(s)).toBe(false);  // второй раз — мимо
    expect(s.crystals).toBe(TUTORIAL_REWARD_CRYSTALS);
  });

  it('подарок ждёт до конца: пока шаги не пройдены, обучение активно', () => {
    const s = createInitialState(makeRng(17), 0);
    expect(tutorialActive(s)).toBe(true);
    expect(s.tutorial.rewardTaken).toBe(false);
    expect(s.crystals).toBe(0);                  // стартовых 💎 нет — они в подарке
  });
});

describe('обучение в сейве', () => {
  it('прогресс переживает сохранение/загрузку', () => {
    const s = createInitialState(makeRng(9), 0);
    finishTutorial(s);
    s.freeAnalyzeLeft = 2;
    s.freeGrowthLeft = 1;
    s.tutorial.previewSeen = true;
    s.tutorial.ordersSeen = true;
    s.tutorial.genolabSeen = true;
    s.tutorial.adoptDone = true;
    s.tutorial.bornOnce = true;
    s.tutorial.rewardTaken = true;
    const back = deserialize(serialize(s));
    expect(back.tutorial).toEqual({
      done: true,
      bornOnce: true, previewSeen: true, ordersSeen: true, genolabSeen: true,
      adoptDone: true, rewardTaken: true,
    });
    expect(back.freeAnalyzeLeft).toBe(2);        // запасы подарков переживают сейв
    expect(back.freeGrowthLeft).toBe(1);
    expect(tutorialStep(back)).toBeNull();
  });

  it('сейв без поля (сделан до появления обучения) — обучение закрыто', () => {
    const s = createInitialState(makeRng(10), 0);
    const raw = JSON.parse(serialize(s)) as Partial<GameState>;
    delete raw.tutorial;
    delete raw.freeAnalyzeLeft;
    delete raw.freeGrowthLeft;
    const back = deserialize(JSON.stringify(raw));
    expect(back.tutorial.done).toBe(true);
    expect(back.freeAnalyzeLeft).toBe(0);          // подарки задним числом не выдаём
    expect(back.freeGrowthLeft).toBe(0);
    expect(tutorialStep(back)).toBeNull();
  });

  it('сейв с недопройденным обучением получает новые шаги, а не пропускает их', () => {
    const s = createInitialState(makeRng(16), 0);
    const raw = JSON.parse(serialize(s)) as LegacySave;
    // сейв старой версии: полей второй половины обучения ещё не существовало
    raw.tutorial = { done: false, freeSkipUsed: false };
    delete raw.freeAnalyzeLeft;
    delete raw.freeGrowthLeft;
    const back = deserialize(JSON.stringify(raw));
    expect(back.freeAnalyzeLeft).toBe(FREE_ANALYZE_COUNT);
    expect(back.freeGrowthLeft).toBe(FREE_GROWTH_COUNT);
    expect(back.tutorial.ordersSeen).toBe(false);
    expect(tutorialStep(back)).toBe('analyze');
  });

  it('старый сейв, где подарки уже потрачены, получает остаток запасов', () => {
    const s = createInitialState(makeRng(18), 0);
    const raw = JSON.parse(serialize(s)) as LegacySave;
    raw.tutorial = { done: false, freeSkipUsed: true, freeAnalyzeUsed: true };
    delete raw.freeAnalyzeLeft;
    delete raw.freeSkipLeft;
    const back = deserialize(JSON.stringify(raw));
    expect(back.freeAnalyzeLeft).toBe(FREE_ANALYZE_COUNT - 1);
    // ускорений вязки больше нет — счётчик вычищается из сейва вместе с легаси-флагами
    expect((back as unknown as LegacySave).freeSkipLeft).toBeUndefined();
    const t = back.tutorial as unknown as Record<string, unknown>;
    expect(t.freeAnalyzeUsed).toBeUndefined();
    expect(t.freeSkipUsed).toBeUndefined();
  });
});
