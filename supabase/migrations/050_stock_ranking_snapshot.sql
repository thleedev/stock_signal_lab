-- 050_stock_ranking_snapshot.sql
-- AI신호 종목추천/단기추천 개선: 스냅샷 + DART + 상태 테이블

-- 1. 순위 스냅샷 테이블
create table if not exists stock_ranking_snapshot (
  id bigint generated always as identity primary key,
  snapshot_date date not null,
  snapshot_time timestamptz not null,
  model text not null,
  symbol text not null,
  name text,
  market text,
  current_price int,
  market_cap bigint,
  daily_trading_value bigint,
  avg_trading_value_20d bigint,
  turnover_rate numeric,
  is_managed boolean default false,
  has_recent_cbw boolean default false,
  major_shareholder_pct numeric,
  score_total numeric,
  score_signal numeric,
  score_trend numeric,
  score_valuation numeric,
  score_supply numeric,
  score_risk numeric,
  score_momentum numeric,
  score_catalyst numeric,
  grade text,
  characters text[],
  recommendation text,
  signal_date date,
  raw_data jsonb,
  unique(snapshot_date, model, symbol)
);

create index if not exists idx_snapshot_date_model on stock_ranking_snapshot(snapshot_date, model);
create index if not exists idx_snapshot_symbol on stock_ranking_snapshot(symbol);

-- 2. DART 정보 테이블
create table if not exists stock_dart_info (
  symbol text primary key,
  has_recent_cbw boolean default false,
  major_shareholder_pct numeric,
  major_shareholder_delta numeric,
  audit_opinion text,
  has_treasury_buyback boolean default false,
  revenue_growth_yoy numeric,
  operating_profit_growth_yoy numeric,
  updated_at timestamptz default now()
);

-- 3. stock_cache 컬럼 추가
alter table stock_cache
  add column if not exists float_shares bigint,
  add column if not exists is_managed boolean default false;

-- 4. 스냅샷 갱신 상태 추적 (단일 행)
create table if not exists snapshot_update_status (
  id int primary key default 1 check (id = 1),
  updating boolean default false,
  last_updated timestamptz,
  model text
);

insert into snapshot_update_status (id, updating)
values (1, false)
on conflict (id) do nothing;
