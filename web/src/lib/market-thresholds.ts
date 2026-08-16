/**
 * 투자 시황 절대 임계값 + 상대 분위수 기반 위험도 계산
 *
 * 레벨: 0=안전, 1=주의, 2=위험, 3=극위험
 * 레벨가중치: 0, 1, 3, 6 (비선형 - 극위험에 민감하게 반응)
 *
 * 임계값 테이블은 카탈로그(shared/market/catalog.ts)에서 파생합니다.
 * 이전에는 이 파일이 독립 선언을 들고 있어 배치 티커표·DB 가중치와
 * 어긋났습니다 — 예를 들어 HY_SPREAD 는 FRED 가 percent(2.71)를 주는데
 * 이 파일은 bps(450) 임계값을 들고 있어 실측치가 상시 레벨 0 으로
 * 고정되는 사고가 있었습니다.
 *
 * 파생 지표(drawdown_52w·ma200_diff)의 판정은 365일 원시 배열이 아니라
 * 배치(.github/scripts/batch/step13-indicator-stats.ts)가 선계산한
 * market_indicator_stats 롤링 통계를 씁니다. 원시 배열을 화면·크론이 매 요청
 * 다시 읽던 이전 구현은 PostgREST 기본 max_rows(1000)에 잘려, 여러 지표가
 * 그 상한을 나눠 갖는 바람에 각 지표가 실제로는 70~90 영업일 창만 받고도
 * 길이 가드(50개 이상)를 통과해 "52주 고점"이 조용히 3개월 고점이 되는
 * 사고로 이어졌습니다. 선계산 통계는 배치가 페이지네이션으로 전량을 읽어
 * 만들므로 이 문제가 없습니다.
 */

import { activeIndicators } from '@shared/market/catalog';

export type RiskLevel = 0 | 1 | 2 | 3;

export interface RiskThreshold {
  label: string;
  /** 높을수록 위험(1) vs 낮을수록 위험(-1) */
  direction: 1 | -1;
  /** [주의 하한, 위험 하한, 극위험 하한] */
  thresholds: [number, number, number];
  /** 위험 지수 계산 시 이 지표의 중요도 가중치 */
  weight: number;
  /**
   * 원값 대신 선계산 통계 기반 파생값(%)으로 평가.
   * - drawdown_52w: 52주 고점 대비 낙폭(%) — 음수일수록 깊은 조정
   * - ma200_diff:   200일 이동평균 대비 이격도(%) — 양수일수록 과열
   * 파생 평가가 설정된 지표는 해당 통계(high_52w/ma_200d)가 없으면
   * 위험도 계산에서 제외된다.
   */
  derive?: 'drawdown_52w' | 'ma200_diff';
}

/**
 * 임계값 테이블은 카탈로그에서 파생합니다. 카탈로그의 direction 은 항상
 * 1|-1 이고(양극단 판정 지표는 카탈로그에 없음), 활성 지표만 담습니다 —
 * 카탈로그에서 비활성(VKOSPI·KR_3Y) 처리하거나 삭제(CNN_FEAR_GREED·
 * FEAR_GREED)한 지표는 여기 자동으로 빠지므로 getRiskLevel 이 이들에
 * 대해 null 을 반환합니다.
 */
export const RISK_THRESHOLDS: Record<string, RiskThreshold> = Object.fromEntries(
  activeIndicators().map((s) => [
    s.key,
    {
      label: s.label,
      direction: s.direction,
      thresholds: s.thresholds.levels,
      weight: s.weight,
      derive: s.derive,
    },
  ]),
);

/** 레벨별 가중치 (비선형: 극위험에 민감) */
const LEVEL_WEIGHTS: Record<RiskLevel, number> = { 0: 0, 1: 1, 2: 3, 3: 6 };

/**
 * market_indicator_stats(배치 step13) 선계산 롤링 통계.
 * as_of 는 통계 신선도 판단용이며 판정 계산 자체에는 쓰이지 않는다.
 */
export interface IndicatorStats {
  high_52w: number | null;
  low_52w: number | null;
  ma_200d: number | null;
  pct_rank_252d: number | null;
  sample_days: number;
  as_of: string;
}

/**
 * derive 설정이 있으면 통계 기반 파생값(%)으로 변환.
 *
 * drawdown_52w = ((value - high_52w) / high_52w) * 100
 * ma200_diff   = ((value - ma_200d) / ma_200d) * 100
 *
 * 필요한 통계가 없거나(stats 자체가 없음 · 해당 필드가 null) 기준값이
 * 산술적으로 무의미하면(고점이 0 이하, 이평이 0) null 을 반환한다.
 */
