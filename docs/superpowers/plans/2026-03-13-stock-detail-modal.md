# 종목상세 팝업 모달 구현 계획

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 앱 전체에서 종목 클릭 시 전역 팝업 모달로 종목상세를 표시하고, 모달 내에서 포트/그룹 추가·삭제를 직접 관리한다.

**Architecture:** React Context 기반 전역 `StockModalProvider`를 `ClientProviders` 래퍼로 `layout.tsx`에 주입한다. 신규 API route 2개(`daily-prices`, `metrics`)를 추가하고, 모달 내 섹션 컴포넌트들을 조합하여 `StockDetailModal`을 구성한다. 앱 전체 종목 클릭 핸들러를 `openStockModal(symbol)`로 교체한다.

**Tech Stack:** Next.js 14 App Router, TypeScript, Tailwind CSS, Supabase, React Context API

**Spec:** `docs/superpowers/specs/2026-03-13-stock-detail-modal-design.md`

---

## Chunk 1: 신규 API Routes + 전역 Context 기반

### Task 1: daily-prices API route 신규 생성

**Files:**
- Create: `web/src/app/api/v1/stock/[symbol]/daily-prices/route.ts`

기존 `/stock/[symbol]/page.tsx`의 데이터 페칭 로직을 클라이언트에서 호출 가능한 route handler로 래핑한다. Supabase `daily_prices` 테이블을 우선 조회하고, 없으면 Naver API로 폴백한다.

- [ ] **Step 1: route handler 파일 생성**

```typescript
// web/src/app/api/v1/stock/[symbol]/daily-prices/route.ts
import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase";
import { fetchNaverDailyPrices } from "@/lib/naver-stock-api";

export async function GET(
  _req: NextRequest,
  { params }: { params: { symbol: string } }
) {
  const { symbol } = params;
  const supabase = createServiceClient();

  const { data: prices } = await supabase
    .from("daily_prices")
    .select("date, open, high, low, close, volume")
    .eq("symbol", symbol)
    .order("date", { ascending: false })
    .limit(90);

  if (prices && prices.length > 0) {
    return NextResponse.json(prices);
  }

  // Naver 폴백
  const naverPrices = await fetchNaverDailyPrices(symbol, 90);
  return NextResponse.json(naverPrices ?? []);
}
```

> **Note:** `fetchNaverDailyPrices` import 경로(`@/lib/naver-stock-api`)는 기존 `web/src/app/stock/[symbol]/page.tsx`의 import를 확인 후 일치시킨다.

- [ ] **Step 2: 브라우저에서 수동 확인**

```
curl "http://localhost:3000/api/v1/stock/005930/daily-prices"
```

Expected: JSON 배열 (date, open, high, low, close, volume 필드)

- [ ] **Step 3: Commit**

```bash
git add web/src/app/api/v1/stock/
git commit -m "feat: add daily-prices API route for stock modal"
```

---

### Task 2: metrics API route 신규 생성

**Files:**
- Create: `web/src/app/api/v1/stock/[symbol]/metrics/route.ts`

`stock_cache` 테이블에서 투자지표(PER, PBR, ROE, EPS, BPS, 시가총액, 52주 최고/최저, 배당수익률, 거래량)를 조회한다.

- [ ] **Step 1: route handler 파일 생성**

```typescript
// web/src/app/api/v1/stock/[symbol]/metrics/route.ts
import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase";

export async function GET(
  _req: NextRequest,
  { params }: { params: { symbol: string } }
) {
  const { symbol } = params;
  const supabase = createServiceClient();

  // 실제 컬럼명은 web/src/app/stock/[symbol]/page.tsx의 select 쿼리를 그대로 복사한다.
  // 아래는 실제 컬럼명 예시 (high_52w, low_52w, price_change, price_change_pct 등)
  const { data, error } = await supabase
    .from("stock_cache")
    .select(
      "per, pbr, roe, eps, bps, market_cap, high_52w, low_52w, dividend_yield, volume, current_price, price_change, price_change_pct, name"
    )
    .eq("symbol", symbol)
    .single();

  if (error || !data) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  return NextResponse.json(data);
}
```

> **Note:** `stock_cache` 컬럼명은 기존 `web/src/app/stock/[symbol]/page.tsx`의 select 쿼리를 참고한다.

- [ ] **Step 2: 수동 확인**

```
curl "http://localhost:3000/api/v1/stock/005930/metrics"
```

Expected: JSON 객체 with per, pbr, roe 등 필드

- [ ] **Step 3: Commit**

```bash
git add web/src/app/api/v1/stock/[symbol]/metrics/
git commit -m "feat: add metrics API route for stock modal"
```

---

### Task 3: StockModal Context + ClientProviders + layout.tsx 연결

**Files:**
- Create: `web/src/contexts/stock-modal-context.tsx`
- Create: `web/src/components/layout/client-providers.tsx`
- Modify: `web/src/app/layout.tsx`

`openStockModal(symbol, name)` 호출 → `symbol`과 `name` 상태 설정 → `StockDetailModal` 렌더링 트리거.

- [ ] **Step 1: Context 파일 생성**

```typescript
// web/src/contexts/stock-modal-context.tsx
"use client";

import { createContext, useContext, useState, useCallback, ReactNode } from "react";

interface StockModalState {
  symbol: string;
  name: string;
}

interface StockModalContextValue {
  modal: StockModalState | null;
  openStockModal: (symbol: string, name?: string) => void;
  closeStockModal: () => void;
}

const StockModalContext = createContext<StockModalContextValue | null>(null);

export function StockModalProvider({ children }: { children: ReactNode }) {
  const [modal, setModal] = useState<StockModalState | null>(null);

  const openStockModal = useCallback((symbol: string, name = "") => {
    setModal({ symbol, name });
  }, []);

  const closeStockModal = useCallback(() => {
    setModal(null);
  }, []);

  return (
    <StockModalContext.Provider value={{ modal, openStockModal, closeStockModal }}>
      {children}
      {/* StockDetailModal은 Task 8에서 추가 */}
    </StockModalContext.Provider>
  );
}

export function useStockModal() {
  const ctx = useContext(StockModalContext);
  if (!ctx) throw new Error("useStockModal must be used within StockModalProvider");
  return ctx;
}
```

