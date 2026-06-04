-- 오늘(KST 2026-05-06) 라씨 SELL 신호 삭제
-- 안드로이드 컬렉터가 잘못 수집한 매도 항목을 정리하여 재수집 가능하도록 함
DELETE FROM signals
WHERE source = 'lassi'
  AND signal_type = 'SELL'
  AND timestamp >= '2026-05-05 15:00:00+00'  -- 2026-05-06 00:00 KST
  AND timestamp <  '2026-05-06 15:00:00+00'; -- 2026-05-07 00:00 KST
