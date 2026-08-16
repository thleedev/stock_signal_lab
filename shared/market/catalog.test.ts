import { describe, it, expect } from 'vitest';
import { CATALOG, activeIndicators, type IndicatorSpec } from './catalog';

describe('지표 카탈로그', () => {
  it('키와 spec.key 가 일치한다', () => {
    for (const [key, spec] of Object.entries(CATALOG)) {
      expect(spec.key).toBe(key);
    }
  });

  it('임계값 단위가 저장 단위와 같다', () => {
    for (const spec of Object.values(CATALOG)) {
      expect(spec.thresholds.unit).toBe(spec.unit);
    }
  });

  it('direction 1 은 임계값이 오름차순, -1 은 내림차순이다', () => {
    for (const spec of Object.values(CATALOG)) {
      const [a, b, c] = spec.thresholds.levels;
      if (spec.direction === 1) {
        expect(a).toBeLessThan(b);
        expect(b).toBeLessThan(c);
      } else if (spec.direction === -1) {
        expect(a).toBeGreaterThan(b);
        expect(b).toBeGreaterThan(c);
      }
    }
  });

  it('가중치는 양수다', () => {
    for (const spec of Object.values(CATALOG)) {
      expect(spec.weight).toBeGreaterThan(0);
    }
  });

  it('활성 지표만 activeIndicators 에 담긴다', () => {
    const active = activeIndicators();
    expect(active.every((s) => s.enabled)).toBe(true);
    expect(active.length).toBeGreaterThan(0);
  });

  it('HY_SPREAD 임계값이 percent 단위다', () => {
    // FRED BAMLH0A0HYM2 는 2.71 같은 percent 값을 준다.
    // bps 기준 450 을 쓰면 어떤 신용위기에도 레벨 0 이 된다.
    const spec = CATALOG.HY_SPREAD as IndicatorSpec;
    expect(spec.unit).toBe('percent');
    expect(spec.thresholds.levels[0]).toBeLessThan(20);
  });

  it('YIELD_CURVE 임계값이 percent_point 단위다', () => {
    const spec = CATALOG.YIELD_CURVE as IndicatorSpec;
    expect(spec.unit).toBe('percent_point');
    expect(Math.abs(spec.thresholds.levels[0])).toBeLessThan(10);
  });

  it('죽은 소스는 카탈로그에서 비활성이다', () => {
    // VKOSPI: ^VKOSPI 404 delisted / CNN_FEAR_GREED: HTTP 418 차단
    expect(CATALOG.VKOSPI?.enabled ?? false).toBe(false);
    expect(CATALOG.CNN_FEAR_GREED).toBeUndefined();
    expect(CATALOG.FEAR_GREED).toBeUndefined();
  });
});
