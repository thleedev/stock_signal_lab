-- Forward valuation 컬럼 추가 (네이버 컨센서스 데이터)
ALTER TABLE stock_cache
  ADD COLUMN IF NOT EXISTS forward_per NUMERIC(10,2),       -- 추정 PER (애널리스트 컨센서스)
  ADD COLUMN IF NOT EXISTS forward_eps INTEGER,              -- 추정 EPS
  ADD COLUMN IF NOT EXISTS target_price INTEGER,             -- 목표주가 (컨센서스 평균)
  ADD COLUMN IF NOT EXISTS invest_opinion NUMERIC(3,2),      -- 투자의견 (1~5, 5=강력매수)
  ADD COLUMN IF NOT EXISTS consensus_updated_at TIMESTAMPTZ; -- 컨센서스 데이터 갱신 시각
