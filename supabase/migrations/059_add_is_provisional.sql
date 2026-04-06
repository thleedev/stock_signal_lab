-- 059_add_is_provisional.sql
ALTER TABLE daily_prices
  ADD COLUMN IF NOT EXISTS is_provisional BOOLEAN NOT NULL DEFAULT FALSE;

COMMENT ON COLUMN daily_prices.is_provisional IS
  'true = 장중 임시 캔들 (현재가 기준, 미확정). false = 배치 확정 종가. 배치 실행 후 false로 덮어씀.';

CREATE INDEX IF NOT EXISTS daily_prices_provisional_idx
  ON daily_prices(is_provisional) WHERE is_provisional = TRUE;
