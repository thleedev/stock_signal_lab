-- 071_fix_stock_info_from_cache.sql
-- stock_info 데이터 정합성 수정
--
-- 문제: stock_info의 KOSPI 종목들이 ETF로 잘못 분류되어 있고
--       stock_cache에만 있고 stock_info에 없는 종목 683개 존재
-- 원인: 최초 import 시 KRX 데이터 파싱 오류로 market 분류 전체 오염
-- 해결: stock_cache(네이버 API 기반, 정확) 기준으로 stock_info를 동기화

-- 1. 기존 stock_info의 market / name을 stock_cache 기준으로 갱신
UPDATE stock_info si
SET
  market     = sc.market,
  name       = sc.name,
  updated_at = NOW()
FROM stock_cache sc
WHERE si.symbol = sc.symbol
  AND (si.market IS DISTINCT FROM sc.market OR si.name IS DISTINCT FROM sc.name);

-- 2. stock_cache에 있지만 stock_info에 없는 종목 추가
INSERT INTO stock_info (symbol, name, market, updated_at)
SELECT sc.symbol, sc.name, sc.market, NOW()
FROM stock_cache sc
WHERE NOT EXISTS (
  SELECT 1 FROM stock_info si WHERE si.symbol = sc.symbol
)
ON CONFLICT (symbol) DO NOTHING;
