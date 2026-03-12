# 종목 메뉴 개선 설계

**날짜**: 2026-03-13
**범위**: `StockListClient`, `WatchlistGroupTabs`, `StockActionMenu`, `page.tsx`, `group-drop-zone.tsx`(신규)

---

## 1. 제목 + 갱신 버튼 양쪽 정렬

**현재**: `page.tsx`에 제목, `StockListClient` 별도 div에 갱신 버튼
**변경**: `page.tsx`의 `<h1>종목</h1>` 섹션 제거 → `StockListClient` 최상단에 통합 헤더 추가

```tsx
<div className="flex items-start justify-between gap-4">
  <div>
    <h1 className="text-2xl font-bold">종목</h1>
    <p className="text-sm text-[var(--muted)] mt-1">관심종목 그룹 관리 및 전체 종목 조회</p>
  </div>
  <div className="flex items-center gap-2 flex-shrink-0">
    {priceUpdateLabel && <span className="text-xs ...">{priceUpdateLabel}</span>}
    <button onClick={refreshPrices}>갱신</button>
  </div>
</div>
```

---

## 2. 탭 기능 확장

### 2-A. 탭 이름 인라인 변경

- `SortableTab` 컴포넌트에 `isEditing` 로컬 상태 추가
- 더블클릭(`onDoubleClick`) → `isEditing = true` → `<input>` 렌더링 (현재 그룹명 pre-fill)
- Enter / blur → `onGroupRename(group, newName.trim())` 호출 → `PATCH /api/v1/watchlist-groups/:id` (이미 존재하는 엔드포인트)
- **드래그-더블클릭 충돌 해결**: dblclick은 PointerSensor activationConstraint(distance:5) 이전 이벤트이므로 `onDoubleClick` 핸들러 내에서 `event.stopPropagation()`을 호출해 dnd-kit 이벤트 전파 차단
- 기본 그룹(`is_default=true`)은 `onDoubleClick` 핸들러 미등록 (이름 변경 불가)
- `WatchlistGroupTabs`에 `onGroupRename: (group: WatchlistGroup, newName: string) => Promise<void>` 콜백 추가
- `StockListClient`의 `handleGroupRename`: `PATCH` 호출 성공 시 `setGroups`로 로컬 상태 업데이트, 중복명 409 시 에러 toast

### 2-B. 탭 드래그앤드랍 — 커스텀 그룹만, 기본 그룹 제외

기본 그룹은 드래그 대상에서 제외하되, `SortableContext`에는 포함 가능(단, `useSortable` 미사용). 변경 없음: **기존 구현 유지** (커스텀 그룹만 `SortableContext` + `useSortable`).

`WatchlistGroupTabs`의 `DndContext`에 `id="tabs-dnd"` 명시:
```tsx
<DndContext id="tabs-dnd" sensors={sensors} ...>
```

`onGroupsReorder` 콜백은 기존 그대로 커스텀 그룹 id 배열만 전달. `StockListClient.handleGroupsReorder`는 기본 그룹을 앞에 고정하는 기존 로직 유지.

### 2-C. 종목 행 드래그 → 그룹 드롭존

**DndContext 분리**: 탭용(`id="tabs-dnd"`)과 종목용(`id="stock-dnd"`)을 별도로 유지해 이벤트 누출 방지.

**구현 구조**:
```tsx
// StockListClient JSX
<DndContext id="stock-dnd" sensors={stockSensors} onDragStart={handleStockDragStart} onDragEnd={handleStockDragEnd}>
  {/* 테이블 (StockRow에 drag handle 추가) */}
  <DragOverlay>
    {draggingStock && <StockDragPreview stock={draggingStock} />}
  </DragOverlay>
  {/* GroupDropZone (draggingStock 있을 때만 렌더) */}
  {draggingStock && (
    <GroupDropZone groups={groups} symGroups={symGroups} draggingSymbol={draggingStock.symbol} />
  )}
</DndContext>
```

