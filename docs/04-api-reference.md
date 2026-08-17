# API 레퍼런스

> `web/src/app/api/v1/` 하위 route.ts 55개 파일, 핸들러 70개를 기록합니다.
> 조사 기준일: 2026-07-22

모든 라우트는 `createServiceClient()`(service role, RLS 우회)로 Supabase에 접근합니다. `middleware.ts`는 없으며 전역 인증 계층도 없습니다.

## 1. 인증 체계

| 방식 | 검증 내용 | 적용 라우트 |
|------|-----------|-------------|
| `verifyCollectorKey` | 헤더 `x-device-key` = `COLLECTOR_API_KEY` (`lib/auth.ts`) | `signals/batch` POST, `holdings/alphacatch` PUT |
| CRON_SECRET 필수 | 헤더 `Authorization: Bearer {CRON_SECRET}` | `admin/trigger-batch`, `backup`, `cron/stock-init`, `cron/user-portfolio-snapshot` |
| CRON_SECRET 조건부 | 헤더 `Authorization: Bearer {CRON_SECRET}` (미설정 시 로컬 허용) | `cron/market-events`, `cron/market-score`, `cron/lassi-signals` |
| CRON_SECRET 조건부 | 환경변수가 설정된 경우에만 검증 | `cron/market-events`, `cron/market-score` |
| TELEGRAM_WEBHOOK_SECRET 조건부 | 헤더 `x-telegram-bot-api-secret-token` | `telegram-webhook` |
| 무인증 | — | 나머지 약 60개 핸들러 전부 |

무인증 범위에는 조회뿐 아니라 쓰기 계열도 포함됩니다. `favorites`, `watchlist(-groups)`, `user-portfolio(/trades)`, `notifications`, `market-events` POST, `market-indicators/weights` PUT, `prices/refresh` POST, `ai-recommendations/generate` POST, `stock-ranking/snapshot` POST가 해당합니다. 단일 사용자 개인 서비스를 전제한 구조입니다.

## 2. 엔드포인트 인벤토리

### 2.1 신호 (signals)

| 경로 | 메서드 | 요약 |
|------|--------|------|
| `/api/v1/signals` | GET | 신호 목록. source/symbol/date/signal_type 필터, limit 기본 50·최대 200 |
| `/api/v1/signals/batch` | POST | 수집기 신호 일괄 수신. 인증 필수 |
| `/api/v1/signals/today` | GET | 오늘 신호를 소스 4종으로 그룹·집계 |

`signals/batch`의 동기 처리는 네 단계입니다. ① quant BUY 수신 시 같은 종목의 최근 BUY_FORECAST 행을 BUY로 승격(UPDATE, `upgraded_from` 기록) ② `signal_time` 있는 행은 당일 null-time 행 UPDATE 우선, 없으면 upsert ③ null-time 행은 당일 동일 신호 존재 시 스킵 ④ `collector_heartbeats` 기록. 이후 비동기 후처리 4종을 응답과 무관하게 실행합니다. 전략 엔진 `processSignal`, FCM 푸시, `enrichSignalStocks` 데이터 보강, `cron/intraday-prices` 호출입니다.

### 2.2 종목 (stocks·stock)

| 경로 | 메서드 | 요약 |
|------|--------|------|
| `/api/v1/stocks` | GET | 종목 목록·검색·필터. `sortBy=gap`이면 신호가 대비 괴리 순 2단계 페이지네이션 |
| `/api/v1/stocks/[symbol]/realtime` | GET | 실시간 시세 + stock_info 이름 보정 |
| `/api/v1/stock` | GET | 종목 상세 (일봉+신호+가상거래 병렬 조회) |
| `/api/v1/stock/[symbol]/daily-prices` | GET | 90일 일봉. DB에 없으면 네이버 폴백 |
| `/api/v1/stock/[symbol]/metrics` | GET | stock_cache 재무 메트릭 단건 |
| `/api/v1/stock-analysis` | GET | 종목 체크리스트 분석 (스코어링 5종 + unified 카테고리) |
| `/api/v1/compare` 관련 | — | 별도 라우트 없음. compare 화면은 stocks·realtime을 조합 |

### 2.3 시황 (market-indicators·market-events)

