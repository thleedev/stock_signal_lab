# 사용자 모의투자 포트폴리오 시뮬레이터 구현 계획

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** AI 신호를 참고하여 사용자가 직접 가상 매수/매도하고, 포트별 수익률을 추적하는 모의투자 시뮬레이터 구축

**Architecture:** Supabase DB 3개 테이블(user_portfolios, user_trades, user_portfolio_snapshots) + Next.js API 라우트 4개 + 포트종목 페이지(/my-portfolio) + 기존 종목상세 차트 확장. 기존 stock_cache/signals 테이블 재사용.

**Tech Stack:** Next.js App Router, Supabase (PostgreSQL), lightweight-charts, TypeScript, Tailwind CSS

**Spec:** `docs/superpowers/specs/2026-03-12-user-portfolio-simulator-design.md`

---

## File Structure

### 새로 생성할 파일

```
supabase/migrations/
└── 028_user_portfolios.sql                    # DB 테이블 3개 + RLS + 인덱스

web/src/app/api/v1/user-portfolio/
├── route.ts                                    # 포트 CRUD (GET/POST/PATCH/DELETE)
├── trades/route.ts                             # 거래 기록 (GET/POST)
├── holdings/route.ts                           # 보유 현황 + 현재가 + 수익률
└── performance/route.ts                        # 포트 성과 시계열 + 벤치마크

web/src/app/my-portfolio/
├── page.tsx                                    # 포트종목 메인 페이지 (서버 컴포넌트)
└── components/
    ├── portfolio-tabs.tsx                      # 탭 바 (고정 "전체" + 동적 탭 + "+" 버튼)
    ├── portfolio-summary.tsx                   # 포트 요약 카드 (수익률, 보유 수, 거래 수)
    ├── holdings-table.tsx                      # 보유 종목 테이블 + 상태 배지 + 매도 버튼
    ├── trade-modal.tsx                         # 매수/매도 모달 (종목검색, 가격, 포트선택, 메모)
    ├── price-slider-input.tsx                  # 슬라이더 + % 프리셋 버튼 가격 입력
    ├── portfolio-selector.tsx                  # 포트 선택 칩 (pill)
    └── performance-chart.tsx                   # 포트 성과 비교 라인 차트 + 벤치마크
```

### 수정할 파일

```
web/src/components/charts/candle-chart.tsx      # portfolioOverlays? optional prop 추가
web/src/components/stock/stock-price-header.tsx  # "매수" 버튼 추가
web/src/app/stock/[symbol]/page.tsx              # 포트 체크박스 + 오버레이 데이터 전달
web/src/app/api/v1/cron/daily-prices/route.ts   # 스냅샷 생성 로직 추가 (또는 별도 cron)
```

---

## Chunk 1: DB 마이그레이션 + 포트 CRUD API

### Task 1: DB 마이그레이션 작성

**Files:**
- Create: `supabase/migrations/028_user_portfolios.sql`

- [ ] **Step 1: 마이그레이션 파일 작성**

```sql
-- 028_user_portfolios.sql
-- 사용자 모의투자 포트폴리오 시뮬레이터

-- 1. 포트(탭) 관리
CREATE TABLE IF NOT EXISTS user_portfolios (
  id          BIGSERIAL PRIMARY KEY,
  name        TEXT NOT NULL,
  sort_order  INT NOT NULL DEFAULT 0,
  is_default  BOOLEAN DEFAULT FALSE,
  deleted_at  TIMESTAMPTZ,
  created_at  TIMESTAMPTZ DEFAULT now(),
  UNIQUE(name)
);

ALTER TABLE user_portfolios ENABLE ROW LEVEL SECURITY;
CREATE POLICY "all_access" ON user_portfolios FOR ALL USING (true);

-- 기본 "전체" 포트 생성
INSERT INTO user_portfolios (name, sort_order, is_default)
VALUES ('전체', 0, TRUE)
ON CONFLICT (name) DO NOTHING;

-- 2. 매수/매도 거래 기록
CREATE TABLE IF NOT EXISTS user_trades (
  id            BIGSERIAL PRIMARY KEY,
  portfolio_id  BIGINT REFERENCES user_portfolios(id),
  symbol        TEXT NOT NULL,
  name          TEXT,
  side          TEXT NOT NULL CHECK (side IN ('BUY', 'SELL')),
  price         NUMERIC NOT NULL,
  target_price  NUMERIC,
  stop_price    NUMERIC,
  buy_trade_id  BIGINT REFERENCES user_trades(id),
  note          TEXT,
  created_at    TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE user_trades ENABLE ROW LEVEL SECURITY;
CREATE POLICY "all_access" ON user_trades FOR ALL USING (true);

CREATE INDEX idx_user_trades_portfolio_symbol ON user_trades(portfolio_id, symbol);
CREATE INDEX idx_user_trades_symbol ON user_trades(symbol);
CREATE INDEX idx_user_trades_buy_id ON user_trades(buy_trade_id);

-- 3. 일별 포트 수익률 스냅샷
CREATE TABLE IF NOT EXISTS user_portfolio_snapshots (
  id                    BIGSERIAL PRIMARY KEY,
  portfolio_id          BIGINT REFERENCES user_portfolios(id),
  date                  DATE NOT NULL,
  daily_return_pct      NUMERIC,
  cumulative_return_pct NUMERIC,
  holding_count         INT,
  trade_count           INT,
  created_at            TIMESTAMPTZ DEFAULT now(),
  UNIQUE(portfolio_id, date)
);

ALTER TABLE user_portfolio_snapshots ENABLE ROW LEVEL SECURITY;
CREATE POLICY "all_access" ON user_portfolio_snapshots FOR ALL USING (true);

CREATE INDEX idx_user_snapshots_date ON user_portfolio_snapshots(portfolio_id, date DESC);
```

- [ ] **Step 2: 마이그레이션 적용**

Run: `cd /Users/thlee/GoogleDrive/DashboardStock && npx supabase db push`
또는 로컬: `npx supabase migration up`

- [ ] **Step 3: 커밋**

```bash
git add supabase/migrations/028_user_portfolios.sql
git commit -m "feat: 사용자 모의투자 포트폴리오 DB 마이그레이션 추가"
```

---

### Task 2: 포트 CRUD API

**Files:**
- Create: `web/src/app/api/v1/user-portfolio/route.ts`

- [ ] **Step 1: GET — 전체 포트 목록 조회**

```typescript
import { NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase";

export const dynamic = "force-dynamic";

export async function GET() {
  const supabase = createServiceClient();
  const { data, error } = await supabase
    .from("user_portfolios")
    .select("*")
    .is("deleted_at", null)
    .order("sort_order", { ascending: true });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ portfolios: data });
}
```

- [ ] **Step 2: POST — 새 포트 생성**

```typescript
export async function POST(request: Request) {
  const supabase = createServiceClient();
  const body = await request.json();
  const { name } = body;

  if (!name || typeof name !== "string" || name.trim().length === 0) {
    return NextResponse.json({ error: "포트 이름이 필요합니다" }, { status: 400 });
  }

  // 소프트 삭제된 동일 이름 포트가 있으면 복원
  const { data: existing } = await supabase
    .from("user_portfolios")
    .select("id, deleted_at")
    .eq("name", name.trim())
    .single();

  if (existing && existing.deleted_at) {
    const { data, error } = await supabase
      .from("user_portfolios")
      .update({ deleted_at: null })
      .eq("id", existing.id)
      .select()
      .single();
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ portfolio: data, restored: true });
  }

  // 새 포트 생성 — sort_order는 현재 최대값 + 1
  const { data: maxOrder } = await supabase
    .from("user_portfolios")
    .select("sort_order")
    .is("deleted_at", null)
    .order("sort_order", { ascending: false })
    .limit(1)
    .single();

  const nextOrder = (maxOrder?.sort_order ?? 0) + 1;

  const { data, error } = await supabase
    .from("user_portfolios")
    .insert({ name: name.trim(), sort_order: nextOrder })
    .select()
    .single();

  if (error) {
    if (error.code === "23505") {
      return NextResponse.json({ error: "이미 존재하는 포트 이름입니다" }, { status: 409 });
    }
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ portfolio: data }, { status: 201 });
}
```

- [ ] **Step 3: PATCH — 포트 이름/순서 수정**

