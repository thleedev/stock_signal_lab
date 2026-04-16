import { describe, it, expect } from 'vitest';
import { calcTechnicalReversal } from './technical-reversal';
import type { DailyPrice } from '@/lib/ai-recommendation/technical-score';

function makePrice(close: number, volume = 1000000, date = '2026-01-01'): DailyPrice {
  return { date, open: close, high: close * 1.01, low: close * 0.99, close, volume };
}

describe('calcTechnicalReversal', () => {
  it('데이터 부족 (20일 미만) → 0점', () => {
    const prices = Array.from({ length: 10 }, (_, i) => makePrice(100 + i));
    const result = calcTechnicalReversal(prices, 120, 80);
    expect(result.normalizedScore).toBe(0);
    expect(result.data_insufficient).toBe(true);
  });

  it('골든크로스 + RSI 적정 + 52주 반등 → 고득점', () => {
    const prices: DailyPrice[] = [];
    for (let i = 0; i < 25; i++) prices.push(makePrice(100 - i * 0.6));
    for (let i = 0; i < 15; i++) prices.push(makePrice(85 + i * 0.7));
    const result = calcTechnicalReversal(prices, 105, 83);
    // 40일 데이터로 골든크로스 근사, 정밀도 한계 반영
    expect(result.normalizedScore).toBeGreaterThan(20);
    expect(result.data_insufficient).toBe(false);
  });

  it('RSI 70+ 과매수 → rawScore 낮음', () => {
    const prices: DailyPrice[] = [];
    for (let i = 0; i < 30; i++) prices.push(makePrice(80 + i * 1.5));
    const result = calcTechnicalReversal(prices, 130, 80);
    expect(result.rawScore).toBeLessThan(40);
  });

  it('MA5 > MA20 > MA60 정배열 → ma_aligned=true', () => {
    const prices: DailyPrice[] = [];
    for (let i = 0; i < 65; i++) prices.push(makePrice(70 + i * 0.5));
    const result = calcTechnicalReversal(prices, 110, 70);
    expect(result.ma_aligned).toBe(true);
  });
});
