-- 중복 신호 데이터 정리
-- signal_time이 있는 행과 NULL인 행이 같은 신호로 중복된 경우:
-- 1) NULL 행의 signal_time을 매칭되는 행에서 업데이트
-- 2) 중복된 signal_time 행 삭제 (NULL→절대시간 업데이트된 행만 유지)

-- Step 1: signal_time IS NULL인 행에 매칭되는 signal_time 값을 업데이트
UPDATE signals AS n
SET signal_time = m.signal_time
FROM signals AS m
WHERE n.signal_time IS NULL
  AND m.signal_time IS NOT NULL
  AND n.symbol = m.symbol
  AND n.source = m.source
  AND n.signal_type = m.signal_type
  AND ABS(EXTRACT(EPOCH FROM (n.timestamp - m.timestamp))) < 7200;  -- ±2시간

-- Step 2: 업데이트 후 완전 중복된 행 제거 (같은 symbol+source+signal_type+signal_time, 나중에 INSERT된 것 삭제)
DELETE FROM signals
WHERE id IN (
  SELECT id FROM (
    SELECT id,
           ROW_NUMBER() OVER (
             PARTITION BY symbol, source, signal_type, signal_time
             ORDER BY timestamp ASC  -- 원본(먼저 들어온 것) 유지
           ) AS rn
    FROM signals
    WHERE signal_time IS NOT NULL
  ) ranked
  WHERE rn > 1
);
