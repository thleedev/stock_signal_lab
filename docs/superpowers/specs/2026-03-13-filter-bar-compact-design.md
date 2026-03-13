# Filter Bar Compact UI Design

## Goal

AI 신호 페이지(`/signals`)의 두 탭(AI 신호, 종목분석)에서 여러 줄을 차지하는 필터 버튼들을 **1줄 컴팩트 FilterBar**로 교체한다. 날짜는 프리셋+달력 드롭다운, 나머지 필터는 select 드롭다운으로 변경한다.

---

## Current State

### AI 신호 탭 필터 (2줄)

- Row 1: DateSelector — 최근 7 평일 버튼 + 전체 버튼 (Link 기반, URL param)
- Row 2: 소스 필터 — 전체/라씨/스톡봇/퀀트 버튼 (Link 기반, URL param)

### 종목분석 탭 필터 (3줄)

- Row 1: 날짜 버튼 7개 + 전체
- Row 2: 시장 버튼 3개 + 검색 입력 + 가중치 버튼
- Row 3: 정렬 버튼 4개 (점수/이름/업데이트/Gap)

---

## New Design

### Component Structure

```text
web/src/components/common/
  ├── date-dropdown.tsx       새로 생성 — 날짜 드롭다운 (프리셋 + 달력)
  └── filter-bar.tsx          새로 생성 — 1줄 필터 컨테이너

web/src/app/signals/
  └── signal-filter-bar.tsx   새로 생성 — AI 신호 탭용 클라이언트 래퍼

web/src/components/signals/
  └── UnifiedAnalysisSection.tsx  수정 — 필터 UI → FilterBar 교체

web/src/app/signals/
  └── page.tsx                수정 — DateSelector + source Links → SignalFilterBar

web/src/components/common/
  └── date-selector.tsx       유지 — 다른 페이지 호환성 보존
```

---

## DateDropdown Component

### Props

```typescript
interface DateDropdownProps {
  dates: string[];        // 최근 평일 목록 (YYYY-MM-DD), 보통 4~7개 — 전달된 개수만큼 프리셋 렌더링
  selected: string;       // 선택된 날짜 또는 'all'
  onChange: (date: string) => void;
}
```

### 날짜 레이블 헬퍼

`DateDropdown` 내부에서 사용하는 레이블 헬퍼 함수 (파일 내부에 정의):

```typescript
function getDatePresetLabel(date: string, dates: string[]): string {
  if (date === 'all') return '전체';
  const idx = dates.indexOf(date);
  if (idx === 0) return '오늘';
  if (idx === 1) return '어제';
  if (idx === 2) return '2일전';
  if (idx === 3) return '3일전';
  return formatDateLabel(date); // index 4+ 또는 커스텀 날짜 → M/D(요일) 포맷
}
```

`formatDateLabel`은 `@/lib/date-utils`에 이미 존재. 시그니처: `formatDateLabel(dateStr: string): string` → `M/D(요일)` 반환 (예: `3/13(목)`). `'all'`을 직접 전달하면 오작동하므로 항상 `getDatePresetLabel`을 통해 레이블 생성.

### Behavior

- 트리거 버튼에 현재 선택값의 레이블 표시: `getDatePresetLabel(selected, dates)`
- 클릭 시 팝업 표시:
  - 프리셋 항목: `dates` 배열 전체를 순서대로 표시 — `getDatePresetLabel(date, dates)`로 레이블 생성
  - "전체" 항목 (`'all'` 값) → 레이블 "전체"
  - 구분선
  - 직접 선택: `<input type="date">` (네이티브 달력) — 선택 시 `onChange(e.target.value)` 호출 (`YYYY-MM-DD` 형식)
- 항목 선택 즉시 팝업 닫힘
- 팝업 외부 클릭 시 닫힘 (useEffect + mousedown listener)

---

## FilterBar Component

### FilterBar Props

```typescript
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
    // options는 FilterBar 내부에 고정값으로 정의: [{key:'all',label:'전체'},{key:'KOSPI',label:'KOSPI'},{key:'KOSDAQ',label:'KOSDAQ'}]
  };
  search?: {
    value: string;
    onChange: (q: string) => void;
    placeholder?: string;
  };
  sort?: {
    options: { key: string; label: string }[];
    selected: string;
    onChange: (s: string) => void;  // 호출자에서 타입 캐스트 필요: (s) => setSort(s as SortMode)
    gapAsc?: boolean;
    onGapToggle?: () => void;
  };
  onWeightClick?: () => void;
  onRefresh?: () => void;
  refreshing?: boolean;
}
```

각 prop이 없으면 해당 필터 미렌더링.

### Layout

**데스크탑 (`sm:`):**

```text
[DateDropdown] [소스▼?] [시장▼?] [검색──────?] [정렬▼?] [⚙?] [🔄?]
```

**모바일 (기본):**

```text
[DateDropdown] [소스▼?] [🔍?] [⋯▼?]    [⚙?] [🔄?]
                              └ 시장 + 정렬 접힘
```

모바일에서 시장과 정렬은 "⋯" 버튼을 클릭하면 팝업으로 표시. 검색은 🔍 아이콘 클릭 시 인라인 확장.

"⋯" 버튼은 `market` 또는 `sort` prop 중 하나라도 있을 때만 렌더링한다. 둘 다 없으면 버튼 미표시.

"⋯" 팝업 상세:

- FilterBar 하단에 절대위치(absolute)로 렌더, z-50, 왼쪽 정렬
- 내부에 시장 `<select>` + 정렬 `<select>` + Gap ↑↓ 토글(데스크탑과 동일하게 sort가 `'gap'`일 때만 렌더링) 세로 배치
- 외부 클릭 시 닫힘 (useEffect + mousedown listener, DateDropdown과 동일 패턴)
- FilterBar 컨테이너는 `relative` 포지션 적용

