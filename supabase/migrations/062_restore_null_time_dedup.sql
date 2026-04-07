-- ============================================
-- 062: signal_time IS NULL 중복 방지 인덱스 복원
-- 문제: 041에서 idx_signals_dedup_null_time을 제거한 후
--       같은 종목이 당일 여러 번 스크래핑될 때 중복 삽입 방지 수단 없음
-- 해결: (symbol, source, signal_type, 당일KST) UNIQUE 인덱스 재생성
--       → 같은 종목/방향은 하루에 한 행만 signal_time=NULL로 존재 가능
--       → 5PM 보정 후 signal_time이 채워지면 idx_signals_dedup로 넘어감
-- ============================================

-- 기존 중복 데이터 정리 (인덱스 생성 전 필수)
DELETE FROM signals
WHERE id IN (
  SELECT id FROM (
    SELECT id,
           ROW_NUMBER() OVER (
             PARTITION BY symbol, source, signal_type, signal_date_kst(timestamp)
             ORDER BY created_at ASC
           ) AS rn
    FROM signals
    WHERE symbol IS NOT NULL
      AND signal_time IS NULL
  ) ranked
  WHERE rn > 1
);

-- UNIQUE 인덱스 재생성
-- signal_date_kst()는 040에서 IMMUTABLE로 생성된 함수
CREATE UNIQUE INDEX IF NOT EXISTS idx_signals_dedup_null_time
  ON signals (symbol, source, signal_type, signal_date_kst(timestamp))
  WHERE symbol IS NOT NULL AND signal_time IS NULL;
