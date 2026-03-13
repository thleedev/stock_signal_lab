# Filter Bar Compact UI Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** AI 신호 페이지의 2~3줄 필터 UI를 DateDropdown + select 드롭다운 기반 1줄 FilterBar로 교체한다.

**Architecture:** `DateDropdown`(날짜 프리셋+달력 팝업)과 `FilterBar`(1줄 컨테이너) 공통 컴포넌트를 신규 생성하고, AI 신호 탭용 `SignalFilterBar` 클라이언트 래퍼를 추가한다. 종목분석 탭의 `UnifiedAnalysisSection`은 기존 3줄 필터 UI를 `FilterBar` 한 줄로 교체한다. 모바일에서는 시장·정렬을 "⋯" 팝업으로 접고, 검색은 🔍 아이콘 클릭 시 인라인 확장한다.

**Tech Stack:** Next.js 14 App Router, TypeScript, React hooks (useState/useEffect/useRef/useMemo), Tailwind CSS, lucide-react

---

## File Structure

| 파일 | 작업 | 역할 |
|------|------|------|
| `web/src/components/common/date-dropdown.tsx` | 신규 생성 | 날짜 프리셋(오늘~N일전+전체) + native `<input type="date">` 팝업 |
| `web/src/components/common/filter-bar.tsx` | 신규 생성 | 1줄 필터 컨테이너; date/source/market/search/sort/weight/refresh 옵션 props |
| `web/src/app/signals/signal-filter-bar.tsx` | 신규 생성 | "use client" 래퍼; useRouter로 URL param 업데이트 |
| `web/src/app/signals/page.tsx` | 수정 | DateSelector + source Link 버튼 → SignalFilterBar |
| `web/src/components/signals/UnifiedAnalysisSection.tsx` | 수정 | 필터 3줄 UI → FilterBar 1줄로 교체; SOURCE_OPTIONS, SORT_OPTIONS_WITH_GAP 추가 |

**수정 금지:** `web/src/components/common/date-selector.tsx` (다른 페이지에서 사용 중)

---

## Chunk 1: 공통 컴포넌트 (DateDropdown + FilterBar)

### Task 1: DateDropdown 컴포넌트 생성

**Files:**
- Create: `web/src/components/common/date-dropdown.tsx`

---

- [ ] **Step 1: `date-dropdown.tsx` 파일 생성**

`web/src/components/common/date-dropdown.tsx` 전체 내용:

```tsx
'use client';

import { useState, useEffect, useRef } from 'react';
import { ChevronDown } from 'lucide-react';
import { formatDateLabel } from '@/lib/date-utils';

interface DateDropdownProps {
  dates: string[];        // 최근 평일 목록 (YYYY-MM-DD), 보통 4~7개
  selected: string;       // 선택된 날짜 또는 'all'
  onChange: (date: string) => void;
}

function getDatePresetLabel(date: string, dates: string[]): string {
  if (date === 'all') return '전체';
  const idx = dates.indexOf(date);
  if (idx === 0) return '오늘';
  if (idx === 1) return '어제';
  if (idx === 2) return '2일전';
  if (idx === 3) return '3일전';
  return formatDateLabel(date); // index 4+ 또는 커스텀 날짜 → M/D(요일)
}

export function DateDropdown({ dates, selected, onChange }: DateDropdownProps) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, []);

  const handleSelect = (date: string) => {
    onChange(date);
    setOpen(false);
  };

  return (
    <div ref={ref} className="relative shrink-0">
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-1 pl-3 pr-2 py-1.5 rounded-lg border border-[var(--border)] bg-[var(--card)] text-sm text-[var(--foreground)] hover:bg-[var(--card-hover)] transition-colors"
      >
        <span>{getDatePresetLabel(selected, dates)}</span>
        <ChevronDown
          size={14}
          className={`text-[var(--muted)] transition-transform ${open ? 'rotate-180' : ''}`}
        />
      </button>

      {open && (
        <div className="absolute top-full mt-1 left-0 z-50 min-w-[8rem] rounded-xl border border-[var(--border)] bg-[var(--card)] shadow-lg overflow-hidden">
          {dates.map((date) => (
            <button
              key={date}
              onClick={() => handleSelect(date)}
              className={`w-full px-3 py-1.5 text-sm text-left hover:bg-[var(--card-hover)] transition-colors ${
                selected === date
                  ? 'text-[var(--accent)] font-semibold'
                  : 'text-[var(--foreground)]'
              }`}
            >
              {getDatePresetLabel(date, dates)}
            </button>
          ))}
          <button
            onClick={() => handleSelect('all')}
            className={`w-full px-3 py-1.5 text-sm text-left hover:bg-[var(--card-hover)] transition-colors ${
              selected === 'all'
                ? 'text-[var(--accent)] font-semibold'
                : 'text-[var(--foreground)]'
            }`}
          >
            전체
          </button>
          <div className="mx-2 border-t border-[var(--border)]" />
          <div className="px-3 py-2">
            <label className="text-xs text-[var(--muted)] block mb-1">직접 선택</label>
            <input
              type="date"
              className="w-full text-sm bg-[var(--card)] text-[var(--foreground)] border border-[var(--border)] rounded px-2 py-1 focus:outline-none focus:border-[var(--accent)]"
              onChange={(e) => {
                if (e.target.value) handleSelect(e.target.value);
              }}
            />
          </div>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: TypeScript 타입 체크**

```bash
cd /Users/thlee/GoogleDrive/DashboardStock/web && npx tsc --noEmit 2>&1 | head -20
```

Expected: 에러 없음 (또는 기존에 있던 에러만 출력)

- [ ] **Step 3: 커밋**

```bash
cd /Users/thlee/GoogleDrive/DashboardStock && git add web/src/components/common/date-dropdown.tsx && git commit -m "feat: DateDropdown 컴포넌트 추가 (프리셋+달력 팝업)"
```

---

### Task 2: FilterBar 컴포넌트 생성

**Files:**
- Create: `web/src/components/common/filter-bar.tsx`

---

- [ ] **Step 1: `filter-bar.tsx` 파일 생성**

`web/src/components/common/filter-bar.tsx` 전체 내용:

```tsx
'use client';

import { useState, useEffect, useRef } from 'react';
import { Search, SlidersHorizontal, RefreshCw, MoreHorizontal } from 'lucide-react';
import { DateDropdown } from './date-dropdown';

// FilterBar 내부 고정 시장 옵션
const MARKET_OPTIONS = [
  { key: 'all',    label: '전체'   },
  { key: 'KOSPI',  label: 'KOSPI'  },
  { key: 'KOSDAQ', label: 'KOSDAQ' },
];

interface FilterBarProps {
  date: {
    dates: string[];
    selected: string;
    onChange: (d: string) => void;
  };
  source?: {
    options: { key: string; label: string }[];
    selected: string;
    onChange: (s: string) => void;
  };
  market?: {
    selected: string;         // 'all' | 'KOSPI' | 'KOSDAQ'
    onChange: (m: string) => void;
  };
  search?: {
    value: string;
    onChange: (q: string) => void;
    placeholder?: string;
  };
  sort?: {
    options: { key: string; label: string }[];
    selected: string;
    onChange: (s: string) => void;
    gapAsc?: boolean;
    onGapToggle?: () => void;
  };
  onWeightClick?: () => void;
  onRefresh?: () => void;
  refreshing?: boolean;
}

const selectCls =
  'pl-3 pr-7 py-1.5 rounded-lg border border-[var(--border)] bg-[var(--card)] text-sm text-[var(--foreground)] appearance-none cursor-pointer focus:outline-none focus:border-[var(--accent)]';

const iconBtnCls =
  'p-1.5 rounded-lg border border-[var(--border)] bg-[var(--card)] text-[var(--muted)] hover:bg-[var(--card-hover)] transition-colors';