- [ ] **Step 2: ClientProviders 래퍼 생성**

```typescript
// web/src/components/layout/client-providers.tsx
"use client";

import { ReactNode } from "react";
import { StockModalProvider } from "@/contexts/stock-modal-context";

export function ClientProviders({ children }: { children: ReactNode }) {
  return <StockModalProvider>{children}</StockModalProvider>;
}
```

- [ ] **Step 3: layout.tsx에서 ClientProviders로 감싸기**

`web/src/app/layout.tsx`를 열고 기존 `{children}` 렌더링 부분을 찾아 `<ClientProviders>`로 감싼다.

```typescript
// layout.tsx 수정 예시 (기존 구조 파악 후 children 래핑)
import { ClientProviders } from "@/components/layout/client-providers";

// 기존 children 렌더링 위치에서:
<ClientProviders>
  {children}
</ClientProviders>
```

> **Note:** `layout.tsx` 전체를 교체하지 말고, `{children}`을 렌더링하는 부분만 찾아서 `<ClientProviders>{children}</ClientProviders>`로 변경한다.

- [ ] **Step 4: 개발 서버 재시작 후 에러 없는지 확인**

```bash
cd web && npm run dev
```

Expected: 기존 앱이 정상 동작 (Context 추가만 됐으므로 UI 변화 없음)

- [ ] **Step 5: Commit**

```bash
git add web/src/contexts/ web/src/components/layout/client-providers.tsx web/src/app/layout.tsx
git commit -m "feat: add StockModal context and ClientProviders wrapper"
```

---

## Chunk 2: 모달 내부 섹션 컴포넌트들

### Task 4: StockModalHeader — 가격 + 포트/그룹 배지

**Files:**
- Create: `web/src/components/stock-modal/StockModalHeader.tsx`

헤더에 현재가, 등락률, 포트폴리오 배지(파란), 관심그룹 배지(초록)를 표시한다. 배지 클릭 시 해당 섹션으로 스크롤.

- [ ] **Step 1: StockModalHeader 컴포넌트 생성**

```typescript
// web/src/components/stock-modal/StockModalHeader.tsx
"use client";

interface Portfolio {
  id: string;
  name: string;
}

interface Group {
  id: string;
  name: string;
}

interface Props {
  symbol: string;
  name: string;
  currentPrice: number;
  changeAmount: number;
  changePct: number;
  portfolios: Portfolio[];   // 이 종목이 속한 포트폴리오 목록
  groups: Group[];           // 이 종목이 속한 관심그룹 목록
  onClose: () => void;
}

export function StockModalHeader({
  symbol, name, currentPrice, changeAmount, changePct,
  portfolios, groups, onClose,
}: Props) {
  const isUp = changeAmount >= 0;

  const scrollTo = (id: string) => {
    document.getElementById(id)?.scrollIntoView({ behavior: "smooth" });
  };

  return (
    <div className="sticky top-0 z-10 bg-[var(--card)] border-b border-[var(--border)] px-6 py-4">
      <div className="flex items-start justify-between">
        <div>
          <div className="flex items-baseline gap-2">
            <h2 className="text-lg font-bold">{name}</h2>
            <span className="text-sm text-[var(--muted)]">{symbol}</span>
          </div>
          <div className="flex items-baseline gap-2 mt-1">
            <span className="text-2xl font-bold">
              {currentPrice.toLocaleString()}원
            </span>
            <span className={`text-sm font-medium ${isUp ? "text-red-500" : "text-blue-500"}`}>
              {isUp ? "▲" : "▼"} {Math.abs(changeAmount).toLocaleString()}
              ({isUp ? "+" : ""}{changePct.toFixed(2)}%)
            </span>
          </div>
        </div>
        <button
          onClick={onClose}
          className="p-1 rounded hover:bg-[var(--muted)]/20 text-[var(--muted)] text-xl leading-none"
          aria-label="닫기"
        >
          ×
        </button>
      </div>

      {/* 배지 영역 */}
      <div className="mt-3 flex flex-wrap gap-x-4 gap-y-2 text-sm">
        <div className="flex items-center gap-1 flex-wrap">
          <span className="text-[var(--muted)] shrink-0">포트폴리오:</span>
          {portfolios.length === 0 ? (
            <span className="text-[var(--muted)]">없음</span>
          ) : (
            portfolios.map((p) => (
              <button
                key={p.id}
                onClick={() => scrollTo("portfolio-section")}
                className="px-2 py-0.5 rounded-full bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300 hover:opacity-80 text-xs"
              >
                {p.name}
              </button>
            ))
          )}
        </div>
        <div className="flex items-center gap-1 flex-wrap">
          <span className="text-[var(--muted)] shrink-0">관심그룹:</span>
          {groups.length === 0 ? (
            <span className="text-[var(--muted)]">없음</span>
          ) : (
            groups.map((g) => (
              <button
                key={g.id}
                onClick={() => scrollTo("group-section")}
                className="px-2 py-0.5 rounded-full bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300 hover:opacity-80 text-xs"
              >
                {g.name}
              </button>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add web/src/components/stock-modal/StockModalHeader.tsx
git commit -m "feat: add StockModalHeader with portfolio/group badges"
```

---

### Task 5: PortfolioManagementSection — 포트 추가/삭제

**Files:**
- Create: `web/src/components/stock-modal/PortfolioManagementSection.tsx`

포트폴리오 목록을 보여주고, 종목이 속한 포트에는 건수 + [삭제], 미속한 포트에는 [추가] 버튼 표시.

