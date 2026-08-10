import { describe, it, expect } from 'vitest';
import { makeRng } from '../genetics/index.js';
import {
  createInitialState, assignBreeder, startBreeding, collectReady, incubationDuration,
  freeSkipBreeding, freeAnalyzeCat, adoptCat, moveCat, clearBreederSlot, setChampion,
  tutorialStep, tutorialActive, finishTutorial, restartTutorial, markTutorialSeen,
  serialize, deserialize,
} from './index.js';
import type { GameState } from './index.js';

function pair(s: GameState) {
  const female = s.cats.find((c) => c.genotype.sex === 'female')!;
  const male = s.cats.find((c) => c.genotype.sex === 'male')!;
  return { female, male };
}

/** Первый шаг (подарочный анализ) — не тема теста: проходим его и идём дальше. */
function skipAnalyze(s: GameState): void {
  freeAnalyzeCat(s, s.cats[0]!.id);
}

describe('обучение новичка (шаги)', () => {
  it('новая игра начинается с шага «генетический анализ»', () => {
    const s = createInitialState(makeRng(1), 0);
    expect(tutorialStep(s)).toBe('analyze');
    expect(tutorialActive(s)).toBe(true);
    skipAnalyze(s);
    expect(tutorialStep(s)).toBe('drag'); // изучил кота → тащим пару в слот
  });

  it('DEV-перезапуск возвращает обучение, подарки и отметки просмотров', () => {
    const s = createInitialState(makeRng(11), 0);
    finishTutorial(s);
    s.tutorial.freeSkipUsed = true;
    s.tutorial.freeAnalyzeUsed = true;
    s.tutorial.previewSeen = true;
    expect(tutorialActive(s)).toBe(false);

    restartTutorial(s);
    expect(tutorialStep(s)).toBe('analyze');
    expect(s.tutorial.freeSkipUsed).toBe(false);
    expect(s.tutorial.freeAnalyzeUsed).toBe(false);
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

  it('идёт вязка → «ускорь бесплатно», после подарка → «жди»', () => {
    const s = createInitialState(makeRng(4), 0);
    const { female, male } = pair(s);
    startBreeding(s, 0, female.id, male.id, 0);
    expect(tutorialStep(s)).toBe('skip');
    expect(freeSkipBreeding(s, 0, 1000).ok).toBe(true);
    // подарок потрачен: если бы вязка ещё шла, шаг стал бы 'wait'
    s.slots[0]!.readyAt = 999_999;
    expect(tutorialStep(s)).toBe('wait');
  });

  it('после первого котёнка: малыш → приют → «в добрые руки» → заказы → пьедестал', () => {
    const rng = makeRng(5);
    const s = createInitialState(rng, 0);
    const { female, male } = pair(s);
    startBreeding(s, 0, female.id, male.id, 0);
    const now = incubationDuration(s);
    const kitten = collectReady(s, now, rng)[0]!.kitten!;
    expect(kitten.motherBreed).toBeTruthy();

    // малыш сидит в окошке вязки — сначала пристраиваем его в Приют
    expect(tutorialStep(s)).toBe('kitten');
    expect(moveCat(s, kitten.id, 'shelter').ok).toBe(true);
    expect(tutorialStep(s)).toBe('adopt');

    // отдали «в добрые руки» — шаг отмечен самим действием (кот из состояния исчез)
    expect(adoptCat(s, kitten.id).ok).toBe(true);
    expect(s.tutorial.adoptDone).toBe(true);
    expect(tutorialStep(s)).toBe('orders');

    markTutorialSeen(s, 'orders');
    expect(tutorialStep(s)).toBe('champion');

    // родители остались в слоте — забираем маму и ставим на пьедестал
    clearBreederSlot(s, female.id);
    expect(setChampion(s, female.id, 0, now).ok).toBe(true);
    expect(tutorialStep(s)).toBeNull(); // шагов больше нет — показ закроет обучение
  });

  it('малыша унесли в Питомник — пристраивать некого, шаг пропускается', () => {
    const rng = makeRng(12);
    const s = createInitialState(rng, 0);
    const { female, male } = pair(s);
    startBreeding(s, 0, female.id, male.id, 0);
    const kitten = collectReady(s, incubationDuration(s), rng)[0]!.kitten!;
    expect(moveCat(s, kitten.id, 'nursery').ok).toBe(true);
    expect(tutorialStep(s)).toBe('orders');
  });

  it('дошёл до заказов — подсказка «в добрые руки» назад не возвращается', () => {
    const rng = makeRng(13);
    const s = createInitialState(rng, 0);
    const { female, male } = pair(s);
    startBreeding(s, 0, female.id, male.id, 0);
    const kitten = collectReady(s, incubationDuration(s), rng)[0]!.kitten!;
    moveCat(s, kitten.id, 'nursery');
    markTutorialSeen(s, 'orders');
    moveCat(s, kitten.id, 'shelter'); // кот снова в приюте, но шаг уже позади
    expect(tutorialStep(s)).toBe('champion');
  });

  it('игрок, обогнавший подсказку, проскакивает шаги (шаг = функция состояния)', () => {
    const rng = makeRng(6);
    const s = createInitialState(rng, 0);
    const { female, male } = pair(s);
    // собрал пару и свёл, ни разу не дождавшись подсказки (и не изучив кота)
    startBreeding(s, 0, female.id, male.id, 0);
    expect(tutorialStep(s)).toBe('skip'); // не 'analyze', не 'drag' и не 'menu'
  });
});

describe('подарочный ускоритель первой вязки', () => {
  it('срабатывает один раз и завершает вязку немедленно', () => {
    const rng = makeRng(7);
    const s = createInitialState(rng, 0);
    const { female, male } = pair(s);
    startBreeding(s, 0, female.id, male.id, 0);
    expect(freeSkipBreeding(s, 0, 1000).ok).toBe(true);
    expect(s.slots[0]!.readyAt).toBe(1000);           // готово прямо сейчас
    expect(collectReady(s, 1000, rng)).toHaveLength(1);
    // второй раз — отказ (кристаллы/реклама остаются единственным способом)
    s.slots[0]!.kittenId = null; // малыша из слота унесли, слот снова под пару
    startBreeding(s, 0, female.id, male.id, 2000);
    const again = freeSkipBreeding(s, 0, 2000);
    expect(again.ok).toBe(false);
    expect(s.slots[0]!.readyAt).toBeGreaterThan(2000); // таймер не тронут
  });

  it('на пустом слоте не срабатывает и подарок не сгорает', () => {
    const s = createInitialState(makeRng(8), 0);
    expect(freeSkipBreeding(s, 0, 0).ok).toBe(false);
    expect(s.tutorial.freeSkipUsed).toBe(false);
  });
});

describe('подарочный Генетический анализ', () => {
  it('вскрывает кота бесплатно и выдаётся ровно один раз', () => {
    const s = createInitialState(makeRng(14), 0);
    const coins = s.coins;
    const { female, male } = pair(s);
    expect(freeAnalyzeCat(s, female.id).ok).toBe(true);
    expect(female.analyzed).toBe(true);
    expect(s.coins).toBe(coins);                 // подарок — денег не берёт
    expect(s.tutorial.freeAnalyzeUsed).toBe(true);
    expect(freeAnalyzeCat(s, male.id).ok).toBe(false); // второму — только 💰/📺
    expect(male.analyzed).toBe(false);
  });

  it('на уже изученном коте не срабатывает и подарок не сгорает', () => {
    const s = createInitialState(makeRng(15), 0);
    const { female } = pair(s);
    female.analyzed = true;
    expect(freeAnalyzeCat(s, female.id).ok).toBe(false);
    expect(s.tutorial.freeAnalyzeUsed).toBe(false);
  });
});

describe('обучение в сейве', () => {
  it('прогресс переживает сохранение/загрузку', () => {
    const s = createInitialState(makeRng(9), 0);
    finishTutorial(s);
    s.tutorial.freeSkipUsed = true;
    s.tutorial.freeAnalyzeUsed = true;
    s.tutorial.previewSeen = true;
    s.tutorial.ordersSeen = true;
    s.tutorial.adoptDone = true;
    s.tutorial.bornOnce = true;
    const back = deserialize(serialize(s));
    expect(back.tutorial).toEqual({
      done: true, freeSkipUsed: true, freeAnalyzeUsed: true,
      bornOnce: true, previewSeen: true, ordersSeen: true, adoptDone: true,
    });
    expect(tutorialStep(back)).toBeNull();
  });

  it('сейв без поля (сделан до появления обучения) — обучение закрыто', () => {
    const s = createInitialState(makeRng(10), 0);
    const raw = JSON.parse(serialize(s)) as Partial<GameState>;
    delete raw.tutorial;
    const back = deserialize(JSON.stringify(raw));
    expect(back.tutorial.done).toBe(true);
    expect(back.tutorial.freeSkipUsed).toBe(true); // подарок задним числом не выдаём
    expect(back.tutorial.freeAnalyzeUsed).toBe(true);
    expect(tutorialStep(back)).toBeNull();
  });

  it('сейв с недопройденным обучением получает новые шаги, а не пропускает их', () => {
    const s = createInitialState(makeRng(16), 0);
    const raw = JSON.parse(serialize(s)) as { tutorial: Record<string, boolean> };
    // сейв старой версии: полей второй половины обучения ещё не существовало
    raw.tutorial = { done: false, freeSkipUsed: false };
    const back = deserialize(JSON.stringify(raw));
    expect(back.tutorial.freeAnalyzeUsed).toBe(false);
    expect(back.tutorial.ordersSeen).toBe(false);
    expect(tutorialStep(back)).toBe('analyze');
  });
});
