-- ============================================
-- 034: 같은 종목+소스+타입+신호시간 중복 INSERT 방지
-- 같은 종목이 다른 시간대에 매수 신호 오면 별도 행으로 저장
-- 같은 종목이 같은 시간에 동일 신호면 중복 차단
-- ============================================

CREATE UNIQUE INDEX IF NOT EXISTS idx_signals_dedup
  ON signals (symbol, source, signal_type, signal_time)
  WHERE symbol IS NOT NULL AND signal_time IS NOT NULL;