```typescript
export async function PATCH(request: Request) {
  const supabase = createServiceClient();
  const body = await request.json();
  const { id, name, sort_order } = body;

  if (!id) {
    return NextResponse.json({ error: "포트 ID가 필요합니다" }, { status: 400 });
  }

  const updates: Record<string, unknown> = {};
  if (name !== undefined) updates.name = name.trim();
  if (sort_order !== undefined) updates.sort_order = sort_order;

  if (Object.keys(updates).length === 0) {
    return NextResponse.json({ error: "수정할 항목이 없습니다" }, { status: 400 });
  }

  const { data, error } = await supabase
    .from("user_portfolios")
    .update(updates)
    .eq("id", id)
    .is("deleted_at", null)
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!data) return NextResponse.json({ error: "포트를 찾을 수 없습니다" }, { status: 404 });
  return NextResponse.json({ portfolio: data });
}
```

- [ ] **Step 4: DELETE — 포트 소프트 삭제**

```typescript
export async function DELETE(request: Request) {
  const supabase = createServiceClient();
  const { searchParams } = new URL(request.url);
  const id = searchParams.get("id");

  if (!id) {
    return NextResponse.json({ error: "포트 ID가 필요합니다" }, { status: 400 });
  }

  // 기본 포트(전체)는 삭제 불가
  const { data: portfolio } = await supabase
    .from("user_portfolios")
    .select("is_default")
    .eq("id", id)
    .single();

  if (portfolio?.is_default) {
    return NextResponse.json({ error: "기본 포트는 삭제할 수 없습니다" }, { status: 403 });
  }

  const { error } = await supabase
    .from("user_portfolios")
    .update({ deleted_at: new Date().toISOString() })
    .eq("id", id);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ success: true });
}
```

- [ ] **Step 5: 브라우저에서 API 테스트**

Run: `curl http://localhost:3000/api/v1/user-portfolio`
Expected: `{ "portfolios": [{ "id": 1, "name": "전체", "is_default": true, ... }] }`

- [ ] **Step 6: 커밋**

```bash
git add web/src/app/api/v1/user-portfolio/route.ts
git commit -m "feat: 포트 CRUD API (GET/POST/PATCH/DELETE)"
```

---

### Task 3: 거래 기록 API

**Files:**
- Create: `web/src/app/api/v1/user-portfolio/trades/route.ts`

- [ ] **Step 1: GET — 거래 이력 조회**

```typescript
import { NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const supabase = createServiceClient();
  const { searchParams } = new URL(request.url);
  const portfolioId = searchParams.get("portfolio_id");
  const symbol = searchParams.get("symbol");

  let query = supabase
    .from("user_trades")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(100);

  if (portfolioId) query = query.eq("portfolio_id", portfolioId);
  if (symbol) query = query.eq("symbol", symbol);

  const { data, error } = await query;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ trades: data });
}
```

- [ ] **Step 2: POST — 매수/매도 기록**

```typescript
export async function POST(request: Request) {
  const supabase = createServiceClient();
  const body = await request.json();
  const { portfolio_id, symbol, name, side, price, target_price, stop_price, buy_trade_id, note } = body;

  // 필수 필드 검증
  if (!portfolio_id || !symbol || !side || !price) {
    return NextResponse.json(
      { error: "portfolio_id, symbol, side, price는 필수입니다" },
      { status: 400 }
    );
  }

  if (!["BUY", "SELL"].includes(side)) {
    return NextResponse.json({ error: "side는 BUY 또는 SELL이어야 합니다" }, { status: 400 });
  }

  // SELL인 경우: buy_trade_id 필수 + 미청산 BUY 확인
  if (side === "SELL") {
    if (!buy_trade_id) {
      return NextResponse.json(
        { error: "매도 시 buy_trade_id가 필요합니다" },
        { status: 400 }
      );
    }

    // 해당 BUY가 존재하고 미청산인지 확인
    const { data: buyTrade } = await supabase
      .from("user_trades")
      .select("id, portfolio_id, symbol")
      .eq("id", buy_trade_id)
      .eq("side", "BUY")
      .single();

    if (!buyTrade) {
      return NextResponse.json({ error: "유효하지 않은 매수 거래입니다" }, { status: 400 });
    }

    // 이미 매도된 BUY인지 확인
    const { data: existingSell } = await supabase
      .from("user_trades")
      .select("id")
      .eq("buy_trade_id", buy_trade_id)
      .eq("side", "SELL")
      .single();

    if (existingSell) {
      return NextResponse.json({ error: "이미 매도 완료된 거래입니다" }, { status: 409 });
    }
  }

  const insertData: Record<string, unknown> = {
    portfolio_id,
    symbol,
    name,
    side,
    price,
  };
  if (side === "BUY") {
    if (target_price) insertData.target_price = target_price;
    if (stop_price) insertData.stop_price = stop_price;
  }
  if (side === "SELL") {
    insertData.buy_trade_id = buy_trade_id;
  }
  if (note) insertData.note = note;

  const { data, error } = await supabase
    .from("user_trades")
    .insert(insertData)
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ trade: data }, { status: 201 });
}
```

- [ ] **Step 3: 커밋**

```bash
git add web/src/app/api/v1/user-portfolio/trades/route.ts
git commit -m "feat: 거래 기록 API (GET/POST) — BUY/SELL 1:1 매칭"
```

---

### Task 4: 보유 현황 API

**Files:**
- Create: `web/src/app/api/v1/user-portfolio/holdings/route.ts`

- [ ] **Step 1: Holdings API 작성**

이 API는 미청산 BUY를 조회하고, stock_cache에서 현재가를 가져와 수익률을 계산한다.

```typescript
import { NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase";

export const dynamic = "force-dynamic";

interface HoldingRow {
  id: number;
  portfolio_id: number;
  symbol: string;
  name: string;
  price: number;
  target_price: number | null;
  stop_price: number | null;
  note: string | null;
  created_at: string;
}

function getStatus(
  currentPrice: number,
  buyPrice: number,
  targetPrice: number | null,
  stopPrice: number | null
): string {
  if (targetPrice && currentPrice >= targetPrice * 0.97) return "near_target";
  if (stopPrice && currentPrice <= stopPrice * 1.03) return "near_stop";
  return "holding";
}

export async function GET(request: Request) {
  const supabase = createServiceClient();
  const { searchParams } = new URL(request.url);
  const portfolioId = searchParams.get("portfolio_id");

  // 1. 미청산 BUY 조회 (SELL이 연결되지 않은 BUY)
  let buyQuery = supabase
    .from("user_trades")
    .select("id, portfolio_id, symbol, name, price, target_price, stop_price, note, created_at")
    .eq("side", "BUY");

  if (portfolioId) {
    buyQuery = buyQuery.eq("portfolio_id", portfolioId);
  }

  const { data: allBuys, error: buyError } = await buyQuery;
  if (buyError) return NextResponse.json({ error: buyError.message }, { status: 500 });

  // 매도된 BUY ID 목록
  const { data: sells } = await supabase
    .from("user_trades")
    .select("buy_trade_id")
    .eq("side", "SELL")
    .not("buy_trade_id", "is", null);

  const soldBuyIds = new Set((sells ?? []).map((s: { buy_trade_id: number }) => s.buy_trade_id));
  const openBuys = (allBuys ?? []).filter((b: HoldingRow) => !soldBuyIds.has(b.id));

  if (openBuys.length === 0) {
    return NextResponse.json({
      holdings: [],
      summary: { total_return_pct: 0, holding_count: 0, completed_trade_count: soldBuyIds.size },
    });
  }

  // 2. 현재가 조회 (stock_cache → daily_prices 폴백)
  const symbols = [...new Set(openBuys.map((b: HoldingRow) => b.symbol))];
  const { data: cacheData } = await supabase
    .from("stock_cache")
    .select("symbol, current_price, updated_at")
    .in("symbol", symbols);

  const priceMap = new Map<string, { price: number; asOf: string }>();
  for (const c of cacheData ?? []) {
    if (c.current_price) {
      priceMap.set(c.symbol, { price: Number(c.current_price), asOf: c.updated_at });
    }
  }

  // stock_cache에 없는 종목은 daily_prices에서 최신 종가 조회
  const missingSymbols = symbols.filter((s: string) => !priceMap.has(s));
  if (missingSymbols.length > 0) {
    const { data: dpData } = await supabase
      .from("daily_prices")
      .select("symbol, close, date")
      .in("symbol", missingSymbols)
      .order("date", { ascending: false })
      .limit(missingSymbols.length * 30);

    const seen = new Set<string>();
    for (const dp of dpData ?? []) {
      if (!seen.has(dp.symbol)) {
        priceMap.set(dp.symbol, { price: Number(dp.close), asOf: dp.date });
        seen.add(dp.symbol);
      }
    }
  }

  // 3. AI 신호 조회 (보유 종목의 최신 신호)
  const { data: signalsData } = await supabase
    .from("signals")
    .select("symbol, signal_type, source, timestamp")
    .in("symbol", symbols)
    .order("timestamp", { ascending: false })
    .limit(symbols.length * 3);

  const signalMap = new Map<string, { type: string; source: string; date: string }>();
  for (const sig of signalsData ?? []) {
    if (!signalMap.has(sig.symbol)) {
      signalMap.set(sig.symbol, {
        type: sig.signal_type,
        source: sig.source,
        date: sig.timestamp?.split("T")[0] ?? "",
      });
    }
  }

  // 4. 수익률 계산 및 응답 구성
  const holdings = openBuys.map((buy: HoldingRow) => {
    const current = priceMap.get(buy.symbol);
    const currentPrice = current?.price ?? buy.price;
    const returnPct = ((currentPrice - buy.price) / buy.price) * 100;
    const signal = signalMap.get(buy.symbol);

    return {
      trade_id: buy.id,
      portfolio_id: buy.portfolio_id,
      symbol: buy.symbol,
      name: buy.name,
      buy_price: buy.price,
      current_price: currentPrice,
      return_pct: Math.round(returnPct * 100) / 100,
      target_price: buy.target_price,
      stop_price: buy.stop_price,
      status: getStatus(currentPrice, buy.price, buy.target_price, buy.stop_price),
      note: buy.note,
      bought_at: buy.created_at,
      price_as_of: current?.asOf ?? null,
      latest_signal: signal ?? null,
    };
  });

  const returnPcts = holdings.map((h: { return_pct: number }) => h.return_pct);
  const totalReturnPct =
    returnPcts.length > 0
      ? Math.round((returnPcts.reduce((a: number, b: number) => a + b, 0) / returnPcts.length) * 100) / 100
      : 0;

  return NextResponse.json({
    holdings,
    summary: {
      total_return_pct: totalReturnPct,
      holding_count: holdings.length,
      completed_trade_count: soldBuyIds.size,
    },
  });
}
```

