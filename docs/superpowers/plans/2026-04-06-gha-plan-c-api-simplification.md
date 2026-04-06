# GHA 전환 Plan C: Vercel API 경량화 + 프론트엔드 변경

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** stock-ranking API에서 외부 API 호출 제거, 기존 cron 라우트 삭제, trigger-batch API 추가, 프론트엔드에서 prices/market-indicators를 supabase-js 직접 쿼리로 전환

**Architecture:** stock-ranking은 stock_scores + stock_cache JOIN만 수행. prices 훅은 stock_cache를 직접 조회. market-indicators는 market_indicators 테이블 직접 조회. trigger-batch는 GitHub PAT로 workflow_dispatch 호출.

**Tech Stack:** Next.js 16 App Router, supabase-js, TypeScript

**전제 조건:** Plan A (DB 마이그레이션), Plan B (GHA 배치 스크립트) 완료 및 첫 번째 full 배치 실행 완료 필요 (stock_scores에 데이터가 있어야 함)

---

## 파일 구조

```
web/src/
├── app/api/v1/
│   ├── stock-ranking/route.ts         # 대폭 경량화 (2102줄 → ~150줄)
│   ├── admin/
│   │   └── trigger-batch/route.ts     # 신규: GHA workflow_dispatch
│   ├── cron/                          # 전체 삭제
│   │   ├── daily-prices/              # 삭제
│   │   ├── daily-prices-repair/       # 삭제
│   │   ├── market-indicators/         # 삭제
│   │   ├── market-events/             # 삭제
│   │   └── intraday-prices/           # 삭제
│   └── prices/route.ts                # 삭제 (stock_cache 직접 조회로 대체)
├── hooks/
│   ├── use-global-price-refresh.ts    # stock_cache 직접 조회로 변경
│   └── use-market-indicators.ts       # 신규: market_indicators 직접 조회
└── types/
    └── batch.ts                       # Plan A에서 생성됨
```

---

### Task 1: trigger-batch API 추가

**Files:**
- Create: `web/src/app/api/v1/admin/trigger-batch/route.ts`

- [ ] **Step 1: trigger-batch route 작성**

```typescript
// web/src/app/api/v1/admin/trigger-batch/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase';

export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  // 간단한 내부 인증 (CRON_SECRET 재사용)
  const authHeader = request.headers.get('authorization');
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const body = await request.json().catch(() => ({})) as { date?: string; mode?: string };
  const mode = body.mode ?? 'full';
  const date = body.date ?? '';

  // GitHub API로 workflow_dispatch 트리거
  const ghToken = process.env.GH_PAT;
  const ghRepo = process.env.GH_REPO; // 예: "username/DashboardStock"

  if (!ghToken || !ghRepo) {
    return NextResponse.json({ error: 'GH_PAT 또는 GH_REPO 환경변수 없음' }, { status: 500 });
  }

  const ghRes = await fetch(
    `https://api.github.com/repos/${ghRepo}/actions/workflows/daily-batch.yml/dispatches`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${ghToken}`,
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        ref: 'main',
        inputs: { mode, date },
      }),
    }
  );

  if (!ghRes.ok) {
    const text = await ghRes.text();
    return NextResponse.json({ error: `GHA dispatch 실패: ${text}` }, { status: 500 });
  }

  // batch_runs에 pending 레코드 삽입 (프론트엔드 Realtime 구독용)
  const supabase = createServiceClient();
  const { data, error } = await supabase
    .from('batch_runs')
    .insert({
      workflow: 'daily-batch',
      mode,
      status: 'pending',
      triggered_by: 'manual',
      started_at: new Date().toISOString(),
    })
    .select('id')
    .single();

  if (error) {
    console.error('batch_runs 삽입 실패:', error.message);
  }

  return NextResponse.json({
    ok: true,
    runId: data?.id ?? null,
    mode,
    date: date || '(오늘)',
  });
}
```

- [ ] **Step 2: Vercel 환경변수 추가**

Vercel 대시보드 → Settings → Environment Variables:
- `GH_PAT`: GitHub Personal Access Token (workflow read/write 권한)
- `GH_REPO`: `username/DashboardStock` (실제 레포 경로)

- [ ] **Step 3: 커밋**

```bash
git add web/src/app/api/v1/admin/trigger-batch/route.ts
git commit -m "feat: trigger-batch API 추가 (GHA workflow_dispatch + batch_runs)"
```

---

### Task 2: stock-ranking API 경량화

**Files:**
- Modify: `web/src/app/api/v1/stock-ranking/route.ts`

기존 2102줄 파일을 완전히 새로 작성. stock_scores + stock_cache JOIN + 가중치 합산만 수행.

- [ ] **Step 1: 새 route.ts 작성**

```typescript
// web/src/app/api/v1/stock-ranking/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase';
import type { StockScore } from '@/types/batch';

