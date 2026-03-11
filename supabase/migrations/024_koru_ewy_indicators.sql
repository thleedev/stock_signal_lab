-- KORU, EWY 한국 관련 미국 ETF 지표 추가
INSERT INTO indicator_weights (indicator_type, weight, direction, label, description) VALUES
  ('KORU', 2.0, 1, 'KORU (한국 3X)', 'Direxion 한국 3배 레버리지 ETF → 한국 시장 심리 반영'),
  ('EWY', 2.0, 1, 'EWY (한국 ETF)', 'iShares MSCI 한국 ETF → 외국인 한국 투자 심리')
ON CONFLICT (indicator_type) DO NOTHING;