**StockRow 변경**: 첫 번째 열에 `GripVertical` 아이콘(drag handle) 추가. `useDraggable({ id: stock.symbol })`로 drag 등록. handle에만 `{...listeners}` 적용 (행 전체가 아닌 핸들만 드래그 가능).

**GroupDropZone 컴포넌트** (`group-drop-zone.tsx`):
- `position: fixed; bottom: 0; left: 0; right: 0` 슬라이드-업 패널
- 각 그룹 버튼: `useDroppable({ id: group.id })`
- 현재 종목이 이미 속한 그룹은 이미 체크 표시
- `DragOverlay`는 `DndContext id="stock-dnd"` 내부에 위치

**handleStockDragEnd**:
```typescript
function handleStockDragEnd({ active, over }: DragEndEvent) {
  setDraggingStock(null);
  if (!over || !draggingStock) return;
  const targetGroup = groups.find(g => g.id === over.id);
  if (!targetGroup) return;
  handleGroupToggle(targetGroup, draggingStock);
}
```

---

## 3. 즐겨찾기 상단 고정 토글

- `pinFavorites: boolean` 상태, **lazy initializer로 SSR 안전하게 처리**:
```typescript
const [pinFavorites, setPinFavorites] = useState<boolean>(
  () => typeof window !== "undefined"
    ? localStorage.getItem("pinFavorites") !== "false"
    : true
);
```
- 변경 시 `localStorage.setItem("pinFavorites", String(value))` 저장
- 탭 바 오른쪽에 `Pin`/`PinOff` 아이콘 토글 버튼 (lucide-react)
- **전체탭(DB 뷰)에서만 유효**: `activeTab === "all"` + `showAllStocksMode` 일 때 즐겨찾기 상단 고정 여부 제어
- `pinFavorites=false` 시: `mergedStocks` 계산에서 favs/nonFavs 분리 없이 혼합 정렬

---

## 4. 전체탭 동작 변경

### 변경 전
- 전체탭 = 모든 그룹 즐겨찾기 합집합 (탭 뷰)
- 즐겨찾기 없으면 전체 DB

### 변경 후
- **전체탭 = 항상 전체 DB 무한 스크롤 뷰** (즐겨찾기 유무 무관)
- 다른 그룹 탭 = 해당 그룹 즐겨찾기만 (검색어 없을 때)
- 기존 `tabFavorites` 중 `activeTab === "all"` 분기 제거

```typescript
// 변경 후 showAllStocksMode
const showAllStocksMode = activeTab === "all" || (favSet.size === 0 && !showSearchMode);
```

| 탭 | 검색어 없음 | 검색어 있음 |
|---|---|---|
| 전체탭 | 전체 DB (즐겨찾기 상단 고정 토글) | 전체 DB 검색 (즐겨찾기 필터링 포함) |
| 그룹탭 | 해당 그룹 즐겨찾기만 | 해당 그룹 즐겨찾기 중 일치 + DB 비즐겨찾기 |

---

## 5. 검색어 입력 시 즐겨찾기 필터링

현재 검색 모드에서 `displayStocks.favs` = 전체 즐겨찾기 (쿼리 무관).
**변경**: `mergedStocks` 계산 시 검색어로 즐겨찾기 필터링:

```typescript
const mergedStocks = useMemo(() => {
  const q = query.trim().toLowerCase();
  const baseFavs = activeTab === "all"
    ? favStocks  // 전체탭: 모든 즐겨찾기
    : favStocks.filter(s => (symGroups[s.symbol] ?? []).includes(activeTab)); // 그룹탭: 해당 그룹만

  const filteredFavs = showSearchMode && q
    ? baseFavs.filter(s =>
        s.name.toLowerCase().includes(q) || s.symbol.toLowerCase().includes(q)
      )
    : baseFavs;

  const favSymbols = new Set(filteredFavs.map(f => f.symbol));
  const updatedFavs = filteredFavs.map(fav => stocks.find(s => s.symbol === fav.symbol) ?? fav);
  const nonFavs = stocks.filter(s => !favSymbols.has(s.symbol));
  return { favs: updatedFavs, nonFavs };
}, [stocks, favStocks, query, showSearchMode, activeTab, symGroups]);
```

