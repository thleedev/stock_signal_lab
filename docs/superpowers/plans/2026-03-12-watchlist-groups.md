# 종목 페이지 — 관심종목 그룹 관리 구현 계획

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** "전종목" 메뉴를 "종목"으로 개명하고, 관심종목을 다중 그룹(watchlist_groups)으로 관리하는 기능을 구현한다.

**Architecture:** DB에 `watchlist_groups`(그룹 메타)와 `watchlist_group_stocks`(그룹↔종목 매핑) 테이블을 신설한다. 기존 `favorite_stocks`는 마스터 테이블로 유지하고 데이터를 기본 그룹으로 마이그레이션한다. 프론트엔드는 `WatchlistGroupTabs` 컴포넌트(dnd-kit 드래그)와 `GroupSelectPopup`을 신설하고, `StockListClient`의 진입·검색·★ 동작을 새 구조에 맞게 개선한다.

**Tech Stack:** Next.js 14 App Router, TypeScript, Supabase (PostgreSQL), @dnd-kit/core + @dnd-kit/sortable, Tailwind CSS

---

## 파일 맵

### 신규 생성

| 파일 | 역할 |
|---|---|
| `supabase/migrations/028_watchlist_groups.sql` | DB 스키마 + 데이터 마이그레이션 |
| `web/src/app/api/v1/watchlist-groups/route.ts` | 그룹 목록 조회 / 생성 / 순서 변경 |
| `web/src/app/api/v1/watchlist-groups/[id]/route.ts` | 그룹명 변경 / 삭제 |
| `web/src/app/api/v1/watchlist-groups/[id]/stocks/route.ts` | 그룹 내 종목 조회 / 추가 |
| `web/src/app/api/v1/watchlist-groups/[id]/stocks/[symbol]/route.ts` | 그룹에서 종목 제거 |
| `web/src/components/stocks/watchlist-group-tabs.tsx` | 그룹 탭 바 (드래그앤드랍, +버튼, ×버튼) |
| `web/src/components/stocks/group-select-popup.tsx` | ★ 클릭 시 그룹 선택 팝업 |

### 수정

| 파일 | 변경 내용 |
|---|---|
| `web/src/components/layout/sidebar.tsx` | "전 종목" → "종목" |
| `web/src/app/stocks/page.tsx` | watchlist_groups 서버사이드 로드, props 변경 |
| `web/src/components/stocks/stock-list-client.tsx` | 그룹 탭 통합, 진입/검색/★ 동작 |
| `web/src/components/common/stock-action-menu.tsx` | "관심그룹에 추가" 서브메뉴 |
| `web/src/app/settings/favorites-manager.tsx` | 새 API로 재연동 |
| `web/src/types/stock.ts` | `WatchlistGroup` 타입 추가 |

---

## Chunk 1: DB 마이그레이션 & API

### Task 1: DB 마이그레이션

**Files:**
- Create: `supabase/migrations/028_watchlist_groups.sql`

- [ ] **Step 1: 마이그레이션 파일 작성**

```sql
-- supabase/migrations/028_watchlist_groups.sql

-- 1. 그룹 메타 테이블
CREATE TABLE IF NOT EXISTS watchlist_groups (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0,
  is_default BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE (name)
);

CREATE INDEX IF NOT EXISTS idx_watchlist_groups_sort ON watchlist_groups(sort_order);

-- 2. 그룹↔종목 매핑 테이블
CREATE TABLE IF NOT EXISTS watchlist_group_stocks (
  group_id UUID REFERENCES watchlist_groups(id) ON DELETE CASCADE,
  symbol VARCHAR(10) NOT NULL,
  added_at TIMESTAMPTZ DEFAULT now(),
  PRIMARY KEY (group_id, symbol)
);

CREATE INDEX IF NOT EXISTS idx_wgs_symbol ON watchlist_group_stocks(symbol);

-- 3. 기본 그룹 생성
INSERT INTO watchlist_groups (name, sort_order, is_default)
VALUES ('기본', 0, true)
ON CONFLICT (name) DO NOTHING;

-- 4. 기존 favorite_stocks → 기본 그룹으로 마이그레이션
INSERT INTO watchlist_group_stocks (group_id, symbol, added_at)
SELECT
  (SELECT id FROM watchlist_groups WHERE is_default = true LIMIT 1),
  symbol,
  added_at
FROM favorite_stocks
ON CONFLICT DO NOTHING;

-- 5. favorite_stocks.group_name deprecated (컬럼은 유지, 새 코드에서 읽지 않음)
COMMENT ON COLUMN favorite_stocks.group_name IS 'deprecated: use watchlist_group_stocks instead';
```

- [ ] **Step 2: Supabase에 마이그레이션 적용**

```bash
cd /Users/thlee/GoogleDrive/DashboardStock
npx supabase db push
# 또는 Supabase 대시보드에서 SQL 에디터에 직접 실행
```

확인: `watchlist_groups`에 "기본" 행 1개, `watchlist_group_stocks`에 기존 즐겨찾기 수만큼 행 존재

- [ ] **Step 3: 타입 추가**

`web/src/types/stock.ts`에 추가:
```typescript
export interface WatchlistGroup {
  id: string;
  name: string;
  sort_order: number;
  is_default: boolean;
  created_at: string;
}
```

- [ ] **Step 4: 커밋**

```bash
git add supabase/migrations/028_watchlist_groups.sql web/src/types/stock.ts
git commit -m "feat: watchlist_groups DB 마이그레이션 + WatchlistGroup 타입"
```

---

### Task 2: GET/POST 그룹 API (`/api/v1/watchlist-groups`)

**Files:**
- Create: `web/src/app/api/v1/watchlist-groups/route.ts`

- [ ] **Step 1: 파일 작성**

```typescript
// web/src/app/api/v1/watchlist-groups/route.ts
import { NextRequest } from 'next/server';
import { createServiceClient } from '@/lib/supabase';

// GET — 그룹 목록 (sort_order 순)
export async function GET() {
  const supabase = createServiceClient();
  const { data, error } = await supabase
    .from('watchlist_groups')
    .select('*')
    .order('sort_order', { ascending: true });

  if (error) return Response.json({ error: error.message }, { status: 500 });
  return Response.json({ groups: data });
}

// POST — 그룹 생성
export async function POST(request: NextRequest) {
  const body = await request.json();
  const name = (body.name ?? '').trim();

  if (!name) return Response.json({ error: 'name is required' }, { status: 400 });

  const supabase = createServiceClient();

  // 최대 20개 체크 (기본 포함)
  const { count } = await supabase
    .from('watchlist_groups')
    .select('*', { count: 'exact', head: true });
  if ((count ?? 0) >= 20) {
    return Response.json({ error: '그룹은 최대 20개까지 만들 수 있습니다.' }, { status: 400 });
  }

  // sort_order: 현재 최대값 + 1
  const { data: maxRow } = await supabase
    .from('watchlist_groups')
    .select('sort_order')
    .order('sort_order', { ascending: false })
    .limit(1)
    .single();
  const sortOrder = (maxRow?.sort_order ?? -1) + 1;

  const { data, error } = await supabase
    .from('watchlist_groups')
    .insert({ name, sort_order: sortOrder })
    .select()
    .single();

  if (error) {
    // unique violation → 중복 이름
    if (error.code === '23505') {
      return Response.json({ error: '이미 존재하는 그룹명입니다.' }, { status: 409 });
    }
    return Response.json({ error: error.message }, { status: 500 });
  }

  return Response.json({ group: data }, { status: 201 });
}

// PUT — 그룹 순서 일괄 변경 { ids: string[] }
export async function PUT(request: NextRequest) {
  const body = await request.json();
  const ids: string[] = body.ids ?? [];

  if (!ids.length) return Response.json({ error: 'ids required' }, { status: 400 });

  const supabase = createServiceClient();

  // 고정 탭([전체]는 DB에 없고 프론트에서만 처리, [기본]은 sort_order 0 고정)
  // ids는 커스텀 그룹만 순서대로 전달 (기본 그룹 제외)
  const updates = ids.map((id, index) =>
    supabase
      .from('watchlist_groups')
      .update({ sort_order: index + 1 })  // 기본은 0이므로 +1부터
      .eq('id', id)
      .eq('is_default', false)            // 기본 그룹은 수정 불가
  );

  const results = await Promise.all(updates);
  const failed = results.find((r) => r.error);
  if (failed?.error) return Response.json({ error: failed.error.message }, { status: 500 });

  return Response.json({ success: true });
}
```