- [ ] **Step 1: PortfolioManagementSection 컴포넌트 생성**

```typescript
// web/src/components/stock-modal/PortfolioManagementSection.tsx
"use client";

import { useState } from "react";

interface Trade {
  id: string;
  portfolio_id: string;
  side: string;
  created_at: string;
}

interface Portfolio {
  id: string;
  name: string;
  is_default: boolean;
}

interface Props {
  symbol: string;
  name: string;
  currentPrice: number;
  portfolios: Portfolio[];
  trades: Trade[];            // GET /api/v1/user-portfolio/trades?symbol=X 결과
  onAddClick: (portfolioId: string, portfolioName: string) => void;  // TradeModal 오픈 콜백
  onTradesChange: (trades: Trade[]) => void;  // 삭제 후 상위 상태 갱신
}

export function PortfolioManagementSection({
  symbol, portfolios, trades, onAddClick, onTradesChange,
}: Props) {
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [confirmId, setConfirmId] = useState<string | null>(null);

  // 포트별 BUY 거래 목록 (최신순 정렬)
  const tradesByPortfolio = (portfolioId: string) =>
    trades
      .filter((t) => t.portfolio_id === portfolioId && t.side === "BUY")
      .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());

  const handleDelete = async (portfolioId: string) => {
    const portTrades = tradesByPortfolio(portfolioId);
    if (portTrades.length === 0) return;

    const latestTradeId = portTrades[0].id;
    setDeletingId(latestTradeId);
    try {
      const res = await fetch(
        `/api/v1/user-portfolio/trades?trade_id=${latestTradeId}`,
        { method: "DELETE" }
      );
      if (res.status === 409) {
        alert("이미 거래 완료된 종목입니다.");
        return;
      }
      if (!res.ok) throw new Error("삭제 실패");
      onTradesChange(trades.filter((t) => t.id !== latestTradeId));
      setConfirmId(null);
    } catch {
      alert("삭제 중 오류가 발생했습니다.");
    } finally {
      setDeletingId(null);
    }
  };

  return (
    <div id="portfolio-section" className="px-6 py-4 border-b border-[var(--border)]">
      <h3 className="text-sm font-semibold text-[var(--muted)] uppercase tracking-wide mb-3">
        포트폴리오
      </h3>
      <ul className="space-y-2">
        {portfolios.map((port) => {
          const portTrades = tradesByPortfolio(port.id);
          const count = portTrades.length;
          const inPort = count > 0;

          return (
            <li key={port.id} className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <span className={`text-sm ${inPort ? "font-medium" : "text-[var(--muted)]"}`}>
                  {inPort ? "✓" : "✗"} {port.name}
                  {count > 1 && (
                    <span className="ml-1 text-xs text-[var(--muted)]">({count}건)</span>
                  )}
                </span>
              </div>
              <div className="flex gap-2">
                <button
                  onClick={() => onAddClick(port.id, port.name)}
                  className="text-xs px-2 py-1 rounded border border-[var(--border)] hover:bg-[var(--muted)]/10"
                >
                  추가
                </button>
                {inPort && (
                  <>
                    {confirmId === port.id ? (
                      <>
                        <button
                          onClick={() => handleDelete(port.id)}
                          disabled={!!deletingId}
                          className="text-xs px-2 py-1 rounded bg-red-500 text-white hover:bg-red-600 disabled:opacity-50"
                        >
                          확인
                        </button>
                        <button
                          onClick={() => setConfirmId(null)}
                          className="text-xs px-2 py-1 rounded border border-[var(--border)] hover:bg-[var(--muted)]/10"
                        >
                          취소
                        </button>
                      </>
                    ) : (
                      <button
                        onClick={() => setConfirmId(port.id)}
                        className="text-xs px-2 py-1 rounded border border-red-300 text-red-600 hover:bg-red-50"
                      >
                        삭제
                      </button>
                    )}
                  </>
                )}
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add web/src/components/stock-modal/PortfolioManagementSection.tsx
git commit -m "feat: add PortfolioManagementSection for stock modal"
```

---

### Task 6: GroupManagementSection — 관심그룹 체크박스 토글

**Files:**
- Create: `web/src/components/stock-modal/GroupManagementSection.tsx`

- [ ] **Step 1: GroupManagementSection 컴포넌트 생성**

```typescript
// web/src/components/stock-modal/GroupManagementSection.tsx
"use client";

import { useState } from "react";

interface Group {
  id: string;
  name: string;
}

interface Props {
  symbol: string;
  name: string;                    // 종목명 (POST body에 필요)
  allGroups: Group[];              // 전체 관심그룹 목록
  memberGroupIds: string[];        // 이 종목이 속한 그룹 id 목록
  onMembershipChange: (groupIds: string[]) => void;
}

export function GroupManagementSection({
  symbol, name, allGroups, memberGroupIds, onMembershipChange,
}: Props) {
  const [pendingIds, setPendingIds] = useState<Set<string>>(new Set());
  const memberSet = new Set(memberGroupIds);

  const toggle = async (group: Group) => {
    if (pendingIds.has(group.id)) return;
    const isMember = memberSet.has(group.id);

    setPendingIds((prev) => new Set(prev).add(group.id));
    try {
      if (isMember) {
        // 제거
        const res = await fetch(
          `/api/v1/watchlist-groups/${group.id}/stocks/${symbol}`,
          { method: "DELETE" }
        );
        if (!res.ok) throw new Error();
        onMembershipChange(memberGroupIds.filter((id) => id !== group.id));
      } else {
        // 추가
        const res = await fetch(`/api/v1/watchlist-groups/${group.id}/stocks`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ symbol, name }),
        });
        if (!res.ok) throw new Error();
        onMembershipChange([...memberGroupIds, group.id]);
      }
    } catch {
      alert("관심그룹 변경 중 오류가 발생했습니다.");
    } finally {
      setPendingIds((prev) => {
        const next = new Set(prev);
        next.delete(group.id);
        return next;
      });
    }
  };

  return (
    <div id="group-section" className="px-6 py-4 border-b border-[var(--border)]">
      <h3 className="text-sm font-semibold text-[var(--muted)] uppercase tracking-wide mb-3">
        관심그룹
      </h3>
      {allGroups.length === 0 ? (
        <p className="text-sm text-[var(--muted)]">관심그룹이 없습니다.</p>
      ) : (
        <ul className="space-y-2">
          {allGroups.map((group) => {
            const isMember = memberSet.has(group.id);
            const isPending = pendingIds.has(group.id);
            return (
              <li key={group.id}>
                <label className="flex items-center gap-2 cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={isMember}
                    onChange={() => toggle(group)}
                    disabled={isPending}
                    className="rounded"
                  />
                  <span className={`text-sm ${isPending ? "opacity-50" : ""}`}>
                    {group.name}
                  </span>
                </label>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add web/src/components/stock-modal/GroupManagementSection.tsx
git commit -m "feat: add GroupManagementSection for stock modal"
```

