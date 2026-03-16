# 메인 대시보드 재설계 Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 메인 대시보드(`/`)를 모든 페이지의 핵심 지표를 그리드 위젯으로 보여주는 허브형 대시보드로 재편

**Architecture:** 서버 컴포넌트(`page.tsx`)에서 대부분의 데이터를 병렬로 패칭하고, 실시간 가격이 필요한 관심종목과 외부 API 호출이 필요한 가상 PF 카드만 클라이언트 컴포넌트로 분리한다. 소스별 포트폴리오(`portfolio_snapshots`)와 투자 현황 카운트는 서버에서 직접 조회한다. 가상 PF 요약 API는 `virtual_trades` 대신 실제 테이블인 `user_trades` + `user_portfolios`를 사용하며, 응답 형식은 포트폴리오 목록 기반으로 구성한다(스펙 §6의 `by_source` 형식은 실제 데이터 모델과 맞지 않아 변경).

**Tech Stack:** Next.js 16 서버 컴포넌트, Supabase (`createServiceClient`), Tailwind CSS 4, `usePriceRefresh` 훅, `useStockModal` 컨텍스트

---

## 파일 구조

| 작업 | 파일 경로 | 역할 |
| ---- | --------- | ---- |
| 신규 | `web/src/app/api/v1/user-portfolio/summary/route.ts` | user_portfolios + user_trades 집계 API |
| 신규 | `web/src/components/dashboard/dashboard-risk-banner.tsx` | 위험 지수 배너 (서버, risk_index만) |
| 신규 | `web/src/components/dashboard/signal-summary-card.tsx` | 신호 요약 카드 (서버) |
| 신규 | `web/src/components/dashboard/market-summary-card.tsx` | 투자 시황 요약 카드 (서버) |
| 신규 | `web/src/components/dashboard/investment-summary-card.tsx` | 투자 현황 요약 카드 (서버) |
| 신규 | `web/src/components/dashboard/source-portfolio-card.tsx` | 소스별 포트폴리오 카드 (서버) |
| 신규 | `web/src/components/dashboard/watchlist-widget.tsx` | 관심종목 실시간 위젯 (클라이언트) |
| 신규 | `web/src/components/dashboard/virtual-portfolio-section.tsx` | 가상PF + 소스별PF 섹션 (클라이언트) |
| 수정 | `web/src/app/page.tsx` | 전면 재작성 — 새 위젯 조립 |

---

## Chunk 1: 요약 API 엔드포인트

### Task 1: `/api/v1/user-portfolio/summary` 라우트 생성

**Files:**
- Create: `web/src/app/api/v1/user-portfolio/summary/route.ts`

- [ ] **Step 1: 파일 생성**

```typescript
// web/src/app/api/v1/user-portfolio/summary/route.ts
import { NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase";

export const dynamic = "force-dynamic";

export async function GET() {
  const supabase = createServiceClient();

  // user_portfolios 목록 조회
  const { data: portfolios, error: pErr } = await supabase
    .from("user_portfolios")
    .select("id, name")
    .order("sort_order", { ascending: true });

  if (pErr) {
    return NextResponse.json({ error: pErr.message }, { status: 500 });
  }

  // user_trades 중 SELL 없이 남은 BUY (오픈 포지션) 조회
  const { data: openBuys, error: tErr } = await supabase
    .from("user_trades")
    .select("id, portfolio_id, side")
    .eq("side", "BUY");

  if (tErr) {
    return NextResponse.json({ error: tErr.message }, { status: 500 });
  }

  // 매도 완료된 trade_id 조회
  const { data: sells } = await supabase
    .from("user_trades")
    .select("buy_trade_id")
    .eq("side", "SELL");

  const soldIds = new Set((sells ?? []).map((s) => s.buy_trade_id));
  const openTrades = (openBuys ?? []).filter((t) => !soldIds.has(t.id));

  // 포트폴리오별 집계
  const byPortfolio: Record<number, number> = {};
  for (const trade of openTrades) {
    byPortfolio[trade.portfolio_id] = (byPortfolio[trade.portfolio_id] ?? 0) + 1;
  }

  const portfolioSummary = (portfolios ?? []).map((p) => ({
    id: p.id,
    name: p.name,
    count: byPortfolio[p.id] ?? 0,
  }));

  return NextResponse.json({
    total_count: openTrades.length,
    portfolio_count: (portfolios ?? []).length,
    portfolios: portfolioSummary,
  });
}
```

