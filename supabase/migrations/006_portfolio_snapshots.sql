-- ============================================
-- 006: 포트폴리오 스냅샷 + 통계
-- ============================================

CREATE TABLE portfolio_snapshots (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  date            DATE NOT NULL,
  source          VARCHAR(20) NOT NULL,    -- lassi/stockbot/quant
  execution_type  VARCHAR(10) NOT NULL,    -- lump/split
  holdings        JSONB NOT NULL,          -- [{"symbol":"028670","qty":10,"avg_price":4800}]
  cash            BIGINT NOT NULL,
  total_value     BIGINT NOT NULL,
  daily_return_pct NUMERIC(8,4),
  cumulative_return_pct NUMERIC(8,4),
  UNIQUE(date, source, execution_type)
);

CREATE TABLE combined_portfolio_snapshots (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  date            DATE NOT NULL,
  execution_type  VARCHAR(10) NOT NULL,    -- lump/split
  total_value     BIGINT NOT NULL,
  daily_return_pct NUMERIC(8,4),
  cumulative_return_pct NUMERIC(8,4),
  breakdown       JSONB NOT NULL,
  UNIQUE(date, execution_type)
);

CREATE TABLE daily_signal_stats (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  date          DATE NOT NULL,
  source        VARCHAR(20) NOT NULL,
  execution_type VARCHAR(10) NOT NULL,
  total_signals INTEGER,
  buy_count     INTEGER,
  sell_count    INTEGER,
  realized_trades INTEGER,
  hit_rate      NUMERIC(5,2),
  avg_return    NUMERIC(8,4),
  UNIQUE(date, source, execution_type)
);

ALTER TABLE portfolio_snapshots ENABLE ROW LEVEL SECURITY;
ALTER TABLE combined_portfolio_snapshots ENABLE ROW LEVEL SECURITY;
ALTER TABLE daily_signal_stats ENABLE ROW LEVEL SECURITY;

CREATE POLICY "portfolio_snapshots_all" ON portfolio_snapshots FOR ALL USING (true);
CREATE POLICY "combined_portfolio_snapshots_all" ON combined_portfolio_snapshots FOR ALL USING (true);
CREATE POLICY "daily_signal_stats_all" ON daily_signal_stats FOR ALL USING (true);
