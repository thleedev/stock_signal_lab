# 종목 메뉴 개선 설계

**날짜**: 2026-03-13
**범위**: `StockListClient`, `WatchlistGroupTabs`, `StockActionMenu`, `stock-action-menu.tsx`, `page.tsx`

---

## 1. 제목 + 갱신 버튼 양쪽 정렬

### 현재 구조
- `page.tsx` (서버 컴포넌트): `<h1>종목</h1>` + 설명 텍스트
- `stock-list-client.tsx` (클라이언트): 별도 `div`에 갱신 버튼 + 업데이트 시각

### 변경
- `page.tsx`의 제목 섹션 제거
- `StockListClient` 최상단에 `flex items-center justify-between` 헤더 행 추가:
  - 왼쪽: `<h1>종목</h1>` + 설명
  - 오른쪽: 업데이트 시각 + 갱신 버튼

---

## 2. 탭 기능 확장

### 2-A. 탭 이름 인라인 변경
- `SortableTab` 컴포넌트에 `isEditing` 상태 추가
- 더블클릭 → `<input>` 렌더링 (현재 그룹명 pre-fill)
- Enter / blur → `PATCH /api/v1/watchlist-groups/:id { name }` 호출
- 성공 시 `setGroups`로 로컬 상태 업데이트
- 기본 그룹(`is_default=true`)은 더블클릭 이벤트 무시 (이름 변경 불가)
- `WatchlistGroupTabs`에 `onGroupRename: (group: WatchlistGroup, newName: string) => Promise<void>` 콜백 추가

### 2-B. 탭 드래그앤드랍 (기본 그룹 포함 전체 정렬)
- 현재: 커스텀 그룹만 `SortableContext`에 포함
- 변경: 기본 그룹도 포함하여 모든 그룹 드래그 가능
- 기본 그룹은 삭제/이름변경만 불가 (서버 가드), 순서 변경은 허용
- `onGroupsReorder` 콜백은 전체 그룹 id 배열 전달로 확장
- reorder API(`PUT /api/v1/watchlist-groups/reorder`)는 `is_default` 여부 무관하게 sort_order만 업데이트

### 2-C. 종목 행 드래그 → 그룹 드롭존
- `StockRow`에 drag handle 열 추가 (`GripVertical` 아이콘, `useDraggable` from dnd-kit)
- `DndContext`를 `StockListClient` 수준에서 wrapping (탭 DndContext와 별도, 중첩 불가 → 별도 컨텍스트 ID 구분)
- 드래그 시작(`onDragStart`) → `draggingStock` 상태 설정
- 드래그 중: 화면 하단에 `GroupDropZone` 컴포넌트 슬라이드-업 (fixed position, bottom-0)
  - 각 그룹 버튼을 `useDroppable`로 등록
  - 현재 종목이 속한 그룹은 이미 체크 표시
- 드롭 완료(`onDragEnd`): `handleGroupToggle(targetGroup, draggingStock)` 호출
- `DragOverlay`: 드래그 중 종목명 + 코드 표시
- `draggingStock` 해제 → `GroupDropZone` 슬라이드-다운 후 언마운트

**신규 컴포넌트**: `web/src/components/stocks/group-drop-zone.tsx`

---

## 3. 즐겨찾기 상단 고정 토글

- `pinFavorites: boolean` 상태 추가 (초기값 `localStorage.getItem('pinFavorites') !== 'false'`, 즉 기본 켜짐)
- 탭 바 오른쪽에 핀 토글 버튼 (`Pin` / `PinOff` 아이콘, lucide-react)
- `pinFavorites=true`일 때: 현재 동작 유지 (즐겨찾기 상단 고정)
- `pinFavorites=false`일 때: 즐겨찾기와 비즐겨찾기 구분 없이 선택된 정렬 기준으로 혼합
- 전체탭(DB 뷰)에서만 유효 (그룹 탭은 즐겨찾기만 표시하므로 핀 무의미)
- 상태 변경 시 `localStorage.setItem('pinFavorites', ...)` 저장

---

## 4. 전체탭 동작 변경

### 기존
- 전체탭 = 모든 그룹의 즐겨찾기 합집합 (탭 뷰)
- 즐겨찾기 없으면 전체 DB 뷰

