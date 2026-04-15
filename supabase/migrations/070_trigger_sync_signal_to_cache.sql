-- signals INSERT 시 stock_cache 자동 동기화 트리거
-- SELL 신호 → latest_sell_date / latest_sell_price 갱신
-- BUY  신호 → latest_signal_type / latest_signal_date / latest_signal_price 갱신

CREATE OR REPLACE FUNCTION fn_sync_signal_to_cache()
RETURNS TRIGGER AS $$
DECLARE
  v_price NUMERIC;
BEGIN
  IF NEW.symbol IS NULL THEN
    RETURN NEW;
  END IF;

  IF NEW.signal_type IN ('SELL', 'SELL_COMPLETE') THEN
    -- 가격: raw_data 우선, 없으면 signal_price 컬럼
    v_price := COALESCE(
      NULLIF((NEW.raw_data->>'signal_price')::NUMERIC, 0),
      NULLIF((NEW.raw_data->>'recommend_price')::NUMERIC, 0),
      NULLIF((NEW.raw_data->>'sell_price')::NUMERIC, 0),
      NULLIF((NEW.raw_data->>'price')::NUMERIC, 0),
      NULLIF((NEW.raw_data->>'current_price')::NUMERIC, 0),
      NULLIF(NEW.signal_price::NUMERIC, 0)
    );

    UPDATE stock_cache
    SET
      latest_sell_date  = NEW.timestamp,
      latest_sell_price = COALESCE(v_price, latest_sell_price)
    WHERE symbol = NEW.symbol
      AND (latest_sell_date IS NULL OR latest_sell_date < NEW.timestamp);

  ELSIF NEW.signal_type IN ('BUY', 'BUY_FORECAST') THEN
    v_price := COALESCE(
      NULLIF((NEW.raw_data->>'signal_price')::NUMERIC, 0),
      NULLIF((NEW.raw_data->>'recommend_price')::NUMERIC, 0),
      NULLIF((NEW.raw_data->>'buy_price')::NUMERIC, 0),
      NULLIF((NEW.raw_data->>'price')::NUMERIC, 0),
      NULLIF((NEW.raw_data->>'current_price')::NUMERIC, 0),
      NULLIF(NEW.signal_price::NUMERIC, 0)
    );

    UPDATE stock_cache
    SET
      latest_signal_type  = NEW.signal_type,
      latest_signal_date  = NEW.timestamp,
      latest_signal_price = COALESCE(v_price, latest_signal_price)
    WHERE symbol = NEW.symbol
      AND (latest_signal_date IS NULL OR latest_signal_date < NEW.timestamp);
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- 기존 트리거 있으면 교체
DROP TRIGGER IF EXISTS trg_sync_signal_to_cache ON signals;

CREATE TRIGGER trg_sync_signal_to_cache
  AFTER INSERT ON signals
  FOR EACH ROW
  EXECUTE FUNCTION fn_sync_signal_to_cache();
