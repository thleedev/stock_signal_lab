import { describe, it, expect } from 'vitest';
import { calcEarningsMomentumScore } from './earnings-momentum-score';

describe('calcEarningsMomentumScore 근거 레이어', () => {
  it('EPS 성장 + 목표주가 시 reasons 포함', () => {
    const result = calcEarningsMomentumScore({
      forwardPer: 10, trailingPer: 15,
      targetPrice: 85000, currentPrice: 62000,
      investOpinion: 4.5, roe: 18,
      revenueGrowthYoy: null, operatingProfitGrowthYoy: 25,
    });
    expect(result.normalizedScore).toBeGreaterThanOrEqual(0);
    expect(result.normalizedScore).toBeLessThanOrEqual(100);
    expect(result.reasons.length).toBeGreaterThan(0);
    const epsReason = result.reasons.find(r => r.label === 'EPS 성장률');
    expect(epsReason).toBeDefined();
    expect(epsReason!.met).toBe(true);
  });

  it('모든 input null일 때 정상 동작', () => {
    const result = calcEarningsMomentumScore({
      forwardPer: null, trailingPer: null,
      targetPrice: null, currentPrice: null,
      investOpinion: null, roe: null,
      revenueGrowthYoy: null, operatingProfitGrowthYoy: null,
    });
    expect(result.normalizedScore).toBe(0);
    expect(result.reasons.every(r => !r.met)).toBe(true);
  });
});
