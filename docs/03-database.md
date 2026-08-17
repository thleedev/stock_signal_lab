# 데이터베이스 스키마

> Supabase PostgreSQL 17. 마이그레이션 001~077(022 결번)을 누적 적용한 최종 스키마를 기록합니다.
> 조사 기준일: 2026-07-22

## 1. 테이블 인벤토리 (38개)

| 테이블 | 생성 | 용도 |
|--------|------|------|
| `signals` | 001 | 수집한 매매 신호 이력. 시스템의 중심 테이블 |
| `daily_prices` | 002 | 종목별 일봉 OHLCV |
| `stock_info` | 002 | 종목 마스터 (이름·섹터·시장) |
| `favorite_stocks` | 003 | 즐겨찾기 종목 (라씨 가상매매 필터) |
| `virtual_trades` | 004 | 신호 기반 가상 거래 체결 기록 |
| `split_trade_schedule` | 005 | 분할매매 2·3회차 예약 |
| `portfolio_snapshots` | 006 | 소스×실행방식별 일별 가상 포트폴리오 스냅샷 |
| `combined_portfolio_snapshots` | 006 | 소스 통합 일별 스냅샷 |
| `daily_signal_stats` | 006 | 일별 신호 통계 (적중률·평균수익률) |
| `fcm_tokens` | 007 | FCM 푸시 토큰 |
| `notification_rules` | 007 | 알림 조건 규칙 (JSONB) |
| `collector_heartbeats` | 007 | Android 수집기 생존 신호 |
| `mms_raw_messages` | 011 | MMS 원문 보관 (7일 순환) |
| `market_indicators` | 014 | 일별 시황 지표 값 |
| `indicator_weights` | 014 | 시황 지표별 가중치·방향 |
| `watchlist` | 015 | 투자 관리 워치리스트 (매수가·손절가·목표가) |
| `stock_cache` | 016 | 전종목 캐시. 시세·재무·수급·신호 요약의 비정규화 허브 |
| `market_score_history` | 017 | 일별 시황 종합 점수 이력 |
| `daily_report_summary` | 020 | 일간 리포트 (신호 집계 + AI 요약 + 투자자 동향) |
| `market_events` | 023 | 시장 이벤트 캘린더 (FOMC·만기일 등) |
| `app_config` | 025 | 키-값 설정 저장소 (KIS 토큰 캐시 등) |
| `user_portfolios` | 028 | 사용자 모의투자 포트 |
| `user_trades` | 028 | 사용자 매수/매도 기록 |
| `user_portfolio_snapshots` | 028 | 사용자 포트별 일별 수익률 스냅샷 |
| `watchlist_groups` | 029 | 관심종목 그룹 메타 |
| `watchlist_group_stocks` | 029 | 그룹↔종목 매핑 |
| `ai_recommendations` | 030 | AI 종목추천 결과 (모델별·일별 순위) |
| `stock_ranking_snapshot` | 050 | 종목 순위 스냅샷 (세션 단위 이력) |
| `stock_dart_info` | 050 | DART 공시 파생 정보 (CB/BW·대주주 지분 등) |
| `snapshot_update_status` | 050 | 스냅샷 갱신 진행 락 (단일 행) |
| `snapshot_sessions` | 055 | 스냅샷 실행 세션 메타 |
| `stock_scores` | 057 | 배치가 계산한 종목별 축 점수 |
| `batch_runs` | 058 | 배치 실행 이력 (Realtime 구독 대상) |
| `stock_sectors` | 069 | KRX 업종-종목 매핑 |
| `stock_themes` | 069 | 네이버 테마 메타 + 일별 모멘텀 |
| `theme_stocks` | 069 | 테마-종목 일별 매핑 |
| `etf_category_map` | 073 | ETF 섹터/방향(bull·bear) 수동 분류 |
| `alphacatch_holdings` | 074 | 알파캐치 보유 종목 동기화 (전체 덮어쓰기) |

뷰와 materialized view는 없습니다. 집계는 애플리케이션 계층과 비정규화 캐시가 담당합니다.

## 2. 핵심 테이블 상세

### 2.1 signals

| 컬럼 | 타입 | 비고 |
|------|------|------|
| `id` | UUID PK | `gen_random_uuid()` |
| `timestamp` | TIMESTAMPTZ NOT NULL | 수집(스크래핑) 시각 |
| `symbol` | VARCHAR(10) | NULL 허용 (스톡봇은 종목명만) |
| `name` | VARCHAR(100) NOT NULL | |
| `signal_type` | VARCHAR(20) NOT NULL | BUY / SELL / BUY_FORECAST / SELL_COMPLETE |
| `source` | VARCHAR(20) NOT NULL | lassi / stockbot / quant / prizm |
| `signal_time` | TIMESTAMPTZ | 실제 신호 발생 시각 (033 추가, 17시 보정으로 채워짐) |
| `signal_price` | INTEGER | 신호 가격 (033 추가) |
| `batch_id` / `device_id` / `is_fallback` / `raw_data` / `created_at` | | 수집 메타 |

