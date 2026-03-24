-- 투자자 매매동향 5일 누적 + 연속성 컬럼 추가
ALTER TABLE stock_cache
  ADD COLUMN IF NOT EXISTS foreign_net_5d bigint DEFAULT 0,
  ADD COLUMN IF NOT EXISTS institution_net_5d bigint DEFAULT 0,
  ADD COLUMN IF NOT EXISTS foreign_streak smallint DEFAULT 0,
  ADD COLUMN IF NOT EXISTS institution_streak smallint DEFAULT 0;

COMMENT ON COLUMN stock_cache.foreign_net_5d IS '외국인 최근 5일 누적 순매수량';
COMMENT ON COLUMN stock_cache.institution_net_5d IS '기관 최근 5일 누적 순매수량';
COMMENT ON COLUMN stock_cache.foreign_streak IS '외국인 연속 순매수 일수 (음수=연속 순매도)';
COMMENT ON COLUMN stock_cache.institution_streak IS '기관 연속 순매수 일수 (음수=연속 순매도)';
