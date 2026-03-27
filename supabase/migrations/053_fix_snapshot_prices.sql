-- 기존 스냅샷의 current_price를 daily_prices 종가로 보정
-- stock_cache.current_price가 stale한 상태에서 저장된 스냅샷 수정
UPDATE stock_ranking_snapshot s
SET current_price = dp.close
FROM daily_prices dp
WHERE s.symbol = dp.symbol
  AND s.snapshot_date = dp.date
  AND dp.close IS NOT NULL
  AND dp.close > 0
  AND s.current_price IS DISTINCT FROM dp.close;
