import { describe, it, expect } from 'vitest';
import { calcTechnicalScore, DailyPrice } from '../technical-score';

function makePrices(count: number, opts?: {
  baseClose?: number;
  trend?: 'up' | 'down' | 'flat';
  volumeMultiplier?: number;
}): DailyPrice[] {
  const base = opts?.baseClose ?? 10000;
  const trend = opts?.trend ?? 'flat';
  const volMul = opts?.volumeMultiplier ?? 1;
  return Array.from({ length: count }, (_, i) => {
    const delta = trend === 'up' ? i * 50 : trend === 'down' ? -i * 50 : 0;
    const close = base + delta;
    return {
      date: `2026-01-${String(i + 1).padStart(2, '0')}`,
      open: close - 10,
      high: close + 20,
      low: close - 30,
      close,
      volume: 100000 * volMul,
    };
  });
}

describe('calcTechnicalScore (추세 점수)', () => {
  it('데이터 부족 시 0점, data_insufficient=true', () => {
    const result = calcTechnicalScore(makePrices(10), null, null);
    expect(result.data_insufficient).toBe(true);
    expect(result.score).toBe(0);
  });

  it('점수 범위가 0~58 내에 있어야 함', () => {
    const result = calcTechnicalScore(makePrices(65, { trend: 'up' }), null, null);
    expect(result.score).toBeGreaterThanOrEqual(0);
    expect(result.score).toBeLessThanOrEqual(58);
  });

  it('상승 추세(정배열) 종목이 높은 점수를 받아야 함', () => {
    const upTrend = calcTechnicalScore(makePrices(65, { trend: 'up' }), null, null);
    const flat = calcTechnicalScore(makePrices(65, { trend: 'flat' }), null, null);
    expect(upTrend.score).toBeGreaterThan(flat.score);
  });

  it('trend_days 필드가 반환되어야 함', () => {
    const result = calcTechnicalScore(makePrices(65, { trend: 'up' }), null, null);
    expect(result.trend_days).toBeGreaterThanOrEqual(0);
  });

  it('감점 항목이 없어야 함 (리스크 레이어로 이전)', () => {
    const result = calcTechnicalScore(makePrices(65, { trend: 'down' }), null, null);
    expect(result.score).toBeGreaterThanOrEqual(0);
  });
});
