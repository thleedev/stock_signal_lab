# 종목 메뉴 개선 Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 종목 페이지 헤더 통합, 탭 인라인 이름 변경, 즐겨찾기 상단 고정 토글, 전체탭 전체DB 뷰, 검색어 즐겨찾기 필터링, 낙관적 업데이트 버그 수정, 팝업 버튼 재구성, 종목 드래그→그룹 드롭존 구현.

**Architecture:** 기존 `StockListClient`(client component)에 대부분의 로직이 집중된다. 탭 DnD는 `WatchlistGroupTabs`에 id 격리, 종목 드래그는 별도 `DndContext id="stock-dnd"` + 신규 `GroupDropZone` 컴포넌트로 분리한다. 낙관적 업데이트는 fetch 전 state 선적용→실패 시 스냅샷 롤백 패턴을 적용한다.

**Tech Stack:** Next.js 15 App Router, React 18, TypeScript, @dnd-kit/core + @dnd-kit/sortable, Tailwind CSS, lucide-react

---

## 파일 맵

| 파일 | 역할 | 변경 유형 |
|---|---|---|
| `web/src/app/stocks/page.tsx` | 서버 컴포넌트 — 제목 섹션 제거 | 수정 |
| `web/src/components/stocks/stock-list-client.tsx` | 클라이언트 — 헤더, 로직, DnD, 핀 토글 | 수정 (대규모) |
| `web/src/components/stocks/watchlist-group-tabs.tsx` | 탭 바 — DndContext id, 인라인 이름 변경 | 수정 |
| `web/src/components/stocks/group-drop-zone.tsx` | 종목 드래그 드롭존 오버레이 | 신규 생성 |
| `web/src/components/common/stock-action-menu.tsx` | 팝업 — 버튼 순서/내용 변경 | 수정 |

---

## Chunk 1: 빠른 수정 (헤더, 팝업, 버그픽스)

### Task 1: 헤더 통합 — page.tsx 제목 제거 + StockListClient 헤더 추가

**Files:**
- Modify: `web/src/app/stocks/page.tsx`
- Modify: `web/src/components/stocks/stock-list-client.tsx`

- [ ] **Step 1: page.tsx에서 제목 섹션 제거**

`web/src/app/stocks/page.tsx` 에서 아래 블록 삭제:

```tsx
// 삭제할 블록 (현재 99~106줄)
<div className="space-y-6">
  <div>
    <h1 className="text-2xl font-bold">종목</h1>
    <p className="text-sm text-[var(--muted)] mt-1">
      관심종목 그룹 관리 및 전체 종목 조회
    </p>
  </div>
  <StockListClient .../>
</div>
```

변경 후:

```tsx
return (
  <StockListClient
    initialStocks={mergeSignals(stocks)}
    favorites={mergeSignals(favorites)}
    watchlistSymbols={watchlistSymbols}
    lastPriceUpdate={lastPriceUpdate}
    groups={groups}
    symbolGroups={symbolGroups}
    hasFavorites={hasFavorites}
  />
);
```

- [ ] **Step 2: StockListClient의 기존 갱신 버튼 div를 헤더 행으로 교체**

`stock-list-client.tsx`에서 기존 갱신 버튼 영역(아래 코드)을 찾아 교체한다:

```tsx
// 기존 (삭제)
{/* 가격 업데이트 상태 + 갱신 버튼 */}
<div className="flex items-center justify-end gap-2">
  {priceUpdateLabel && (
    <span className={`text-xs ${isStale ? "text-yellow-400" : "text-[var(--muted)]"}`}>
      {priceUpdateLabel}
    </span>
  )}
  <button
    onClick={refreshPrices}
    disabled={refreshing}
    className="flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-medium bg-[var(--card)] border border-[var(--border)] text-[var(--muted)] hover:text-[var(--foreground)] transition-colors disabled:opacity-50"
  >
    <RefreshCw className={`w-3 h-3 ${refreshing ? "animate-spin" : ""}`} />
    갱신
  </button>
</div>
```

```tsx
// 교체 후
{/* 페이지 헤더 — 제목 왼쪽, 갱신 버튼 오른쪽 */}
<div className="flex items-start justify-between gap-4">
  <div>
    <h1 className="text-2xl font-bold">종목</h1>
    <p className="text-sm text-[var(--muted)] mt-1">관심종목 그룹 관리 및 전체 종목 조회</p>
  </div>
  <div className="flex items-center gap-2 flex-shrink-0 pt-1">
    {priceUpdateLabel && (
      <span className={`text-xs ${isStale ? "text-yellow-400" : "text-[var(--muted)]"}`}>
        {priceUpdateLabel}
      </span>
    )}
    <button
      onClick={refreshPrices}
      disabled={refreshing}
      className="flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-medium bg-[var(--card)] border border-[var(--border)] text-[var(--muted)] hover:text-[var(--foreground)] transition-colors disabled:opacity-50"
    >
      <RefreshCw className={`w-3 h-3 ${refreshing ? "animate-spin" : ""}`} />
      갱신
    </button>
  </div>
</div>
```

