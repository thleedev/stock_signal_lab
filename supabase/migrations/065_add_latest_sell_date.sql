-- stock_cache에 latest_sell_date 컬럼 추가
-- 최신 SELL/SELL_COMPLETE 신호 날짜를 저장해 종목추천에서 DB 레벨로 필터링
ALTER TABLE stock_cache
  ADD COLUMN IF NOT EXISTS latest_sell_date TIMESTAMPTZ;

-- SELL이 BUY보다 최신인지 여부를 나타내는 generated column
-- true → 매도 상태 (종목추천 제외), false → 매수 상태 또는 SELL 신호 없음 (포함)
ALTER TABLE stock_cache
  ADD COLUMN IF NOT EXISTS has_active_sell BOOLEAN
    GENERATED ALWAYS AS (
      latest_sell_date IS NOT NULL AND (
        latest_signal_date IS NULL OR
        latest_sell_date > latest_signal_date
      )
    ) STORED;

-- 기존 데이터 백필: signals 테이블에서 심볼별 최신 SELL 날짜로 초기화
UPDATE stock_cache sc
SET latest_sell_date = sub.max_ts
FROM (
  SELECT symbol, MAX(timestamp) AS max_ts
  FROM signals
  WHERE signal_type IN ('SELL', 'SELL_COMPLETE')
  GROUP BY symbol
) sub
WHERE sc.symbol = sub.symbol;