- [ ] **Step 2: 브라우저에서 확인**

```
GET http://localhost:3000/api/v1/watchlist-groups
→ { groups: [{ id, name: "기본", sort_order: 0, is_default: true, ... }] }

POST http://localhost:3000/api/v1/watchlist-groups
body: { "name": "성장주" }
→ 201 { group: { id, name: "성장주", ... } }

POST (중복)
body: { "name": "성장주" }
→ 409 { error: "이미 존재하는 그룹명입니다." }
```

- [ ] **Step 3: 커밋**

```bash
git add web/src/app/api/v1/watchlist-groups/route.ts
git commit -m "feat: watchlist-groups GET/POST/PUT(reorder) API"
```

---

### Task 3: 그룹 PATCH/DELETE API (`/api/v1/watchlist-groups/[id]`)

**Files:**
- Create: `web/src/app/api/v1/watchlist-groups/[id]/route.ts`

- [ ] **Step 1: 파일 작성**

```typescript
// web/src/app/api/v1/watchlist-groups/[id]/route.ts
import { NextRequest } from 'next/server';
import { createServiceClient } from '@/lib/supabase';

type Params = { params: { id: string } };

// PATCH — 그룹명 변경
export async function PATCH(request: NextRequest, { params }: Params) {
  const body = await request.json();
  const name = (body.name ?? '').trim();
  if (!name) return Response.json({ error: 'name is required' }, { status: 400 });

  const supabase = createServiceClient();

  const { data, error } = await supabase
    .from('watchlist_groups')
    .update({ name })
    .eq('id', params.id)
    .eq('is_default', false)  // 기본 그룹 이름 변경 불가
    .select()
    .single();

  if (error) {
    if (error.code === '23505') {
      return Response.json({ error: '이미 존재하는 그룹명입니다.' }, { status: 409 });
    }
    return Response.json({ error: error.message }, { status: 500 });
  }
  if (!data) return Response.json({ error: 'not found or protected' }, { status: 404 });

  return Response.json({ group: data });
}

// DELETE — 그룹 삭제 (종목 정리 포함)
export async function DELETE(_: NextRequest, { params }: Params) {
  const supabase = createServiceClient();

  // 기본 그룹 삭제 불가
  const { data: group } = await supabase
    .from('watchlist_groups')
    .select('is_default')
    .eq('id', params.id)
    .single();

  if (!group) return Response.json({ error: 'not found' }, { status: 404 });
  if (group.is_default) return Response.json({ error: '기본 그룹은 삭제할 수 없습니다.' }, { status: 400 });

  // 이 그룹에 속한 종목 목록
  const { data: groupStocks } = await supabase
    .from('watchlist_group_stocks')
    .select('symbol')
    .eq('group_id', params.id);

  const symbols = (groupStocks ?? []).map((s) => s.symbol);

  // ON DELETE CASCADE로 watchlist_group_stocks는 자동 삭제
  const { error: delError } = await supabase
    .from('watchlist_groups')
    .delete()
    .eq('id', params.id);

  if (delError) return Response.json({ error: delError.message }, { status: 500 });

  // 다른 그룹에도 없는 종목 → favorite_stocks 삭제 + stock_cache 갱신
  if (symbols.length > 0) {
    const { data: stillInGroup } = await supabase
      .from('watchlist_group_stocks')
      .select('symbol')
      .in('symbol', symbols);

    const stillSymbols = new Set((stillInGroup ?? []).map((s) => s.symbol));
    const orphaned = symbols.filter((s) => !stillSymbols.has(s));

    if (orphaned.length > 0) {
      await Promise.all([
        supabase.from('favorite_stocks').delete().in('symbol', orphaned),
        supabase.from('stock_cache').update({ is_favorite: false }).in('symbol', orphaned),
      ]);
    }
  }

  return Response.json({ success: true });
}
```

- [ ] **Step 2: 브라우저에서 확인**

```
DELETE http://localhost:3000/api/v1/watchlist-groups/<기본그룹id>
→ 400 { error: "기본 그룹은 삭제할 수 없습니다." }

DELETE http://localhost:3000/api/v1/watchlist-groups/<커스텀id>
→ 200 { success: true }
→ 해당 그룹 종목 중 다른 그룹에 없는 것은 favorite_stocks에서도 삭제되었는지 DB 확인
```

- [ ] **Step 3: 커밋**

```bash
git add web/src/app/api/v1/watchlist-groups/[id]/route.ts
git commit -m "feat: watchlist-groups PATCH/DELETE API"
```

---

### Task 4: 그룹 종목 API (`/api/v1/watchlist-groups/[id]/stocks`)

**Files:**
- Create: `web/src/app/api/v1/watchlist-groups/[id]/stocks/route.ts`
- Create: `web/src/app/api/v1/watchlist-groups/[id]/stocks/[symbol]/route.ts`

- [ ] **Step 1: 종목 조회/추가 파일 작성**

```typescript
// web/src/app/api/v1/watchlist-groups/[id]/stocks/route.ts
import { NextRequest } from 'next/server';
import { createServiceClient } from '@/lib/supabase';

type Params = { params: { id: string } };

// GET — 그룹 내 종목 목록 (stock_cache 조인)
export async function GET(_: NextRequest, { params }: Params) {
  const supabase = createServiceClient();

  const { data, error } = await supabase
    .from('watchlist_group_stocks')
    .select('symbol, added_at')
    .eq('group_id', params.id)
    .order('added_at', { ascending: true });

  if (error) return Response.json({ error: error.message }, { status: 500 });
  return Response.json({ stocks: data });
}

// POST — 그룹에 종목 추가 { symbol, name }
export async function POST(request: NextRequest, { params }: Params) {
  const body = await request.json();
  if (!body.symbol || !body.name) {
    return Response.json({ error: 'symbol and name are required' }, { status: 400 });
  }

  const supabase = createServiceClient();

  // favorite_stocks 마스터에 없으면 INSERT
  await supabase
    .from('favorite_stocks')
    .upsert({ symbol: body.symbol, name: body.name }, { onConflict: 'symbol' });

  // stock_cache.is_favorite 동기화
  await supabase
    .from('stock_cache')
    .update({ is_favorite: true })
    .eq('symbol', body.symbol);

  // 그룹에 추가
  const { error } = await supabase
    .from('watchlist_group_stocks')
    .insert({ group_id: params.id, symbol: body.symbol });

  if (error) {
    if (error.code === '23505') {
      return Response.json({ error: '이미 그룹에 있는 종목입니다.' }, { status: 409 });
    }
    return Response.json({ error: error.message }, { status: 500 });
  }

  return Response.json({ success: true }, { status: 201 });
}
```

- [ ] **Step 2: 종목 제거 파일 작성**

