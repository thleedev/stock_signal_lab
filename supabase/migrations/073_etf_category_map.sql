-- 073: ETF 카테고리/섹터 매핑 테이블
-- ETF 신호 기반 시장 센티먼트 분류 보정용 (정규식 fallback 보다 우선 적용)

CREATE TABLE IF NOT EXISTS etf_category_map (
  symbol TEXT PRIMARY KEY,
  sector TEXT NOT NULL,
  side TEXT CHECK (side IN ('bull', 'bear')),
  excluded BOOLEAN NOT NULL DEFAULT FALSE,
  note TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE OR REPLACE FUNCTION update_etf_category_map_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_etf_category_map_updated_at ON etf_category_map;
CREATE TRIGGER trg_etf_category_map_updated_at
  BEFORE UPDATE ON etf_category_map
  FOR EACH ROW EXECUTE FUNCTION update_etf_category_map_updated_at();

ALTER TABLE etf_category_map ENABLE ROW LEVEL SECURITY;
CREATE POLICY "etf_category_map_read" ON etf_category_map FOR SELECT USING (true);
CREATE POLICY "etf_category_map_service_write" ON etf_category_map FOR INSERT WITH CHECK (true);
CREATE POLICY "etf_category_map_service_update" ON etf_category_map FOR UPDATE USING (true);
CREATE POLICY "etf_category_map_service_delete" ON etf_category_map FOR DELETE USING (true);
