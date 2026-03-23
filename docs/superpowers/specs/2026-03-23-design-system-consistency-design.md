# 디자인 시스템 구축 및 일관성 개선 설계

**날짜:** 2026-03-23
**범위:** 디자인 토큰 체계화, 공통 UI 컴포넌트 라이브러리, 모바일 반응형 통일, 성능 개선

---

## 1. 현황 분석

### 1.1 일관성 문제

- **섹션 간격 3종 혼용:** `space-y-4` (대시보드, 내포트폴리오) / `space-y-6` (시그널, 포트폴리오, 비교, 리포트, 투자, 수집기, 종목상세) / `space-y-8` (설정)
- **카드 패딩 4종 혼용:** `p-4` / `p-5` / `p-6` / `p-8`
- **소스 색상 중복 정의:** `signal-constants.ts` 외에 `stock/[symbol]/page.tsx`, `portfolio/page.tsx`, `StockDetailModal.tsx` 등에서 인라인 재정의
- **시그널 라벨 불일치:** "라씨매매" vs "라씨" 등 혼용
- **hover 효과 불일치:** `hover:brightness-110` vs `hover:opacity-90`
- **대시보드만 페이지 타이틀 없음**

### 1.2 모바일 문제

| 페이지 | 문제 |
|--------|------|
| investment | 테이블 9개 컬럼 전부 노출, 컬럼 숨김 없음 |
| reports | 테이블 6개 컬럼 전부 노출 |
| compare | `gridTemplateColumns: repeat(N, 1fr)` 인라인 스타일, 반응형 없음 |
| stocks | 고정 px 너비 컬럼 (`w-[52px]` 등), 좁은 화면에서 압축 |
| my-portfolio | 일부만 `hidden md:table-cell` 적용 (불완전) |
| layout | `pb-20` (80px) vs 탭바 `h-14` (56px) → 24px 낭비 |

### 1.3 성능 문제

- 시그널 페이지 워터폴 API 호출 (순차 fetch)
- `StockRankingSection`에서 `getAiBadges()`/`getBasicBadges()` 매 렌더 호출
- `use-price-refresh.ts`에서 비활성 탭에서도 폴링 지속
- `AiRecommendationSection`, `EtfSentimentSection` 동적 임포트 미적용
- 대형 클라이언트 컴포넌트 서버/클라이언트 분리 미적용
- 시그널/분석 테이블 가상화 미적용

---

## 2. 디자인 토큰 체계

### 2.1 CSS 변수 확장 (globals.css)

```css
:root {
  /* === Colors (기존 유지 + 정리) === */
  --background: #0b0f1a;
  --foreground: #e2e8f0;
  --card: #111827;
  --card-hover: #1a2236;
  --border: #1e293b;
  --muted: #94a3b8;
  --accent: #6366f1;
  --accent-light: #818cf8;
  --success: #10b981;
  --danger: #ef4444;
  --warning: #f59e0b;

  /* Source Colors (기존 --lassi 등 유지, 별칭 추가) */
  --lassi: #ef4444;
  --stockbot: #22c55e;
  --quant: #3b82f6;

  /* Trading Direction */
  --buy: #ef4444;
  --sell: #3b82f6;

  /* === Spacing (신규) === */
  --space-xs: 0.25rem;   /* 4px */
  --space-sm: 0.5rem;    /* 8px */
  --space-md: 1rem;      /* 16px */
  --space-lg: 1.5rem;    /* 24px */
  --space-xl: 2rem;      /* 32px */

  /* === Card (통일) === */
  --card-padding: 1rem;
  --card-padding-lg: 2rem;  /* 빈 상태 전용 */
  --card-radius: 12px;
  --card-gap: 1rem;

  /* === Page Layout (통일) === */
  --page-padding-x: 1rem;
  --page-padding-y: 1.5rem;
  --section-gap: 1.5rem;    /* space-y-6 통일 */

  /* === Typography (통일) === */
  --text-page-title: 1.5rem;
  --text-section-title: 1.125rem;
  --text-body: 0.875rem;
}
```

### 2.2 유틸리티 CSS 클래스 (globals.css에 추가)

