-- 060: stock_scores 테이블에 카테고리별 체크리스트 충족/전체 조건 수 컬럼 추가
-- step4-scoring 크론이 calcCompositeScore 실행 시 각 서브모듈의 reasons 배열에서
-- met=true 개수(pass)와 전체 개수(total)를 추출하여 저장한다.
-- 이 데이터는 종목 랭킹 행에 "N/M" 형태로 표시하기 위한 것이다.

ALTER TABLE stock_scores
  ADD COLUMN IF NOT EXISTS checklist_tech_pass   SMALLINT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS checklist_tech_total  SMALLINT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS checklist_sup_pass    SMALLINT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS checklist_sup_total   SMALLINT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS checklist_val_pass    SMALLINT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS checklist_val_total   SMALLINT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS checklist_sig_pass    SMALLINT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS checklist_sig_total   SMALLINT NOT NULL DEFAULT 0;
