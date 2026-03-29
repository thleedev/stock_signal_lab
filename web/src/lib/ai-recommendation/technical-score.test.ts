import { describe, it, expect } from 'vitest';
import { calcTechnicalScore, type DailyPrice } from './technical-score';

function makePrices(count: number, baseClose: number, trend: 'up' | 'flat' = 'flat'): DailyPrice[] {
  return Array.from({ length: count }, (_, i) => {
    const close = trend === 'up' ? baseClose + i * 100 : baseClose;
    return {
      date: `2026-03-${String(i + 1).padStart(2, '0')}`,
      open: close - 50,
      high: close + 100,
      low: close - 100,
      close,
      volume: 100000 + i * 1000,
    };
  });
}

describe('calcTechnicalScore 근거 레이어', () => {
  it('충분한 데이터에서 normalizedScore와 reasons를 반환한다', () => {
    const prices = makePrices(40, 10000, 'up');
    const result = calcTechnicalScore(prices, 15000, 8000, 'small');

    expect(result.normalizedScore).toBeGreaterThanOrEqual(0);
    expect(result.normalizedScore).toBeLessThanOrEqual(100);
    expect(result.reasons.length).toBeGreaterThan(0);
    for (const r of result.reasons) {
      expect(r.label).toBeTruthy();
      expect(r.detail).toBeTruthy();
      expect(typeof r.points).toBe('number');
      expect(typeof r.met).toBe('boolean');
    }
  });

  it('데이터 부족 시 normalizedScore 0, reasons 비어있음', () => {
    const result = calcTechnicalScore([], null, null, 'small');
    expect(result.normalizedScore).toBe(0);
    expect(result.reasons).toHaveLength(0);
    expect(result.data_insufficient).toBe(true);
  });

  it('하위 호환: 기존 boolean 필드가 유지된다', () => {
    const prices = makePrices(40, 10000, 'up');
    const result = calcTechnicalScore(prices, 15000, 8000, 'small');

    expect(typeof result.score).toBe('number');
    expect(typeof result.golden_cross).toBe('boolean');
    expect(typeof result.macd_cross).toBe('boolean');
    expect(typeof result.bollinger_bottom).toBe('boolean');
    expect(typeof result.volume_surge).toBe('boolean');
    expect(typeof result.trend_days).toBe('number');
  });
});
