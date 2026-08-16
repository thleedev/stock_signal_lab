import { describe, it, expect } from 'vitest';
import {
  calculateRiskIndex,
  getRiskLevel,
  getRelativeRiskLevel,
  deriveValue,
  RISK_THRESHOLDS,
  type IndicatorStats,
} from '@/lib/market-thresholds';

/** 테스트에서 필요한 필드만 덮어써 IndicatorStats 를 만든다. */
function stats(partial: Partial<IndicatorStats>): IndicatorStats {
  return {
    high_52w: null,
    low_52w: null,
    ma_200d: null,
    pct_rank_252d: null,
    sample_days: 252,
    as_of: '2026-08-17',
    ...partial,
  };
}

describe('위험 지수 커버리지', () => {
  it('지표가 하나도 없으면 커버리지 0 을 낸다', () => {
    const r = calculateRiskIndex({});
    expect(r.coverage).toBe(0);
    expect(r.validCount).toBe(0);
    // market-client.tsx RiskAlertBanner 는 coverage < 0.7 이면 점수 대신
    // 산출 불가를 표시한다 — 지표 0개는 항상 이 조건을 만족해야 한다.
    expect(r.coverage).toBeLessThan(0.7);
  });

  it('결손 지표가 missing 에 담긴다', () => {
    const r = calculateRiskIndex({ VIX: 15 });
    expect(r.missing).toContain('USD_KRW');
    expect(r.missing).not.toContain('VIX');
  });

  it('커버리지는 가중치 합 기준이다', () => {
    // VIX weight 만 있을 때 coverage 는 (VIX.weight / 활성 지표 가중치 합) 이어야
    // 하며, 이는 "지표 개수 기준"(1/활성지표수)과는 다른 값이다 — 두 방식이
    // 우연히 같아지지 않도록 gt/lt 대신 정확한 비율로 고정한다.
    const totalWeight = Object.values(RISK_THRESHOLDS).reduce((s, t) => s + t.weight, 0);
    const activeCount = Object.keys(RISK_THRESHOLDS).length;
    const r = calculateRiskIndex({ VIX: 15 });
    expect(r.coverage).toBeCloseTo(RISK_THRESHOLDS.VIX.weight / totalWeight, 10);
    expect(r.coverage).not.toBeCloseTo(1 / activeCount, 10);
  });

  it('비활성 지표는 커버리지 분모에 들어가지 않는다', () => {
    // VKOSPI 와 KR_3Y 는 소스 사망으로 카탈로그에서 비활성이므로
    // RISK_THRESHOLDS 자체에 없고, missing 에도 담기지 않는다.
    const r = calculateRiskIndex({ VIX: 15 });
    expect(r.missing).not.toContain('VKOSPI');
    expect(r.missing).not.toContain('KR_3Y');
    expect(RISK_THRESHOLDS.VKOSPI).toBeUndefined();
    expect(RISK_THRESHOLDS.KR_3Y).toBeUndefined();
  });
});

describe('단위 정합', () => {
  it('HY_SPREAD 는 percent 값으로 판정한다', () => {
    // FRED 실측 2.71 은 안전, 6.0 은 위험, 7.5 는 극위험이어야 한다.
    // bps 임계값(450 등)이 남아 있으면 6.0 도 레벨 0 이 된다.
    expect(getRiskLevel('HY_SPREAD', 2.71)).toBe(0);
    expect(getRiskLevel('HY_SPREAD', 6.0)).toBe(2);
    expect(getRiskLevel('HY_SPREAD', 7.5)).toBe(3);
  });

  it('YIELD_CURVE 는 percent point 값으로 판정한다', () => {
    // 정상 커브 +0.51 은 안전, 역전 -0.6 은 극위험
    expect(getRiskLevel('YIELD_CURVE', 0.51)).toBe(0);
    expect(getRiskLevel('YIELD_CURVE', -0.6)).toBe(3);
  });

  it('비활성·제거된 지표는 판정 대상이 아니다', () => {
    expect(getRiskLevel('CNN_FEAR_GREED', 20)).toBeNull();
    expect(getRiskLevel('FEAR_GREED', 20)).toBeNull();
    expect(getRiskLevel('KR_3Y', 3.5)).toBeNull();
    expect(getRiskLevel('VKOSPI', 25)).toBeNull();
  });
});

