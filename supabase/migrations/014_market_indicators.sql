-- 시황 지표 데이터
CREATE TABLE IF NOT EXISTS market_indicators (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  date DATE NOT NULL,
  indicator_type VARCHAR(30) NOT NULL,
  value NUMERIC(15,4) NOT NULL,
  prev_value NUMERIC(15,4),
  change_pct NUMERIC(8,4),
  raw_data JSONB,
  UNIQUE(date, indicator_type)
);

-- 시황 지표 가중치 설정
CREATE TABLE IF NOT EXISTS indicator_weights (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  indicator_type VARCHAR(30) NOT NULL UNIQUE,
  weight NUMERIC(5,2) NOT NULL DEFAULT 1.0,
  direction INTEGER NOT NULL DEFAULT -1,
  label VARCHAR(50) NOT NULL,
  description TEXT,
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- 기본 가중치 데이터 삽입
INSERT INTO indicator_weights (indicator_type, weight, direction, label, description) VALUES
  ('VIX', 3.0, -1, 'VIX 변동성', '높을수록 공포 → 부정적'),
  ('USD_KRW', 2.0, -1, 'USD/KRW 환율', '원화 약세 → 외국인 자금 유출'),
  ('US_10Y', 2.0, -1, '미국 10년물 금리', '고금리 → 주식 매력도 하락'),
  ('WTI', 1.5, -1, 'WTI 유가', '유가 급등 → 인플레 우려'),
  ('KOSPI', 2.5, 1, 'KOSPI 지수', '상승 → 시장 긍정'),
  ('KOSDAQ', 2.0, 1, 'KOSDAQ 지수', '상승 → 성장주 긍정'),
  ('GOLD', 1.0, -1, '금 가격', '금 급등 → 안전자산 선호'),
  ('DXY', 1.5, -1, '달러 인덱스', '달러 강세 → EM 자금 유출'),
  ('KR_3Y', 1.5, -1, '한국 3년물 금리', '국내 금리 상승 → 유동성 축소'),
  ('FEAR_GREED', 2.0, 1, '공포탐욕 지수', 'CNN 스타일, 높을수록 탐욕')
ON CONFLICT (indicator_type) DO NOTHING;