---

### Task 7: StockAiAnalysis — 단일 종목 AI 분석 섹션

**Files:**
- Create: `web/src/components/stock-modal/StockAiAnalysis.tsx`

`UnifiedAnalysisSection`은 전체 목록 구조이므로 재사용하지 않는다. `/api/v1/signals?symbol=X` 데이터를 받아 AI 배지, 점수, GAP, 신호 이력 테이블을 표시하는 단독 컴포넌트를 만든다.

- [ ] **Step 1: StockAiAnalysis 컴포넌트 생성**

> **Note:** 아래 Signal 타입과 API 응답 구조는 기존 `/signals` 페이지 코드와 `signal-columns.tsx`를 참고해 실제 필드명과 맞추어야 한다.

```typescript
// web/src/components/stock-modal/StockAiAnalysis.tsx
"use client";

interface Signal {
  id: string;
  symbol: string;
  signal_type: string;   // "BUY" | "SELL" | "BUY_FORECAST" | "SELL_COMPLETE"
  source: string;        // "lassi" | "stockbot" | "quant"
  // 가격: raw_data.signal_price (또는 raw_data.recommend_price) 에서 파싱
  // 날짜: timestamp 필드 사용 (created_at 아님)
  timestamp: string;
  raw_data?: Record<string, unknown>;
}

interface Props {
  signals: Signal[];
  currentPrice: number;
}

const BADGE_LABELS: Record<string, string> = {
  golden_cross: "골든크로스",
  bollinger_bottom: "볼린저하단",
  phoenix_pattern: "피닉스패턴",
  volume_surge: "거래량급등",
};

const SOURCE_LABELS: Record<string, string> = {
  lassi: "Lassi",
  stockbot: "StockBot",
  quant: "Quant",
};

export function StockAiAnalysis({ signals, currentPrice }: Props) {
  const latestBuy = signals.find(
    (s) => s.signal_type === "BUY" || s.signal_type === "BUY_FORECAST"
  );

  // raw_data에서 가격 파싱 (실제 필드명은 signal-columns.tsx / signals page를 참고)
  const getSignalPrice = (s: Signal): number => {
    const rd = s.raw_data ?? {};
    return (rd.signal_price ?? rd.recommend_price ?? rd.buy_range_low ?? 0) as number;
  };

  const latestBuyPrice = latestBuy ? getSignalPrice(latestBuy) : 0;
  const gapPct = latestBuyPrice > 0
    ? ((currentPrice - latestBuyPrice) / latestBuyPrice) * 100
    : null;

  // raw_data에서 AI 배지 추출 (실제 필드명은 기존 UnifiedAnalysisSection 참고)
  const badges: string[] = [];
  if (latestBuy?.raw_data) {
    Object.keys(BADGE_LABELS).forEach((key) => {
      if (latestBuy.raw_data![key]) badges.push(key);
    });
  }

  return (
    <div className="px-6 py-4 border-b border-[var(--border)]">
      <h3 className="text-sm font-semibold text-[var(--muted)] uppercase tracking-wide mb-3">
        AI 신호 & 분석
      </h3>

      {/* AI 배지 */}
      {badges.length > 0 && (
        <div className="flex flex-wrap gap-1 mb-3">
          {badges.map((key) => (
            <span
              key={key}
              className="px-2 py-0.5 text-xs rounded-full bg-purple-100 text-purple-700 dark:bg-purple-900/40 dark:text-purple-300"
            >
              {BADGE_LABELS[key]}
            </span>
          ))}
        </div>
      )}

      {/* GAP 분석 */}
      {gapPct !== null && (
        <div className="mb-3 text-sm">
          <span className="text-[var(--muted)]">매수신호 대비 GAP: </span>
          <span className={`font-medium ${gapPct >= 0 ? "text-red-500" : "text-blue-500"}`}>
            {gapPct >= 0 ? "+" : ""}{gapPct.toFixed(1)}%
          </span>
          <span className="text-[var(--muted)] ml-1 text-xs">
            (신호가 {latestBuyPrice.toLocaleString()}원)
          </span>
        </div>
      )}

      {/* 신호 이력 테이블 */}
      {signals.length === 0 ? (
        <p className="text-sm text-[var(--muted)]">신호 이력이 없습니다.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-[var(--muted)] border-b border-[var(--border)]">
                <th className="pb-1 font-normal">날짜</th>
                <th className="pb-1 font-normal">소스</th>
                <th className="pb-1 font-normal">타입</th>
                <th className="pb-1 font-normal text-right">가격</th>
              </tr>
            </thead>
            <tbody>
              {signals.slice(0, 20).map((s) => (
                <tr key={s.id} className="border-b border-[var(--border)]/50">
                  <td className="py-1.5 text-[var(--muted)] text-xs">
                    {new Date(s.timestamp).toLocaleDateString("ko-KR")}
                  </td>
                  <td className="py-1.5 text-xs">
                    {SOURCE_LABELS[s.source] ?? s.source}
                  </td>
                  <td className="py-1.5">
                    <span className={`text-xs font-medium ${
                      s.signal_type.startsWith("BUY") ? "text-red-500" : "text-blue-500"
                    }`}>
                      {s.signal_type}
                    </span>
                  </td>
                  <td className="py-1.5 text-right">
                    {getSignalPrice(s).toLocaleString()}원
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add web/src/components/stock-modal/StockAiAnalysis.tsx
git commit -m "feat: add StockAiAnalysis component for stock modal"
```