| 경로 | 메서드 | 요약 |
|------|--------|------|
| `/api/v1/market-indicators` | GET | 최신 지표 + 가중 종합점수 + 90일 히스토리 |
| `/api/v1/market-indicators/realtime` | GET | Yahoo 12종 + CNN Fear&Greed 실시간 조회 (DB 미사용) |
| `/api/v1/market-indicators/etf-sentiment` | GET | 라씨 ETF 신호 기반 섹터 심리 |
| `/api/v1/market-indicators/weights` | GET/PUT | 지표 가중치 조회·일괄 수정 |
| `/api/v1/market-events` | GET/POST | 이벤트 조회 / 수동 등록 (event_date·event_type·title upsert) |
| `/api/v1/hot-themes` | GET | 오늘 momentum_score 상위 10개 테마 |

### 2.4 포트폴리오 (가상매매·사용자·알파캐치)

| 경로 | 메서드 | 요약 |
|------|--------|------|
| `/api/v1/portfolio` | GET | 가상매매 현황. source 지정 시 단일, 미지정 시 3소스 합산 |
| `/api/v1/performance` | GET | 소스×실행방식(lump/split) 성과 비교 |
| `/api/v1/user-portfolio` | GET/POST/PATCH/DELETE | 사용자 포트 CRUD. 소프트 삭제·복원, 기본 포트 삭제 거부 |
| `/api/v1/user-portfolio/holdings` | GET | 미청산 보유 + 수익률·신호·점수 결합. 목표가 97% 이상 `near_target`, 손절가 103% 이하 `near_stop` |
| `/api/v1/user-portfolio/trades` | GET/POST/PATCH/DELETE | 거래 CRUD. SELL은 `buy_trade_id` 필수, 이미 매도된 매수 재매도는 409 |
| `/api/v1/user-portfolio/performance` | GET | 포트별 스냅샷 + KOSPI 벤치마크 |
| `/api/v1/user-portfolio/summary` | GET | 포트별 오픈 포지션 수 |
| `/api/v1/user-portfolio/search` | GET | 종목 검색 (2자 이상, 10건) |
| `/api/v1/holdings/alphacatch` | PUT/GET | 알파캐치 보유 전체 덮어쓰기(인증) / 조회 |

### 2.5 관심종목 (favorites·watchlist·watchlist-groups)

| 경로 | 메서드 | 요약 |
|------|--------|------|
| `/api/v1/favorites` | GET/POST/PATCH | 즐겨찾기 목록·추가·그룹 일괄 이동. `stock_cache.is_favorite` 동기화 |
| `/api/v1/favorites/[symbol]` | DELETE | 즐겨찾기 제거 |
| `/api/v1/favorites/candidates` | GET | 최근 7일 라씨 신호 중 미등록 종목 |
| `/api/v1/watchlist` | GET/POST/PATCH/DELETE | 투자 관리 워치리스트 (매수가·손절가·목표가) |
| `/api/v1/watchlist/reorder` | PUT | 정렬 순서 일괄 변경 |
| `/api/v1/watchlist-groups` | GET/POST/PUT | 그룹 목록·생성(최대 20개)·순서 변경 |
| `/api/v1/watchlist-groups/[id]` | PATCH/DELETE | 그룹명 변경 / 삭제. 삭제 시 고아 종목 정리 |
| `/api/v1/watchlist-groups/[id]/stocks(/[symbol])` | GET/POST/DELETE | 그룹 내 종목 관리 |
| `/api/v1/watchlist-groups/reorder` | PUT | 그룹 순서 변경 (기본 그룹 제외) |

기본 그룹(is_default)은 이름 변경·삭제·순서 변경을 할 수 없습니다. 그룹 순서 변경 PUT은 base 라우트와 `/reorder`에 같은 로직이 이중 구현되어 있습니다.

### 2.6 추천·랭킹 (ai-recommendations·stock-ranking)

| 경로 | 메서드 | 요약 |
|------|--------|------|
| `/api/v1/ai-recommendations` | GET | 오늘 추천 조회. standard는 현재 BUY 종목 수와 비교해 `needs_refresh` 판단 |
| `/api/v1/ai-recommendations/generate` | POST | 추천 생성. model=standard/short_term, 당일 해당 모델 행만 교체. maxDuration 120초 |
| `/api/v1/stock-ranking` | GET | stock_scores 기반 랭킹. 커스텀 가중치 5종, contrarian 스타일, 20초 인메모리 캐시 |
| `/api/v1/stock-ranking/snapshot` | GET/POST | 스냅샷 조회 / 수동 생성 (단일 행 락 기반) |
| `/api/v1/stock-ranking/sessions` | GET | 세션 목록 (최근 30일) |
| `/api/v1/stock-ranking/snapshot/history` | GET | 종목별 스냅샷 시계열 |
| `/api/v1/stock-ranking/status` | GET | 스냅샷 갱신 진행 상태 |

