import { describe, it, expect } from 'vitest';
import { calcSignalBonus } from './signal-bonus';

describe('calcSignalBonus', () => {
  it('오늘 2개+ 소스 신호 → 60점', () => {
    const result = calcSignalBonus({
      todaySourceCount: 2,
      daysSinceLastSignal: 0,
      recentCount30d: 1,
      currentPrice: 10000,
      lastSignalPrice: 10000,
    });
    expect(result.normalizedScore).toBe(60);
  });

  it('오늘 1개 소스 신호 → 40점', () => {
    const result = calcSignalBonus({
      todaySourceCount: 1,
      daysSinceLastSignal: 0,
      recentCount30d: 1,
      currentPrice: 10000,
      lastSignalPrice: 10000,
    });
    expect(result.normalizedScore).toBe(40);
  });

  it('3~10일 경과 + 현재가 ≤ 신호가 → 50점', () => {
    const result = calcSignalBonus({
      todaySourceCount: 0,
      daysSinceLastSignal: 5,
      recentCount30d: 1,
      currentPrice: 9500,
      lastSignalPrice: 10000,
    });
    expect(result.normalizedScore).toBe(50);
  });

  it('3~10일 경과 + 현재가 > 신호가 → 30점', () => {
    const result = calcSignalBonus({
      todaySourceCount: 0,
      daysSinceLastSignal: 7,
      recentCount30d: 1,
      currentPrice: 10500,
      lastSignalPrice: 10000,
    });
    expect(result.normalizedScore).toBe(30);
  });

  it('11일+ 경과 + 30일 내 3회+ 반복 → 20점', () => {
    const result = calcSignalBonus({
      todaySourceCount: 0,
      daysSinceLastSignal: 15,
      recentCount30d: 4,
      currentPrice: 10000,
      lastSignalPrice: null,
    });
    expect(result.normalizedScore).toBe(20);
  });

  it('신호 없음 → 0점', () => {
    const result = calcSignalBonus({
      todaySourceCount: 0,
      daysSinceLastSignal: null,
      recentCount30d: 0,
      currentPrice: 10000,
      lastSignalPrice: null,
    });
    expect(result.normalizedScore).toBe(0);
  });
});
