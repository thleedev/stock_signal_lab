# 종목 상세 슬라이드 패널 개선 설계

> 날짜: 2026-03-26
> 상태: 승인 대기

## 1. 배경 및 목표

### 현재 문제점
1. **느린 초기 로딩**: 모달 열기 → 6개 API + N개 멤버십 API 완료 대기 → 렌더 (체감 1~3초)
2. **제한적 데이터 노출**: `stock-ranking` API에 풍부한 점수/수급/DART 데이터가 있지만 모달에서 미사용
3. **AI 분석 부족**: 단순 신호 횟수/비율만 표시, 점수 산정 이유와 해설 없음

### 목표
- 패널 열기 즉시 핵심 정보 렌더 (체감 0ms)
- AI 투자의견 점수별 상세 근거 표시
- 수급/컨센서스/DART/기술적 지표 등 전체 데이터 노출
- 2컬럼 레이아웃으로 정보 밀도 극대화

## 2. UI 구조: 풀스크린 슬라이드 패널

### 패널 컨테이너
- 오른쪽에서 슬라이드 인하는 풀하이트 패널 (`right: 0`, `height: 100vh`)
- 데스크톱: 너비 `85vw`, `max-width: 1200px`
- 모바일 (`< 768px`): 풀스크린 `100vw`
- 배경: 반투명 오버레이 (`bg-black/50`), 클릭 시 패널 닫기
- 애니메이션: `transform: translateX(100%)` → `translateX(0)`, `300ms ease-out`
- ESC 키로 닫기 유지

### 2컬럼 레이아웃

```
┌─────────────────────────────────────────────────────┐
│ 헤더 (고정, 전체 너비)                                │
│ 종목명 · 심볼 · 현재가 · 변동률 · 등급배지 · ✕ 닫기   │
├──────────────────────┬──────────────────────────────┤
│ 왼쪽 컬럼 (55%)       │ 오른쪽 컬럼 (45%)             │
│ 스크롤 독립           │ 스크롤 독립                   │
├──────────────────────┼──────────────────────────────┤
│ ① AI 투자의견 카드    │ ④ 캔들 차트                   │
│   총점 게이지         │   (기간 선택 30/60/90)        │
│   항목별 점수 바      │   신호 마커 + 포트 오버레이    │
│   각 점수 근거 상세   │                              │
│                      │ ⑤ 투자지표 그리드              │
│ ② 수급 동향          │   PER/PBR/ROE/EPS/BPS        │
│   외국인/기관 순매수  │   배당수익률, 시가총액         │
│   연속매수 일수       │   52주 고저, 거래량            │
│   공매도 비율         │                              │
│                      │ ⑥ 컨센서스                    │
│ ③ 기술적 시그널      │   목표주가, 투자의견           │
│   활성 패턴 배지들    │   추정PER, 현재가 괴리율       │
│   RSI 게이지         │                              │
│   신호 이력 테이블    │ ⑦ DART 공시 정보              │
│                      │   관리종목, CB/BW, 대주주      │
│                      │   감사의견, 자사주, 성장률      │
│                      │                              │
│                      │ ⑧ 포트폴리오 / 관심그룹        │
│                      │   (아코디언, lazy load)        │
└──────────────────────┴──────────────────────────────┘
```

모바일 (`< 768px`): 단일 컬럼. 순서 — 헤더 → AI투자의견 → 차트 → 투자지표 → 수급 → 기술적 시그널 → 컨센서스 → DART → 포트폴리오/그룹

## 3. 데이터 로딩 전략 (3단계 점진적 로딩)

### 전역 상태 변경
`openStockModal(symbol, name?, initialData?)` — `initialData`에 `StockRankItem` 객체를 넘기면 즉시 표시.

### 로딩 단계

| 단계 | 시점 | API | 렌더 대상 |
|------|------|-----|----------|
| 즉시 (0ms) | 패널 열기 | 없음 (`initialData` 사용) | 헤더, AI투자의견, 수급, 기술적 배지, 컨센서스, DART, 투자지표(일부) |
| 1차 (~200ms) | 패널 마운트 | `metrics` + `signals` + `daily-prices` 병렬 | 차트, 투자지표 갱신, 신호 이력 테이블 |
| 2차 (인터랙션) | 포트폴리오/그룹 아코디언 펼침 | `portfolios` + `trades` + `watchlist-groups` + 멤버십 | 포트폴리오/그룹 관리 |

