-- RLS 정책 재설계 — USING (true) 전면 정리
--
-- 문제
--   public 스키마 60개 정책 중 49개가 FOR ALL ... USING (true) 였습니다.
--   여기에 default ACL 이 새 테이블마다 anon·authenticated 에 전권(arwdDxtm)을
--   자동 부여하고 있어, anon 키만으로 44개 테이블 전체를 읽고 쓰고 지울 수 있었습니다.
--   anon 키는 브라우저 번들과 Android APK 에 들어 있습니다.
--   (supabase security advisor: rls_policy_always_true 49건)
--
-- anon 이 실제로 쓰는 경로는 5개뿐입니다.
--   web/src/hooks/use-global-price-refresh.ts:52  stock_cache SELECT
--   SignalApiClient.kt:127                        mms_raw_messages INSERT
--   SignalApiClient.kt:208                        collector_heartbeats INSERT
--   SignalApiClient.kt:296,322                    alphacatch_holdings DELETE, INSERT
--   SignalApiClient.kt:95                         rpc/upsert_signals_bulk
--
--   RPC 는 SECURITY DEFINER 이고 함수·signals 소유자가 모두 postgres 이며
--   signals 에 FORCE ROW LEVEL SECURITY 가 걸려 있지 않습니다. 소유자는 RLS 를
--   우회하므로 anon 의 signals 권한을 모두 회수해도 수집이 계속 동작합니다.
--
--   서버 API 라우트와 GitHub Actions 배치는 service_role 키를 쓰고, service_role 은
--   RLS 를 우회합니다. 정책을 지워도 영향이 없습니다.
--
-- 남는 경고
--   anon 쓰기 4건(mms·heartbeat·alphacatch 2)은 WITH CHECK (true) 가 불가피합니다.
--   인증이 없어 행을 제한할 근거가 없습니다. 없애려면 수집기가 서버 API 를 경유하도록
--   바꾸고 앱을 재배포해야 합니다.

-- ── 1) 기존 정책 전부 삭제
DO $$
DECLARE r RECORD; n int := 0;
BEGIN
  FOR r IN SELECT schemaname, tablename, policyname FROM pg_policies WHERE schemaname = 'public'
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON %I.%I', r.policyname, r.schemaname, r.tablename);
    n := n + 1;
  END LOOP;
  RAISE NOTICE '삭제한 정책 %개', n;
END $$;

-- ── 2) anon 이 실제로 쓰는 경로만 정책으로 남깁니다.
--      정책이 없는 테이블은 RLS 가 켜져 있어 service_role 만 접근합니다.
CREATE POLICY stock_cache_anon_read ON public.stock_cache
  FOR SELECT TO anon USING (true);

CREATE POLICY mms_raw_messages_anon_insert ON public.mms_raw_messages
  FOR INSERT TO anon WITH CHECK (true);

CREATE POLICY collector_heartbeats_anon_insert ON public.collector_heartbeats
  FOR INSERT TO anon WITH CHECK (true);

-- 수집기가 매 수집마다 전량을 지우고 다시 넣습니다 (DELETE ?symbol=neq.__none__ → POST).
CREATE POLICY alphacatch_holdings_anon_delete ON public.alphacatch_holdings
  FOR DELETE TO anon USING (true);

CREATE POLICY alphacatch_holdings_anon_insert ON public.alphacatch_holdings
  FOR INSERT TO anon WITH CHECK (true);

-- ── 3) 테이블 권한도 같은 범위로 좁힙니다.
--      정책과 GRANT 는 AND 조건이라 둘 다 막아 두는 편이 안전합니다.
REVOKE ALL ON ALL TABLES IN SCHEMA public FROM anon, authenticated;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM anon, authenticated;

GRANT SELECT          ON public.stock_cache          TO anon;
GRANT INSERT          ON public.mms_raw_messages     TO anon;
GRANT INSERT          ON public.collector_heartbeats TO anon;
GRANT INSERT, DELETE  ON public.alphacatch_holdings  TO anon;

-- ── 4) 앞으로 만드는 테이블에 anon·authenticated 전권이 자동으로 붙지 않게 합니다.
--      이 기본값이 49건의 근본 원인입니다.
--      되돌리려면: ALTER DEFAULT PRIVILEGES IN SCHEMA public
--                  GRANT ALL ON TABLES TO anon, authenticated;
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON TABLES    FROM anon, authenticated;
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON SEQUENCES FROM anon, authenticated;
