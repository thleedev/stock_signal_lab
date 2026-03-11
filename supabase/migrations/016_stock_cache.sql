-- 전종목 캐시 테이블
CREATE TABLE IF NOT EXISTS stock_cache (
  symbol VARCHAR(10) PRIMARY KEY,
  name VARCHAR(100) NOT NULL,
  market VARCHAR(10) NOT NULL,
  current_price INTEGER,
  price_change INTEGER,
  price_change_pct NUMERIC(8,2),
  volume BIGINT,
  market_cap BIGINT,
  per NUMERIC(10,2),
  pbr NUMERIC(10,2),
  roe NUMERIC(10,2),
  eps INTEGER,
  bps INTEGER,
  dividend_yield NUMERIC(8,2),
  high_52w INTEGER,
  low_52w INTEGER,
  latest_signal_type VARCHAR(20),
  latest_signal_date TIMESTAMPTZ,
  signal_count_30d INTEGER DEFAULT 0,
  ai_score NUMERIC(5,2),
  is_holding BOOLEAN DEFAULT false,
  is_favorite BOOLEAN DEFAULT false,
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_stock_cache_market ON stock_cache(market);
CREATE INDEX IF NOT EXISTS idx_stock_cache_favorite ON stock_cache(is_favorite);
CREATE INDEX IF NOT EXISTS idx_stock_cache_holding ON stock_cache(is_holding);
