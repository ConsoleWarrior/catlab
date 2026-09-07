import { describe, it, expect } from 'vitest';
import { makeRng } from '../genetics/index.js';
import {
  createInitialState, serialize, deserialize, canAskReview, noteReviewAsked,
  REVIEW_ASK_MAX, REVIEW_ASK_COOLDOWN_MS,
} from './index.js';

describe('просьба оценить игру (свой лимит поверх feedback API)', () => {
  it('новая игра: спросить можно сразу', () => {
    const s = createInitialState(makeRng(1), 0);
    expect(s.reviewAsks).toBe(0);
    expect(canAskReview(s, 1000)).toBe(true);
  });

  it('после показа окна — пауза в трое суток', () => {
    const s = createInitialState(makeRng(2), 0);
    const t0 = 1_000_000;
    noteReviewAsked(s, t0);
    expect(s.reviewAsks).toBe(1);
    expect(canAskReview(s, t0)).toBe(false);
    expect(canAskReview(s, t0 + REVIEW_ASK_COOLDOWN_MS - 1)).toBe(false);
    expect(canAskReview(s, t0 + REVIEW_ASK_COOLDOWN_MS)).toBe(true);
  });

  it('всего не больше REVIEW_ASK_MAX попыток, даже спустя месяцы', () => {
    const s = createInitialState(makeRng(3), 0);
    let now = 0;
    for (let i = 0; i < REVIEW_ASK_MAX; i++) {
      expect(canAskReview(s, now)).toBe(true);
      noteReviewAsked(s, now);
      now += REVIEW_ASK_COOLDOWN_MS * 10;
    }
    expect(s.reviewAsks).toBe(REVIEW_ASK_MAX);
    expect(canAskReview(s, now)).toBe(false);
  });

  it('счётчик переживает сохранение, у старого сейва — чистый', () => {
    const s = createInitialState(makeRng(4), 0);
    noteReviewAsked(s, 5_000);
    const back = deserialize(serialize(s));
    expect(back.reviewAsks).toBe(1);
    expect(back.reviewLastAskAt).toBe(5_000);

    // сейв, сделанный до появления полей
    const legacy = JSON.parse(serialize(s)) as Record<string, unknown>;
    delete legacy.reviewAsks;
    delete legacy.reviewLastAskAt;
    const old = deserialize(JSON.stringify(legacy));
    expect(old.reviewAsks).toBe(0);
    expect(canAskReview(old, 0)).toBe(true);
  });
});
