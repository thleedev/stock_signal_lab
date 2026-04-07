-- ============================================
-- 063: upsert_signals_bulk RPC 도입
--
-- 목표: 수집기에서 모든 종목을 보내면 DB에서 중복은 signal_time만 최신으로 업데이트
--
-- 핵심 변경:
--   1) 두 개의 partial UNIQUE 인덱스 → 하나의 통합 인덱스
--      idx_signals_dedup (signal_time NOT NULL)
--      idx_signals_dedup_null_time (signal_time IS NULL)
--      → idx_signals_dedup_unified (signal_time 값 무관, 날짜·종목·소스·타입 기준)
--
--   2) upsert_signals_bulk(payload jsonb) RPC 생성
--      ON CONFLICT DO UPDATE SET signal_time = COALESCE(new, existing)
--      → 시간이 들어오면 업데이트, 없으면 기존 값 유지
--
--   3) Android 수집기는 INSERT 대신 이 RPC 한 번만 호출
-- ============================================

-- ── Step 1: 같은 (symbol, source, signal_type, 날짜KST)에 행이 여러 개면 정리
-- signal_time IS NOT NULL 행 우선, 없으면 가장 최근 created_at 유지
DELETE FROM signals
WHERE id IN (
  SELECT id FROM (
    SELECT id,
           ROW_NUMBER() OVER (
             PARTITION BY symbol, source, signal_type, signal_date_kst(timestamp)
             ORDER BY
               CASE WHEN signal_time IS NOT NULL THEN 0 ELSE 1 END ASC,
               created_at DESC
           ) AS rn
    FROM signals
    WHERE symbol IS NOT NULL
  ) t
  WHERE rn > 1
);

-- ── Step 2: 기존 partial 인덱스 제거
DROP INDEX IF EXISTS idx_signals_dedup;
DROP INDEX IF EXISTS idx_signals_dedup_null_time;

-- ── Step 3: 통합 UNIQUE 인덱스 생성 (signal_time 값과 무관)
-- 같은 종목·소스·타입이 같은 날짜(KST)에 한 행만 존재
CREATE UNIQUE INDEX idx_signals_dedup_unified
  ON signals (symbol, source, signal_type, signal_date_kst(timestamp))
  WHERE symbol IS NOT NULL;

-- ── Step 4: bulk upsert RPC 생성
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
      batch_id    = EXCLUDED.batch_id,
      device_id   = EXCLUDED.device_id;
  END LOOP;
END;
$$;

-- anon key로 호출 가능하도록 권한 부여 (수집기가 anon key 사용)
GRANT EXECUTE ON FUNCTION upsert_signals_bulk(jsonb) TO anon;
GRANT EXECUTE ON FUNCTION upsert_signals_bulk(jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION upsert_signals_bulk(jsonb) TO service_role;
