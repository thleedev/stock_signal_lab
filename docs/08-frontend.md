# 프론트엔드

> Next.js 16 App Router + React 19 화면 구성과 데이터 로딩 구조를 기록합니다.
> 조사 기준일: 2026-07-22

기술 스택: Tailwind CSS v4, lightweight-charts 4.2.3(캔들), recharts 3.8.1(성과 차트), @dnd-kit(드래그), lucide-react(아이콘).

## 1. 라우트 목록

| URL | 제목 | 렌더링 |
|-----|------|--------|
| `/` | 대시보드 — 신호·시장·포트폴리오 요약 | 서버, force-dynamic |
| `/stocks` | 종목 — 관심그룹 관리·전체 종목 조회 | 서버 + 클라이언트 |
| `/market` | 투자 시황 — 위험지수·지표·이벤트 | 서버 + 클라이언트 |
| `/my-portfolio` | 포트 종목 — 사용자 포트폴리오 관리 | 전체 클라이언트 |
| `/signals` | AI 신호 / 종목분석 (탭 2개) | 서버, searchParams 제어 |
| `/portfolio` | AI 포트폴리오 — 3소스 합산 성과 | 서버 |
| `/portfolio/[source]` | 소스별 가상매매 상세 | 서버 |
| `/compare` | 종목 비교 — 최대 3종목 지표 비교 | 클라이언트 |
| `/reports` | 일간 리포트 — 신호·MMS·AI 분석·통계 | 서버 |
| `/investment` | 포트 종목(구) — watchlist 기반 | 서버 + 클라이언트 |
| `/collector` | 수집기 상태 — heartbeat 모니터 | 서버 |
| `/settings` | 설정 — 포트 설정·알림·즐겨찾기·백업 안내 | 서버 |
| `/stock/[symbol]` | 종목 상세 전용 페이지 | 서버, revalidate 3600 |

`/collector`와 `/investment`는 내비게이션에 없는 비노출 라우트입니다. `/investment`는 신형 `/my-portfolio`와 역할이 겹치는 구세대 화면으로, 대시보드 카드에서만 진입할 수 있습니다.

## 2. 레이아웃·내비게이션

- `RootLayout`: `lang="ko"`, 구조는 `ClientProviders > (Sidebar + main + MobileTabBar)`
- `Sidebar`: 데스크톱 전용 고정폭 240px. 메뉴 9개 (대시보드/종목/투자 시황/포트 종목/AI 신호/AI 포트폴리오/종목 비교/일간 리포트/설정)
- `MobileTabBar`: 모바일 하단 탭 4개 + 더보기 패널 4개
- `ClientProviders`: 유일한 전역 컨텍스트 `StockModalProvider`를 장착합니다. `openStockModal(symbol)`로 어느 화면에서든 종목 상세 슬라이드 패널(`StockDetailPanel`)을 엽니다. 모든 종목 클릭 진입점이 이 컨텍스트로 수렴합니다.

## 3. 데이터 로딩 패턴

초기 데이터는 서버 컴포넌트가 `createServiceClient()`로 Supabase를 병렬 조회해 props로 내려주고, 이후 실시간성은 클라이언트 훅이 보강하는 하이브리드 구조입니다.

| 훅 | 소스 | 동작 |
|----|------|------|
| `use-price-refresh` | `GET /api/v1/prices?symbols=&live=true` | 5분 자동 폴링. 평일 KST 9~16시·화면 표시 중에만. 심볼 200개 청크 |
| `use-global-price-refresh` | `stock_cache` 직접 조회 (anon) | 갱신 시각 15분 경과 시 자동 재조회 |
| `use-batch-refresh` | `POST /api/v1/prices/refresh` | 서버측 전종목 갱신 트리거 |
| `use-unified-ranking` | `GET /api/v1/stock-ranking` | 스타일·가중치 포함 캐시 키, TTL 15초, 진행 중 요청 dedup |
| `use-snapshot-status` | `GET /api/v1/stock-ranking/status` | 30초 폴링 |
| `use-score-history` | `GET /api/v1/stock-ranking/sessions` | 종목별 점수 추이 7건, 캐시 60초 |

`CollectingBanner`는 `batch-runs/status`를 15초 폴링해 GHA 배치 진행 배너를 표시합니다.

## 4. 주요 화면 상세

### 4.1 대시보드 `/`

위험 경보 배너 → 신호 요약 4카드(소스 3종 + 시장) → 관심종목 위젯·투자 현황·가상 포트 요약 → 소스별 포트폴리오 3카드. 서버에서 signals(오늘)·market_score_history·stock_cache(즐겨찾기)·market_events·portfolio_snapshots를 병렬 조회합니다. 수익률 기준 자본은 전략별 500만원(`PORTFOLIO_CONFIG.CASH_PER_STRATEGY`)입니다.