- [ ] **Step 2: 커밋**

```bash
git add web/src/app/api/v1/user-portfolio/holdings/route.ts
git commit -m "feat: 보유 현황 API — 현재가 조회 + 수익률 계산 + AI 신호 연동"
```

---

### Task 5: 포트 성과 API

**Files:**
- Create: `web/src/app/api/v1/user-portfolio/performance/route.ts`

- [ ] **Step 1: Performance API 작성**

```typescript
import { NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const supabase = createServiceClient();
  const { searchParams } = new URL(request.url);
  const portfolioId = searchParams.get("portfolio_id");
  const days = parseInt(searchParams.get("days") ?? "30", 10);

  const startDate = new Date();
  startDate.setDate(startDate.getDate() - days);
  const startDateStr = startDate.toISOString().split("T")[0];

  // 포트별 스냅샷 조회
  let query = supabase
    .from("user_portfolio_snapshots")
    .select("portfolio_id, date, daily_return_pct, cumulative_return_pct, holding_count, trade_count")
    .gte("date", startDateStr)
    .order("date", { ascending: true });

  if (portfolioId) {
    query = query.eq("portfolio_id", portfolioId);
  }

  const { data: snapshots, error } = await query;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // 포트별로 그룹핑
  const grouped: Record<string, typeof snapshots> = {};
  for (const snap of snapshots ?? []) {
    const key = String(snap.portfolio_id);
    if (!grouped[key]) grouped[key] = [];
    grouped[key].push(snap);
  }

  // 벤치마크: 코스피(KOSPI) 인덱스 데이터 (daily_prices에서 조회)
  const { data: kospiData } = await supabase
    .from("daily_prices")
    .select("date, close")
    .eq("symbol", "KOSPI")
    .gte("date", startDateStr)
    .order("date", { ascending: true });

  let benchmark = null;
  if (kospiData && kospiData.length > 0) {
    const basePrice = Number(kospiData[0].close);
    benchmark = kospiData.map((d) => ({
      date: d.date,
      return_pct: Math.round(((Number(d.close) - basePrice) / basePrice) * 100 * 100) / 100,
    }));
  }

  return NextResponse.json({
    portfolios: grouped,
    benchmark,
    period_days: days,
  });
}
```

- [ ] **Step 2: 커밋**

```bash
git add web/src/app/api/v1/user-portfolio/performance/route.ts
git commit -m "feat: 포트 성과 API — 스냅샷 시계열 + 벤치마크"
```

---

### Task 5.5: 종목 검색 API

**Files:**
- Create: `web/src/app/api/v1/user-portfolio/search/route.ts`

- [ ] **Step 1: 종목 검색 API 작성**

`stock_cache` 테이블에서 종목명 또는 종목코드로 검색:

```typescript
import { NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const supabase = createServiceClient();
  const { searchParams } = new URL(request.url);
  const q = searchParams.get("q");

  if (!q || q.length < 2) {
    return NextResponse.json({ stocks: [] });
  }

  // 종목코드 또는 종목명으로 검색
  const { data, error } = await supabase
    .from("stock_cache")
    .select("symbol, name, current_price")
    .or(`symbol.ilike.%${q}%,name.ilike.%${q}%`)
    .limit(10);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ stocks: data ?? [] });
}
```

- [ ] **Step 2: 커밋**

```bash
git add web/src/app/api/v1/user-portfolio/search/route.ts
git commit -m "feat: 종목 검색 API — stock_cache에서 이름/코드 검색"
```

---

## Chunk 2: 포트종목 페이지 UI 컴포넌트

### Task 6: 슬라이더 + % 버튼 가격 입력 컴포넌트

**Files:**
- Create: `web/src/app/my-portfolio/components/price-slider-input.tsx`

- [ ] **Step 1: PriceSliderInput 컴포넌트 작성**

Props:
- `basePrice: number` — 기준가 (현재가)
- `value: number` — 현재 입력된 가격
- `onChange: (price: number) => void`
- `presets: number[]` — % 프리셋 배열 (예: [-10, -5, 0, 5, 10])
- `sliderRange: [number, number]` — 슬라이더 최소/최대 % (예: [-20, 30])
- `label: string` — "매수가", "목표가", "손절가"
- `color: string` — 테마 색상 ("red", "blue", "green")

동작:
- 슬라이더 드래그 → % 기반으로 가격 계산 → onChange 호출
- % 프리셋 버튼 클릭 → 즉시 해당 % 적용
- 가격 숫자 직접 입력도 가능
- 현재 선택된 %를 가격 옆에 표시 (+10.0% 등)

