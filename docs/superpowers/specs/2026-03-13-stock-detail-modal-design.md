# 종목상세 팝업 모달 & 포트/그룹 관리 설계

**날짜:** 2026-03-13
**상태:** 승인됨

---

## 개요

종목상세 화면을 전페이지 이동 방식에서 전역 팝업 모달로 전환한다. 모달 내에서 포트폴리오 추가/삭제, 관심그룹 추가/삭제를 직접 관리할 수 있으며, 어느 포트/그룹에 속해있는지 명확히 표시한다. AI 신호 이력 섹션에 종목분석 데이터를 통합한다.

---

## 범위

- 기존 `/stock/[symbol]` 페이지는 유지 (직접 URL 접근 지원)
- 앱 내 모든 종목 클릭 → 전역 모달로 표시
- 매수 버튼 제거 → 포트에 추가/삭제 + 관심그룹 관리로 대체

---

## 아키텍처

### 전역 모달 시스템

**방식:** React Context 기반 전역 상태

```text
app/layout.tsx (서버 컴포넌트 유지)
└── ClientProviders (신규 'use client' 래퍼 컴포넌트)
    └── StockModalProvider
        ├── useStockModal() hook
        │   ├── openStockModal(symbol: string)
        │   └── closeStockModal()
        └── StockDetailModal (최상위 오버레이 렌더링)
```

`layout.tsx`는 서버 컴포넌트이므로 직접 Provider를 추가할 수 없다. 대신 `ClientProviders` 래퍼 컴포넌트(`'use client'`)를 생성하여 `{children}`을 감싸는 방식으로 주입한다.

**신규 파일:**

- `web/src/components/layout/client-providers.tsx` — `'use client'` 래퍼, StockModalProvider 포함
- `web/src/contexts/stock-modal-context.tsx` — Context + Provider + hook
- `web/src/components/stock-modal/StockDetailModal.tsx` — 모달 컴포넌트 (기존 `/stock/[symbol]` 콘텐츠 이식)
- `web/src/components/stock-modal/StockModalHeader.tsx` — 헤더 (가격 + 배지)
- `web/src/components/stock-modal/StockAiAnalysis.tsx` — 단일 종목 AI 분석 컴포넌트
- `web/src/components/stock-modal/PortfolioManagementSection.tsx` — 포트 관리 섹션
- `web/src/components/stock-modal/GroupManagementSection.tsx` — 그룹 관리 섹션

**수정 파일:**

- `web/src/app/layout.tsx` — `{children}`을 `<ClientProviders>`로 감싸기
- `web/src/components/common/stock-action-menu.tsx` — 상세보기 router.push → openStockModal(), 포트 삭제 버그 수정
- 각 페이지의 종목 행 클릭 핸들러 → openStockModal()로 교체 (Link → button 변환 포함)

---

## 모달 레이아웃

### 헤더 영역

```text
┌────────────────────────────────────────────────────┐
│ 삼성전자 (005930)          ₩85,000  ▲ +1.2%   [X] │
│                                                    │
│ 포트폴리오: [성장주 포트] [배당주 포트]            │
│ 관심그룹:   [AI추천종목] [관심1그룹]               │
└────────────────────────────────────────────────────┘
```

- 속한 포트폴리오 → 파란색 배지 (없으면 "없음")
- 속한 관심그룹 → 초록색 배지 (없으면 "없음")
- 배지 클릭 → 해당 섹션으로 스크롤 (섹션 id: `#portfolio-section`, `#group-section`)

### 본문 (스크롤 가능)

```text
① 가격 차트 + 투자지표
   - 캔들 차트 (일별 시세: /api/v1/stock/[symbol]/daily-prices 또는 기존 서버 로직 API화)
   - 투자지표 (PER, PBR, ROE 등: /api/v1/stock/[symbol]/metrics)
② AI 신호 & 분석
   - AI 스코어 배지 (골든크로스, 볼린저하단, 피닉스패턴 등)
   - AI 추천 점수
   - 신호 이력 테이블
③ 포트폴리오 관리 섹션 (id="portfolio-section")
   - 포트별 추가/삭제 인터랙션
④ 관심그룹 관리 섹션 (id="group-section")
   - 그룹별 체크박스 토글
```

### 하단 액션 버튼 (고정)

```text
[포트에 추가]  [관심그룹 관리]
```

- 포트에 추가 → 기존 TradeModal (mode="buy") 오픈
- 관심그룹 관리 → `#group-section`으로 스크롤

---

## 데이터 페칭 전략

모달 오픈 시 `symbol`을 기반으로 클라이언트에서 병렬 페칭:

```text
openStockModal(symbol)
  ├── /api/v1/prices?symbol=X              (현재가 · 실시간)
  ├── /api/v1/stock/[symbol]/daily-prices  (캔들 차트용 90일 일별 시세 — 신규 API)
  ├── /api/v1/stock/[symbol]/metrics       (투자지표: PER, PBR, ROE 등 — 신규 API)
  ├── /api/v1/signals?symbol=X             (신호 이력 + AI 분석)
  ├── /api/v1/user-portfolio/trades?symbol=X  (포트 보유 여부 및 trade_id 조회)
  └── /api/v1/watchlist-groups             (그룹 전체 목록 + 멤버십 정보)
```

- `daily-prices` 신규 API는 기존 서버 컴포넌트의 로직을 route handler로 래핑한다. `daily_prices` 테이블(Supabase)을 우선 조회하고, 데이터 없으면 `fetchNaverDailyPrices`(네이버 외부 API)로 폴백하는 기존 로직을 그대로 포함한다.
- `metrics` 신규 API는 `stock_cache` 테이블에서 PER, PBR, ROE 등 투자지표를 조회하는 route handler로 래핑한다.
- `/api/v1/user-portfolio/trades?symbol=X`는 기존 엔드포인트에 symbol 필터 파라미터를 추가한다.
- 로딩 중 스켈레톤 UI 표시, 에러 시 재시도 버튼.

