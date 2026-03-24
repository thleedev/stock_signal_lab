-- ============================================
-- 043: signal_time=NULL 중복 행 정리 (전체 기간)
-- 같은 (symbol, source, signal_type)에 signal_time 있는 행이 존재하면
-- signal_time=NULL 행은 중복이므로 삭제 (±24시간 매칭)
-- ============================================

DELETE FROM signals
WHERE id IN (
  SELECT n.id
  FROM signals n
  WHERE n.signal_time IS NULL
    AND n.symbol IS NOT NULL
    AND EXISTS (
      SELECT 1 FROM signals m
      WHERE m.symbol = n.symbol
        AND m.source = n.source
        AND m.signal_type = n.signal_type
        AND m.signal_time IS NOT NULL
        AND m.id != n.id
        AND ABS(EXTRACT(EPOCH FROM (n.timestamp - m.timestamp))) < 86400
    )
);
