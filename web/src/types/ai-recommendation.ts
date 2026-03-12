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

  // 밸류에이션
  per: number | null;
  pbr: number | null;
  roe: number | null;

  // 수급
  foreign_buying: boolean;
  institution_buying: boolean;
  volume_vs_sector: boolean;

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

export const DEFAULT_WEIGHTS: AiRecommendationWeights = {
  signal: 30,
  technical: 30,
  valuation: 20,
  supply: 20,
};

export interface AiRecommendationResponse {
  recommendations: AiRecommendation[];
  generated_at: string | null;
  total_candidates: number;
  needs_refresh: boolean;
}
