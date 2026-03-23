# 디자인 시스템 구축 및 일관성 개선 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 공통 UI 컴포넌트 라이브러리를 구축하고, 모든 페이지의 레이아웃/스타일/모바일 반응형을 통일하며, 성능을 개선한다.

**Architecture:** globals.css에 디자인 토큰 추가 → src/components/ui/에 공통 컴포넌트 생성 → 각 페이지에 순차 적용 → 성능 개선 적용. 기존 .card CSS 클래스는 Card 컴포넌트 내부에서 활용하여 하위 호환 유지.

**Tech Stack:** Next.js 16, React 19, Tailwind CSS v4, TypeScript

**Spec:** `docs/superpowers/specs/2026-03-23-design-system-consistency-design.md`

---

## Task 1: 디자인 토큰 확장 (globals.css)

**Files:**
- Modify: `web/src/app/globals.css`

- [ ] **Step 1: globals.css에 spacing, card, layout, typography CSS 변수 추가**

`:root` 블록 내 기존 색상 변수 아래에 추가:

```css
/* === Spacing === */
--space-xs: 0.25rem;
--space-sm: 0.5rem;
--space-md: 1rem;
--space-lg: 1.5rem;
--space-xl: 2rem;

/* === Card === */
--card-padding: 1rem;
--card-padding-lg: 2rem;
--card-radius: 12px;
--card-gap: 1rem;

/* === Page Layout === */
--page-padding-x: 1rem;
--page-padding-y: 1.5rem;
--section-gap: 1.5rem;

/* === Typography === */
--text-page-title: 1.5rem;
--text-section-title: 1.125rem;
--text-body: 0.875rem;
```

- [ ] **Step 2: 유틸리티 CSS 클래스 추가**

globals.css 하단에 추가:

```css
/* === Layout Utilities === */
.section-gap {
  display: flex;
  flex-direction: column;
  gap: var(--section-gap);
}

.card-padding {
  padding: var(--card-padding);
}

.card-padding-lg {
  padding: var(--card-padding-lg);
}

.page-title {
  font-size: var(--text-page-title);
  font-weight: 700;
}

.section-title {
  font-size: var(--text-section-title);
  font-weight: 600;
}
```

- [ ] **Step 3: 빌드 확인**

Run: `cd web && npx next build 2>&1 | tail -20`
Expected: 빌드 성공 (CSS 변수 추가는 기존 코드에 영향 없음)

- [ ] **Step 4: 커밋**

```bash
git add web/src/app/globals.css
git commit -m "feat: 디자인 토큰 체계 추가 (spacing, card, layout, typography CSS 변수)"
```

---

## Task 2: 공통 UI 컴포넌트 생성 - PageLayout, PageHeader, SectionTitle

**Files:**
- Create: `web/src/components/ui/PageLayout.tsx`
- Create: `web/src/components/ui/PageHeader.tsx`
- Create: `web/src/components/ui/SectionTitle.tsx`

- [ ] **Step 1: PageLayout 컴포넌트 생성**

```tsx
// web/src/components/ui/PageLayout.tsx
interface PageLayoutProps {
  children: React.ReactNode;
  className?: string;
}

export function PageLayout({ children, className = "" }: PageLayoutProps) {
  return (
    <div className={`section-gap ${className}`}>
      {children}
    </div>
  );
}
```

- [ ] **Step 2: PageHeader 컴포넌트 생성**

```tsx
// web/src/components/ui/PageHeader.tsx
interface PageHeaderProps {
  title: string;
  subtitle?: string;
  action?: React.ReactNode;
}

export function PageHeader({ title, subtitle, action }: PageHeaderProps) {
  return (
    <div className="flex items-center justify-between">
      <div>
        <h1 className="text-xl md:text-2xl font-bold">{title}</h1>
        {subtitle && (
          <p className="text-sm text-[var(--muted)] mt-1">{subtitle}</p>
        )}
      </div>
      {action}
    </div>
  );
}
```

- [ ] **Step 3: SectionTitle 컴포넌트 생성**

