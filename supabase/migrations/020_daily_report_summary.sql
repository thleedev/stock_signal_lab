-- 일간 리포트 요약 테이블
CREATE TABLE IF NOT EXISTS daily_report_summary (
  date DATE PRIMARY KEY,
  total_signals INTEGER DEFAULT 0,
  buy_signals INTEGER DEFAULT 0,
  sell_signals INTEGER DEFAULT 0,
  source_breakdown JSONB DEFAULT '{}',
  top_buy_stocks JSONB DEFAULT '[]',
  top_sell_stocks JSONB DEFAULT '[]',
  market_score NUMERIC(5,2),
  created_at TIMESTAMPTZ DEFAULT NOW()
);
