-- 051_add_dart_corp_code.sql
-- DART 고유번호(corp_code) 매핑 컬럼 추가

alter table stock_cache
  add column if not exists dart_corp_code text;

create index if not exists idx_stock_cache_dart_corp_code
  on stock_cache(dart_corp_code)
  where dart_corp_code is not null;
