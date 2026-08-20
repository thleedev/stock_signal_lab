-- 시황 단계 2 — 판정 결과와 백테스트 결과 저장 (설계 §4.3, §8.4)
--
-- market_verdict: 배치가 shared/market/verdict.ts 의 RiskVerdict 를 모드별로
--   저장한다. kind 별 행을 남겨 아침 확정 판단과 장중 보정을 함께 보여준다.
-- market_backtest_run / market_backtest_result: scripts/backtest-market.ts 가
--   하락 국면 정답지 대비 적중률·선행일수·오경보율을 저장한다. 화면(단계 3)이
--   최신 run 을 읽어 "과거 적중 N/M 국면"을 표시한다.

CREATE TABLE IF NOT EXISTS market_verdict (
  date DATE NOT NULL,
  kind VARCHAR(10) NOT NULL CHECK (kind IN ('open', 'intraday', 'close')),
  status VARCHAR(12) NOT NULL CHECK (status IN ('ok', 'insufficient')),
  score NUMERIC(6,2),
  action VARCHAR(10) CHECK (action IN ('enter', 'hold', 'reduce')),
  coverage NUMERIC(5,4) NOT NULL,
  contributions JSONB,
  missing JSONB,
  as_of TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now(),
  PRIMARY KEY (date, kind)
);

COMMENT ON TABLE market_verdict IS '시황 위험 판정 결과. shared/market/verdict.ts RiskVerdict 를 배치 모드별로 저장';
COMMENT ON COLUMN market_verdict.score IS 'status=insufficient 이면 NULL — 결손을 점수 0 으로 은폐하지 않는다';

ALTER TABLE market_verdict ENABLE ROW LEVEL SECURITY;
CREATE POLICY "market_verdict_all" ON market_verdict FOR ALL USING (true);

CREATE TABLE IF NOT EXISTS market_backtest_run (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  run_at TIMESTAMPTZ DEFAULT now(),
  warn_threshold NUMERIC(5,2) NOT NULL,
  train_hit_rate NUMERIC(5,4),
  valid_hit_rate NUMERIC(5,4),
  median_lead_days INTEGER,
  false_alarm_rate NUMERIC(5,4),
  scored_days INTEGER,
  params JSONB
);

COMMENT ON TABLE market_backtest_run IS '백테스트 실행 요약. 학습(2015~2022 고점)·검증(2023~) 분리 지표 포함';

CREATE TABLE IF NOT EXISTS market_backtest_result (
  run_id BIGINT NOT NULL REFERENCES market_backtest_run(id) ON DELETE CASCADE,
  regime VARCHAR(30) NOT NULL,
  peak_date DATE NOT NULL,
  trough_date DATE NOT NULL,
  breach_date DATE,
  warned BOOLEAN NOT NULL,
  first_warn_date DATE,
  lead_days INTEGER,
  PRIMARY KEY (run_id, regime)
);

COMMENT ON COLUMN market_backtest_result.breach_date IS '고점 대비 -10% 최초 이탈일. NULL 이면 이탈 없음(국면 부적격)';
COMMENT ON COLUMN market_backtest_result.lead_days IS '경고일 → 이탈일 거래일 간격';

ALTER TABLE market_backtest_run ENABLE ROW LEVEL SECURITY;
CREATE POLICY "market_backtest_run_all" ON market_backtest_run FOR ALL USING (true);
ALTER TABLE market_backtest_result ENABLE ROW LEVEL SECURITY;
CREATE POLICY "market_backtest_result_all" ON market_backtest_result FOR ALL USING (true);
