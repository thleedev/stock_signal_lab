-- 최근 BUY 신호의 매수가를 stock_cache에 저장
ALTER TABLE stock_cache
  ADD COLUMN IF NOT EXISTS latest_signal_price NUMERIC DEFAULT NULL;

COMMENT ON COLUMN stock_cache.latest_signal_price IS '최근 BUY 신호 매수가 (signal_price/recommend_price/buy_price)';
