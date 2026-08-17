# 시스템 개요

> DashboardStock은 증권사 앱의 AI 매매신호를 자동 수집해 전략 성과를 분석하는 개인용 투자 분석 플랫폼입니다.
> 조사 기준일: 2026-07-22

## 1. 서비스 목적

증권사 앱(키움 영웅문)이 제공하는 AI 매매신호는 API로 접근할 수 없습니다. DashboardStock은 Android 수집기로 SMS·푸시·화면을 읽어 신호를 자동 수집하고, 실제 시장 가격과 연동해 다음을 제공합니다.

- 신호 소스별 가상매매 시뮬레이션과 성과 비교
- 규칙 기반 스코어링으로 종목추천·단기추천 생성
- 시장 지표·이벤트 기반 위험 지수 산출
- 사용자 모의 포트폴리오 관리와 수익률 추적

초기 기획은 `docs/initPlan.md`에 기록되어 있습니다. 기획 당시 검토한 FastAPI·Kafka·Airflow 스택은 채택하지 않았고, Next.js 단일 앱과 GitHub Actions 배치로 구현했습니다.

## 2. 구성 요소

| 구성 요소 | 위치 | 기술 | 역할 |
|-----------|------|------|------|
| 웹 앱 | `web/` | Next.js 16, React 19, Tailwind CSS v4 | 대시보드 UI + API 라우트 55개 |
| Android 수집기 | `android-collector/` | Kotlin, Room, OkHttp | SMS·푸시·접근성 화면에서 신호 수집 |
| 데이터베이스 | `supabase/migrations/` | Supabase PostgreSQL 17 | 테이블 38개, 마이그레이션 77개 |
| 배치 | `.github/workflows/`, `.github/scripts/` | GitHub Actions, tsx | 일봉·수급·점수 계산 파이프라인 |
| 운영 스크립트 | `scripts/`, `web/scripts/` | tsx | 초기 시드·백필·보정 도구 |

배포에는 Vercel(웹)과 Supabase Hosted(DB)를 사용합니다. `web/vercel.json`은 빈 객체로, Vercel Cron은 쓰지 않습니다.

## 3. 신호 소스

| source | 명칭 | 수집 채널 | 신호 타입 |
|--------|------|-----------|-----------|
| `lassi` | 라씨매매신호 | 접근성 화면 스크래핑 (SMS는 무시) | BUY / SELL |
| `stockbot` | 스톡봇 | SMS | BUY |
| `quant` | 퀀트 + 알파캐치 | SMS + 접근성 화면 | BUY_FORECAST / BUY / SELL_COMPLETE |
| `prizm` | 프리즘 인사이트 | 텔레그램 웹훅 | BUY / SELL |

알파캐치는 별도 서비스이지만 `source="quant"`로 저장하며, 발신처는 raw_data 구성으로만 구분할 수 있습니다.

## 4. 데이터 흐름

```
[수집]
Android 수집기 ──(SMS 파싱·화면 스크래핑)──▶ POST /api/v1/signals/batch
텔레그램 봇   ──(PRIZM·배치 우회)─────────▶ POST /api/v1/telegram-webhook
      │                                        │
      └── upsert_signals_bulk RPC ──▶ signals 테이블
                                          │ (INSERT 트리거)
                                          ▼
                                     stock_cache 최신 신호 동기화

[신호 후처리 — signals/batch 비동기]
① strategy-engine 가상매매 실행 → virtual_trades
② FCM 푸시 발송 → fcm_tokens
③ 신호 종목 데이터 보강(네이버·DART) → stock_cache, daily_prices, stock_dart_info
④ intraday-prices 크론 호출 → 전종목 시세 갱신

[배치 — GitHub Actions]
장중 15분 간격: 전종목 현재가 + 점수 재계산
평일 16:10 full: 일봉 → 수급 → 공매도 → 점수 → AI 추천 → 시황 → 이벤트 → 정리 → 섹터 → 테마
매일 07:00 repair: 누락 일봉 보정

[조회]
웹 페이지(서버 컴포넌트) ──▶ Supabase 직접 조회
클라이언트 훅 ──▶ /api/v1/* (CDN 캐시 헤더) ──▶ Supabase
```

## 5. 계층별 기술 규칙

- 서버(API 라우트·서버 컴포넌트)는 `createServiceClient()`로 service role 키를 사용해 RLS를 우회합니다. 클라이언트는 `getSupabase()`로 anon 키를 사용합니다.
- API 라우트는 `/api/v1/` 하위에 두고, 수집기 전용 쓰기는 `verifyCollectorKey`(`x-device-key` 헤더)로 보호합니다.
- 경로 별칭 `@/`는 `web/src/`를 가리킵니다.
- UI는 `.claude/steering/design-tokens.md`의 디자인 토큰을 따릅니다. 상승·매수는 빨강, 하락·매도는 파랑입니다.
- 테스트는 Vitest이며 `src/**/*.test.ts` 패턴을 씁니다.

## 6. 인증·보안 구조

단일 사용자 개인 서비스 전제입니다. 웹 UI에는 로그인이 없고 `middleware.ts`도 없습니다.

| 보호 수단 | 대상 |
|-----------|------|
| `COLLECTOR_API_KEY` (`x-device-key`) | `signals/batch` POST, `holdings/alphacatch` PUT |
| `CRON_SECRET` (Bearer) | `admin/trigger-batch`, `backup`, `cron/stock-init`, `cron/user-portfolio-snapshot` (market-events·market-score는 환경변수 설정 시에만 검증) |
| `TELEGRAM_WEBHOOK_SECRET` | `telegram-webhook` (설정 시에만 검증) |
| 무인증 | 그 밖의 약 60개 핸들러 (조회와 개인 CRUD 전반) |

DB의 RLS는 전 테이블에서 활성이지만 대부분 `USING(true)` 개방 정책입니다. `stock_scores`와 `batch_runs`만 쓰기를 service_role로 제한합니다.

## 7. 저장소 구성

```
DashboardStock/
├─ web/                  # Next.js 앱 (src/app, src/components, src/lib, src/types)
├─ android-collector/    # Kotlin 수집기 앱
├─ supabase/migrations/  # 001~077 마이그레이션 (022 결번)
├─ .github/
│  ├─ workflows/daily-batch.yml   # 유일한 스케줄 워크플로
│  └─ scripts/batch/              # step1~10 배치 스크립트
├─ scripts/              # 초기 시드·백필 스크립트
├─ web/scripts/          # 운영 스크립트 18종
├─ data/                 # 경제 캘린더 정적 폴백
├─ brain/                # 초기 기획 산출물
├─ docs/                 # 프로젝트 문서 (이 문서 포함)
│  └─ superpowers/       # 기능별 개발 계획·설계 이력 52건
└─ _workspace/           # 작업 계획 임시 문서
```

## 8. 문서 안내

| 문서 | 내용 |
|------|------|
| `01-overview.md` | 이 문서. 시스템 전체 조망 |
| `02-android-collector.md` | Android 수집기 구현 |
| `03-database.md` | DB 스키마와 변천사 |
| `04-api-reference.md` | API 엔드포인트 레퍼런스 |
| `05-batch-automation.md` | 배치·크론 자동화 |
| `06-external-data.md` | 외부 데이터 연동 |
| `07-scoring.md` | 스코어링 엔진 4계열 |
| `08-frontend.md` | 프론트엔드 화면 구성 |
| `scenarios/` | 데이터 흐름 중심 시나리오 7편 |
