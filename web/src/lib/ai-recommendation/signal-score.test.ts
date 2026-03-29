// web/src/lib/ai-recommendation/signal-score.test.ts
import { describe, it, expect } from 'vitest';
import { calcSignalScore } from './signal-score';

describe('calcSignalScore 근거 레이어', () => {
  it('3소스 신호 시 normalizedScore와 reasons를 반환한다', () => {
    const signals = [
      { source: 'quant', raw_data: { signal_price: 10000 } },
      { source: 'lassi', raw_data: { signal_price: 10000 } },
      { source: 'stockbot', raw_data: { signal_price: 10000 } },
    ];
    const result = calcSignalScore(signals, 5, 9500);

    expect(result.normalizedScore).toBeGreaterThanOrEqual(0);
    expect(result.normalizedScore).toBeLessThanOrEqual(100);
    expect(result.reasons.length).toBeGreaterThan(0);

    const multiSourceReason = result.reasons.find(r => r.label === '다중소스');
    expect(multiSourceReason).toBeDefined();
    expect(multiSourceReason!.met).toBe(true);
    expect(multiSourceReason!.points).toBeGreaterThan(0);
    expect(multiSourceReason!.detail).toContain('3개 소스');
  });

  it('신호 없을 때 normalizedScore 0, 모든 reasons.met = false', () => {
    const result = calcSignalScore([], 0, null);
    expect(result.normalizedScore).toBe(0);
    expect(result.reasons.every(r => !r.met)).toBe(true);
  });

  it('현재가 ≤ 신호가일 때 신호가 하회 근거가 충족된다', () => {
    const signals = [{ source: 'quant', raw_data: { signal_price: 10000 } }];
    const result = calcSignalScore(signals, 1, 9500);

    const belowReason = result.reasons.find(r => r.label === '신호가 하회');
    expect(belowReason).toBeDefined();
    expect(belowReason!.met).toBe(true);
    expect(belowReason!.detail).toContain('9,500');
    expect(belowReason!.detail).toContain('10,000');
  });

  it('하위 호환: 기존 score, signal_count 등 필드가 유지된다', () => {
    const signals = [{ source: 'quant', raw_data: { signal_price: 10000 } }];
    const result = calcSignalScore(signals, 1, 9500);

    expect(typeof result.score).toBe('number');
    expect(typeof result.signal_count).toBe('number');
    expect(typeof result.has_today_signal).toBe('boolean');
    expect(typeof result.has_frequent_signal).toBe('boolean');
    expect(typeof result.signal_below_price).toBe('boolean');
  });
});
