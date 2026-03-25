-- 단기 상승 임박 기술 지표 컬럼 추가
ALTER TABLE ai_recommendations
  ADD COLUMN IF NOT EXISTS disparity_rebound BOOLEAN DEFAULT false,
  ADD COLUMN IF NOT EXISTS volume_breakout BOOLEAN DEFAULT false,
  ADD COLUMN IF NOT EXISTS consecutive_drop_rebound BOOLEAN DEFAULT false;