export const dynamic = 'force-dynamic';

const VALID_STYLES = ['balanced', 'value', 'growth', 'momentum', 'defensive'] as const;
type StyleId = typeof VALID_STYLES[number];

// 스타일별 기본 가중치
const STYLE_WEIGHTS: Record<StyleId, {
  value: number; growth: number; supply: number; momentum: number; risk: number; signal: number;
}> = {
  balanced:  { value: 20, growth: 15, supply: 20, momentum: 20, risk: 15, signal: 10 },
  value:     { value: 35, growth: 20, supply: 10, momentum: 10, risk: 15, signal: 10 },
  growth:    { value: 10, growth: 35, supply: 15, momentum: 20, risk: 10, signal: 10 },
  momentum:  { value: 10, growth: 10, supply: 20, momentum: 35, risk: 10, signal: 15 },
  defensive: { value: 20, growth: 10, supply: 15, momentum: 10, risk: 30, signal: 15 },
};

/** 모멘텀 실시간 보정: (현재가 - 전일종가) / 전일종가 * 50 */
function adjustMomentum(base: number, currentPrice: number | null, prevClose: number | null): number {
  if (!currentPrice || !prevClose || prevClose === 0) return base;
  const changePct = (currentPrice - prevClose) / prevClose * 100;
  const adjustment = Math.max(-20, Math.min(20, changePct * 2)); // 최대 ±20점 보정
  return Math.max(0, Math.min(100, base + adjustment));
}