---

## Chunk 3: StockDetailModal 조립 + 매수 버튼 제거

### Task 8: StockDetailModal — 전체 모달 컴포넌트 조립

**Files:**
- Create: `web/src/components/stock-modal/StockDetailModal.tsx`
- Modify: `web/src/contexts/stock-modal-context.tsx` (Provider 안에 모달 렌더링 추가)

모달 오픈 시 병렬로 6개 API를 페칭하고, 로딩/에러 상태를 처리하며, 모든 섹션 컴포넌트를 조립한다.

- [ ] **Step 1: StockDetailModal 컴포넌트 생성**

> **Note:** 아래 import 경로 중 `TradeModal`, `usePriceRefresh` 등은 실제 프로젝트 경로를 확인 후 사용한다. TradeModal 경로: `@/app/my-portfolio/components/trade-modal`

```typescript
// web/src/components/stock-modal/StockDetailModal.tsx
"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import { useStockModal } from "@/contexts/stock-modal-context";
import { StockModalHeader } from "./StockModalHeader";
import { StockAiAnalysis } from "./StockAiAnalysis";
import { PortfolioManagementSection } from "./PortfolioManagementSection";
import { GroupManagementSection } from "./GroupManagementSection";

// TradeModal은 동적 import로 코드 스플리팅
import dynamic from "next/dynamic";
const TradeModal = dynamic(
  () => import("@/app/my-portfolio/components/trade-modal").then((m) => m.TradeModal),
  { ssr: false }
);

interface Metrics {
  name: string;
  current_price: number;
  price_change: number;      // stock_cache 실제 컬럼명
  price_change_pct: number;  // stock_cache 실제 컬럼명
  per: number | null;
  pbr: number | null;
  roe: number | null;
  market_cap: number | null;
}

export function StockDetailModal() {
  const { modal, closeStockModal } = useStockModal();
  const [metrics, setMetrics] = useState<Metrics | null>(null);
  const [signals, setSignals] = useState<unknown[]>([]);
  const [trades, setTrades] = useState<unknown[]>([]);
  const [portfolios, setPortfolios] = useState<{ id: string; name: string; is_default: boolean }[]>([]);
  const [allGroups, setAllGroups] = useState<{ id: string; name: string }[]>([]);
  const [memberGroupIds, setMemberGroupIds] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // TradeModal 상태
  const [tradeModalOpen, setTradeModalOpen] = useState(false);
  const [tradePortfolioId, setTradePortfolioId] = useState<string>("");

  const scrollRef = useRef<HTMLDivElement>(null);

  const fetchAll = useCallback(async (symbol: string) => {
    setLoading(true);
    setError(null);
    try {
      const [metricsRes, signalsRes, tradesRes, portfoliosRes, groupsRes] = await Promise.all([
        fetch(`/api/v1/stock/${symbol}/metrics`),
        fetch(`/api/v1/signals?symbol=${symbol}`),
        fetch(`/api/v1/user-portfolio/trades?symbol=${symbol}`),
        fetch(`/api/v1/user-portfolio`),
        fetch(`/api/v1/watchlist-groups`),
      ]);

      const [metricsData, signalsData, tradesData, portfoliosData, groupsData] = await Promise.all([
        metricsRes.ok ? metricsRes.json() : null,
        signalsRes.ok ? signalsRes.json() : [],
        tradesRes.ok ? tradesRes.json() : [],
        portfoliosRes.ok ? portfoliosRes.json() : [],
        groupsRes.ok ? groupsRes.json() : [],
      ]);

      setMetrics(metricsData);
      setSignals(Array.isArray(signalsData) ? signalsData : signalsData?.signals ?? []);
      setTrades(Array.isArray(tradesData) ? tradesData : tradesData?.trades ?? []);
      setPortfolios(Array.isArray(portfoliosData) ? portfoliosData : portfoliosData?.portfolios ?? []);

      // 그룹 목록 처리
      const groups = Array.isArray(groupsData) ? groupsData : groupsData?.groups ?? [];
      setAllGroups(groups);

      // 멤버십 조회: 각 그룹별로 GET /api/v1/watchlist-groups/[id]/stocks 호출 후
      // symbol이 포함된 그룹 id 목록 추출
      // (watchlist-groups GET은 stocks join을 포함하지 않으므로 별도 조회 필요)
      const membershipResults = await Promise.all(
        groups.map(async (g: { id: string }) => {
          const res = await fetch(`/api/v1/watchlist-groups/${g.id}/stocks`);
          if (!res.ok) return null;
          const data = await res.json();
          const stocks = Array.isArray(data) ? data : data?.stocks ?? [];
          const isMember = stocks.some(
            (s: { symbol: string }) => s.symbol === symbol
          );
          return isMember ? g.id : null;
        })
      );
      setMemberGroupIds(membershipResults.filter(Boolean) as string[]);
    } catch {
      setError("데이터를 불러오는 중 오류가 발생했습니다.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (modal?.symbol) {
      fetchAll(modal.symbol);
    }
  }, [modal?.symbol, fetchAll]);

  // ESC 키 닫기
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") closeStockModal();
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [closeStockModal]);

  if (!modal) return null;

  // 이 종목이 속한 포트폴리오 계산
  const portfolioTrades = trades as { portfolio_id: string; side: string }[];
  const memberPortfolioIds = new Set(
    portfolioTrades.filter((t) => t.side === "BUY").map((t) => t.portfolio_id)
  );
  const memberPortfolios = portfolios.filter((p) => memberPortfolioIds.has(p.id));

  // 이 종목이 속한 관심그룹
  const memberGroups = allGroups.filter((g) => memberGroupIds.includes(g.id));

  const currentPrice = metrics?.current_price ?? 0;

  return (
    <>
      {/* 배경 오버레이 */}
      <div
        className="fixed inset-0 z-50 bg-black/60"
        onClick={closeStockModal}
      />

      {/* 모달 컨테이너 */}
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4 pointer-events-none">
        <div
          ref={scrollRef}
          className="pointer-events-auto w-full max-w-2xl max-h-[90vh] flex flex-col bg-[var(--card)] rounded-xl shadow-2xl overflow-hidden"
        >
          {/* 헤더 */}
          <StockModalHeader
            symbol={modal.symbol}
            name={metrics?.name ?? modal.name}
            currentPrice={currentPrice}
            changeAmount={metrics?.price_change ?? 0}
            changePct={metrics?.price_change_pct ?? 0}
            portfolios={memberPortfolios}
            groups={memberGroups}
            onClose={closeStockModal}
          />

          {/* 본문 (스크롤) */}
          <div className="flex-1 overflow-y-auto">
            {loading && (
              <div className="p-8 text-center text-[var(--muted)]">로딩 중...</div>
            )}
            {error && (
              <div className="p-8 text-center">
                <p className="text-red-500 mb-3">{error}</p>
                <button
                  onClick={() => fetchAll(modal.symbol)}
                  className="text-sm px-3 py-1 rounded border border-[var(--border)] hover:bg-[var(--muted)]/10"
                >
                  재시도
                </button>
              </div>
            )}

            {!loading && !error && (
              <>
                {/* 투자지표 */}
                {metrics && (
                  <div className="px-6 py-4 border-b border-[var(--border)]">
                    <h3 className="text-sm font-semibold text-[var(--muted)] uppercase tracking-wide mb-3">
                      투자지표
                    </h3>
                    <div className="grid grid-cols-3 gap-3 text-sm">
                      {[
                        { label: "PER", value: metrics.per?.toFixed(2) ?? "—" },
                        { label: "PBR", value: metrics.pbr?.toFixed(2) ?? "—" },
                        { label: "ROE", value: metrics.roe ? `${metrics.roe.toFixed(1)}%` : "—" },
                      ].map(({ label, value }) => (
                        <div key={label} className="bg-[var(--background)] rounded-lg p-2 text-center">
                          <p className="text-[var(--muted)] text-xs">{label}</p>
                          <p className="font-medium mt-0.5">{value}</p>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* AI 신호 & 분석 */}
                <StockAiAnalysis
                  signals={signals as Parameters<typeof StockAiAnalysis>[0]["signals"]}
                  currentPrice={currentPrice}
                />

                {/* 포트폴리오 관리 */}
                <PortfolioManagementSection
                  symbol={modal.symbol}
                  name={metrics?.name ?? modal.name}
                  currentPrice={currentPrice}
                  portfolios={portfolios}
                  trades={trades as Parameters<typeof PortfolioManagementSection>[0]["trades"]}
                  onAddClick={(portfolioId) => {
                    setTradePortfolioId(portfolioId);
                    setTradeModalOpen(true);
                  }}
                  onTradesChange={(newTrades) =>
                    setTrades(newTrades as typeof trades)
                  }
                />

                {/* 관심그룹 관리 */}
                <GroupManagementSection
                  symbol={modal.symbol}
                  name={metrics?.name ?? modal.name}
                  allGroups={allGroups}
                  memberGroupIds={memberGroupIds}
                  onMembershipChange={setMemberGroupIds}
                />
              </>
            )}
          </div>

          {/* 하단 고정 버튼 */}
          <div className="border-t border-[var(--border)] px-6 py-3 flex gap-3">
            <button
              onClick={() => setTradeModalOpen(true)}
              className="flex-1 py-2 rounded-lg bg-[var(--accent)] text-white text-sm font-medium hover:opacity-90"
            >
              포트에 추가
            </button>
            <button
              onClick={() =>
                document.getElementById("group-section")?.scrollIntoView({ behavior: "smooth" })
              }
              className="flex-1 py-2 rounded-lg border border-[var(--border)] text-sm hover:bg-[var(--muted)]/10"
            >
              관심그룹 관리
            </button>
          </div>
        </div>
      </div>

      {/* TradeModal */}
      {tradeModalOpen && (
        <TradeModal
          mode="buy"
          isOpen={tradeModalOpen}
          onClose={() => setTradeModalOpen(false)}
          onSubmit={() => {
            setTradeModalOpen(false);
            fetchAll(modal.symbol); // 추가 후 데이터 갱신
          }}
          initialSymbol={modal.symbol}
          initialName={metrics?.name ?? modal.name}
          initialPrice={currentPrice}
          portfolios={portfolios.filter((p) => !p.is_default)}
          // portfolioId prop이 있으면 전달 (TradeModal 실제 props 확인 필요)
        />
      )}
    </>
  );
}
```

