-- HOLD(보유중) 신호 전체 삭제
-- 더 이상 수집하지 않으므로 기존 데이터도 정리
DELETE FROM signals WHERE signal_type = 'HOLD';