---

## 포트폴리오 관리 섹션 상세

```text
포트폴리오
┌──────────────────────────────────────────┐
│ ✓ 성장주 포트 (3건)    [추가] [삭제]    │
│ ✗ 배당주 포트          [추가]            │
│ ✗ 단기매매             [추가]            │
└──────────────────────────────────────────┘
```

**포트 추가 흐름:**

1. [추가] 클릭 → `TradeModal` (mode="buy", symbol 자동 입력) 오픈
2. 사용자가 가격·목표가·손절가·메모 입력 후 확인
3. POST `/api/v1/user-portfolio/trades` → 성공 시 모달 데이터 갱신

**포트 삭제 흐름:**

1. 모달 오픈 시 `GET /api/v1/user-portfolio/trades?symbol=X`로 해당 종목의 trades 목록을 조회, 포트별로 `trade_id` 목록을 `PortfolioManagementSection` 상태로 유지
2. [삭제] 클릭 → 확인 다이얼로그
3. DELETE `/api/v1/user-portfolio/trades?trade_id=X` (상태에서 가장 최근 BUY 레코드의 `id` 사용)
   - 매도 완료(SELL 레코드 존재) 시 409 에러 → "이미 거래 완료된 종목입니다" 토스트 표시
   - 미완료(BUY만 존재) 시 정상 삭제
4. 로컬 상태 갱신 → 헤더 배지 즉시 업데이트

**복수 거래 표시 정책:** 동일 포트에 같은 종목이 여러 BUY 레코드로 존재하면 "(N건)" 건수를 표시한다. [삭제]는 가장 최근 BUY 레코드 1건을 삭제한다.

**`stock-action-menu.tsx` 기존 버그 수정:** 현재 `isInPortfolio` 상태일 때 `/api/v1/watchlist`를 잘못 호출하는 버그가 있다. 이번 작업에서 `/api/v1/user-portfolio/trades?symbol=X` 호출로 수정한다.

---

## 관심그룹 관리 섹션 상세

```text
관심그룹
┌──────────────────────────────────┐
│ ☑ AI추천종목                     │
│ ☑ 관심1그룹                      │
│ ☐ 단기매매                       │
└──────────────────────────────────┘
```

**토글 흐름:**

- 체크(추가) → POST `/api/v1/watchlist-groups/[id]/stocks` (body: `{ symbol, name }`) — 종목명(`name`)은 모달 오픈 시 전달받아 상태로 유지
- 언체크(삭제) → DELETE `/api/v1/watchlist-groups/[id]/stocks/[symbol]`
- 헤더 배지 즉시 업데이트

---

## AI 신호 & 분석 통합

기존 신호 이력 섹션에 단일 종목용 AI 분석 데이터를 통합한다.

**표시 정보:**

- AI 스코어 배지 (골든크로스, 볼린저하단, 피닉스패턴, 거래량급등 등)
- AI 추천 점수 (별점/수치)
- GAP 분석 (현재가 vs 매수 신호가 괴리율)
- 신호 이력 테이블 (날짜, 소스, 타입, 가격)

**구현 방식:**

`UnifiedAnalysisSection`은 전체 종목 목록 구조이므로 직접 재사용하지 않는다. 해당 컴포넌트에서 단일 종목 표시에 필요한 AI 배지·점수·GAP 로직만 추출하여 `StockAiAnalysis` 컴포넌트를 신규 생성한다. 데이터는 `/api/v1/signals?symbol=X` 엔드포인트를 재사용한다.

---

## 종목 클릭 교체 범위

| 페이지 | 현재 동작 | 변경 후 |
| --- | --- | --- |
| `/signals` AI 신호 탭 | 행 클릭 → `/stock/[symbol]` | `openStockModal(symbol)` |
| `/signals` 종목분석 탭 | 행 클릭 → `/stock/[symbol]` | `openStockModal(symbol)` |
| `/stocks` 종목 목록 | 행 클릭 → `/stock/[symbol]` | `openStockModal(symbol)` |
| `/my-portfolio` | `<Link href="/stock/[symbol]">` | `<button>` → `openStockModal(symbol)` |
| `/portfolio` AI 포트 | 행 클릭 → `/stock/[symbol]` | `openStockModal(symbol)` |
| `/` 대시보드 | 종목 링크 → `/stock/[symbol]` | `openStockModal(symbol)` |
| `stock-action-menu` | 상세보기 → `router.push()` | `openStockModal(symbol)` |

---

## 매수 버튼 제거 범위

| 위치 | 현재 | 변경 후 |
| --- | --- | --- |
| `stock-price-header.tsx` | 매수 버튼 | 제거 |
| `stock-action-menu.tsx` | 포트에 추가 (TradeModal) | 유지 (동작 동일) |
| `stock-portfolio-overlay.tsx` | 매수 버튼 | 제거 |
| 모달 하단 | — | [포트에 추가] 버튼 신규 |

---

## 비고

- 기존 `/stock/[symbol]` 서버 컴포넌트 페이지는 유지 (SEO, 직접 링크 지원)
- 모달은 클라이언트 컴포넌트로 구현
- 가상 거래 이력(`virtual_trades`) 섹션은 모달에서 제외 (정보 과부하 방지)
- 모바일: 풀스크린 오버레이로 표시
- ESC 키 / 배경 클릭으로 모달 닫기 지원