### Select Dropdowns (소스, 시장, 정렬)

네이티브 `<select>` + 커스텀 스타일:

```tsx
<select
  value={selected}
  onChange={(e) => onChange(e.target.value)}
  className="pl-3 pr-7 py-1.5 rounded-lg border border-[var(--border)] bg-[var(--card)] text-sm text-[var(--foreground)] appearance-none cursor-pointer focus:outline-none focus:border-[var(--accent)]"
>
  {options.map(o => <option key={o.key} value={o.key}>{o.label}</option>)}
</select>
```

Gap 정렬은 sort select에서 "Gap순" 선택 시 sort `<select>` 바로 오른쪽에 ↑↓ 토글 버튼 표시 (데스크탑 및 모바일 "⋯" 팝업 모두 동일).

---

## AI 신호 탭 통합 (SignalFilterBar)

`signal-filter-bar.tsx`: `"use client"` 컴포넌트.

- `useRouter` + `useSearchParams`로 URL param 업데이트
- `date` 변경 → `router.push('/signals?date=...&source=...')`
- `source` 변경 → 동일 패턴

소스 옵션 상수 (파일 내부에 정의):

```typescript
const SIGNAL_SOURCE_OPTIONS = [
  { key: 'all',      label: '전체' },
  { key: 'lassi',    label: '라씨' },
  { key: 'stockbot', label: '스톡봇' },
  { key: 'quant',    label: '퀀트' },
];
```

`SignalFilterBar`는 `selectedDate`와 `activeSource`를 props로 받아 `FilterBar`에 전달한다:

```typescript
interface SignalFilterBarProps {
  dates: string[];        // page.tsx에서 getLastNWeekdays(7) 결과 전달
  selectedDate: string;
  activeSource: string;
}
```

`page.tsx`에서 기존 DateSelector + source Link 버튼 블록 제거 후 `<SignalFilterBar>` 삽입.

---

## 종목분석 탭 통합 (UnifiedAnalysisSection)

`FilterBar`를 import하여 기존 필터 UI 3줄 교체.

`UnifiedAnalysisSection` 내부에 추가할 상수:

```typescript
const SOURCE_OPTIONS = [
  { key: 'all',      label: '전체' },
  { key: 'lassi',    label: '라씨' },
  { key: 'stockbot', label: '스톡봇' },
  { key: 'quant',    label: '퀀트' },
];

// 기존 SORT_OPTIONS에 Gap 항목 추가 (Gap sort는 select <option>으로 통합)
const SORT_OPTIONS_WITH_GAP: { key: SortMode; label: string }[] = [
  { key: 'score',   label: '점수순' },
  { key: 'name',    label: '이름순' },
  { key: 'updated', label: '업데이트순' },
  { key: 'gap',     label: 'Gap순' },
];
```

기존 `SORT_OPTIONS` 상수(3개 항목)는 `SORT_OPTIONS_WITH_GAP`으로 교체한다. 별도 Gap 버튼 UI는 제거되며 sort select에서 "Gap순" 선택 후 ↑↓ 토글 버튼으로 방향 제어.

```tsx
<FilterBar
  date={{ dates: LAST7, selected: selectedDate, onChange: handleDate }}
  source={{ options: SOURCE_OPTIONS, selected: sourceFilter, onChange: setSourceFilter }}
  market={{ selected: market, onChange: handleMarket }}
  search={{ value: q, onChange: handleSearch, placeholder: '종목명 / 코드' }}
  sort={{
    options: SORT_OPTIONS_WITH_GAP,
    selected: sort,
    onChange: (s) => setSort(s as SortMode),
    gapAsc,
    onGapToggle: () => setGapAsc(v => !v),
  }}
  onWeightClick={() => setShowWeights(v => !v)}
  onRefresh={refreshPrices}
  refreshing={priceLoading || liveLoading}
/>
```

WeightPopup은 `UnifiedAnalysisSection`이 외부에서 렌더한다 (`FilterBar` 내부가 아님). `onWeightClick`은 콜백만 전달하며, `FilterBar`는 ⚙ 버튼 클릭 시 이를 호출한다. `UnifiedAnalysisSection`의 JSX 구조:

```tsx
<div className="relative">
  <FilterBar ... onWeightClick={() => setShowWeights(v => !v)} />
  {showWeights && <WeightPopup ... />}  {/* absolute positioned below FilterBar */}
</div>
```

---

## Mobile Overflow Strategy

종목분석 탭에서 모바일 화면에 맞지 않는 필터(시장, 정렬):

- `sm:hidden` / `hidden sm:flex` 클래스로 데스크탑/모바일 분기
- 모바일 "⋯" 버튼 클릭 시 오버레이 패널에 시장 + 정렬 표시
- 검색: 모바일에서 🔍 아이콘 버튼 → 클릭 시 FilterBar 전체 너비 input으로 인라인 확장. 확장 시 DateDropdown, 소스, ⋯ 버튼은 숨김 처리하며 ⚙ 및 🔄 버튼은 유지한다. Escape 키 또는 input blur 시 다시 🔍 아이콘으로 복귀. 확장된 input의 placeholder는 `search.placeholder` prop 값 사용.

---

## Constraints

- 기존 `date-selector.tsx`는 다른 페이지(stocks 등)에서 사용 중이므로 수정하지 않는다
- AI 신호 탭의 날짜/소스 필터는 URL param 기반을 유지한다 (SEO, 공유 링크 호환)
- 외부 date picker 라이브러리 추가 없이 네이티브 `<input type="date">`를 사용한다