```typescript
// web/src/app/api/v1/watchlist-groups/[id]/stocks/[symbol]/route.ts
import { NextRequest } from 'next/server';
import { createServiceClient } from '@/lib/supabase';

type Params = { params: { id: string; symbol: string } };

// DELETE — 그룹에서 종목 제거
export async function DELETE(_: NextRequest, { params }: Params) {
  const supabase = createServiceClient();

  const { error } = await supabase
    .from('watchlist_group_stocks')
    .delete()
    .eq('group_id', params.id)
    .eq('symbol', params.symbol);

  if (error) return Response.json({ error: error.message }, { status: 500 });

  // 다른 그룹에도 없으면 favorite_stocks + stock_cache 정리
  const { data: remaining } = await supabase
    .from('watchlist_group_stocks')
    .select('symbol')
    .eq('symbol', params.symbol)
    .limit(1);

  if (!remaining?.length) {
    await Promise.all([
      supabase.from('favorite_stocks').delete().eq('symbol', params.symbol),
      supabase.from('stock_cache').update({ is_favorite: false }).eq('symbol', params.symbol),
    ]);
  }

  return Response.json({ success: true });
}
```

- [ ] **Step 3: 브라우저에서 확인**

```
POST http://localhost:3000/api/v1/watchlist-groups/<기본id>/stocks
body: { "symbol": "005930", "name": "삼성전자" }
→ 201 { success: true }
→ favorite_stocks에 삼성전자 행 존재, stock_cache.is_favorite = true 확인

DELETE http://localhost:3000/api/v1/watchlist-groups/<기본id>/stocks/005930
→ 200 { success: true }
→ watchlist_group_stocks에서 제거, 다른 그룹에 없으면 favorite_stocks도 제거 확인
```

- [ ] **Step 4: 커밋**

```bash
git add web/src/app/api/v1/watchlist-groups/[id]/stocks/route.ts \
        web/src/app/api/v1/watchlist-groups/[id]/stocks/[symbol]/route.ts
git commit -m "feat: watchlist-groups 종목 추가/제거 API"
```

---

## Chunk 2: UI 컴포넌트

### Task 5: WatchlistGroupTabs 컴포넌트

**Files:**
- Create: `web/src/components/stocks/watchlist-group-tabs.tsx`

- [ ] **Step 1: 컴포넌트 작성**

```typescript
// web/src/components/stocks/watchlist-group-tabs.tsx
"use client";

import { useState, useRef } from "react";
import { Plus, X } from "lucide-react";
import {
  DndContext,
  closestCenter,
  PointerSensor,
  useSensor,
  useSensors,
  DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  horizontalListSortingStrategy,
  useSortable,
  arrayMove,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import type { WatchlistGroup } from "@/types/stock";

export type TabId = "all" | string; // "all" = [전체], string = group.id

interface Props {
  groups: WatchlistGroup[];           // 기본 그룹 포함 전체 목록 (sort_order 순)
  activeTab: TabId;
  onTabChange: (tab: TabId) => void;
  onGroupAdd: (name: string) => Promise<void>;
  onGroupDelete: (group: WatchlistGroup) => void;
  onGroupsReorder: (ids: string[]) => void; // 커스텀 그룹 id 배열 (순서)
}

function SortableTab({
  group,
  isActive,
  onSelect,
  onDelete,
}: {
  group: WatchlistGroup;
  isActive: boolean;
  onSelect: () => void;
  onDelete: () => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id: group.id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      className="flex items-center gap-1"
    >
      <button
        {...attributes}
        {...listeners}
        onClick={onSelect}
        className={`flex items-center gap-1 px-3 py-1.5 rounded-lg text-sm whitespace-nowrap transition-colors ${
          isActive
            ? "bg-[#6366f1] text-white"
            : "text-[var(--muted)] hover:bg-[var(--card-hover)] hover:text-[var(--foreground)]"
        }`}
      >
        {group.name}
      </button>
      {/* 커스텀 그룹에만 × 버튼 */}
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

export default function WatchlistGroupTabs({
  groups,
  activeTab,
  onTabChange,
  onGroupAdd,
  onGroupDelete,
  onGroupsReorder,
}: Props) {
  const [adding, setAdding] = useState(false);
  const [newName, setNewName] = useState("");
  const [addError, setAddError] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));

  const defaultGroup = groups.find((g) => g.is_default);
  const customGroups = groups.filter((g) => !g.is_default);
  const canAdd = groups.length < 20;

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over || active.id === over.id) return;

    const oldIndex = customGroups.findIndex((g) => g.id === active.id);
    const newIndex = customGroups.findIndex((g) => g.id === over.id);
    if (oldIndex === -1 || newIndex === -1) return;

    const reordered = arrayMove(customGroups, oldIndex, newIndex);
    onGroupsReorder(reordered.map((g) => g.id));
  }

  async function handleAddConfirm() {
    const name = newName.trim();
    if (!name) {
      setAdding(false);
      setNewName("");
      return;
    }
    setAddError("");
    try {
      await onGroupAdd(name);
      setAdding(false);
      setNewName("");
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "그룹 생성 실패";
      setAddError(msg);
      inputRef.current?.focus();
    }
  }

  return (
    <div className="flex items-center gap-1 flex-wrap">
      {/* [전체] 탭 — 고정 */}
      <button
        onClick={() => onTabChange("all")}
        className={`px-3 py-1.5 rounded-lg text-sm whitespace-nowrap transition-colors ${
          activeTab === "all"
            ? "bg-[#6366f1] text-white"
            : "text-[var(--muted)] hover:bg-[var(--card-hover)] hover:text-[var(--foreground)]"
        }`}
      >
        전체
      </button>

      {/* [기본] 탭 — 고정 */}
      {defaultGroup && (
        <button
          onClick={() => onTabChange(defaultGroup.id)}
          className={`px-3 py-1.5 rounded-lg text-sm whitespace-nowrap transition-colors ${
            activeTab === defaultGroup.id
              ? "bg-[#6366f1] text-white"
              : "text-[var(--muted)] hover:bg-[var(--card-hover)] hover:text-[var(--foreground)]"
          }`}
        >
          {defaultGroup.name}
        </button>
      )}

      {/* 커스텀 탭 — 드래그 가능 */}
      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
        <SortableContext items={customGroups.map((g) => g.id)} strategy={horizontalListSortingStrategy}>
          {customGroups.map((group) => (
            <SortableTab
              key={group.id}
              group={group}
              isActive={activeTab === group.id}
              onSelect={() => onTabChange(group.id)}
              onDelete={() => onGroupDelete(group)}
            />
          ))}
        </SortableContext>
      </DndContext>

      {/* [+] 버튼 또는 인라인 입력 */}
      {canAdd && (
        adding ? (
          <div className="flex items-center gap-1">
            <input
              ref={inputRef}
              autoFocus
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") handleAddConfirm();
                if (e.key === "Escape") { setAdding(false); setNewName(""); setAddError(""); }
              }}
              onBlur={handleAddConfirm}
              placeholder="그룹명"
              className="w-24 px-2 py-1 text-sm bg-[var(--card)] border border-[var(--border)] rounded-lg outline-none focus:border-[#6366f1]"
            />
            {addError && <span className="text-xs text-red-400">{addError}</span>}
          </div>
        ) : (
          <button
            onClick={() => setAdding(true)}
            className="p-1.5 rounded-lg text-[var(--muted)] hover:bg-[var(--card-hover)] hover:text-[var(--foreground)] transition-colors"
            title="그룹 추가"
          >
            <Plus className="w-4 h-4" />
          </button>
        )
      )}
    </div>
  );
}
```

