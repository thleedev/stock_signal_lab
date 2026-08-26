-- 086 보완: alphacatch_holdings 의 symbol 컬럼 SELECT 권한
--
-- 수집기는 전량 교체를 DELETE ?symbol=neq.__none__ → POST 로 합니다.
-- WHERE 절이 symbol 을 읽으므로 그 컬럼의 SELECT 권한이 없으면
-- "permission denied for table alphacatch_holdings" 로 막힙니다.
--
-- 테이블 전체가 아니라 symbol 컬럼만 엽니다. name 등 나머지 컬럼은 계속 차단됩니다.
-- RLS SELECT 정책은 만들지 않습니다. DELETE 대상 행은 DELETE 정책이 결정합니다.

GRANT SELECT (symbol) ON public.alphacatch_holdings TO anon;
