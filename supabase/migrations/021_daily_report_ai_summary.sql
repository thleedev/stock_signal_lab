-- daily_report_summary에 AI 요약 컬럼 추가
ALTER TABLE daily_report_summary
  ADD COLUMN IF NOT EXISTS ai_summary TEXT;
