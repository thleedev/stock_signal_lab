import { describe, it, expect } from 'vitest';
import { calcSupplyScore } from './supply-score';

describe('calcSupplyScore 근거 레이어', () => {
  it('외국인+기관 순매수 시 reasons에 근거가 포함된다', () => {
    const result = calcSupplyScore(
      500000, 10000, 2000000000,
      45230, 12100, 0.5,
      100000, 50000, 3, 1,
      50000
    );

    expect(result.normalizedScore).toBeGreaterThanOrEqual(0);
    expect(result.normalizedScore).toBeLessThanOrEqual(100);

    const foreignReason = result.reasons.find(r => r.label === '외국인 당일');
    expect(foreignReason).toBeDefined();
    expect(foreignReason!.met).toBe(true);
    expect(foreignReason!.detail).toContain('45,230');
  });

  it('모두 null일 때 정상 동작한다', () => {
    const result = calcSupplyScore(null, null, null, null, null, null, null, null, null, null, null);
    expect(result.normalizedScore).toBeGreaterThanOrEqual(0);
    expect(result.normalizedScore).toBeLessThanOrEqual(100);
    expect(result.reasons.length).toBeGreaterThan(0);
  });

  it('하위 호환: 기존 필드가 유지된다', () => {
    const result = calcSupplyScore(500000, 10000, 2000000000, 45230, 12100, 0.5, 100000, 50000, 3, 1, 50000);
    expect(typeof result.score).toBe('number');
    expect(typeof result.foreign_buying).toBe('boolean');
    expect(typeof result.institution_buying).toBe('boolean');
    expect(typeof result.volume_vs_sector).toBe('boolean');
    expect(typeof result.low_short_sell).toBe('boolean');
  });
});