- [ ] **Step 3: TypeScript 컴파일 확인**

```bash
cd /Users/thlee/GoogleDrive/DashboardStock/web && npx tsc --noEmit
```

Expected: 오류 없음

- [ ] **Step 4: 커밋**

```bash
git add web/src/app/stocks/page.tsx web/src/components/stocks/stock-list-client.tsx
git commit -m "feat: 종목 페이지 헤더와 갱신 버튼 양쪽 정렬로 통합"
```

---

### Task 2: 팝업 버튼 재구성 — stock-action-menu.tsx

**Files:**
- Modify: `web/src/components/common/stock-action-menu.tsx`

- [ ] **Step 1: import에 StarOff 추가**

```tsx
// 기존
import { Star, Briefcase, ExternalLink, X, Check } from "lucide-react";
// 변경
import { StarOff, Briefcase, ExternalLink, X, Check } from "lucide-react";
```

`Star`는 이제 사용하지 않으므로 제거. 기존 코드에서 `<Star .../>` 사용처를 확인하면 즐겨찾기 버튼 내부인데, 이 버튼 자체가 제거되므로 `Star` import 불필요.

- [ ] **Step 2: 메뉴 항목 순서 재구성 및 버튼 교체**

기존 `{/* 메뉴 항목 */}` 블록 전체를 아래로 교체한다:

```tsx
{/* 메뉴 항목 */}
<div className="py-1">
  {/* 1. 상세보기 */}
  <button
    onClick={handleViewDetail}
    className="w-full flex items-center gap-3 px-4 py-2.5 text-sm hover:bg-[var(--card-hover)] transition-colors text-left"
  >
    <ExternalLink className="w-4 h-4 text-[var(--muted)]" />
    <span>상세보기</span>
  </button>

  {/* 2. 포트에 추가/삭제 */}
  <button
    onClick={handleAddToPortfolio}
    disabled={adding}
    className="w-full flex items-center gap-3 px-4 py-2.5 text-sm hover:bg-[var(--card-hover)] transition-colors text-left"
  >
    <Briefcase className={`w-4 h-4 ${isInPortfolio ? "text-purple-400" : "text-[var(--muted)]"}`} />
    <span>{isInPortfolio ? "포트에서 삭제" : "포트에 추가"}</span>
  </button>

  {/* 3. 관심그룹 일괄 해제 (즐겨찾기인 경우만) */}
  {isFavorite && (
    <button
      onClick={() => { onToggleFavorite?.(); onClose(); }}
      className="w-full flex items-center gap-3 px-4 py-2.5 text-sm hover:bg-[var(--card-hover)] transition-colors text-left text-orange-400 hover:text-orange-300"
    >
      <StarOff className="w-4 h-4" />
      <span>관심그룹 일괄 해제</span>
    </button>
  )}
</div>
```

**주의**: `handleAddToPortfolio`에서 기존에 `onClose()` 호출이 있으므로 포트 버튼은 그대로 유지. "관심그룹 일괄 해제" 버튼은 `onToggleFavorite` 호출 후 `onClose`도 호출한다 (메뉴 닫기).

기존 `handleToggleFavorite` 콜백 함수는 더 이상 JSX에서 사용하지 않지만 내부 fallback으로 유지하거나 제거한다. `onToggleFavorite` prop이 있는 경우 직접 사용하므로 `handleToggleFavorite` 제거 가능하나, 혼선 방지를 위해 JSX에서 직접 `onToggleFavorite?.()` 호출로 대체.

- [ ] **Step 3: TypeScript 컴파일 확인**

```bash
cd /Users/thlee/GoogleDrive/DashboardStock/web && npx tsc --noEmit
```

Expected: 오류 없음

- [ ] **Step 4: 커밋**

```bash
git add web/src/components/common/stock-action-menu.tsx
git commit -m "feat: StockActionMenu 버튼 순서 변경 + 관심그룹 일괄 해제 버튼 추가"
```

---

### Task 3: 낙관적 업데이트 버그 수정 — handleGroupToggle

