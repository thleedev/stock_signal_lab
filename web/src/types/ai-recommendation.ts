export interface AiRecommendation {
  id: string;
  date: string; // YYYY-MM-DD
  symbol: string;
  name: string | null;
  rank: number;
  total_score: number; // 0~100

  // 가중치 (재계산 시 사용한 값)
  weight_signal: number; // 기본 30
  weight_technical: number; // 기본 30
  weight_valuation: number; // 기본 20
  weight_supply: number; // 기본 20

  // 항목별 점수 (원점수)
  signal_score: number | null;
  technical_score: number | null;
  valuation_score: number | null;
  supply_score: number | null;

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
  technical: number; // 0~100
  valuation: number; // 0~100
  supply: number; // 0~100
}

// 애널리스트 관점 기본 가중치: 기술(40) = 수급(40) > 신호(10) = 밸류(10)
export const DEFAULT_WEIGHTS: AiRecommendationWeights = {
  signal: 10,
  technical: 40,
  valuation: 10,
  supply: 40,
};

export interface AiRecommendationResponse {
  recommendations: AiRecommendation[];
  generated_at: string | null;
  total_candidates: number;
  needs_refresh: boolean;
}
