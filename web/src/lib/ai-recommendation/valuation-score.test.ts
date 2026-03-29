import { describe, it, expect } from 'vitest';
import { calcValuationScore } from './valuation-score';

describe('calcValuationScore 근거 레이어', () => {
  it('Forward PER + 목표주가 시 reasons에 근거 포함', () => {
    const result = calcValuationScore(12, 0.8, 15.3, 2.5,
      { forwardPer: 9.8, targetPrice: 85000, investOpinion: 4.5, currentPrice: 62000 }, 'mid');
    expect(result.normalizedScore).toBeGreaterThanOrEqual(0);
    expect(result.normalizedScore).toBeLessThanOrEqual(100);
    const targetReason = result.reasons.find(r => r.label === '목표주가 상승여력');
    expect(targetReason).toBeDefined();
    expect(targetReason!.met).toBe(true);
  });

  it('하위 호환: per, pbr, roe 필드 유지', () => {
    const result = calcValuationScore(10, 0.8, 15, null, null, 'small');
    expect(typeof result.score).toBe('number');
    expect(result.per).toBe(10);
    expect(result.pbr).toBe(0.8);
    expect(result.roe).toBe(15);
  });
});
