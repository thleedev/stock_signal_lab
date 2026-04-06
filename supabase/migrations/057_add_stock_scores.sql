-- 057_add_stock_scores.sql
-- GHA 배치에서 계산한 축별 점수 저장
-- 클라이언트는 이 테이블에서 SELECT + 가중치 합산만 수행

CREATE TABLE IF NOT EXISTS stock_scores (
  symbol          VARCHAR(10)   NOT NULL REFERENCES stock_cache(symbol) ON DELETE CASCADE,
  scored_at       DATE          NOT NULL,
  prev_close      NUMERIC,
  score_value     NUMERIC       DEFAULT 0,
  score_growth    NUMERIC       DEFAULT 0,
  score_supply    NUMERIC       DEFAULT 0,
  score_momentum  NUMERIC       DEFAULT 0,
  score_risk      NUMERIC       DEFAULT 0,
  score_signal    NUMERIC       DEFAULT 0,
  updated_at      TIMESTAMPTZ   DEFAULT NOW(),
  PRIMARY KEY (symbol)
);

CREATE INDEX IF NOT EXISTS stock_scores_scored_at_idx ON stock_scores(scored_at);
CREATE INDEX IF NOT EXISTS stock_scores_value_idx ON stock_scores(score_value DESC);
CREATE INDEX IF NOT EXISTS stock_scores_momentum_idx ON stock_scores(score_momentum DESC);

ALTER TABLE stock_scores ENABLE ROW LEVEL SECURITY;

CREATE POLICY "stock_scores_read" ON stock_scores
  FOR SELECT USING (true);

CREATE POLICY "stock_scores_service_write" ON stock_scores
  FOR ALL USING (auth.role() = 'service_role');

COMMENT ON TABLE stock_scores IS 'GHA 배치가 매일 16:10 KST 이후 계산하는 축별 점수. 클라이언트는 읽기만.';
COMMENT ON COLUMN stock_scores.prev_close IS '전일 종가 — stock_cache.current_price와 비교해 모멘텀 실시간 보정에 사용';
COMMENT ON COLUMN stock_scores.score_risk IS '높을수록 리스크 큼 (감점 방향으로 사용)';
