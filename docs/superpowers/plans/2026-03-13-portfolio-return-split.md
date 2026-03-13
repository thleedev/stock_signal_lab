# Portfolio Return Split Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 포트폴리오 헤더에 현재수익률(보유 종목만)과 총수익률(완료 거래 포함)을 분리 표시하되, 매수금액 가중 평균으로 계산한다.

**Architecture:** holdings API에서 완료 거래(SELL) 데이터를 추가 조회해 두 지표를 계산하고 summary에 포함시킨다. 클라이언트는 Summary 타입을 업데이트하고 헤더에 카드 하나를 추가한다.

**Tech Stack:** Next.js App Router, Supabase, TypeScript, Tailwind CSS

---

## 계산 공식

**현재수익률** (보유 종목만, 매수금액 가중):
```
current_return_pct = Σ(현재가 - 매수가) / Σ(매수가) × 100
```

**총수익률** (보유 + 완료 거래, 매수금액 가중):
```
total_return_pct = [Σ(현재가 - 매수가) for 보유 + Σ(매도가 - 매수가) for 완료]
                  / [Σ(매수가 보유) + Σ(매수가 완료)] × 100
```

---

## Chunk 1: API 수정

### Task 1: holdings API — 완료 거래 수익률 추가

**Files:**
- Modify: `web/src/app/api/v1/user-portfolio/holdings/route.ts`

현재 SELL 조회는 `buy_trade_id`만 가져와 soldBuyIds를 만드는 용도로만 사용한다.
완료 거래의 수익률 계산을 위해 `price`와 연결된 BUY의 `price`도 함께 가져와야 한다.

- [ ] **Step 1: SELL 쿼리에 price 추가**

[web/src/app/api/v1/user-portfolio/holdings/route.ts](web/src/app/api/v1/user-portfolio/holdings/route.ts) 의 SELL 조회 부분을 수정한다.

기존:
```ts
const { data: sells } = await supabase
  .from("user_trades")
  .select("buy_trade_id")
  .eq("side", "SELL")
  .not("buy_trade_id", "is", null);
```

변경:
```ts
interface SellRow {
  buy_trade_id: number;
  price: number;
}

const { data: sells } = await supabase
  .from("user_trades")
  .select("buy_trade_id, price")
  .eq("side", "SELL")
  .not("buy_trade_id", "is", null);
```

- [ ] **Step 2: 완료 거래의 매수가 조회**

`soldBuyIds` 생성 직후, 완료 거래에 연결된 BUY 레코드들의 price를 조회한다.

```ts
const soldBuyIds = new Set((sells ?? []).map((s: SellRow) => s.buy_trade_id));

// 완료 거래: (매도가, 매수가) 쌍 구성
const completedTrades: Array<{ buyPrice: number; sellPrice: number }> = [];
if ((sells ?? []).length > 0) {
  const soldBuyIdList = [...soldBuyIds];
  const { data: soldBuys } = await supabase
    .from("user_trades")
    .select("id, price")
    .in("id", soldBuyIdList);

  const buyPriceMap = new Map(
    (soldBuys ?? []).map((b: { id: number; price: number }) => [b.id, b.price])
  );

  for (const sell of sells ?? []) {
    const buyPrice = buyPriceMap.get(sell.buy_trade_id);
    if (buyPrice) {
      completedTrades.push({ buyPrice, sellPrice: sell.price });
    }
  }
}
```

portfolio_id 필터가 있을 때 완료 거래도 해당 포트의 것만 포함해야 하므로, sells 조회에 portfolio_id 필터 추가:

```ts
let sellQuery = supabase
  .from("user_trades")
  .select("buy_trade_id, price")
  .eq("side", "SELL")
  .not("buy_trade_id", "is", null);

if (portfolioId) {
  sellQuery = sellQuery.eq("portfolio_id", portfolioId);
}

const { data: sells } = await sellQuery;
```

