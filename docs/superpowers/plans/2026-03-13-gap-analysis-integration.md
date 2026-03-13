# GAP 추천 + 종목분석 통합 Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `/gap` 독립 페이지를 삭제하고, GAP 추천 기능(신호가격 대비 현재가 Gap 분석)을 `/signals?tab=analysis` 종목분석 탭에 통합한다.

**Architecture:** `signals/page.tsx` 서버 컴포넌트에서 30일 BUY 신호 + 매수가 데이터(signalMap)를 페칭하여 클라이언트에 전달한다. `StockRankingSection`을 `UnifiedAnalysisSection`으로 교체하며, 기존 AI 점수/배지에 Gap%, 매수가, AI소스 컬럼을 추가한다. 소스 필터와 Gap 오름차순/내림차순 토글을 포함한다.

**Tech Stack:** Next.js 14 App Router, React, TypeScript, Tailwind CSS, Supabase

---

## 파일 구조

| 작업 | 파일 |
|------|------|
| 수정 | `web/src/app/signals/page.tsx` |
| 생성 | `web/src/components/signals/UnifiedAnalysisSection.tsx` |
| 수정 | `web/src/components/layout/mobile-tab-bar.tsx` |
| 수정 | `web/src/components/layout/sidebar.tsx` |
| 삭제 | `web/src/app/gap/page.tsx` |
| 삭제 | `web/src/app/gap/gap-client.tsx` |
| 삭제 | `web/src/app/gap/loading.tsx` |

---

## Chunk 1: signals/page.tsx — signalMap 페칭 추가

### Task 1: signals/page.tsx에 signalMap 페칭 추가

**Files:**
- Modify: `web/src/app/signals/page.tsx`

현재 `activeTab === "analysis"` 블록은 비어 있다. 여기에 `/gap/page.tsx`와 동일한 signalMap 페칭 로직을 추가한다.

**`SignalMap` 타입 정의 (page.tsx 상단에 추가):**
```typescript
type SignalMap = Record<string, Record<string, { buyPrice: number; date: string }>>;
```

**추가할 페칭 로직 (`activeTab === "signals"` 블록 아래에 추가):**
```typescript
// ── 종목분석 탭 ──────────────────────────────────────────
let signalMap: SignalMap = {};

if (activeTab === "analysis") {
  const thirtyDaysAgo = new Date();
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
  const since30d = thirtyDaysAgo.toISOString();

  const { data: buySignals } = await supabase
    .from("signals")
    .select("symbol, source, signal_type, raw_data, timestamp")
    .in("signal_type", ["BUY", "BUY_FORECAST"])
    .in("source", ["lassi", "stockbot", "quant"])
    .gte("timestamp", since30d)
    .order("timestamp", { ascending: false });

  for (const sig of buySignals ?? []) {
    if (!sig.symbol) continue;
    const rd = sig.raw_data as Record<string, number> | null;
    const buyPrice =
      rd?.signal_price || rd?.recommend_price || rd?.buy_range_low || 0;
    if (buyPrice <= 0) continue;
    if (!signalMap[sig.symbol]) signalMap[sig.symbol] = {};
    if (!signalMap[sig.symbol][sig.source]) {
      signalMap[sig.symbol][sig.source] = {
        buyPrice,
        date: sig.timestamp,
      };
    }
  }
}
```

**`activeTab === "analysis"` 렌더 블록 수정:**

기존:
```tsx
{activeTab === "analysis" && (
  <StockRankingSection
    favoriteSymbols={favoriteSymbols}
    watchlistSymbols={watchlistSymbols}
  />
)}
```

변경:
```tsx
{activeTab === "analysis" && (
  <UnifiedAnalysisSection
    signalMap={signalMap}
    favoriteSymbols={favoriteSymbols}
    watchlistSymbols={watchlistSymbols}
  />
)}
```

**import 수정:**
- `StockRankingSection` import 제거
- `UnifiedAnalysisSection` import 추가:
  ```typescript
  import { UnifiedAnalysisSection } from "@/components/signals/UnifiedAnalysisSection";
  ```
- `SignalMap` 타입은 page.tsx 상단에 로컬 정의하거나 UnifiedAnalysisSection에서 export해서 import

- [ ] **Step 1: `signals/page.tsx` 수정**

  위 로직대로 수정한다. `SignalMap` 타입은 `UnifiedAnalysisSection.tsx`에서 export하여 import할 것이므로, 일단 로컬 타입으로 정의해 두고 Task 2 완료 후 교체한다.

- [ ] **Step 2: 빌드 확인 (타입 에러 없음)**

  ```bash
  cd web && npx tsc --noEmit 2>&1 | head -30
  ```
  `UnifiedAnalysisSection`가 아직 없으므로 import 에러가 나는 것은 정상 — Task 2 완료 후 재확인.