`stock-ranking`은 PostgREST 1000행 제한을 페이지네이션 루프로 우회해 전량 수집한 뒤 API 계층에서 정렬합니다. 커스텀 가중치를 받으면 실시간 등락률 벨커브 모멘텀(`calcBellMomentum`, +1~3% 구간 최고점)으로 재계산합니다.

### 2.7 운영 (collector·batch-runs·admin·backup·prices·notifications)

| 경로 | 메서드 | 요약 |
|------|--------|------|
| `/api/v1/collector/status` | GET | 수집기 heartbeat. 10분 이내 응답이면 online |
| `/api/v1/batch-runs/status` | GET | 진행 중 배치 조회 + stale 자동 failed 처리 (prices-only 10분/repair 30분/full 60분) |
| `/api/v1/admin/trigger-batch` | POST | GitHub Actions daily-batch 원격 기동 + pending 기록 |
| `/api/v1/backup` | GET | 핵심 8개 테이블 JSON 백업 다운로드. maxDuration 300초 |
| `/api/v1/prices/refresh` | POST | 네이버 전종목 시세 → stock_cache upsert |
| `/api/v1/cron/*` | GET/POST | 배치 위임 대상 5종 (문서 05 참조) |
| `/api/v1/notifications/rules` | GET/POST | 알림 규칙 조회·조건별 upsert |
| `/api/v1/notifications/token` | POST/DELETE | FCM 토큰 등록(device_id upsert)·삭제 |

### 2.8 텔레그램 웹훅

`POST /api/v1/telegram-webhook`은 메시지 본문 패턴 기반 파서이며 두 경로를 처리합니다.

1. Android 배치 우회 경로: 본문이 `[SIGNAL_BATCH]`로 시작하면 이후 JSON을 파싱해 `upsert_signals_bulk` RPC로 저장하고, 성공 시 AI 추천 재생성을 트리거합니다. 수집기 → 텔레그램 봇 → 전용 그룹 → 웹훅으로 이어지는 `signals/batch`의 대체 유입 경로입니다.
2. PRIZM 신호 경로: `@stock_ai_ko` 채널 포워딩 또는 `#프리즘인사이트` 해시태그 메시지에서 "신규 매수:"·"매도:" 라인을 파싱해 `source='prizm'` 신호로 저장합니다. 매수는 목표가·손절가·투자기간·산업군을, 매도는 매수가·수익률·보유기간을 raw_data에 담습니다. 타임스탬프는 `forward_date`를 우선합니다.

## 3. 캐싱 체계

`lib/api-cache.ts`의 `jsonWithCache` 유틸은 정의만 있고 사용처가 없습니다. 실제 캐싱은 각 라우트가 인라인으로 설정하는 `Cache-Control` 헤더(CDN 대상)입니다.

| TTL | 엔드포인트 |
|-----|-----------|
| `s-maxage=10, swr=30` | signals GET, stocks GET(gap 분기) |
| `s-maxage=30, swr=60` | signals/today, ai-recommendations GET, stocks/[symbol]/realtime |
| `s-maxage=60` 계열 | market-indicators/realtime·weights, stock/[symbol]/metrics, sessions |
| `s-maxage=300, swr=600` | market-indicators, performance, stock, stock-analysis, snapshot GET |
| `s-maxage=600, swr=1200` | stock/[symbol]/daily-prices |
| `no-cache` / `no-store` | stock-ranking/status / batch-runs/status |
| 없음 | CRUD 계열 전부 |

예외적으로 `stock-ranking` GET만 서버 인메모리 Map 캐시(20초 TTL)를 병용하며, 단일 종목 조회는 캐시하지 않습니다.

## 4. 알려진 특이사항

1. `stock-ranking/snapshot` POST가 내부 호출하는 `refresh=true&snapshot=true` 쿼리를 `stock-ranking` GET이 처리하지 않습니다. 리팩터링 잔재로 추정됩니다.
2. `cron/intraday-prices`는 인증 없이 10분 디바운스만으로 보호됩니다.
3. GHA step5가 `ai-recommendations/generate` 호출 시 보내는 Bearer 헤더를 수신 측이 검사하지 않습니다.
4. KIS API(`lib/kis-api.ts`)를 직접 쓰는 API 라우트는 없습니다.
