import { describe, it, expect } from 'vitest';
import { calcValuationAttractiveness } from './valuation-attractiveness';

describe('calcValuationAttractiveness', () => {
  it('목표주가 괴리 30%+ → 최고 가산점', () => {
    const result = calcValuationAttractiveness({
      currentPrice: 50000,
      targetPrice: 75000,
      forwardPer: null, per: null, pbr: null, roe: null,
      dividendYield: null, investOpinion: null,
    });
    // 35/80*100 = 43.75
    expect(result.normalizedScore).toBeGreaterThanOrEqual(43);
  });

  it('PBR < 1.0 + ROE > 10% 복합 → 가산점', () => {
    const result = calcValuationAttractiveness({
      currentPrice: 10000,
      targetPrice: null,
      forwardPer: null,
      per: null,
      pbr: 0.8,
      roe: 15,
      dividendYield: null,
      investOpinion: null,
    });
    expect(result.normalizedScore).toBeGreaterThan(20);
  });

  it('Forward PER < Trailing PER (이익 성장) → 가산점', () => {
    const result = calcValuationAttractiveness({
      currentPrice: 100000,
      targetPrice: null,
      forwardPer: 10,
      per: 15,
      pbr: null, roe: null,
      dividendYield: null, investOpinion: null,
    });
    expect(result.normalizedScore).toBeGreaterThan(20);
  });

  it('목표주가 < 현재가 → 감점 적용', () => {
    const result = calcValuationAttractiveness({
      currentPrice: 100000,
      targetPrice: 90000,
      forwardPer: null, per: null, pbr: null, roe: null,
      dividendYield: null, investOpinion: null,
    });
    expect(result.normalizedScore).toBe(0);
  });

  it('배당수익률 3%+ → 가산점', () => {
    const result = calcValuationAttractiveness({
      currentPrice: 50000,
      targetPrice: null,
      forwardPer: null, per: null, pbr: null, roe: null,
      dividendYield: 4.5,
      investOpinion: null,
    });
    expect(result.normalizedScore).toBeGreaterThan(10);
  });
});
