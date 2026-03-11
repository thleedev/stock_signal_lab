-- 수집기(Android)에서 Supabase 직접 INSERT 허용을 위한 RLS 정책
-- anon key로 signals, collector_heartbeats 테이블에 INSERT 가능하도록 설정

-- signals 테이블: INSERT 허용
ALTER TABLE signals ENABLE ROW LEVEL SECURITY;

CREATE POLICY "allow_anon_insert_signals"
  ON signals
  FOR INSERT
  TO anon
  WITH CHECK (true);

-- signals 테이블: SELECT 허용 (웹 대시보드용)
CREATE POLICY "allow_anon_select_signals"
  ON signals
  FOR SELECT
  TO anon
  USING (true);

-- collector_heartbeats 테이블: INSERT 허용
ALTER TABLE collector_heartbeats ENABLE ROW LEVEL SECURITY;

CREATE POLICY "allow_anon_insert_heartbeats"
  ON collector_heartbeats
  FOR INSERT
  TO anon
  WITH CHECK (true);

CREATE POLICY "allow_anon_select_heartbeats"
  ON collector_heartbeats
  FOR SELECT
  TO anon
  USING (true);

-- favorite_stocks 테이블: SELECT 허용 (웹에서 조회)
ALTER TABLE favorite_stocks ENABLE ROW LEVEL SECURITY;

CREATE POLICY "allow_anon_select_favorites"
  ON favorite_stocks
  FOR SELECT
  TO anon
  USING (true);

CREATE POLICY "allow_anon_insert_favorites"
  ON favorite_stocks
  FOR INSERT
  TO anon
  WITH CHECK (true);

CREATE POLICY "allow_anon_delete_favorites"
  ON favorite_stocks
  FOR DELETE
  TO anon
  USING (true);
