-- ============================================
-- 074: 알파캐치 보유 종목 (영웅문 알파추천 → 보유종목 탭 동기화)
-- ============================================
-- 단일 사용자 기준. PUT 호출 시 전체 덮어쓰기.

CREATE TABLE alphacatch_holdings (
  symbol         VARCHAR(10) PRIMARY KEY,
  name           TEXT NOT NULL,
  return_pct     NUMERIC(8,4),
  close_price    INTEGER,
  avg_buy_price  INTEGER,
  bought_at      DATE,
  captured_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_alphacatch_holdings_captured_at ON alphacatch_holdings(captured_at DESC);

ALTER TABLE alphacatch_holdings ENABLE ROW LEVEL SECURITY;
CREATE POLICY "alphacatch_holdings_all" ON alphacatch_holdings FOR ALL USING (true);