export function deriveValue(
  type: string,
  value: number,
  stats: IndicatorStats | undefined,
): number | null {
  const t = RISK_THRESHOLDS[type];
  if (!t?.derive) return value;
  if (!stats) return null;

  if (t.derive === 'drawdown_52w') {
    const high = stats.high_52w;
    if (high == null || high <= 0) return null;
    return ((value - high) / high) * 100;
  }
  if (t.derive === 'ma200_diff') {
    const ma = stats.ma_200d;
    if (ma == null || ma === 0) return null;
    return ((value - ma) / ma) * 100;
  }
  return null;
}

/**
 * 단일 지표의 위험 레벨 계산
 * value가 null/undefined이면 null 반환 (계산에서 제외)
 * derive 설정이 있는 지표는 stats 가 필요하며, 필요한 필드가 없으면 null 반환.
 */
export function getRiskLevel(
  type: string,
  value: number | null | undefined,
  stats?: IndicatorStats,
): RiskLevel | null {
  if (value == null) return null;
  const t = RISK_THRESHOLDS[type];
  if (!t) return null;

  const evalValue = t.derive ? deriveValue(type, value, stats) : value;
  if (evalValue === null) return null;

  const [l1, l2, l3] = t.thresholds;

  if (t.direction === 1) {
    if (evalValue >= l3) return 3;
    if (evalValue >= l2) return 2;
    if (evalValue >= l1) return 1;
    return 0;
  } else {
    if (evalValue < l3) return 3;
    if (evalValue < l2) return 2;
    if (evalValue < l1) return 1;
    return 0;
  }
}

/**
 * 임계값 설명 문자열 반환 (UI 표시용)
 * 예: "1,450원 초과" / "2,600 이상"
 */
export function getRiskThresholdLabel(type: string, level: RiskLevel): string {
  const t = RISK_THRESHOLDS[type];
  if (!t) return '';
  const [l1, l2, l3] = t.thresholds;

  if (t.derive === 'drawdown_52w') {
    // direction=-1, thresholds 음수 (예: -7, -15, -25)
    if (level === 3) return `52주 고점 대비 ${l3}% 이하`;
    if (level === 2) return `52주 고점 대비 ${l3}~${l2}%`;
    if (level === 1) return `52주 고점 대비 ${l2}~${l1}%`;
    return `52주 고점 대비 ${l1}% 이상`;
  }
  if (t.derive === 'ma200_diff') {
    // direction=1, thresholds 양수 (예: 10, 20, 30)
    if (level === 3) return `200일선 +${l3}% 이상`;
    if (level === 2) return `200일선 +${l2}~+${l3}%`;
    if (level === 1) return `200일선 +${l1}~+${l2}%`;
    return `200일선 +${l1}% 미만`;
  }

  if (t.direction === 1) {
    if (level === 3) return `${l3.toLocaleString()} 이상`;
    if (level === 2) return `${l2.toLocaleString()}~${l3.toLocaleString()}`;
    if (level === 1) return `${l1.toLocaleString()}~${l2.toLocaleString()}`;
    return `${l1.toLocaleString()} 미만`;
  } else {
    if (level === 3) return `${l3.toLocaleString()} 미만`;
    if (level === 2) return `${l2.toLocaleString()}~${l3.toLocaleString()}`;
    if (level === 1) return `${l1.toLocaleString()}~${l2.toLocaleString()}`;
    return `${l1.toLocaleString()} 이상`;
  }
}

export interface RiskIndexResult {
  /** 0~100, 높을수록 위험 */
  riskIndex: number;
  /** 위험 레벨 breakdown */
  breakdown: Record<string, { level: RiskLevel; value: number; absoluteLevel: RiskLevel; relativeLevel: RiskLevel | null }>;
  /** 데이터 있는 지표 수 */
  validCount: number;
  /** 위험(2) 이상 지표 수 */
  dangerCount: number;
  /** 판정에 반영된 가중치 합 / 활성 지표 가중치 합 (0~1) */
  coverage: number;
  /** 값이 없거나 파생 계산에 필요한 통계가 없어 판정에서 빠진 활성 지표 키 */
  missing: string[];
}

/**
 * 배치가 선계산한 252일 백분위(pct_rank_252d) 기반 상대 위험 레벨.
 *
 * direction=1: 상위 percentile일수록 위험 (≥75=주의, ≥90=위험, ≥97=극위험)
 * direction=-1: 하위 percentile일수록 위험 (≤25=주의, ≤10=위험, ≤3=극위험)
 *
 * pct_rank_252d 는 0~1 범위이고, current 자신이 모집단에 포함되어 정확히
 * 0 이 될 수 없다(shared/market/stats.ts pctRank 의 정의 — count 최솟값이
 * 1 이므로 결과 최솟값은 1/values.length). 기존 임계값은 0~100 백분위
 * 기준이므로 100 을 곱해 단위를 맞춘다.
 *
 * derive 지표(drawdown_52w·ma200_diff)는 파생값 자체가 이미 기준(52주
 * 고점·200일선) 대비 상대치이므로 percentile 보강을 적용하지 않는다 —
 * 원시값의 백분위와 파생값의 임계값을 이중으로 겹쳐 매기지 않기 위함이다.
 */
