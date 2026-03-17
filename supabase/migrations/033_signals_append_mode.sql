-- ============================================
-- 033: signals 테이블을 append 모드로 전환
-- - UPSERT용 unique constraint 제거
-- - signal_time, signal_price 컬럼 추가
-- - 매수/매도 쌍 추적 및 수익률 산출 지원
-- ============================================

-- 1. UPSERT용 unique constraint 제거 (이제 모든 신호를 이력으로 쌓음)
ALTER TABLE signals
  DROP CONSTRAINT IF EXISTS uq_signals_symbol_source;

-- 2. 실제 신호 발생 시간 컬럼 추가 (화면의 timeGroup에서 역산)
ALTER TABLE signals
  ADD COLUMN IF NOT EXISTS signal_time TIMESTAMPTZ;

-- 3. 신호 가격 컬럼 추가 (기존에는 raw_data JSONB 안에만 있었음)
ALTER TABLE signals
  ADD COLUMN IF NOT EXISTS signal_price INTEGER;

-- 4. 매수/매도 쌍 조회 최적화 인덱스
CREATE INDEX IF NOT EXISTS idx_signals_symbol_signal_time
  ON signals (symbol, signal_time DESC)
  WHERE symbol IS NOT NULL;

-- 5. 소스+타입별 조회 인덱스
CREATE INDEX IF NOT EXISTS idx_signals_source_type_time
  ON signals (source, signal_type, signal_time DESC);
