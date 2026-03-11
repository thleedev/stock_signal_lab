-- ============================================
-- 013: fcm_tokens 테이블에 device_id 컬럼 추가
-- ============================================

ALTER TABLE fcm_tokens ADD COLUMN IF NOT EXISTS device_id VARCHAR(100);
CREATE UNIQUE INDEX IF NOT EXISTS fcm_tokens_device_id_idx ON fcm_tokens (device_id);
