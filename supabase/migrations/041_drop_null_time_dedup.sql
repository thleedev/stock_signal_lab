-- ============================================
-- 041: signal_time IS NULL 중복 방지 constraint 제거
-- 문제: 같은 종목이 하루에 여러 번 다른 시간에 신호 발생 가능
--       signal_time=NULL 신호는 나중에 PATCH로 시간이 채워지므로
--       당일 기준 UNIQUE가 너무 강한 제약
-- 중복 방지는 signal_time이 채워진 후 idx_signals_dedup로 처리
-- ============================================

DROP INDEX IF EXISTS idx_signals_dedup_null_time;
