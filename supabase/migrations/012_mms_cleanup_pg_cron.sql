-- ============================================
-- 012: MMS 7일 자동 삭제를 pg_cron으로 전환
-- 기존 INSERT 트리거 제거 → pg_cron 매일 새벽 3시(KST) 실행
-- ============================================

-- 기존 트리거 제거
DROP TRIGGER IF EXISTS trg_mms_raw_cleanup ON mms_raw_messages;
DROP FUNCTION IF EXISTS trigger_cleanup_old_mms_raw();

-- pg_cron: 매일 UTC 18시 (KST 03시)에 7일 초과 데이터 삭제
SELECT cron.schedule(
  'cleanup-mms-raw-7days',
  '0 18 * * *',
  $$DELETE FROM mms_raw_messages WHERE created_at < now() - interval '7 days'$$
);