- 핵심 유니크 인덱스: `idx_signals_dedup_unified` — (symbol, source, signal_type, `signal_date_kst(timestamp)`) WHERE symbol IS NOT NULL (063). "같은 종목·소스·타입은 KST 기준 하루 한 행"이 최종 중복 방지 규칙입니다.
- 트리거: `trg_sync_signal_to_cache` AFTER INSERT → `fn_sync_signal_to_cache()` (070). stock_cache의 최신 신호·매도 컬럼을 동기화합니다.
- RLS: 활성. anon INSERT/SELECT 허용 (008).

### 2.2 stock_cache — 비정규화 허브

전종목 1행씩 유지하며 마이그레이션마다 컬럼이 확장된 최다 변경 테이블입니다.

| 컬럼군 | 컬럼 | 도입 |
|--------|------|------|
| 기본 시세 | `symbol` PK, `name`, `market`, `current_price`, `price_change_pct`, `volume`, `market_cap` | 016 |
| 재무 | `per`, `pbr`, `roe`, `eps`, `bps`, `dividend_yield`, `high_52w`, `low_52w` | 016 |
| 신호 요약 | `latest_signal_type/date/price`, `signal_count_30d`, `is_holding`, `is_favorite` | 016·047 |
| 수급 당일 | `short_sell_ratio`, `foreign_net_qty`, `institution_net_qty`, `investor_updated_at` | 031 |
| 수급 누적 | `foreign_net_5d`, `institution_net_5d`, `foreign_streak`, `institution_streak` (음수=연속 매도) | 043 |
| 컨센서스 | `forward_per`, `forward_eps`, `target_price`, `invest_opinion`, `roe_estimated` | 045·056 |
| 리스크 | `float_shares`, `is_managed`, `dart_corp_code` | 050·051 |
| 모멘텀 | `change_1m_pct`, `high_90d_pct` | 064·066 |
| 매도 상태 | `latest_sell_date`, `latest_sell_price`, `has_active_sell` | 065·067 |

`has_active_sell`은 생성 컬럼입니다. `latest_sell_date`가 존재하고 `latest_signal_date`보다 최신이면 true가 되어 "현재 매도 상태" 필터로 쓰입니다.

### 2.3 가상매매 계열

- `virtual_trades`: source, execution_type(lump/split), side, price, quantity, `split_seq`, `trade_group_id`, `signal_id` FK→signals.
- `split_trade_schedule`: 분할 2·3회차 예약. `scheduled_date`, status(pending/executed/cancelled).
- `portfolio_snapshots`: UNIQUE(date, source, execution_type). holdings JSONB, cash, total_value, 수익률 2종.

### 2.4 사용자 포트폴리오 계열

- `user_portfolios`: BIGSERIAL PK, name UNIQUE, `is_default`, `deleted_at`(소프트 삭제).
- `user_trades`: side CHECK(BUY/SELL), `buy_trade_id` 자기참조 FK로 매도가 청산한 매수를 연결.
- `user_portfolio_snapshots`: UNIQUE(portfolio_id, date).

### 2.5 스코어링·스냅샷 계열

- `stock_scores`: symbol PK, FK→stock_cache ON DELETE CASCADE. 축 점수(`score_value/growth/supply/momentum/risk/signal/reversal/catalyst`), `market_multiplier`, 체크리스트 통과 카운트 8종, `prev_close`. 쓰기는 service_role 전용 RLS.
- `snapshot_sessions` 1:N `stock_ranking_snapshot` (UNIQUE(session_id, symbol), 055에서 하루 다중 세션 허용으로 개편).
- `ai_recommendations`: UNIQUE(date, symbol, model_type). 049에서 `technical_score`→`trend_score` 리네임.
- `batch_runs`: Realtime publication 등록. 쓰기는 service_role 전용.

## 3. DB 함수·트리거

| 함수 | 도입 | 요약 |
|------|------|------|
| `signal_date_kst(ts)` | 040 | `(ts AT TIME ZONE 'Asia/Seoul')::date`. IMMUTABLE 래퍼로 dedup 인덱스 식에 사용 |
| `upsert_signals_bulk(payload)` | 063 | SECURITY DEFINER RPC. jsonb 배열을 순회 INSERT, 충돌 시 `signal_time = COALESCE(new, existing)`. anon 실행 허용 — 수집기·텔레그램 웹훅이 호출 |
| `refresh_high_90d_pct()` | 066 | 90일 최고 종가 대비 등락률을 stock_cache에 일괄 갱신 |
| `fn_sync_signal_to_cache()` | 070 | signals INSERT 트리거. BUY 계열은 latest_signal_*, SELL 계열은 latest_sell_* 갱신. 가격은 raw_data 우선순위 COALESCE |
| `update_market_events_updated_at()` 외 | 023·073 | updated_at 자동 갱신 트리거 2종 |