**Files:**
- Modify: `web/src/components/stocks/stock-list-client.tsx`

- [ ] **Step 1: handleGroupToggle를 낙관적 업데이트 패턴으로 교체**

`stock-list-client.tsx`에서 `handleGroupToggle` 함수 전체를 아래로 교체한다. deps 배열에 `favStocks` 추가 필요.

```typescript
const handleGroupToggle = useCallback(
  async (group: WatchlistGroup, stockOverride?: StockCache) => {
    const stock = stockOverride ?? groupPopup?.stock;
    if (!stock) return;

    // 롤백용 스냅샷
    const prevSymGroups = symGroups;
    const prevFavSet = new Set(favSet);
    const prevFavStocks = [...favStocks];

    const currentGroups = symGroups[stock.symbol] ?? [];
    const inGroup = currentGroups.includes(group.id);

    // 낙관적 업데이트 먼저 (API 호출 전에 UI 즉시 반영)
    if (inGroup) {
      const newGroups = currentGroups.filter((id) => id !== group.id);
      setSymGroups((prev) => ({ ...prev, [stock.symbol]: newGroups }));
      if (newGroups.length === 0) {
        setFavSet((prev) => { const n = new Set(prev); n.delete(stock.symbol); return n; });
        setFavStocks((prev) => prev.filter((s) => s.symbol !== stock.symbol));
      }
    } else {
      setSymGroups((prev) => ({ ...prev, [stock.symbol]: [...currentGroups, group.id] }));
      if (!favSet.has(stock.symbol)) {
        setFavSet((prev) => new Set([...prev, stock.symbol]));
        setFavStocks((prev) => [...prev, stock]);
      }
    }

    // API 호출 (실패 시 롤백)
    try {
      if (inGroup) {
        const res = await fetch(
          `/api/v1/watchlist-groups/${group.id}/stocks/${stock.symbol}`,
          { method: "DELETE" }
        );
        if (!res.ok) throw new Error("DELETE 실패");
      } else {
        const res = await fetch(`/api/v1/watchlist-groups/${group.id}/stocks`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ symbol: stock.symbol, name: stock.name }),
        });
        // 409(이미 존재)는 무시
        if (!res.ok && res.status !== 409) throw new Error("POST 실패");
      }
    } catch (e) {
      console.error("[handleGroupToggle] API 실패, 롤백:", e);
      setSymGroups(prevSymGroups);
      setFavSet(prevFavSet);
      setFavStocks(prevFavStocks);
    }
  },
  [groupPopup, symGroups, favSet, favStocks]
);
```

- [ ] **Step 2: TypeScript 컴파일 확인**

```bash
cd /Users/thlee/GoogleDrive/DashboardStock/web && npx tsc --noEmit
```

Expected: 오류 없음

- [ ] **Step 3: 커밋**

```bash
git add web/src/components/stocks/stock-list-client.tsx
git commit -m "fix: handleGroupToggle 낙관적 업데이트로 변경 — 그룹 추가 즉시 UI 반영"
```

---

### Task 4: WatchlistGroupTabs — DndContext id 격리 + 탭 이름 인라인 변경

**Files:**
- Modify: `web/src/components/stocks/watchlist-group-tabs.tsx`
- Modify: `web/src/components/stocks/stock-list-client.tsx` (handleGroupRename 추가)

- [ ] **Step 1: WatchlistGroupTabs Props에 onGroupRename 추가**

`watchlist-group-tabs.tsx` 상단 interface에 추가:

```typescript
interface Props {
  groups: WatchlistGroup[];
  activeTab: TabId;
  onTabChange: (tab: TabId) => void;
  onGroupAdd: (name: string) => Promise<void>;
  onGroupDelete: (group: WatchlistGroup) => void;
  onGroupsReorder: (ids: string[]) => void;
  onGroupRename: (group: WatchlistGroup, newName: string) => Promise<void>; // 신규
}
```

- [ ] **Step 2: SortableTab 컴포넌트에 인라인 이름 변경 기능 추가**

`SortableTab` 컴포넌트를 아래로 교체:

