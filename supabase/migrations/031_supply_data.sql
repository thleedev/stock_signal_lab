-- stock_cache에 수급 데이터 컬럼 추가
ALTER TABLE stock_cache
  ADD COLUMN IF NOT EXISTS short_sell_ratio NUMERIC(8,4),         -- 공매도 비율 (%)
  ADD COLUMN IF NOT EXISTS short_sell_updated_at TIMESTAMPTZ,     -- 공매도 데이터 최종 업데이트
  ADD COLUMN IF NOT EXISTS foreign_net_qty BIGINT,                -- 외국인 순매수 수량 (당일)
  ADD COLUMN IF NOT EXISTS institution_net_qty BIGINT,            -- 기관 순매수 수량 (당일)
  ADD COLUMN IF NOT EXISTS investor_updated_at TIMESTAMPTZ;       -- 투자자 데이터 최종 업데이트

-- ai_recommendations에 공매도 낮음 컬럼 추가
ALTER TABLE ai_recommendations
  ADD COLUMN IF NOT EXISTS low_short_sell BOOLEAN DEFAULT false;