- [ ] **Step 2: 커밋**

```bash
git add web/src/components/stocks/watchlist-group-tabs.tsx
git commit -m "feat: WatchlistGroupTabs 컴포넌트 (드래그앤드랍, 추가/삭제)"
```

---

### Task 6: GroupSelectPopup 컴포넌트

**Files:**
- Create: `web/src/components/stocks/group-select-popup.tsx`

- [ ] **Step 1: 컴포넌트 작성**

```typescript
// web/src/components/stocks/group-select-popup.tsx
"use client";

import { useRef, useEffect } from "react";
import { Check } from "lucide-react";
import type { WatchlistGroup } from "@/types/stock";

interface Props {
  groups: WatchlistGroup[];
  selectedGroupIds: Set<string>;      // 현재 이 종목이 속한 그룹 ids
  onToggle: (group: WatchlistGroup) => void;
  onClose: () => void;
  position: { x: number; y: number };
}

export default function GroupSelectPopup({
  groups,
  selectedGroupIds,
  onToggle,
  onClose,
  position,
}: Props) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    }
    function handleEsc(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("mousedown", handleClickOutside);
    document.addEventListener("keydown", handleEsc);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
      document.removeEventListener("keydown", handleEsc);
    };
  }, [onClose]);

  return (
    <div
      ref={ref}
      style={{ position: "fixed", left: position.x, top: position.y, zIndex: 9999 }}
      className="bg-[var(--card)] border border-[var(--border)] rounded-xl shadow-2xl min-w-[160px] overflow-hidden"
    >
      <div className="px-3 py-2 border-b border-[var(--border)] text-xs text-[var(--muted)] font-medium">
        관심그룹 선택
      </div>
      <div className="py-1">
        {groups.map((group) => {
          const checked = selectedGroupIds.has(group.id);
          return (
            <button
              key={group.id}
              onClick={() => onToggle(group)}
              className="w-full flex items-center gap-2 px-3 py-2 text-sm hover:bg-[var(--card-hover)] transition-colors text-left"
            >
              <span className={`w-4 h-4 rounded border flex items-center justify-center ${
                checked ? "bg-[#6366f1] border-[#6366f1]" : "border-[var(--border)]"
              }`}>
                {checked && <Check className="w-3 h-3 text-white" />}
              </span>
              <span>{group.name}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: 커밋**

```bash
git add web/src/components/stocks/group-select-popup.tsx
git commit -m "feat: GroupSelectPopup 컴포넌트 (그룹 선택 팝업)"
```

---

## Chunk 3: 페이지 통합

### Task 7: 메뉴명 변경 & stocks/page.tsx 서버 로직

**Files:**
- Modify: `web/src/components/layout/sidebar.tsx:20`
- Modify: `web/src/app/stocks/page.tsx`

- [ ] **Step 1: sidebar.tsx 메뉴명 변경**

`web/src/components/layout/sidebar.tsx`:
```typescript
// 변경 전
{ href: "/stocks", label: "전 종목", icon: BarChart3 },

// 변경 후
{ href: "/stocks", label: "종목", icon: BarChart3 },
```

모바일 탭바 `mobile-tab-bar.tsx`는 이미 "종목"이므로 변경 불필요.

- [ ] **Step 2: stocks/page.tsx 수정**

`favorite_stocks` 그룹 쿼리를 `watchlist_groups` 쿼리로 교체:

```typescript
import { createServiceClient } from "@/lib/supabase";
import StockListClient from "@/components/stocks/stock-list-client";
import type { WatchlistGroup } from "@/types/stock";

export const revalidate = 60;

export default async function StocksPage() {
  const supabase = createServiceClient();

  const [
    { data: favorites },
    { data: stocks },
    { data: watchlistItems },
    { data: groupRows },
    { data: groupStockRows },
    { data: latestUpdate },
  ] = await Promise.all([
    supabase.from("stock_cache").select("*").eq("is_favorite", true).order("name"),
    supabase.from("stock_cache").select("*").order("name").limit(100),
    supabase.from("watchlist").select("symbol"),
    supabase.from("watchlist_groups").select("*").order("sort_order"),
    supabase.from("watchlist_group_stocks").select("group_id, symbol"),
    supabase.from("stock_cache").select("updated_at")
      .not("current_price", "is", null)
      .order("updated_at", { ascending: false }).limit(1).single(),
  ]);

  const watchlistSymbols = (watchlistItems ?? []).map((w) => w.symbol);
  const groups: WatchlistGroup[] = groupRows ?? [];

  // symbol → group_id[] 매핑 (다중 그룹 지원)
  const symbolGroups: Record<string, string[]> = {};
  for (const r of groupStockRows ?? []) {
    if (!symbolGroups[r.symbol]) symbolGroups[r.symbol] = [];
    symbolGroups[r.symbol].push(r.group_id);
  }

  const lastPriceUpdate = latestUpdate?.updated_at ?? null;
  const hasFavorites = (favorites?.length ?? 0) > 0;

  // 신호 병합 (기존 로직 유지)
  const allSymbols = new Set<string>();
  favorites?.forEach((f) => allSymbols.add(f.symbol));
  stocks?.forEach((s) => allSymbols.add(s.symbol));

  let signalMap: Record<string, Record<string, { type: string; price: number | null }>> = {};

  if (allSymbols.size > 0) {
    const { data: signalRows } = await supabase
      .from("signals")
      .select("symbol, source, signal_type, raw_data, timestamp")
      .in("symbol", Array.from(allSymbols))
      .in("source", ["lassi", "stockbot", "quant"])
      .order("timestamp", { ascending: false })
      .limit(allSymbols.size * 9);

    if (signalRows) {
      for (const row of signalRows) {
        const sym = row.symbol as string;
        const src = row.source as string;
        if (!sym) continue;
        if (!signalMap[sym]) signalMap[sym] = {};
        if (!signalMap[sym][src]) {
          const raw = row.raw_data as Record<string, unknown> | null;
          let price: number | null = null;
          if (raw) {
            const sp = raw.signal_price as number | undefined;
            if (sp && sp > 0) price = sp;
            else {
              const rp = raw.recommend_price as number | undefined;
              if (rp && rp > 0) price = rp;
              else {
                const bp = raw.buy_price as number | undefined;
                if (bp && bp > 0) price = bp;
                else {
                  const slp = raw.sell_price as number | undefined;
                  if (slp && slp > 0) price = slp;
                }
              }
            }
          }
          signalMap[sym][src] = { type: row.signal_type, price };
        }
      }
    }
  }

  const emptySignal = { type: null, price: null };
  const mergeSignals = (list: typeof stocks) =>
    (list ?? []).map((s) => ({
      ...s,
      signals: {
        lassi: signalMap[s.symbol]?.lassi ?? emptySignal,
        stockbot: signalMap[s.symbol]?.stockbot ?? emptySignal,
        quant: signalMap[s.symbol]?.quant ?? emptySignal,
      },
    }));

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">종목</h1>
        <p className="text-sm text-[var(--muted)] mt-1">
          관심종목 그룹 관리 및 전체 종목 조회
        </p>
      </div>
      <StockListClient
        initialStocks={mergeSignals(stocks)}
        favorites={mergeSignals(favorites)}
        watchlistSymbols={watchlistSymbols}
        lastPriceUpdate={lastPriceUpdate}
        groups={groups}
        symbolGroups={symbolGroups}
        hasFavorites={hasFavorites}
      />
    </div>
  );
}
```

- [ ] **Step 3: 개발 서버 실행, `/stocks` 접속 → "종목" 타이틀 표시 확인**

```bash
cd /Users/thlee/GoogleDrive/DashboardStock/web
npm run dev
# http://localhost:3000/stocks 접속
# 타이틀 "종목" 표시, 에러 없음 확인
```

- [ ] **Step 4: 커밋 (sidebar만, page.tsx는 Task 8 완료 후 커밋)**

```bash
# page.tsx는 StockListClient Props 변경(Task 8)과 함께 커밋해야 TypeScript 빌드가 통과됨
git add web/src/components/layout/sidebar.tsx
git commit -m "feat: 메뉴명 변경(종목)"
```

---

### Task 8: StockListClient 리팩토링

**Files:**
- Modify: `web/src/components/stocks/stock-list-client.tsx`

이 파일은 변경 범위가 크므로 단계별로 진행.

- [ ] **Step 1: Props 타입 변경**

파일 상단 Props 인터페이스 교체:

```typescript
import type { WatchlistGroup } from "@/types/stock";
import WatchlistGroupTabs, { type TabId } from "@/components/stocks/watchlist-group-tabs";
import GroupSelectPopup from "@/components/stocks/group-select-popup";