/** 가중치 합산 총점 계산 */
function calcWeightedScore(
  score: Pick<StockScore, 'score_value' | 'score_growth' | 'score_supply' | 'score_momentum' | 'score_risk' | 'score_signal'> & { score_momentum_adjusted: number },
  weights: typeof STYLE_WEIGHTS[StyleId],
): number {
  const total = weights.value + weights.growth + weights.supply + weights.momentum + weights.signal;
  if (total === 0) return 0;
  const positive =
    score.score_value * weights.value +
    score.score_growth * weights.growth +
    score.score_supply * weights.supply +
    score.score_momentum_adjusted * weights.momentum +
    score.score_signal * weights.signal;
  const riskPenalty = score.score_risk * (weights.risk / 100);
  return Math.max(0, Math.min(100, Math.round(positive / total - riskPenalty)));
}

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const market = searchParams.get('market') ?? 'all';
  const styleParam = searchParams.get('style') ?? 'balanced';
  const style: StyleId = VALID_STYLES.includes(styleParam as StyleId) ? (styleParam as StyleId) : 'balanced';
  const page = Math.max(1, parseInt(searchParams.get('page') ?? '1'));
  const limit = Math.min(200, Math.max(10, parseInt(searchParams.get('limit') ?? '50')));
  const offset = (page - 1) * limit;

  const supabase = createServiceClient();
  const weights = STYLE_WEIGHTS[style];

  // stock_scores + stock_cache JOIN
  let query = supabase
    .from('stock_scores')
    .select(`
      symbol, scored_at, prev_close,
      score_value, score_growth, score_supply, score_momentum, score_risk, score_signal,
      stock_cache!inner(
        symbol, name, market, current_price, price_change_pct,
        per, pbr, roe, market_cap, dividend_yield,
        foreign_net_qty, institution_net_qty, foreign_net_5d, institution_net_5d,
        foreign_streak, institution_streak, short_sell_ratio,
        high_52w, low_52w, forward_per, target_price, invest_opinion,
        signal_count_30d, latest_signal_type, latest_signal_date, latest_signal_price,
        is_managed, volume, updated_at
      )
    `, { count: 'exact' });

  if (market !== 'all') {
    query = query.eq('stock_cache.market', market);
  }

  const { data: rawData, count, error } = await query
    .not('stock_cache.current_price', 'is', null)
    .range(offset, offset + limit - 1);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  // 모멘텀 보정 + 가중치 합산
  const items = (rawData ?? []).map(row => {
    const cache = row.stock_cache as Record<string, unknown>;
    const currentPrice = cache.current_price as number | null;
    const prevClose = row.prev_close as number | null;
    const momentumAdjusted = adjustMomentum(
      row.score_momentum as number,
      currentPrice,
      prevClose,
    );
    const scoreTotal = calcWeightedScore(
      {
        score_value: row.score_value as number,
        score_growth: row.score_growth as number,
        score_supply: row.score_supply as number,
        score_momentum: row.score_momentum as number,
        score_momentum_adjusted: momentumAdjusted,
        score_risk: row.score_risk as number,
        score_signal: row.score_signal as number,
      },
      weights,
    );

    return {
      symbol: row.symbol,
      scored_at: row.scored_at,
      score_total: scoreTotal,
      score_value: row.score_value,
      score_growth: row.score_growth,
      score_supply: row.score_supply,
      score_momentum: momentumAdjusted,
      score_risk: row.score_risk,
      score_signal: row.score_signal,
      // stock_cache 필드
      name: cache.name,
      market: cache.market,
      current_price: currentPrice,
      price_change_pct: cache.price_change_pct,
      per: cache.per,
      pbr: cache.pbr,
      roe: cache.roe,
      market_cap: cache.market_cap,
      dividend_yield: cache.dividend_yield,
      foreign_net_qty: cache.foreign_net_qty,
      institution_net_qty: cache.institution_net_qty,
      foreign_net_5d: cache.foreign_net_5d,
      institution_net_5d: cache.institution_net_5d,
      foreign_streak: cache.foreign_streak,
      institution_streak: cache.institution_streak,
      short_sell_ratio: cache.short_sell_ratio,
      high_52w: cache.high_52w,
      low_52w: cache.low_52w,
      forward_per: cache.forward_per,
      target_price: cache.target_price,
      invest_opinion: cache.invest_opinion,
      signal_count_30d: cache.signal_count_30d,
      latest_signal_type: cache.latest_signal_type,
      latest_signal_date: cache.latest_signal_date,
      latest_signal_price: cache.latest_signal_price,
      is_managed: cache.is_managed,
      volume: cache.volume,
      prices_updated_at: cache.updated_at,
    };
  });

  // 클라이언트에서 가중치 합산 후 정렬
  items.sort((a, b) => b.score_total - a.score_total);

  return NextResponse.json({
    items,
    total: count ?? 0,
    page,
    limit,
    style,
    scored_at: items[0]?.scored_at ?? null,
  });
}
```

- [ ] **Step 2: 타입 호환성 확인**

기존 `StockRankItem` 타입을 참조하는 파일들이 새 응답 구조와 맞는지 확인:

```bash
cd /Users/thlee/GoogleDrive/DashboardStock/web
npm run build 2>&1 | grep "error TS"
```

타입 오류 발생 시 해당 컴포넌트에서 `StockRankItem` import를 새 타입으로 교체.

- [ ] **Step 3: 커밋**

```bash
git add web/src/app/api/v1/stock-ranking/route.ts
git commit -m "refactor: stock-ranking API 경량화 (2102줄 → ~150줄, 외부API 호출 제거)"
```

---

### Task 3: use-global-price-refresh 훅 변경

**Files:**
- Modify: `web/src/hooks/use-global-price-refresh.ts`

현재: `POST /api/v1/prices` 호출 → Naver fetch  
변경: `stock_cache`에서 직접 SELECT

- [ ] **Step 1: 훅 수정**

```typescript
// web/src/hooks/use-global-price-refresh.ts
'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import { getSupabase } from '@/lib/supabase';

