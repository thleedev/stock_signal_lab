-- ============================================
-- 009: signals 테이블 upsert 지원
-- 같은 종목(symbol) + 소스(source)면 상태/시간/가격만 업데이트
-- ============================================

-- 기존 중복 데이터 정리 (가장 최신 것만 남기기)
DELETE FROM signals a
USING signals b
WHERE a.symbol IS NOT NULL
  AND a.symbol = b.symbol
  AND a.source = b.source
  AND a.created_at < b.created_at;

-- unique constraint 추가 (symbol + source 조합)
-- symbol이 NULL인 경우는 제외 (부분 인덱스)
CREATE UNIQUE INDEX idx_signals_symbol_source_unique
  ON signals (symbol, source)
  WHERE symbol IS NOT NULL;
