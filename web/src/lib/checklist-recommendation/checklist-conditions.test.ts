import { describe, it, expect } from 'vitest';
import { evaluateConditions } from './checklist-conditions';
import type { DailyPrice } from '@/lib/ai-recommendation/technical-score';

function makePrices(count: number, base: number): DailyPrice[] {
  return Array.from({ length: count }, (_, i) => ({
    date: `2026-03-${String(i + 1).padStart(2, '0')}`,
    open: base - 50 + i * 50, high: base + 200 + i * 50,
    low: base - 200 + i * 50, close: base + i * 50,
    volume: 100000,
  }));
}

describe('evaluateConditions', () => {
  it('12개 조건 결과를 반환한다', () => {
    const results = evaluateConditions({
      prices: makePrices(65, 10000),
      high52w: 15000, low52w: 8000,
      foreignNet: 5000, institutionNet: 3000,
      foreignStreak: 3, institutionStreak: 1,
      currentVolume: 200000, avgVolume20d: 100000,
      per: 10, forwardPer: 8, pbr: 0.8, roe: 15,
      targetPrice: 85000, currentPrice: 62000,
      investOpinion: 4.5, rsi: null, pct5d: 3, shortSellRatio: 0.5,
    });
    expect(results).toHaveLength(12);
    for (const r of results) {
      expect(r.id).toBeTruthy();
      expect(r.label).toBeTruthy();
      expect(typeof r.met).toBe('boolean');
      expect(r.detail).toBeTruthy();
    }
  });

  it('데이터 없으면 na=true로 표시', () => {
    const results = evaluateConditions({
      prices: [], high52w: null, low52w: null,
      foreignNet: null, institutionNet: null,
      foreignStreak: null, institutionStreak: null,
      currentVolume: null, avgVolume20d: null,
      per: null, forwardPer: null, pbr: null, roe: null,
      targetPrice: null, currentPrice: null,
      investOpinion: null, rsi: null, pct5d: 0, shortSellRatio: null,
    });
    const naCount = results.filter(r => r.na).length;
    expect(naCount).toBeGreaterThan(0);
  });

  it('리스크 조건은 역방향으로 판정한다', () => {
    const results = evaluateConditions({
      prices: makePrices(30, 10000),
      high52w: null, low52w: null,
      foreignNet: 1000, institutionNet: 500,
      foreignStreak: 1, institutionStreak: 1,
      currentVolume: 100000, avgVolume20d: 100000,
      per: 10, forwardPer: null, pbr: 0.8, roe: 15,
      targetPrice: null, currentPrice: 10000,
      investOpinion: null, rsi: 45, pct5d: 3, shortSellRatio: null,
    });
    const noOverbought = results.find(r => r.id === 'no_overbought');
    expect(noOverbought!.met).toBe(true); // RSI 45 < 70
    const noSurge = results.find(r => r.id === 'no_surge');
    expect(noSurge!.met).toBe(true); // pct5d 3 < 15
  });
});