export function FilterBar({
  date,
  source,
  market,
  search,
  sort,
  onWeightClick,
  onRefresh,
  refreshing,
}: FilterBarProps) {
  const [moreOpen, setMoreOpen] = useState(false);
  const [searchExpanded, setSearchExpanded] = useState(false);
  const moreRef = useRef<HTMLDivElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);

  const hasMore = !!(market || sort);

  // ⋯ 팝업 외부 클릭 시 닫힘
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (moreRef.current && !moreRef.current.contains(e.target as Node)) {
        setMoreOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, []);

  // 검색 확장 시 input 포커스
  useEffect(() => {
    if (searchExpanded) searchInputRef.current?.focus();
  }, [searchExpanded]);

  const handleSearchBlur = () => {
    // 스펙: blur 시 항상 🔍 아이콘으로 복귀
    setSearchExpanded(false);
  };

  const handleSearchKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') setSearchExpanded(false);
  };

  // 모바일 검색 확장 모드
  if (searchExpanded && search) {
    return (
      <div className="flex sm:hidden items-center gap-2 w-full">
        <input
          ref={searchInputRef}
          type="text"
          value={search.value}
          onChange={(e) => search.onChange(e.target.value)}
          onBlur={handleSearchBlur}
          onKeyDown={handleSearchKeyDown}
          placeholder={search.placeholder}
          className="flex-1 pl-3 pr-3 py-1.5 text-sm rounded-lg border border-[var(--border)] bg-[var(--card)] focus:outline-none focus:border-[var(--accent)]"
        />
        {onWeightClick && (
          <button onClick={onWeightClick} className={`${iconBtnCls} shrink-0`}>
            <SlidersHorizontal size={15} />
          </button>
        )}
        {onRefresh && (
          <button onClick={onRefresh} disabled={refreshing} className={`${iconBtnCls} shrink-0 disabled:opacity-50`}>
            <RefreshCw size={15} className={refreshing ? 'animate-spin' : ''} />
          </button>
        )}
      </div>
    );
  }

  return (
    <div className="relative flex items-center gap-2 flex-wrap sm:flex-nowrap">
      {/* DateDropdown — 항상 표시 */}
      <DateDropdown dates={date.dates} selected={date.selected} onChange={date.onChange} />

      {/* 소스 드롭다운 */}
      {source && (
        <div className="relative">
          <select
            value={source.selected}
            onChange={(e) => source.onChange(e.target.value)}
            className={selectCls}
          >
            {source.options.map((o) => (
              <option key={o.key} value={o.key}>{o.label}</option>
            ))}
          </select>
          <span className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-[var(--muted)] text-xs">▾</span>
        </div>
      )}

      {/* 시장 드롭다운 — 데스크탑만 */}
      {market && (
        <div className="hidden sm:block relative">
          <select
            value={market.selected}
            onChange={(e) => market.onChange(e.target.value)}
            className={selectCls}
          >
            {MARKET_OPTIONS.map((o) => (
              <option key={o.key} value={o.key}>{o.label}</option>
            ))}
          </select>
          <span className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-[var(--muted)] text-xs">▾</span>
        </div>
      )}

      {/* 검색 — 데스크탑: inline input / 모바일: 🔍 아이콘 */}
      {search && (
        <>
          {/* 데스크탑 인라인 검색 */}
          <div className="hidden sm:block relative flex-1 min-w-[8rem] max-w-[16rem]">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--muted)]" />
            <input
              type="text"
              value={search.value}
              onChange={(e) => search.onChange(e.target.value)}
              placeholder={search.placeholder}
              className="w-full pl-8 pr-3 py-1.5 text-sm rounded-lg border border-[var(--border)] bg-[var(--card)] focus:outline-none focus:border-[var(--accent)]"
            />
          </div>
          {/* 모바일 🔍 아이콘 버튼 */}
          <button
            className={`sm:hidden ${iconBtnCls}`}
            onClick={() => setSearchExpanded(true)}
          >
            <Search size={15} />
          </button>
        </>
      )}

      {/* 정렬 드롭다운 + Gap ↑↓ — 데스크탑만 */}
      {sort && (
        <div className="hidden sm:flex items-center gap-1">
          <div className="relative">
            <select
              value={sort.selected}
              onChange={(e) => sort.onChange(e.target.value)}
              className={selectCls}
            >
              {sort.options.map((o) => (
                <option key={o.key} value={o.key}>{o.label}</option>
              ))}
            </select>
            <span className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-[var(--muted)] text-xs">▾</span>
          </div>
          {sort.selected === 'gap' && sort.onGapToggle && (
            <button
              onClick={sort.onGapToggle}
              className="px-2 py-1.5 rounded-lg border border-[var(--border)] bg-[var(--card)] text-sm text-[var(--muted)] hover:bg-[var(--card-hover)] transition-colors"
            >
              {sort.gapAsc ? '↑' : '↓'}
            </button>
          )}
        </div>
      )}

      {/* ⋯ 버튼 — 모바일만, market 또는 sort 있을 때 */}
      {hasMore && (
        <div ref={moreRef} className="sm:hidden relative">
          <button
            onClick={() => setMoreOpen((v) => !v)}
            className={`${iconBtnCls} ${moreOpen ? '!bg-[var(--accent)] !text-white !border-[var(--accent)]' : ''}`}
          >
            <MoreHorizontal size={15} />
          </button>

          {moreOpen && (
            <div className="absolute top-full mt-1 left-0 z-50 w-48 rounded-xl border border-[var(--border)] bg-[var(--card)] shadow-lg p-3 space-y-2">
              {market && (
                <div className="relative">
                  <select
                    value={market.selected}
                    onChange={(e) => { market.onChange(e.target.value); setMoreOpen(false); }}
                    className={`w-full ${selectCls}`}
                  >
                    {MARKET_OPTIONS.map((o) => (
                      <option key={o.key} value={o.key}>{o.label}</option>
                    ))}
                  </select>
                  <span className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-[var(--muted)] text-xs">▾</span>
                </div>
              )}
              {sort && (
                <div className="flex items-center gap-1">
                  <div className="relative flex-1">
                    <select
                      value={sort.selected}
                      onChange={(e) => sort.onChange(e.target.value)}
                      className={`w-full ${selectCls}`}
                    >
                      {sort.options.map((o) => (
                        <option key={o.key} value={o.key}>{o.label}</option>
                      ))}
                    </select>
                    <span className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-[var(--muted)] text-xs">▾</span>
                  </div>
                  {sort.selected === 'gap' && sort.onGapToggle && (
                    <button
                      onClick={sort.onGapToggle}
                      className="px-2 py-1.5 rounded-lg border border-[var(--border)] bg-[var(--card)] text-sm text-[var(--muted)] hover:bg-[var(--card-hover)] transition-colors shrink-0"
                    >
                      {sort.gapAsc ? '↑' : '↓'}
                    </button>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* ⚙ 가중치 버튼 */}
      {onWeightClick && (
        <button onClick={onWeightClick} className={`ml-auto sm:ml-0 ${iconBtnCls}`}>
          <SlidersHorizontal size={15} />
        </button>
      )}

      {/* 🔄 갱신 버튼 */}
      {onRefresh && (
        <button
          onClick={onRefresh}
          disabled={refreshing}
          className={`${iconBtnCls} disabled:opacity-50`}
        >
          <RefreshCw size={15} className={refreshing ? 'animate-spin' : ''} />
        </button>
      )}
    </div>
  );
}
```

- [ ] **Step 2: TypeScript 타입 체크**

```bash
cd /Users/thlee/GoogleDrive/DashboardStock/web && npx tsc --noEmit 2>&1 | head -30
```

Expected: 에러 없음

- [ ] **Step 3: 커밋**

```bash
cd /Users/thlee/GoogleDrive/DashboardStock && git add web/src/components/common/filter-bar.tsx && git commit -m "feat: FilterBar 컴포넌트 추가 (1줄 컴팩트 필터, 모바일 오버플로우)"
```

---

## Chunk 2: AI 신호 탭 통합

### Task 3: SignalFilterBar 생성 + signals/page.tsx 수정

**Files:**
- Create: `web/src/app/signals/signal-filter-bar.tsx`
- Modify: `web/src/app/signals/page.tsx`

---

- [ ] **Step 1: `signal-filter-bar.tsx` 파일 생성**

`web/src/app/signals/signal-filter-bar.tsx` 전체 내용:

```tsx
'use client';

import { useRouter } from 'next/navigation';
import { FilterBar } from '@/components/common/filter-bar';

const SIGNAL_SOURCE_OPTIONS = [
  { key: 'all',      label: '전체'   },
  { key: 'lassi',    label: '라씨'   },
  { key: 'stockbot', label: '스톡봇' },
  { key: 'quant',    label: '퀀트'   },
];

interface SignalFilterBarProps {
  dates: string[];        // page.tsx에서 getLastNWeekdays(7) 결과 전달
  selectedDate: string;
  activeSource: string;
}

export function SignalFilterBar({ dates, selectedDate, activeSource }: SignalFilterBarProps) {
  const router = useRouter();

  const buildUrl = (date: string, source: string) => {
    const p = new URLSearchParams();
    // dates[0] = 오늘 = 기본값 → 파라미터 생략
    if (date !== dates[0]) p.set('date', date);
    if (source !== 'all') p.set('source', source);
    const qs = p.toString();
    return qs ? `/signals?${qs}` : '/signals';
  };

  return (
    <FilterBar
      date={{
        dates,
        selected: selectedDate,
        onChange: (d) => router.push(buildUrl(d, activeSource)),
      }}
      source={{
        options: SIGNAL_SOURCE_OPTIONS,
        selected: activeSource,
        onChange: (s) => router.push(buildUrl(selectedDate, s)),
      }}
    />
  );
}
```

- [ ] **Step 2: `page.tsx` 수정 — DateSelector + source Links 제거, SignalFilterBar 삽입**

현재 `web/src/app/signals/page.tsx`에서 수정할 내용:

**2a. import 변경** — 파일 상단에서:
- 제거: `import { DateSelector } from "@/components/common/date-selector";`
- 추가: `import { SignalFilterBar } from "./signal-filter-bar";`

기존:
```typescript
import { DateSelector } from "@/components/common/date-selector";
```

새것:
```typescript
import { SignalFilterBar } from "./signal-filter-bar";
```

**2b. JSX 변경** — `{activeTab === "signals" && (` 블록 안:

기존 코드 (아래 전체 블록을 교체):
```tsx
{activeTab === "signals" && (
  <>
    <DateSelector basePath="/signals" selectedDate={selectedDate} weekdaysOnly includeAll />
    <div className="flex gap-2">
      {sources.map((src) => {
        const p = new URLSearchParams();
        if (selectedDate !== last7[0]) p.set("date", selectedDate);
        if (src !== "all") p.set("source", src);
        const qs = p.toString();
        return (
          <Link
            key={src}
            href={qs ? `/signals?${qs}` : "/signals"}
            className={`px-4 py-2 rounded-lg text-sm font-medium border transition-colors ${
              activeSource === src
                ? "bg-[var(--accent)] text-white border-[var(--accent)]"
                : "bg-[var(--card)] text-[var(--muted)] border-[var(--border)] hover:bg-[var(--card-hover)]"
            }`}
          >
            {src === "all" ? "전체" : SOURCE_LABELS[src]}
          </Link>
        );
      })}
    </div>
    <SignalColumns
```

새 코드:
```tsx
{activeTab === "signals" && (
  <>
    <SignalFilterBar dates={last7} selectedDate={selectedDate} activeSource={activeSource} />
    <SignalColumns
```

또한 다음도 제거한다:
- `const sources = ["all", "lassi", "stockbot", "quant"] as const;` 줄 (더 이상 사용되지 않음)
- `import { SOURCE_LABELS, extractSignalPrice }` → `SOURCE_LABELS`만 제거하고 `extractSignalPrice`는 유지:
  기존: `import { SOURCE_LABELS, extractSignalPrice } from "@/lib/signal-constants";`
  → 새것: `import { extractSignalPrice } from "@/lib/signal-constants";`
- 기존 `Link` import도 사용 여부 확인: `import Link from "next/link";` — `page.tsx`에서 탭 전환 Link 버튼에 여전히 사용하므로 유지한다.

- [ ] **Step 3: TypeScript 타입 체크**

```bash
cd /Users/thlee/GoogleDrive/DashboardStock/web && npx tsc --noEmit 2>&1 | head -30
```

Expected: 에러 없음

- [ ] **Step 4: 커밋**

```bash
cd /Users/thlee/GoogleDrive/DashboardStock && git add web/src/app/signals/signal-filter-bar.tsx web/src/app/signals/page.tsx && git commit -m "feat: AI 신호 탭 필터 → SignalFilterBar (1줄 컴팩트)"
```

---

## Chunk 3: 종목분석 탭 통합

### Task 4: UnifiedAnalysisSection 필터 UI 교체

**Files:**
- Modify: `web/src/components/signals/UnifiedAnalysisSection.tsx`

---

- [ ] **Step 1: import 라인 수정** (파일 상단)

기존:
```typescript
import { Search, ChevronLeft, ChevronRight, SlidersHorizontal, AlertTriangle, TrendingUp, TrendingDown, RefreshCw } from 'lucide-react';
import { getLastNWeekdays, formatDateLabel } from '@/lib/date-utils';
```

새것 (Search, SlidersHorizontal, RefreshCw 제거; formatDateLabel 제거; FilterBar 추가):
```typescript
import { ChevronLeft, ChevronRight, AlertTriangle, TrendingUp, TrendingDown } from 'lucide-react';
import { getLastNWeekdays } from '@/lib/date-utils';
import { FilterBar } from '@/components/common/filter-bar';
```

- [ ] **Step 2: 상수 수정** — `SORT_OPTIONS` 제거 후 `SOURCE_OPTIONS` + `SORT_OPTIONS_WITH_GAP` 추가

기존 상수 블록 (`// ── 상수` 섹션 내):
```typescript
const SORT_OPTIONS: { key: SortMode; label: string }[] = [
  { key: 'score', label: '점수순' },
  { key: 'name', label: '이름순' },
  { key: 'updated', label: '업데이트순' },
];
```

새것으로 교체:

```typescript
const SOURCE_OPTIONS = [
  { key: 'all',      label: '전체'   },
  { key: 'lassi',    label: '라씨'   },
  { key: 'stockbot', label: '스톡봇' },
  { key: 'quant',    label: '퀀트'   },
];

const SORT_OPTIONS_WITH_GAP: { key: SortMode; label: string }[] = [
  { key: 'score',   label: '점수순'    },
  { key: 'name',    label: '이름순'    },
  { key: 'updated', label: '업데이트순' },
  { key: 'gap',     label: 'Gap순'    },
];
```

또한 `MARKETS`와 `MARKET_LABELS` 상수 (lines 69-70)도 제거한다 — FilterBar 내부에서 고정 옵션을 직접 정의하므로 더 이상 사용되지 않음:

```typescript
// 아래 두 줄 삭제
const MARKETS = ['all', 'KOSPI', 'KOSDAQ'] as const;
const MARKET_LABELS: Record<string, string> = { all: '전체', KOSPI: 'KOSPI', KOSDAQ: 'KOSDAQ' };
```

- [ ] **Step 3: `btnCls` 함수 제거**

기존 (메인 컴포넌트 함수 내부, 약 line 540~545):
```typescript
const btnCls = (active: boolean) =>
  `px-3 py-1.5 rounded-lg text-sm font-medium border transition-colors ${
    active
      ? 'bg-[var(--accent)] text-white border-[var(--accent)]'
      : 'bg-[var(--card)] text-[var(--muted)] border-[var(--border)] hover:bg-[var(--card-hover)]'
  }`;
```

→ 이 전체 블록을 삭제한다.

- [ ] **Step 4: 필터 UI 3줄 → FilterBar 1줄로 교체**

`return (` 내부에서 아래 3개 블록 전체를 교체한다.

**제거할 블록 1** — 날짜 선택 (현재 약 line 549~559):
```tsx
{/* ── 날짜 선택 ── */}
<div className="flex gap-1.5 flex-wrap">
  {LAST7.map((date) => (
    <button key={date} onClick={() => handleDate(date)} className={btnCls(selectedDate === date)}>
      {formatDateLabel(date)}
    </button>
  ))}
  <button onClick={() => handleDate('all')} className={btnCls(selectedDate === 'all')}>
    전체
  </button>
</div>
```

**제거할 블록 2** — 필터 바 (현재 약 line 561~635):
```tsx
{/* ── 필터 바 (시장 + AI소스 + 검색 + 가중치 + 가격갱신) ── */}
<div className="flex flex-col sm:flex-row gap-2 items-start sm:items-center">
  ...
</div>
```

**제거할 블록 3** — 정렬 바 (현재 약 line 637~671):
```tsx
{/* ── 정렬 바 ── */}
<div className="flex gap-1 items-center flex-wrap">
  ...
</div>
```

**추가할 새 블록** (3개 블록을 삭제한 자리에 삽입):

```tsx
{/* ── 필터 바 ── */}
<div className="relative">
  <FilterBar
    date={{ dates: LAST7, selected: selectedDate, onChange: handleDate }}
    source={{ options: SOURCE_OPTIONS, selected: sourceFilter, onChange: (s) => setSourceFilter(s as SourceFilter) }}
    market={{ selected: market, onChange: handleMarket }}
    search={{ value: q, onChange: handleSearch, placeholder: '종목명 / 코드' }}
    sort={{
      options: SORT_OPTIONS_WITH_GAP,
      selected: sort,
      onChange: (s) => setSort(s as SortMode),
      gapAsc,
      onGapToggle: () => setGapAsc((v) => !v),
    }}
    onWeightClick={() => setShowWeights((v) => !v)}
    onRefresh={refreshPrices}
    refreshing={priceLoading || liveLoading}
  />
  {showWeights && (
    <WeightPopup
      weights={weights}
      onChange={setWeights}
      onClose={() => setShowWeights(false)}
    />
  )}
</div>

{/* ── 종목수 표시 (Block 2에서 추출·보존) ── */}
<div className="text-xs text-[var(--muted)]">
  {total.toLocaleString()}종목
  {aiCount > 0 && (
    <span className="ml-2 px-1.5 py-0.5 rounded bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300">
      AI분석 {aiCount}
    </span>
  )}
</div>
```

**주의:** Block 2 (`lines 561~635`) 전체를 삭제하되, 내부의 `{total.toLocaleString()}종목 / AI분석 {aiCount}` 표시 (`<div className="text-xs text-[var(--muted)] ml-auto shrink-0">` 블록, lines 627~634)는 삭제하지 않고 위 추가 블록의 두 번째 `<div>` 형태로 FilterBar 바로 아래에 별도 배치한다.

또한 `showWeights` 상태를 관리하는 `<div className="relative shrink-0">` 래퍼와 그 안의 ⚙ 버튼 + `{showWeights && <WeightPopup ... />}` 블록도 삭제한다 (FilterBar 교체 블록으로 통합됨).

- [ ] **Step 5: TypeScript 타입 체크**

```bash
cd /Users/thlee/GoogleDrive/DashboardStock/web && npx tsc --noEmit 2>&1 | head -30
```

Expected: 에러 없음

- [ ] **Step 6: lint 체크**

```bash
cd /Users/thlee/GoogleDrive/DashboardStock/web && npm run lint 2>&1 | tail -20
```

Expected: 경고/에러 없음 또는 기존과 동일한 수준

- [ ] **Step 7: 빌드 체크**

```bash
cd /Users/thlee/GoogleDrive/DashboardStock/web && npm run build 2>&1 | tail -30
```

Expected: Build 성공 (✓ Compiled successfully)

- [ ] **Step 8: 커밋**

```bash
cd /Users/thlee/GoogleDrive/DashboardStock && git add web/src/components/signals/UnifiedAnalysisSection.tsx && git commit -m "feat: 종목분석 탭 필터 → FilterBar 1줄 컴팩트 (SOURCE_OPTIONS, SORT_OPTIONS_WITH_GAP)"
```

---

## 검증 체크리스트

구현 완료 후 브라우저에서 확인:

### AI 신호 탭 (`/signals`)
- [ ] 날짜 드롭다운에 "오늘/어제/2일전/3일전/전체" + 직접 선택 달력 표시
- [ ] 날짜 선택 시 URL이 `/signals?date=YYYY-MM-DD`로 변경됨
- [ ] 소스 드롭다운에서 "전체/라씨/스톡봇/퀀트" 선택 가능
- [ ] 소스 선택 시 URL이 `/signals?source=lassi` 형태로 변경됨
- [ ] 모바일에서 필터가 1줄에 표시됨

### 종목분석 탭 (`/signals?tab=analysis`)
- [ ] 필터가 3줄 → 1줄로 줄어듦
- [ ] 날짜 드롭다운 동작
- [ ] 소스/시장/정렬 select 드롭다운 동작
- [ ] 정렬에서 "Gap순" 선택 시 ↑↓ 토글 버튼 표시
- [ ] ⚙ 버튼 클릭 시 WeightPopup 표시/숨김
- [ ] 🔄 버튼 클릭 시 현재가 갱신
- [ ] 모바일: 시장/정렬이 "⋯" 버튼으로 접힘
- [ ] 모바일: 🔍 아이콘 클릭 시 검색창 확장, Escape/blur 시 복귀