```tsx
function SortableTab({
  group,
  isActive,
  onSelect,
  onDelete,
  onRename,
}: {
  group: WatchlistGroup;
  isActive: boolean;
  onSelect: () => void;
  onDelete: () => void;
  onRename: (newName: string) => Promise<void>;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id: group.id });
  const [isEditing, setIsEditing] = useState(false);
  const [editName, setEditName] = useState(group.name);
  const inputRef = useRef<HTMLInputElement>(null);

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };

  async function handleRenameConfirm() {
    const trimmed = editName.trim();
    if (!trimmed || trimmed === group.name) {
      setIsEditing(false);
      setEditName(group.name);
      return;
    }
    try {
      await onRename(trimmed);
      setIsEditing(false);
    } catch {
      setEditName(group.name);
      setIsEditing(false);
    }
  }

  return (
    <div ref={setNodeRef} style={style} className="flex items-center gap-1">
      {isEditing ? (
        <input
          ref={inputRef}
          autoFocus
          value={editName}
          onChange={(e) => setEditName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") handleRenameConfirm();
            if (e.key === "Escape") { setIsEditing(false); setEditName(group.name); }
          }}
          onBlur={handleRenameConfirm}
          className="w-24 px-2 py-1 text-sm bg-[var(--card)] border border-[#6366f1] rounded-lg outline-none"
        />
      ) : (
        <button
          {...attributes}
          {...listeners}
          onClick={onSelect}
          onDoubleClick={(e) => {
            if (group.is_default) return; // 기본 그룹 이름 변경 불가
            e.stopPropagation();
            setIsEditing(true);
            setEditName(group.name);
          }}
          className={`flex items-center gap-1 px-3 py-1.5 rounded-lg text-sm whitespace-nowrap transition-colors ${
            isActive
              ? "bg-[#6366f1] text-white"
              : "text-[var(--muted)] hover:bg-[var(--card-hover)] hover:text-[var(--foreground)]"
          }`}
        >
          {group.name}
        </button>
      )}
      {!group.is_default && (
        <button
          onClick={onDelete}
          className="p-0.5 rounded hover:bg-red-900/40 text-[var(--muted)] hover:text-red-400 transition-colors"
          title="그룹 삭제"
        >
          <X className="w-3 h-3" />
        </button>
      )}
    </div>
  );
}
```

추가 import: `useRef` (이미 있음 확인), `useState` (이미 있음 확인).

- [ ] **Step 3: WatchlistGroupTabs 함수 시그니처 + DndContext id + SortableTab onRename 전달**

```tsx
export default function WatchlistGroupTabs({
  groups,
  activeTab,
  onTabChange,
  onGroupAdd,
  onGroupDelete,
  onGroupsReorder,
  onGroupRename, // 신규
}: Props) {
```

DndContext에 `id` 추가:

```tsx
<DndContext id="tabs-dnd" sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
```

`SortableTab` 렌더링 시 `onRename` 전달:

```tsx
<SortableTab
  key={group.id}
  group={group}
  isActive={activeTab === group.id}
  onSelect={() => onTabChange(group.id)}
  onDelete={() => onGroupDelete(group)}
  onRename={(newName) => onGroupRename(group, newName)}
/>
```

- [ ] **Step 4: StockListClient에 handleGroupRename 추가 + WatchlistGroupTabs에 prop 전달**

`stock-list-client.tsx`에 추가:

```typescript
const handleGroupRename = useCallback(async (group: WatchlistGroup, newName: string) => {
  const res = await fetch(`/api/v1/watchlist-groups/${group.id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name: newName }),
  });
  if (!res.ok) {
    const json = await res.json();
    throw new Error(json.error ?? "그룹명 변경 실패");
  }
  setGroups((prev) =>
    prev.map((g) => (g.id === group.id ? { ...g, name: newName } : g))
  );
}, []);
```

JSX에서 `WatchlistGroupTabs`에 prop 추가:

```tsx
<WatchlistGroupTabs
  groups={groups}
  activeTab={activeTab}
  onTabChange={setActiveTab}
  onGroupAdd={handleGroupAdd}
  onGroupDelete={handleGroupDelete}
  onGroupsReorder={handleGroupsReorder}
  onGroupRename={handleGroupRename}
/>
```

- [ ] **Step 5: TypeScript 컴파일 확인**

```bash
cd /Users/thlee/GoogleDrive/DashboardStock/web && npx tsc --noEmit
```

Expected: 오류 없음

- [ ] **Step 6: 커밋**

```bash
git add web/src/components/stocks/watchlist-group-tabs.tsx web/src/components/stocks/stock-list-client.tsx
git commit -m "feat: 탭 이름 더블클릭 인라인 변경 + DndContext id 격리"
```

---

## Chunk 2: 로직 변경 (전체탭, 검색, 핀 토글)

### Task 5: 전체탭 동작 변경 + 검색어 즐겨찾기 필터링

**Files:**
- Modify: `web/src/components/stocks/stock-list-client.tsx`

현재 로직:
- `showAllStocksMode = favSet.size === 0 && !showSearchMode` (즐겨찾기 없을 때만 전체DB)
- `tabFavorites`의 "all" 분기: 모든 즐겨찾기 dedup해서 탭 뷰로 표시
- 검색 시 `displayStocks.favs` = 전체 즐겨찾기 (쿼리 미필터)

변경 목표:
- 전체탭 = 항상 전체DB 무한스크롤 뷰
- 검색어 있을 때 즐겨찾기도 query 필터링
- 그룹탭 + 검색어: 해당 그룹 즐겨찾기 중 일치 + DB 비즐겨찾기

- [ ] **Step 1: showAllStocksMode 조건 변경**

```typescript
// 기존
const showAllStocksMode = favSet.size === 0 && !showSearchMode;

