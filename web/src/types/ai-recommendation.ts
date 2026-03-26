export interface AiRecommendation {
  id: string;
  date: string; // YYYY-MM-DD
  symbol: string;
  name: string | null;
  rank: number;
  total_score: number; // 0~100

  // 가중치 (재계산 시 사용한 값)
  weight_signal: number;
  weight_trend: number; // weight_technical → weight_trend
  weight_valuation: number;
  weight_supply: number;
  weight_earnings_momentum: number; // 이익모멘텀 가중치
  weight_risk: number; // 리스크 감산 가중치
  market_cap_tier: 'large' | 'mid' | 'small'; // 시총 티어

  // 항목별 점수 (원점수)
  signal_score: number | null;
  trend_score: number | null; // technical_score → trend_score
  valuation_score: number | null;
  supply_score: number | null;
  risk_score: number | null; // 리스크 점수
  earnings_momentum_score: number | null; // 이익모멘텀 점수
  trend_days: number | null; // 추세 지속 일수

  // 기술적 지표
  signal_count: number | null;
  rsi: number | null;
  macd_cross: boolean;
  golden_cross: boolean;
  bollinger_bottom: boolean;
  phoenix_pattern: boolean;
  double_top: boolean;
  volume_surge: boolean;
  week52_low_near: boolean;
  week52_high_near: boolean;
  disparity_rebound: boolean;
  volume_breakout: boolean;
  consecutive_drop_rebound: boolean;

  // 밸류에이션
  per: number | null;
  pbr: number | null;
  roe: number | null;

  // 수급
  foreign_buying: boolean;
  institution_buying: boolean;
  volume_vs_sector: boolean;
  low_short_sell: boolean;

  // 메타
  total_candidates: number | null;
  created_at: string;
}

export interface AiRecommendationWeights {
  signal: number; // 0~100
  trend: number; // 0~100 (technical → trend 리네이밍)
  valuation: number; // 0~100
  supply: number; // 0~100
  earnings_momentum: number; // 이익모멘텀 (대형주 핵심)
  risk: number; // 감산 가중치
}

// 시총 티어별 가중치: 대형주는 수급+이익모멘텀 중심, 소형주는 추세+수급 중심
export const WEIGHTS_BY_TIER: Record<'large' | 'mid' | 'small', AiRecommendationWeights> = {
  large: { signal: 5, trend: 25, valuation: 15, supply: 25, earnings_momentum: 30, risk: 15 },
  mid:   { signal: 8, trend: 32, valuation: 18, supply: 25, earnings_momentum: 17, risk: 15 },
  small: { signal: 10, trend: 40, valuation: 20, supply: 30, earnings_momentum: 0, risk: 15 },
};

// 기본 가중치 (소형주 기준, 하위 호환)
export const DEFAULT_WEIGHTS: AiRecommendationWeights = WEIGHTS_BY_TIER.small;

export interface AiRecommendationResponse {
  recommendations: AiRecommendation[];
  generated_at: string | null;
  total_candidates: number;
  needs_refresh: boolean;
}

// --- 초단기 모멘텀 모델 타입 ---

export type ModelType = 'standard' | 'short_term';

export interface ShortTermWeights {
  momentum: number;   // 기본 45
  supply: number;     // 기본 28
  catalyst: number;   // 기본 22
  valuation: number;  // 기본 5
  risk: number;       // 기본 15 (감산)
}

export const DEFAULT_SHORT_TERM_WEIGHTS: ShortTermWeights = {
  momentum: 45,
  supply: 28,
  catalyst: 22,
  valuation: 5,
  risk: 15,
};

export interface ShortTermScoreBreakdown {
  momentum: number;
  supply: number;
  catalyst: number;
  valuation: number;
  risk: number;
  total: number;
  grade: string;
  gradeLabel: string;
  preFilterPassed: boolean;
  preFilterReasons?: string[];
  badges?: string[];
}
