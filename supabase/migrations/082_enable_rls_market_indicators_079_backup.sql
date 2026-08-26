-- market_indicators_079_backup 에 RLS 활성화
--
-- 079 적용 전 수동으로 만든 임시 백업 테이블이다. public 스키마에 있어
-- PostgREST 로 노출되는데 RLS 가 없어 anon 키로 읽힌다.
-- 정책은 만들지 않는다. 서비스 롤은 RLS 를 우회하므로 배치·API 는 영향받지 않고,
-- anon / authenticated 는 모두 차단된다.
--
-- 보관 중인 데이터: KR_3Y 156행, KORU 157행, FEAR_GREED 1행 (2025-12-30 ~ 2026-08-19)
-- 이 중 KORU / FEAR_GREED 는 원본 market_indicators 에서 삭제되어 여기에만 남아 있다.

ALTER TABLE public.market_indicators_079_backup ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE public.market_indicators_079_backup IS
  '079 마이그레이션 적용 전 임시 백업. RLS 활성화·정책 없음(서비스 롤 전용). 불필요해지면 DROP.';
