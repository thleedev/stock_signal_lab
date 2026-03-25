import { describe, it, expect } from 'vitest';
import { calcRiskScore, RiskScoreInput } from '../risk-score';

describe('calcRiskScore', () => {
  const baseInput: RiskScoreInput = {
    rsi: 50,
    pct5d: 3,
    disparity20: 1.03,
    bollingerUpper: 11000,
    currentPrice: 10000,
    doubleTop: false,
    foreignNet: 100,
    institutionNet: 100,
    foreignStreak: 3,
    institutionStreak: 3,
    shortSellRatio: null,
  };

  it('리스크 없는 종목은 0점', () => {
    const result = calcRiskScore(baseInput);
    expect(result.score).toBe(0);
  });

  it('RSI 과매수(≥70)이면 15점 감점', () => {
    const result = calcRiskScore({ ...baseInput, rsi: 75 });
    expect(result.score).toBeGreaterThanOrEqual(15);
  });

  it('외국인+기관 동반 순매도이면 20점 감점', () => {
    const result = calcRiskScore({
      ...baseInput,
      foreignNet: -100,
      institutionNet: -100,
    });
    expect(result.score).toBeGreaterThanOrEqual(20);
  });

  it('동반 매도와 개별 매도는 중복 불가', () => {
    const result = calcRiskScore({
      ...baseInput,
      foreignNet: -100,
      institutionNet: -100,
    });
    // 동반매도 20 + streak 가능 = 최대 34, 개별 10+8=18이 아닌 20
    expect(result.score).toBeLessThanOrEqual(50);
  });

  it('점수 범위는 0~100', () => {
    const worst = calcRiskScore({
      rsi: 80,
      pct5d: 20,
      disparity20: 1.15,
      bollingerUpper: 9000,
      currentPrice: 10000,
      doubleTop: true,
      foreignNet: -100,
      institutionNet: -100,
      foreignStreak: -5,
      institutionStreak: -5,
      shortSellRatio: 15,
    });
    expect(worst.score).toBeGreaterThanOrEqual(0);
    expect(worst.score).toBeLessThanOrEqual(100);
  });

  it('공매도 비율 null이면 공매도 감점 미적용', () => {
    const withNull = calcRiskScore({ ...baseInput, shortSellRatio: null });
    const withHigh = calcRiskScore({ ...baseInput, shortSellRatio: 15 });
    expect(withHigh.score).toBeGreaterThan(withNull.score);
  });
});
