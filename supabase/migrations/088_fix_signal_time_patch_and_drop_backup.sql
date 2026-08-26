-- 086 회귀 복구 + 079 백업 테이블 정리
--
-- 회귀
--   KiwoomAccessibilityService.kt:1189 → SignalApiClient.updateSignalTimes 가
--   signals 에 직접 PATCH 합니다. 경로를 변수로 조립해(SignalApiClient.kt:250)
--   086 작업 때의 grep 에 잡히지 않았고, signals 의 anon 권한을 없애면서 멈췄습니다.
--   라씨 신호의 signal_time 을 사후에 채우는 기능입니다.
--
--   앱이 보내는 요청은 다음 조건의 행만 건드립니다.
--     signal_time IS NULL AND timestamp 가 신호시각 ±2시간
--   정책과 GRANT 를 그 범위로 좁혀 되살립니다. USING (true) 가 아니므로
--   rls_policy_always_true 대상이 아닙니다.
--
--   WITH CHECK 로 signal_time 을 다시 NULL 로 되돌리는 것도 막습니다.
--   컬럼 GRANT 라 anon 은 signal_time 만 쓸 수 있고, 읽기도 WHERE 절 평가에
--   필요한 5개 컬럼으로 제한됩니다. signal_price·raw_data 등은 계속 차단됩니다.

CREATE POLICY signals_anon_fill_signal_time ON public.signals
  FOR UPDATE TO anon
  USING (signal_time IS NULL)
  WITH CHECK (signal_time IS NOT NULL);

GRANT SELECT (symbol, source, signal_type, signal_time, "timestamp") ON public.signals TO anon;
GRANT UPDATE (signal_time) ON public.signals TO anon;

-- 079 백업 테이블 삭제
--   079 적용 전 수동으로 만든 임시 백업입니다. 코드에서 참조하지 않습니다.
--   314행(KR_3Y 156, KORU 157, FEAR_GREED 1)을
--   supabase/backups/market_indicators_079_backup.json 에 남겼습니다.
--   KR_3Y 는 원본 market_indicators 에 계속 쌓이고 있고,
--   KORU·FEAR_GREED 는 079 에서 파이프라인에서 제외한 지표입니다.

DROP TABLE IF EXISTS public.market_indicators_079_backup;