export type LivePriceMap = Record<
  string,
  {
    current_price: number;
    price_change: number;
    price_change_pct: number;
    volume: number;
    market_cap: number;
  }
>;

interface UseGlobalPriceRefreshOptions {
  staleMinutes?: number;
  onPricesRefreshed?: (prices: LivePriceMap) => void;
}

export function useGlobalPriceRefresh({
  staleMinutes = 15,
  onPricesRefreshed,
}: UseGlobalPriceRefreshOptions = {}) {
  const [updateTime, setUpdateTime] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const isStale = useMemo(() => {
    if (!updateTime) return true;
    return (Date.now() - new Date(updateTime).getTime()) / 60000 > staleMinutes;
  }, [updateTime, staleMinutes]);

  const refresh = useCallback(async () => {
    setRefreshing(true);
    try {
      // stock_cache에서 직접 조회 (GHA가 15분마다 업데이트)
      const supabase = getSupabase();
      const { data } = await supabase
        .from('stock_cache')
        .select('symbol, current_price, price_change, price_change_pct, volume, market_cap, updated_at')
        .not('current_price', 'is', null);

      if (!data || data.length === 0) return;

      const priceMap: LivePriceMap = {};
      for (const row of data) {
        priceMap[row.symbol as string] = {
          current_price: (row.current_price as number) ?? 0,
          price_change: (row.price_change as number) ?? 0,
          price_change_pct: (row.price_change_pct as number) ?? 0,
          volume: (row.volume as number) ?? 0,
          market_cap: (row.market_cap as number) ?? 0,
        };
      }

      const latestUpdate = data
        .map(r => r.updated_at as string)
        .sort()
        .pop() ?? new Date().toISOString();

      setUpdateTime(latestUpdate);
      onPricesRefreshed?.(priceMap);
    } finally {
      setRefreshing(false);
    }
  }, [onPricesRefreshed]);

  useEffect(() => {
    if (isStale) refresh();
  }, [isStale, refresh]);

  return { updateTime, refreshing, isStale, refresh };
}
```

- [ ] **Step 2: 빌드 확인**

```bash
cd web && npm run build 2>&1 | grep "error TS"
```

- [ ] **Step 3: 커밋**

```bash
git add web/src/hooks/use-global-price-refresh.ts
git commit -m "refactor: 가격 갱신 훅을 /api/v1/prices → stock_cache 직접 조회로 전환"
```

---

### Task 4: market-indicators 직접 조회 훅 추가

**Files:**
- Create: `web/src/hooks/use-market-indicators.ts`

- [ ] **Step 1: 훅 작성**

```typescript
// web/src/hooks/use-market-indicators.ts
'use client';

import { useState, useEffect } from 'react';
import { getSupabase } from '@/lib/supabase';

export interface MarketIndicator {
  indicator_type: string;
  value: number;
  updated_at: string;
}