```tsx
// web/src/components/ui/SectionTitle.tsx
interface SectionTitleProps {
  children: React.ReactNode;
  action?: React.ReactNode;
}

export function SectionTitle({ children, action }: SectionTitleProps) {
  return (
    <div className="flex items-center justify-between">
      <h2 className="section-title">{children}</h2>
      {action}
    </div>
  );
}
```

- [ ] **Step 4: 커밋**

```bash
git add web/src/components/ui/PageLayout.tsx web/src/components/ui/PageHeader.tsx web/src/components/ui/SectionTitle.tsx
git commit -m "feat: PageLayout, PageHeader, SectionTitle 공통 컴포넌트 생성"
```

---

## Task 3: 공통 UI 컴포넌트 생성 - Card, EmptyState

**Files:**
- Create: `web/src/components/ui/Card.tsx`
- Create: `web/src/components/ui/EmptyState.tsx`

- [ ] **Step 1: Card 컴포넌트 생성**

기존 `.card` CSS 클래스를 기반으로 구현. 소스별 하이라이트와 hover 효과 통일.

```tsx
// web/src/components/ui/Card.tsx
import { SOURCE_COLORS } from "@/lib/signal-constants";

interface CardProps {
  children: React.ReactNode;
  hover?: boolean;
  variant?: "default" | "highlight";
  color?: "lassi" | "stockbot" | "quant";
  padding?: "default" | "lg";
  className?: string;
  onClick?: () => void;
}

const HIGHLIGHT_COLORS = {
  lassi: "bg-red-900/20 border-red-800/50",
  stockbot: "bg-green-900/20 border-green-800/50",
  quant: "bg-blue-900/20 border-blue-800/50",
} as const;

export function Card({
  children,
  hover = false,
  variant = "default",
  color,
  padding = "default",
  className = "",
  onClick,
}: CardProps) {
  const baseClass = variant === "highlight" && color
    ? `rounded-xl border ${HIGHLIGHT_COLORS[color]}`
    : "card";
  const paddingClass = padding === "lg" ? "card-padding-lg" : "card-padding";
  const hoverClass = hover ? "hover:brightness-110 transition-all cursor-pointer" : "";

  return (
    <div
      className={`${baseClass} ${paddingClass} ${hoverClass} ${className}`}
      onClick={onClick}
    >
      {children}
    </div>
  );
}
```

- [ ] **Step 2: EmptyState 컴포넌트 생성**

```tsx
// web/src/components/ui/EmptyState.tsx
import { Card } from "./Card";

interface EmptyStateProps {
  icon?: React.ReactNode;
  message: string;
  action?: React.ReactNode;
}

export function EmptyState({ icon, message, action }: EmptyStateProps) {
  return (
    <Card padding="lg">
      <div className="flex flex-col items-center justify-center text-center gap-3">
        {icon && <div className="text-[var(--muted)]">{icon}</div>}
        <p className="text-[var(--muted)]">{message}</p>
        {action}
      </div>
    </Card>
  );
}
```

- [ ] **Step 3: 커밋**

```bash
git add web/src/components/ui/Card.tsx web/src/components/ui/EmptyState.tsx
git commit -m "feat: Card, EmptyState 공통 컴포넌트 생성"
```

---

## Task 4: 공통 UI 컴포넌트 생성 - SourceBadge, SignalBadge, PriceText

**Files:**
- Create: `web/src/components/ui/SourceBadge.tsx`
- Create: `web/src/components/ui/SignalBadge.tsx`
- Create: `web/src/components/ui/PriceText.tsx`

- [ ] **Step 1: SourceBadge 생성**

`signal-constants.ts`의 `SOURCE_COLORS`와 `SOURCE_LABELS`를 내부에서 참조. Tailwind 클래스 방식 유지.

```tsx
// web/src/components/ui/SourceBadge.tsx
import { SOURCE_COLORS, SOURCE_LABELS } from "@/lib/signal-constants";

interface SourceBadgeProps {
  source: "lassi" | "stockbot" | "quant";
  size?: "sm" | "md";
}

export function SourceBadge({ source, size = "sm" }: SourceBadgeProps) {
  const colors = SOURCE_COLORS[source] || "";
  const label = SOURCE_LABELS[source] || source;
  const sizeClass = size === "sm" ? "text-xs px-2 py-0.5" : "text-sm px-3 py-1";

  return (
    <span className={`inline-flex items-center rounded-full border font-medium ${colors} ${sizeClass}`}>
      {label}
    </span>
  );
}
```