- [ ] **Step 2: 브라우저 또는 curl로 동작 확인**

```bash
curl http://localhost:3000/api/v1/user-portfolio/summary
```

예상 응답:
```json
{
  "total_count": 8,
  "portfolio_count": 2,
  "portfolios": [
    { "id": 1, "name": "기본", "count": 5 },
    { "id": 2, "name": "공격형", "count": 3 }
  ]
}
```

- [ ] **Step 3: 커밋**

```bash
git add web/src/app/api/v1/user-portfolio/summary/route.ts
git commit -m "feat: add user-portfolio summary API endpoint"
```

---

## Chunk 2: 서버 전용 위젯 컴포넌트

### Task 2: DashboardRiskBanner

**Files:**
- Create: `web/src/components/dashboard/dashboard-risk-banner.tsx`

- [ ] **Step 1: 파일 생성**

```typescript
// web/src/components/dashboard/dashboard-risk-banner.tsx
import Link from "next/link";
import { Shield, AlertTriangle, XCircle, Skull } from "lucide-react";

interface Props {
  riskIndex: number;
}

function getRiskLevel(index: number): {
  label: string;
  color: string;
  bgColor: string;
  borderColor: string;
  Icon: React.ElementType;
} {
  if (index <= 25) return {
    label: "안전",
    color: "text-emerald-400",
    bgColor: "bg-emerald-900/20",
    borderColor: "border-emerald-800/50",
    Icon: Shield,
  };
  if (index <= 50) return {
    label: "주의",
    color: "text-yellow-400",
    bgColor: "bg-yellow-900/20",
    borderColor: "border-yellow-800/50",
    Icon: AlertTriangle,
  };
  if (index <= 75) return {
    label: "위험",
    color: "text-orange-400",
    bgColor: "bg-orange-900/20",
    borderColor: "border-orange-800/50",
    Icon: XCircle,
  };
  return {
    label: "극위험",
    color: "text-red-400",
    bgColor: "bg-red-900/20",
    borderColor: "border-red-800/50",
    Icon: Skull,
  };
}

export function DashboardRiskBanner({ riskIndex }: Props) {
  const risk = getRiskLevel(riskIndex);
  const { Icon } = risk;

  return (
    <Link
      href="/market"
      className={`block card p-4 border ${risk.bgColor} ${risk.borderColor} hover:brightness-110 transition-all cursor-pointer`}
    >
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Icon className={`w-6 h-6 ${risk.color}`} />
          <div>
            <div className="text-xs text-[var(--muted)]">투자 시황 위험도</div>
            <div className={`text-lg font-bold ${risk.color}`}>{risk.label}</div>
          </div>
        </div>
        <div className="text-right">
          <div className={`text-4xl font-bold ${risk.color}`}>{Math.round(riskIndex)}</div>
          <div className="text-xs text-[var(--muted)] mt-0.5">/ 100 · 상세 보기 →</div>
        </div>
      </div>
    </Link>
  );
}
```

- [ ] **Step 2: 커밋**

```bash
git add web/src/components/dashboard/dashboard-risk-banner.tsx
git commit -m "feat: add DashboardRiskBanner widget"
```

---

### Task 3: SignalSummaryCard

**Files:**
- Create: `web/src/components/dashboard/signal-summary-card.tsx`

- [ ] **Step 1: 파일 생성**

