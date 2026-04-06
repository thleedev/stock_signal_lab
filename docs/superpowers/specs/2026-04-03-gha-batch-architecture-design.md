---
title: GHA 배치 아키텍처 전환 설계
date: 2026-04-03
updated: 2026-04-06
status: approved
---

# GHA 배치 아키텍처 전환 설계

## 배경 및 목표

- **현재 문제**:
  - Vercel Cron 제약 (무료 플랜 한도)
  - stock-ranking 조회 시 4000종목 실시간 계산으로 응답 느림
  - Vercel 함수 10초 타임아웃으로 대량 수집 불가
- **목표**:
  1. 모든 수집/점수화를 GitHub Actions(public repo)로 이관
  2. 축별 점수를 DB에 사전 저장 → 클라이언트는 SELECT + 가중치 합산만
  3. Vercel API는 외부 API 호출 없이 DB 읽기만
  4. 프론트엔드에서 수동 배치 트리거 가능
  5. 무료 플랜으로 영구 운영

---

## 1. 전체 아키텍처

```
┌─────────────────────────────────────────────────┐
│           GitHub Actions (Public Repo)           │
│                                                  │
│  daily-batch.yml (단일 workflow)                 │
│                                                  │
│  [장중] 08:00~20:45 KST, 15분마다               │
│      Naver bulk(26 요청) → stock_cache 현재가   │
│                                                  │
│  [메인] 평일 16:10 KST                          │
│      Step 1: 전종목 일봉 수집 (Naver, 정규장 종가 기준) │
│      Step 2: 수급/지표 수집 (Naver/KRX)         │
│      Step 3: 공매도 수집 (KRX)                  │
│      Step 4: 축별 점수 계산 → stock_scores 저장 │
│      Step 5: AI 리포트 생성                     │
│      Step 6: 시황 지표 수집 (Yahoo/FRED/CNN)    │
│      Step 7: 공휴일/금리결정일/만기일 갱신 (매일) │
│      Step 8: 2년 초과 daily_prices 삭제         │
│                                                  │
│  [보정] 매일 07:00 KST                          │
│      누락 종목만 재수집 (repair mode)            │
│                                                  │
│  [수동] workflow_dispatch                        │
│      date 파라미터로 특정일 전체 재수집          │
└───────────────────┬─────────────────────────────┘
                    │ supabase-js (직접 연결)
┌───────────────────▼─────────────────────────────┐
│                  Supabase DB                     │
│  daily_prices      (일봉, is_provisional 포함)  │
│  stock_scores      (축별 점수 — 신규)           │
│  stock_cache       (종목 메타 + current_price)  │
│  market_indicators (시황 지표)                  │
│  market_events     (캘린더)                     │
│  batch_runs        (배치 상태 추적 — 신규)      │
└───────────────────┬─────────────────────────────┘
                    │ SELECT + 경량 upsert만
┌───────────────────▼─────────────────────────────┐
│              Vercel (Next.js)                    │
│  UI 호스팅                                       │
│  /api/v1/stock-ranking  → DB SELECT + 가중치 합산│
│  /api/v1/collector      → Android SMS 수신       │
│  /api/v1/ai-recommendations/generate → OpenAI   │
│  /api/v1/admin/trigger-batch → GHA dispatch     │
└─────────────────────────────────────────────────┘
```

---

## 2. GHA 스케줄

```yaml
on:
  schedule:
    # 장중 현재가 수집: 08:00~20:45 KST (UTC 23:00~11:45, 평일)
    - cron: '*/15 23-11 * * 1-5'
    # 메인 배치: 16:10 KST (UTC 07:10, 평일)
    - cron: '10 7 * * 1-5'
    # 보정 배치: 07:00 KST (UTC 22:00, 매일)
    - cron: '0 22 * * *'
  workflow_dispatch:
    inputs:
      date:
        description: '재수집 기준일 (YYYY-MM-DD, 빈칸이면 오늘)'
        required: false
      mode:
        description: 'full | repair | prices-only'
        required: false
        default: 'full'
```

**스케줄별 실행 내용:**

| 스케줄 | mode | 실행 내용 |
|--------|------|----------|
| 15분마다 (장중) | prices-only | Naver bulk → stock_cache.current_price |
| 16:10 KST | full | Step 1~8 전체 |
| 07:00 KST | repair | 누락 종목 일봉만 보정 |
| workflow_dispatch | 파라미터 | 수동 지정 |

---

## 3. GHA 스크립트 구조

```
.github/
├── workflows/
│   └── daily-batch.yml
└── scripts/
    ├── package.json
    ├── batch/
    │   ├── index.ts              # 진입점 (mode 분기 + batch_runs 관리)
    │   ├── prices-only.ts        # Naver bulk → stock_cache (15분 장중)
    │   ├── step1-daily-prices.ts # Naver 전종목 일봉 → daily_prices
    │   │                         # full: 4000종목 50개씩 청크 병렬 (~2분)
    │   │                         # repair: 누락 종목만
    │   ├── step2-investor-data.ts# 수급/지표 (Naver/KRX) → stock_cache
    │   ├── step3-shortsell.ts    # 공매도 (KRX) → stock_cache
    │   ├── step4-scoring.ts      # 축별 점수 → stock_scores
    │   ├── step5-ai-report.ts    # AI 리포트 생성
    │   ├── step6-market-data.ts  # 시황 (Yahoo/FRED/CNN) → market_indicators
    │   ├── step7-events.ts       # 공휴일/금리결정일/만기일 → market_events
    │   └── step8-cleanup.ts      # daily_prices 2년 초과분 삭제
    └── shared/
        ├── supabase.ts           # DB 클라이언트
        └── logger.ts             # batch_runs 상태 업데이트
```

