-- 058_add_batch_runs.sql
CREATE TABLE IF NOT EXISTS batch_runs (
  id            UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  workflow      TEXT          NOT NULL DEFAULT 'daily-batch',
  mode          TEXT          NOT NULL DEFAULT 'full',
  status        TEXT          NOT NULL DEFAULT 'pending',
  triggered_by  TEXT          NOT NULL DEFAULT 'schedule',
  started_at    TIMESTAMPTZ   DEFAULT NOW(),
  finished_at   TIMESTAMPTZ,
  summary       JSONB,
  created_at    TIMESTAMPTZ   DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS batch_runs_started_at_idx ON batch_runs(started_at DESC);
CREATE INDEX IF NOT EXISTS batch_runs_status_idx ON batch_runs(status);

ALTER TABLE batch_runs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "batch_runs_read" ON batch_runs
  FOR SELECT USING (true);

CREATE POLICY "batch_runs_service_write" ON batch_runs
  FOR ALL USING (auth.role() = 'service_role');

ALTER PUBLICATION supabase_realtime ADD TABLE batch_runs;

COMMENT ON TABLE batch_runs IS 'GHA 배치 실행 이력. Supabase Realtime으로 프론트엔드가 완료 감지.';
COMMENT ON COLUMN batch_runs.mode IS 'full=전체배치, repair=누락보정, prices-only=현재가만';
COMMENT ON COLUMN batch_runs.summary IS '{ collected: 수집건수, scored: 점수계산건수, errors: [에러메시지] }';
