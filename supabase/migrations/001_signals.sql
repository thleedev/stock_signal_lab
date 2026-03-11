-- ============================================
-- 001: 신호 수집 테이블
-- ============================================

CREATE TABLE signals (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at    TIMESTAMPTZ DEFAULT now(),
  timestamp     TIMESTAMPTZ NOT NULL,
  symbol        VARCHAR(10),
  name          VARCHAR(100) NOT NULL,
  signal_type   VARCHAR(20) NOT NULL,    -- BUY/SELL/HOLD/BUY_FORECAST/SELL_COMPLETE
  source        VARCHAR(20) NOT NULL,    -- lassi/stockbot/quant
  batch_id      UUID,
  is_fallback   BOOLEAN DEFAULT false,
  raw_data      JSONB,
  device_id     VARCHAR(50)
);

CREATE INDEX idx_signals_source_date ON signals(source, timestamp);
CREATE INDEX idx_signals_symbol ON signals(symbol);

-- RLS (Row Level Security)
ALTER TABLE signals ENABLE ROW LEVEL SECURITY;

-- API Key 인증 사용자는 모든 작업 가능
CREATE POLICY "signals_all" ON signals
  FOR ALL USING (true);
