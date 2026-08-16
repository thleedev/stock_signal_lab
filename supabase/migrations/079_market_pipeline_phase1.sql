-- 시황 파이프라인 정상화 (단계 1)
--
-- 1) market_indicators 에 출처·수집시각 추가
--    지금까지 어느 소스에서 온 값인지 사후 판별할 단서가 없었다.
-- 2) 코스피 일별 수급 테이블 신설
--    기존 step2 는 종목별 최근 5영업일 스냅숏을 덮어써 일별 이력이 남지 않는다.
-- 3) 지표 롤링 통계 테이블 신설
--    252일 분위수·52주 고점을 매 요청 계산하다 PostgREST 1000행 상한에 잘려
--    실제로는 약 70~90일 창으로 산출되던 문제를 배치 선계산으로 옮긴다.

ALTER TABLE market_indicators
  ADD COLUMN IF NOT EXISTS source VARCHAR(20),
  ADD COLUMN IF NOT EXISTS collected_at TIMESTAMPTZ;

COMMENT ON COLUMN market_indicators.source IS '수집 소스: fred | yahoo | naver | derived | backfill';
COMMENT ON COLUMN market_indicators.collected_at IS '수집 시각. date 는 관측일이라 둘이 다를 수 있다';

CREATE INDEX IF NOT EXISTS idx_market_indicators_type_date
  ON market_indicators (indicator_type, date DESC);

-- 코스피 전체 일별 투자자 순매수 (억원)
CREATE TABLE IF NOT EXISTS market_investor_daily (
  date DATE PRIMARY KEY,
  individual_net NUMERIC(14,2),
  foreign_net NUMERIC(14,2),
  institution_net NUMERIC(14,2),
  collected_at TIMESTAMPTZ DEFAULT now()
);

COMMENT ON TABLE market_investor_daily IS '코스피 전체 일별 투자자별 순매수, 단위 억원. 네이버 investorDealTrendDay 수집';

ALTER TABLE market_investor_daily ENABLE ROW LEVEL SECURITY;
CREATE POLICY "market_investor_daily_all" ON market_investor_daily FOR ALL USING (true);

-- 지표 롤링 통계 (배치 선계산)
CREATE TABLE IF NOT EXISTS market_indicator_stats (
  indicator_key VARCHAR(30) NOT NULL,
  as_of DATE NOT NULL,
  high_52w NUMERIC(15,4),
  low_52w NUMERIC(15,4),
  ma_200d NUMERIC(15,4),
  ma_20d NUMERIC(15,4),
  pct_rank_252d NUMERIC(6,4),
  stddev_20d NUMERIC(15,6),
  sample_days INTEGER NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT now(),
  PRIMARY KEY (indicator_key, as_of)
);

COMMENT ON COLUMN market_indicator_stats.sample_days IS '실제 계산에 쓰인 관측일 수. 기대보다 짧으면 조회가 절단된 것이다';

ALTER TABLE market_indicator_stats ENABLE ROW LEVEL SECURITY;
CREATE POLICY "market_indicator_stats_all" ON market_indicator_stats FOR ALL USING (true);

-- KR_3Y 는 배치가 ^IRX(미국 13주 T-bill), 실시간이 122630.KS(KODEX 레버리지 ETF)
-- 두 자산을 같은 키에 번갈아 넣어 왔다. 구분이 불가능하므로 전량 삭제한다.
DELETE FROM market_indicators WHERE indicator_type = 'KR_3Y';

-- FEAR_GREED 는 배치가 CNN 값, 실시간이 VIX 역산값을 같은 키에 넣었다.
-- CNN 소스가 HTTP 418 로 차단되어 재수집도 불가하므로 삭제한다.
DELETE FROM market_indicators WHERE indicator_type = 'FEAR_GREED';

-- KORU 는 RISK_THRESHOLDS 에 정의가 없어 판정되지 않았고 EWY 와 중복이다.
DELETE FROM market_indicators WHERE indicator_type = 'KORU';