// 변경
const showAllStocksMode = activeTab === "all" || (favSet.size === 0 && !showSearchMode);
```

- [ ] **Step 2: mergedStocks useMemo 교체 — 검색어 + 탭 필터 반영**

기존 `mergedStocks` useMemo 전체를 아래로 교체:

```typescript
const mergedStocks = useMemo(() => {
  const q = query.trim().toLowerCase();

  // 현재 탭 기준 즐겨찾기 선택
  const baseFavs =
    activeTab === "all"
      ? favStocks // 전체탭: 모든 즐겨찾기
      : favStocks.filter((s) => (symGroups[s.symbol] ?? []).includes(activeTab)); // 그룹탭

  // 검색어가 있으면 이름/심볼로 즐겨찾기 필터링
  const filteredFavs =
    showSearchMode && q
      ? baseFavs.filter(
          (s) =>
            s.name.toLowerCase().includes(q) ||
            s.symbol.toLowerCase().includes(q)
        )
      : baseFavs;

  // 최신 가격 데이터로 즐겨찾기 업데이트
  const updatedFavs = filteredFavs.map(
    (fav) => stocks.find((s) => s.symbol === fav.symbol) ?? fav
  );
  const favSymbols = new Set(filteredFavs.map((f) => f.symbol));
  const nonFavs = stocks.filter((s) => !favSymbols.has(s.symbol));

  return { favs: updatedFavs, nonFavs };
}, [stocks, favStocks, query, showSearchMode, activeTab, symGroups]);
```

- [ ] **Step 3: tabFavorites useMemo 제거 또는 단순화**

기존 `tabFavorites`는 `showAllStocksMode`가 아닐 때 (그룹탭, 검색어 없음) 사용됐다. 이제 `mergedStocks.favs`가 탭+검색어 필터를 모두 처리하므로, 탭 뷰에서도 `mergedStocks.favs`를 사용한다.

기존 `tabFavorites` 선언 제거:

```typescript
// 삭제
const tabFavorites = useMemo(() => { ... }, [...]);
```

JSX에서 탭 뷰 테이블의 `tabFavorites` 참조를 `mergedStocks.favs`로 교체:

```tsx
// 기존 탭 뷰 (JSX)
{tabFavorites.map((stock) => (
  <StockRow key={stock.symbol} stock={stock} isFav={true} ... />
))}

// 변경
{mergedStocks.favs.map((stock) => (
  <StockRow key={stock.symbol} stock={stock} isFav={true} ... />
))}
```

그룹탭 빈 상태 메시지도 `tabFavorites.length === 0` → `mergedStocks.favs.length === 0`로 교체:

```tsx
// 기존
tabFavorites.length === 0 ? (
  <div className="text-center py-16 ...">이 그룹에 관심종목이 없습니다...</div>
) : (...)

// 변경 (검색어도 고려)
mergedStocks.favs.length === 0 ? (
  <div className="text-center py-16 text-[var(--muted)] text-sm">
    {showSearchMode
      ? "검색 결과가 없습니다"
      : "이 그룹에 관심종목이 없습니다. ★를 클릭해 추가하세요."}
  </div>
) : (...)
```

- [ ] **Step 4: TypeScript 컴파일 확인**

```bash
cd /Users/thlee/GoogleDrive/DashboardStock/web && npx tsc --noEmit
```

Expected: 오류 없음

- [ ] **Step 5: 커밋**

```bash
git add web/src/components/stocks/stock-list-client.tsx
git commit -m "feat: 전체탭 항상 전체DB 뷰 + 검색 시 즐겨찾기도 쿼리 필터링"
```

---

### Task 6: 즐겨찾기 상단 고정 토글

**Files:**
- Modify: `web/src/components/stocks/stock-list-client.tsx`
- Modify: `web/src/components/stocks/watchlist-group-tabs.tsx`

- [ ] **Step 1: stock-list-client.tsx에 pinFavorites 상태 추가**

import에 `Pin`, `PinOff` 추가 (lucide-react):

```typescript
import { Star, Search, ArrowUpDown, Loader2, Briefcase, RefreshCw, Pin, PinOff } from "lucide-react";
```

`useState` 선언들 아래에 추가:

```typescript
const [pinFavorites, setPinFavorites] = useState<boolean>(
  () =>
    typeof window !== "undefined"
      ? localStorage.getItem("pinFavorites") !== "false"
      : true
);