```css
.section-gap { display: flex; flex-direction: column; gap: var(--section-gap); }
.card-padding { padding: var(--card-padding); }
.card-padding-lg { padding: var(--card-padding-lg); }
.page-title { font-size: var(--text-page-title); font-weight: 700; }
.section-title { font-size: var(--text-section-title); font-weight: 600; }
```

---

## 3. 공통 UI 컴포넌트 라이브러리

### 3.1 디렉토리 구조

```
src/components/ui/
├── PageLayout.tsx        # 페이지 레이아웃 래퍼
├── PageHeader.tsx        # 페이지 타이틀 + 서브타이틀
├── Card.tsx              # 통일된 카드 컴포넌트
├── Badge.tsx             # 범용 뱃지
├── SourceBadge.tsx       # 라씨/스톡봇/퀀트 전용 뱃지
├── SignalBadge.tsx       # BUY/SELL 시그널 뱃지
├── PriceText.tsx         # 가격 표시 (등락 색상 자동)
├── ResponsiveTable.tsx   # 모바일 반응형 테이블
├── EmptyState.tsx        # 데이터 없음 상태
├── SectionTitle.tsx      # 섹션 제목 (h2)
└── index.ts              # barrel export
```

### 3.2 컴포넌트 인터페이스

#### PageLayout
```tsx
interface PageLayoutProps {
  children: React.ReactNode;
}
// 모든 페이지의 최외곽 래퍼. section-gap 클래스 적용.
// <div className="section-gap">{children}</div>
```

#### PageHeader
```tsx
interface PageHeaderProps {
  title: string;
  subtitle?: string;
  action?: React.ReactNode; // 우측 액션 버튼 등
}
// <div>
//   <h1 className="text-xl md:text-2xl font-bold">{title}</h1>
//   {subtitle && <p className="text-sm text-[var(--muted)] mt-1">{subtitle}</p>}
// </div>
```

#### Card
```tsx
interface CardProps {
  children: React.ReactNode;
  hover?: boolean;           // hover 효과 (기본: false)
  variant?: "default" | "highlight";
  color?: "lassi" | "stockbot" | "quant";  // highlight 시 소스 색상
  padding?: "default" | "lg"; // default=p-4, lg=p-8
  className?: string;         // 추가 클래스
}
```

#### ResponsiveTable
```tsx
interface Column<T> {
  key: keyof T | string;
  label: string;
  priority: "always" | "sm" | "md" | "lg"; // 표시 기준 브레이크포인트
  align?: "left" | "center" | "right";
  width?: string;
  render?: (item: T) => React.ReactNode;
}

interface ResponsiveTableProps<T> {
  columns: Column<T>[];
  data: T[];
  keyExtractor: (item: T) => string;
  onRowClick?: (item: T) => void;
  emptyMessage?: string;
}
// priority에 따라 hidden sm:table-cell, hidden md:table-cell 등 자동 적용
// 구현: 순수 HTML table + Tailwind 반응형 클래스로 구현 (경량)
// 참고: @tanstack/react-table이 package.json에 있으나 실제 사용처 없음 → 의존성 제거 대상
```

#### SourceBadge
```tsx
interface SourceBadgeProps {
  source: "lassi" | "stockbot" | "quant";
  size?: "sm" | "md";
}
// 구현 방식: signal-constants.ts의 SOURCE_COLORS (Tailwind 클래스 문자열)를 그대로 활용
// SourceBadge 내부에서 SOURCE_COLORS[source]와 SOURCE_LABELS[source]를 참조
// CSS 변수 방식이 아닌 기존 Tailwind 클래스 방식 유지 (SOURCE_COLORS가 이미 완전한 클래스 반환)
// 각 파일에서 인라인으로 재정의한 색상/라벨만 제거하고 이 컴포넌트로 대체
```

#### SignalBadge
```tsx
interface SignalBadgeProps {
  type: "BUY" | "SELL" | "HOLD" | string;
  size?: "sm" | "md";
}
// signal-constants.ts의 SIGNAL_COLORS, SIGNAL_TYPE_LABELS 참조
```

