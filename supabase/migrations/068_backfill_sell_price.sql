-- latest_sell_price 백필: signals 테이블에서 심볼별 최신 SELL 신호의 매도가 추출
-- raw_data 우선순위: signal_price → recommend_price → sell_price → price → current_price
UPDATE stock_cache sc
SET latest_sell_price = sub.sell_price
FROM (
  SELECT DISTINCT ON (symbol)
    symbol,
    COALESCE(
      NULLIF((raw_data->>'signal_price')::NUMERIC, 0),
      NULLIF((raw_data->>'recommend_price')::NUMERIC, 0),
      NULLIF((raw_data->>'sell_price')::NUMERIC, 0),
      NULLIF((raw_data->>'price')::NUMERIC, 0),
      NULLIF((raw_data->>'current_price')::NUMERIC, 0)
    ) AS sell_price
  FROM signals
  WHERE signal_type IN ('SELL', 'SELL_COMPLETE')
    AND raw_data IS NOT NULL
  ORDER BY symbol, timestamp DESC
) sub
WHERE sc.symbol = sub.symbol
  AND sub.sell_price IS NOT NULL
  AND sub.sell_price > 0;

-- latest_signal_price도 백필: signals 테이블에서 심볼별 최신 BUY 신호 매수가 (값이 없는 종목만)
UPDATE stock_cache sc
SET latest_signal_price = sub.buy_price
FROM (
  SELECT DISTINCT ON (symbol)
    symbol,
    COALESCE(
      NULLIF((raw_data->>'signal_price')::NUMERIC, 0),
      NULLIF((raw_data->>'recommend_price')::NUMERIC, 0),
      NULLIF((raw_data->>'buy_price')::NUMERIC, 0),
      NULLIF((raw_data->>'price')::NUMERIC, 0),
      NULLIF((raw_data->>'current_price')::NUMERIC, 0)
    ) AS buy_price
  FROM signals
  WHERE signal_type IN ('BUY', 'BUY_FORECAST')
    AND raw_data IS NOT NULL
  ORDER BY symbol, timestamp DESC
) sub
WHERE sc.symbol = sub.symbol
  AND sc.latest_signal_price IS NULL
  AND sub.buy_price IS NOT NULL
  AND sub.buy_price > 0;
