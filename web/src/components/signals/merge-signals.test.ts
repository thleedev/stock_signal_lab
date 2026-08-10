import { describe, it, expect } from 'vitest';
import { mergeSignals } from './merge-signals';

const sig = (symbol: string, name = symbol) => ({ symbol, name });

describe('mergeSignals', () => {
  it('새 행을 뒤에 이어 붙입니다', () => {
    const result = mergeSignals([sig('A'), sig('B')], [sig('C')]);
    expect(result.map((s) => s.symbol)).toEqual(['A', 'B', 'C']);
  });

  it('이미 있는 symbol 은 건너뜁니다', () => {
    const result = mergeSignals([sig('A'), sig('B')], [sig('B'), sig('C')]);
    expect(result.map((s) => s.symbol)).toEqual(['A', 'B', 'C']);
  });

  it('기존 행의 값을 새 행이 덮어쓰지 않습니다', () => {
    const result = mergeSignals([sig('A', '원래이름')], [sig('A', '새이름')]);
    expect(result[0].name).toBe('원래이름');
  });

  it('들어오는 배열 안의 중복도 제거합니다', () => {
    const result = mergeSignals([], [sig('A'), sig('A'), sig('B')]);
    expect(result.map((s) => s.symbol)).toEqual(['A', 'B']);
  });

  it('빈 배열끼리 병합하면 빈 배열입니다', () => {
    expect(mergeSignals([], [])).toEqual([]);
  });
});