#### PriceText
```tsx
interface PriceTextProps {
  value: number;
  format?: "percent" | "currency" | "number";
  size?: "sm" | "md" | "lg";
}
// value > 0 → text-red-400 (상승)
// value < 0 → text-blue-400 (하락)
// value === 0 → text-[var(--muted)]
```

#### EmptyState
```tsx
interface EmptyStateProps {
  icon?: React.ReactNode;
  message: string;
  action?: React.ReactNode;
}
// Card padding="lg" 내부에 중앙 정렬
```

#### SectionTitle
```tsx
interface SectionTitleProps {
  children: React.ReactNode;
  action?: React.ReactNode; // 우측 액션 버튼
}
// <div className="flex items-center justify-between">
//   <h2 className="section-title">{children}</h2>
//   {action}
// </div>
```

### 3.3 마이그레이션 전략

1. 컴포넌트 생성 (기존 `.card` CSS 클래스를 Card 내부에서 활용)
2. 페이지별 순차 교체 (대시보드 → 종목 → 시그널 → ... → 설정)
3. `signal-constants.ts`의 상수는 유지, SourceBadge/SignalBadge가 소비
4. 인라인 중복 색상 정의 모두 제거
5. 기존 `.card` CSS 클래스는 하위 호환을 위해 유지 (점진 제거)

---

## 4. 모바일 반응형 통일

### 4.1 컬럼 우선순위 시스템

ResponsiveTable의 `priority` 필드로 관리:

```
priority: "always"  → 모든 화면에서 표시
priority: "sm"      → 640px 이상에서 표시
priority: "md"      → 768px 이상에서 표시
priority: "lg"      → 1024px 이상에서 표시
```

### 4.2 페이지별 컬럼 적용

**stocks 테이블:**
- always: 종목명, 현재가, 등락률
- sm: 시그널수
- md: 코드, 거래량
- lg: 52주 최고/최저

**investment 테이블:**
- always: 종목명, 현재가, 등락률, 수익률
- md: 코드, 매수가
- lg: 손절가, 목표가, 삭제 버튼

**my-portfolio 테이블:**
- always: 종목명, 현재가, 등락률
- sm: 매수가
- md: 코드, 손절가, 목표가

**reports 테이블:**
- always: 소스, 적중률, 평균수익률
- md: 전략, 총신호, 완결거래

**compare 페이지:**
- 데스크탑: 가로 비교 그리드 (기존)
- 모바일: 세로 스택 카드형 비교

### 4.3 레이아웃 수정

```
탭바 패딩: pb-20 유지 (iOS Safari safe-area-inset-bottom 대응 필요, 현재 값이 안전)
타이틀 반응형: text-2xl → text-xl md:text-2xl
```

---

## 5. 성능 개선

### 5.1 P0 - Quick Win

#### 시그널 페이지 워터폴 제거
**파일:** `src/app/signals/page.tsx`
```
현재: 시그널 조회 → 심볼 추출 → stock_cache 조회 → stock_info 조회 (순차)
개선: 시그널 조회 → 심볼 추출 → Promise.all([stock_cache, stock_info]) (병렬)
```

#### React.memo() + useMemo 추가
**파일:** `src/components/signals/StockRankingSection.tsx`
- `RankCard` 컴포넌트를 먼저 `React.memo()`로 래핑 (부모 재렌더 시 불필요한 재호출 방지)
- 그 내부에서 `getAiBadges()`, `getBasicBadges()` 호출을 `useMemo`로 래핑
- 주의: memo() 없이 useMemo만 적용하면 효과 없음

**파일:** `src/components/dashboard/watchlist-widget.tsx`
- 목록 아이템을 memo() 컴포넌트로 래핑

#### memo() 래핑
**파일:** `src/components/market/market-client.tsx`
- IndicatorCard를 `React.memo()`로 래핑

#### 비활성 탭 폴링 중단
**파일:** `src/hooks/use-price-refresh.ts`
- 우선순위: P1으로 하향 (현재 5분 간격 + 장중에만 실행으로 실질 영향 제한적)
```tsx
// 폴링 콜백 내부에 추가 (무해하지만 효과 미미)
if (document.hidden) return;
```

