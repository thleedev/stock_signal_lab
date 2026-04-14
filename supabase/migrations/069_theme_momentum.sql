-- supabase/migrations/069_theme_momentum.sql

-- KRX 업종-종목 매핑 (상위 레이어)
CREATE TABLE IF NOT EXISTS stock_sectors (
  sector_code TEXT NOT NULL,
  sector_name TEXT NOT NULL,
  symbol      TEXT NOT NULL,
  updated_at  DATE NOT NULL DEFAULT CURRENT_DATE,
  PRIMARY KEY (sector_code, symbol)
);

CREATE INDEX IF NOT EXISTS idx_stock_sectors_symbol ON stock_sectors (symbol);

-- 네이버 테마 메타 + 당일 강도 (하위 레이어)
CREATE TABLE IF NOT EXISTS stock_themes (
  theme_id        TEXT NOT NULL,
  theme_name      TEXT NOT NULL,
  avg_change_pct  FLOAT,
  top_change_pct  FLOAT,
  stock_count     INT,
  momentum_score  FLOAT,          -- 정규화된 테마 강도 0~100
  is_hot          BOOLEAN NOT NULL DEFAULT FALSE,  -- 상위 10% 과열 여부
  date            DATE NOT NULL,
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (theme_id, date)
);

CREATE INDEX IF NOT EXISTS idx_stock_themes_date ON stock_themes (date);
CREATE INDEX IF NOT EXISTS idx_stock_themes_date_hot ON stock_themes (date, is_hot);

-- 테마-종목 매핑 (일별)
CREATE TABLE IF NOT EXISTS theme_stocks (
  theme_id   TEXT NOT NULL,
  symbol     TEXT NOT NULL,
  name       TEXT NOT NULL,
  change_pct FLOAT,
  is_leader  BOOLEAN NOT NULL DEFAULT FALSE,
  date       DATE NOT NULL,
  PRIMARY KEY (theme_id, symbol, date)
);

CREATE INDEX IF NOT EXISTS idx_theme_stocks_date_symbol ON theme_stocks (date, symbol);

-- ai_recommendations에 테마 컬럼 추가
ALTER TABLE ai_recommendations
  ADD COLUMN IF NOT EXISTS theme_tags    JSONB,
  ADD COLUMN IF NOT EXISTS is_leader     BOOLEAN DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS is_hot_theme  BOOLEAN DEFAULT FALSE;