### 4.2 종목 `/stocks`

관심그룹 탭(생성·삭제·이름변경·드래그 정렬) → 검색·시장·신호 필터 → 정렬 테이블(Gap 기본 정렬, 소스별 신호 배지). 검색·정렬·필터 상태는 URL searchParams와 양방향 동기화합니다. 무한 스크롤은 50건 단위이며, 신호 필터·Gap 정렬 시 1000건을 일괄 로드합니다. 장중(평일 KST 08~20시)에는 서버 렌더 시 네이버 실시간 시세를 4초 타임아웃으로 병합합니다. 종목 행을 그룹 탭으로 드래그해 그룹에 추가할 수 있습니다.

### 4.3 투자 시황 `/market`

위험지수 배너(안전<25/주의<50/위험<75/극위험) → 요약 3카드 → 지표별 위험 현황(위험 레벨 내림차순) → 이벤트 리스크 상세 → ETF 섹터 센티먼트(수동 매핑 관리 모달 포함) → 30일 위험지수 차트 → 이벤트 캘린더. 위험지수는 클라이언트에서 `calculateRiskIndex`(절대 임계값 + 252일 분위수 하이브리드)로 계산합니다.

### 4.4 AI 신호 / 종목분석 `/signals`

searchParams(source·date·tab·theme·leader)로 제어하는 2탭 화면입니다.

- AI 신호 탭: 날짜(오늘/최근 7일/전체)·소스 필터 → 핫테마 배너 → 매수/매도 2컬럼. 오늘 신호가 없으면 전체 모드로 자동 전환합니다. 전체 모드는 `stock_cache`의 BUY 상태(`has_active_sell=false`) 종목을 페이지네이션으로 수집합니다.
- 종목분석 탭: `StockAnalysisSection`(855줄)이 통합 랭킹을 표시합니다. 스타일 프리셋·커스텀 가중치, 시장·날짜·투자성격 필터, 등급과 4축 미니바, 300ms 지연 호버 상세 카드, 스냅샷 저장, 가격 새로고침을 제공합니다.

### 4.5 포트 종목 `/my-portfolio`

포트 탭(다중 포트 CRUD) → 종목 검색 → 보유 테이블(등급 배지·손절가/목표가 인라인 편집·수익률) → 모달 3종(매수 기록·제거 확인·성과 비교). 제거 확인은 "거래 완료"(세금·수수료 0.25% 차감 SELL 기록)와 "단순 삭제"를 구분합니다. 행 드래그로 포트 간에 이동할 수 있습니다. 손절가·목표가 도달 행은 배경색으로 강조합니다.

### 4.6 종목 상세 패널 (`components/stock-modal/`)

우측 85vw 슬라이드 패널입니다. metrics·signals·daily-prices 3개 API를 병렬 조회하고, 좌측 55%는 AI 분석(통합 점수 카드·체크리스트·수익률 추이), 우측 45%는 시장 데이터(지표 그리드·컨센서스·수급·기술 신호·DART)를 배치합니다. 포트/그룹 관리 아코디언에서 매수 기록과 그룹 편집을 할 수 있습니다.

## 5. 공용 컴포넌트

- `components/ui`: PageLayout, PageHeader, SourceBadge, SignalBadge, StackedList 등 디자인 시스템 기본 요소. `StackedList`는 좁은 화면에서 카드를, 넓은 화면에서 기존 테이블을 보여주며 breakpoint는 그 테이블에서 가장 늦게 나타나는 컬럼과 맞춥니다
- `components/charts`: lightweight-charts 캔들 차트(신호 마커·포트 오버레이 지원)
- `components/common`: StockActionMenu(종목 컨텍스트 메뉴), PriceUpdateBadge(갱신 시각·수동 새로고침), DateSelector, GradeTooltip
- 색상 규약: 상승·매수 빨강, 하락·매도 파랑 (국내 증시 관례)

## 6. 레거시 미사용 코드

활성 페이지에서 임포트되지 않는 컴포넌트가 약 4,300줄 남아 있습니다. `components/signals`의 구세대 추천 화면 체인 6종(ShortTermRecommendationSection, UnifiedAnalysisSection, StockRankingSection, AiRecommendationSection, RecommendationFilterBar, ChecklistFilterPanel)과 AiOpinionCard, dashboard-prices, event-summary-card, common/filter-bar, common/date-dropdown, 훅 use-stock-ranking·use-market-indicators가 해당합니다.
