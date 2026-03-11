-- ============================================
-- 007: 알림 & 시스템
-- ============================================

CREATE TABLE fcm_tokens (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  token         TEXT NOT NULL UNIQUE,
  platform      VARCHAR(10),
  created_at    TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE notification_rules (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  conditions    JSONB NOT NULL,
  active        BOOLEAN DEFAULT true,
  created_at    TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE collector_heartbeats (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  device_id     VARCHAR(50) NOT NULL,
  timestamp     TIMESTAMPTZ DEFAULT now(),
  status        VARCHAR(20),
  last_signal   TIMESTAMPTZ,
  error_message TEXT
);

ALTER TABLE fcm_tokens ENABLE ROW LEVEL SECURITY;
ALTER TABLE notification_rules ENABLE ROW LEVEL SECURITY;
ALTER TABLE collector_heartbeats ENABLE ROW LEVEL SECURITY;

CREATE POLICY "fcm_tokens_all" ON fcm_tokens FOR ALL USING (true);
CREATE POLICY "notification_rules_all" ON notification_rules FOR ALL USING (true);
CREATE POLICY "collector_heartbeats_all" ON collector_heartbeats FOR ALL USING (true);
