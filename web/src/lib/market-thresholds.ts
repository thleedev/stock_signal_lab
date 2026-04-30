/**
 * 투자 시황 절대 임계값 기반 위험도 계산
 *
 * 레벨: 0=안전, 1=주의, 2=위험, 3=극위험
 * 레벨가중치: 0, 1, 3, 6 (비선형 - 극위험에 민감하게 반응)
 */

export type RiskLevel = 0 | 1 | 2 | 3;

export interface RiskThreshold {
  label: string;
  /** 높을수록 위험(1) vs 낮을수록 위험(-1) vs 양극단 위험(0, center 기준) */
  direction: 1 | -1 | 0;
  /** [주의 하한, 위험 하한, 극위험 하한] — direction=0이면 center 기준 거리 */
  thresholds: [number, number, number];
  /** direction=0일 때 기준 중앙값 (기본 50) */
  center?: number;
  /** 위험 지수 계산 시 이 지표의 중요도 가중치 */
  weight: number;
}

export const RISK_THRESHOLDS: Record<string, RiskThreshold> = {
  VIX: {
    label: 'VIX (미국 공포지수)',
    direction: 1,
    thresholds: [20, 25, 30],
    weight: 3,
  },
  VKOSPI: {
    label: 'VKOSPI (한국 공포지수)',
    direction: 1,
    thresholds: [22, 28, 35],
    weight: 3,
  },
  USD_KRW: {
    label: '원/달러 환율',
    direction: 1,
    thresholds: [1380, 1430, 1480],
    weight: 3,
  },
  DXY: {
    label: '달러 인덱스',
    direction: 1,
    thresholds: [100, 104, 108],
    weight: 2,
  },
  US_10Y: {
    label: '미국 10년물 금리',
    direction: 1,
    thresholds: [4.0, 4.5, 5.0],
    weight: 2,
  },
  WTI: {
    label: 'WTI 원유',
    direction: 1,
    thresholds: [75, 90, 100],
    weight: 2,
  },
  KOSPI: {
    label: 'KOSPI',
    direction: -1,
    thresholds: [2600, 2400, 2200],
    weight: 2,
  },
  KOSDAQ: {
    label: 'KOSDAQ',
    direction: -1,
    thresholds: [800, 700, 600],
    weight: 1,
  },
  CNN_FEAR_GREED: {
    label: 'CNN 공포탐욕지수',
    direction: 0,
    thresholds: [10, 25, 30],
    center: 50,
    weight: 2,
  },
  EWY: {
    label: 'EWY (한국 ETF)',
    direction: -1,
    thresholds: [60, 52, 44],
    weight: 1,
  },
  GOLD: {
    label: '금 현물가',
    direction: 1,
    thresholds: [2800, 3100, 3400],
    weight: 1,
  },
  HY_SPREAD: {
    label: 'HY 스프레드 (하이일드)',
    direction: 1,
    thresholds: [450, 550, 700],
    weight: 3,
  },
  YIELD_CURVE: {
    label: '장단기 금리차 (10Y-2Y)',
    direction: -1,
    thresholds: [50, 0, -50],
    weight: 2,
  },
};

/** 레벨별 가중치 (비선형: 극위험에 민감) */
const LEVEL_WEIGHTS: Record<RiskLevel, number> = { 0: 0, 1: 1, 2: 3, 3: 6 };

/**
 * 단일 지표의 위험 레벨 계산
 * value가 null/undefined이면 null 반환 (계산에서 제외)
 */
