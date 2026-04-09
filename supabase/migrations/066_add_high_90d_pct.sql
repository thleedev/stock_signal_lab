-- stock_cache에 90일 최고가 대비 현재 등락률 컬럼 추가
ALTER TABLE stock_cache ADD COLUMN IF NOT EXISTS high_90d_pct NUMERIC(8,2);

-- 인덱스 추가 (정렬 성능용)
CREATE INDEX IF NOT EXISTS idx_stock_cache_high_90d_pct ON stock_cache(high_90d_pct);

-- 백필: daily_prices에서 최근 90일 최고 종가 기반으로 현재가 대비 등락률 계산
UPDATE stock_cache sc
SET high_90d_pct = ROUND(
  ((sc.current_price - dp.high_close)::NUMERIC / dp.high_close) * 100, 2
)
FROM (
  SELECT symbol, MAX(close) AS high_close
  FROM daily_prices
  WHERE date >= CURRENT_DATE - INTERVAL '90 days'
    AND close > 0
  GROUP BY symbol
) dp
WHERE sc.symbol = dp.symbol
  AND sc.current_price IS NOT NULL
  AND sc.current_price > 0;

-- 배치 스크립트에서 호출할 갱신 함수
CREATE OR REPLACE FUNCTION refresh_high_90d_pct()
RETURNS void
LANGUAGE sql
SECURITY DEFINER
AS $$
  UPDATE stock_cache sc
  SET high_90d_pct = ROUND(
    ((sc.current_price - dp.high_close)::NUMERIC / dp.high_close) * 100, 2
  )
  FROM (
    SELECT symbol, MAX(close) AS high_close
    FROM daily_prices
    WHERE date >= CURRENT_DATE - INTERVAL '90 days'
      AND close > 0
    GROUP BY symbol
  ) dp
  WHERE sc.symbol = dp.symbol
    AND sc.current_price IS NOT NULL
    AND sc.current_price > 0;
$$;