interface Props {
  initialStocks: StockCache[];
  favorites: StockCache[];
  watchlistSymbols?: string[];
  lastPriceUpdate?: string | null;
  groups: WatchlistGroup[];               // watchlist_groups 목록
  symbolGroups: Record<string, string[]>; // symbol → group_id[]
  hasFavorites: boolean;                  // 즐겨찾기 존재 여부 (진입 탭 결정용)
}
```

- [ ] **Step 2: 상태 변수 추가/교체**

`favGroups`, `favGroupFilter`, `favGroupList` 제거하고 추가:

```typescript
// 그룹 관련 상태
const [groups, setGroups] = useState<WatchlistGroup[]>(props.groups);
const [symGroups, setSymGroups] = useState<Record<string, string[]>>(props.symbolGroups);
// activeTab은 항상 "all"로 시작.
// hasFavorites=false일 때는 showAllStocksMode=true가 되어 전체DB뷰로 자동 fallback.
const [activeTab, setActiveTab] = useState<TabId>("all");

// GroupSelectPopup 상태
const [groupPopup, setGroupPopup] = useState<{
  stock: StockCache;
  position: { x: number; y: number };
} | null>(null);
```

- [ ] **Step 3: `mergedStocks` useMemo 내 `favGroups` 참조 교체 + 탭 필터 로직 추가**

`mergedStocks` useMemo 내에 `favGroups` prop을 참조하는 코드(예: `favGroups[s.symbol]`, `props.favGroups` 등)가 있으면, 제거된 `favGroups` prop 대신 **`symGroups` 상태**와 **`favSet`**으로 교체한다:

- `isFavorite` 판단: `favSet.has(s.symbol)`
- 그룹 소속 여부: `symGroups[s.symbol]`

그 다음 `displayStocks` 정의 바로 아래에 탭 필터 상수들을 추가한다:

```typescript
// 현재 탭에 표시할 관심종목 (query 없을 때)
const tabFavorites = useMemo(() => {
  if (activeTab === "all") {
    // [전체] = 모든 관심종목 dedup
    const seen = new Set<string>();
    return favStocks.filter((s) => {
      if (seen.has(s.symbol)) return false;
      seen.add(s.symbol);
      return true;
    });
  }
  // 특정 그룹 = 해당 그룹에 속한 관심종목만
  return favStocks.filter((s) => (symGroups[s.symbol] ?? []).includes(activeTab));
}, [activeTab, favStocks, symGroups]);

// query가 있으면 전체 DB 검색 모드 (기존 무한스크롤), 없으면 탭 관심종목 모드
const showSearchMode = query.trim().length > 0;

// 관심종목 없고 query 없으면 전체DB 뷰 (기존 전종목 동작)
// NOTE: props.hasFavorites는 SSR 시점 스냅샷이므로 비반응적(non-reactive).
// 사용자가 같은 세션에서 첫 즐겨찾기를 추가해도 업데이트되지 않음.
// 대신 live favSet.size를 사용해 즉시 반응하도록 한다.
const showAllStocksMode = favSet.size === 0 && !showSearchMode;
```

- [ ] **Step 4: ★ 버튼 클릭 핸들러 교체**

기존 `toggleFavorite` 함수를 **`handleStarClick`으로 교체**한다.
StockRow의 `onToggleFavorite` 시그니처는 `(stock: StockCache) => void`이므로 이벤트 객체 없이 호출된다.
이벤트 없이 호출될 때는 화면 중앙에 팝업 표시 (fallback position).
JSX 모든 호출부는 **`onToggleFavorite={(s) => handleStarClick(s)}`** 형태로 사용 (Step 7 참고).
```typescript
const handleStarClick = useCallback(
  (stock: StockCache, e?: React.MouseEvent) => {
    const position = e?.currentTarget
      ? (() => {
          const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
          return { x: rect.left, y: rect.bottom + 4 };
        })()
      : { x: Math.round(window.innerWidth / 2) - 80, y: Math.round(window.innerHeight / 2) };

    if (favSet.has(stock.symbol)) {
      // 즐겨찾기 해제 — 모든 그룹에서 제거 (각 그룹 API 호출)
      const groupIds = symGroups[stock.symbol] ?? [];
      groupIds.forEach((gid) => {
        fetch(`/api/v1/watchlist-groups/${gid}/stocks/${stock.symbol}`, { method: "DELETE" });
      });
      const newSet = new Set(favSet);
      newSet.delete(stock.symbol);
      setFavSet(newSet);
      setFavStocks((prev) => prev.filter((s) => s.symbol !== stock.symbol));
      setSymGroups((prev) => { const next = { ...prev }; delete next[stock.symbol]; return next; });
      return;
    }

    // 그룹이 기본 1개만 → 기본 그룹 자동 추가
    const customGroups = groups.filter((g) => !g.is_default);
    if (customGroups.length === 0) {
      const defaultGroup = groups.find((g) => g.is_default);
      if (defaultGroup) {
        fetch(`/api/v1/watchlist-groups/${defaultGroup.id}/stocks`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ symbol: stock.symbol, name: stock.name }),
        });
        const newSet = new Set(favSet);
        newSet.add(stock.symbol);
        setFavSet(newSet);
        setFavStocks((prev) => [...prev, stock]);
        setSymGroups((prev) => ({
          ...prev,
          [stock.symbol]: [defaultGroup.id],
        }));
      }
      return;
    }

    // 다중 그룹 → 팝업 표시
    setGroupPopup({ stock, position });
  },
  [favSet, symGroups, groups]
);
```

- [ ] **Step 5: GroupSelectPopup 토글 핸들러**

```typescript
// stockOverride: StockActionMenu에서 호출 시 actionMenu.stock 전달
// groupPopup에서 호출 시 stockOverride 생략 → groupPopup.stock 사용
const handleGroupToggle = useCallback(
  async (group: WatchlistGroup, stockOverride?: StockCache) => {
    const stock = stockOverride ?? groupPopup?.stock;
    if (!stock) return;
    const currentGroups = symGroups[stock.symbol] ?? [];
    const inGroup = currentGroups.includes(group.id);

    if (inGroup) {
      // 그룹에서 제거
      await fetch(`/api/v1/watchlist-groups/${group.id}/stocks/${stock.symbol}`, { method: "DELETE" });
      const newGroups = currentGroups.filter((id) => id !== group.id);
      setSymGroups((prev) => ({ ...prev, [stock.symbol]: newGroups }));
      if (newGroups.length === 0) {
        // 모든 그룹에서 제거됨
        const newSet = new Set(favSet);
        newSet.delete(stock.symbol);
        setFavSet(newSet);
        setFavStocks((prev) => prev.filter((s) => s.symbol !== stock.symbol));
      }
    } else {
      // 그룹에 추가
      await fetch(`/api/v1/watchlist-groups/${group.id}/stocks`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ symbol: stock.symbol, name: stock.name }),
      });
      setSymGroups((prev) => ({ ...prev, [stock.symbol]: [...currentGroups, group.id] }));
      if (!favSet.has(stock.symbol)) {
        const newSet = new Set(favSet);
        newSet.add(stock.symbol);
        setFavSet(newSet);
        setFavStocks((prev) => [...prev, stock]);
      }
    }
  },
  [groupPopup, symGroups, favSet]
);
```

- [ ] **Step 6: 그룹 탭 이벤트 핸들러**

```typescript
const handleGroupAdd = useCallback(async (name: string) => {
  const res = await fetch("/api/v1/watchlist-groups", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name }),
  });
  if (!res.ok) {
    const json = await res.json();
    throw new Error(json.error ?? "그룹 생성 실패");
  }
  const { group } = await res.json();
  setGroups((prev) => [...prev, group]);
}, []);

