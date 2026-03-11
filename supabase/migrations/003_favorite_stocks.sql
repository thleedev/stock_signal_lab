-- ============================================
-- 003: 즐겨찾기 (라씨매매 종목 필터링)
-- ============================================

CREATE TABLE favorite_stocks (
  symbol        VARCHAR(10) PRIMARY KEY,
  name          VARCHAR(100) NOT NULL,
  added_at      TIMESTAMPTZ DEFAULT now(),
  note          TEXT
);

ALTER TABLE favorite_stocks ENABLE ROW LEVEL SECURITY;
CREATE POLICY "favorite_stocks_all" ON favorite_stocks FOR ALL USING (true);
