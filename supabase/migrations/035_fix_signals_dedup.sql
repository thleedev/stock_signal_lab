-- ============================================
-- 035: PostgREST 호환을 위해 partial index 제거
-- 중복 방지는 앱 SentSignalCache에서 처리
-- DB에는 단순 INSERT만 수행
-- ============================================

DROP INDEX IF EXISTS idx_signals_dedup;
