-- ============================================
-- 011: MMS 원문 저장 테이블
-- dailyReport 작성용, 7일 보관
-- 삭제는 INSERT 시 트리거로 처리
-- ============================================

CREATE TABLE mms_raw_messages (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at  TIMESTAMPTZ DEFAULT now(),
  sender      VARCHAR(20),
  source      VARCHAR(20),        -- lassi/stockbot/quant/unknown
  body        TEXT NOT NULL,
  device_id   VARCHAR(50)
);

CREATE INDEX idx_mms_raw_created ON mms_raw_messages(created_at);

-- RLS
ALTER TABLE mms_raw_messages ENABLE ROW LEVEL SECURITY;
CREATE POLICY "mms_raw_all" ON mms_raw_messages FOR ALL USING (true);

-- INSERT 시 7일 초과 데이터 자동 삭제 트리거
CREATE OR REPLACE FUNCTION trigger_cleanup_old_mms_raw()
RETURNS TRIGGER AS $$
BEGIN
  DELETE FROM mms_raw_messages WHERE created_at < now() - interval '7 days';
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_mms_raw_cleanup
  AFTER INSERT ON mms_raw_messages
  FOR EACH STATEMENT
  EXECUTE FUNCTION trigger_cleanup_old_mms_raw();
