-- ============================================
-- 040: 중복 신호 정리 + UNIQUE constraint 최종 복원
-- 문제: 035에서 dedup index 삭제 후 DB 레벨 중복 방지 없음
-- ============================================

-- Step 1: 오늘(KST) 중복 데이터 정리
-- 같은 (symbol, source, signal_type, signal_time)에서 가장 먼저 들어온 행만 유지
DELETE FROM signals
WHERE id IN (
  SELECT id FROM (
    SELECT id,
           ROW_NUMBER() OVER (
             PARTITION BY symbol, source, signal_type, signal_time
             ORDER BY created_at ASC
           ) AS rn
    FROM signals
    WHERE symbol IS NOT NULL
      AND signal_time IS NOT NULL
      AND timestamp >= (CURRENT_DATE AT TIME ZONE 'Asia/Seoul')
  ) ranked
  WHERE rn > 1
);

-- Step 2: signal_time IS NULL인 중복 정리 (전체 기간)
-- 같은 (symbol, source, signal_type, 날짜)에서 signal_time이 NULL인 행이 여러 개면 첫 번째만 유지
DELETE FROM signals
WHERE id IN (
  SELECT id FROM (
    SELECT id,
           ROW_NUMBER() OVER (
             PARTITION BY symbol, source, signal_type, (timestamp AT TIME ZONE 'Asia/Seoul')::date
             ORDER BY created_at ASC
           ) AS rn
    FROM signals
    WHERE symbol IS NOT NULL
      AND signal_time IS NULL
  ) ranked
  WHERE rn > 1
);

-- Step 3: 039에서 만든 일반 인덱스 제거 후 UNIQUE index로 재생성
-- signal_time이 있는 신호: (symbol, source, signal_type, signal_time) UNIQUE
DROP INDEX IF EXISTS idx_signals_dedup;

CREATE UNIQUE INDEX idx_signals_dedup
  ON signals (symbol, source, signal_type, signal_time)
  WHERE symbol IS NOT NULL AND signal_time IS NOT NULL;

-- Step 4: signal_time IS NULL인 신호도 당일 기준 중복 방지
-- timestamptz::date는 timezone 의존이라 IMMUTABLE이 아님
-- timezone('Asia/Seoul', timestamp)::date를 immutable wrapper로 감싸서 사용
CREATE OR REPLACE FUNCTION signal_date_kst(ts timestamptz)
RETURNS date
LANGUAGE sql IMMUTABLE PARALLEL SAFE
AS $$ SELECT (ts AT TIME ZONE 'Asia/Seoul')::date $$;

CREATE UNIQUE INDEX idx_signals_dedup_null_time
  ON signals (symbol, source, signal_type, signal_date_kst(timestamp))
  WHERE symbol IS NOT NULL AND signal_time IS NULL;
