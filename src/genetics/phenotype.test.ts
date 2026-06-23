import { describe, it, expect } from 'vitest';
import { expressPhenotype } from './phenotype.js';
import { makeCat } from './factory.js';

describe('expressPhenotype: цвет и разбавление', () => {
  it('чёрный солид при DD, голубой при dd', () => {
    const black = makeCat('male', { A: ['a', 'a'], D: ['D', 'D'] });
    const blue = makeCat('male', { A: ['a', 'a'], D: ['d', 'd'] });
    expect(expressPhenotype(black).baseColor).toBe('black');
    expect(expressPhenotype(blue).baseColor).toBe('blue');
  });

  it('шоколад/циннамон по локусу B', () => {
    expect(expressPhenotype(makeCat('male', { B: ['b', 'b'], A: ['a', 'a'] })).baseColor).toBe('chocolate');
    expect(expressPhenotype(makeCat('male', { B: ['b1', 'b1'], A: ['a', 'a'] })).baseColor).toBe('cinnamon');
  });
});

describe('expressPhenotype: рисунок (агути)', () => {
  it('aa без рыжего → сплошной (нет рисунка)', () => {
    expect(expressPhenotype(makeCat('male', { A: ['a', 'a'] })).pattern).toBeNull();
  });

  it('A_ → виден табби', () => {
    expect(expressPhenotype(makeCat('male', { A: ['A', 'a'] })).pattern).not.toBeNull();
  });

  it('рыжий всегда показывает табби даже при aa', () => {
    const redSolidGene = makeCat('male', { O: ['O', 'Y'], A: ['a', 'a'] });
    expect(expressPhenotype(redSolidGene).pattern).not.toBeNull();
  });
});

describe('expressPhenotype: черепаховый окрас', () => {
  it('самка Oo → черепаховая с двумя цветами', () => {
    const p = expressPhenotype(makeCat('female', { O: ['O', 'o'] }));
    expect(p.isTortie).toBe(true);
    expect(p.tortieColors).toBeDefined();
  });

  it('самец не может быть черепаховым обычным путём', () => {
    expect(expressPhenotype(makeCat('male', { O: ['O', 'Y'] })).isTortie).toBe(false);
  });
});

describe('expressPhenotype: колор-пойнт и глаза', () => {
  it('cscs → колор-пойнт с голубыми глазами', () => {
    const p = expressPhenotype(makeCat('male', { C: ['cs', 'cs'], Ey: ['copper', 'copper'] }));
    expect(p.pointed).toBe(true);
    expect(p.pointType).toBe('colorpoint');
    expect(p.eyeColor).toBe('blue');
  });

  it('cb/cs → минк (тонкинез)', () => {
    expect(expressPhenotype(makeCat('male', { C: ['cb', 'cs'] })).pointType).toBe('mink');
  });
});

describe('expressPhenotype: доминантный белый (эпистаз)', () => {
  it('W_ скрывает всё, глаза голубые', () => {
    const p = expressPhenotype(makeCat('male', { W: ['W', 'w'], B: ['b', 'b'], A: ['A', 'A'] }));
    expect(p.white).toBe(true);
    expect(p.baseColor).toBe('white');
    expect(p.pattern).toBeNull();
    expect(p.eyeColor).toBe('blue');
    expect(p.whiteAmount).toBe(1);
  });
});

describe('expressPhenotype: шерсть и морфология', () => {
  it('ll → длинная шерсть', () => {
    expect(expressPhenotype(makeCat('male', { L: ['l', 'l'] })).coatLength).toBe('long');
  });

  it('fold доминирует в одной копии', () => {
    expect(expressPhenotype(makeCat('male', { Ea: ['fold', 'normal'] })).earShape).toBe('fold');
  });

  it('форма морды: round+wedge → normal (неполное доминирование)', () => {
    expect(expressPhenotype(makeCat('male', { Fc: ['round', 'wedge'] })).faceShape).toBe('normal');
    expect(expressPhenotype(makeCat('male', { Fc: ['round', 'round'] })).faceShape).toBe('round');
    expect(expressPhenotype(makeCat('male', { Fc: ['wedge', 'wedge'] })).faceShape).toBe('wedge');
  });
});

describe('expressPhenotype: детерминизм', () => {
  it('один геном → один и тот же облик', () => {
    const cat = makeCat('female', { O: ['O', 'o'], S: ['S', 's'], W: ['W', 'w'] });
    expect(expressPhenotype(cat)).toEqual(expressPhenotype(cat));
  });
});