### 5.2 P1 - 중요 개선

#### 동적 임포트 추가
```tsx
// AiRecommendationSection
const AiRecommendationSection = dynamic(
  () => import("./AiRecommendationSection"),
  { loading: () => <div className="card animate-pulse h-40" /> }
);

// EtfSentimentSection
const EtfSentimentSection = dynamic(
  () => import("./etf-sentiment-section"),
  { loading: () => <div className="card animate-pulse h-40" /> }
);
```

#### revalidate 조정
```
stock/[symbol]/page.tsx: 60 → 3600 (기본 데이터는 느리게 변함)
```

### 5.3 P2 - 구조적 개선

#### 시그널/분석 테이블 가상화
- `UnifiedAnalysisSection`에서 500+ 항목 시 DOM 절약
- 가상화 라이브러리 없이 IntersectionObserver 기반 페이지네이션으로 대체 (의존성 추가 최소화)

#### 가격 데이터 글로벌 캐시
- `PriceContext`에 심볼별 가격 + 타임스탬프 저장
- 60초 이내 재요청 시 캐시 반환
- React Query/SWR 도입 없이 Context + Map으로 구현

---

## 6. 영향 받는 파일 목록

### 신규 생성
- `src/components/ui/PageLayout.tsx`
- `src/components/ui/PageHeader.tsx`
- `src/components/ui/Card.tsx`
- `src/components/ui/Badge.tsx`
- `src/components/ui/SourceBadge.tsx`
- `src/components/ui/SignalBadge.tsx`
- `src/components/ui/PriceText.tsx`
- `src/components/ui/ResponsiveTable.tsx`
- `src/components/ui/EmptyState.tsx`
- `src/components/ui/SectionTitle.tsx`
- `src/components/ui/index.ts`

### 수정 (디자인 토큰)
- `src/app/globals.css`

### 수정 (모든 페이지 - 공통 컴포넌트 마이그레이션)
- `src/app/page.tsx` (대시보드)
- `src/app/stocks/page.tsx`
- `src/app/market/page.tsx`
- `src/app/signals/page.tsx`
- `src/app/my-portfolio/page.tsx`
- `src/app/portfolio/page.tsx`
- `src/app/portfolio/[source]/page.tsx`
- `src/app/compare/compare-client.tsx`
- `src/app/reports/page.tsx`
- `src/app/settings/page.tsx`
- `src/app/investment/page.tsx`
- `src/app/collector/page.tsx`
- `src/app/stock/[symbol]/page.tsx`

### 수정 (컴포넌트 - 공통 컴포넌트 소비)
- `src/components/stocks/stock-list-client.tsx`
- `src/components/market/market-client.tsx`
- `src/components/signals/UnifiedAnalysisSection.tsx`
- `src/components/signals/StockRankingSection.tsx`
- `src/components/signals/AiRecommendationSection.tsx`
- `src/components/dashboard/watchlist-widget.tsx`
- `src/components/dashboard/signal-summary-card.tsx` (SOURCE_COLORS/LABELS 중복 제거)
- `src/components/investment/investment-client.tsx`
- `src/components/stock-modal/StockDetailModal.tsx`
- `src/components/stock-modal/StockAiAnalysis.tsx` (SOURCE_LABELS 중복 제거)
- `src/app/signals/signal-columns.tsx` (SOURCE_COLORS/LABELS/SIGNAL_TYPE_LABELS 중복 제거)

### 수정 (레이아웃)
- `src/app/layout.tsx` (탭바 패딩)

### 수정 (성능)
- `src/hooks/use-price-refresh.ts`
- `src/lib/signal-constants.ts` (정리)

---

## 7. 제외 항목 (YAGNI)

- React Query/SWR 풀 마이그레이션 → 현 규모에서 과도
- 라이트 모드 테마 → 요청 없음
- 이미지 최적화 → 이미지 사용 없음
- SSR 스트리밍 → 아키텍처 변경 대비 효과 미미
- 풀 가상화 라이브러리 도입 → IntersectionObserver 페이지네이션으로 대체
