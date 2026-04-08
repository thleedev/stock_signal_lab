-- stock_cache에 1달 등락률 컬럼 추가
ALTER TABLE stock_cache ADD COLUMN IF NOT EXISTS change_1m_pct NUMERIC(8,2);

-- 인덱스 추가 (정렬 성능용)
CREATE INDEX IF NOT EXISTS idx_stock_cache_change_1m_pct ON stock_cache(change_1m_pct);

-- 백필: daily_prices에서 약 1달 전(영업일 기준) close 가격 기반으로 등락률 계산
UPDATE stock_cache sc
SET change_1m_pct = ROUND(
  ((sc.current_price - dp.close)::NUMERIC / dp.close) * 100, 2
)
FROM (
  SELECT DISTINCT ON (symbol)
    symbol, close
  FROM daily_prices
  WHERE date >= CURRENT_DATE - INTERVAL '40 days'
    AND date <= CURRENT_DATE - INTERVAL '25 days'
    AND close > 0
  ORDER BY symbol, date DESC
) dp
WHERE sc.symbol = dp.symbol
  AND sc.current_price IS NOT NULL
  AND sc.current_price > 0;
