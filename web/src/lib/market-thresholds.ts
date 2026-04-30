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
  /**
   * 절대 raw 값 대신 history 기반 파생값(%)으로 평가.
   * - drawdown_52w: 52주 고점 대비 낙폭(%) — 음수일수록 깊은 조정
   * - ma200_diff:   200일 이동평균 대비 이격도(%) — 양수일수록 과열
   * 파생 평가가 설정된 지표는 history가 부족하면 위험도 계산에서 제외된다.
   */
  derive?: 'drawdown_52w' | 'ma200_diff';
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
    label: 'KOSPI 52주 고점 대비',
    direction: -1,
    thresholds: [-7, -15, -25],
    weight: 2,
    derive: 'drawdown_52w',
  },
  KOSDAQ: {
    label: 'KOSDAQ 52주 고점 대비',
    direction: -1,
    thresholds: [-10, -20, -30],
    weight: 1,
    derive: 'drawdown_52w',
  },
  CNN_FEAR_GREED: {
    label: 'CNN 공포탐욕지수',
    direction: 0,
    thresholds: [10, 25, 30],
    center: 50,
    weight: 2,
  },
  EWY: {
    label: 'EWY 52주 고점 대비',
    direction: -1,
    thresholds: [-7, -15, -25],
    weight: 1,
    derive: 'drawdown_52w',
  },
  GOLD: {
    label: '금 200일 이격도',
    direction: 1,
    thresholds: [10, 20, 30],
    weight: 1,
    derive: 'ma200_diff',
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
 * derive 설정이 있으면 history 기반 파생값(%)으로 변환.
 * history는 정렬 무관, 길이만 충분하면 됨 (drawdown은 50, ma200_diff는 50).
 * 파생 불가(history 부족, ma=0 등)면 null 반환.
 */
export function deriveValue(
  type: string,
  value: number,
  history: number[] | undefined
): number | null {
  const t = RISK_THRESHOLDS[type];
  if (!t?.derive) return value;
  if (!history || history.length < 50) return null;

  if (t.derive === 'drawdown_52w') {
    let max = value;
    for (const v of history) if (v > max) max = v;
    if (max <= 0) return null;
    return ((value - max) / max) * 100;
  }
  if (t.derive === 'ma200_diff') {
    const window = history.slice(0, 200);
    if (window.length < 50) return null;
    let sum = 0;
    for (const v of window) sum += v;
    const ma = sum / window.length;
    if (ma === 0) return null;
    return ((value - ma) / ma) * 100;
  }
  return null;
}

/**
 * 단일 지표의 위험 레벨 계산
 * value가 null/undefined이면 null 반환 (계산에서 제외)
 * derive 설정이 있는 지표는 history가 필요하며, 부족하면 null 반환.
 */
export function getRiskLevel(
  type: string,
  value: number | null | undefined,
  history?: number[]
): RiskLevel | null {
  if (value == null) return null;
  const t = RISK_THRESHOLDS[type];
  if (!t) return null;

  const evalValue = t.derive ? deriveValue(type, value, history) : value;
  if (evalValue === null) return null;

  const [l1, l2, l3] = t.thresholds;

  if (t.direction === 0) {
    // 양극단 위험: center 기준 거리로 판단 (극공포 & 극탐욕 모두 위험)
    const dist = Math.abs(evalValue - (t.center ?? 50));
    if (dist >= l3) return 3;
    if (dist >= l2) return 2;
    if (dist >= l1) return 1;
    return 0;
  } else if (t.direction === 1) {
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
  // derive 지표는 이미 파생값 자체가 상대적이므로 분위수 보강을 적용하지 않음
  if (t.derive) return null;

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
    const absoluteLevel = getRiskLevel(type, value, history?.[type]);
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
