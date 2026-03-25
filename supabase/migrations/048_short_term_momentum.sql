-- 초단기 모멘텀 모델 지원
ALTER TABLE ai_recommendations
  ADD COLUMN IF NOT EXISTS model_type TEXT DEFAULT 'standard',
  ADD COLUMN IF NOT EXISTS score_breakdown JSONB;

CREATE INDEX IF NOT EXISTS idx_ai_rec_model_date
  ON ai_recommendations(model_type, date);

-- 기존 UNIQUE 제약 업데이트 (model_type 포함)
ALTER TABLE ai_recommendations DROP CONSTRAINT IF EXISTS ai_recommendations_date_symbol_key;
ALTER TABLE ai_recommendations ADD CONSTRAINT ai_recommendations_date_symbol_model_key
  UNIQUE(date, symbol, model_type);