---

## Chunk 2: UnifiedAnalysisSection 컴포넌트 생성

### Task 2: UnifiedAnalysisSection.tsx 생성

**Files:**
- Create: `web/src/components/signals/UnifiedAnalysisSection.tsx`

기존 `StockRankingSection.tsx`를 기반으로 다음을 추가/변경한다:
1. `signalMap` prop 추가
2. 소스 필터 추가 (전체/퀀트/라씨/스톡봇)
3. Gap 정렬 토글 추가 (Gap ↑ / Gap ↓)
4. RankCard에 Gap% + 매수가 + AI소스 표시 추가
5. 정렬 로직에 gap sort 추가

- [ ] **Step 1: 파일 생성 — 타입 + 유틸 + 배지 함수**

  StockRankingSection.tsx에서 다음을 그대로 복사:
  - `RankingResponse`, `MenuState`, `Weights`, `SortMode` 타입
  - `BADGE_CLS`, `getAiBadges`, `getBasicBadges`, `normScores`, `computeWeighted`, `fmtNum`, `fmtPrice` 유틸
  - `WeightPopup` 컴포넌트

  > **주의:** 기존 `gap/page.tsx`는 `{ price, date }` 키를 사용한다. 본 플랜의 `SignalMap`은 `{ buyPrice, date }`를 사용한다. 페칭 코드 및 `getGapInfo()` 모두 `buyPrice`로 통일해야 한다.

  추가 타입:
  ```typescript
  export type SignalMap = Record<string, Record<string, { buyPrice: number; date: string }>>;

  type SourceFilter = 'all' | 'quant' | 'lassi' | 'stockbot';

  interface GapInfo {
    source: string;
    buyPrice: number;
    gap: number;
    date: string;
  }

  interface UnifiedAnalysisProps {
    signalMap: SignalMap;
    favoriteSymbols: string[];
    watchlistSymbols: string[];
  }
  ```

  추가 상수:
  ```typescript
  const SOURCE_LABELS: Record<string, string> = {
    quant: '퀀트',
    lassi: '라씨',
    stockbot: '스톡봇',
  };

  const SOURCE_DOTS: Record<string, string> = {
    quant: 'bg-blue-400',
    lassi: 'bg-red-400',
    stockbot: 'bg-green-400',
  };
  ```

  Gap 계산 유틸:
  ```typescript
  function getGapInfo(
    item: StockRankItem,
    signalMap: SignalMap,
    sourceFilter: SourceFilter,
  ): GapInfo | null {
    const sigs = signalMap[item.symbol];
    if (!sigs || !item.current_price) return null;

    if (sourceFilter === 'all') {
      let best: GapInfo | null = null;
      for (const [source, sig] of Object.entries(sigs)) {
        const gap = ((item.current_price - sig.buyPrice) / sig.buyPrice) * 100;
        if (!best || gap < best.gap) best = { source, buyPrice: sig.buyPrice, gap, date: sig.date };
      }
      return best;
    }

    const sig = sigs[sourceFilter];
    if (!sig) return null;
    const gap = ((item.current_price - sig.buyPrice) / sig.buyPrice) * 100;
    return { source: sourceFilter, buyPrice: sig.buyPrice, gap, date: sig.date };
  }
  ```

