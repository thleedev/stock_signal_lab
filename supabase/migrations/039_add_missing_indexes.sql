-- ============================================
-- 039: 누락된 인덱스 추가 (성능 개선)
-- ============================================

-- signals: 중복 제거 쿼리 최적화 (symbol + source + signal_type + timestamp 조합 조회)
CREATE INDEX IF NOT EXISTS idx_signals_dedup
  ON signals(symbol, source, signal_type, timestamp DESC);

-- stock_cache: 현재가 기반 종목 랭킹 쿼리 최적화 (current_price IS NOT NULL 필터)
CREATE INDEX IF NOT EXISTS idx_stock_cache_price_not_null
  ON stock_cache(current_price) WHERE current_price IS NOT NULL;

-- stock_cache: signal_count_30d 기반 signal_all 쿼리 최적화
CREATE INDEX IF NOT EXISTS idx_stock_cache_signal_count
  ON stock_cache(signal_count_30d);

-- ai_recommendations: 날짜+종목 조합 조회 최적화
CREATE INDEX IF NOT EXISTS idx_ai_recommendations_date_symbol
  ON ai_recommendations(date, symbol);

-- daily_prices: 기술적 지표 계산 시 종목별 최신 가격 조회 최적화
CREATE INDEX IF NOT EXISTS idx_daily_prices_symbol_date
  ON daily_prices(symbol, date DESC);
