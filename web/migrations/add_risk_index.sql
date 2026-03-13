-- market_score_history 테이블에 risk_index 컬럼 추가
-- DEFAULT NULL: 기존 레코드 하위 호환, 이전 히스토리는 null로 표시
ALTER TABLE market_score_history
  ADD COLUMN IF NOT EXISTS risk_index NUMERIC DEFAULT NULL;