**일봉 수집 성능:**
- 4000종목 → 50개씩 80청크 병렬 fetch
- 청크 간 100ms 딜레이 (Naver 부하 분산)
- 예상 소요: 약 2~3분

---

## 4. DB 스키마 변경

### 4-1. `stock_scores` (신규)

| 컬럼 | 타입 | 설명 |
|------|------|------|
| symbol | text | PK, FK → stock_cache |
| scored_at | date | 점수 계산 기준일 (정규장 종가 기준) |
| prev_close | numeric | 전일 종가 (모멘텀 실시간 보정 기준) |
| score_value | numeric | 가치 점수 |
| score_growth | numeric | 성장 점수 |
| score_supply | numeric | 수급 점수 |
| score_momentum | numeric | 모멘텀 점수 (T-1 기준) |
| score_risk | numeric | 리스크 점수 |
| score_signal | numeric | 신호 점수 |
| updated_at | timestamptz | |

**모멘텀 실시간 보정:**
```
score_momentum_adjusted
  = score_momentum + (current_price - prev_close) / prev_close * K
```
- `stock_cache.current_price`: 15분마다 GHA가 업데이트
- `K`: 보정 계수 (구현 시 실험적으로 결정)
- 계산은 API 레이어 또는 Supabase RPC에서 처리

### 4-2. `batch_runs` (신규)

| 컬럼 | 타입 | 설명 |
|------|------|------|
| id | uuid | PK |
| workflow | text | 'daily-batch' |
| mode | text | 'full' \| 'repair' \| 'prices-only' |
| status | text | 'pending' \| 'running' \| 'done' \| 'failed' |
| triggered_by | text | 'schedule' \| 'manual' |
| started_at | timestamptz | |
| finished_at | timestamptz | |
| summary | jsonb | 수집 건수, 에러 등 |

Supabase Realtime으로 프론트엔드가 상태 구독 → 완료 시 데이터 재조회.

### 4-3. `daily_prices` 변경

- `is_provisional boolean DEFAULT false` 컬럼 추가
- 장중 Yahoo 임시 캔들: `is_provisional = true`
- 배치 확정 후: `is_provisional = false` (덮어씀)

---

## 5. 외부 API 역할 분리

| API | 역할 | 호출 주체 |
|-----|------|----------|
| Naver | 전종목 현재가(bulk) + 일봉 + 수급 | GHA 전용 |
| KRX | 공매도 + 투자지표 | GHA 전용 |
| Yahoo Finance | VIX/환율/WTI/금 등 해외 시황 | GHA 전용 |
| FRED | HY스프레드, 수익률곡선 | GHA 전용 |
| CNN Fear&Greed | 공포탐욕지수 | GHA 전용 |
| OpenAI | AI 추천 생성 | Vercel (키 보호) |

**Vercel은 어떤 외부 API도 직접 호출하지 않음.**

---

## 6. Vercel API 변경

### 유지 (경량화)

**`/api/v1/stock-ranking`**
- 제거: 네이버/KRX fetch, 실시간 점수 계산
- 유지: stock_scores + stock_cache JOIN → 가중치 합산 → 정렬/필터/페이지네이션
- 2102줄 → 약 100줄

**`/api/v1/collector`**
- Android SMS 수신 엔드포인트, 변경 없음

**`/api/v1/ai-recommendations/generate`**
- OpenAI 키 보호 목적, 변경 없음

**`/api/v1/admin/trigger-batch`** (신규)
- GitHub PAT로 workflow_dispatch 호출
- batch_runs에 `{status: 'pending'}` 삽입

### 삭제 대상

| 파일 | 이유 |
|------|------|
| `cron/daily-prices/route.ts` | GHA step1~5로 이관 |
| `cron/daily-prices-repair/route.ts` | GHA repair mode로 대체 |
| `cron/market-indicators/route.ts` | GHA step6으로 이관 |
| `cron/market-events/route.ts` | GHA step7로 이관 |
| `cron/intraday-prices/route.ts` | 미사용 |
| `prices/route.ts` | stock_cache 직접 쿼리로 대체 |
| `market-indicators/route.ts` | market_indicators 직접 쿼리로 대체 |
| `vercel.json` crons 섹션 | GHA로 전환 후 제거 |

---

## 7. 구현 순서

1. **DB 마이그레이션**: `stock_scores`, `batch_runs` 생성, `daily_prices.is_provisional` 추가
2. **GHA 스크립트**: `.github/scripts/` + step1~8 + prices-only
3. **GHA workflow**: `daily-batch.yml` (3개 스케줄 + workflow_dispatch)
4. **stock-ranking 경량화**: 외부 API 호출 제거, DB SELECT + 가중치 합산만
5. **trigger-batch API**: PAT 기반 GHA dispatch 엔드포인트
6. **프론트엔드**: prices/market-indicators API 대신 supabase-js 직접 쿼리로 전환
7. **Vercel Cron 제거**: GHA 검증 후 삭제
8. **GitHub Secrets 등록**: `SUPABASE_URL`, `SUPABASE_SERVICE_KEY`, `OPENAI_API_KEY`, `FRED_API_KEY`
9. **Vercel Secrets 등록**: `GH_PAT` (trigger-batch용)

---

## 8. 비용/제약 정리

| 항목 | 현재 | 변경 후 |
|------|------|---------|
| Vercel Cron | 2개 (무료 제약) | 0개 |
| Vercel 함수 타임아웃 | 10초 (병목) | 문제 없음 (DB 읽기만) |
| GHA | 없음 | 무제한 (public repo) |
| Supabase DB | 500MB, 점진적 증가 | Step8 자동 삭제로 영구 유지 |
| Naver API | Vercel + GHA 혼용 | GHA 전용 (차단 위험 감소) |
