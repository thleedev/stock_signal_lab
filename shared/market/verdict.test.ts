import { describe, it, expect } from 'vitest';
import { calculateVerdict, defaultParams } from './verdict';
import type { VerdictStats } from './verdict';

const AS_OF = '2026-08-20';

function fullStats(over: Partial<VerdictStats> = {}): VerdictStats {
  return { high_52w: null, ma_200d: null, pct_rank_252d: null, sample_days: 252, ...over };
}

describe('calculateVerdict', () => {
  it('지표가 하나도 없으면 insufficient 를 반환한다', () => {
    const v = calculateVerdict({}, {}, AS_OF);
    expect(v.status).toBe('insufficient');
    expect(v.coverage).toBe(0);
    expect(v.missing.length).toBeGreaterThan(0);
  });

  it('커버리지 미달이면 insufficient, 결측 지표가 missing 에 담긴다', () => {
    const v = calculateVerdict({ VIX: 15 }, {}, AS_OF);
    expect(v.status).toBe('insufficient');
    expect(v.missing).toContain('KR_3Y');
    expect(v.missing).not.toContain('VIX');
  });

  it('기여 점수 합이 score 와 일치한다', () => {
    // 파생 지표까지 포함해 모든 활성 지표에 값과 통계를 준다
    const values: Record<string, number> = {
      VIX: 28, HY_SPREAD: 6.0, YIELD_CURVE: -0.6, US_10Y: 4.6, DXY: 105,
      WTI: 95, GOLD: 2500, EWY: 60, KOSPI: 2400, KOSDAQ: 700,
      KR_VOL_20D: 30, USD_KRW: 1450, FOREIGN_NET: -13000, INSTITUTION_NET: -10000,
      KR_3Y: 4.0,
    };
    const stats: Record<string, VerdictStats> = {
      GOLD: fullStats({ ma_200d: 2000 }),
      EWY: fullStats({ high_52w: 80 }),
      KOSPI: fullStats({ high_52w: 3000 }),
      KOSDAQ: fullStats({ high_52w: 900 }),
    };
    const v = calculateVerdict(values, stats, AS_OF);
    expect(v.status).toBe('ok');
    if (v.status !== 'ok') return;
    const sum = v.contributions.reduce((s, c) => s + c.points, 0);
    expect(sum).toBeCloseTo(v.score, 0.5);
    expect(v.missing).toEqual([]);
    expect(v.coverage).toBe(1);
  });

  it('score 가 actionCutoffs 를 넘으면 action 이 바뀐다', () => {
    const params = defaultParams();
    // VIX 만으로는 커버리지 미달이므로 임계값을 0 으로 낮춰 판정만 검증
    params.coverageThreshold = 0;
    const calm = calculateVerdict({ VIX: 12 }, {}, AS_OF, params);
    expect(calm.status === 'ok' && calm.action).toBe('enter');

    params.actionCutoffs = { reduce: 10, hold: 5 };
    const hot = calculateVerdict({ VIX: 35 }, {}, AS_OF, params);
    expect(hot.status === 'ok' && hot.action).toBe('reduce');
  });

  it('파생 지표는 통계가 없으면 missing 으로 빠진다', () => {
    const params = defaultParams();
    params.coverageThreshold = 0;
    const v = calculateVerdict({ KOSPI: 2400 }, {}, AS_OF, params);
    expect(v.missing).toContain('KOSPI');
  });

  it('분위수 상대 레벨이 절대 레벨보다 높으면 채택된다', () => {
    const params = defaultParams();
    params.coverageThreshold = 0;
    // VIX 15 는 절대 레벨 0 이지만 252일 분위수 98% 면 상대 레벨 3
    const v = calculateVerdict(
      { VIX: 15 },
      { VIX: fullStats({ pct_rank_252d: 0.98 }) },
      AS_OF,
      params,
    );
    expect(v.status === 'ok' && v.contributions[0].level).toBe(3);
  });
});