export function getRiskLevel(type: string, value: number | null | undefined): RiskLevel | null {
  if (value == null) return null;
  const t = RISK_THRESHOLDS[type];
  if (!t) return null;

  const [l1, l2, l3] = t.thresholds;

  if (t.direction === 0) {
    // 양극단 위험: center 기준 거리로 판단 (극공포 & 극탐욕 모두 위험)
    const dist = Math.abs(value - (t.center ?? 50));
    if (dist >= l3) return 3;
    if (dist >= l2) return 2;
    if (dist >= l1) return 1;
    return 0;
  } else if (t.direction === 1) {
    if (value >= l3) return 3;
    if (value >= l2) return 2;
    if (value >= l1) return 1;
    return 0;
  } else {
    if (value < l3) return 3;
    if (value < l2) return 2;
    if (value < l1) return 1;
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

  const c = t.center ?? 50;
  if (t.direction === 0) {
    if (level === 3) return `${c - l3} 미만 또는 ${c + l3} 초과`;
    if (level === 2) return `${c - l2}~${c - l3} 또는 ${c + l2}~${c + l3}`;
    if (level === 1) return `${c - l1}~${c - l2} 또는 ${c + l1}~${c + l2}`;
    return `${c - l1}~${c + l1} (중립)`;
  } else if (t.direction === 1) {
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
}

/**
 * 252일 롤링 분포 기반 상대 위험 레벨
 * direction=1: 상위 percentile일수록 위험 (≥75=주의, ≥90=위험, ≥97=극위험)
 * direction=-1: 하위 percentile일수록 위험 (≤25=주의, ≤10=위험, ≤3=극위험)
 * direction=0: 중앙값 거리 기준 (절대 함수와 동일하게 center 거리 percentile)
 *
 * history: 해당 지표의 과거 값 배열 (정렬 무관, 최소 30개 이상 필요)
 */
export function getRelativeRiskLevel(
  type: string,
  value: number | null | undefined,
  history: number[] | undefined
): RiskLevel | null {
  if (value == null) return null;
  if (!history || history.length < 30) return null;
  const t = RISK_THRESHOLDS[type];
  if (!t) return null;

  // value 기준 percentile (0~100) 계산
  const sorted = [...history].sort((a, b) => a - b);
  const n = sorted.length;
  let count = 0;
  for (const v of sorted) {
    if (v <= value) count++;
    else break;
  }
  const percentile = (count / n) * 100;

  if (t.direction === 1) {
    if (percentile >= 97) return 3;
    if (percentile >= 90) return 2;
    if (percentile >= 75) return 1;
    return 0;
  } else if (t.direction === -1) {
    if (percentile <= 3) return 3;
    if (percentile <= 10) return 2;
    if (percentile <= 25) return 1;
    return 0;
  } else {
    // 양극단: |value - center| 의 분포에서 현재 거리의 percentile
    const center = t.center ?? 50;
    const dists = sorted.map((v) => Math.abs(v - center)).sort((a, b) => a - b);
    const dCurrent = Math.abs(value - center);
    let dCount = 0;
    for (const d of dists) {
      if (d <= dCurrent) dCount++;
      else break;
    }
    const dp = (dCount / dists.length) * 100;
    if (dp >= 97) return 3;
    if (dp >= 90) return 2;
    if (dp >= 75) return 1;
    return 0;
  }
}

/**
 * 전체 위험 지수 계산 (0~100, 높을수록 위험)
 * 데이터 없는 지표는 분자/분모 모두에서 제외
 *
 * history(252일치 등)를 함께 전달하면 절대 임계값과 상대 분위수의
 * 더 위험한 쪽을 채택하는 하이브리드 모드로 동작한다.
 */
export function calculateRiskIndex(
  values: Record<string, number | null | undefined>,
  history?: Record<string, number[] | undefined>
): RiskIndexResult {
  let weightedSum = 0;
  let maxPossible = 0;
  let validCount = 0;
  let dangerCount = 0;
  const breakdown: Record<string, { level: RiskLevel; value: number; absoluteLevel: RiskLevel; relativeLevel: RiskLevel | null }> = {};

  for (const [type, threshold] of Object.entries(RISK_THRESHOLDS)) {
    const value = values[type];
    const absoluteLevel = getRiskLevel(type, value);
    if (absoluteLevel === null || value == null) continue;

    const relativeLevel = history ? getRelativeRiskLevel(type, value, history[type]) : null;
    const level = (relativeLevel != null
      ? (Math.max(absoluteLevel, relativeLevel) as RiskLevel)
      : absoluteLevel);

    validCount++;
    weightedSum += LEVEL_WEIGHTS[level] * threshold.weight;
    maxPossible += LEVEL_WEIGHTS[3] * threshold.weight; // 6 × weight
    breakdown[type] = { level, value, absoluteLevel, relativeLevel };
    if (level >= 2) dangerCount++;
  }

  const riskIndex = maxPossible > 0
    ? Math.round((weightedSum / maxPossible) * 10000) / 100
    : 0;

  return { riskIndex, breakdown, validCount, dangerCount };
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
