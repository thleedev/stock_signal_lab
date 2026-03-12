CREATE TABLE IF NOT EXISTS ai_recommendations (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  date                DATE NOT NULL,
  symbol              VARCHAR(10) NOT NULL,
  name                VARCHAR(100),
  rank                INT NOT NULL,
  total_score         NUMERIC(5,1) NOT NULL,

  -- 가중치 (재계산 시 사용한 값 저장)
  weight_signal       INT NOT NULL DEFAULT 30,
  weight_technical    INT NOT NULL DEFAULT 30,
  weight_valuation    INT NOT NULL DEFAULT 20,
  weight_supply       INT NOT NULL DEFAULT 20,

  -- 항목별 점수 (가중치 적용 전 원점수)
  signal_score        NUMERIC(4,1),
  technical_score     NUMERIC(4,1),
  valuation_score     NUMERIC(4,1),
  supply_score        NUMERIC(4,1),

  -- 기술적 지표 상세
  signal_count        INT,
  rsi                 NUMERIC(5,2),
  macd_cross          BOOLEAN DEFAULT FALSE,
  golden_cross        BOOLEAN DEFAULT FALSE,
  bollinger_bottom    BOOLEAN DEFAULT FALSE,
  phoenix_pattern     BOOLEAN DEFAULT FALSE,
  double_top          BOOLEAN DEFAULT FALSE,
  volume_surge        BOOLEAN DEFAULT FALSE,
  week52_low_near     BOOLEAN DEFAULT FALSE,

  -- 밸류에이션
  per                 NUMERIC(8,2),
  pbr                 NUMERIC(8,2),
  roe                 NUMERIC(8,2),

  -- 수급
  foreign_buying      BOOLEAN DEFAULT FALSE,
  institution_buying  BOOLEAN DEFAULT FALSE,
  volume_vs_sector    BOOLEAN DEFAULT FALSE,

  -- 메타
  total_candidates    INT,
  created_at          TIMESTAMPTZ DEFAULT NOW(),

  UNIQUE(date, symbol)
);

CREATE INDEX IF NOT EXISTS idx_ai_recommendations_date
  ON ai_recommendations(date DESC);