const handlePinToggle = useCallback(() => {
  setPinFavorites((prev) => {
    const next = !prev;
    localStorage.setItem("pinFavorites", String(next));
    return next;
  });
}, []);
```

- [ ] **Step 2: displayStocks useMemo에 pinFavorites 적용**

기존 `displayStocks` useMemo를 아래로 교체:

```typescript
const displayStocks = useMemo(() => {
  const favs = [...mergedStocks.favs];
  const nonFavs = [...mergedStocks.nonFavs];

  if (sortBy === "gap") {
    const sortByGap = (a: StockCache, b: StockCache) => {
      const gapA = calcGap(a, gapSource);
      const gapB = calcGap(b, gapSource);
      if (gapA == null && gapB == null) return 0;
      if (gapA == null) return 1;
      if (gapB == null) return -1;
      const aPos = gapA.gap > 0;
      const bPos = gapB.gap > 0;
      if (aPos && !bPos) return -1;
      if (!aPos && bPos) return 1;
      return gapA.gap - gapB.gap;
    };
    favs.sort(sortByGap);
    nonFavs.sort(sortByGap);
  }

  // pinFavorites=false이고 전체탭(DB 뷰)일 때: favs/nonFavs 혼합 정렬
  if (!pinFavorites && activeTab === "all") {
    const combined = [...favs, ...nonFavs];
    if (sortBy === "gap") return { favs: [], nonFavs: combined };
    // 이름순(기본) 또는 다른 정렬
    return { favs: [], nonFavs: combined };
  }

  return { favs, nonFavs };
}, [mergedStocks, sortBy, gapSource, pinFavorites, activeTab]);
```

- [ ] **Step 3: WatchlistGroupTabs에 핀 토글 버튼 영역 추가**

`WatchlistGroupTabs` Props에 추가:

```typescript
interface Props {
  // ...기존...
  pinFavorites: boolean;
  onPinToggle: () => void;
}
```

`WatchlistGroupTabs` JSX 최외곽 div를 수정해 핀 버튼을 오른쪽에 배치:

```tsx
return (
  <div className="flex items-center gap-1 flex-wrap justify-between">
    {/* 탭 목록 */}
    <div className="flex items-center gap-1 flex-wrap">
      {/* 전체 탭 */}
      <button ...>전체</button>
      {/* 기본 탭 */}
      ...
      {/* 커스텀 탭 DnD */}
      <DndContext id="tabs-dnd" ...>...</DndContext>
      {/* + 버튼 */}
      {canAdd && (...)}
    </div>

    {/* 즐겨찾기 고정 토글 (전체탭 DB 뷰에서 유효) */}
    <button
      onClick={onPinToggle}
      title={pinFavorites ? "즐겨찾기 상단 고정 해제" : "즐겨찾기 상단 고정"}
      className={`p-1.5 rounded-lg transition-colors ${
        pinFavorites
          ? "text-yellow-400 hover:bg-[var(--card-hover)]"
          : "text-[var(--muted)] hover:bg-[var(--card-hover)]"
      }`}
    >
      {pinFavorites ? <Pin className="w-4 h-4" /> : <PinOff className="w-4 h-4" />}
    </button>
  </div>
);
```

`Pin`, `PinOff` import 추가:

```typescript
import { Plus, X, Pin, PinOff } from "lucide-react";
```

- [ ] **Step 4: StockListClient JSX에서 WatchlistGroupTabs에 props 전달**

```tsx
<WatchlistGroupTabs
  groups={groups}
  activeTab={activeTab}
  onTabChange={setActiveTab}
  onGroupAdd={handleGroupAdd}
  onGroupDelete={handleGroupDelete}
  onGroupsReorder={handleGroupsReorder}
  onGroupRename={handleGroupRename}
  pinFavorites={pinFavorites}
  onPinToggle={handlePinToggle}
