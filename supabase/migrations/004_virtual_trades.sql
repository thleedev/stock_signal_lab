-- ============================================
-- 004: 가상 거래 기록
-- ============================================

CREATE TABLE virtual_trades (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at      TIMESTAMPTZ DEFAULT now(),
  source          VARCHAR(20) NOT NULL,    -- lassi/stockbot/quant
  execution_type  VARCHAR(10) NOT NULL,    -- lump(일시) / split(분할)
  symbol          VARCHAR(10) NOT NULL,
  name            VARCHAR(100),
  side            VARCHAR(4) NOT NULL,     -- BUY/SELL
  price           INTEGER NOT NULL,
  quantity        INTEGER NOT NULL,
  split_seq       INTEGER,                 -- 분할매매 순번 (1,2,3), 일시는 null
  signal_id       UUID REFERENCES signals(id),
  trade_group_id  UUID,                    -- 동일 신호의 분할 거래 묶음 ID
  note            TEXT
);

CREATE INDEX idx_trades_source_exec ON virtual_trades(source, execution_type);
CREATE INDEX idx_trades_group ON virtual_trades(trade_group_id);

ALTER TABLE virtual_trades ENABLE ROW LEVEL SECURITY;
CREATE POLICY "virtual_trades_all" ON virtual_trades FOR ALL USING (true);
