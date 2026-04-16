-- 072: 스코어링 시스템 전면 재설계
-- catalyst 레이어 추가 + market multiplier 추가

-- stock_scores 테이블에 컬럼 추가
ALTER TABLE stock_scores
  ADD COLUMN IF NOT EXISTS score_catalyst NUMERIC DEFAULT 0,
  ADD COLUMN IF NOT EXISTS market_multiplier NUMERIC DEFAULT 1.0;

-- ai_recommendations 테이블에 컬럼 추가
ALTER TABLE ai_recommendations
  ADD COLUMN IF NOT EXISTS catalyst_norm NUMERIC DEFAULT 0,
  ADD COLUMN IF NOT EXISTS market_multiplier NUMERIC DEFAULT 1.0;
