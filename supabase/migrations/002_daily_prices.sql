-- ============================================
-- 002: 일봉 가격 데이터 + 종목 정보
-- ============================================

CREATE TABLE daily_prices (
  symbol        VARCHAR(10) NOT NULL,
  date          DATE NOT NULL,
  open          INTEGER,
  high          INTEGER,
  low           INTEGER,
  close         INTEGER NOT NULL,
  volume        BIGINT,
  PRIMARY KEY (symbol, date)
);

CREATE TABLE stock_info (
  symbol        VARCHAR(10) PRIMARY KEY,
  name          VARCHAR(100) NOT NULL,
  sector        VARCHAR(50),
  market        VARCHAR(10),             -- KOSPI/KOSDAQ
  updated_at    TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE daily_prices ENABLE ROW LEVEL SECURITY;
ALTER TABLE stock_info ENABLE ROW LEVEL SECURITY;

CREATE POLICY "daily_prices_all" ON daily_prices FOR ALL USING (true);
CREATE POLICY "stock_info_all" ON stock_info FOR ALL USING (true);