- [ ] **Step 2: SignalBadge 생성**

```tsx
// web/src/components/ui/SignalBadge.tsx
import { SIGNAL_COLORS, SIGNAL_TYPE_LABELS } from "@/lib/signal-constants";

interface SignalBadgeProps {
  type: string;
  size?: "sm" | "md";
}

export function SignalBadge({ type, size = "sm" }: SignalBadgeProps) {
  const colors = SIGNAL_COLORS[type] || "bg-gray-900/30 text-gray-400 border-gray-800/50";
  const label = SIGNAL_TYPE_LABELS[type] || type;
  const sizeClass = size === "sm" ? "text-xs px-2 py-0.5" : "text-sm px-3 py-1";

  return (
    <span className={`inline-flex items-center rounded-full border font-medium ${colors} ${sizeClass}`}>
      {label}
    </span>
  );
}
```

- [ ] **Step 3: PriceText 생성**

```tsx
// web/src/components/ui/PriceText.tsx
interface PriceTextProps {
  value: number;
  format?: "percent" | "currency" | "number";
  size?: "sm" | "md" | "lg";
  showSign?: boolean;
}

const SIZE_CLASS = {
  sm: "text-xs",
  md: "text-sm",
  lg: "text-base",
} as const;

export function PriceText({
  value,
  format = "percent",
  size = "sm",
  showSign = true,
}: PriceTextProps) {
  const colorClass = value > 0 ? "text-red-400" : value < 0 ? "text-blue-400" : "text-[var(--muted)]";
  const sign = showSign && value > 0 ? "+" : "";

  let formatted: string;
  if (format === "percent") {
    formatted = `${sign}${value.toFixed(2)}%`;
  } else if (format === "currency") {
    formatted = `${sign}${value.toLocaleString()}원`;
  } else {
    formatted = `${sign}${value.toLocaleString()}`;
  }

  return (
    <span className={`${colorClass} ${SIZE_CLASS[size]} font-medium`}>
      {formatted}
    </span>
  );
}
```

- [ ] **Step 4: 커밋**

```bash
git add web/src/components/ui/SourceBadge.tsx web/src/components/ui/SignalBadge.tsx web/src/components/ui/PriceText.tsx
git commit -m "feat: SourceBadge, SignalBadge, PriceText 공통 컴포넌트 생성"
```

---

## Task 5: ResponsiveTable 컴포넌트 생성

**Files:**
- Create: `web/src/components/ui/ResponsiveTable.tsx`

- [ ] **Step 1: ResponsiveTable 구현**

순수 HTML table + Tailwind 반응형 클래스. priority 필드로 모바일 컬럼 자동 숨김.

```tsx
// web/src/components/ui/ResponsiveTable.tsx
"use client";

import React from "react";

interface Column<T> {
  key: string;
  label: string;
  priority: "always" | "sm" | "md" | "lg";
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

const PRIORITY_CLASS: Record<string, string> = {
  always: "",
  sm: "hidden sm:table-cell",
  md: "hidden md:table-cell",
  lg: "hidden lg:table-cell",
};

const ALIGN_CLASS: Record<string, string> = {
  left: "text-left",
  center: "text-center",
  right: "text-right",
};

export function ResponsiveTable<T>({
  columns,
  data,
  keyExtractor,
  onRowClick,
  emptyMessage = "데이터가 없습니다",
}: ResponsiveTableProps<T>) {
  if (data.length === 0) {
    return (
      <div className="card card-padding-lg text-center text-[var(--muted)]">
        {emptyMessage}
      </div>
    );
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-[var(--border)]">
            {columns.map((col) => (
              <th
                key={col.key}
                className={`py-3 px-2 font-medium text-[var(--muted)] ${PRIORITY_CLASS[col.priority]} ${ALIGN_CLASS[col.align || "left"]}`}
                style={col.width ? { width: col.width } : undefined}
              >
                {col.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {data.map((item) => (
            <tr
              key={keyExtractor(item)}
              className={`border-b border-[var(--border)] ${onRowClick ? "cursor-pointer hover:bg-[var(--card-hover)]" : ""}`}
              onClick={() => onRowClick?.(item)}
            >
              {columns.map((col) => (
                <td
                  key={col.key}
                  className={`py-3 px-2 ${PRIORITY_CLASS[col.priority]} ${ALIGN_CLASS[col.align || "left"]}`}
                >
                  {col.render
                    ? col.render(item)
                    : String((item as Record<string, unknown>)[col.key] ?? "")}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
```

