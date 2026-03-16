# 메인 대시보드 재설계 설계 문서

**날짜:** 2026-03-16
**대상 페이지:** `/` (메인 대시보드)
**목표:** 각 페이지의 핵심 요약을 그리드 위젯으로 표시하는 허브형 대시보드로 재편

---

## 1. 배경 및 목표

현재 메인 대시보드는 앱 기능이 확장되면서 추가된 페이지들(위험 경보 시스템, 가상 포트폴리오, 소스별 포트폴리오)을 반영하지 못하고 있다. 목표는 모든 주요 페이지의 핵심 지표를 요약 카드(위젯) 형태로 배치하여, 사용자가 대시보드 하나에서 전체 현황을 파악하고 각 페이지로 이동할 수 있는 허브로 재편하는 것이다.

---

## 2. 레이아웃 구조

```text
┌─────────────────────────────────────────────────┐
│  위험 경보 배너 (전체 너비) → /market            │
└─────────────────────────────────────────────────┘

┌─────────┬─────────┬─────────┬─────────────────┐
│ 라씨매매 │ 스톡봇   │ 퀀트    │  투자 시황      │
│ → /signals?source=lassi/stockbot/quant │→/market│
└─────────┴─────────┴─────────┴─────────────────┘

┌──────────────────────┬──────────────┬──────────┐
│  관심종목             │  투자 현황   │ 가상 PF  │
│  (col-span-2)        │  → /investment│→/my-portfolio│
│  → /stocks           │              │          │
└──────────────────────┴──────────────┴──────────┘

┌─────────────┬─────────────┬─────────────────────┐
│ 라씨 포트폴리오│스톡봇 포트폴리오│퀀트 포트폴리오  │
│→/portfolio/lassi│→/portfolio/stockbot│→/portfolio/quant│
└─────────────┴─────────────┴─────────────────────┘
```

### 반응형 그리드 규칙

| 행 | 모바일 (기본) | md (768px+) | lg (1024px+) |
| ---- | -------------- | ----------- | ------------ |
| 위험 배너 | 1열 | 1열 | 1열 |
| 신호 3 + 시황 | 1열 | 2열 | 4열 |
| 관심종목 + 투자현황 + 가상PF | 1열 | 2열 (관심종목 full) | 4열 (관심종목 span-2) |
| 소스별 포트폴리오 | 1열 | 2열 | 3열 |

---

## 3. 위젯별 상세 명세

### 3.1 위험 경보 배너 (전체 너비)

- **데이터 소스:** `market_score_history` 최신 레코드 → `risk_index` 컬럼
- **표시 내용:**
  - 위험 지수 숫자 (0~100)
  - 위험 레벨 라벨: 안전(0~25) / 주의(26~50) / 위험(51~75) / 극위험(76~100)
- **구현 방식:** `market-client.tsx`의 `RiskAlertBanner`는 파일-로컬 함수라 재사용 불가. 대시보드용 `DashboardRiskBanner` 컴포넌트를 새로 작성하며, `risk_index` 하나만 props로 받는 단순 버전으로 구현. `dangerCount`/`validCount`는 표시하지 않음 (지표 개수 계산에 `market_indicators` 추가 조회가 필요하므로 생략)
- **인터랙션:** 카드 전체 클릭 → `/market`

### 3.2 신호 카드 × 3 (라씨매매 / 스톡봇 / 퀀트)

- **데이터 소스:** `signals` 테이블, 오늘 날짜 기준
- **쿼리:** `.eq("source", source).gte("timestamp", todayStart)`
- **표시 내용:**
  - 소스명 + 색상 테마 (라씨=빨강, 스톡봇=초록, 퀀트=파랑)
  - BUY 계열 신호 수 (BUY, BUY_FORECAST)
  - SELL 계열 신호 수 (SELL, SELL_COMPLETE)
- **인터랙션:** 클릭 → `/signals?source={lassi|stockbot|quant}` (해당 파라미터는 signals 페이지에서 이미 처리됨)

### 3.3 투자 시황 카드

- **데이터 소스:** `market_score_history` 최신 레코드
- **표시 내용:**
  - 마켓 스코어 (`market_score` 컬럼)
  - 이벤트 리스크 스코어 (`event_risk_score` 컬럼)
  - 가장 가까운 이벤트 1개: `market_events` 테이블에서 `date >= today` 기준 첫 번째 레코드의 제목 + D-day
- **인터랙션:** 클릭 → `/market`

### 3.4 관심종목 카드 (2열 폭)

- **데이터 소스:** `stock_cache` 테이블, `.eq("is_favorite", true)`, 최대 5개
- **표시 내용:**
  - 종목명 + 현재가 + 일일 등락률 (색상: 상승=빨강, 하락=파랑)
- **실시간 갱신:** 기존 `usePriceRefresh` 훅 유지 (클라이언트 컴포넌트로 분리)
- **인터랙션:** 카드 헤더 클릭 → `/stocks`

