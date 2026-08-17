-- ============================================
-- 081: upsert_signals_bulk 가 device_id 를 덮어쓰지 않게 수정
--
-- 문제
--   063 의 ON CONFLICT DO UPDATE 는 signal_time·batch_id·device_id 를 갱신하고
--   raw_data·timestamp 는 갱신하지 않습니다. 같은 (symbol, source, signal_type, 날짜KST)
--   행에 나중 쓰기가 들어오면 raw_data 는 최초 수집자의 것이 남는데 device_id 만 바뀌어
--   두 값이 서로 모순됩니다.
--
--   실제 사례(2026-08-06): 서버 크론이 21:31 에 저장한 라씨 행의 raw_data 는
--   provider=thinkpool 인데, 22:08 Android SMS 폴백(collector-001)이 같은 종목을 올리면서
--   device_id 만 collector-001 로 바뀌었습니다. 수집 출처를 device_id 로 추적할 수 없습니다.
--
-- 조치
--   device_id 를 갱신 대상에서 제외해 최초 수집자를 보존합니다.
--   raw_data·timestamp 가 이미 최초 값을 유지하므로 device_id 도 같은 기준을 따르는 편이
--   일관되고, 라씨는 서버 크론이 SMS 폴백보다 먼저 도는 것이 정상 경로입니다.
--   batch_id 는 그대로 갱신합니다. "이 신호를 마지막으로 확인한 배치" 로 쓰이기 때문입니다.
--
--   signal_time 규칙은 063 그대로입니다. SMS 폴백은 signal_time 이 null 이라
--   COALESCE 가 서버의 절대시각을 지키므로 별도 처리가 필요 없습니다.
-- ============================================

CREATE OR REPLACE FUNCTION upsert_signals_bulk(payload jsonb)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  rec jsonb;
BEGIN
  FOR rec IN SELECT * FROM jsonb_array_elements(payload)
  LOOP
    INSERT INTO signals (
      timestamp,
      symbol,
      name,
      signal_type,
      signal_price,
      signal_time,
      source,
      batch_id,
      is_fallback,
      raw_data,
      device_id
    ) VALUES (
      (rec->>'timestamp')::timestamptz,
      rec->>'symbol',
      rec->>'name',
      rec->>'signal_type',
      (rec->>'signal_price')::integer,
      (rec->>'signal_time')::timestamptz,
      rec->>'source',
      (rec->>'batch_id')::uuid,
      COALESCE((rec->>'is_fallback')::boolean, false),
      rec->'raw_data',
      rec->>'device_id'
    )
    ON CONFLICT (symbol, source, signal_type, signal_date_kst(timestamp))
    WHERE symbol IS NOT NULL
    DO UPDATE SET
      signal_time = COALESCE(EXCLUDED.signal_time, signals.signal_time),
      batch_id    = EXCLUDED.batch_id;
      -- device_id 는 갱신하지 않습니다 (최초 수집자 보존)
  END LOOP;
END;
$$;

GRANT EXECUTE ON FUNCTION upsert_signals_bulk(jsonb) TO anon;
GRANT EXECUTE ON FUNCTION upsert_signals_bulk(jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION upsert_signals_bulk(jsonb) TO service_role;

-- ── 기존 행 정정: raw_data 가 씽크풀 수집분인데 device_id 가 덮인 행을 되돌립니다.
UPDATE signals
SET device_id = 'thinkpool-api'
WHERE source = 'lassi'
  AND raw_data->>'provider' = 'thinkpool'
  AND device_id IS DISTINCT FROM 'thinkpool-api';