- [ ] **Step 2: 커밋**

```bash
git add web/src/components/ui/ResponsiveTable.tsx
git commit -m "feat: ResponsiveTable 모바일 반응형 테이블 컴포넌트 생성"
```

---

## Task 6: Barrel export + @tanstack/react-table 의존성 제거

**Files:**
- Create: `web/src/components/ui/index.ts`
- Modify: `web/package.json`

- [ ] **Step 1: barrel export 생성**

```tsx
// web/src/components/ui/index.ts
export { PageLayout } from "./PageLayout";
export { PageHeader } from "./PageHeader";
export { SectionTitle } from "./SectionTitle";
export { Card } from "./Card";
export { EmptyState } from "./EmptyState";
export { SourceBadge } from "./SourceBadge";
export { SignalBadge } from "./SignalBadge";
export { PriceText } from "./PriceText";
export { ResponsiveTable } from "./ResponsiveTable";
```

- [ ] **Step 2: @tanstack/react-table 의존성 제거**

Run: `cd web && npm uninstall @tanstack/react-table`
Expected: package.json과 package-lock.json에서 제거됨

- [ ] **Step 3: 빌드 확인**

Run: `cd web && npx next build 2>&1 | tail -20`
Expected: 빌드 성공 (실제 사용처 없으므로 문제 없음)

- [ ] **Step 4: 커밋**

```bash
git add web/src/components/ui/index.ts web/package.json web/package-lock.json
git commit -m "feat: UI 컴포넌트 barrel export 추가, 미사용 @tanstack/react-table 제거"
```

---

## Task 7: 대시보드 페이지 마이그레이션

**Files:**
- Modify: `web/src/app/page.tsx`

- [ ] **Step 1: 대시보드에 PageLayout + PageHeader 적용**

대시보드 페이지의 최외곽 `<div className="space-y-4">`를 `<PageLayout>`으로 교체. 페이지 타이틀 추가 (현재 없음).

```tsx
import { PageLayout, PageHeader } from "@/components/ui";
```

변경:
- `<div className="space-y-4">` → `<PageLayout>`
- 최상단에 `<PageHeader title="대시보드" subtitle="AI 매매신호 현황" />` 추가

- [ ] **Step 2: 빌드 확인**

Run: `cd web && npx next build 2>&1 | tail -20`

- [ ] **Step 3: 커밋**

```bash
git add web/src/app/page.tsx
git commit -m "feat: 대시보드 페이지 공통 컴포넌트 마이그레이션"
```

---

## Task 8: 시그널 + 포트폴리오 + 비교 + 리포트 + 종목목록 + 마켓 페이지 마이그레이션

**Files:**
- Modify: `web/src/app/signals/page.tsx`
- Modify: `web/src/app/portfolio/page.tsx`
- Modify: `web/src/app/portfolio/[source]/page.tsx`
- Modify: `web/src/app/compare/compare-client.tsx`
- Modify: `web/src/app/reports/page.tsx`
- Modify: `web/src/app/stocks/page.tsx`
- Modify: `web/src/app/market/page.tsx`

- [ ] **Step 1: 각 페이지의 space-y-6 → PageLayout, 타이틀 → PageHeader 교체**

