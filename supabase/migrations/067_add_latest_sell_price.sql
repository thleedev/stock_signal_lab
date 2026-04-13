-- stock_cache에 latest_sell_price 컬럼 추가
-- 최근 SELL/SELL_COMPLETE 신호 매도가를 저장해 종목추천에서 매도가 기준 gap 표시에 활용
ALTER TABLE stock_cache
  ADD COLUMN IF NOT EXISTS latest_sell_price NUMERIC DEFAULT NULL;

COMMENT ON COLUMN stock_cache.latest_sell_price IS '최근 SELL/SELL_COMPLETE 신호 매도가 (signal_price/recommend_price/sell_price 등 raw_data에서 추출)';
