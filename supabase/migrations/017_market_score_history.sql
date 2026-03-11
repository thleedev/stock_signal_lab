-- 시황 점수 히스토리 (일별 종합 점수 기록)
CREATE TABLE IF NOT EXISTS market_score_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  date DATE NOT NULL UNIQUE,
  total_score NUMERIC(5,2) NOT NULL,
  breakdown JSONB NOT NULL,
  weights_snapshot JSONB NOT NULL
);
