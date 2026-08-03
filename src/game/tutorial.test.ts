import { describe, it, expect } from 'vitest';
import { makeRng } from '../genetics/index.js';
import {
  createInitialState, assignBreeder, startBreeding, collectReady, incubationDuration,
  freeSkipBreeding, tutorialStep, tutorialActive, finishTutorial, restartTutorial,
  serialize, deserialize,
} from './index.js';
import type { GameState } from './index.js';

function pair(s: GameState) {
  const female = s.cats.find((c) => c.genotype.sex === 'female')!;
  const male = s.cats.find((c) => c.genotype.sex === 'male')!;
  return { female, male };
}

describe('обучение новичка (шаги)', () => {
  it('новая игра начинается с шага «перетащи кота в слот»', () => {
    const s = createInitialState(makeRng(1), 0);
    expect(tutorialStep(s)).toBe('drag');
    expect(tutorialActive(s)).toBe(true);
  });

  it('DEV-перезапуск возвращает обучение и подарочный ускоритель', () => {
    const s = createInitialState(makeRng(11), 0);
    finishTutorial(s);
    s.tutorial.freeSkipUsed = true;
    expect(tutorialActive(s)).toBe(false);

    restartTutorial(s);
    expect(tutorialStep(s)).toBe('drag');
    expect(s.tutorial.freeSkipUsed).toBe(false);
  });

  it('один кот в слоте → второго кнопкой из меню; пара → «Свести»', () => {
    const s = createInitialState(makeRng(2), 0);
    const { female, male } = pair(s);
    assignBreeder(s, 0, female.id, 0);
    expect(tutorialStep(s)).toBe('menu');
    assignBreeder(s, 0, male.id, 0);
    expect(tutorialStep(s)).toBe('breed');
  });

  it('шаг не зависит от того, кого поставили первым (кота или кошку)', () => {
    const s = createInitialState(makeRng(3), 0);
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

  it('котёнок родился → шаг «Котодекс», дальше обучение закрывается', () => {
    const rng = makeRng(5);
    const s = createInitialState(rng, 0);
    const { female, male } = pair(s);
    startBreeding(s, 0, female.id, male.id, 0);
    const kitten = collectReady(s, incubationDuration(s), rng)[0]!.kitten!;
    expect(kitten.motherBreed).toBeTruthy();
    expect(tutorialStep(s)).toBe('codex');
    finishTutorial(s);
    expect(tutorialStep(s)).toBeNull();
    expect(tutorialActive(s)).toBe(false);
  });

  it('игрок, обогнавший подсказку, проскакивает шаги (шаг = функция состояния)', () => {
    const rng = makeRng(6);
    const s = createInitialState(rng, 0);
    const { female, male } = pair(s);
    // собрал пару и свёл, ни разу не дождавшись подсказки
    startBreeding(s, 0, female.id, male.id, 0);
    expect(tutorialStep(s)).toBe('skip'); // не 'drag' и не 'menu'
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

describe('обучение в сейве', () => {
  it('прогресс переживает сохранение/загрузку', () => {
    const s = createInitialState(makeRng(9), 0);
    finishTutorial(s);
    s.tutorial.freeSkipUsed = true;
    const back = deserialize(serialize(s));
    expect(back.tutorial).toEqual({ done: true, freeSkipUsed: true });
    expect(tutorialStep(back)).toBeNull();
  });

  it('сейв без поля (сделан до появления обучения) — обучение закрыто', () => {
    const s = createInitialState(makeRng(10), 0);
    const raw = JSON.parse(serialize(s)) as Partial<GameState>;
    delete raw.tutorial;
    const back = deserialize(JSON.stringify(raw));
    expect(back.tutorial.done).toBe(true);
    expect(back.tutorial.freeSkipUsed).toBe(true); // подарок задним числом не выдаём
    expect(tutorialStep(back)).toBeNull();
  });
});
