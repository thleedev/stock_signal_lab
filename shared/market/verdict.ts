/**
 * 위험 판정 엔진 — RiskVerdict 계약 (설계 §4.3, 단계 2).
 *
 * web/src/lib/market-thresholds.ts 의 calculateRiskIndex 와 같은 판정
 * 규칙(절대 임계값 + 252일 분위수 하이브리드, 레벨가중치 0/1/3/6)을
 * 따르되, 숫자 하나가 아니라 판정 객체를 반환합니다. 커버리지 미달이면
 * status: 'insufficient' 를 반환해 "판정 불가"와 "안전"이 구분됩니다.
 *
 * 백테스트 격자 탐색이 가중치·임계값을 바꿔 가며 호출할 수 있도록
 * 판정 파라미터를 인자로 받습니다. 생략하면 카탈로그 값을 씁니다.
 *
 * 단계 3에서 web 의 calculateRiskIndex 를 이 함수로 교체할 때까지 판정
 * 규칙 변경은 두 파일에 함께 반영해야 합니다.
 */

import { activeIndicators } from './catalog.js';

export type RiskLevel = 0 | 1 | 2 | 3;

const LEVEL_WEIGHTS: Record<RiskLevel, number> = { 0: 0, 1: 1, 2: 3, 3: 6 };

export interface VerdictStats {
  high_52w: number | null;
  ma_200d: number | null;
  pct_rank_252d: number | null;
  sample_days: number;
}

export interface IndicatorParam {
  direction: 1 | -1;
  levels: [number, number, number];
  weight: number;
  derive?: 'drawdown_52w' | 'ma200_diff';
}

export interface VerdictParams {
  indicators: Record<string, IndicatorParam>;
  /** 이 미만이면 insufficient (web COVERAGE_THRESHOLD 와 동일 기본값) */
  coverageThreshold: number;
  /** score 가 reduce 이상이면 축소, hold 이상이면 관망, 그 밖은 진입 */
  actionCutoffs: { reduce: number; hold: number };
}

export function defaultParams(): VerdictParams {
  return {
    indicators: Object.fromEntries(
      activeIndicators().map((s) => [
        s.key,
        {
          direction: s.direction,
          levels: s.thresholds.levels,
          weight: s.weight,
          derive: s.derive,
        },
      ]),
    ),
    coverageThreshold: 0.7,
    actionCutoffs: { reduce: 50, hold: 25 },
  };
}

export interface Contribution {
  key: string;
  level: RiskLevel;
  /** 저장 원값 */
  value: number;
  /** 판정에 쓴 값 — derive 지표는 파생값(%), 나머지는 원값 */
  evalValue: number;
  /** 넘어선(또는 하회한) 가장 높은 임계값. 레벨 0 이면 첫 임계값 */
  threshold: number;
  /** 위험 지수 기여 점수. 전체 합이 score 와 일치한다 */
  points: number;
}

export type RiskVerdict =
  | {
      status: 'ok';
      score: number;
      action: 'enter' | 'hold' | 'reduce';
      coverage: number;
      contributions: Contribution[];
      missing: string[];
      asOf: string;
    }
  | { status: 'insufficient'; coverage: number; missing: string[]; asOf: string };

const MIN_DERIVE_SAMPLE_DAYS = 50;

function deriveEvalValue(
  p: IndicatorParam,
  value: number,
  stats: VerdictStats | undefined,
): number | null {
  if (!p.derive) return value;
  if (!stats || stats.sample_days < MIN_DERIVE_SAMPLE_DAYS) return null;
  if (p.derive === 'drawdown_52w') {
    const high = stats.high_52w;
    if (high == null || high <= 0) return null;
    return ((value - high) / high) * 100;
  }
  const ma = stats.ma_200d;
  if (ma == null || ma === 0) return null;
  return ((value - ma) / ma) * 100;
}

function absoluteLevel(p: IndicatorParam, evalValue: number): RiskLevel {
  const [l1, l2, l3] = p.levels;
  if (p.direction === 1) {
    if (evalValue >= l3) return 3;
    if (evalValue >= l2) return 2;
    if (evalValue >= l1) return 1;
    return 0;
  }
  if (evalValue < l3) return 3;
  if (evalValue < l2) return 2;
  if (evalValue < l1) return 1;
  return 0;
}

/** 252일 분위수 기반 상대 레벨. derive 지표에는 적용하지 않는다 (web 과 동일 규칙). */
function relativeLevel(p: IndicatorParam, stats: VerdictStats | undefined): RiskLevel | null {
  if (p.derive) return null;
  if (!stats || stats.pct_rank_252d == null) return null;
  const percentile = stats.pct_rank_252d * 100;
  if (p.direction === 1) {
    if (percentile >= 97) return 3;
    if (percentile >= 90) return 2;
    if (percentile >= 75) return 1;
    return 0;
  }
  if (percentile <= 3) return 3;
  if (percentile <= 10) return 2;
  if (percentile <= 25) return 1;
  return 0;
}

export function calculateVerdict(
  values: Record<string, number | null | undefined>,
  statsByKey: Record<string, VerdictStats | undefined>,
  asOf: string,
  params: VerdictParams = defaultParams(),
): RiskVerdict {
  let weightedSum = 0;
  let maxPossible = 0;
  let coveredWeight = 0;
  let totalWeight = 0;
  const missing: string[] = [];
  const raw: Omit<Contribution, 'points'>[] = [];

  for (const [key, p] of Object.entries(params.indicators)) {
    totalWeight += p.weight;
    const value = values[key];
    if (value == null || !Number.isFinite(value)) {
      missing.push(key);
      continue;
    }
    const evalValue = deriveEvalValue(p, value, statsByKey[key]);
    if (evalValue == null || !Number.isFinite(evalValue)) {
      missing.push(key);
      continue;
    }

    const abs = absoluteLevel(p, evalValue);
    const rel = relativeLevel(p, statsByKey[key]);
    const level = (rel != null ? Math.max(abs, rel) : abs) as RiskLevel;

    coveredWeight += p.weight;
    weightedSum += LEVEL_WEIGHTS[level] * p.weight;
    maxPossible += LEVEL_WEIGHTS[3] * p.weight;
    const [l1, l2, l3] = p.levels;
    const threshold = level === 3 ? l3 : level === 2 ? l2 : l1;
    raw.push({ key, level, value, evalValue, threshold });
  }

  const coverage = totalWeight > 0 ? coveredWeight / totalWeight : 0;
  if (coverage < params.coverageThreshold) {
    return { status: 'insufficient', coverage, missing, asOf };
  }

  const score =
    maxPossible > 0 ? Math.round((weightedSum / maxPossible) * 10000) / 100 : 0;
  const contributions: Contribution[] = raw
    .map((c) => ({
      ...c,
      points:
        maxPossible > 0
          ? Math.round(
              ((LEVEL_WEIGHTS[c.level] * params.indicators[c.key].weight) / maxPossible) *
                10000,
            ) / 100
          : 0,
    }))
    .sort((a, b) => b.points - a.points);

  const action =
    score >= params.actionCutoffs.reduce
      ? 'reduce'
      : score >= params.actionCutoffs.hold
        ? 'hold'
        : 'enter';

  return { status: 'ok', score, action, coverage, contributions, missing, asOf };
}