```typescript
"use client";

import { useState, useCallback } from "react";

interface Props {
  basePrice: number;
  value: number;
  onChange: (price: number) => void;
  presets: number[];
  sliderRange: [number, number];
  label: string;
  color?: "red" | "blue" | "green";
  optional?: boolean;
}

export function PriceSliderInput({
  basePrice,
  value,
  onChange,
  presets,
  sliderRange,
  label,
  color = "green",
  optional = false,
}: Props) {
  const pctFromBase = basePrice > 0 ? ((value - basePrice) / basePrice) * 100 : 0;

  const colorMap = {
    red: { bg: "bg-red-50", border: "border-red-200", text: "text-red-600", slider: "accent-red-500" },
    blue: { bg: "bg-blue-50", border: "border-blue-200", text: "text-blue-600", slider: "accent-blue-500" },
    green: { bg: "bg-green-50", border: "border-green-200", text: "text-green-600", slider: "accent-green-500" },
  };
  const c = colorMap[color];

  const handleSlider = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const pct = parseFloat(e.target.value);
      onChange(Math.round(basePrice * (1 + pct / 100)));
    },
    [basePrice, onChange]
  );

  const handlePreset = useCallback(
    (pct: number) => {
      if (pct === 0) {
        onChange(basePrice);
      } else {
        onChange(Math.round(basePrice * (1 + pct / 100)));
      }
    },
    [basePrice, onChange]
  );

  const handleDirectInput = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const raw = e.target.value.replace(/[^0-9]/g, "");
      if (raw) onChange(parseInt(raw, 10));
    },
    [onChange]
  );

  const formatPrice = (p: number) => p.toLocaleString("ko-KR");

  return (
    <div className="mb-3">
      <div className="flex justify-between items-center mb-1">
        <span className="text-xs text-gray-400">
          {label} {optional && <span className="text-gray-300">(선택)</span>}
        </span>
        <span className={`text-xs ${c.text}`}>
          {pctFromBase >= 0 ? "+" : ""}{pctFromBase.toFixed(1)}%
        </span>
      </div>

      {/* 가격 표시/입력 */}
      <input
        type="text"
        value={formatPrice(value)}
        onChange={handleDirectInput}
        className={`w-full text-center text-lg font-bold border ${c.border} rounded-lg p-2 mb-2`}
      />

      {/* 슬라이더 */}
      <input
        type="range"
        min={sliderRange[0]}
        max={sliderRange[1]}
        step={0.5}
        value={pctFromBase}
        onChange={handleSlider}
        className={`w-full mb-2 ${c.slider}`}
      />

      {/* % 프리셋 버튼 */}
      <div className="flex gap-1 justify-center">
        {presets.map((pct) => {
          const isActive = Math.abs(pctFromBase - pct) < 0.5;
          const label = pct === 0 ? "현재가" : `${pct > 0 ? "+" : ""}${pct}%`;
          return (
            <button
              key={pct}
              onClick={() => handlePreset(pct)}
              className={`px-2 py-1 rounded text-xs ${
                isActive
                  ? `${c.bg} ${c.text} font-bold border ${c.border}`
                  : "bg-gray-100 text-gray-500 hover:bg-gray-200"
              }`}
            >
              {label}
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
git add web/src/app/my-portfolio/components/price-slider-input.tsx
git commit -m "feat: 슬라이더 + % 프리셋 가격 입력 컴포넌트"
```

---

### Task 7: 포트 선택 칩 컴포넌트

**Files:**
- Create: `web/src/app/my-portfolio/components/portfolio-selector.tsx`

- [ ] **Step 1: PortfolioSelector 컴포넌트 작성**

```typescript
"use client";

interface Portfolio {
  id: number;
  name: string;
  is_default: boolean;
}

interface Props {
  portfolios: Portfolio[];
  selectedId: number | null;
  onChange: (id: number) => void;
}

const COLORS = [
  "bg-red-500",
  "bg-violet-500",
  "bg-amber-500",
  "bg-emerald-500",
  "bg-sky-500",
  "bg-pink-500",
];

export function PortfolioSelector({ portfolios, selectedId, onChange }: Props) {
  // "전체" 포트는 선택지에서 제외 (매수는 개별 포트에만 가능)
  const selectablePortfolios = portfolios.filter((p) => !p.is_default);

  return (
    <div>
      <div className="text-xs text-gray-400 mb-1">포트 선택</div>
      <div className="flex gap-2 flex-wrap">
        {selectablePortfolios.map((p, i) => {
          const isSelected = p.id === selectedId;
          const colorClass = COLORS[i % COLORS.length];
          return (
            <button
              key={p.id}
              onClick={() => onChange(p.id)}
              className={`px-3 py-1 rounded-full text-xs transition-colors ${
                isSelected
                  ? `${colorClass} text-white`
                  : "bg-gray-100 text-gray-500 hover:bg-gray-200"
              }`}
            >
              {p.name}
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
git add web/src/app/my-portfolio/components/portfolio-selector.tsx
git commit -m "feat: 포트 선택 칩 컴포넌트"
```

---

### Task 8: 매수/매도 모달

**Files:**
- Create: `web/src/app/my-portfolio/components/trade-modal.tsx`

- [ ] **Step 1: TradeModal 컴포넌트 작성**

이 모달은 매수와 매도 모두 처리. `mode` prop으로 구분.

매수 모달 구성:
1. 종목 검색 (stock_cache에서 검색) — 종목상세에서 오면 자동 입력
2. 매수가 (PriceSliderInput, presets: [-10,-5,0,5,10])
3. 목표가 (PriceSliderInput, presets: [5,10,15,20,30], optional)
4. 손절가 (PriceSliderInput, presets: [-3,-5,-7,-10,-15], optional)
5. 포트 선택 (PortfolioSelector)
6. 매매 메모 (textarea, optional)
7. 매수 확인 버튼

매도 모달 구성:
1. 종목명 표시 (고정)
2. 매도가 (PriceSliderInput)
3. 매매 메모
4. 매도 확인 버튼

