-- Standard 모델 상승확률 기반 재순위화: risk/trend 컬럼 추가 및 리네이밍

-- 1. 신규 컬럼 추가
ALTER TABLE ai_recommendations
  ADD COLUMN IF NOT EXISTS risk_score REAL,
  ADD COLUMN IF NOT EXISTS trend_days INTEGER,
  ADD COLUMN IF NOT EXISTS weight_risk REAL;

-- 2. 리네이밍: technical_score → trend_score
ALTER TABLE ai_recommendations
  RENAME COLUMN technical_score TO trend_score;

-- 3. 리네이밍: weight_technical → weight_trend
ALTER TABLE ai_recommendations
  RENAME COLUMN weight_technical TO weight_trend;
