-- ============================================
-- 010: upsert를 위한 UNIQUE 제약조건 수정
-- PostgREST는 partial index를 on_conflict에서 인식하지 못함
-- 부분 인덱스 → 일반 UNIQUE 제약조건으로 변경
-- (NULL symbol은 PostgreSQL에서 서로 다른 값으로 취급되므로 충돌 없음)
-- ============================================

-- 기존 부분 인덱스 삭제
DROP INDEX IF EXISTS idx_signals_symbol_source_unique;

-- 일반 UNIQUE 제약조건 추가
ALTER TABLE signals
  ADD CONSTRAINT uq_signals_symbol_source UNIQUE (symbol, source);
