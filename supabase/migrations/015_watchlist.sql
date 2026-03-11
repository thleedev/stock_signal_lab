-- 투자 종목 워치리스트
CREATE TABLE IF NOT EXISTS watchlist (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  symbol VARCHAR(10) NOT NULL UNIQUE,
  name VARCHAR(100) NOT NULL,
  added_at TIMESTAMPTZ DEFAULT now(),
  memo TEXT,
  sort_order INTEGER DEFAULT 0
);
