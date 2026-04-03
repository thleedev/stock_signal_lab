---
title: GHA 배치 아키텍처 전환 설계
date: 2026-04-03
status: approved
---

# GHA 배치 아키텍처 전환 설계

## 배경 및 목표

- **현재 문제**: Vercel Cron 제약, stock-ranking 조회 시 4000종목 실시간 계산으로 응답 느림
- **목표**:
  1. 모든 수집/점수화 작업을 GitHub Actions(public repo)로 이관
  2. 점수를 DB에 사전 저장해 클라이언트는 SELECT만
  3. 실시간 조회는 Yahoo Finance / FRED 활용 (네이버는 배치 전용)
  4. 프론트엔드에서 수동 배치 트리거 가능

---

## 1. 전체 아키텍처

```
┌─────────────────────────────────────────────────┐
│           GitHub Actions (Public Repo)           │
│                                                  │
│  [단일] daily-batch.yml                          │
│      trigger: 평일 16:10 KST (schedule)          │
│               수동 버튼 / 오류 재실행            │
│               (workflow_dispatch, date 파라미터) │
│                                                  │
│      Step 1: 전종목 일봉 수집 (네이버)           │
│      Step 2: 수급/지표 수집 (네이버/KRX)        │
│      Step 3: 공매도 수집 (KRX)                   │
│      Step 4: 축별 점수 계산 → stock_scores 저장 │
│      Step 5: AI 리포트 생성                      │
│      Step 6: 시황 지표 수집 (Yahoo/FRED)        │
│      Step 7: 공휴일/FOMC/만기일 갱신 (매일)     │
└───────────────────┬─────────────────────────────┘
                    │ supabase-js (직접 연결)
┌───────────────────▼─────────────────────────────┐
│                  Supabase DB                     │
│  daily_prices      (수집된 일봉)                 │
│  stock_scores      (축별 점수 — 신규)            │
│  stock_cache       (기본 종목 메타 + current_price) │
│  market_indicators (시황 지표)                   │
│  market_events     (캘린더)                      │
│  batch_runs        (배치 상태 추적 — 신규)       │
└───────────────────┬─────────────────────────────┘
                    │ SELECT / 경량 upsert만
┌───────────────────▼─────────────────────────────┐
│              Vercel (Next.js)                    │
│  /api/v1/stock-ranking   → DB ORDER BY + 보정   │
│  /api/v1/prices          → Yahoo Finance 실시간  │
│  /api/v1/market-indicators → Yahoo/FRED + DB upsert │
│  /api/v1/admin/trigger-batch → GHA dispatch     │
└─────────────────────────────────────────────────┘
```

---

## 2. DB 스키마 변경

### 2-1. `stock_scores` (신규)

| 컬럼 | 타입 | 설명 |
|------|------|------|
| symbol | text | PK, FK → stock_cache |
| scored_at | date | 점수 계산 기준일 |
| prev_close | numeric | 전일 종가 (모멘텀 보정 기준) |
| score_value | numeric | 가치 점수 |
| score_growth | numeric | 성장 점수 |
| score_supply | numeric | 수급 점수 |
| score_momentum | numeric | 모멘텀 점수 (T-1 기준) |
| score_risk | numeric | 리스크 점수 |
| score_signal | numeric | 신호 점수 |
| updated_at | timestamptz | |

가중치 합산은 DB에서 실시간 계산:
```sql
score_value * w_value
  + score_growth * w_growth
  + score_supply * w_supply
  + score_momentum_adjusted * w_momentum
  + score_risk * w_risk
  + score_signal * w_signal
```

### 2-2. `batch_runs` (신규)

| 컬럼 | 타입 | 설명 |
|------|------|------|
| id | uuid | PK |
| workflow | text | 'daily-batch' (단일 workflow) |
| status | text | 'pending' \| 'running' \| 'done' \| 'failed' |
| triggered_by | text | 'schedule' \| 'manual' |
| started_at | timestamptz | |
| finished_at | timestamptz | |
| summary | jsonb | 수집 건수, 에러 등 |

Supabase Realtime으로 프론트엔드가 상태 구독.

---

## 3. GHA 스크립트 구조

```
.github/
├── workflows/
│   └── daily-batch.yml         # 단일 workflow
└── scripts/
    ├── batch/
    │   ├── index.ts              # 진입점 (batch_runs 상태 관리)
    │   ├── step1-daily-prices.ts # 네이버 전종목 일봉 → daily_prices
    │   ├── step2-investor-data.ts# 수급/지표 (네이버/KRX) → stock_cache
    │   ├── step3-shortsell.ts    # 공매도 (KRX) → stock_cache
    │   ├── step4-scoring.ts      # 축별 점수 → stock_scores
    │   ├── step5-ai-report.ts    # AI 리포트 생성
    │   ├── step6-market-data.ts  # 시황 (Yahoo/FRED) → market_indicators
    │   └── step7-events.ts       # 공휴일/금리결정일/만기일 (매일 upsert)
    └── shared/
        ├── supabase.ts           # DB 클라이언트 (SUPABASE_SERVICE_KEY)
        └── logger.ts             # batch_runs 상태 업데이트 헬퍼
```