- [ ] **Step 3: 두 지표 계산 로직 교체**

기존 단순 평균 계산 부분을 삭제하고 가중 평균으로 교체한다.

기존 (삭제):
```ts
const returnPcts = holdings.map((h: { return_pct: number }) => h.return_pct);
const totalReturnPct =
  returnPcts.length > 0
    ? Math.round((returnPcts.reduce((a: number, b: number) => a + b, 0) / returnPcts.length) * 100) / 100
    : 0;
```

변경:
```ts
// 현재수익률: 보유 종목 매수금액 가중 평균
let currentReturnPct = 0;
if (holdings.length > 0) {
  const totalBuy = holdings.reduce((sum: number, h: { buy_price: number }) => sum + h.buy_price, 0);
  const totalGain = holdings.reduce(
    (sum: number, h: { current_price: number; buy_price: number }) =>
      sum + (h.current_price - h.buy_price),
    0
  );
  currentReturnPct = totalBuy > 0 ? Math.round((totalGain / totalBuy) * 10000) / 100 : 0;
}

// 총수익률: 보유 + 완료 거래 매수금액 가중 평균
let totalReturnPct = currentReturnPct;
if (completedTrades.length > 0) {
  const openBuyTotal = holdings.reduce(
    (sum: number, h: { buy_price: number }) => sum + h.buy_price,
    0
  );
  const openGainTotal = holdings.reduce(
    (sum: number, h: { current_price: number; buy_price: number }) =>
      sum + (h.current_price - h.buy_price),
    0
  );
  const closedBuyTotal = completedTrades.reduce((sum, t) => sum + t.buyPrice, 0);
  const closedGainTotal = completedTrades.reduce((sum, t) => sum + (t.sellPrice - t.buyPrice), 0);

  const allBuyTotal = openBuyTotal + closedBuyTotal;
  totalReturnPct =
    allBuyTotal > 0
      ? Math.round(((openGainTotal + closedGainTotal) / allBuyTotal) * 10000) / 100
      : 0;
}
```

- [ ] **Step 4: summary 응답 업데이트**

```ts
return NextResponse.json({
  holdings,
  summary: {
    current_return_pct: currentReturnPct,
    total_return_pct: totalReturnPct,
    holding_count: holdings.length,
    completed_trade_count: soldBuyIds.size,
  },
});
```

보유 종목이 0개일 때의 early return도 업데이트:
```ts
if (openBuys.length === 0) {
  // 완료 거래만 있는 경우에도 총수익률 계산
  // (이 시점에는 completedTrades가 아직 없으므로 0으로 반환)
  return NextResponse.json({
    holdings: [],
    summary: {
      current_return_pct: 0,
      total_return_pct: 0,
      holding_count: 0,
      completed_trade_count: soldBuyIds.size,
    },
  });
}
```

> **주의:** 보유 0개 + 완료 거래만 있는 경우 총수익률을 계산하려면 early return을 제거하고 흐름을 이어가야 한다. 해당 케이스는 추후 필요 시 개선할 수 있다. 현재 구현에서는 0으로 반환.

- [ ] **Step 5: 로컬에서 API 동작 확인**

```bash
# 개발 서버 실행 중이라면:
curl "http://localhost:3000/api/v1/user-portfolio/holdings" | jq '.summary'
# 예상 출력:
# {
#   "current_return_pct": 5.2,
#   "total_return_pct": 8.1,
#   "holding_count": 3,
#   "completed_trade_count": 5
# }
```

---

## Chunk 2: 프론트엔드 수정

### Task 2: page.tsx — Summary 타입 및 헤더 UI 업데이트

**Files:**
- Modify: `web/src/app/my-portfolio/page.tsx`

- [ ] **Step 1: Summary 인터페이스 업데이트**

기존:
```ts
interface Summary {
  total_return_pct: number;
  holding_count: number;
  completed_trade_count: number;
}
```

