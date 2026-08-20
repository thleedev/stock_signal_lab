-- 080_batch_mode_comment.sql
-- batch_runs.mode 코멘트 갱신: 개장 전·장중·마감 후 배치 3분할(market-open/
-- market-intraday/market-close)이 추가되어 기존 full/repair/prices-only 세
-- 모드만 적던 058 코멘트가 실제와 어긋난다. 이미 적용된 058 파일은 이력이
-- 어긋나므로 직접 고치지 않고 COMMENT ON COLUMN 으로 갱신한다.
COMMENT ON COLUMN batch_runs.mode IS 'full=전체배치, repair=누락보정, prices-only=현재가만, market-open=개장전 시황, market-intraday=장중 시황, market-close=마감후 시황';