- [ ] **Step 2: stock-modal-context.tsx에 StockDetailModal 렌더링 추가**

`web/src/contexts/stock-modal-context.tsx`를 열어 Provider children 아래에 `<StockDetailModal />`을 추가한다.

```typescript
// 기존 코드에서 이 부분을 수정:
import { StockDetailModal } from "@/components/stock-modal/StockDetailModal";

// Provider return 안:
return (
  <StockModalContext.Provider value={{ modal, openStockModal, closeStockModal }}>
    {children}
    <StockDetailModal />  {/* ← 이 줄 추가 */}
  </StockModalContext.Provider>
);
```

- [ ] **Step 3: 개발 서버에서 수동 테스트**

앱 실행 후 브라우저 콘솔에서 직접 테스트:
```javascript
// 브라우저 콘솔에서는 직접 테스트 불가이므로, 임시로 layout.tsx에 테스트 버튼 추가하거나
// 다음 Task에서 종목 클릭 연결 후 테스트
```

- [ ] **Step 4: Commit**

```bash
git add web/src/components/stock-modal/StockDetailModal.tsx web/src/contexts/stock-modal-context.tsx
git commit -m "feat: add StockDetailModal with all sections assembled"
```

---

### Task 9: 매수 버튼 제거

**Files:**
- Modify: `web/src/components/stock/stock-price-header.tsx`
- Modify: `web/src/components/stock/stock-portfolio-overlay.tsx`

