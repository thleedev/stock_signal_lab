// 시황 지표 타입

export type IndicatorType =
  | 'VIX'
  | 'USD_KRW'
  | 'US_10Y'
  | 'WTI'
  | 'KOSPI'
  | 'KOSDAQ'
  | 'GOLD'
  | 'DXY'
  | 'KR_3Y'
  | 'KORU'
  | 'EWY'
  | 'FEAR_GREED'
  | 'VKOSPI'
  | 'CNN_FEAR_GREED';

// Yahoo Finance 티커 매핑
export const YAHOO_TICKERS: Record<string, string> = {
  VIX: '^VIX',
  USD_KRW: 'KRW=X',
  US_10Y: '^TNX',
  WTI: 'CL=F',
  KOSPI: '^KS11',
  KOSDAQ: '^KQ11',
  GOLD: 'GC=F',
  DXY: 'DX-Y.NYB',
  KR_3Y: '122630.KS', // KODEX 레버리지 대용 (한국 3년물 직접 티커 없음)
  KORU: 'KORU',
  EWY: 'EWY',
  VKOSPI: '^VKOSPI',
};

// 단일 데이터 포인트일 때 사용할 절대 범위 (min/max 90일 대체)
export const ABSOLUTE_RANGES: Record<string, { min: number; max: number }> = {
  VIX: { min: 10, max: 50 },
  USD_KRW: { min: 1100, max: 1550 },
  US_10Y: { min: 1.0, max: 5.5 },
  WTI: { min: 40, max: 130 },
  KOSPI: { min: 1800, max: 3200 },
  KOSDAQ: { min: 500, max: 1100 },
  GOLD: { min: 1600, max: 3000 },
  DXY: { min: 90, max: 115 },
  KR_3Y: { min: 1.0, max: 5.0 },
  KORU: { min: 3, max: 40 },
  EWY: { min: 35, max: 85 },
  FEAR_GREED: { min: 0, max: 100 },
};

export interface MarketIndicator {
  id: string;
  date: string;
  indicator_type: IndicatorType;
  value: number;
  prev_value: number | null;
  change_pct: number | null;
  raw_data: Record<string, unknown> | null;
}

export interface IndicatorWeight {
  id: string;
  indicator_type: IndicatorType;
  weight: number;
  direction: number; // 1 or -1
  label: string;
  description: string | null;
  updated_at: string;
}

export interface MarketScoreHistory {
  id: string;
  date: string;
  total_score: number;
  breakdown: Record<string, {
    indicator_type: IndicatorType;
    value: number;
    normalized: number;
    weighted_score: number;
    weight: number;
    direction: number;
  }>;
  weights_snapshot: Record<string, number>;
  event_risk_score: number | null;
  combined_score: number | null;
  risk_index: number | null;
}

// 시황 점수 해석
export interface MarketScoreInterpretation {
  label: string;
  color: string;
  bgColor: string;
  signal: string;
}

export const SCORE_INTERPRETATIONS: MarketScoreInterpretation[] = [
  { label: '매우 긍정적', color: '#10b981', bgColor: 'bg-emerald-500', signal: '적극 매수 구간' },
  { label: '긍정적', color: '#22c55e', bgColor: 'bg-green-500', signal: '매수 우위' },
  { label: '중립', color: '#eab308', bgColor: 'bg-yellow-500', signal: '관망' },
  { label: '부정적', color: '#f97316', bgColor: 'bg-orange-500', signal: '방어적 투자' },
  { label: '매우 부정적', color: '#ef4444', bgColor: 'bg-red-500', signal: '현금 비중 확대' },
];

export function getScoreInterpretation(score: number): MarketScoreInterpretation {
  if (score >= 80) return SCORE_INTERPRETATIONS[0];
  if (score >= 60) return SCORE_INTERPRETATIONS[1];
  if (score >= 40) return SCORE_INTERPRETATIONS[2];
  if (score >= 20) return SCORE_INTERPRETATIONS[3];
  return SCORE_INTERPRETATIONS[4];
}