`signal_date_kst()`는 dedup 인덱스와 RPC의 ON CONFLICT 식이 공유하는 함수이므로, 변경하면 중복 방지 체계 전체에 영향을 줍니다.

## 4. pg_cron

마이그레이션으로 등록한 잡은 1개입니다.

| 잡 | 스케줄 | 동작 |
|----|--------|------|
| `cleanup-mms-raw-7days` (012) | `0 18 * * *` UTC = KST 03:00 | `mms_raw_messages` 7일 초과 행 삭제 |

011의 INSERT 트리거 방식 정리를 012에서 pg_cron으로 대체했습니다. Supabase Hobby 플랜이므로 pg_cron 잡을 추가할 때는 기존 잡 정리를 먼저 검토해야 합니다.

## 5. signals 중복 방지 변천사

signals의 dedup 제약은 9차례 바뀐 끝에 수렴했습니다. 흐름은 다음 네 단계입니다.

1. 종목당 1행 upsert 모델 (009~010): `(symbol, source)` UNIQUE. partial 인덱스를 PostgREST가 인식하지 못해 일반 제약으로 교체.
2. 완전 append 모델 전환 (033): 매수·매도 쌍 추적을 위해 제약을 제거하고 `signal_time`·`signal_price` 추가.
3. DB 제약과 앱 캐시 사이의 진동 (034~044): 시각 기준 UNIQUE 도입(034) → PostgREST 호환 문제로 제거(035) → 재발한 중복을 수차례 데이터 정리(036·042·044) → NULL 시간 행 규칙을 넣었다 뺐다 반복(040·041·062).
4. 최종 수렴 (063): `idx_signals_dedup_unified`(KST 하루 1행) + `upsert_signals_bulk` RPC. 충돌 시 시간만 병합하는 로직을 SECURITY DEFINER 함수에 내장하고, 수집기는 RPC 1회 호출로 단순화.

운영 복구성 마이그레이션도 있습니다. HOLD 신호 폐기(038·054), 오수집 삭제(075·076)가 이에 해당합니다.

## 6. RLS 적용 패턴

- 초기 테이블(001~008)은 생성과 동시에 RLS를 적용했습니다.
- 014~030 사이 테이블은 RLS 없이 생성되었다가 037에서 10개 일괄 활성화했고, 052(050 생성분)·077(069 생성분)에서 후속 정리했습니다.
- 정책은 대부분 `FOR ALL USING(true)` 개방형입니다. `stock_scores`(057)와 `batch_runs`(058)만 쓰기를 `auth.role() = 'service_role'`로 제한합니다.

## 7. 테이블 관계

명시적 FK는 8건입니다.

| 자식 | 부모 | 비고 |
|------|------|------|
| `virtual_trades.signal_id` | `signals` | |
| `split_trade_schedule.signal_id` | `signals` | |
| `user_trades.portfolio_id` | `user_portfolios` | |
| `user_trades.buy_trade_id` | `user_trades` | 자기참조 (매도→매수 청산) |
| `user_portfolio_snapshots.portfolio_id` | `user_portfolios` | |
| `watchlist_group_stocks.group_id` | `watchlist_groups` | ON DELETE CASCADE |
| `stock_ranking_snapshot.session_id` | `snapshot_sessions` | |
| `stock_scores.symbol` | `stock_cache` | ON DELETE CASCADE |

그 밖의 테이블은 `symbol` 문자열로 논리 조인합니다. `stock_cache.symbol`이 사실상의 허브입니다. symbol 타입이 VARCHAR(10)과 TEXT로 혼재하는 점에 유의해야 합니다. 초기 테이블은 VARCHAR(10)을, 050 이후 신규 테이블은 TEXT를 쓰는 경향입니다.

## 8. 알려진 특이사항

1. 022번 마이그레이션은 결번입니다.
2. `044_cleanup_null_time_dupes_all.sql`의 파일 내부 헤더 주석이 "043"으로 잘못 적혀 있습니다.
3. `favorite_stocks.group_name`은 029에서 deprecated 처리되었지만 컬럼은 남아 있습니다.
4. `config.toml`의 `[db.seed]`가 `./seed.sql`을 선언하지만 실제 파일은 없습니다. 시드는 마이그레이션 내 INSERT로 처리했습니다.
5. PostgREST `max_rows = 1000` 설정 때문에 전종목 조회는 API 계층에서 1000건 페이지네이션이 필요합니다.