기존 "매수" 버튼을 제거한다. 모달 진입 시 하단 버튼으로 대체되므로 별도 대체 UI 불필요.

- [ ] **Step 1: stock-price-header.tsx에서 매수 버튼 제거**

`web/src/components/stock/stock-price-header.tsx`를 열어:
- `onBuyClick` prop 및 관련 버튼 JSX 제거
- 해당 prop을 사용하는 부모 컴포넌트(`/stock/[symbol]/page.tsx`)에서도 prop 전달 코드 제거

- [ ] **Step 2: stock-portfolio-overlay.tsx에서 매수 버튼 제거**

`web/src/components/stock/stock-portfolio-overlay.tsx`를 열어:
- `showBuyModal`, `onBuyModalClose` prop 및 관련 버튼 JSX 제거
- 해당 props를 사용하는 부모 컴포넌트에서도 제거

- [ ] **Step 3: TypeScript 빌드 오류 확인**

```bash
cd web && npx tsc --noEmit 2>&1 | head -50
```

Expected: 0 errors (남은 오류는 수정)

- [ ] **Step 4: Commit**

```bash
git add web/src/components/stock/
git commit -m "feat: remove 매수 button from stock-price-header and stock-portfolio-overlay"
```

---

## Chunk 4: 앱 전체 종목 클릭 → openStockModal 연결

### Task 10: stock-action-menu.tsx 업데이트

**Files:**
- Modify: `web/src/components/common/stock-action-menu.tsx`

"상세보기" 메뉴 클릭을 `openStockModal()`로 변경하고, 포트 삭제 버그(잘못된 `/api/v1/watchlist` 호출)를 수정한다.

- [ ] **Step 1: stock-action-menu.tsx 수정**

```typescript
// 파일 상단에 추가:
import { useStockModal } from "@/contexts/stock-modal-context";

// 컴포넌트 내부에 추가:
const { openStockModal } = useStockModal();

// "상세보기" 버튼 onClick:
onClick={() => {
  openStockModal(symbol, name);
  onClose();
}}

// 포트 삭제 버그 수정 — isInPortfolio 삭제 시 잘못된 /api/v1/watchlist 대신:
// DELETE /api/v1/user-portfolio/trades?symbol=X 로 교체
// (가장 최근 BUY trade_id를 먼저 조회 후 삭제)
const handlePortfolioRemove = async () => {
  // 1) 해당 종목의 trades 조회
  const res = await fetch(`/api/v1/user-portfolio/trades?symbol=${encodeURIComponent(symbol)}`);
  const data = await res.json();
  const trades = Array.isArray(data) ? data : data?.trades ?? [];
  const buyTrades = trades
    .filter((t: { side: string }) => t.side === "BUY")
    .sort((a: { created_at: string }, b: { created_at: string }) =>
      new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
    );
  if (buyTrades.length === 0) return;

  // 2) 최신 BUY 삭제
  const deleteRes = await fetch(
    `/api/v1/user-portfolio/trades?trade_id=${buyTrades[0].id}`,
    { method: "DELETE" }
  );
  if (deleteRes.status === 409) {
    alert("이미 거래 완료된 종목입니다.");
    return;
  }
  // 3) 성공 시 콜백 or 페이지 refresh
};
```

- [ ] **Step 2: 개발 서버에서 action menu 동작 확인**

앱 실행 → 종목 목록에서 종목 우클릭 또는 메뉴 열기 → "상세보기" 클릭 → 모달이 열리는지 확인

- [ ] **Step 3: Commit**

```bash
git add web/src/components/common/stock-action-menu.tsx
git commit -m "feat: stock-action-menu uses openStockModal, fix portfolio remove bug"
```

---

### Task 11: /signals 페이지 종목 클릭 → openStockModal

**Files:**
- Modify: `web/src/app/signals/page.tsx`
- Modify: `web/src/app/signals/signal-columns.tsx`

- [ ] **Step 1: signal-columns.tsx에 openStockModal 연결**

`web/src/app/signals/signal-columns.tsx`를 열어 SignalCard onClick 또는 행 클릭 시 `openStockModal(symbol, name)` 호출하도록 수정한다.

```typescript
// signal-columns.tsx에서:
import { useStockModal } from "@/contexts/stock-modal-context";

// 컴포넌트 내:
const { openStockModal } = useStockModal();

// 클릭 핸들러:
onClick={() => openStockModal(signal.symbol, signal.name)}
```

- [ ] **Step 2: signals/page.tsx에서 종목 행 클릭 → openStockModal 확인**

`web/src/app/signals/page.tsx`를 열어 종목명 클릭 핸들러가 `router.push`를 사용하는 경우 `openStockModal`로 교체한다.

- [ ] **Step 3: 수동 테스트**

앱에서 `/signals` 페이지 → AI 신호 탭 → 종목 클릭 → 모달 팝업 확인

- [ ] **Step 4: Commit**

```bash
git add web/src/app/signals/
git commit -m "feat: signals page stock clicks open StockDetailModal"
```

---

### Task 12: /stocks 페이지 종목 클릭 → openStockModal

**Files:**
- Modify: `web/src/components/stocks/stock-list-client.tsx`