export function useMarketIndicators() {
  const [indicators, setIndicators] = useState<MarketIndicator[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const supabase = getSupabase();
    supabase
      .from('market_indicators')
      .select('indicator_type, value, updated_at')
      .order('indicator_type')
      .then(({ data }) => {
        setIndicators((data ?? []) as MarketIndicator[]);
        setLoading(false);
      });
  }, []);

  return { indicators, loading };
}
```

- [ ] **Step 2: 커밋**

```bash
git add web/src/hooks/use-market-indicators.ts
git commit -m "feat: use-market-indicators 훅 추가 (market_indicators 직접 조회)"
```

---

### Task 5: 기존 cron 라우트 삭제

**Files:**
- Delete: `web/src/app/api/v1/cron/daily-prices/route.ts`
- Delete: `web/src/app/api/v1/cron/daily-prices-repair/route.ts`
- Delete: `web/src/app/api/v1/cron/market-indicators/route.ts`
- Delete: `web/src/app/api/v1/cron/market-events/route.ts`
- Delete: `web/src/app/api/v1/cron/intraday-prices/route.ts`
- Delete: `web/src/app/api/v1/prices/route.ts`
- Modify: `web/vercel.json` (crons 섹션 제거)

**전제 조건:** GHA 배치가 최소 1회 성공적으로 실행되어 stock_scores 데이터가 있어야 함.

- [ ] **Step 1: GHA 배치 성공 확인**

Supabase 대시보드 → Table Editor → stock_scores → 데이터 존재 확인:
```sql
SELECT COUNT(*) FROM stock_scores;
-- 3000 이상이면 정상
```

- [ ] **Step 2: cron 라우트 파일 삭제**

```bash
cd /Users/thlee/GoogleDrive/DashboardStock
rm web/src/app/api/v1/cron/daily-prices/route.ts
rm web/src/app/api/v1/cron/daily-prices-repair/route.ts
rm web/src/app/api/v1/cron/market-indicators/route.ts
rm web/src/app/api/v1/cron/market-events/route.ts
rm web/src/app/api/v1/cron/intraday-prices/route.ts
rm web/src/app/api/v1/prices/route.ts
```

빈 디렉토리도 정리:
```bash
rmdir web/src/app/api/v1/cron/daily-prices 2>/dev/null
rmdir web/src/app/api/v1/cron/daily-prices-repair 2>/dev/null
rmdir web/src/app/api/v1/cron/market-indicators 2>/dev/null
rmdir web/src/app/api/v1/cron/market-events 2>/dev/null
rmdir web/src/app/api/v1/cron/intraday-prices 2>/dev/null
```

- [ ] **Step 3: vercel.json crons 섹션 제거**

현재 `web/vercel.json`:
```json
{
  "crons": [
    { "path": "/api/v1/cron/daily-prices?mode=sync", "schedule": "30 7 * * 1-5" },
    { "path": "/api/v1/cron/daily-prices?mode=backfill", "schedule": "30 22 * * *" }
  ]
}
```

변경 후:
```json
{}
```

- [ ] **Step 4: 빌드 오류 확인**

```bash
cd web && npm run build 2>&1 | grep "error TS"
```

삭제된 라우트를 import하는 파일이 있으면 수정.

- [ ] **Step 5: 커밋**

```bash
cd /Users/thlee/GoogleDrive/DashboardStock
git add -A
git commit -m "feat: Vercel Cron 라우트 전체 삭제 (GHA로 이관 완료)"
```

---

### Task 6: 최종 검증

- [ ] **Step 1: 빌드 성공 확인**

```bash
cd web && npm run build
```

오류 없이 완료되어야 함.

- [ ] **Step 2: stock-ranking API 응답 확인**

```bash
# 로컬 개발 서버 실행
cd web && npm run dev

# 별도 터미널에서 확인
curl "http://localhost:3000/api/v1/stock-ranking?style=balanced&limit=10" | jq '.items[0]'
```

예상 응답:
```json
{
  "symbol": "005930",
  "name": "삼성전자",
  "score_total": 72,
  "score_value": 65,
  "score_momentum": 58,
  ...
}
```

- [ ] **Step 3: trigger-batch API 테스트**

```bash
curl -X POST http://localhost:3000/api/v1/admin/trigger-batch \
  -H "Authorization: Bearer $CRON_SECRET" \
  -H "Content-Type: application/json" \
  -d '{"mode": "prices-only"}'
```

예상 응답:
```json
{ "ok": true, "runId": "uuid-...", "mode": "prices-only", "date": "(오늘)" }
```

- [ ] **Step 4: 최종 커밋**

```bash
git add -A
git commit -m "feat: GHA 배치 아키텍처 전환 완료 (Plan C)"
```
