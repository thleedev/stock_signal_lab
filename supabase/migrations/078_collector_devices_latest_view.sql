-- ============================================
-- 078: collector_devices_latest 뷰 (기기별 최신 하트비트 1건)
-- ============================================
-- 배경:
--   라씨 수집이 서버 크론(/api/v1/cron/lassi-signals)으로 이관되면서 thinkpool-api
--   기기가 평일 약 29건(장중 28회 + 마감 후 full 1회)의 하트비트를 남깁니다.
--   수집기 화면들은 collector_heartbeats 를 행수 제한(limit)으로 읽어 기기별 최신 1건을
--   추출하므로, 하트비트가 늘어나면 Android 기기 행이 최근 목록에서 밀려나 수집기 카드가
--   통째로 사라집니다. limit 을 키우는 방식은 하트비트가 더 늘면 같은 문제가 재발합니다.
--
--   행수 대신 기기별 최신 1건만 노출하는 뷰로 조회 기준을 바꿉니다.
--   timestamp 는 NULL 을 허용하므로 NULLS LAST 로 정렬해 값이 있는 행을 최신으로 뽑습니다.
--
-- 보존 기간(90일):
--   행수 제한을 걷어내면 반대 방향의 문제가 생깁니다. 기간 하한이 없으면 폐기한 단말이나 기본값
--   device_id 로 돌린 테스트 빌드가 /collector, /settings, /api/v1/collector/status 세 곳에
--   영구 오프라인 카드로 남고, 그 기기가 마지막에 남긴 error_message 까지 붉은 오류 줄로 계속
--   표시됩니다. 행수 제한 시절에는 이런 device_id 가 최근 목록에서 밀려나 자연히 사라졌습니다.
--
--   기준은 Android 기기가 조용할 수 있는 길이입니다. Android 는 신호를 보낼 때만 하트비트를
--   남기고 알파캐치 알람이 평일 17시에만 걸리므로(CollectorForegroundService.scheduleSignalTimeUpdate
--   가 토·일을 건너뜁니다), 정상 운영에서의 침묵은 주말 이틀입니다. 단말을 껐거나 수리를 맡기면
--   며칠에서 한두 주로 늘어납니다. 서버 크론 thinkpool-api 는 평일마다 기록하므로 하루만 조용해도
--   이상 신호입니다.
--
--   90일은 그 한두 주보다 여러 배 길어 살아 있는 기기를 실수로 감출 여지가 없고, 단말이 고장 나
--   조용해져도 한 분기 내내 오프라인 카드로 남아 알아챌 시간이 넉넉합니다. 반대로 한 분기 동안
--   한 건도 남기지 않은 device_id 는 폐기 단말이나 테스트 빌드로 보는 편이 실제에 가깝습니다.
--   30일로 좁히면 장기 휴가와 단말 수리가 겹칠 때 살아 있는 기기까지 지워 감시를 더 어렵게 합니다.
--
-- DISTINCT ON 과 WHERE 의 적용 순서:
--   WHERE 는 DISTINCT ON 이 최신 1건을 고르기 전에 적용됩니다. 따라서 90일 안에 하트비트가 하나도
--   없는 기기는 "오래된 1건"으로 남는 것이 아니라 기기 자체가 결과에서 빠집니다. 의도한 동작입니다.
--
--   필터 기준과 정렬 기준이 같은 timestamp 이므로, 오래된 행이 최신 행을 밀어내고 노출되는 경우는
--   생기지 않습니다. 기기의 최신 행이 창 안이면 그 행이 그대로 뽑히고, 창 밖이면 나머지 행은 모두
--   그보다 과거이므로 기기가 통째로 빠집니다.
--
--   timestamp 가 NULL 인 행은 비교식 결과가 NULL 이라 WHERE 에서 탈락합니다. NULL 하트비트만 남은
--   기기는 목록에서 사라지며, 소비 화면이 NULL 을 1970년으로 환산해 영구 오프라인 카드로 그리던
--   증상도 함께 없어집니다. ORDER BY 의 NULLS LAST 는 이제 방어용으로만 남습니다.
--
-- 권한:
--   collector_heartbeats 는 RLS 를 켜고 "collector_heartbeats_all" 정책으로 전체 접근을
--   허용합니다(007_notifications.sql). 뷰도 같은 수준으로 노출합니다.
--   Postgres 15+ 에서 뷰 기본값은 security_invoker = off 라 정의자 권한으로 실행되어 원본
--   테이블 RLS 를 우회합니다. 이후 collector_heartbeats 정책을 좁힐 때 뷰가 우회로로 남지
--   않도록 security_invoker = on 을 명시해 호출자 권한과 정책을 그대로 적용받게 합니다.

CREATE OR REPLACE VIEW collector_devices_latest
WITH (security_invoker = on) AS
SELECT DISTINCT ON (device_id) *
FROM collector_heartbeats
WHERE timestamp >= now() - interval '90 days'
ORDER BY device_id, timestamp DESC NULLS LAST;

GRANT SELECT ON collector_devices_latest TO anon;
GRANT SELECT ON collector_devices_latest TO authenticated;
GRANT SELECT ON collector_devices_latest TO service_role;