/>
```

- [ ] **Step 5: TypeScript 컴파일 확인**

```bash
cd /Users/thlee/GoogleDrive/DashboardStock/web && npx tsc --noEmit
```

Expected: 오류 없음

- [ ] **Step 6: 커밋**

```bash
git add web/src/components/stocks/stock-list-client.tsx web/src/components/stocks/watchlist-group-tabs.tsx
git commit -m "feat: 즐겨찾기 상단 고정 토글 (Pin/PinOff) + localStorage 저장"
```

---

## Chunk 3: 종목 드래그 → 그룹 드롭존

### Task 7: GroupDropZone 컴포넌트 신규 생성

**Files:**
- Create: `web/src/components/stocks/group-drop-zone.tsx`

- [ ] **Step 1: GroupDropZone 컴포넌트 작성**

```typescript
// web/src/components/stocks/group-drop-zone.tsx
"use client";

import { useDroppable } from "@dnd-kit/core";
import { Check } from "lucide-react";
import type { WatchlistGroup } from "@/types/stock";

interface GroupDropZoneProps {
  groups: WatchlistGroup[];
  draggingSymbol: string;
  symGroups: Record<string, string[]>;
}

function DroppableGroupButton({
  group,
  isAlreadyIn,
}: {
  group: WatchlistGroup;
  isAlreadyIn: boolean;
}) {
  const { isOver, setNodeRef } = useDroppable({ id: group.id });

  return (
    <div
      ref={setNodeRef}
      className={`flex items-center gap-2 px-4 py-3 rounded-xl border-2 transition-all cursor-pointer min-w-[100px] justify-center ${
        isOver
          ? "border-[#6366f1] bg-[#6366f1]/20 scale-105"
          : isAlreadyIn
          ? "border-[#6366f1]/50 bg-[var(--card)]"
          : "border-[var(--border)] bg-[var(--card)] hover:border-[#6366f1]/50"
      }`}
    >
      {isAlreadyIn && <Check className="w-4 h-4 text-[#6366f1]" />}
      <span className={`text-sm font-medium ${isAlreadyIn ? "text-[#6366f1]" : "text-[var(--foreground)]"}`}>
        {group.name}
      </span>
    </div>
  );
}