각 파일에서:
1. `import { PageLayout, PageHeader } from "@/components/ui";` 추가
2. `<div className="space-y-6">` → `<PageLayout>` 교체
3. 기존 `<h1>` + `<p>` 타이틀 블록 → `<PageHeader title="..." subtitle="..." />` 교체
4. 카드의 `p-5`, `p-6` → `card-padding` 클래스로 통일 (가능한 범위에서)
5. stocks/page.tsx, market/page.tsx: 클라이언트 컴포넌트에 데이터를 전달하는 서버 컴포넌트이므로, 클라이언트 컴포넌트 내부에서 PageLayout 적용

- [ ] **Step 2: 빌드 확인**

Run: `cd web && npx next build 2>&1 | tail -20`

- [ ] **Step 3: 커밋**

```bash
git add web/src/app/signals/page.tsx web/src/app/portfolio/page.tsx web/src/app/compare/compare-client.tsx web/src/app/reports/page.tsx
git commit -m "feat: 시그널/포트폴리오/비교/리포트 페이지 공통 컴포넌트 마이그레이션"
```

---

## Task 9: 나머지 페이지 마이그레이션 (설정, 투자, 수집기, 내포트폴리오, 종목상세)

**Files:**
- Modify: `web/src/app/settings/page.tsx`
- Modify: `web/src/app/investment/page.tsx`
- Modify: `web/src/app/collector/page.tsx`
- Modify: `web/src/app/my-portfolio/page.tsx`
- Modify: `web/src/app/stock/[symbol]/page.tsx`

- [ ] **Step 1: 각 페이지 마이그레이션**

동일 패턴 적용:
1. `import { PageLayout, PageHeader } from "@/components/ui";`
2. 외곽 `space-y-*` → `<PageLayout>`
3. 타이틀 → `<PageHeader>`
4. 설정 페이지: `space-y-8` → `<PageLayout>` (section-gap으로 통일)
5. 내포트폴리오: `space-y-4` → `<PageLayout>`

- [ ] **Step 2: 빌드 확인**

Run: `cd web && npx next build 2>&1 | tail -20`

- [ ] **Step 3: 커밋**

```bash
git add web/src/app/settings/page.tsx web/src/app/investment/page.tsx web/src/app/collector/page.tsx web/src/app/my-portfolio/page.tsx web/src/app/stock/\[symbol\]/page.tsx
git commit -m "feat: 설정/투자/수집기/내포트폴리오/종목상세 공통 컴포넌트 마이그레이션"
```

---

## Task 10: 소스 색상/라벨 중복 제거 - SourceBadge/SignalBadge 적용

**Files:**
- Modify: `web/src/app/signals/signal-columns.tsx`
- Modify: `web/src/components/dashboard/signal-summary-card.tsx`
- Modify: `web/src/components/signals/UnifiedAnalysisSection.tsx`
- Modify: `web/src/components/stock-modal/StockAiAnalysis.tsx`
- Modify: `web/src/components/stock-modal/StockDetailModal.tsx`
- Modify: `web/src/components/stocks/stock-list-client.tsx`
- Modify: `web/src/app/stock/[symbol]/page.tsx`
- Modify: `web/src/app/portfolio/page.tsx`
- Modify: `web/src/app/reports/page.tsx`

- [ ] **Step 1: 각 파일에서 인라인 SOURCE_COLORS/SOURCE_LABELS 재정의 제거**

각 파일에서:
1. 로컬로 정의된 `SOURCE_COLORS`, `SOURCE_LABELS`, `SIGNAL_TYPE_LABELS` 상수 삭제
2. `import { SourceBadge, SignalBadge } from "@/components/ui";` 추가
3. 인라인 뱃지 렌더링을 `<SourceBadge source="lassi" />`, `<SignalBadge type="BUY" />` 등으로 교체
4. 단순 텍스트만 필요한 곳은 `signal-constants.ts`에서 직접 임포트 유지

주의: 각 파일의 기존 렌더링 로직을 잘 파악한 후 교체. 스타일이 달라지지 않는지 확인.

- [ ] **Step 2: 빌드 확인**

Run: `cd web && npx next build 2>&1 | tail -20`

- [ ] **Step 3: 커밋**