const handleGroupDelete = useCallback(async (group: WatchlistGroup) => {
  if (!confirm(`"${group.name}" 그룹을 삭제할까요?\n그룹 내 종목이 다른 그룹에 없으면 즐겨찾기에서도 해제됩니다.`)) return;
  const res = await fetch(`/api/v1/watchlist-groups/${group.id}`, { method: "DELETE" });
  if (!res.ok) return;
  setGroups((prev) => prev.filter((g) => g.id !== group.id));
  // 해당 그룹 소속 종목 symGroups 업데이트
  // NOTE: React Strict Mode에서 setState updater가 두 번 실행될 수 있으므로
  // removedSymbols 계산을 updater 외부에서 현재 symGroups 스냅샷으로 수행한다.
  const removedSymbols: string[] = [];
  const nextSymGroups = { ...symGroups };
  for (const sym of Object.keys(nextSymGroups)) {
    nextSymGroups[sym] = nextSymGroups[sym].filter((id) => id !== group.id);
    if (nextSymGroups[sym].length === 0) {
      delete nextSymGroups[sym];
      removedSymbols.push(sym);
    }
  }
  setSymGroups(nextSymGroups);
  if (removedSymbols.length > 0) {
    setFavSet((fSet) => { const n = new Set(fSet); removedSymbols.forEach((s) => n.delete(s)); return n; });
    setFavStocks((fs) => fs.filter((s) => !removedSymbols.includes(s.symbol)));
  }
  if (activeTab === group.id) setActiveTab("all");
}, [activeTab, symGroups]); // symGroups를 클로저로 직접 읽으므로 deps에 반드시 포함

// reorder debounce ref — 컴포넌트 바깥이 아닌 useRef로 관리
const reorderDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

const handleGroupsReorder = useCallback((ids: string[]) => {
  // 클라이언트 순서 즉시 반영 (낙관적 업데이트)
  setGroups((prev) => {
    const defaultGrp = prev.find((g) => g.is_default);
    const custom = ids.map((id) => prev.find((g) => g.id === id)!).filter(Boolean);
    return defaultGrp ? [defaultGrp, ...custom] : custom;
  });
  // 500ms debounce 후 서버 반영 (spec §9 요건)
  if (reorderDebounceRef.current) clearTimeout(reorderDebounceRef.current);
  reorderDebounceRef.current = setTimeout(() => {
    fetch("/api/v1/watchlist-groups/reorder", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ids }),
    });
  }, 500);
}, []);
```

- [ ] **Step 7: JSX — WatchlistGroupTabs + GroupSelectPopup 추가**

기존 `favGroupList` 탭 UI 부분을 `WatchlistGroupTabs`로 교체하고, return 최하단에 `GroupSelectPopup` 추가:

```tsx
{/* 그룹 탭 바 */}
<WatchlistGroupTabs
  groups={groups}
  activeTab={activeTab}
  onTabChange={setActiveTab}
  onGroupAdd={handleGroupAdd}
  onGroupDelete={handleGroupDelete}
  onGroupsReorder={handleGroupsReorder}
/>

{/* ... 기존 검색/필터 UI ... */}