---

## 6. 낙관적 업데이트 버그 수정

**현재 문제**: `handleGroupToggle`에서 `await fetch()` 이후 state 업데이트 → API 응답 대기 중 UI 불변

**수정**: fetch 전에 먼저 state 업데이트, 실패 시 스냅샷(`symGroups`, `favSet`, `favStocks`) 롤백:

```typescript
const handleGroupToggle = useCallback(async (group: WatchlistGroup, stockOverride?: StockCache) => {
  const stock = stockOverride ?? groupPopup?.stock;
  if (!stock) return;

  // 롤백용 스냅샷
  const prevSymGroups = symGroups;
  const prevFavSet = new Set(favSet);
  const prevFavStocks = [...favStocks];

  const currentGroups = symGroups[stock.symbol] ?? [];
  const inGroup = currentGroups.includes(group.id);

  // 낙관적 업데이트 먼저
  if (inGroup) {
    const newGroups = currentGroups.filter(id => id !== group.id);
    setSymGroups(prev => ({ ...prev, [stock.symbol]: newGroups }));
    if (newGroups.length === 0) {
      setFavSet(prev => { const n = new Set(prev); n.delete(stock.symbol); return n; });
      setFavStocks(prev => prev.filter(s => s.symbol !== stock.symbol));
    }
  } else {
    setSymGroups(prev => ({ ...prev, [stock.symbol]: [...currentGroups, group.id] }));
    if (!favSet.has(stock.symbol)) {
      setFavSet(prev => new Set([...prev, stock.symbol]));
      setFavStocks(prev => [...prev, stock]);
    }
  }

  // API 호출 (실패 시 롤백)
  try {
    if (inGroup) {
      const res = await fetch(`/api/v1/watchlist-groups/${group.id}/stocks/${stock.symbol}`, { method: "DELETE" });
      if (!res.ok) throw new Error();
    } else {
      const res = await fetch(`/api/v1/watchlist-groups/${group.id}/stocks`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ symbol: stock.symbol, name: stock.name }),
      });
      if (!res.ok && !(await res.json().then(j => j.error?.includes("이미")))) throw new Error();
    }
  } catch {
    // 롤백
    setSymGroups(prevSymGroups);
    setFavSet(prevFavSet);
    setFavStocks(prevFavStocks);
  }
}, [groupPopup, symGroups, favSet, favStocks]);
```

---

## 7. 팝업 버튼 재구성

**현재 순서**: 포트에 추가 → 즐겨찾기 추가/해제(★) → 상세보기
**변경 후 순서**: 상세보기 → 포트에 추가 → 관심그룹 일괄 해제 (★ 버튼 제거)

**"관심그룹 일괄 해제"** 신규 버튼:
- `isFavorite=true`일 때만 렌더
- 클릭 시 `onToggleFavorite()` 호출 → 부모의 `handleStarClick`이 모든 그룹에서 제거 처리 (기존 로직 재사용)
- 아이콘: `StarOff` (lucide-react)
- 레이블: "관심그룹 일괄 해제"

---

## 영향 받는 파일

| 파일 | 변경 내용 |
|---|---|
| `web/src/app/stocks/page.tsx` | 제목 섹션 제거 |
| `web/src/components/stocks/stock-list-client.tsx` | 헤더 통합, 전체탭 로직, 검색 필터링, 낙관적 업데이트, 핀 토글, 종목 DndContext |
| `web/src/components/stocks/watchlist-group-tabs.tsx` | `DndContext id="tabs-dnd"` 추가, 인라인 이름 변경, `onGroupRename` 콜백 |
| `web/src/components/stocks/group-drop-zone.tsx` | 신규: 종목 드래그 드롭존 |
| `web/src/components/common/stock-action-menu.tsx` | 버튼 순서 변경, "관심그룹 일괄 해제" 신규 버튼 |