```typescript
// web/src/components/dashboard/signal-summary-card.tsx
import Link from "next/link";

const SOURCE_COLORS: Record<string, { card: string; text: string }> = {
  lassi: { card: "bg-red-900/30 border-red-800/50", text: "text-red-400" },
  stockbot: { card: "bg-green-900/30 border-green-800/50", text: "text-green-400" },
  quant: { card: "bg-blue-900/30 border-blue-800/50", text: "text-blue-400" },
};

const SOURCE_LABELS: Record<string, string> = {
  lassi: "라씨매매",
  stockbot: "스톡봇",
  quant: "퀀트",
};

interface Props {
  source: "lassi" | "stockbot" | "quant";
  buy: number;
  sell: number;
  total: number;
}

export function SignalSummaryCard({ source, buy, sell, total }: Props) {
  const colors = SOURCE_COLORS[source];

  return (
    <Link
      href={`/signals?source=${source}`}
      className={`card p-4 border ${colors.card} hover:brightness-110 transition-all cursor-pointer`}
    >
      <div className={`text-sm font-medium mb-2 ${colors.text}`}>
        {SOURCE_LABELS[source]}
      </div>
      <div className={`text-3xl font-bold ${colors.text}`}>{total}</div>
      <div className="text-sm mt-1 text-[var(--muted)]">
        매수 {buy} / 매도 {sell}
      </div>
      <div className="text-xs text-[var(--muted)] mt-2">신호 보기 →</div>
    </Link>
  );
}
```

- [ ] **Step 2: 커밋**

```bash
git add web/src/components/dashboard/signal-summary-card.tsx
git commit -m "feat: add SignalSummaryCard widget"
```

---

### Task 4: MarketSummaryCard

**Files:**
- Create: `web/src/components/dashboard/market-summary-card.tsx`

- [ ] **Step 1: 파일 생성**

```typescript
// web/src/components/dashboard/market-summary-card.tsx
import Link from "next/link";
import { TrendingUp, Calendar } from "lucide-react";
import { getScoreInterpretation } from "@/types/market";

interface MarketEvent {
  id: number;
  title: string;
  event_date: string;
}

interface Props {
  marketScore: number;
  eventRiskScore: number;
  nextEvent: MarketEvent | null;
}

function dDayLabel(dateStr: string): string {
  const kstNow = new Date(Date.now() + 9 * 60 * 60 * 1000);
  const todayStr = kstNow.toISOString().slice(0, 10);
  const diff = Math.round(
    (new Date(dateStr).getTime() - new Date(todayStr).getTime()) /
      (1000 * 60 * 60 * 24)
  );
  if (diff === 0) return "오늘";
  if (diff === 1) return "내일";
  return `D-${diff}`;
}

export function MarketSummaryCard({ marketScore, eventRiskScore, nextEvent }: Props) {
  const mInterp = getScoreInterpretation(marketScore);
  const eInterp = getScoreInterpretation(eventRiskScore);

  return (
    <Link
      href="/market"
      className="card p-4 hover:border-[var(--accent)] transition-colors cursor-pointer"
    >
      <div className="flex items-center gap-1.5 mb-3">
        <TrendingUp className="w-4 h-4 text-[var(--muted)]" />
        <span className="text-sm font-semibold">투자 시황</span>
      </div>

      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <span className="text-xs text-[var(--muted)]">마켓</span>
          <span className="text-sm font-bold" style={{ color: mInterp.color }}>
            {Math.round(marketScore)} · {mInterp.label}
          </span>
        </div>
        <div className="flex items-center justify-between">
          <span className="text-xs text-[var(--muted)]">이벤트</span>
          <span className="text-sm font-bold" style={{ color: eInterp.color }}>
            {Math.round(eventRiskScore)} · {eInterp.label}
          </span>
        </div>
      </div>

      {nextEvent && (
        <div className="mt-3 pt-3 border-t border-[var(--border)]">
          <div className="flex items-center gap-1.5">
            <Calendar className="w-3.5 h-3.5 text-[var(--muted)]" />
            <span className="text-xs text-[var(--muted)] truncate flex-1">
              {nextEvent.title}
            </span>
            <span className="text-xs text-[var(--accent-light)] shrink-0">
              {dDayLabel(nextEvent.event_date)}
            </span>
          </div>
        </div>
      )}

      <div className="text-xs text-[var(--muted)] mt-3">상세 보기 →</div>
    </Link>
  );
}
```

- [ ] **Step 2: 커밋**

```bash
git add web/src/components/dashboard/market-summary-card.tsx
git commit -m "feat: add MarketSummaryCard widget"
```

---

### Task 5: InvestmentSummaryCard