- [ ] **Step 2: RankCard 컴포넌트에 Gap 정보 추가**

  `RankCard`의 props에 `gapInfo: GapInfo | null` 추가.

  줄 1 오른쪽 (현재가/등락률 옆)에 Gap 정보 추가:
  ```tsx
  {/* Gap 정보 */}
  {gapInfo && (
    <div className="shrink-0 text-right min-w-[4rem]">
      <span className={`text-xs font-bold tabular-nums ${gapInfo.gap >= 0 ? 'text-red-400' : 'text-blue-400'}`}>
        {gapInfo.gap >= 0 ? '+' : ''}{gapInfo.gap.toFixed(1)}%
      </span>
      <div className="flex items-center justify-end gap-1 mt-0.5">
        <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${SOURCE_DOTS[gapInfo.source] ?? 'bg-gray-400'}`} />
        <span className="text-[9px] text-[var(--muted)]">{SOURCE_LABELS[gapInfo.source] ?? gapInfo.source}</span>
      </div>
    </div>
  )}
  ```

  매수가는 모바일 라인(줄 1.5)에 추가:
  ```tsx
  {gapInfo && (
    <span className="text-[10px] text-[var(--muted)] tabular-nums">
      매{gapInfo.buyPrice.toLocaleString()}
    </span>
  )}
  ```

- [ ] **Step 3: 메인 컴포넌트 state + 필터 로직**

  기존 StockRankingSection state에 추가:
  ```typescript
  const [sourceFilter, setSourceFilter] = useState<SourceFilter>('all');
  const [gapAsc, setGapAsc] = useState(true); // true = Gap 오름차순 (할인순)
  ```

  `watchlistSymbols` prop을 실제로 사용해야 한다 (`portSet`):

  ```typescript
  const [portSet] = useState(() => new Set(watchlistSymbols));
  ```

  `StockActionMenu` 호출 시 `isInPortfolio={portSet.has(menu.symbol)}` 전달.

  실시간 가격 갱신 훅 추가 (`gap-client.tsx`의 동일 로직):
  ```typescript
  const allSymbols = useMemo(() => rawItems.map((s) => s.symbol), [rawItems]);
  const { prices: livePrices, refresh: refreshLivePrices, loading: liveLoading } = usePriceRefresh(allSymbols);
  const [priceLoading, setPriceLoading] = useState(false);

  const refreshPrices = useCallback(async () => {
    if (priceLoading || liveLoading) return;
    setPriceLoading(true);
    try {
      await fetch('/api/v1/prices', { method: 'POST' });
      await refreshLivePrices();
    } catch (e) {
      console.error('[UnifiedAnalysisSection] 가격 갱신 실패:', e);
    } finally {
      setPriceLoading(false);
    }
  }, [priceLoading, liveLoading, refreshLivePrices]);
  ```

  Gap 계산 시 `livePrices`의 현재가를 우선 사용:
  ```typescript
  function getGapInfoWithLive(
    item: StockRankItem,
    signalMap: SignalMap,
    sourceFilter: SourceFilter,
    livePrices: Record<string, { current_price: number | null }>,
  ): GapInfo | null {
    const currentPrice = livePrices[item.symbol]?.current_price ?? item.current_price;
    if (!currentPrice) return null;
    // getGapInfo와 동일 로직이지만 currentPrice를 override해서 사용
    ...
  }
  ```

  > `current_price`가 null인 종목(라이브 가격도 없는 경우)은 `getGapInfo()`가 null을 반환하므로 Gap 컬럼에 `-`가 표시되고, Gap 정렬 시 `Infinity` / `-Infinity` fallback으로 처리되어 리스트 최하단(오름차순) 또는 최상단(내림차순)으로 밀린다. 의도된 동작이다.

  `sort` 타입 확장:
  ```typescript
  type SortMode = 'score' | 'name' | 'updated' | 'gap';
  ```

  정렬 로직 수정 (`sortedItems` 계산):
  ```typescript
  const sortedItems = [...rawItems].sort((a, b) => {
    if (sort === 'gap') {
      const ga = getGapInfo(a, signalMap, sourceFilter)?.gap ?? (gapAsc ? Infinity : -Infinity);
      const gb = getGapInfo(b, signalMap, sourceFilter)?.gap ?? (gapAsc ? Infinity : -Infinity);
      return gapAsc ? ga - gb : gb - ga;
    }
    if (sort === 'name') return (a.name ?? '').localeCompare(b.name ?? '', 'ko');
    if (sort === 'updated') {
      const da = a.latest_signal_date ?? '';
      const db = b.latest_signal_date ?? '';
      if (da !== db) return db.localeCompare(da);
    }
    // score (default)
    const aHasAi = a.ai ? 1 : 0;
    const bHasAi = b.ai ? 1 : 0;
    if (aHasAi !== bHasAi) return bHasAi - aHasAi;
    return computeWeighted(b, weights) - computeWeighted(a, weights);
  });
  ```

- [ ] **Step 4: 필터 바 UI — 소스 필터 + Gap 정렬 토글 추가**

  소스 필터 (기존 시장 필터 아래에 추가):
  ```tsx
  {/* AI 소스 필터 */}
  <div className="flex gap-1">
    {(['all', 'quant', 'lassi', 'stockbot'] as const).map((src) => (
      <button
        key={src}
        onClick={() => setSourceFilter(src)}
        className={btnCls(sourceFilter === src)}
      >
        {src === 'all' ? '전체AI' : SOURCE_LABELS[src]}
      </button>
    ))}
  </div>
  ```

  정렬 바 수정 — 기존 정렬 옵션에 Gap 토글 추가:
  ```tsx
  {/* 정렬 바 */}
  <div className="flex gap-1 items-center flex-wrap">
    <span className="text-xs text-[var(--muted)] mr-1">정렬:</span>
    {/* 기존 점수순/이름순/업데이트순 버튼 */}
    {SORT_OPTIONS.map(({ key, label }) => (
      <button key={key} onClick={() => setSort(key)} className={btnCls(sort === key)}>
        {label}
      </button>
    ))}
    {/* Gap 정렬 토글 */}
    <button
      onClick={() => {
        if (sort === 'gap') {
          setGapAsc((v) => !v);
        } else {
          setSort('gap');
          setGapAsc(true);
        }
      }}
      className={btnCls(sort === 'gap')}
    >
      Gap {sort === 'gap' ? (gapAsc ? '↑' : '↓') : '↑↓'}
    </button>
  </div>
  ```

- [ ] **Step 5: RankCard 호출부에 gapInfo 전달**

  ```tsx
  {sortedItems.map((item, idx) => {
    const weighted = computeWeighted(item, weights);
    const gapInfo = getGapInfo(item, signalMap, sourceFilter);
    return (
      <RankCard
        key={item.symbol}
        item={item}
        rank={offset + idx + 1}
        weighted={weighted}
        favs={favs}
        gapInfo={gapInfo}
        onClick={(e) => openMenu(e, item.symbol, item.name, item.current_price)}
      />
    );
  })}
  ```

- [ ] **Step 6: 빌드 타입 확인**

  ```bash
  cd web && npx tsc --noEmit 2>&1 | head -40
  ```
  에러 없으면 OK.

- [ ] **Step 7: signals/page.tsx의 SignalMap import 교체**

  page.tsx에서 로컬 `SignalMap` 타입 정의를 제거하고:
  ```typescript
  import { UnifiedAnalysisSection, type SignalMap } from "@/components/signals/UnifiedAnalysisSection";
  ```

- [ ] **Step 8: 빌드 최종 확인**

  ```bash
  cd web && npx tsc --noEmit 2>&1 | head -40
  ```

- [ ] **Step 9: 커밋**

  ```bash
  cd web && git add src/app/signals/page.tsx src/components/signals/UnifiedAnalysisSection.tsx
  git commit -m "feat: GAP 추천 기능을 종목분석 탭으로 통합 (UnifiedAnalysisSection)"
  ```

---

## Chunk 3: 정리 — /gap 삭제 + 모바일 내비 수정

### Task 3: mobile-tab-bar.tsx + sidebar.tsx에서 /gap 제거

**Files:**
- Modify: `web/src/components/layout/mobile-tab-bar.tsx`
- Modify: `web/src/components/layout/sidebar.tsx`

`MORE_TABS` 배열에서 `/gap` 항목 제거 (mobile-tab-bar.tsx):

```typescript
// 제거할 항목:
{ href: "/gap", label: "GAP", icon: Target },
```

`Target` icon import도 사용하지 않으면 제거:

```typescript
// 변경 전:
import { LayoutDashboard, Target, Briefcase, Zap, BarChart3, TrendingUp, MoreHorizontal } from "lucide-react";
// 변경 후:
import { LayoutDashboard, Briefcase, Zap, BarChart3, TrendingUp, MoreHorizontal } from "lucide-react";
```

sidebar.tsx에서도 동일하게 `/gap` 항목 제거 (데스크탑 사이드바):

```typescript
// 제거할 항목 (sidebar.tsx):
{ href: "/gap", label: "GAP 추천", icon: Target },
```

- [ ] **Step 1: mobile-tab-bar.tsx 수정**

  위 변경사항 적용.

- [ ] **Step 2: sidebar.tsx 수정**

  `/gap` 항목 제거, 사용하지 않는 `Target` import 제거.

### Task 4: /gap 디렉토리 삭제

**Files:**
- Delete: `web/src/app/gap/page.tsx`
- Delete: `web/src/app/gap/gap-client.tsx`
- Delete: `web/src/app/gap/loading.tsx`

- [ ] **Step 3: /gap 파일 삭제**

  ```bash
  rm web/src/app/gap/page.tsx web/src/app/gap/gap-client.tsx web/src/app/gap/loading.tsx
  rmdir web/src/app/gap
  ```

- [ ] **Step 4: 빌드 확인**

  ```bash
  cd web && npx tsc --noEmit 2>&1 | head -40
  ```

- [ ] **Step 5: 커밋**

  ```bash
  cd web && git add -A src/app/gap src/components/layout/mobile-tab-bar.tsx src/components/layout/sidebar.tsx
  git commit -m "chore: /gap 독립 페이지 삭제, 내비게이션에서 GAP 항목 제거"
  ```

---

## 완료 체크리스트

- [ ] `/signals?tab=analysis` 에서 종목분석 탭이 AI 매수 신호 종목만 표시
- [ ] 각 종목 행에 Gap%, 매수가, AI소스 표시
- [ ] 소스 필터 (전체AI/퀀트/라씨/스톡봇) 동작
- [ ] Gap 정렬 토글 (↑ 오름차순 / ↓ 내림차순) 동작
- [ ] 신호가격 없는 종목은 Gap 컬럼 `-` 표시 (row는 표시됨)
- [ ] `/gap` URL 접속 시 404
- [ ] 모바일 더보기에서 GAP 항목 없음
- [ ] `npx tsc --noEmit` 에러 없음
