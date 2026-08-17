# 배치·크론 자동화

> 데이터 수집·점수 계산 파이프라인의 트리거, 스케줄, 단계별 동작을 기록합니다.
> 조사 기준일: 2026-07-22

## 1. 트리거 구조

`web/vercel.json`은 빈 객체이며 Vercel Cron은 쓰지 않습니다. 자동화 트리거는 세 곳입니다.

| 트리거 | 실체 | 담당 |
|--------|------|------|
| GitHub Actions | `.github/workflows/daily-batch.yml` 단일 워크플로 | 데이터 수집·점수화 전체 |
| Supabase pg_cron | `cleanup-mms-raw-7days` 잡 1건 (KST 03:00) | MMS 원문 7일 순환 삭제 |
| 이벤트 기반 | 신호 수신·텔레그램 웹훅·UI 버튼 | 시세 갱신, AI 추천 재생성 |

Vercel Cron 무료 플랜 한도와 함수 10초 타임아웃 제약 때문에 2026-04-03 설계(`docs/superpowers/specs/2026-04-03-gha-batch-architecture-design.md`)에서 GHA로 이관했습니다. Vercel의 `cron/*` 라우트는 GHA가 HTTP로 호출하는 위임 대상 또는 이벤트 기반 엔드포인트로만 남았습니다.

## 2. 스케줄 인벤토리

| 잡 | 크론 (UTC) | KST 환산 | 모드 |
|----|------------|----------|------|
| 장중 현재가 | `*/15 23 * * 0-4` | 월~금 08:00~08:45, 15분 간격 | prices-only |
| 장중 현재가 | `*/15 0-11 * * 1-5` | 월~금 09:00~20:45, 15분 간격 | prices-only |
| 메인 배치 | `10 7 * * 1-5` | 월~금 16:10 | full |
| 보정 배치 | `0 22 * * *` | 매일 07:00 | repair |
| MMS 정리 | `0 18 * * *` (pg_cron) | 매일 03:00 | — |

워크플로의 Detect mode 스텝이 `github.event.schedule` 문자열 매칭으로 모드를 판별합니다. `workflow_dispatch`는 입력값(mode·date)을 우선합니다. 장중 수집은 장 마감 20시 이후인 20:45까지 이어집니다.

## 3. daily-batch 워크플로

러너는 ubuntu-latest, 제한 60분, Node 20입니다. `.github/scripts`에서 `npm ci` 후 `npx tsx batch/index.ts`를 실행합니다.

모드별 분기는 세 가지입니다.

- prices-only: `runPricesOnly()` 후 step4 점수 재계산까지 수행
- repair: step1을 repair 모드로만 실행 (해당일 `daily_prices`에 없는 종목만 재수집)
- full: step1~10 순차 실행

### 스텝별 동작

| 스텝 | 파일 | 처리 | 외부 API | 기록 테이블 |
|------|------|------|----------|-------------|
| prices-only | `prices-only.ts` | 전종목 시세 페이지 병렬 수집 → 500건 청크 upsert → `refresh_high_90d_pct` RPC | 네이버 marketValue | `stock_cache` |
| step1 일봉 | `step1-daily-prices.ts` | 종목당 최근 5일 캔들에서 대상일만 upsert. 50종목 청크 + 100ms 딜레이 | 네이버 fchart | `daily_prices` (`is_provisional=false`) |
| step2 수급 | `step2-investor-data.ts` | 최근 5영업일 외국인·기관 순매수 → 당일·5일 누적·streak(±120 상한). 동시성 80 | 네이버 integration | `stock_cache` 6필드 |
| step3 공매도 | `step3-shortsell.ts` | 당일 전종목 공매도 비중. 휴장일은 데이터 없음으로 정상 종료 | KRX MDCSTAT30101 | `stock_cache.short_sell_ratio` |
| step4 점수 | `step4-scoring.ts` | stock_cache + DART + 30일 신호 + 90일 일봉으로 `calcCompositeScore` 실행. 우선주 목표주가는 본주 가격비로 환산. 200종목 청크 | 없음 | `stock_scores` |
| step5 AI 리포트 | `step5-ai-report.ts` | Vercel `ai-recommendations/generate` HTTP 위임 | Vercel API | `ai_recommendations` (간접) |
| step6 시황 | `step6-market-data.ts` | Yahoo 11종 + FRED 2종(HY_SPREAD·YIELD_CURVE) + CNN Fear&Greed | Yahoo·FRED·CNN | `market_indicators` |
| step7 이벤트 | `step7-events.ts` | `cron/market-events` → `cron/market-score` 순차 위임 (이벤트 반영 순서 보장) | Vercel API | `market_events`, `market_score_history` (간접) |
| step8 정리 | `step8-cleanup.ts` | `daily_prices` 2년 초과 행 삭제 (Supabase 무료 500MB 유지) | 없음 | `daily_prices` |
| step9 섹터 | `step9-crawl-sectors.ts` | KRX 업종-종목 매핑. KOSPI(`STK`)만 수집 | KRX MDCSTAT03501 | `stock_sectors` |
| step10 테마 | `step10-crawl-themes.ts` | 네이버 테마 크롤(EUC-KR) → momentum_score 정규화, 상위 10% `is_hot`, 주도주 판별 | 네이버 HTML | `stock_themes`, `theme_stocks` |