### initialData 없이 열리는 경우
랭킹 테이블 외(관심종목 위젯, 포트폴리오 등)에서 열 때는 `initialData` 없음.
→ 전체 스켈레톤 표시 → 1차 fetch에서 `stock-ranking` 스냅샷의 해당 종목 데이터도 함께 조회.

## 4. AI 투자의견 카드 상세

### 총점 영역
- **종합 점수**: `score_total` (0~100) — 원형 게이지
- **등급 배지**: `grade` (예: "A+", "B") — 컬러 배지
- **추천 문구**: `recommendation` (예: "적극매수", "관망")
- **성격 태그**: `characters[]` → 칩 형태 (예: "저평가", "수급우위")

### 항목별 점수 바 (5개)

#### 1) 신호 신뢰도 (`score_signal` / 100)
- "30일간 매수신호 {signal_count_30d}회"
- "최근 신호: {latest_signal_type} ({latest_signal_date})"
- "신호가 대비 현재가 {gap_pct}%"

#### 2) 기술적 모멘텀 (`score_momentum` / 100)
- "52주 범위 내 위치 {close_position * 100}%"
- "당일 등락률 {price_change_pct}%"
- 활성 패턴 배지: golden_cross, bollinger_bottom, phoenix_pattern, macd_cross, volume_surge, week52_low_near, double_top, disparity_rebound, volume_breakout, consecutive_drop_rebound 중 true인 것

#### 3) 밸류에이션 (`score_valuation` / 100)
- "PER {per} / PBR {pbr} / ROE {roe}%"
- forward_per 있으면 "추정PER {forward_per}"
- "배당수익률 {dividend_yield}%"
- 성장률 있으면 "매출 YoY {revenue_growth_yoy}%, 영업이익 YoY {operating_profit_growth_yoy}%"

#### 4) 수급 동향 (`score_supply` / 100)
- "외국인 순매수/순매도 {abs(foreign_net_qty)}주 (연속 {foreign_streak}일)"
- "기관 순매수/순매도 {abs(institution_net_qty)}주 (연속 {institution_streak}일)"
- "5일 누적 — 외국인 {foreign_net_5d}주, 기관 {institution_net_5d}주"
- "공매도 비율 {short_sell_ratio}%"

#### 5) 리스크 (`score_risk` / 0, 감산)
- 0이면 "리스크 요인 없음" (초록)
- 감산 항목 나열: is_managed → "관리종목", has_recent_cbw → "CB/BW 최근 발행", major_shareholder_pct < 20 → "대주주 지분 {pct}%", audit_opinion !== '적정' → "감사의견: {opinion}"

### 데이터 소스
`initialData`(`StockRankItem`)에 위 필드 전부 포함 → 추가 API 호출 없이 즉시 렌더.

## 5. 섹션별 상세

### ② 수급 동향 (왼쪽 컬럼)
- 외국인/기관 2행 × 3열 테이블: `당일 | 5일 누적 | 연속일수`
- 순매수 빨강, 순매도 파랑
- 공매도 비율 바 (낮을수록 긍정)
- 거래대금: `trading_value` 억 단위 변환
- **데이터 소스**: `initialData` 즉시

### ③ 기술적 시그널 (왼쪽 컬럼)
- RSI 게이지 (0~100, 30 이하 과매도 / 70 이상 과매수 구간)
- 활성 패턴 배지 그리드: true인 플래그만 칩 표시 (10개 중)
- 신호 이력 테이블: 최대 20건 (날짜/소스/타입/신호가)
- **데이터 소스**: 배지 `initialData` 즉시, 이력 테이블 1차 fetch

### ④ 캔들 차트 (오른쪽 컬럼)
- 기존 `StockChartSection` 재활용
- 1차 fetch 전 스켈레톤
- **데이터 소스**: 1차 fetch (`daily-prices`)

### ⑤ 투자지표 그리드 (오른쪽 컬럼)
- 3열 그리드: PER/PBR/ROE, EPS/BPS/배당수익률, 시가총액/거래량/52주 고저
- `initialData` 즉시 표시 → 1차 fetch `metrics`로 덮어쓰기
- **데이터 소스**: 즉시 + 1차 갱신

