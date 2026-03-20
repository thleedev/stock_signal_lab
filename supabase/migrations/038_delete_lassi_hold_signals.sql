-- 라씨 신호 중 HOLD 타입 데이터 삭제
-- HOLD 신호는 불필요한 데이터이므로 정리
DELETE FROM signals
WHERE source = 'lassi'
  AND signal_type = 'HOLD';