### daily-batch.yml 핵심

```yaml
on:
  schedule:
    - cron: '10 7 * * 1-5'   # 평일 16:10 KST (UTC 07:10)
  workflow_dispatch:           # 프론트엔드 수동 트리거 / 오류 재실행
    inputs:
      date:
        description: '재수집 기준일 (YYYY-MM-DD, 빈칸이면 오늘)'
        required: false

jobs:
  batch:
    runs-on: ubuntu-latest
    timeout-minutes: 60
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '20'
      - run: npm ci --prefix .github/scripts
      - run: npx tsx .github/scripts/batch/index.ts
        env:
          SUPABASE_URL: ${{ secrets.SUPABASE_URL }}
          SUPABASE_SERVICE_KEY: ${{ secrets.SUPABASE_SERVICE_KEY }}
          OPENAI_API_KEY: ${{ secrets.OPENAI_API_KEY }}
          FRED_API_KEY: ${{ secrets.FRED_API_KEY }}
          TARGET_DATE: ${{ inputs.date }}
```

---

## 4. API 변경

### 4-1. `/api/v1/stock-ranking` 단순화

- **제거**: 네이버/KRX fetch, 실시간 점수 계산 전체
- **유지**: DB SELECT + 가중치 파라미터 수신 + 모멘텀 보정

**모멘텀 실시간 보정:**
- `stock_scores.prev_close`: 전일 종가 (배치 저장)
- `stock_cache.current_price`: 현재가 (prices API가 Yahoo로 조회 후 업데이트)
- 보정식: `score_momentum_adjusted = score_momentum + (current_price - prev_close) / prev_close * K`
- 이 계산은 DB RPC 또는 API 레이어에서 처리

### 4-2. `/api/v1/prices` 변경

- 네이버 전종목 fetch 제거
- Yahoo Finance로 요청된 종목만 조회 (`005930.KS` 형식)
- 조회 후 `stock_cache.current_price` upsert (모멘텀 보정 기준값 갱신)

### 4-3. `/api/v1/market-indicators` 변경

- Vercel Cron 의존 제거
- 요청 시 Yahoo Finance + FRED 직접 조회
- `updated_at` 기준 5분 이내면 DB 캐시 반환, 이후면 재조회 + DB upsert
- GHA Step 6에서도 하루 1회 저장 (안전망)

### 4-4. `/api/v1/admin/trigger-batch` (신규)

- PAT 기반 GitHub API `workflow_dispatch` 호출
- `batch_runs` 테이블에 `{status: 'pending'}` 삽입
- 프론트엔드는 Supabase Realtime으로 `batch_runs` 구독 → 완료 시 데이터 재조회

---

## 5. 제거 대상

| 파일 | 이유 |
|------|------|
| `web/src/app/api/v1/cron/daily-prices/route.ts` | GHA step1~5로 이관 |
| `web/src/app/api/v1/cron/daily-prices-repair/route.ts` | GHA workflow_dispatch(date 파라미터)로 대체 |
| `web/src/app/api/v1/cron/market-indicators/route.ts` | GHA step6 + 실시간 API로 이관 |
| `web/src/app/api/v1/cron/market-events/route.ts` | GHA step7(월요일 조건)로 이관 |
| `web/src/app/api/v1/cron/intraday-prices/route.ts` | vercel.json에 없음, 미사용 |
| `web/vercel.json` crons 섹션 | GHA로 전환 후 제거 |

---

## 6. 구현 순서

1. **DB 마이그레이션**: `stock_scores`, `batch_runs` 테이블 생성
2. **GHA 스크립트**: `.github/scripts/` 디렉토리 + step1~7 스크립트
3. **GHA workflow**: `daily-batch.yml` 단일 파일 (schedule + workflow_dispatch)
4. **API 단순화**: `stock-ranking`, `prices`, `market-indicators`
5. **trigger-batch API**: 프론트 수동 트리거 엔드포인트 (PAT 기반)
6. **Vercel Cron 제거**: GHA 검증 후 `vercel.json` crons 섹션 및 cron 라우트 삭제
7. **GitHub Secrets 등록**: `SUPABASE_URL`, `SUPABASE_SERVICE_KEY`, `OPENAI_API_KEY`, `FRED_API_KEY`, `GH_PAT`

---

## 7. 비용/제약 정리

| 항목 | 현재 | 변경 후 |
|------|------|---------|
| Vercel Cron | 2개 (무료 플랜 제약) | 0개 (삭제) |
| GHA 실행 | 없음 | 무제한 (public repo) |
| Supabase DB | Hobby 무료 | 동일 (쓰기는 배치만) |
| 네이버 API | 수집+실시간 혼용 | 배치 전용 |
| Yahoo Finance | 일부 사용 | 실시간 조회 전용 |
| FRED API | 크론에서 사용 | GHA + 실시간 혼용 |