describe('통계 기반 파생 판정', () => {
  it('drawdown_52w = ((value - high_52w) / high_52w) * 100', () => {
    // high_52w=200, 현재값=150 → (150-200)/200*100 = -25%
    expect(deriveValue('KOSPI', 150, stats({ high_52w: 200 }))).toBe(-25);
  });

  it('ma200_diff = ((value - ma_200d) / ma_200d) * 100', () => {
    // ma_200d=100, 현재값=110 → (110-100)/100*100 = 10%
    expect(deriveValue('GOLD', 110, stats({ ma_200d: 100 }))).toBe(10);
  });

  it('통계가 없으면(undefined) 파생 판정이 불가하다', () => {
    expect(deriveValue('KOSPI', 150, undefined)).toBeNull();
    expect(getRiskLevel('KOSPI', 150, undefined)).toBeNull();
  });

  it('필요한 통계 필드가 null 이면 파생 판정이 불가하다', () => {
    expect(deriveValue('KOSPI', 150, stats({ high_52w: null }))).toBeNull();
    expect(deriveValue('GOLD', 110, stats({ ma_200d: null }))).toBeNull();
  });

  it('파생 지표가 통계와 함께 주어지면 판정된다', () => {
    // (2500-3000)/3000*100 ≈ -16.67% → KOSPI thresholds [-7,-15,-25], direction -1 → level 2
    expect(getRiskLevel('KOSPI', 2500, stats({ high_52w: 3000 }))).toBe(2);
  });

  it('통계가 없으면 파생 지표(KOSPI·KOSDAQ·EWY·GOLD)가 missing 에 담긴다', () => {
    const r = calculateRiskIndex({ KOSPI: 2500, KOSDAQ: 700, EWY: 60, GOLD: 2000 });
    expect(r.missing).toEqual(expect.arrayContaining(['KOSPI', 'KOSDAQ', 'EWY', 'GOLD']));
  });

  it('통계가 있으면 파생 지표가 missing 에서 빠지고 breakdown 에 담긴다', () => {
    const r = calculateRiskIndex(
      { KOSPI: 2500, KOSDAQ: 700, EWY: 60, GOLD: 2000 },
      {
        KOSPI: stats({ high_52w: 3000 }),
        KOSDAQ: stats({ high_52w: 900 }),
        EWY: stats({ high_52w: 70 }),
        GOLD: stats({ ma_200d: 1800 }),
      },
    );
    expect(r.missing).not.toEqual(expect.arrayContaining(['KOSPI', 'KOSDAQ', 'EWY', 'GOLD']));
    expect(r.breakdown.KOSPI).toBeDefined();
    expect(r.breakdown.KOSDAQ).toBeDefined();
    expect(r.breakdown.EWY).toBeDefined();
    expect(r.breakdown.GOLD).toBeDefined();
  });
});

describe('상대 분위수(pct_rank_252d)', () => {
  it('0~1 범위를 100 을 곱해 백분위 임계값과 맞춘다', () => {
    // direction 1(VIX): percentile 97 이상이면 극위험
    expect(getRelativeRiskLevel('VIX', 15, stats({ pct_rank_252d: 0.98 }))).toBe(3);
    expect(getRelativeRiskLevel('VIX', 15, stats({ pct_rank_252d: 0.5 }))).toBe(0);
  });

  it('direction -1 지표는 하위 percentile 일수록 위험하다', () => {
    // YIELD_CURVE 는 direction -1 이면서 derive 가 없어 percentile 보강이
    // 그대로 적용된다(역전 커브일수록, 즉 하위 percentile 일수록 위험).
    expect(getRelativeRiskLevel('YIELD_CURVE', -0.6, stats({ pct_rank_252d: 0.02 }))).toBe(3);
    expect(getRelativeRiskLevel('YIELD_CURVE', 0.51, stats({ pct_rank_252d: 0.5 }))).toBe(0);
  });

  it('통계가 없으면 상대 판정을 하지 않는다', () => {
    expect(getRelativeRiskLevel('VIX', 15, undefined)).toBeNull();
    expect(getRelativeRiskLevel('VIX', 15, stats({ pct_rank_252d: null }))).toBeNull();
  });

  it('derive 지표는 percentile 보강을 적용하지 않는다', () => {
    // 파생값(52주 고점·200일선 대비) 자체가 이미 상대치이므로 이중 적용하지 않는다.
    expect(getRelativeRiskLevel('KOSPI', 2500, stats({ high_52w: 3000, pct_rank_252d: 0.99 }))).toBeNull();
  });
});
