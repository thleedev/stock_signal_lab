import { describe, it, expect } from 'vitest';
import { calcRiskScore } from './risk-score';

describe('calcRiskScore 근거 레이어', () => {
  it('RSI 과매수 + 급등 시 reasons에 감점 근거 포함', () => {
    const result = calcRiskScore({
      rsi: 75, pct5d: 18, disparity20: 1.12,
      bollingerUpper: 11000, currentPrice: 11500,
      doubleTop: false, foreignNet: -5000, institutionNet: -3000,
      foreignStreak: -4, institutionStreak: -2, shortSellRatio: 12,
    });
    expect(result.normalizedScore).toBeGreaterThanOrEqual(0);
    expect(result.normalizedScore).toBeLessThanOrEqual(100);
    const rsiReason = result.reasons.find(r => r.label === 'RSI 과매수');
    expect(rsiReason).toBeDefined();
    expect(rsiReason!.met).toBe(true);
    expect(rsiReason!.detail).toContain('75');
  });
});