**Files:**
- Create: `web/src/components/dashboard/investment-summary-card.tsx`

- [ ] **Step 1: 파일 생성**

```typescript
// web/src/components/dashboard/investment-summary-card.tsx
import Link from "next/link";
import { Briefcase } from "lucide-react";

interface Props {
  count: number;
}

export function InvestmentSummaryCard({ count }: Props) {
  return (
    <Link
      href="/investment"
      className="card p-4 hover:border-[var(--accent)] transition-colors cursor-pointer"
    >
      <div className="flex items-center gap-1.5 mb-3">
        <Briefcase className="w-4 h-4 text-[var(--muted)]" />
        <span className="text-sm font-semibold">투자 현황</span>
      </div>
      <div className="text-3xl font-bold mt-1">{count}</div>
      <div className="text-sm text-[var(--muted)] mt-1">보유 종목</div>
      <div className="text-xs text-[var(--muted)] mt-3">관리 →</div>
    </Link>
  );
}
```

- [ ] **Step 2: 커밋**

```bash
git add web/src/components/dashboard/investment-summary-card.tsx
git commit -m "feat: add InvestmentSummaryCard widget"
```

---

### Task 6: SourcePortfolioCard

**Files:**
- Create: `web/src/components/dashboard/source-portfolio-card.tsx`

- [ ] **Step 1: 파일 생성**

```typescript
// web/src/components/dashboard/source-portfolio-card.tsx
import Link from "next/link";

const SOURCE_META: Record<string, { label: string; color: string; cardColor: string }> = {
  lassi: {
    label: "라씨매매",
    color: "text-red-400",
    cardColor: "bg-red-900/20 border-red-800/50",
  },
  stockbot: {
    label: "스톡봇",
    color: "text-green-400",
    cardColor: "bg-green-900/20 border-green-800/50",
  },
  quant: {
    label: "퀀트",
    color: "text-blue-400",
    cardColor: "bg-blue-900/20 border-blue-800/50",
  },
};

interface Props {
  source: "lassi" | "stockbot" | "quant";
  totalValue: number | null;
  holdingCount: number;
  returnPct: number | null;
}

export function SourcePortfolioCard({ source, totalValue, holdingCount, returnPct }: Props) {
  const meta = SOURCE_META[source];

  return (
    <Link
      href={`/portfolio/${source}`}
      className={`card p-4 border ${meta.cardColor} hover:brightness-110 transition-all cursor-pointer`}
    >
      <div className={`text-sm font-medium mb-2 ${meta.color}`}>{meta.label}</div>
      {returnPct !== null ? (
        <div className={`text-2xl font-bold ${returnPct >= 0 ? "text-red-400" : "text-blue-400"}`}>
          {returnPct >= 0 ? "+" : ""}{returnPct.toFixed(1)}%
        </div>
      ) : (
        <div className="text-2xl font-bold text-[var(--muted)]">-</div>
      )}
      <div className="text-sm text-[var(--muted)] mt-1">{holdingCount}종목 보유</div>
      <div className="text-xs text-[var(--muted)] mt-2">포트폴리오 →</div>
    </Link>
  );
}
```

- [ ] **Step 2: 커밋**

```bash
git add web/src/components/dashboard/source-portfolio-card.tsx
git commit -m "feat: add SourcePortfolioCard widget"
```

---

## Chunk 3: 클라이언트 위젯 컴포넌트

### Task 7: WatchlistWidget (관심종목, 클라이언트)

**Files:**
- Create: `web/src/components/dashboard/watchlist-widget.tsx`

- [ ] **Step 1: 파일 생성**