```bash
git add web/src/app/signals/signal-columns.tsx web/src/components/dashboard/signal-summary-card.tsx web/src/components/signals/UnifiedAnalysisSection.tsx web/src/components/stock-modal/StockAiAnalysis.tsx web/src/components/stock-modal/StockDetailModal.tsx web/src/components/stocks/stock-list-client.tsx web/src/app/stock/\[symbol\]/page.tsx web/src/app/portfolio/page.tsx web/src/app/reports/page.tsx
git commit -m "refactor: 소스 색상/라벨 중복 제거, SourceBadge/SignalBadge 컴포넌트로 통일"
```

---

## Task 11: 모바일 반응형 - investment, reports 테이블 개선

**Files:**
- Modify: `web/src/components/investment/investment-client.tsx`
- Modify: `web/src/app/reports/page.tsx`

- [ ] **Step 1: investment 테이블에 반응형 컬럼 숨김 적용**

`investment-client.tsx`의 테이블 헤더와 데이터 셀에 적용:
- always: 종목명, 현재가, 등락률, 수익률
- md: 코드, 매수가 → `hidden md:table-cell`
- lg: 손절가, 목표가, 삭제 → `hidden lg:table-cell`

- [ ] **Step 2: reports 테이블에 반응형 컬럼 숨김 적용**

`reports/page.tsx`의 테이블:
- always: 소스, 적중률, 평균수익률
- md: 전략, 총신호, 완결거래 → `hidden md:table-cell`

- [ ] **Step 3: 빌드 확인**

Run: `cd web && npx next build 2>&1 | tail -20`

- [ ] **Step 4: 커밋**

```bash
git add web/src/components/investment/investment-client.tsx web/src/app/reports/page.tsx
git commit -m "feat: investment/reports 테이블 모바일 반응형 컬럼 숨김 적용"
```

---

## Task 12: 모바일 반응형 - stocks, my-portfolio 테이블 개선

**Files:**
- Modify: `web/src/components/stocks/stock-list-client.tsx`
- Modify: `web/src/app/my-portfolio/page.tsx`

- [ ] **Step 1: stocks 테이블 반응형 개선**

`stock-list-client.tsx`에서:
- always: 종목명, 현재가, 등락률
- sm: 시그널수 → `hidden sm:table-cell`
- md: 코드, 거래량 → `hidden md:table-cell`
- lg: 52주 최고/최저 → `hidden lg:table-cell`
- 고정 px 너비(`w-[52px]` 등)를 반응형 비율로 변경

- [ ] **Step 2: my-portfolio 테이블 반응형 완성**

`my-portfolio/page.tsx`에서 기존 불완전한 hiding을 완성:
- always: 종목명, 현재가, 등락률
- sm: 매수가 → `hidden sm:table-cell`
- md: 코드, 손절가, 목표가 → `hidden md:table-cell`
- 헤더와 데이터 셀 모두 동일하게 적용 (현재 불일치)

- [ ] **Step 3: 빌드 확인**

Run: `cd web && npx next build 2>&1 | tail -20`

- [ ] **Step 4: 커밋**

```bash
git add web/src/components/stocks/stock-list-client.tsx web/src/app/my-portfolio/page.tsx
git commit -m "feat: stocks/my-portfolio 테이블 모바일 반응형 개선"
```

---

## Task 13: 모바일 반응형 - compare 페이지 세로 스택

**Files:**
- Modify: `web/src/app/compare/compare-client.tsx`

- [ ] **Step 1: 비교 페이지 모바일 레이아웃 변경**

`compare-client.tsx`에서:
- 인라인 `gridTemplateColumns: repeat(N, 1fr)` 스타일 제거
- 데스크탑: `md:grid-cols-2` 또는 `md:grid-cols-3` (종목 수에 따라)
- 모바일: `grid-cols-1` (카드형 세로 스택)
- 비교 테이블도 모바일에서는 카드형으로 전환하거나 `overflow-x-auto` 유지

- [ ] **Step 2: 빌드 확인**

Run: `cd web && npx next build 2>&1 | tail -20`

- [ ] **Step 3: 커밋**

```bash
git add web/src/app/compare/compare-client.tsx
git commit -m "feat: 비교 페이지 모바일 세로 스택 레이아웃 적용"
```

