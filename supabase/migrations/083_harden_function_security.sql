-- 함수 보안 경고 정리 (Supabase security advisor WARN)
--
-- 1) SECURITY DEFINER 함수의 불필요한 EXECUTE 권한 회수
-- 2) 함수 6개의 search_path 고정
--
-- upsert_signals_bulk 의 anon 권한은 유지한다.
--   Android 수집기(SignalApiClient.kt)가 anon 키로 /rest/v1/rpc/upsert_signals_bulk 를
--   직접 호출한다. 회수하면 SMS 신호 수집이 끊긴다.
--   authenticated 는 auth.users 가 0명이라 회수한다.
--   주의: 063 이 이 함수를 CREATE OR REPLACE 하면서 anon·authenticated 에 GRANT 를
--   다시 준다. 085 는 이 마이그레이션 이후 상태에 맞춰 정정했다.
--   앞으로 재정의할 때도 authenticated GRANT 를 빼고, search_path 를 다시 걸어야 한다.

-- 1) EXECUTE 권한 회수
REVOKE EXECUTE ON FUNCTION public.refresh_high_90d_pct() FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.update_stock_cache_signal_price() FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.upsert_signals_bulk(jsonb) FROM authenticated;

-- 2) search_path 고정
--    SECURITY DEFINER 함수는 호출자의 search_path 를 따라가면 동명 객체로 우회당할 수 있다.
--    함수 본문은 그대로라 인덱스·트리거 재생성은 필요 없다.
ALTER FUNCTION public.signal_date_kst(timestamptz)          SET search_path = public, pg_temp;
ALTER FUNCTION public.upsert_signals_bulk(jsonb)            SET search_path = public, pg_temp;
ALTER FUNCTION public.refresh_high_90d_pct()                SET search_path = public, pg_temp;
ALTER FUNCTION public.fn_sync_signal_to_cache()             SET search_path = public, pg_temp;
ALTER FUNCTION public.update_market_events_updated_at()     SET search_path = public, pg_temp;
ALTER FUNCTION public.update_etf_category_map_updated_at()  SET search_path = public, pg_temp;