현재 `handleRowClick`은 `StockActionMenu`를 열도록 되어 있다. 행 클릭 시 바로 `openStockModal()`이 열리도록 수정한다. (기존 StockActionMenu는 우클릭/더 보기 버튼으로만 열리도록 유지하거나, 행 클릭을 모달 직접 오픈으로 변경한다.)

- [ ] **Step 1: stock-list-client.tsx 수정**

```typescript
// 파일 상단에 추가:
import { useStockModal } from "@/contexts/stock-modal-context";

// 컴포넌트 내:
const { openStockModal } = useStockModal();

// handleRowClick 수정 — 기존 setActionMenu 대신:
const handleRowClick = useCallback((e: React.MouseEvent, stock: StockCache) => {
  if ((e.target as HTMLElement).closest("button")) return;
  openStockModal(stock.symbol, stock.name);
}, [openStockModal]);
```

> **Note:** `StockActionMenu` 오픈은 별도 "더보기" 버튼이나 우클릭으로 유지할 수 있다. 기존 코드 구조를 확인하여 UX를 유지한다.

- [ ] **Step 2: 수동 테스트**

`/stocks` 페이지 → 종목 행 클릭 → 모달 팝업 확인

- [ ] **Step 3: Commit**

```bash
git add web/src/components/stocks/stock-list-client.tsx
git commit -m "feat: stocks page row click opens StockDetailModal"
```

---

### Task 13: /my-portfolio 페이지 Link → button + openStockModal

**Files:**
- Modify: `web/src/app/my-portfolio/page.tsx`

- [ ] **Step 1: my-portfolio/page.tsx에서 Link → button 교체**

`web/src/app/my-portfolio/page.tsx` 열어 약 488-490번째 줄의 `<Link href={/stock/${h.symbol}}>` 패턴을 찾아:

```typescript
// 기존:
<Link href={`/stock/${h.symbol}`} className="font-medium hover:text-[var(--accent)]">
  {h.name}
</Link>

// 변경: (useStockModal을 페이지 컴포넌트에서 사용하려면 'use client' 또는 별도 client 컴포넌트로 분리)
// my-portfolio/page.tsx가 서버 컴포넌트라면, 종목 행 부분을 client 컴포넌트로 추출 필요
// 혹은 기존 client 컴포넌트 패턴 확인 후 적용
```

> **Note:** `my-portfolio/page.tsx`가 서버/클라이언트 컴포넌트인지 먼저 확인한다. 클라이언트 컴포넌트라면 바로 `useStockModal()` 사용 가능. 서버 컴포넌트라면 종목 이름 셀만 별도 `StockNameCell` 클라이언트 컴포넌트로 추출한다.

- [ ] **Step 2: 수동 테스트**

`/my-portfolio` → 종목명 클릭 → 모달 팝업 확인

- [ ] **Step 3: Commit**

```bash
git add web/src/app/my-portfolio/
git commit -m "feat: my-portfolio stock name click opens StockDetailModal"
```

---

### Task 14: 나머지 페이지 종목 링크 → openStockModal

**Files:**
- Modify: `web/src/app/portfolio/` (AI 포트폴리오 페이지)
- Modify: `web/src/app/page.tsx` (대시보드)

- [ ] **Step 1: AI 포트폴리오 페이지 수정**

`web/src/app/portfolio/` 디렉토리를 열어 종목 링크 패턴 찾기:

```bash
grep -r "stock/" web/src/app/portfolio/ --include="*.tsx"
grep -r "stock/" web/src/app/page.tsx
```

찾은 각 `<Link href="/stock/...">` 또는 `router.push("/stock/...")` 패턴을 `openStockModal(symbol, name)`으로 교체한다.

- [ ] **Step 2: 대시보드 페이지 수정**

`web/src/app/page.tsx`에서 종목 링크 패턴 동일하게 교체.

- [ ] **Step 3: TypeScript 빌드 최종 확인**

```bash
cd web && npx tsc --noEmit 2>&1 | head -30
```

Expected: 0 errors

- [ ] **Step 4: 전체 수동 테스트**

주요 경로 확인:
1. `/signals` → 종목 클릭 → 모달 팝업 → 포트 추가 버튼 → TradeModal 오픈
2. 모달 헤더 → 포트 배지 클릭 → portfolio-section 스크롤
3. 모달 헤더 → 그룹 배지 클릭 → group-section 스크롤
4. 관심그룹 체크박스 토글 → 헤더 배지 즉시 업데이트
5. ESC 키 → 모달 닫기
6. 배경 클릭 → 모달 닫기
7. `/stock/005930` 직접 URL → 기존 페이지 정상 동작
8. `stock-action-menu` "상세보기" → 모달 팝업

- [ ] **Step 5: 최종 Commit**

```bash
git add web/src/app/portfolio/ web/src/app/page.tsx
git commit -m "feat: all stock links open StockDetailModal globally"
```

---

## 완료 확인 체크리스트

- [ ] `GET /api/v1/stock/[symbol]/daily-prices` 응답 정상
- [ ] `GET /api/v1/stock/[symbol]/metrics` 응답 정상
- [ ] 모달 오픈 시 헤더에 현재가, 포트/그룹 배지 표시
- [ ] 투자지표 섹션 표시
- [ ] AI 신호 이력 테이블 표시
- [ ] 포트폴리오 관리 섹션: 추가/삭제/확인 다이얼로그 동작
- [ ] 관심그룹 관리 섹션: 체크박스 토글 즉시 반영
- [ ] 하단 "포트에 추가" → TradeModal 오픈
- [ ] 매수 버튼 stock-price-header, stock-portfolio-overlay에서 제거됨
- [ ] 앱 전체 종목 클릭 → 모달 (페이지 이동 없음)
- [ ] `/stock/[symbol]` 직접 URL → 기존 페이지 정상
- [ ] ESC/배경 클릭 → 모달 닫기
- [ ] TypeScript 빌드 오류 0개