```typescript
// web/src/components/dashboard/watchlist-widget.tsx
"use client";

import Link from "next/link";
import { useMemo } from "react";
import { usePriceRefresh } from "@/hooks/use-price-refresh";
import { useStockModal } from "@/contexts/stock-modal-context";

interface FavoriteStock {
  symbol: string;
  name: string;
  current_price: number | null;
  price_change_pct: number | null;
}

interface Props {
  favorites: FavoriteStock[];
}

export function WatchlistWidget({ favorites }: Props) {
  const { openStockModal } = useStockModal();
  const symbols = useMemo(() => favorites.map((f) => f.symbol), [favorites]);
  const { prices } = usePriceRefresh(symbols);

  if (favorites.length === 0) {
    return (
      <div className="card p-4 flex flex-col items-center justify-center text-center min-h-[120px]">
        <p className="text-sm text-[var(--muted)]">즐겨찾기된 종목이 없습니다</p>
        <Link href="/stocks" className="text-xs text-[var(--accent-light)] hover:underline mt-1">
          종목 추가 →
        </Link>
      </div>
    );
  }

  return (
    <div className="card p-4">
      <div className="flex items-center justify-between mb-3">
        <h2 className="font-semibold text-sm">관심종목</h2>
        <Link href="/stocks" className="text-xs text-[var(--accent-light)] hover:underline">
          전체 →
        </Link>
      </div>
      <div className="space-y-2">
        {favorites.map((f) => {
          const live = prices[f.symbol];
          const price = live?.current_price ?? f.current_price;
          const pct = live?.price_change_pct ?? f.price_change_pct ?? 0;

          return (
            <button
              key={f.symbol}
              onClick={() => openStockModal(f.symbol, f.name)}
              className="w-full flex items-center justify-between p-2 rounded-lg hover:bg-[var(--card-hover)] transition-colors text-left"
            >
              <span className="text-sm font-medium truncate flex-1">{f.name}</span>
              <div className="text-right shrink-0 ml-2">
                <div className="text-sm font-bold">{price?.toLocaleString() ?? "-"}</div>
                <div className={`text-xs font-medium ${pct > 0 ? "price-up" : pct < 0 ? "price-down" : "price-flat"}`}>
                  {pct > 0 ? "+" : ""}{pct.toFixed(2)}%
                </div>
              </div>
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
git add web/src/components/dashboard/watchlist-widget.tsx
git commit -m "feat: add WatchlistWidget (client, real-time price)"
```

---

### Task 8: VirtualPortfolioSection (클라이언트)

**Files:**
- Create: `web/src/components/dashboard/virtual-portfolio-section.tsx`

- [ ] **Step 1: 파일 생성**

```typescript
// web/src/components/dashboard/virtual-portfolio-section.tsx
"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { BarChart3 } from "lucide-react";

interface PortfolioItem {
  id: number;
  name: string;
  count: number;
}

interface SummaryData {
  total_count: number;
  portfolio_count: number;
  portfolios: PortfolioItem[];
}

export function VirtualPortfolioSection() {
  const [data, setData] = useState<SummaryData | null>(null);

  useEffect(() => {
    fetch("/api/v1/user-portfolio/summary")
      .then((r) => r.json())
      .then((json) => setData(json))
      .catch(() => null);
  }, []);

  return (
    <Link
      href="/my-portfolio"
      className="card p-4 hover:border-[var(--accent)] transition-colors cursor-pointer"
    >
      <div className="flex items-center gap-1.5 mb-3">
        <BarChart3 className="w-4 h-4 text-[var(--muted)]" />
        <span className="text-sm font-semibold">가상 포트폴리오</span>
      </div>

      {data === null ? (
        <div className="text-[var(--muted)] text-sm">로딩 중...</div>
      ) : (
        <>
          <div className="text-3xl font-bold">{data.total_count}</div>
          <div className="text-sm text-[var(--muted)] mt-1">오픈 포지션</div>
          {data.portfolios.length > 0 && (
            <div className="mt-3 space-y-1">
              {data.portfolios.slice(0, 3).map((p) => (
                <div key={p.id} className="flex items-center justify-between text-xs text-[var(--muted)]">
                  <span className="truncate">{p.name}</span>
                  <span>{p.count}종목</span>
                </div>
              ))}
            </div>
          )}
        </>
      )}

      <div className="text-xs text-[var(--muted)] mt-3">관리 →</div>
    </Link>
  );
}
```

- [ ] **Step 2: 커밋**

```bash
git add web/src/components/dashboard/virtual-portfolio-section.tsx
git commit -m "feat: add VirtualPortfolioSection client widget"
```

---

## Chunk 4: 메인 페이지 재작성

### Task 9: page.tsx 전면 재작성