### ⑥ 컨센서스 (오른쪽 컬럼)
- 목표주가 vs 현재가 괴리율 표시
- 투자의견 (1~5, "매수/중립/매도" 라벨)
- 추정PER (`forward_per`)
- **데이터 소스**: `initialData` 즉시

### ⑦ DART 공시 정보 (오른쪽 컬럼)
- 경고 배지 (빨강): 관리종목, CB/BW, 비적정 감사의견
- 긍정 배지 (초록): 자사주 매입
- 수치: 대주주 지분율/변동, 매출/영업이익 성장률
- **데이터 소스**: `initialData` 즉시

### ⑧ 포트폴리오 / 관심그룹 (오른쪽 컬럼 하단)
- 아코디언 접힌 상태 시작
- 펼칠 때 2차 fetch (portfolios + trades + watchlist-groups + 멤버십)
- 기존 `PortfolioManagementSection`, `GroupManagementSection` 재활용
- **데이터 소스**: 2차 lazy fetch

## 6. 컴포넌트 구조

```
StockModalProvider (기존, 수정)
├── StockDetailPanel (신규 — 슬라이드 패널 컨테이너)
│   ├── PanelHeader (신규 — 종목명/가격/등급/닫기)
│   ├── LeftColumn
│   │   ├── AiOpinionCard (신규 — 총점 게이지 + 항목별 점수바 + 근거)
│   │   ├── SupplyDemandSection (신규 — 외국인/기관/공매도)
│   │   └── TechnicalSignalSection (신규 — RSI + 패턴배지 + 신호이력)
│   └── RightColumn
│       ├── StockChartSection (기존 재활용)
│       ├── MetricsGrid (기존 로직 추출 → 독립 컴포넌트)
│       ├── ConsensusSection (신규 — 목표주가/투자의견/추정PER)
│       ├── DartInfoSection (신규 — 공시 리스크/긍정 플래그)
│       └── PortfolioGroupAccordion (기존 2개 섹션 래핑, lazy)
```

## 7. 파일 변경 범위

| 분류 | 파일 | 변경 |
|------|------|------|
| 수정 | `stock-modal-context.tsx` | `openStockModal` 시그니처에 `initialData?` 추가 |
| 수정 | 모달 트리거 4곳 | `initialData` 전달 |
| 삭제 | `StockDetailModal.tsx` | `StockDetailPanel.tsx`로 교체 |
| 리네이밍 | `StockModalHeader.tsx` → `PanelHeader.tsx` | 등급배지 추가 |
| 재활용 | `StockChartSection` | 변경 없음 |
| 재활용 | `PortfolioManagementSection`, `GroupManagementSection` | 변경 없음 |
| 신규 | `StockDetailPanel.tsx` | 슬라이드 패널 컨테이너 |
| 신규 | `AiOpinionCard.tsx` | AI 투자의견 카드 |
| 신규 | `SupplyDemandSection.tsx` | 수급 동향 |
| 신규 | `TechnicalSignalSection.tsx` | 기술적 시그널 |
| 신규 | `ConsensusSection.tsx` | 컨센서스 |
| 신규 | `DartInfoSection.tsx` | DART 공시 정보 |
| 신규 | `MetricsGrid.tsx` | 투자지표 그리드 (기존 로직 추출) |
| 신규 | `PortfolioGroupAccordion.tsx` | 포트/그룹 아코디언 래퍼 |

## 8. API 변경

신규 API 없음. 기존 API 전부 활용:
- `GET /api/v1/stock/[symbol]/metrics`
- `GET /api/v1/signals?symbol={symbol}`
- `GET /api/v1/stock/[symbol]/daily-prices`
- `GET /api/v1/user-portfolio` + `trades` + `watchlist-groups`

`StockRankItem` (stock-ranking API 응답)이 점수/지표/DART 데이터를 모두 포함하므로 `initialData`로 전달하여 즉시 렌더.

## 9. 성능 개선 예상

| 항목 | 현재 | 개선 후 |
|------|------|---------|
| 초기 렌더 | 6 API 완료 후 (1~3초) | `initialData` 즉시 (0ms) |
| 차트 표시 | 전체 로딩 완료 후 | 1차 fetch 후 (~200ms) |
| 포트/그룹 | 항상 로드 | 필요 시만 lazy load |
| 멤버십 N+1 | 그룹 수만큼 API 호출 | 2차 fetch로 지연 |
