-- 054_snapshot_sessions.sql
-- 스냅샷 세션 메타 테이블 + stock_ranking_snapshot FK 연결

-- 1. snapshot_sessions 테이블 생성
CREATE TABLE IF NOT EXISTS snapshot_sessions (
  id            BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  session_date  DATE NOT NULL,
  session_time  TIMESTAMPTZ NOT NULL,
  model         TEXT NOT NULL,
  trigger_type  TEXT NOT NULL DEFAULT 'cron',
  total_count   INT,
  created_at    TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_snapshot_sessions_date_model
  ON snapshot_sessions (session_date, model);

-- 2. stock_ranking_snapshot에 session_id FK 추가
ALTER TABLE stock_ranking_snapshot
  ADD COLUMN IF NOT EXISTS session_id BIGINT REFERENCES snapshot_sessions(id);

CREATE INDEX IF NOT EXISTS idx_snapshot_session_id
  ON stock_ranking_snapshot (session_id);

-- 3. 기존 데이터 마이그레이션: (snapshot_date, model) 그룹별로 세션 생성
INSERT INTO snapshot_sessions (session_date, session_time, model, trigger_type, total_count)
SELECT
  snapshot_date,
  MAX(snapshot_time) AS session_time,
  model,
  'cron' AS trigger_type,
  COUNT(*) AS total_count
FROM stock_ranking_snapshot
GROUP BY snapshot_date, model;

-- 4. 기존 행들에 session_id 할당
UPDATE stock_ranking_snapshot srs
SET session_id = ss.id
FROM snapshot_sessions ss
WHERE srs.snapshot_date = ss.session_date
  AND srs.model = ss.model
  AND srs.session_id IS NULL;

-- 5. 유니크 제약 변경: 기존 제약 삭제 후 새 제약 추가
ALTER TABLE stock_ranking_snapshot
  DROP CONSTRAINT IF EXISTS stock_ranking_snapshot_snapshot_date_model_symbol_key;

ALTER TABLE stock_ranking_snapshot
  ADD CONSTRAINT stock_ranking_snapshot_session_id_symbol_key
  UNIQUE (session_id, symbol);

-- 6. RLS 정책 (기존 패턴 따름)
ALTER TABLE snapshot_sessions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "snapshot_sessions_select" ON snapshot_sessions
  FOR SELECT USING (true);
CREATE POLICY "snapshot_sessions_insert" ON snapshot_sessions
  FOR INSERT WITH CHECK (true);
