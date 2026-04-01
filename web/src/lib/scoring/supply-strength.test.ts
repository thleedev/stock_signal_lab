import { describe, it, expect } from 'vitest';
import { calcSupplyStrength } from './supply-strength';

describe('calcSupplyStrength', () => {
  it('외국인+기관 동반 전환 매수 → 70점+', () => {
    const result = calcSupplyStrength({
      foreignStreak: 2,
      institutionStreak: 1,
      foreignNetQty: 500000,
      institutionNetQty: 300000,
      foreignNet5d: 800000,
      institutionNet5d: 500000,
      shortSellRatio: 0.5,
    });
    expect(result.normalizedScore).toBeGreaterThan(70);
  });

  it('외국인+기관 3일+ 연속 매도 → 낮은 점수', () => {
    const result = calcSupplyStrength({
      foreignStreak: -4,
      institutionStreak: -3,
      foreignNetQty: -500000,
      institutionNetQty: -300000,
      foreignNet5d: -1000000,
      institutionNet5d: -600000,
      shortSellRatio: 2.5,
    });
    expect(result.normalizedScore).toBeLessThan(20);
  });

  it('외국인 1일 전환 → 가산점', () => {
    const result = calcSupplyStrength({
      foreignStreak: 1,
      institutionStreak: -1,
      foreignNetQty: 100000,
      institutionNetQty: -50000,
      foreignNet5d: 100000,
      institutionNet5d: -50000,
      shortSellRatio: null,
    });
    expect(result.normalizedScore).toBeGreaterThan(25);
  });

  it('모든 데이터 null → 0점', () => {
    const result = calcSupplyStrength({
      foreignStreak: 0,
      institutionStreak: 0,
      foreignNetQty: null,
      institutionNetQty: null,
      foreignNet5d: null,
      institutionNet5d: null,
      shortSellRatio: null,
    });
    expect(result.normalizedScore).toBe(0);
  });
});
