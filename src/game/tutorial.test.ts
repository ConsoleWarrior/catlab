import { describe, it, expect } from 'vitest';
import { makeRng } from '../genetics/index.js';
import {
  createInitialState, assignBreeder, startBreeding, collectReady,
  freeAnalyzeCat, freeGrowKitten, adoptCat, moveCat, clearBreederSlot, setChampion, analyzeTarget,
  tutorialStep, tutorialActive, finishTutorial, restartTutorial,
  markTutorialSeen, markTutorialTab, tutorialMenuGate, shelterTarget, growTarget,
  tutorialLock, tutorialAllows, tutorialAllowsCat, tutorialAllowsRoom,
  TUTOR_GENOLAB_TABS, nextGenolabTab, breederTarget, championTarget,
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
    // Генолаб показываем ЦЕЛИКОМ — все три вкладки по очереди
    expect(tutorialStep(s, now)).toBe('genolab');
    for (const tab of TUTOR_GENOLAB_TABS) {
      expect(nextGenolabTab(s)).toBe(tab);
      expect(markTutorialTab(s, tab)).toBe(true);
    }
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
    for (const tab of TUTOR_GENOLAB_TABS) markTutorialTab(s, tab);
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

/**
 * Замок обучения: на каждом шаге разрешено РОВНО ОДНО действие. Раньше запреты
 * держала одна лишь заслонка UI (затемнение с окном вокруг цели), и её обходили
 * в одно движение: взял кота за шкирку — заслонка погасла — уронил в 🧺 корзину
 * и продал посреди обучения. Теперь запрет живёт в ядре, и эти тесты стерегут
 * именно его: что нельзя ни взять чужого кота, ни уронить своего не туда, ни
 * нажать соседнюю кнопку, ни уйти в чужую комнату.
 */
describe('замок обучения (что разрешено на шаге)', () => {
  /** Провести партию до второй половины обучения: помёт собран, малыш растёт. */
  function afterBirth(seed: number) {
    const rng = makeRng(seed);
    const s = createInitialState(rng, 0);
    const { female, male } = pair(s);
    startBreeding(s, 0, female.id, male.id, 0, rng);
    const now = s.slots[0]!.readyAt;
    const kitten = collectReady(s, now, rng)[0]!.kitten!;
    return { s, now, female, male, kitten };
  }

  it('шаг «анализ»: только тап по подсвеченному коту — ни жеста, ни зон дропа', () => {
    const s = createInitialState(makeRng(31), 0);
    const { female, male } = pair(s);
    const lock = tutorialLock(s)!;
    expect(lock.step).toBe('analyze');
    expect(lock.cats).toEqual([female.id]);
    expect(tutorialAllowsCat(s, female.id, 'tap')).toBe(true);
    expect(tutorialAllowsCat(s, female.id, 'grab')).toBe(false); // «за шкирку» нельзя
    expect(tutorialAllowsCat(s, male.id, 'tap')).toBe(false);    // и другого не выбрать
    for (const zone of ['slot', 'basket', 'pedestal', 'adopt', 'lab', 'cryo']) {
      expect(tutorialAllows(s, zone)).toBe(false);
    }
    expect(tutorialAllowsRoom(s, 'shelter')).toBe(false);
  });

  it('шаг «в слот»: кота только несут, и только в окошко вязки', () => {
    const s = createInitialState(makeRng(32), 0);
    skipAnalyze(s);
    const target = breederTarget(s)!;
    expect(tutorialStep(s)).toBe('drag');
    expect(tutorialAllowsCat(s, target.id, 'grab')).toBe(true);
    expect(tutorialAllowsCat(s, target.id, 'tap')).toBe(false); // меню тут не открыть
    expect(tutorialAllows(s, 'slot')).toBe(true);
    // ровно тот случай, которым обучение и ломали: корзина, пьедестал, криокапсула
    for (const zone of ['basket', 'pedestal', 'cryo', 'adopt', 'lab']) {
      expect(tutorialAllows(s, zone)).toBe(false);
    }
    // нести можно только между Питомником и Инкубатором (краевое листание)
    expect(tutorialAllowsRoom(s, 'incubator')).toBe(true);
    expect(tutorialAllowsRoom(s, 'nursery')).toBe(true);
    expect(tutorialAllowsRoom(s, 'shelter')).toBe(false);
  });

  it('шаг «второй кнопкой»: только тап, и только по коту противоположного пола', () => {
    const s = createInitialState(makeRng(33), 0);
    skipAnalyze(s);
    const { female, male } = pair(s);
    assignBreeder(s, 0, female.id, 0);
    expect(tutorialStep(s)).toBe('menu');
    expect(tutorialAllowsCat(s, male.id, 'tap')).toBe(true);
    expect(tutorialAllowsCat(s, male.id, 'grab')).toBe(false);
    expect(tutorialAllowsCat(s, female.id, 'tap')).toBe(false);
  });

  it('🔮 прогноз и «Свести» живут по очереди — кнопки стоят вплотную', () => {
    const s = createInitialState(makeRng(34), 0);
    skipAnalyze(s);
    const { female, male } = pair(s);
    assignBreeder(s, 0, female.id, 0);
    assignBreeder(s, 0, male.id, 0);
    expect(tutorialStep(s)).toBe('preview');
    expect(tutorialAllows(s, 'preview')).toBe(true);
    expect(tutorialAllows(s, 'breed')).toBe(false);
    markTutorialSeen(s, 'preview');
    expect(tutorialStep(s)).toBe('breed');
    expect(tutorialAllows(s, 'breed')).toBe(true);
    expect(tutorialAllows(s, 'preview')).toBe(false); // назад к прогнозу уже нельзя
  });

  it('шаг «вырасти»: малыша нельзя ни двигать, ни пристраивать; родителей — трогать', () => {
    const { s, now, female, male, kitten } = afterBirth(35);
    expect(tutorialStep(s, now)).toBe('grow');
    expect(tutorialAllowsCat(s, kitten.id, 'tap', now)).toBe(true);
    expect(tutorialAllowsCat(s, kitten.id, 'grab', now)).toBe(false);
    expect(tutorialAllowsCat(s, female.id, 'tap', now)).toBe(false);
    expect(tutorialAllowsCat(s, male.id, 'grab', now)).toBe(false);
    // обе кнопки карточки малыша («🏠 В питомник» / «🏚️ В приют») мертвы
    expect(tutorialAllows(s, 'toNursery', now)).toBe(false);
    expect(tutorialAllows(s, 'toShelter', now)).toBe(false);
  });

  it('шаг «освободи слот»: только в Питомник, в Приют — нельзя', () => {
    const { s, now, kitten } = afterBirth(36);
    freeGrowKitten(s, kitten.id, now);
    expect(tutorialStep(s, now)).toBe('kitten');
    expect(tutorialAllows(s, 'toNursery', now)).toBe(true);
    expect(tutorialAllows(s, 'toShelter', now)).toBe(false);
    expect(tutorialMenuGate(s, kitten, now)).toEqual({ open: true, actions: ['nursery'] });
    expect(tutorialAllowsCat(s, kitten.id, 'grab', now)).toBe(false);
  });

  it('шаг «в приют»: только тап по подсвеченному коту, таскать нельзя', () => {
    const { s, now, male, kitten } = afterBirth(37);
    freeGrowKitten(s, kitten.id, now);
    moveCat(s, kitten.id, 'nursery');
    expect(tutorialStep(s, now)).toBe('toShelter');
    expect(shelterTarget(s)?.id).toBe(male.id);
    expect(tutorialAllowsCat(s, male.id, 'tap', now)).toBe(true);
    expect(tutorialAllowsCat(s, male.id, 'grab', now)).toBe(false);
    expect(tutorialAllowsCat(s, kitten.id, 'tap', now)).toBe(false);
    expect(tutorialMenuGate(s, male, now)).toEqual({ open: true, actions: ['shelter'] });
  });

  it('шаг «в добрые руки»: только станция 🤝 и только в Приюте', () => {
    const { s, now, male, kitten } = afterBirth(38);
    freeGrowKitten(s, kitten.id, now);
    moveCat(s, kitten.id, 'nursery');
    moveCat(s, male.id, 'shelter');
    clearBreederSlot(s, male.id);
    expect(tutorialStep(s, now)).toBe('adopt');
    expect(tutorialAllowsCat(s, male.id, 'grab', now)).toBe(true);
    expect(tutorialAllows(s, 'adopt', now)).toBe(true);
    expect(tutorialAllows(s, 'lab', now)).toBe(false);   // биобанк рядом — мимо него
    expect(tutorialAllowsRoom(s, 'nursery', now)).toBe(false); // и унести некуда
  });

  it('шаг «заказы»: доску открывают, чтобы прочитать, — выполнять нечего', () => {
    const { s, now, male, kitten } = afterBirth(39);
    freeGrowKitten(s, kitten.id, now);
    moveCat(s, kitten.id, 'nursery');
    moveCat(s, male.id, 'shelter');
    clearBreederSlot(s, male.id);
    markTutorialSeen(s, 'adopt');
    expect(tutorialStep(s, now)).toBe('orders');
    expect(tutorialAllows(s, 'orders', now)).toBe(true);
    expect(tutorialAllows(s, 'orderClaim', now)).toBe(false);
    expect(tutorialAllows(s, 'orderRefresh', now)).toBe(false);
    expect(tutorialAllows(s, 'basket', now)).toBe(false);
    expect(tutorialAllowsCat(s, kitten.id, 'grab', now)).toBe(false);
  });

  it('шаг «Генолаб»: вкладки открываются строго по очереди', () => {
    const { s, now, male, kitten } = afterBirth(40);
    freeGrowKitten(s, kitten.id, now);
    moveCat(s, kitten.id, 'nursery');
    moveCat(s, male.id, 'shelter');
    clearBreederSlot(s, male.id);
    markTutorialSeen(s, 'adopt');
    markTutorialSeen(s, 'orders');
    expect(tutorialStep(s, now)).toBe('genolab');
    // очередь Котодекса — остальные две мертвы, и в зачёт не идут
    expect(tutorialAllows(s, 'codex', now)).toBe(true);
    expect(tutorialAllows(s, 'research', now)).toBe(false);
    expect(markTutorialTab(s, 'recipes')).toBe(false);
    expect(markTutorialTab(s, 'codex')).toBe(true);
    expect(tutorialAllows(s, 'research', now)).toBe(true);
    expect(markTutorialTab(s, 'research')).toBe(true);
    expect(tutorialStep(s, now)).toBe('genolab');     // одной вкладки мало
    expect(markTutorialTab(s, 'recipes')).toBe(true);
    expect(s.tutorial.genolabSeen).toBe(true);
    expect(tutorialStep(s, now)).toBe('champion');
  });

  it('шаг «пьедестал»: кота только несут на тумбу — не тапают и не в корзину', () => {
    const { s, now, female, male, kitten } = afterBirth(41);
    freeGrowKitten(s, kitten.id, now);
    moveCat(s, kitten.id, 'nursery');
    moveCat(s, male.id, 'shelter');
    clearBreederSlot(s, male.id);
    clearBreederSlot(s, female.id);
    markTutorialSeen(s, 'adopt');
    markTutorialSeen(s, 'orders');
    for (const tab of TUTOR_GENOLAB_TABS) markTutorialTab(s, tab);
    expect(tutorialStep(s, now)).toBe('champion');
    const target = championTarget(s, now)!;
    expect(tutorialAllowsCat(s, target.id, 'grab', now)).toBe(true);
    expect(tutorialAllowsCat(s, target.id, 'tap', now)).toBe(false);
    expect(tutorialAllows(s, 'pedestal', now)).toBe(true);
    expect(tutorialAllows(s, 'basket', now)).toBe(false);
    expect(tutorialAllows(s, 'cryo', now)).toBe(false);
    expect(tutorialAllowsRoom(s, 'shelter', now)).toBe(false);
  });

  it('вне обучения замка нет — игра ничего не запрещает', () => {
    const s = createInitialState(makeRng(42), 0);
    finishTutorial(s);
    expect(tutorialLock(s)).toBeNull();
    expect(tutorialAllows(s, 'basket')).toBe(true);
    expect(tutorialAllowsRoom(s, 'shelter')).toBe(true);
    expect(tutorialAllowsCat(s, s.cats[0]!.id, 'grab')).toBe(true);
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
    s.tutorial.genolabTabs = [...TUTOR_GENOLAB_TABS];
    s.tutorial.adoptDone = true;
    s.tutorial.bornOnce = true;
    s.tutorial.rewardTaken = true;
    const back = deserialize(serialize(s));
    expect(back.tutorial).toEqual({
      done: true,
      bornOnce: true, previewSeen: true, ordersSeen: true, genolabSeen: true,
      genolabTabs: [...TUTOR_GENOLAB_TABS], adoptDone: true, rewardTaken: true,
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
