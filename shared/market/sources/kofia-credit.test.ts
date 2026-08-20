import { describe, it, expect } from 'vitest';
import { parseCreditResponse } from './kofia-credit';

// 2026-08-20 실제 응답 발췌
const SAMPLE = {
  unit: '',
  ds1: [
    { TMPV1: '20260819', TMPV2: 31312008, TMPV3: 24487369, TMPV9: 25126144 },
    { TMPV1: '20260818', TMPV2: 31104533, TMPV3: 24394711, TMPV9: 25194954 },
  ],
};

describe('parseCreditResponse', () => {
  it('신용거래융자 전체를 억원으로 환산해 오름차순 반환한다', () => {
    const points = parseCreditResponse(SAMPLE);
    expect(points).toEqual([
      { date: '2026-08-18', value: 311045.33 },
      { date: '2026-08-19', value: 313120.08 },
    ]);
  });

  it('ds1 이 없거나 형식이 다르면 빈 배열을 반환한다', () => {
    expect(parseCreditResponse({})).toEqual([]);
    expect(parseCreditResponse(null)).toEqual([]);
    expect(parseCreditResponse({ ds1: [{ TMPV1: '잘못', TMPV2: 'x' }] })).toEqual([]);
  });
});
