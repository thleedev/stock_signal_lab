-- 088 보완: signals SELECT 정책
--
-- 088 의 UPDATE 정책만으로는 PATCH 가 0행이었습니다. UPDATE 문이 WHERE 절에서
-- 컬럼을 읽을 때 SELECT 정책이 적용되는데 signals 에는 SELECT 정책이 없어
-- 대상 행이 보이지 않았습니다.
--
-- SELECT 정책 USING 을 signal_time IS NULL 로 좁히면 이번엔 갱신 후 행이 그 조건을
-- 벗어나 "new row violates row-level security policy" 로 막힙니다. USING (true) 로 두고,
-- 노출 범위는 컬럼 GRANT 로 제한합니다 (088 에서 symbol·source·signal_type·
-- signal_time·timestamp 5개만 부여). signal_price·raw_data·device_id 등은 계속 차단됩니다.
--
-- SELECT 정책은 rls_policy_always_true lint 대상이 아닙니다 (공개 읽기 패턴으로 제외).
--
-- 이 정책과 088 의 UPDATE 정책은 수집기가 서버 API 를 경유하도록 바꾸면 함께 없앱니다.

CREATE POLICY signals_anon_select ON public.signals
  FOR SELECT TO anon USING (true);