{/* 종목 리스트:
   - showSearchMode || showAllStocksMode: 기존 무한스크롤 테이블 (displayStocks 기반) 그대로 유지
   - 탭 관심종목 모드: tabFavorites를 StockRow로 렌더링, 무한스크롤 없음 */}
{showSearchMode || showAllStocksMode ? (
  /* ---- 기존 무한스크롤 뷰 그대로 (코드 이동 없이 조건부 감싸기만) ---- */
  <div className="card overflow-hidden">
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-[var(--border)] text-[var(--muted)] text-xs">
            <th className="px-3 py-3 text-left w-10"></th>
            <th className="px-3 py-3 text-left">종목명</th>
            <th className="px-3 py-3 text-left">코드</th>
            <th className="px-3 py-3 text-right">현재가</th>
            <th className="px-3 py-3 text-right">등락률</th>
            <th className="px-3 py-3 text-right">거래량</th>
            <th className="px-3 py-3 text-right">PER</th>
            <th className="px-2 py-3 text-center">퀀트</th>
            <th className="px-2 py-3 text-center">라씨</th>
            <th className="px-2 py-3 text-center">스톡봇</th>
            <th className="px-3 py-3 text-right">Gap</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-[var(--border)]">
          {/* 기존 displayStocks.favs + displayStocks.nonFavs StockRow 렌더링 그대로 */}
          {displayStocks.favs.map((stock) => (
            <StockRow key={stock.symbol} stock={stock} isFav={true}
              gapSource={gapSource} isInPortfolio={portSet.has(stock.symbol)}
              onToggleFavorite={(s) => handleStarClick(s)} onRowClick={handleRowClick} />
          ))}
          {displayStocks.favs.length > 0 && (
            <tr><td colSpan={11}><div className="border-b-2 border-yellow-600/30" /></td></tr>
          )}
          {displayStocks.nonFavs.map((stock) => (
            <StockRow key={stock.symbol} stock={stock} isFav={false}
              gapSource={gapSource} isInPortfolio={portSet.has(stock.symbol)}
              onToggleFavorite={(s) => handleStarClick(s)} onRowClick={handleRowClick} />
          ))}
        </tbody>
      </table>
    </div>
    <div ref={sentinelRef} className="h-4" />
    {loading && <div className="flex justify-center py-4"><Loader2 className="w-5 h-5 animate-spin text-[var(--muted)]" /></div>}
    {!hasMore && stocks.length > 0 && <div className="text-center py-3 text-xs text-[var(--muted)]">총 {stocks.length}개 종목</div>}
  </div>
) : (
  /* ---- 탭 관심종목 뷰: tabFavorites를 StockRow로 렌더링, 무한스크롤 없음 ---- */
  tabFavorites.length === 0 ? (
    <div className="text-center py-16 text-[var(--muted)] text-sm">
      이 그룹에 관심종목이 없습니다. ★를 클릭해 추가하세요.
    </div>
  ) : (
    <div className="card overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-[var(--border)] text-[var(--muted)] text-xs">
              <th className="px-3 py-3 text-left w-10"></th>
              <th className="px-3 py-3 text-left">종목명</th>
              <th className="px-3 py-3 text-left">코드</th>
              <th className="px-3 py-3 text-right">현재가</th>
              <th className="px-3 py-3 text-right">등락률</th>
              <th className="px-3 py-3 text-right">거래량</th>
              <th className="px-3 py-3 text-right">PER</th>
              <th className="px-2 py-3 text-center">퀀트</th>
              <th className="px-2 py-3 text-center">라씨</th>
              <th className="px-2 py-3 text-center">스톡봇</th>
              <th className="px-3 py-3 text-right">Gap</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[var(--border)]">
            {tabFavorites.map((stock) => (
              <StockRow
                key={stock.symbol}
                stock={stock}
                isFav={true}
                gapSource={gapSource}
                isInPortfolio={portSet.has(stock.symbol)}
                onToggleFavorite={(s) => handleStarClick(s)}
                onRowClick={handleRowClick}
              />
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
)}

{/* GroupSelectPopup */}
{groupPopup && (
  <GroupSelectPopup
    groups={groups}
    selectedGroupIds={new Set(symGroups[groupPopup.stock.symbol] ?? [])}
    onToggle={handleGroupToggle}
    onClose={() => setGroupPopup(null)}
    position={groupPopup.position}
  />
)}
```

- [ ] **Step 8: 개발 서버에서 동작 확인**

```
1. /stocks 접속
   - 즐겨찾기 있으면 [전체] 탭에 관심종목 표시
   - 즐겨찾기 없으면 전체 DB 종목 표시

2. [기본] 탭 클릭 → 기본 그룹 종목만 표시

3. [+] 클릭 → 그룹명 입력 → Enter → 새 탭 생성

4. 커스텀 탭 드래그 → 순서 변경

5. 커스텀 탭 × → confirm 다이얼로그 → 탭 제거

6. 검색어 입력 → 전체 DB 검색 결과 표시

7. 다중 그룹 있을 때 ★ 클릭 → 그룹 선택 팝업 표시
```

- [ ] **Step 9: 커밋**

```bash
# page.tsx도 함께 커밋: Props 타입 변경과 데이터 로드를 같은 커밋에 포함해야 빌드가 통과됨
git add web/src/components/stocks/stock-list-client.tsx web/src/app/stocks/page.tsx
git commit -m "feat: StockListClient 그룹 탭/★/검색 동작 통합 + page.tsx 그룹 데이터 로드"
```

---

### Task 9: StockActionMenu — 관심그룹 서브메뉴

**Files:**
- Modify: `web/src/components/common/stock-action-menu.tsx`

- [ ] **Step 1: Props 확장**

```typescript
interface StockActionMenuProps {
  // ... 기존 props ...
  groups?: WatchlistGroup[];              // 그룹 목록
  symbolGroupIds?: string[];              // 이 종목이 속한 group_id 목록
  onGroupToggle?: (group: WatchlistGroup) => void;
}
```

- [ ] **Step 2: "관심그룹에 추가" 서브메뉴 추가**

기존 즐겨찾기 버튼 아래에 추가:

```tsx
{/* 관심그룹 서브메뉴 */}
{groups && groups.length > 0 && (
  <div>
    <div className="px-4 py-1.5 text-xs text-[var(--muted)] border-t border-[var(--border)] mt-1">
      관심그룹
    </div>
    {groups.map((group) => {
      const inGroup = (symbolGroupIds ?? []).includes(group.id);
      return (
        <button
          key={group.id}
          onClick={() => { onGroupToggle?.(group); }}
          className="w-full flex items-center gap-3 px-4 py-2 text-sm hover:bg-[var(--card-hover)] transition-colors text-left"
        >
          <span className={`w-3.5 h-3.5 rounded border flex items-center justify-center ${
            inGroup ? "bg-[#6366f1] border-[#6366f1]" : "border-[var(--border)]"
          }`}>
            {inGroup && <Check className="w-2.5 h-2.5 text-white" />}
          </span>
          <span className="text-[var(--foreground)]">{group.name}</span>
        </button>
      );
    })}
  </div>
)}
```

`Check` import 추가: `import { Star, Briefcase, ExternalLink, X, Check } from "lucide-react";`

- [ ] **Step 3: StockListClient에서 StockActionMenu에 props 전달 + star 버튼 연동**

`StockActionMenu`의 기존 내부 `handleToggleFavorite`은 `/api/v1/favorites` 구형 API를 직접 호출하므로, **`onToggleFavorite` prop을 통해 부모의 `handleStarClick`으로 위임**해야 `symGroups`/`favSet` 상태가 동기화된다.

`actionMenu` 상태가 열릴 때 해당 종목의 symGroups 전달:

```tsx
<StockActionMenu
  // ... 기존 props ...
  // StockActionMenu.onToggleFavorite 타입은 `() => void` (인자 없음).
  // actionMenu.stock을 클로저로 캡처하여 handleStarClick에 전달.
  // 이렇게 해야 내부 구형 /api/v1/favorites API를 우회하고 symGroups/favSet 상태를 동기화한다.
  onToggleFavorite={() => actionMenu && handleStarClick(actionMenu.stock)}
  groups={groups}
  symbolGroupIds={actionMenu ? (symGroups[actionMenu.stock.symbol] ?? []) : []}
  onGroupToggle={(group) => {
    if (!actionMenu) return;
    handleGroupToggle(group, actionMenu.stock); // 동일 로직 재사용
  }}
/>
```

- [ ] **Step 4: 확인 및 커밋**

```
StockActionMenu 오른쪽 클릭 → "관심그룹" 섹션에 그룹 목록 표시
각 그룹 클릭 시 체크 토글 → symGroups 업데이트
```

```bash
git add web/src/components/common/stock-action-menu.tsx
git commit -m "feat: StockActionMenu에 관심그룹 서브메뉴 추가"
```

---

### Task 10: FavoritesManager 재연동

**Files:**
- Modify: `web/src/app/settings/favorites-manager.tsx`

- [ ] **Step 1: Props 인터페이스 및 상태 교체**

기존 `Favorite.group_name` 기반 상태를 제거하고 새 구조로 교체:

```typescript
// favorites-manager.tsx 전체 재작성 시작
"use client";
import { useState, useMemo } from "react";
import Link from "next/link";
import { Check, Tag } from "lucide-react";
import type { WatchlistGroup } from "@/types/stock";

interface Favorite { symbol: string; name: string; added_at?: string; }

interface Props {
  favorites: Favorite[];
  groups: WatchlistGroup[];
  symbolGroupIds: Record<string, string[]>; // symbol → group_id[]
}

export default function FavoritesManager({ favorites: initial, groups: initialGroups, symbolGroupIds: initialSymGrps }: Props) {
  const [favorites] = useState<Favorite[]>(initial);
  const [groups] = useState<WatchlistGroup[]>(initialGroups);
  const [symbolGroupIds, setSymbolGroupIds] = useState<Record<string, string[]>>(initialSymGrps);
  const [selectedSymbols, setSelectedSymbols] = useState<Set<string>>(new Set());
  const [activeGroupId, setActiveGroupId] = useState<string | null>(null); // null = 전체
  const [assigning, setAssigning] = useState(false);

  const filtered = useMemo(() => {
    if (!activeGroupId) return favorites;
    return favorites.filter((f) => (symbolGroupIds[f.symbol] ?? []).includes(activeGroupId));
  }, [favorites, activeGroupId, symbolGroupIds]);

  const toggleSelect = (symbol: string) => {
    setSelectedSymbols((prev) => {
      const next = new Set(prev);
      if (next.has(symbol)) next.delete(symbol);
      else next.add(symbol);
      return next;
    });
  };
```

- [ ] **Step 2: assignGroup — 그룹 이동 로직 작성**

**설계 의도**: FavoritesManager의 "그룹 이동"은 선택 종목을 기존 모든 그룹에서 제거한 뒤 대상 그룹에 추가하는 **단일 그룹 배타적 이동**이다. (종목 페이지의 멀티 그룹 체크박스와 다른 UX)

```typescript
  // 그룹 이동 (배타적): 대상 그룹에 먼저 추가 → 그 다음 다른 그룹에서 제거
  // NOTE: DELETE-then-POST 순서이면 양쪽 사이 favorite_stocks가 orphan 상태가 되어
  // DB 트리거가 is_favorite=false로 설정해버릴 수 있다. POST-first로 데이터 손실 방지.
  const assignGroup = async (targetGroupId: string) => {
    if (selectedSymbols.size === 0) return;
    setAssigning(true);
    try {
      for (const sym of selectedSymbols) {
        const fav = favorites.find((f) => f.symbol === sym);
        if (!fav) continue;
        // 1. 대상 그룹에 먼저 추가 (이미 있으면 409 무시)
        await fetch(`/api/v1/watchlist-groups/${targetGroupId}/stocks`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ symbol: sym, name: fav.name }),
        });
        // 2. 대상 그룹이 아닌 기존 그룹들에서 제거
        const currentGroupIds = symbolGroupIds[sym] ?? [];
        const otherGroupIds = currentGroupIds.filter((gid) => gid !== targetGroupId);
        await Promise.all(
          otherGroupIds.map((gid) =>
            fetch(`/api/v1/watchlist-groups/${gid}/stocks/${sym}`, { method: "DELETE" })
          )
        );
      }
      setSymbolGroupIds((prev) => {
        const next = { ...prev };
        for (const sym of selectedSymbols) next[sym] = [targetGroupId];
        return next;
      });
      setSelectedSymbols(new Set());
    } finally {
      setAssigning(false);
    }
  };
```

- [ ] **Step 3: JSX 작성 — 그룹 탭 + 종목 리스트 + 그룹 이동 버튼**

```tsx
  return (
    <div className="space-y-4">
      {/* 그룹 탭 필터 */}
      <div className="flex gap-1 flex-wrap">
        <button
          onClick={() => setActiveGroupId(null)}
          className={`px-3 py-1.5 rounded-lg text-sm ${!activeGroupId ? "bg-[#6366f1] text-white" : "text-[var(--muted)] hover:bg-[var(--card-hover)]"}`}
        >
          전체
        </button>
        {groups.map((g) => (
          <button key={g.id} onClick={() => setActiveGroupId(g.id)}
            className={`px-3 py-1.5 rounded-lg text-sm ${activeGroupId === g.id ? "bg-[#6366f1] text-white" : "text-[var(--muted)] hover:bg-[var(--card-hover)]"}`}
          >
            {g.name}
          </button>
        ))}
      </div>

      {/* 선택 종목 그룹 이동 */}
      {selectedSymbols.size > 0 && (
        <div className="flex items-center gap-2 p-3 bg-[var(--card)] border border-[var(--border)] rounded-lg">
          <Tag className="w-4 h-4 text-[var(--muted)]" />
          <span className="text-sm text-[var(--muted)]">{selectedSymbols.size}개 선택 → 이동:</span>
          {groups.map((g) => (
            <button key={g.id} onClick={() => assignGroup(g.id)} disabled={assigning}
              className="px-2 py-1 text-xs rounded bg-[var(--border)] hover:bg-[var(--accent)] hover:text-white transition-colors disabled:opacity-50"
            >
              {g.name}
            </button>
          ))}
        </div>
      )}

      {/* 종목 리스트 */}
      <div className="space-y-1">
        {filtered.map((fav) => {
          const groupNames = (symbolGroupIds[fav.symbol] ?? [])
            .map((gid) => groups.find((g) => g.id === gid)?.name)
            .filter(Boolean).join(", ");
          return (
            <div key={fav.symbol}
              className="flex items-center gap-3 p-3 bg-[var(--card)] border border-[var(--border)] rounded-lg"
            >
              <input type="checkbox" checked={selectedSymbols.has(fav.symbol)}
                onChange={() => toggleSelect(fav.symbol)}
                className="w-4 h-4 accent-[#6366f1]"
              />
              <Link href={`/stock/${fav.symbol}`} className="flex-1 hover:text-[var(--accent)]">
                <span className="font-medium">{fav.name}</span>
                <span className="ml-2 text-xs text-[var(--muted)]">{fav.symbol}</span>
              </Link>
              {groupNames && (
                <span className="text-xs px-2 py-0.5 rounded bg-[var(--border)] text-[var(--muted)]">{groupNames}</span>
              )}
            </div>
          );
        })}
        {filtered.length === 0 && (
          <div className="text-center py-8 text-[var(--muted)] text-sm">관심종목이 없습니다.</div>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 4: settings/page.tsx에서 새 데이터 로드 및 컴포넌트 연결**

```typescript
// settings/page.tsx 서버 컴포넌트에서 (기존 favs 쿼리에 추가)
const [{ data: favs }, { data: groupRows }, { data: gsRows }] = await Promise.all([
  supabase.from("favorite_stocks").select("*").order("added_at", { ascending: false }),
  supabase.from("watchlist_groups").select("*").order("sort_order"),
  supabase.from("watchlist_group_stocks").select("group_id, symbol"),
]);

const symbolGroupIds: Record<string, string[]> = {};
for (const r of gsRows ?? []) {
  if (!symbolGroupIds[r.symbol]) symbolGroupIds[r.symbol] = [];
  symbolGroupIds[r.symbol].push(r.group_id);
}

// JSX에서 FavoritesManager에 새 props 전달
<FavoritesManager
  favorites={favs ?? []}
  groups={groupRows ?? []}
  symbolGroupIds={symbolGroupIds}
/>
```

- [ ] **Step 5: 확인 및 커밋**

```
설정 페이지 → 그룹 탭 표시, 종목 선택 후 그룹 이동 동작 확인
```

```bash
git add web/src/app/settings/favorites-manager.tsx web/src/app/settings/page.tsx
git commit -m "feat: FavoritesManager 새 그룹 API로 재연동"
```

---

### Task 11: 최종 확인

- [ ] **전체 동작 체크리스트**

```
[ ] /stocks 진입 → 즐겨찾기 있으면 [전체] 탭, 없으면 전체 DB 종목
[ ] 사이드바 "종목" 표시 (전 종목 → 종목)
[ ] [전체] → 모든 관심종목 합집합 (중복 없음)
[ ] [기본] → 기본 그룹 종목만
[ ] [+] → 그룹 추가 인라인 입력
[ ] 중복 그룹명 → 에러 표시
[ ] 21번째 그룹 생성 시도 → [+] 비활성화
[ ] 커스텀 탭 × → confirm → 탭 제거, 종목 정리
[ ] 커스텀 탭 드래그 → 순서 변경, 서버 반영
[ ] 검색어 입력 → 전체 DB 검색
[ ] 그룹 1개(기본)만 있을 때 ★ → 기본 그룹 자동 추가
[ ] 그룹 2개 이상 있을 때 ★ → 그룹 선택 팝업
[ ] StockActionMenu 관심그룹 서브메뉴 표시/토글
[ ] 설정 페이지 그룹 이동 동작
```

- [ ] **빌드 확인**

```bash
cd /Users/thlee/GoogleDrive/DashboardStock/web
npm run build
# TypeScript 에러 없음, 빌드 성공 확인
```

- [ ] **최종 커밋**

```bash
git add -A
git commit -m "feat: 종목 페이지 관심종목 다중 그룹 관리 완성"
```