변경:
```ts
interface Summary {
  current_return_pct: number;
  total_return_pct: number;
  holding_count: number;
  completed_trade_count: number;
}
```

- [ ] **Step 2: useState 초기값 업데이트**

기존:
```ts
const [summary, setSummary] = useState<Summary>({ total_return_pct: 0, holding_count: 0, completed_trade_count: 0 });
```

변경:
```ts
const [summary, setSummary] = useState<Summary>({ current_return_pct: 0, total_return_pct: 0, holding_count: 0, completed_trade_count: 0 });
```

- [ ] **Step 3: 헤더 색상 변수 업데이트**

기존:
```ts
const isPositive = summary.total_return_pct >= 0;
```

변경:
```ts
const isCurrentPositive = summary.current_return_pct >= 0;
const isTotalPositive = summary.total_return_pct >= 0;
```

- [ ] **Step 4: 헤더 UI — 카드 2개로 분리**

기존 (헤더 오른쪽 영역):
```tsx
<div className="flex items-center gap-5">
  <div className="text-right">
    <div className="text-[10px] text-[var(--muted)]">총 수익률</div>
    <div className={`text-lg font-bold tabular-nums ${isPositive ? "text-red-400" : "text-blue-400"}`}>
      {isPositive ? "+" : ""}{summary.total_return_pct.toFixed(1)}%
    </div>
  </div>
  <div className="text-right">
    <div className="text-[10px] text-[var(--muted)]">보유 종목</div>
    <div className="text-lg font-bold">{summary.holding_count}</div>
  </div>
  <div className="text-right">
    <div className="text-[10px] text-[var(--muted)]">완료 거래</div>
    <div className="text-lg font-bold">{summary.completed_trade_count}</div>
  </div>
  ...
```

변경:
```tsx
<div className="flex items-center gap-5">
  <div className="text-right">
    <div className="text-[10px] text-[var(--muted)]">현재수익률</div>
    <div className={`text-lg font-bold tabular-nums ${isCurrentPositive ? "text-red-400" : "text-blue-400"}`}>
      {isCurrentPositive ? "+" : ""}{summary.current_return_pct.toFixed(1)}%
    </div>
  </div>
  <div className="text-right">
    <div className="text-[10px] text-[var(--muted)]">총수익률</div>
    <div className={`text-lg font-bold tabular-nums ${isTotalPositive ? "text-red-400" : "text-blue-400"}`}>
      {isTotalPositive ? "+" : ""}{summary.total_return_pct.toFixed(1)}%
    </div>
  </div>
  <div className="text-right">
    <div className="text-[10px] text-[var(--muted)]">보유 종목</div>
    <div className="text-lg font-bold">{summary.holding_count}</div>
  </div>
  <div className="text-right">
    <div className="text-[10px] text-[var(--muted)]">완료 거래</div>
    <div className="text-lg font-bold">{summary.completed_trade_count}</div>
  </div>
  ...
```

- [ ] **Step 5: 브라우저에서 시각 확인**

`http://localhost:3000/my-portfolio` 접속 후:
- 헤더에 현재수익률 / 총수익률 두 항목이 나란히 표시되는지 확인
- 보유 종목이 없을 때 두 값 모두 0.0%로 표시되는지 확인
- 완료 거래가 있을 때 총수익률이 다르게 표시되는지 확인

---

## 검증 시나리오

| 시나리오 | 현재수익률 | 총수익률 |
|---------|---------|---------|
| 보유만 (A: 100만→110만) | +10.0% | +10.0% |
| 완료만 (B: 50만→45만) | 0.0% | -10.0% |
| 보유 + 완료 (A 보유 +10%, B 완료 -10%) | +10.0% | +3.3% |

> 마지막 케이스 계산: (100만×10% + 50만×-10%) / (100만 + 50만) = (10만 - 5만) / 150만 ≈ +3.3%
