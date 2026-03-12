-- 일간 리포트에 투자자 매매동향 저장 컬럼 추가
ALTER TABLE daily_report_summary
  ADD COLUMN IF NOT EXISTS investor_trends jsonb DEFAULT NULL;

COMMENT ON COLUMN daily_report_summary.investor_trends IS '투자자별 매매동향 (외국인/기관/개인) - KOSPI, KOSDAQ';