**Files:**
- Modify: `web/src/app/page.tsx`

- [ ] **Step 1: page.tsx 재작성**

```typescript
// web/src/app/page.tsx
import { createServiceClient } from "@/lib/supabase";
import { DashboardRiskBanner } from "@/components/dashboard/dashboard-risk-banner";
import { SignalSummaryCard } from "@/components/dashboard/signal-summary-card";
import { MarketSummaryCard } from "@/components/dashboard/market-summary-card";
import { WatchlistWidget } from "@/components/dashboard/watchlist-widget";
import { InvestmentSummaryCard } from "@/components/dashboard/investment-summary-card";
import { VirtualPortfolioSection } from "@/components/dashboard/virtual-portfolio-section";
import { SourcePortfolioCard } from "@/components/dashboard/source-portfolio-card";

export const revalidate = 60;

export default async function DashboardPage() {
  const supabase = createServiceClient();

  const kst = new Date(Date.now() + 9 * 60 * 60 * 1000);
  const today = kst.toISOString().slice(0, 10);
  const tomorrow = new Date(kst.getTime() + 24 * 60 * 60 * 1000)
    .toISOString()
    .slice(0, 10);

  const [
    { data: signals },
    { data: latestScore },
    { data: favorites },
    { count: watchlistCount },
    { data: nextEvent },
    { data: lassiSnap },
    { data: stockbotSnap },
    { data: quantSnap },
  ] = await Promise.all([
    supabase
      .from("signals")
      .select("source, signal_type")
      .gte("timestamp", `${today}T00:00:00+09:00`)
      .lt("timestamp", `${tomorrow}T00:00:00+09:00`),
    supabase
      .from("market_score_history")
      .select("total_score, event_risk_score, risk_index")
      .order("date", { ascending: false })
      .limit(1)
      .single(),
    supabase
      .from("stock_cache")
      .select("symbol, name, current_price, price_change_pct")
      .eq("is_favorite", true)
      .limit(5),
    supabase
      .from("watchlist")
      .select("id", { count: "exact", head: true }),
    supabase
      .from("market_events")
      .select("id, title, event_date")
      .gte("event_date", today)
      .order("event_date", { ascending: true })
      .limit(1)
      .single(),
    supabase
      .from("portfolio_snapshots")
      .select("total_value, holdings, cash")
      .eq("source", "lassi")
      .eq("execution_type", "lump")
      .order("date", { ascending: false })
      .limit(1)
      .single(),
    supabase
      .from("portfolio_snapshots")
      .select("total_value, holdings, cash")
      .eq("source", "stockbot")
      .eq("execution_type", "lump")
      .order("date", { ascending: false })
      .limit(1)
      .single(),
    supabase
      .from("portfolio_snapshots")
      .select("total_value, holdings, cash")
      .eq("source", "quant")
      .eq("execution_type", "lump")
      .order("date", { ascending: false })
      .limit(1)
      .single(),
  ]);

  // 신호 집계
  const counts: Record<string, { buy: number; sell: number; total: number }> = {
    lassi: { buy: 0, sell: 0, total: 0 },
    stockbot: { buy: 0, sell: 0, total: 0 },
    quant: { buy: 0, sell: 0, total: 0 },
  };
  for (const s of signals ?? []) {
    const src = s.source as string;
    if (!counts[src]) continue;
    counts[src].total++;
    if (["BUY", "BUY_FORECAST"].includes(s.signal_type)) counts[src].buy++;
    else if (["SELL", "SELL_COMPLETE"].includes(s.signal_type)) counts[src].sell++;
  }

  // 소스별 포트폴리오 수익률 계산 (스냅샷 기준)
  // PORTFOLIO_CONFIG.CASH_PER_STRATEGY = 5_000_000 (전략별 500만원, strategy-engine/index.ts:18)
  const BASE_CAPITAL = 5_000_000;
  function calcReturn(snap: { total_value: number; cash: number; holdings: unknown[] } | null) {
    if (!snap) return { returnPct: null, holdingCount: 0, totalValue: null };
    const returnPct = ((snap.total_value - BASE_CAPITAL) / BASE_CAPITAL) * 100;
    const holdingCount = Array.isArray(snap.holdings) ? snap.holdings.length : 0;
    return { returnPct, holdingCount, totalValue: snap.total_value };
  }

  const lassiData = calcReturn(lassiSnap as { total_value: number; cash: number; holdings: unknown[] } | null);
  const stockbotData = calcReturn(stockbotSnap as { total_value: number; cash: number; holdings: unknown[] } | null);
  const quantData = calcReturn(quantSnap as { total_value: number; cash: number; holdings: unknown[] } | null);

  const riskIndex = latestScore?.risk_index ?? 0;
  const marketScore = latestScore?.total_score ?? 50;
  const eventRiskScore = latestScore?.event_risk_score ?? 100;

  return (
    <div className="space-y-4">
      {/* 위험 경보 배너 */}
      <DashboardRiskBanner riskIndex={riskIndex} />

      {/* 신호 3카드 + 시황 카드 */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <SignalSummaryCard source="lassi" {...counts.lassi} />
        <SignalSummaryCard source="stockbot" {...counts.stockbot} />
        <SignalSummaryCard source="quant" {...counts.quant} />
        <MarketSummaryCard
          marketScore={marketScore}
          eventRiskScore={eventRiskScore}
          nextEvent={nextEvent ?? null}
        />
      </div>

      {/* 관심종목 + 투자현황 + 가상PF */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="lg:col-span-2">
          <WatchlistWidget favorites={favorites ?? []} />
        </div>
        <InvestmentSummaryCard count={watchlistCount ?? 0} />
        <VirtualPortfolioSection />
      </div>

      {/* 소스별 포트폴리오 */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <SourcePortfolioCard
          source="lassi"
          totalValue={lassiData.totalValue}
          holdingCount={lassiData.holdingCount}
          returnPct={lassiData.returnPct}
        />
        <SourcePortfolioCard
          source="stockbot"
          totalValue={stockbotData.totalValue}
          holdingCount={stockbotData.holdingCount}
          returnPct={stockbotData.returnPct}
        />
        <SourcePortfolioCard
          source="quant"
          totalValue={quantData.totalValue}
          holdingCount={quantData.holdingCount}
          returnPct={quantData.returnPct}
        />
      </div>
    </div>
  );
}
```

