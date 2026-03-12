-- 028_user_portfolios.sql
-- 사용자 모의투자 포트폴리오 시뮬레이터

-- 1. 포트(탭) 관리
CREATE TABLE IF NOT EXISTS user_portfolios (
  id          BIGSERIAL PRIMARY KEY,
  name        TEXT NOT NULL,
  sort_order  INT NOT NULL DEFAULT 0,
  is_default  BOOLEAN DEFAULT FALSE,
  deleted_at  TIMESTAMPTZ,
  created_at  TIMESTAMPTZ DEFAULT now(),
  UNIQUE(name)
);

ALTER TABLE user_portfolios ENABLE ROW LEVEL SECURITY;
CREATE POLICY "all_access" ON user_portfolios FOR ALL USING (true);

-- 기본 "전체" 포트 생성
INSERT INTO user_portfolios (name, sort_order, is_default)
VALUES ('전체', 0, TRUE)
ON CONFLICT (name) DO NOTHING;

-- 2. 매수/매도 거래 기록
CREATE TABLE IF NOT EXISTS user_trades (
  id            BIGSERIAL PRIMARY KEY,
  portfolio_id  BIGINT REFERENCES user_portfolios(id),
  symbol        TEXT NOT NULL,
  name          TEXT,
  side          TEXT NOT NULL CHECK (side IN ('BUY', 'SELL')),
  price         NUMERIC NOT NULL,
  target_price  NUMERIC,
  stop_price    NUMERIC,
  buy_trade_id  BIGINT REFERENCES user_trades(id),
  note          TEXT,
  created_at    TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE user_trades ENABLE ROW LEVEL SECURITY;
CREATE POLICY "all_access" ON user_trades FOR ALL USING (true);

CREATE INDEX idx_user_trades_portfolio_symbol ON user_trades(portfolio_id, symbol);
CREATE INDEX idx_user_trades_symbol ON user_trades(symbol);
CREATE INDEX idx_user_trades_buy_id ON user_trades(buy_trade_id);

-- 3. 일별 포트 수익률 스냅샷
CREATE TABLE IF NOT EXISTS user_portfolio_snapshots (
  id                    BIGSERIAL PRIMARY KEY,
  portfolio_id          BIGINT REFERENCES user_portfolios(id),
  date                  DATE NOT NULL,
  daily_return_pct      NUMERIC,
  cumulative_return_pct NUMERIC,
  holding_count         INT,
  trade_count           INT,
  created_at            TIMESTAMPTZ DEFAULT now(),
  UNIQUE(portfolio_id, date)
);

ALTER TABLE user_portfolio_snapshots ENABLE ROW LEVEL SECURITY;
CREATE POLICY "all_access" ON user_portfolio_snapshots FOR ALL USING (true);

CREATE INDEX idx_user_snapshots_date ON user_portfolio_snapshots(portfolio_id, date DESC);
