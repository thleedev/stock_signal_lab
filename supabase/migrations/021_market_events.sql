-- 1. market_events 테이블
CREATE TABLE IF NOT EXISTS market_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_date DATE NOT NULL,
  event_type TEXT NOT NULL,
  event_category TEXT NOT NULL,
  title TEXT NOT NULL,
  description TEXT,
  country TEXT DEFAULT 'KR',
  impact_level INTEGER DEFAULT 1,
  risk_score NUMERIC(5,2) DEFAULT 0,
  source TEXT NOT NULL,
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(event_date, event_type, title)
);

CREATE INDEX IF NOT EXISTS idx_market_events_date ON market_events(event_date);
CREATE INDEX IF NOT EXISTS idx_market_events_category ON market_events(event_category);

-- updated_at 자동 갱신 트리거
CREATE OR REPLACE FUNCTION update_market_events_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_market_events_updated_at
  BEFORE UPDATE ON market_events
  FOR EACH ROW EXECUTE FUNCTION update_market_events_updated_at();

-- RLS
ALTER TABLE market_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY "market_events_read" ON market_events FOR SELECT USING (true);
CREATE POLICY "market_events_service_write" ON market_events FOR INSERT WITH CHECK (true);
CREATE POLICY "market_events_service_update" ON market_events FOR UPDATE USING (true);
CREATE POLICY "market_events_service_delete" ON market_events FOR DELETE USING (true);

-- 2. market_score_history 확장
ALTER TABLE market_score_history
  ADD COLUMN IF NOT EXISTS event_risk_score NUMERIC(5,2),
  ADD COLUMN IF NOT EXISTS combined_score NUMERIC(5,2);