export default function GroupDropZone({ groups, draggingSymbol, symGroups }: GroupDropZoneProps) {
  const currentGroupIds = symGroups[draggingSymbol] ?? [];

  return (
    <div className="fixed bottom-0 left-0 right-0 z-50 animate-slide-up">
      <div className="bg-[var(--background)]/95 backdrop-blur border-t border-[var(--border)] px-6 py-4">
        <p className="text-xs text-[var(--muted)] mb-3 text-center">드롭하여 관심그룹에 추가</p>
        <div className="flex gap-3 justify-center flex-wrap">
          {groups.map((group) => (
            <DroppableGroupButton
              key={group.id}
              group={group}
              isAlreadyIn={currentGroupIds.includes(group.id)}
            />
          ))}
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: `animate-slide-up` CSS 추가**

`web/src/app/globals.css` 또는 tailwind config에 keyframe 추가. globals.css 접근:

```css
/* globals.css에 추가 */
@keyframes slide-up {
  from { transform: translateY(100%); }
  to { transform: translateY(0); }
}

.animate-slide-up {
  animation: slide-up 0.2s ease-out;
}
```

- [ ] **Step 3: TypeScript 컴파일 확인**

```bash
cd /Users/thlee/GoogleDrive/DashboardStock/web && npx tsc --noEmit
```

Expected: 오류 없음

---

### Task 8: StockListClient — 종목 드래그 DndContext 통합

**Files:**
- Modify: `web/src/components/stocks/stock-list-client.tsx`
- Modify: `web/src/components/stocks/group-drop-zone.tsx` (필요시)

- [ ] **Step 1: 필요한 dnd-kit imports 추가**

`stock-list-client.tsx` import에 추가:

```typescript
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import GroupDropZone from "@/components/stocks/group-drop-zone";
```

- [ ] **Step 2: draggingStock 상태 + DnD 핸들러 추가**

컴포넌트 내 상태 선언부에 추가:

```typescript
const [draggingStock, setDraggingStock] = useState<StockCache | null>(null);

const stockSensors = useSensors(
  useSensor(PointerSensor, { activationConstraint: { distance: 8 } })
);

const handleStockDragStart = useCallback((event: DragStartEvent) => {
  const stock = [...favStocks, ...stocks].find((s) => s.symbol === event.active.id);
  if (stock) setDraggingStock(stock);
}, [favStocks, stocks]);

const handleStockDragEnd = useCallback((event: DragEndEvent) => {
  const { active, over } = event;
  setDraggingStock(null);
  if (!over || !draggingStock) return;
  const targetGroup = groups.find((g) => g.id === over.id);
  if (!targetGroup) return;
  handleGroupToggle(targetGroup, draggingStock);
}, [draggingStock, groups, handleGroupToggle]);
```

- [ ] **Step 3: StockRow에 GripVertical drag handle 열 추가**

`StockRow` 컴포넌트 수정:

import 추가:

```typescript
import { useDraggable } from "@dnd-kit/core";
import { GripVertical } from "lucide-react";
```

`StockRowProps`에 추가:

```typescript
interface StockRowProps {
  stock: StockCache;
  isFav: boolean;
  gapSource: SourceKey | "all";
  isInPortfolio: boolean;
  onToggleFavorite: (stock: StockCache) => void;
  onRowClick: (e: React.MouseEvent, stock: StockCache) => void;
  isDraggingAny?: boolean; // 전체 드래그 중 여부 (드롭존 힌트용)
}
```

`StockRow` 함수 내부 상단에 추가:

```typescript
const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
  id: stock.symbol,
});
```

`<tr>` 태그에 `ref={setNodeRef}` 추가, 스타일 조정:

```tsx
<tr
  ref={setNodeRef}
  onClick={(e) => onRowClick(e, stock)}
  className={`hover:bg-[var(--card-hover)] transition-colors cursor-pointer ${
    isFav ? "bg-yellow-900/5" : ""
  } ${isDragging ? "opacity-30" : ""}`}
>
  <td className="px-3 py-2.5">
    <div className="flex items-center gap-0.5">
      {/* Drag handle */}
      <span
        {...attributes}
        {...listeners}
        className="cursor-grab active:cursor-grabbing p-0.5 text-[var(--border)] hover:text-[var(--muted)] touch-none"
        onClick={(e) => e.stopPropagation()}
      >
        <GripVertical className="w-3.5 h-3.5" />
      </span>
      {/* 즐겨찾기 버튼 */}
      <button
        onClick={(e) => { e.stopPropagation(); onToggleFavorite(stock); }}
        className="p-0.5 hover:scale-110 transition-transform"
      >
        <Star
          className={`w-4 h-4 ${
            isFav
              ? "text-yellow-400 fill-yellow-400"
              : "text-[var(--border)] hover:text-yellow-400"
          }`}
        />
      </button>
      {isInPortfolio && (
        <Briefcase className="w-3.5 h-3.5 text-emerald-400 fill-emerald-400/20" />
      )}
    </div>
  </td>
  {/* 나머지 셀 유지 */}
  ...
```

- [ ] **Step 4: StockListClient return에 DndContext id="stock-dnd" 추가**

전체 return JSX를 `DndContext`로 감싼다:

```tsx
return (
  <DndContext
    id="stock-dnd"
    sensors={stockSensors}
    onDragStart={handleStockDragStart}
    onDragEnd={handleStockDragEnd}
  >
    <div className="space-y-4">
      {/* 헤더 */}
      ...
      {/* 탭 바 */}
      ...
      {/* 필터 바 */}
      ...
      {/* 종목 리스트 */}
      ...
      {/* GroupSelectPopup */}
      ...
      {/* StockActionMenu */}
      ...
    </div>

    {/* DragOverlay — DndContext 내부에 위치 */}
    <DragOverlay>
      {draggingStock && (
        <div className="bg-[var(--card)] border border-[#6366f1] rounded-lg px-4 py-2.5 shadow-2xl text-sm font-medium">
          {draggingStock.name}
          <span className="ml-2 text-xs text-[var(--muted)]">{draggingStock.symbol}</span>
        </div>
      )}
    </DragOverlay>

    {/* GroupDropZone — 드래그 중일 때만 렌더 */}
    {draggingStock && (
      <GroupDropZone
        groups={groups}
        draggingSymbol={draggingStock.symbol}
        symGroups={symGroups}
      />
    )}
  </DndContext>
);
```

- [ ] **Step 5: TypeScript 컴파일 확인**

```bash
cd /Users/thlee/GoogleDrive/DashboardStock/web && npx tsc --noEmit
```

Expected: 오류 없음

- [ ] **Step 6: 빌드 확인**

```bash
cd /Users/thlee/GoogleDrive/DashboardStock/web && npm run build 2>&1 | tail -20
```

Expected: 빌드 성공

- [ ] **Step 7: 커밋**

```bash
git add web/src/components/stocks/group-drop-zone.tsx web/src/components/stocks/stock-list-client.tsx web/src/app/globals.css
git commit -m "feat: 종목 행 드래그 → 그룹 드롭존으로 관심그룹 추가"
```
