-- stock_cache에 ROE 예상치(컨센서스) 컬럼 추가
ALTER TABLE stock_cache ADD COLUMN IF NOT EXISTS roe_estimated DOUBLE PRECISION;

COMMENT ON COLUMN stock_cache.roe_estimated IS '컨센서스 예상 ROE (%)';
