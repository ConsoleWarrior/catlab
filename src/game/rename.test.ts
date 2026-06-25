import { describe, it, expect } from 'vitest';
import { makeRng } from '../genetics/index.js';
import { createInitialState, renameCat } from './index.js';

describe('renameCat', () => {
  it('задаёт имя, обрезает пробелы и длину до 16', () => {
    const s = createInitialState(makeRng(1), 0);
    const cat = s.cats[0]!;
    expect(renameCat(s, cat.id, '  Барсик  ').ok).toBe(true);
    expect(cat.name).toBe('Барсик');

    renameCat(s, cat.id, 'a'.repeat(40));
    expect(cat.name).toHaveLength(16);
  });

  it('пустое имя сбрасывает name, неизвестный кот — ошибка', () => {
    const s = createInitialState(makeRng(2), 0);
    const cat = s.cats[0]!;
    renameCat(s, cat.id, 'Мурка');
    expect(renameCat(s, cat.id, '   ').ok).toBe(true);
    expect(cat.name).toBeUndefined();
    expect(renameCat(s, 'нет-такого', 'X').ok).toBe(false);
  });
});