```typescript
"use client";

import { useState, useEffect } from "react";
import { PriceSliderInput } from "./price-slider-input";
import { PortfolioSelector } from "./portfolio-selector";

interface Portfolio {
  id: number;
  name: string;
  is_default: boolean;
}

interface Props {
  mode: "buy" | "sell";
  isOpen: boolean;
  onClose: () => void;
  onSubmit: () => void;
  // 매수 모드: 종목 자동 입력 (종목상세에서 열 때)
  initialSymbol?: string;
  initialName?: string;
  initialPrice?: number;
  // 매도 모드: 매수 거래 정보
  buyTradeId?: number;
  portfolios: Portfolio[];
}

export function TradeModal({
  mode,
  isOpen,
  onClose,
  onSubmit,
  initialSymbol,
  initialName,
  initialPrice,
  buyTradeId,
  portfolios,
}: Props) {
  const [symbol, setSymbol] = useState(initialSymbol ?? "");
  const [stockName, setStockName] = useState(initialName ?? "");
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<Array<{ symbol: string; name: string; current_price: number }>>([]);

  const [price, setPrice] = useState(initialPrice ?? 0);
  const [targetPrice, setTargetPrice] = useState(0);
  const [stopPrice, setStopPrice] = useState(0);
  const [selectedPortfolioId, setSelectedPortfolioId] = useState<number | null>(null);
  const [note, setNote] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  // 모달 열릴 때 상태 초기화
  useEffect(() => {
    if (!isOpen) return;
    // 매번 모달이 열릴 때 모든 상태를 초기화
    setNote("");
    setSearchQuery("");
    setSearchResults([]);
    setSelectedPortfolioId(null);

    if (initialPrice) {
      setPrice(initialPrice);
      setTargetPrice(Math.round(initialPrice * 1.10));
      setStopPrice(Math.round(initialPrice * 0.95));
    } else {
      setPrice(0);
      setTargetPrice(0);
      setStopPrice(0);
    }
    if (initialSymbol) {
      setSymbol(initialSymbol);
      setStockName(initialName ?? "");
    } else {
      setSymbol("");
      setStockName("");
    }
  }, [isOpen, initialPrice, initialSymbol, initialName]);

  // 종목 검색
  const handleSearch = async (query: string) => {
    setSearchQuery(query);
    if (query.length < 2) {
      setSearchResults([]);
      return;
    }
    try {
      // stock_cache에서 종목명/코드 검색
      const res = await fetch(`/api/v1/user-portfolio/search?q=${encodeURIComponent(query)}`);
      const data = await res.json();
      setSearchResults(data.stocks ?? []);
    } catch {
      setSearchResults([]);
    }
  };

  const selectStock = (stock: { symbol: string; name: string; current_price: number }) => {
    setSymbol(stock.symbol);
    setStockName(stock.name);
    setPrice(stock.current_price);
    setTargetPrice(Math.round(stock.current_price * 1.10));
    setStopPrice(Math.round(stock.current_price * 0.95));
    setSearchQuery("");
    setSearchResults([]);
  };

  const handleSubmit = async () => {
    if (isSubmitting) return;
    setIsSubmitting(true);

    try {
      const body: Record<string, unknown> = {
        portfolio_id: selectedPortfolioId,
        symbol,
        name: stockName,
        side: mode.toUpperCase(),
        price,
      };

      if (mode === "buy") {
        if (targetPrice > 0) body.target_price = targetPrice;
        if (stopPrice > 0) body.stop_price = stopPrice;
      }
      if (mode === "sell") {
        body.buy_trade_id = buyTradeId;
      }
      if (note.trim()) body.note = note.trim();

      const res = await fetch("/api/v1/user-portfolio/trades", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      if (!res.ok) {
        const err = await res.json();
        alert(err.error ?? "오류가 발생했습니다");
        return;
      }

      onSubmit();
      onClose();
    } finally {
      setIsSubmitting(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="bg-white rounded-xl shadow-xl w-full max-w-sm mx-4 max-h-[90vh] overflow-y-auto p-5">
        <div className="flex justify-between items-center mb-4">
          <h2 className="text-lg font-bold">
            {mode === "buy" ? "종목 매수" : "종목 매도"}
          </h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-xl">
            ✕
          </button>
        </div>

        {/* 종목 검색 (매수 모드 + 자동입력 없을 때) */}
        {mode === "buy" && !initialSymbol && (
          <div className="mb-4">
            <div className="text-xs text-gray-400 mb-1">종목 검색</div>
            <input
              type="text"
              value={symbol ? `${stockName} (${symbol})` : searchQuery}
              onChange={(e) => {
                if (symbol) {
                  setSymbol("");
                  setStockName("");
                }
                handleSearch(e.target.value);
              }}
              placeholder="종목명 또는 종목코드"
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm"
            />
            {searchResults.length > 0 && (
              <div className="border border-gray-200 rounded-lg mt-1 max-h-32 overflow-y-auto">
                {searchResults.slice(0, 5).map((stock) => (
                  <button
                    key={stock.symbol}
                    onClick={() => selectStock(stock)}
                    className="w-full text-left px-3 py-2 text-sm hover:bg-gray-50 border-b border-gray-100 last:border-0"
                  >
                    {stock.name} ({stock.symbol}) — {stock.current_price?.toLocaleString()}원
                  </button>
                ))}
              </div>
            )}
          </div>
        )}

        {/* 종목 표시 (자동입력 또는 매도) */}
        {(initialSymbol || mode === "sell") && (
          <div className="mb-4 px-3 py-2 bg-gray-50 rounded-lg text-sm">
            {stockName} ({symbol})
          </div>
        )}

        {/* 가격 입력 */}
        {price > 0 && (
          <>
            <PriceSliderInput
              basePrice={initialPrice ?? price}
              value={price}
              onChange={setPrice}
              presets={[-10, -5, 0, 5, 10]}
              sliderRange={[-15, 15]}
              label={mode === "buy" ? "매수가" : "매도가"}
              color="green"
            />

            {mode === "buy" && (
              <>
                <PriceSliderInput
                  basePrice={price}
                  value={targetPrice}
                  onChange={setTargetPrice}
                  presets={[5, 10, 15, 20, 30]}
                  sliderRange={[5, 30]}
                  label="목표가"
                  color="red"
                  optional
                />
                <PriceSliderInput
                  basePrice={price}
                  value={stopPrice}
                  onChange={setStopPrice}
                  presets={[-3, -5, -7, -10, -15]}
                  sliderRange={[-20, -3]}
                  label="손절가"
                  color="blue"
                  optional
                />
              </>
            )}
          </>
        )}

        {/* 포트 선택 (매수 모드) */}
        {mode === "buy" && (
          <div className="mb-3">
            <PortfolioSelector
              portfolios={portfolios}
              selectedId={selectedPortfolioId}
              onChange={setSelectedPortfolioId}
            />
          </div>
        )}

        {/* 매매 메모 */}
        <div className="mb-4">
          <div className="text-xs text-gray-400 mb-1">매매 메모 (선택)</div>
          <textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="매매 이유, AI 신호 참고 사항 등..."
            className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm h-16 resize-none"
          />
        </div>

        {/* 제출 버튼 */}
        <button
          onClick={handleSubmit}
          disabled={isSubmitting || !symbol || !price || (mode === "buy" && !selectedPortfolioId)}
          className={`w-full py-3 rounded-lg text-white font-semibold text-sm ${
            mode === "buy"
              ? "bg-red-500 hover:bg-red-600 disabled:bg-red-300"
              : "bg-blue-500 hover:bg-blue-600 disabled:bg-blue-300"
          }`}
        >
          {isSubmitting ? "처리 중..." : mode === "buy" ? "매수 확인" : "매도 확인"}
        </button>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: 커밋**

```bash
git add web/src/app/my-portfolio/components/trade-modal.tsx
git commit -m "feat: 매수/매도 모달 — 종목검색, 슬라이더 가격, 포트선택, 메모"
```

---

### Task 9: 포트 탭 바 컴포넌트

**Files:**
- Create: `web/src/app/my-portfolio/components/portfolio-tabs.tsx`

- [ ] **Step 1: PortfolioTabs 컴포넌트 작성**

기능:
- 고정 "전체" 탭 + 동적 포트 탭 + "+" 버튼
- 탭 클릭 시 선택, 더블클릭 시 이름 편집 (기본 탭 제외)
- 탭 우클릭/길게 누르기 → 삭제 확인
- "+" 클릭 시 프롬프트로 이름 입력 → POST API 호출

```typescript
"use client";

import { useState } from "react";

interface Portfolio {
  id: number;
  name: string;
  is_default: boolean;
  sort_order: number;
}

interface Props {
  portfolios: Portfolio[];
  activeId: number | null; // null = "전체"
  onSelect: (id: number | null) => void;
  onPortfoliosChange: () => void; // 포트 목록 갱신 트리거
}

export function PortfolioTabs({ portfolios, activeId, onSelect, onPortfoliosChange }: Props) {
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editName, setEditName] = useState("");

  const handleAdd = async () => {
    const name = prompt("새 포트 이름을 입력하세요:");
    if (!name?.trim()) return;

    const res = await fetch("/api/v1/user-portfolio", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: name.trim() }),
    });

    if (res.ok) {
      onPortfoliosChange();
    } else {
      const err = await res.json();
      alert(err.error ?? "생성 실패");
    }
  };

  const handleDelete = async (id: number, name: string) => {
    if (!confirm(`"${name}" 포트를 삭제하시겠습니까?\n거래 이력은 보존됩니다.`)) return;

    const res = await fetch(`/api/v1/user-portfolio?id=${id}`, { method: "DELETE" });
    if (res.ok) {
      if (activeId === id) onSelect(null);
      onPortfoliosChange();
    }
  };

  const handleRename = async (id: number) => {
    if (!editName.trim()) {
      setEditingId(null);
      return;
    }

    const res = await fetch("/api/v1/user-portfolio", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, name: editName.trim() }),
    });

    if (res.ok) onPortfoliosChange();
    setEditingId(null);
  };

  const defaultPort = portfolios.find((p) => p.is_default);
  const userPorts = portfolios.filter((p) => !p.is_default);

  return (
    <div className="flex items-center gap-0 border-b-2 border-gray-200 bg-gray-50 px-3 overflow-x-auto">
      {/* 전체 탭 (고정) */}
      <button
        onClick={() => onSelect(null)}
        className={`px-4 py-2.5 text-sm whitespace-nowrap border-b-2 -mb-[2px] transition-colors ${
          activeId === null
            ? "bg-white border-gray-800 font-bold text-gray-900"
            : "border-transparent text-gray-500 hover:text-gray-700"
        }`}
      >
        전체 📌
      </button>

      {/* 사용자 포트 탭 */}
      {userPorts.map((p) => (
        <div key={p.id} className="relative group">
          {editingId === p.id ? (
            <input
              type="text"
              value={editName}
              onChange={(e) => setEditName(e.target.value)}
              onBlur={() => handleRename(p.id)}
              onKeyDown={(e) => {
                if (e.key === "Enter") handleRename(p.id);
                if (e.key === "Escape") setEditingId(null);
              }}
              autoFocus
              className="px-3 py-2 text-sm border border-blue-400 rounded outline-none w-24"
            />
          ) : (
            <button
              onClick={() => onSelect(p.id)}
              onDoubleClick={() => {
                setEditingId(p.id);
                setEditName(p.name);
              }}
              className={`px-4 py-2.5 text-sm whitespace-nowrap border-b-2 -mb-[2px] transition-colors ${
                activeId === p.id
                  ? "bg-white border-gray-800 font-bold text-gray-900"
                  : "border-transparent text-gray-500 hover:text-gray-700"
              }`}
            >
              {p.name}
            </button>
          )}
          {/* 삭제 버튼 (호버 시) */}
          {editingId !== p.id && (
            <button
              onClick={() => handleDelete(p.id, p.name)}
              className="absolute -top-1 -right-1 hidden group-hover:flex w-4 h-4 items-center justify-center bg-gray-400 text-white rounded-full text-[10px] hover:bg-red-500"
            >
              ✕
            </button>
          )}
        </div>
      ))}

      {/* + 버튼 */}
      <button
        onClick={handleAdd}
        className="px-3 py-2.5 text-gray-400 hover:text-gray-600 font-bold text-lg"
      >
        +
      </button>
    </div>
  );
}
```

- [ ] **Step 2: 커밋**

```bash
git add web/src/app/my-portfolio/components/portfolio-tabs.tsx
git commit -m "feat: 포트 탭 바 — 고정 전체 + 동적 추가/삭제/이름변경"
```

---

### Task 10: 포트 요약 카드 + 보유 종목 테이블

**Files:**
- Create: `web/src/app/my-portfolio/components/portfolio-summary.tsx`
- Create: `web/src/app/my-portfolio/components/holdings-table.tsx`

- [ ] **Step 1: PortfolioSummary 컴포넌트 작성**

```typescript
"use client";

