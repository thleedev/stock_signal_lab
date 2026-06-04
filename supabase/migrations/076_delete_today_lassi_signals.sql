-- 오늘(KST 2026-05-19) 안드로이드 컬렉터가 잘못 수집한 lassi 신호 전체 삭제
DELETE FROM signals
WHERE source = 'lassi'
  AND timestamp >= '2026-05-18 15:00:00+00'  -- 2026-05-19 00:00 KST
  AND timestamp <  '2026-05-19 15:00:00+00'; -- 2026-05-20 00:00 KST
