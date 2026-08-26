-- 083 보완: PUBLIC 의 EXECUTE 회수
--
-- 083 에서 anon / authenticated 의 명시적 EXECUTE 를 회수했지만 advisor 경고가 남았다.
-- PostgreSQL 은 함수 생성 시 PUBLIC 에 EXECUTE 를 기본 부여하고(proacl 의 `=X/postgres`),
-- anon / authenticated 는 PUBLIC 의 멤버라 개별 GRANT 만 빼도 여전히 호출된다.
--
-- PUBLIC 을 회수하면 명시적으로 GRANT 된 롤만 남는다.
--   upsert_signals_bulk: anon(Android 수집기) + service_role 유지, authenticated 차단
--   나머지 둘: service_role 만 유지

REVOKE EXECUTE ON FUNCTION public.refresh_high_90d_pct() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.update_stock_cache_signal_price() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.upsert_signals_bulk(jsonb) FROM PUBLIC;
