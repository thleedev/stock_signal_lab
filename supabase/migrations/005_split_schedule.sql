-- ============================================
-- 005: 분할매매 예약 (Cron에서 실행)
-- ============================================

CREATE TABLE split_trade_schedule (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  trade_group_id  UUID NOT NULL,
  source          VARCHAR(20) NOT NULL,
  symbol          VARCHAR(10) NOT NULL,
  side            VARCHAR(4) NOT NULL,
  quantity        INTEGER NOT NULL,
  scheduled_date  DATE NOT NULL,
  split_seq       INTEGER NOT NULL,        -- 2회차, 3회차
  status          VARCHAR(10) DEFAULT 'pending',  -- pending/executed/cancelled
  executed_price  INTEGER,
  executed_at     TIMESTAMPTZ,
  signal_id       UUID REFERENCES signals(id)
);

CREATE INDEX idx_schedule_date ON split_trade_schedule(scheduled_date, status);

ALTER TABLE split_trade_schedule ENABLE ROW LEVEL SECURITY;
CREATE POLICY "split_trade_schedule_all" ON split_trade_schedule FOR ALL USING (true);