실패 정책은 두 겹입니다. step1~4는 오류를 `errors` 배열에 모으고 계속 진행하며, step5~10은 개별 catch로 감싸 전체 배치를 중단하지 않습니다. 예외가 배치 전체를 넘어서면 `batch_runs`에 failed를 기록하고 종료 코드 1로 마칩니다. 별도 공휴일 스킵 로직은 없어 휴일에도 배치가 실행되며, step1은 대상일 캔들 부재로 전량 실패 카운트가 됩니다.

step4는 `web/src/lib/scoring/composite-score`를 상대경로로 직접 import합니다. 웹과 배치가 점수 엔진을 단일 소스로 공유하는 구조입니다.

## 4. batch_runs 관측 체계

- 기록 흐름: GHA 시작 시 running 삽입 → 종료 시 done/failed와 summary(`{collected, scored, errors[]}`) 갱신.
- 수동 트리거 시 `admin/trigger-batch`가 pending을 먼저 삽입하고 GHA가 running을 별도로 삽입합니다. pending은 stale 타임아웃으로 정리됩니다.
- `batch-runs/status` API가 stale 판정을 담당합니다. prices-only 10분, repair 30분, full 60분 초과 시 `failed` + `{stale_timeout: true}`로 자동 마킹합니다.
- UI의 `CollectingBanner`가 15초 폴링으로 수집 중 배너를 표시합니다. 테이블은 Realtime publication에 등록되어 있으나 실제 구현은 폴링입니다.

## 5. Vercel cron 라우트 5종

| 경로 | 인증 | 호출자 | 동작 |
|------|------|--------|------|
| `cron/intraday-prices` GET | 없음 (10분 디바운스) | `signals/batch` fire-and-forget | 네이버 전종목 시세 → stock_cache upsert + `refresh_high_90d_pct` |
| `cron/lassi-signals` GET/POST | CRON_SECRET 조건부 | 수동·외부 스케줄 (GHA 미연결) | Thinkpool `signalTodayBuySellList` B/S → `upsert_signals_bulk` + BUY enrich. `?dry_run=1` 지원 |
| `cron/market-events` GET | CRON_SECRET 조건부 | GHA step7 | Nager.Date 공휴일(KR/US) + 룰 기반 만기일 12개월 + FRED FOMC + 정적 폴백 → dedupe 후 upsert |
| `cron/market-score` GET | CRON_SECRET 조건부 | GHA step7 | 365일 지표 윈도우로 risk_index·total_score·event_risk_score·combined_score(총점 0.7 + 이벤트 0.3) 계산 → `market_score_history` upsert |
| `cron/stock-init` POST | CRON_SECRET 필수 | 수동 (초기 부트스트랩) | `stock_info` → `stock_cache` 시드 |
| `cron/user-portfolio-snapshot` GET | CRON_SECRET 필수 | 없음 (미연결) | 포트별 오픈 포지션 평균 수익률 → `user_portfolio_snapshots` upsert |

`cron/user-portfolio-snapshot`은 호출자가 코드베이스 어디에도 없습니다. GHA 전환 때 연결이 유실된 미연결 크론으로, 사용자 포트폴리오 스냅샷이 자동 생성되지 않는 상태입니다. `cron/credit-balance/`와 `cron/sector-stats/`는 route.ts가 없는 빈 디렉터리(삭제 잔재)입니다.

## 6. 이벤트 기반 배치성 엔드포인트

- `signals/batch` POST: 신호 수신 시 동기 저장 + 비동기 후처리 4종(전략 엔진, FCM, 데이터 보강, 시세 갱신). 문서 04 참조.
- `prices/refresh` POST: UI 새로고침 버튼이 호출하는 온디맨드 시세 갱신.
- `ai-recommendations/generate` POST: 호출자 3곳 — GHA step5, 텔레그램 웹훅(배치 신호 수신 성공 시), UI 수동 새로고침. LLM 호출은 없으며 전부 규칙 기반 점수 엔진입니다.

## 7. 수동 스크립트

| 위치 | 용도 |
|------|------|
| `scripts/fetch-stock-master.ts` | KRX 전종목 마스터 → `stock_info`·`stock_cache` 초기화 |
| `scripts/insert-lassi-signals-2026030*.ts` | 시스템 구축 전 신호 수동 백필 2건 |
| `scripts/run-migrations.sh` | 마이그레이션 실행 안내 (echo 안내문) |
| `web/scripts/` 18종 | DART corp code 동기화, 일봉 백필, ETF 보정, 섹터 수집 등 `npx tsx` 수동 실행 도구 |

## 8. 환경변수·시크릿

| 위치 | 키 | 용도 |
|------|-----|------|
| GHA Secrets | `SUPABASE_URL`, `SUPABASE_SERVICE_KEY` | 배치의 DB 직접 접근 |
| GHA Secrets | `FRED_API_KEY`, `VERCEL_URL`, `CRON_SECRET` | 시황 지표·Vercel 위임 호출 |
| GHA Secrets | `OPENAI_API_KEY` | 미사용 (설계 잔재) |
| Vercel | `CRON_SECRET`, `GH_PAT`, `GH_REPO` | 크론 인증·워크플로 원격 기동 |
| Vercel | `COLLECTOR_API_KEY`, `TELEGRAM_WEBHOOK_SECRET` | 수집 경로 인증 |
