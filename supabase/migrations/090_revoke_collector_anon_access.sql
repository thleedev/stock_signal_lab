-- ⚠️ 아직 적용하지 마세요 — 수집기 앱을 새로 빌드해 기기에 설치한 뒤에 적용합니다.
--
-- 이 마이그레이션은 anon 이 DB 에 쓰는 경로를 전부 닫습니다. 구버전 앱이 돌고 있는
-- 상태에서 적용하면 SMS 신호 수집·하트비트·알파캐치 보유 종목이 그 즉시 끊깁니다.
--
-- 적용 절차
--   1. android-collector/local.properties 에 값 두 개를 채웁니다.
--        WEBAPP_URL=https://<배포 도메인>
--        COLLECTOR_API_KEY=<웹앱 환경변수 COLLECTOR_API_KEY 와 같은 값>
--   2. 앱을 빌드해 기기에 설치합니다.
--   3. 신호가 실제로 저장되는지 확인합니다.
--        SELECT max(created_at) FROM signals;
--        SELECT max("timestamp") FROM collector_heartbeats WHERE device_id = 'collector-001';
--   4. 그 다음 이 파일을 적용합니다.
--
-- 적용 후 anon 에 남는 권한은 stock_cache SELECT 하나뿐입니다
-- (web/src/hooks/use-global-price-refresh.ts:52 가 브라우저에서 직접 읽습니다).
--
-- 되돌리려면 086·087·088·089 의 해당 구문을 다시 실행하면 됩니다.

-- ── 정책 삭제
DROP POLICY IF EXISTS signals_anon_select              ON public.signals;
DROP POLICY IF EXISTS signals_anon_fill_signal_time    ON public.signals;
DROP POLICY IF EXISTS mms_raw_messages_anon_insert     ON public.mms_raw_messages;
DROP POLICY IF EXISTS collector_heartbeats_anon_insert ON public.collector_heartbeats;
DROP POLICY IF EXISTS alphacatch_holdings_anon_insert  ON public.alphacatch_holdings;
DROP POLICY IF EXISTS alphacatch_holdings_anon_delete  ON public.alphacatch_holdings;

-- ── 테이블 권한 회수
REVOKE ALL ON public.signals              FROM anon;
REVOKE ALL ON public.mms_raw_messages     FROM anon;
REVOKE ALL ON public.collector_heartbeats FROM anon;
REVOKE ALL ON public.alphacatch_holdings  FROM anon;

-- ── RPC 실행 권한 회수
--    서버가 service_role 로 호출하므로 anon 은 필요 없습니다
--    (web/src/app/api/v1/collector/signals/route.ts).
REVOKE EXECUTE ON FUNCTION public.upsert_signals_bulk(jsonb) FROM anon;
