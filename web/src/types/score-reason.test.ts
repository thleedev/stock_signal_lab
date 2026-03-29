// web/src/types/score-reason.test.ts
import { describe, it, expect } from 'vitest';
import type { ScoreReason, NormalizedScoreBase } from './score-reason';

describe('ScoreReason 타입', () => {
  it('ScoreReason 객체를 올바르게 생성할 수 있다', () => {
    const reason: ScoreReason = {
      label: '골든크로스',
      points: 7.7,
      detail: '5일선 12,340 > 20일선 12,100',
      met: true,
    };
    expect(reason.label).toBe('골든크로스');
    expect(reason.met).toBe(true);
  });

  it('NormalizedScoreBase 객체를 올바르게 생성할 수 있다', () => {
    const base: NormalizedScoreBase = {
      rawScore: 42,
      normalizedScore: 64.6,
      reasons: [
        { label: '테스트', points: 10, detail: '설명', met: true },
      ],
    };
    expect(base.normalizedScore).toBeGreaterThanOrEqual(0);
    expect(base.normalizedScore).toBeLessThanOrEqual(100);
    expect(base.reasons).toHaveLength(1);
  });
});