### 3.5 투자 현황 카드

- **데이터 소스:** `watchlist` 테이블 (`.select("id").eq("status", "active")` 등으로 보유 종목 수만 집계)
- **표시 내용:**
  - 보유 종목 수 (서버에서 count 쿼리)
  - ※ 수익률은 서버에서 계산 불가 (실시간 가격 필요). 카드에서는 보유 종목 수만 표시하고 "상세 보기" 유도
- **인터랙션:** 클릭 → `/investment`

### 3.6 가상 포트폴리오 카드

- **특성:** `/my-portfolio` 페이지가 `"use client"` 컴포넌트로 API를 통해 데이터를 받아오는 구조
- **데이터 소스:** `/api/v1/user-portfolio/summary` 엔드포인트를 신규 생성. 해당 API는 `virtual_trades` 테이블에서 소스별 오픈 포지션 수익률을 집계하여 반환
- **표시 내용:**
  - 전체 보유 포지션 수
  - 소스별 간략 현황 (라씨/스톡봇/퀀트 각 보유 수)
- **인터랙션:** 클릭 → `/my-portfolio`
- **구현:** 클라이언트 컴포넌트로 작성, `useEffect`로 API 호출

### 3.7 소스별 포트폴리오 카드 × 3

- **데이터 소스:** `/api/v1/user-portfolio/summary` (3.6과 동일 엔드포인트, 소스별 분리 데이터 사용)
- **표시 내용:**
  - 소스명 (라씨매매 / 스톡봇 / 퀀트)
  - 해당 소스 보유 포지션 수
- **인터랙션:** 클릭 → `/portfolio/{lassi|stockbot|quant}`

---

## 4. 데이터 페칭 전략

| 위젯 | 페칭 위치 | 방식 |
| ------ | ----------- | ------ |
| 위험 경보 배너 | 서버 (`page.tsx`) | Supabase 서버 클라이언트 |
| 신호 카드 × 3 | 서버 (`page.tsx`) | Supabase 서버 클라이언트 |
| 투자 시황 카드 | 서버 (`page.tsx`) | Supabase 서버 클라이언트 |
| 관심종목 카드 | 서버 초기 + 클라이언트 갱신 | `usePriceRefresh` 훅 |
| 투자 현황 카드 | 서버 (`page.tsx`) | Supabase count 쿼리 |
| 가상 PF 카드 | 클라이언트 | `/api/v1/user-portfolio/summary` |
| 소스별 포트폴리오 × 3 | 클라이언트 (가상PF 카드와 공유) | `/api/v1/user-portfolio/summary` |

---

## 5. 컴포넌트 구조

```text
app/page.tsx (서버 컴포넌트)
  ├── DashboardRiskBanner          # 위험 경보 배너 (신규, risk_index만 표시)
  ├── SignalSummaryCard × 3        # 신호 요약 카드 (신규)
  ├── MarketSummaryCard            # 투자 시황 요약 카드 (신규, EventSummaryCard 대체)
  ├── WatchlistWidget              # 관심종목 위젯 (클라이언트, DashboardPrices 대체)
  ├── InvestmentSummaryCard        # 투자 현황 요약 카드 (신규)
  └── VirtualPortfolioSection      # 가상PF + 소스별 포트폴리오 (클라이언트, 신규)
        ├── VirtualPortfolioCard   # 전체 가상 PF 카드
        └── SourcePortfolioCard × 3 # 소스별 포트폴리오 카드
```

모든 신규 컴포넌트는 `web/src/components/dashboard/` 하위에 위치.

---

## 6. 신규 API 엔드포인트

**`GET /api/v1/user-portfolio/summary`**

- 응답:

  ```json
  {
    "total_count": 12,
    "by_source": {
      "lassi": { "count": 5 },
      "stockbot": { "count": 4 },
      "quant": { "count": 3 }
    }
  }
  ```

- 데이터 소스: `virtual_trades` 테이블, `status = 'open'` 기준 집계

---

## 7. 영향 범위

- **수정:** `web/src/app/page.tsx` (전면 재작성)
- **신규:** `web/src/components/dashboard/` 하위 위젯 컴포넌트들
- **신규:** `web/src/app/api/v1/user-portfolio/summary/route.ts`
- **재사용:** `usePriceRefresh` 훅, Supabase 서버/클라이언트
- **제거:** 기존 `EventSummaryCard` 인라인 사용 → `MarketSummaryCard`로 대체, 기존 `DashboardPrices` → `WatchlistWidget`으로 대체
- **변경 없음:** 각 개별 페이지 (`/market`, `/signals`, `/investment` 등)

---

## 8. 비기능 요건

- 모바일 반응형: §2 반응형 그리드 규칙 준수
- 기존 다크 테마 유지
- 위젯 클릭 영역에 hover 효과 (cursor-pointer, hover:brightness-110 등)