- [ ] **Step 2: 개발 서버에서 동작 확인**

```bash
cd web && npm run dev
```

브라우저에서 `http://localhost:3000` 접속 후 확인:
- 위험 경보 배너 표시 → 클릭 시 `/market` 이동
- 신호 3카드 (라씨/스톡봇/퀀트) → 클릭 시 `/signals?source=...` 이동
- 투자 시황 카드 → 클릭 시 `/market` 이동
- 관심종목 위젯 → 실시간 가격 표시, 종목 클릭 시 모달 오픈
- 투자 현황 카드 → 종목 수 표시, 클릭 시 `/investment` 이동
- 가상 포트폴리오 카드 → 포지션 수 표시, 클릭 시 `/my-portfolio` 이동
- 소스별 포트폴리오 3카드 → 각 클릭 시 `/portfolio/lassi` 등 이동
- 모바일(375px)에서 단일 열, md(768px)에서 2열, lg(1024px)에서 4열

- [ ] **Step 3: 커밋**

```bash
git add web/src/app/page.tsx
git commit -m "feat: rebuild dashboard as hub with grid widgets"
```

---

## Chunk 5: 마무리

### Task 10: 기존 파일 정리

**Files:**
- Modify: `web/src/components/dashboard/dashboard-prices.tsx` (기존 파일 — page.tsx에서 더 이상 import하지 않으므로 유지, 삭제하지 않음)

- [ ] **Step 1: 불필요한 import가 남아있지 않은지 확인**

```bash
grep -r "DashboardPrices\|EventSummaryCard" web/src/app/page.tsx
```

예상 출력: (없음)

- [ ] **Step 2: TypeScript 빌드 오류 확인**

```bash
cd web && npx tsc --noEmit
```

예상 출력: 오류 없음

- [ ] **Step 3: 최종 커밋**

```bash
git add -p
git commit -m "feat: dashboard hub redesign complete"
```