interface Props {
  totalReturnPct: number;
  holdingCount: number;
  completedTradeCount: number;
}

export function PortfolioSummary({ totalReturnPct, holdingCount, completedTradeCount }: Props) {
  const isPositive = totalReturnPct >= 0;
  return (
    <div className="grid grid-cols-3 gap-4 p-4">
      <div>
        <div className="text-xs text-gray-400">총 수익률</div>
        <div className={`text-2xl font-bold ${isPositive ? "text-red-500" : "text-blue-500"}`}>
          {isPositive ? "+" : ""}{totalReturnPct.toFixed(1)}%
        </div>
      </div>
      <div className="text-center">
        <div className="text-xs text-gray-400">보유 종목</div>
        <div className="text-2xl font-bold">{holdingCount}</div>
      </div>
      <div className="text-right">
        <div className="text-xs text-gray-400">완료 거래</div>
        <div className="text-2xl font-bold">{completedTradeCount}</div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: HoldingsTable 컴포넌트 작성**

```typescript
"use client";

interface Holding {
  trade_id: number;
  symbol: string;
  name: string;
  buy_price: number;
  current_price: number;
  return_pct: number;
  target_price: number | null;
  stop_price: number | null;
  status: string;
  note: string | null;
  bought_at: string;
  latest_signal: { type: string; source: string; date: string } | null;
}

interface Props {
  holdings: Holding[];
  onSell: (holding: Holding) => void;
}

const STATUS_BADGES: Record<string, { label: string; className: string }> = {
  holding: { label: "보유중", className: "bg-red-50 text-red-500" },
  near_target: { label: "익절 근접", className: "bg-green-50 text-green-600" },
  near_stop: { label: "손절 근접", className: "bg-amber-50 text-amber-600" },
};

export function HoldingsTable({ holdings, onSell }: Props) {
  if (holdings.length === 0) {
    return (
      <div className="text-center py-12 text-gray-400 text-sm">
        보유 종목이 없습니다
      </div>
    );
  }

  return (
    <div className="border border-gray-200 rounded-lg overflow-hidden">
      {/* 헤더 */}
      <div className="grid grid-cols-[2fr_1fr_1fr_1fr_80px] px-3 py-2 bg-gray-50 text-xs text-gray-400 border-b border-gray-200">
        <div>종목</div>
        <div className="text-right">매수가</div>
        <div className="text-right">현재가</div>
        <div className="text-right">수익률</div>
        <div className="text-right">상태</div>
      </div>

      {/* 종목 행 */}
      {holdings.map((h) => {
        const badge = STATUS_BADGES[h.status] ?? STATUS_BADGES.holding;
        const isNearStop = h.status === "near_stop";
        const hasSellSignal =
          h.latest_signal &&
          (h.latest_signal.type === "SELL" || h.latest_signal.type === "SELL_COMPLETE");

        return (
          <div
            key={h.trade_id}
            className={`grid grid-cols-[2fr_1fr_1fr_1fr_80px] px-3 py-2.5 text-sm border-b border-gray-100 items-center ${
              isNearStop ? "bg-amber-50" : ""
            }`}
          >
            <div>
              <div className="font-semibold">
                {h.name} {hasSellSignal && "⚠️"}
              </div>
              <div className="text-[10px] text-gray-400">
                {h.symbol}
                {hasSellSignal && " · AI 매도신호"}
              </div>
            </div>
            <div className="text-right">{h.buy_price.toLocaleString()}</div>
            <div className="text-right">{h.current_price.toLocaleString()}</div>
            <div className={`text-right font-semibold ${h.return_pct >= 0 ? "text-red-500" : "text-blue-500"}`}>
              {h.return_pct >= 0 ? "+" : ""}{h.return_pct.toFixed(1)}%
            </div>
            <div className="text-right">
              <button
                onClick={() => onSell(h)}
                className={`text-[10px] px-2 py-0.5 rounded ${badge.className}`}
              >
                {badge.label}
              </button>
            </div>
          </div>
        );
      })}
    </div>
  );
}
```

- [ ] **Step 3: 커밋**

```bash
git add web/src/app/my-portfolio/components/portfolio-summary.tsx web/src/app/my-portfolio/components/holdings-table.tsx
git commit -m "feat: 포트 요약 카드 + 보유 종목 테이블 컴포넌트"
```

---

### Task 11: 포트종목 메인 페이지

**Files:**
- Create: `web/src/app/my-portfolio/page.tsx`

- [ ] **Step 1: 메인 페이지 작성**

이 페이지는 클라이언트 컴포넌트로, 탭 전환/거래 후 데이터를 재조회한다.

```typescript
"use client";

import { useState, useEffect, useCallback } from "react";
import { PortfolioTabs } from "./components/portfolio-tabs";
import { PortfolioSummary } from "./components/portfolio-summary";
import { HoldingsTable } from "./components/holdings-table";
import { TradeModal } from "./components/trade-modal";

interface Portfolio {
  id: number;
  name: string;
  is_default: boolean;
  sort_order: number;
}

interface Holding {
  trade_id: number;
  portfolio_id: number;
  symbol: string;
  name: string;
  buy_price: number;
  current_price: number;
  return_pct: number;
  target_price: number | null;
  stop_price: number | null;
  status: string;
  note: string | null;
  bought_at: string;
  latest_signal: { type: string; source: string; date: string } | null;
}

interface Summary {
  total_return_pct: number;
  holding_count: number;
  completed_trade_count: number;
}

export default function MyPortfolioPage() {
  const [portfolios, setPortfolios] = useState<Portfolio[]>([]);
  const [activePortfolioId, setActivePortfolioId] = useState<number | null>(null);
  const [holdings, setHoldings] = useState<Holding[]>([]);
  const [summary, setSummary] = useState<Summary>({ total_return_pct: 0, holding_count: 0, completed_trade_count: 0 });

  // 모달 상태
  const [tradeModalOpen, setTradeModalOpen] = useState(false);
  const [tradeMode, setTradeMode] = useState<"buy" | "sell">("buy");
  const [sellTarget, setSellTarget] = useState<Holding | null>(null);

  const fetchPortfolios = useCallback(async () => {
    const res = await fetch("/api/v1/user-portfolio");
    const data = await res.json();
    setPortfolios(data.portfolios ?? []);
  }, []);

  const fetchHoldings = useCallback(async () => {
    const params = activePortfolioId ? `?portfolio_id=${activePortfolioId}` : "";
    const res = await fetch(`/api/v1/user-portfolio/holdings${params}`);
    const data = await res.json();
    setHoldings(data.holdings ?? []);
    setSummary(data.summary ?? { total_return_pct: 0, holding_count: 0, completed_trade_count: 0 });
  }, [activePortfolioId]);

  useEffect(() => { fetchPortfolios(); }, [fetchPortfolios]);
  useEffect(() => { fetchHoldings(); }, [fetchHoldings]);

  const handleSell = (holding: Holding) => {
    setSellTarget(holding);
    setTradeMode("sell");
    setTradeModalOpen(true);
  };

  const handleBuy = () => {
    setSellTarget(null);
    setTradeMode("buy");
    setTradeModalOpen(true);
  };

  return (
    <div className="min-h-screen bg-white">
      {/* 탭 바 */}
      <PortfolioTabs
        portfolios={portfolios}
        activeId={activePortfolioId}
        onSelect={setActivePortfolioId}
        onPortfoliosChange={fetchPortfolios}
      />

      {/* 요약 카드 */}
      <PortfolioSummary
        totalReturnPct={summary.total_return_pct}
        holdingCount={summary.holding_count}
        completedTradeCount={summary.completed_trade_count}
      />

      {/* 보유 종목 테이블 */}
      <div className="px-4">
        <HoldingsTable holdings={holdings} onSell={handleSell} />
      </div>

      {/* 하단 버튼 */}
      <div className="flex gap-2 p-4">
        <button
          onClick={handleBuy}
          className="flex-1 bg-red-500 text-white py-2.5 rounded-lg text-sm font-semibold"
        >
          + 종목 매수
        </button>
        <a
          href="#performance"
          className="flex-1 bg-blue-500 text-white py-2.5 rounded-lg text-sm font-semibold text-center"
        >
          📊 포트 비교
        </a>
      </div>

      {/* 매수/매도 모달 */}
      <TradeModal
        mode={tradeMode}
        isOpen={tradeModalOpen}
        onClose={() => setTradeModalOpen(false)}
        onSubmit={fetchHoldings}
        initialSymbol={sellTarget?.symbol}
        initialName={sellTarget?.name}
        initialPrice={sellTarget?.current_price}
        buyTradeId={sellTarget?.trade_id}
        portfolios={portfolios}
      />
    </div>
  );
}
```

- [ ] **Step 2: 로컬에서 `/my-portfolio` 페이지 접속 확인**

Run: 브라우저에서 `http://localhost:3000/my-portfolio` 접속
Expected: 탭 바에 "전체" 탭이 보이고, 빈 보유 종목 + 매수 버튼 표시

- [ ] **Step 3: 커밋**

```bash
git add web/src/app/my-portfolio/page.tsx
git commit -m "feat: 포트종목 메인 페이지 — 탭+요약+테이블+모달 통합"
```

---

## Chunk 3: 종목상세 차트 오버레이 + 매수 버튼

### Task 12: CandleChart 포트 오버레이 확장

**Files:**
- Modify: `web/src/components/charts/candle-chart.tsx`

- [ ] **Step 1: PortfolioOverlay 인터페이스 및 Props 추가**

기존 Props에 선택적 `portfolioOverlays` prop 추가:

```typescript
// 기존 인터페이스 아래에 추가
interface PortfolioOverlay {
  portfolioName: string;
  color: string;        // hex 컬러 (예: "#ef4444")
  markers: Array<{
    date: string;
    side: "BUY" | "SELL";
    price: number;
  }>;
  priceLines: Array<{
    price: number;
    label: string;       // "매수 72,000", "목표 79,200", "손절 68,400"
    style: "solid" | "dashed";
  }>;
}

// Props에 추가
interface Props {
  data: PriceData[];
  signalDates?: Set<string>;
  signalMarkers?: SignalMarker[];
  portfolioOverlays?: PortfolioOverlay[];  // 새로 추가
  height?: number;
}
```

- [ ] **Step 2: useEffect 내에서 오버레이 렌더링 추가**

기존 마커 렌더링 코드 아래에 포트 오버레이 렌더링 추가:

```typescript
// portfolioOverlays 마커 추가
if (portfolioOverlays) {
  const portMarkers = portfolioOverlays.flatMap((overlay) =>
    overlay.markers.map((m) => ({
      time: m.date,
      position: m.side === "BUY" ? "belowBar" as const : "aboveBar" as const,
      color: overlay.color,
      shape: m.side === "BUY" ? "arrowUp" as const : "arrowDown" as const,
      text: `${overlay.portfolioName} ${m.side === "BUY" ? "매수" : "매도"}`,
    }))
  );

  // 기존 마커와 합치기
  const allMarkers = [...(existingMarkers ?? []), ...portMarkers]
    .sort((a, b) => (a.time > b.time ? 1 : -1));
  candleSeries.setMarkers(allMarkers);

  // 프라이스 라인 추가
  for (const overlay of portfolioOverlays) {
    for (const pl of overlay.priceLines) {
      candleSeries.createPriceLine({
        price: pl.price,
        color: overlay.color,
        lineWidth: pl.style === "solid" ? 2 : 1,
        lineStyle: pl.style === "solid" ? 0 : 2, // 0=Solid, 2=Dashed
        axisLabelVisible: true,
        title: pl.label,
      });
    }
  }
}
```

- [ ] **Step 3: 커밋**

```bash
git add web/src/components/charts/candle-chart.tsx
git commit -m "feat: CandleChart 포트 오버레이 — 마커 + 프라이스라인 확장"
```

---

### Task 13: 종목상세 페이지에 매수 버튼 + 포트 체크박스

**Files:**
- Modify: `web/src/components/stock/stock-price-header.tsx`
- Modify: `web/src/app/stock/[symbol]/page.tsx`

- [ ] **Step 1: StockPriceHeader에 매수 버튼 추가**

기존 헤더 컴포넌트에 `onBuyClick?: () => void` prop 추가:

```typescript
// Props에 추가
onBuyClick?: () => void;

// JSX 내 가격 표시 옆에 버튼 추가
{onBuyClick && (
  <button
    onClick={onBuyClick}
    className="ml-3 px-3 py-1 bg-red-500 text-white text-xs rounded-lg hover:bg-red-600"
  >
    매수
  </button>
)}
```

- [ ] **Step 2: 종목상세 페이지에 포트 체크박스 + 오버레이 데이터 연결**

`web/src/app/stock/[symbol]/page.tsx`에 추가할 내용:

1. 사용자 포트 목록 조회 (`/api/v1/user-portfolio`)
2. 해당 종목의 거래 이력 조회 (`/api/v1/user-portfolio/trades?symbol=XXX`)
3. 포트별 체크박스 UI (차트 상단)
4. 체크된 포트의 거래 데이터 → `portfolioOverlays` 형태로 CandleChart에 전달
5. "매수" 버튼 클릭 시 TradeModal 오픈

포트 체크박스 UI:
```typescript
const PORTFOLIO_COLORS = ["#ef4444", "#8b5cf6", "#f59e0b", "#10b981", "#0ea5e9", "#ec4899"];

// 차트 상단
<div className="flex gap-3 p-2 bg-gray-50 rounded-lg mb-2">
  {portfolios.map((p, i) => (
    <label key={p.id} className="flex items-center gap-1 text-xs">
      <input
        type="checkbox"
        checked={checkedPortIds.has(p.id)}
        onChange={() => togglePortfolio(p.id)}
      />
      <span style={{ color: PORTFOLIO_COLORS[i % PORTFOLIO_COLORS.length] }} className="font-semibold">
        {p.name}
      </span>
    </label>
  ))}
  <label className="flex items-center gap-1 text-xs ml-auto">
    <input type="checkbox" checked={showAiSignals} onChange={() => setShowAiSignals(!showAiSignals)} />
    AI
  </label>
</div>
```

- [ ] **Step 3: 커밋**

```bash
git add web/src/components/stock/stock-price-header.tsx web/src/app/stock/\\[symbol\\]/page.tsx
git commit -m "feat: 종목상세에 매수 버튼 + 포트별 차트 오버레이 체크박스"
```

---

## Chunk 4: 성과 비교 차트 + 스냅샷 Cron

### Task 14: 포트 성과 비교 차트 컴포넌트

**Files:**
- Create: `web/src/app/my-portfolio/components/performance-chart.tsx`

- [ ] **Step 1: PerformanceChart 컴포넌트 작성**

lightweight-charts의 라인 차트를 사용하여 여러 포트의 누적 수익률을 겹쳐서 표시.

```typescript
"use client";

import { useEffect, useRef, useState } from "react";
import { createChart, ColorType } from "lightweight-charts";

const PORTFOLIO_COLORS = ["#ef4444", "#8b5cf6", "#f59e0b", "#10b981", "#0ea5e9", "#ec4899"];
const BENCHMARK_COLOR = "#94a3b8";

interface SnapshotPoint {
  date: string;
  cumulative_return_pct: number;
}

interface Props {
  portfolioId?: number;
  days?: number;
}

export function PerformanceChart({ portfolioId, days = 30 }: Props) {
  const chartRef = useRef<HTMLDivElement>(null);
  const [period, setPeriod] = useState(days);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!chartRef.current) return;

    const fetchAndRender = async () => {
      setLoading(true);
      const params = new URLSearchParams({ days: String(period) });
      if (portfolioId) params.set("portfolio_id", String(portfolioId));

      const res = await fetch(`/api/v1/user-portfolio/performance?${params}`);
      const data = await res.json();

      const chart = createChart(chartRef.current!, {
        width: chartRef.current!.clientWidth,
        height: 250,
        layout: { background: { type: ColorType.Solid, color: "white" }, textColor: "#64748b" },
        grid: { vertLines: { visible: false }, horzLines: { color: "#f1f5f9" } },
        rightPriceScale: { borderVisible: false },
        timeScale: { borderVisible: false },
      });

      // 포트별 라인
      const portfolioIds = Object.keys(data.portfolios ?? {});
      portfolioIds.forEach((pid, i) => {
        const snapshots: SnapshotPoint[] = data.portfolios[pid];
        if (!snapshots || snapshots.length === 0) return;

        const lineSeries = chart.addLineSeries({
          color: PORTFOLIO_COLORS[i % PORTFOLIO_COLORS.length],
          lineWidth: 2,
        });

        lineSeries.setData(
          snapshots.map((s: SnapshotPoint) => ({
            time: s.date,
            value: Number(s.cumulative_return_pct) ?? 0,
          }))
        );
      });

      // 벤치마크 라인
      if (data.benchmark && data.benchmark.length > 0) {
        const benchLine = chart.addLineSeries({
          color: BENCHMARK_COLOR,
          lineWidth: 1,
          lineStyle: 2,
        });
        benchLine.setData(
          data.benchmark.map((b: { date: string; return_pct: number }) => ({
            time: b.date,
            value: b.return_pct,
          }))
        );
      }

      chart.timeScale().fitContent();
      setLoading(false);

      return () => chart.remove();
    };

    fetchAndRender();
  }, [portfolioId, period]);

  return (
    <div id="performance" className="p-4">
      <div className="flex justify-between items-center mb-3">
        <h3 className="font-bold text-sm">포트 성과 비교</h3>
        <div className="flex gap-1">
          {[30, 60, 90].map((d) => (
            <button
              key={d}
              onClick={() => setPeriod(d)}
              className={`px-2 py-1 text-xs rounded ${
                period === d ? "bg-gray-800 text-white" : "bg-gray-100 text-gray-500"
              }`}
            >
              {d}일
            </button>
          ))}
        </div>
      </div>

      {loading && (
        <div className="flex items-center justify-center h-[250px] text-gray-400 text-sm">
          로딩 중...
        </div>
      )}

      <div ref={chartRef} className={loading ? "hidden" : ""} />

      <div className="flex gap-3 mt-2 text-xs text-gray-400">
        <span>━━ 포트 수익률</span>
        <span style={{ color: BENCHMARK_COLOR }}>╌╌ 코스피</span>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: 메인 페이지에 PerformanceChart 추가**

`web/src/app/my-portfolio/page.tsx`에서 하단 버튼 아래에 `<PerformanceChart />` 추가.

- [ ] **Step 3: 커밋**

```bash
git add web/src/app/my-portfolio/components/performance-chart.tsx web/src/app/my-portfolio/page.tsx
git commit -m "feat: 포트 성과 비교 차트 — 라인 차트 + 벤치마크"
```

---

### Task 15: 일별 스냅샷 생성 Cron 로직

**Files:**
- Modify: `web/src/app/api/v1/cron/daily-prices/route.ts` (기존 cron에 추가)
  또는 Create: `web/src/app/api/v1/cron/user-portfolio-snapshot/route.ts` (별도 cron)

참고: 기존 `daily-prices` cron이 장 마감 후 실행되므로, 해당 cron 끝에 스냅샷 생성 로직을 추가하는 것이 자연스럽다. 다만 관심사 분리를 위해 별도 API로 만들되, 기존 cron에서 호출하는 방식도 가능.

- [ ] **Step 1: 스냅샷 생성 함수 작성**

별도 cron으로 만들기:

```typescript
import { NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(request: Request) {
  // CRON 인증
  const authHeader = request.headers.get("authorization");
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const supabase = createServiceClient();
  const today = new Date().toISOString().split("T")[0];

  // 1. 활성 포트 목록
  const { data: portfolios } = await supabase
    .from("user_portfolios")
    .select("id")
    .is("deleted_at", null)
    .eq("is_default", false);

  if (!portfolios || portfolios.length === 0) {
    return NextResponse.json({ message: "No portfolios", snapshots: 0 });
  }

  const snapshots = [];

  for (const port of portfolios) {
    // 2. 미청산 BUY 조회
    const { data: buys } = await supabase
      .from("user_trades")
      .select("id, symbol, price")
      .eq("portfolio_id", port.id)
      .eq("side", "BUY");

    const { data: sells } = await supabase
      .from("user_trades")
      .select("buy_trade_id")
      .eq("side", "SELL")
      .not("buy_trade_id", "is", null);

    const soldIds = new Set((sells ?? []).map((s: { buy_trade_id: number }) => s.buy_trade_id));
    const openBuys = (buys ?? []).filter((b: { id: number }) => !soldIds.has(b.id));

    if (openBuys.length === 0) continue;

    // 3. 현재가 조회
    const symbols = [...new Set(openBuys.map((b: { symbol: string }) => b.symbol))];
    const { data: cacheData } = await supabase
      .from("stock_cache")
      .select("symbol, current_price")
      .in("symbol", symbols);

    const priceMap = new Map<string, number>();
    for (const c of cacheData ?? []) {
      if (c.current_price) priceMap.set(c.symbol, Number(c.current_price));
    }

    // 4. 수익률 계산
    const returns = openBuys.map((b: { symbol: string; price: number }) => {
      const cp = priceMap.get(b.symbol) ?? b.price;
      return ((cp - b.price) / b.price) * 100;
    });
    const avgReturn = returns.reduce((a: number, b: number) => a + b, 0) / returns.length;

    // 전일 스냅샷 조회 (daily_return 계산용)
    const { data: prevSnap } = await supabase
      .from("user_portfolio_snapshots")
      .select("cumulative_return_pct")
      .eq("portfolio_id", port.id)
      .lt("date", today)
      .order("date", { ascending: false })
      .limit(1)
      .single();

    const prevCumulative = prevSnap?.cumulative_return_pct ?? 0;
    const dailyReturn = avgReturn - Number(prevCumulative);

    // 전체 거래 수
    const { count: tradeCount } = await supabase
      .from("user_trades")
      .select("id", { count: "exact", head: true })
      .eq("portfolio_id", port.id);

    snapshots.push({
      portfolio_id: port.id,
      date: today,
      daily_return_pct: Math.round(dailyReturn * 100) / 100,
      cumulative_return_pct: Math.round(avgReturn * 100) / 100,
      holding_count: openBuys.length,
      trade_count: tradeCount ?? 0,
    });
  }

  // 5. 스냅샷 upsert
  if (snapshots.length > 0) {
    const { error } = await supabase
      .from("user_portfolio_snapshots")
      .upsert(snapshots, { onConflict: "portfolio_id,date" });

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
  }

  return NextResponse.json({ success: true, snapshots: snapshots.length });
}
```

- [ ] **Step 2: 커밋**

```bash
git add web/src/app/api/v1/cron/user-portfolio-snapshot/route.ts
git commit -m "feat: 사용자 포트 일별 스냅샷 생성 Cron"
```

---

### Task 16: 네비게이션 메뉴에 "포트종목" 추가

**Files:**
- Modify: 기존 네비게이션/사이드바 컴포넌트 (프로젝트 내 nav/sidebar 파일 확인 필요)

- [ ] **Step 1: 네비게이션에 "포트종목" 링크 추가**

기존 네비게이션 구조를 확인하고 `/my-portfolio` 링크를 추가:

```typescript
{ href: "/my-portfolio", label: "포트종목" }
```

- [ ] **Step 2: 커밋**

```bash
git add <네비게이션 파일>
git commit -m "feat: 네비게이션에 포트종목 메뉴 추가"
```

---

### Task 17: 최종 통합 확인

- [ ] **Step 1: 전체 기능 확인**

브라우저에서 다음 시나리오 테스트:

1. `/my-portfolio` 접속 → "전체" 탭 표시
2. "+" 버튼 → "성장주" 포트 생성 → 탭에 추가됨
3. "+ 종목 매수" → 종목 검색 → 매수가/목표가/손절가 슬라이더 조절 → "성장주" 포트 선택 → 매수 확인
4. 보유 종목 테이블에 종목 표시 + 수익률 계산
5. 종목상세 페이지 (`/stock/005930`) → 매수 버튼 클릭 → 모달에서 매수
6. 차트에 포트 체크박스 → 체크 시 매수가/목표가/손절가 수평선 표시
7. 보유 종목 "보유중" 뱃지 클릭 → 매도 모달 → 매도 완료
8. 거래 이력에 매수/매도 기록 확인

- [ ] **Step 2: 최종 커밋**

```bash
git add -A
git commit -m "feat: 사용자 모의투자 포트폴리오 시뮬레이터 구현 완료"
```
