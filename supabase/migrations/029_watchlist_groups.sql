-- supabase/migrations/029_watchlist_groups.sql

-- 1. 그룹 메타 테이블
CREATE TABLE IF NOT EXISTS watchlist_groups (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0,
  is_default BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE (name)
);

CREATE INDEX IF NOT EXISTS idx_watchlist_groups_sort ON watchlist_groups(sort_order);

-- 2. 그룹↔종목 매핑 테이블
CREATE TABLE IF NOT EXISTS watchlist_group_stocks (
  group_id UUID REFERENCES watchlist_groups(id) ON DELETE CASCADE,
  symbol VARCHAR(10) NOT NULL,
  added_at TIMESTAMPTZ DEFAULT now(),
  PRIMARY KEY (group_id, symbol)
);

CREATE INDEX IF NOT EXISTS idx_wgs_symbol ON watchlist_group_stocks(symbol);

-- 3. 기본 그룹 생성
INSERT INTO watchlist_groups (name, sort_order, is_default)
VALUES ('기본', 0, true)
ON CONFLICT (name) DO NOTHING;

-- 4. 기존 favorite_stocks → 기본 그룹으로 마이그레이션
INSERT INTO watchlist_group_stocks (group_id, symbol, added_at)
SELECT
  (SELECT id FROM watchlist_groups WHERE is_default = true LIMIT 1),
  symbol,
  added_at
FROM favorite_stocks
ON CONFLICT DO NOTHING;

-- 5. favorite_stocks.group_name deprecated
COMMENT ON COLUMN favorite_stocks.group_name IS 'deprecated: use watchlist_group_stocks instead';