### 변경
- **전체탭 = 항상 전체 DB 무한 스크롤 뷰** (즐겨찾기 유무와 무관)
- 즐겨찾기는 `pinFavorites` 설정에 따라 상단 고정 또는 혼합
- 다른 그룹 탭 = 해당 그룹 즐겨찾기만 (검색어 없을 때)
- `showAllStocksMode` 조건 변경: `activeTab === "all"` 이면 항상 전체DB 뷰

### 탭별 표시 로직 정리
| 상태 | 전체탭 | 그룹탭 |
|---|---|---|
| 검색어 없음 | 전체 DB (즐겨찾기 상단 고정 토글) | 해당 그룹 즐겨찾기만 |
| 검색어 있음 | 전체 DB 검색 결과 (즐겨찾기 필터링 포함) | 해당 그룹 즐겨찾기 중 일치 + DB 검색 결과 |

---

## 5. 검색어 입력 시 즐겨찾기 필터링

### 현재
- 검색 모드에서 `displayStocks.favs` = 전체 즐겨찾기 (쿼리 무관)

### 변경
- 검색 모드에서 `displayStocks.favs` = `query`로 `name/symbol` 필터링된 즐겨찾기
- 그룹탭 + 검색어: 해당 그룹 즐겨찾기 중 검색어에 맞는 것 + DB 검색 결과 (비즐겨찾기)
- 전체탭 + 검색어: 전체 즐겨찾기 중 검색어에 맞는 것 + DB 검색 결과 (비즐겨찾기)

```typescript
// mergedStocks 계산 시
const filteredFavs = showSearchMode
  ? favStocks.filter(s =>
      s.name.includes(query) || s.symbol.includes(query.toUpperCase())
    )
  : favStocks;
```

---

## 6. 낙관적 업데이트 버그 수정

### 현재 문제
`handleGroupToggle`에서 `await fetch()` 이후 state 업데이트 → API 응답 대기 중 UI 불변

### 수정 방법
1. fetch **이전**에 먼저 `setSymGroups` / `setFavSet` / `setFavStocks` 업데이트 (낙관적)
2. API 실패 시 이전 상태로 롤백 (`prevSymGroups`, `prevFavSet`, `prevFavStocks` 스냅샷 보존)

```typescript
const handleGroupToggle = useCallback(async (group, stockOverride?) => {
  const stock = stockOverride ?? groupPopup?.stock;
  if (!stock) return;

  // 롤백용 스냅샷
  const prevSymGroups = symGroups;
  const prevFavSet = favSet;
  const prevFavStocks = favStocks;

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
      await fetch(`/api/v1/watchlist-groups/${group.id}/stocks/${stock.symbol}`, { method: "DELETE" });
    } else {
      await fetch(`/api/v1/watchlist-groups/${group.id}/stocks`, { method: "POST", ... });
    }
  } catch {
    setSymGroups(prevSymGroups);
    setFavSet(prevFavSet);
    setFavStocks(prevFavStocks);
  }
}, [groupPopup, symGroups, favSet, favStocks]);
```

---

## 7. 팝업 버튼 재구성

### 현재 순서
1. 포트에 추가/삭제
2. 즐겨찾기 추가/해제 (★)
3. 상세보기

### 변경 후 순서
1. 상세보기
2. 포트에 추가/삭제
3. 관심그룹 일괄 해제 (즐겨찾기인 경우만 표시, `isFavorite=true`일 때)

**"관심그룹 일괄 해제"**: 클릭 시 `onToggleFavorite()` 호출 (부모의 `handleStarClick` 위임, 모든 그룹 제거 로직 동일)

---

## 영향 받는 파일

| 파일 | 변경 내용 |
|---|---|
| `web/src/app/stocks/page.tsx` | 제목 섹션 제거 |
| `web/src/components/stocks/stock-list-client.tsx` | 헤더 통합, 전체탭 로직, 검색 필터링, 낙관적 업데이트, 핀 토글, 드래그 컨텍스트 |
| `web/src/components/stocks/watchlist-group-tabs.tsx` | 인라인 이름 변경, 전체 그룹 드래그, onGroupRename 콜백 |
| `web/src/components/stocks/group-drop-zone.tsx` | 신규: 드래그 드롭존 |
| `web/src/components/common/stock-action-menu.tsx` | 버튼 순서/내용 변경 |