export function getRelativeRiskLevel(
  type: string,
  value: number | null | undefined,
  stats?: IndicatorStats,
): RiskLevel | null {
  if (value == null) return null;
  const t = RISK_THRESHOLDS[type];
  if (!t) return null;
  if (t.derive) return null;
  if (!stats || stats.pct_rank_252d == null) return null;

  const percentile = stats.pct_rank_252d * 100;

  if (t.direction === 1) {
    if (percentile >= 97) return 3;
    if (percentile >= 90) return 2;
    if (percentile >= 75) return 1;
    return 0;
  } else {
    if (percentile <= 3) return 3;
    if (percentile <= 10) return 2;
    if (percentile <= 25) return 1;
    return 0;
  }
}

/**
 * 전체 위험 지수 계산 (0~100, 높을수록 위험)
 *
 * statsByKey 를 함께 전달하면 절대 임계값과 상대 분위수의 더 위험한 쪽을
 * 채택하는 하이브리드 모드로 동작하고, drawdown_52w·ma200_diff 파생 지표
 * (KOSPI·KOSDAQ·EWY·GOLD) 판정도 가능해진다. 생략하면 파생 지표는 통계가
 * 없어 전량 missing 으로 빠진다 — "판정 불가"를 명시적으로 드러내기
 * 위함이며, 값이 있는데도 조용히 안전(레벨 0)으로 집계하지 않는다.
 *
 * coverage 는 값·통계가 있어 실제로 판정에 반영된 지표의 가중치 합을
 * 활성 지표 전체 가중치 합으로 나눈 비율이다(0~1). validCount/dangerCount
 * 같은 "개수" 지표와 달리 지표별 중요도(weight)를 반영하므로, 무거운
 * 지표 여러 개가 한꺼번에 빠지는 상황을 가벼운 지표 몇 개가 빠지는
 * 상황보다 더 낮은 coverage 로 정확히 드러낸다.
 */
export function calculateRiskIndex(
  values: Record<string, number | null | undefined>,
  statsByKey?: Record<string, IndicatorStats | undefined>,
): RiskIndexResult {
  let weightedSum = 0;
  let maxPossible = 0;
  let validCount = 0;
  let dangerCount = 0;
  let coveredWeight = 0;
  let totalWeight = 0;
  const missing: string[] = [];
  const breakdown: RiskIndexResult['breakdown'] = {};

  for (const [type, threshold] of Object.entries(RISK_THRESHOLDS)) {
    totalWeight += threshold.weight;

    const value = values[type];
    const stats = statsByKey?.[type];
    const absoluteLevel = getRiskLevel(type, value, stats);
    if (absoluteLevel === null || value == null) {
      missing.push(type);
      continue;
    }

    const relativeLevel = getRelativeRiskLevel(type, value, stats);
    const level = (relativeLevel != null
      ? (Math.max(absoluteLevel, relativeLevel) as RiskLevel)
      : absoluteLevel);

    validCount++;
    coveredWeight += threshold.weight;
    weightedSum += LEVEL_WEIGHTS[level] * threshold.weight;
    maxPossible += LEVEL_WEIGHTS[3] * threshold.weight; // 6 × weight
    breakdown[type] = { level, value, absoluteLevel, relativeLevel };
    if (level >= 2) dangerCount++;
  }

  const riskIndex = maxPossible > 0
    ? Math.round((weightedSum / maxPossible) * 10000) / 100
    : 0;

  return {
    riskIndex,
    breakdown,
    validCount,
    dangerCount,
    coverage: totalWeight > 0 ? coveredWeight / totalWeight : 0,
    missing,
  };
}

export interface RiskInterpretation {
  label: string;
  color: string;
  action: string;
}

export const RISK_INTERPRETATIONS: RiskInterpretation[] = [
  { label: '안전',   color: '#10b981', action: '적극 매수 가능' },
  { label: '주의',   color: '#eab308', action: '분할 매수, 비중 조절' },
  { label: '위험',   color: '#f97316', action: '신규 진입 자제, 방어적 투자' },
  { label: '극위험', color: '#ef4444', action: '현금 비중 확대, 손절 검토' },
];

export function getRiskInterpretation(riskIndex: number): RiskInterpretation {
  if (riskIndex >= 75) return RISK_INTERPRETATIONS[3];
  if (riskIndex >= 50) return RISK_INTERPRETATIONS[2];
  if (riskIndex >= 25) return RISK_INTERPRETATIONS[1];
  return RISK_INTERPRETATIONS[0];
}