---

## Task 14: 성능 P0 - React.memo() + useMemo 추가

> 참고: 시그널 페이지 워터폴(Promise.all)은 이미 구현되어 있으므로 별도 작업 불필요.

**Files:**
- Modify: `web/src/components/signals/StockRankingSection.tsx`
- Modify: `web/src/components/dashboard/watchlist-widget.tsx`
- Modify: `web/src/components/market/market-client.tsx`

- [ ] **Step 1: StockRankingSection - RankCard를 React.memo()로 래핑**

`StockRankingSection.tsx`에서:
1. `RankCard` 함수 컴포넌트를 `React.memo()`로 래핑
2. 내부 `getAiBadges()`, `getBasicBadges()` 호출을 `useMemo`로 래핑

```tsx
const RankCard = React.memo(function RankCard({ item, ...props }) {
  const aiBadges = useMemo(() => getAiBadges(item.ai), [item.ai]);
  const basicBadges = useMemo(() => getBasicBadges(item), [item]);
  // ... 기존 렌더링
});
```

- [ ] **Step 2: watchlist-widget - 목록 아이템 memo() 래핑**

`watchlist-widget.tsx`에서 favorites.map 내부의 아이템 렌더링을 별도 메모이즈드 컴포넌트로 추출.

- [ ] **Step 3: market-client - IndicatorCard를 React.memo()로 래핑**

`market-client.tsx`에서 `IndicatorCard` 컴포넌트를 `React.memo()`로 래핑.

- [ ] **Step 4: 빌드 확인**

Run: `cd web && npx next build 2>&1 | tail -20`

- [ ] **Step 5: 커밋**

```bash
git add web/src/components/signals/StockRankingSection.tsx web/src/components/dashboard/watchlist-widget.tsx web/src/components/market/market-client.tsx
git commit -m "perf: RankCard/WatchlistItem/IndicatorCard에 React.memo + useMemo 적용"
```

---

## Task 15: 성능 P1 - 동적 임포트 + revalidate 조정 + 폴링 개선

**Files:**
- Modify: `web/src/components/market/market-client.tsx`
- Modify: `web/src/app/stock/[symbol]/page.tsx`
- Modify: `web/src/hooks/use-price-refresh.ts`

> 참고: AiRecommendationSection은 현재 어디에서도 import되지 않는 고아 컴포넌트. 동적 임포트 불필요.

- [ ] **Step 1: EtfSentimentSection 동적 임포트**

`market-client.tsx`에서:

```tsx
import dynamic from "next/dynamic";
const EtfSentimentSection = dynamic(
  () => import("./etf-sentiment-section"),
  { loading: () => <div className="card animate-pulse h-40" /> }
);
```

- [ ] **Step 2: stock/[symbol] revalidate 조정**

`web/src/app/stock/[symbol]/page.tsx`에서:

```tsx
export const revalidate = 3600; // 60 → 3600
```

- [ ] **Step 4: 비활성 탭 폴링 중단**

`web/src/hooks/use-price-refresh.ts`의 폴링 콜백 상단에 추가:

```tsx
if (document.hidden) return;
```

- [ ] **Step 5: 빌드 확인**

Run: `cd web && npx next build 2>&1 | tail -20`

- [ ] **Step 6: 커밋**

```bash
git add web/src/components/signals/ web/src/components/market/market-client.tsx web/src/app/stock/\[symbol\]/page.tsx web/src/hooks/use-price-refresh.ts
git commit -m "perf: 동적 임포트, revalidate 조정, 비활성 탭 폴링 중단"
```

---

## Task 16: 최종 빌드 검증 및 정리

**Files:**
- 전체 프로젝트

- [ ] **Step 1: 전체 빌드 확인**

Run: `cd web && npx next build`
Expected: 에러 없이 빌드 성공

- [ ] **Step 2: 미사용 임포트 정리**

빌드 경고에서 미사용 임포트가 있으면 제거.

- [ ] **Step 3: 커밋**

```bash
git add -A
git commit -m "chore: 최종 빌드 검증 및 미사용 임포트 정리"
```
