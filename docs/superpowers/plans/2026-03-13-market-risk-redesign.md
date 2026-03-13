# 투자 시황 위험 경보 시스템 구현 계획

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 90일 상대 정규화 점수를 절대 임계값 기반 투자 위험 경보 시스템으로 전환하고, VKOSPI·CNN Fear & Greed 지표를 추가하며 VIX 수집 버그를 수정한다.

**Architecture:** `market-thresholds.ts`에 절대 임계값과 위험 지수 계산 로직을 집중시키고, cron route에서 새 지표를 수집해 DB에 저장하며, `market-client.tsx`에서 위험 경보 UI로 재설계한다. 기존 `total_score` 기반 로직은 하위 호환을 위해 보존한다.

**Tech Stack:** Next.js 14 App Router, TypeScript, Supabase, yahoo-finance2, Tailwind CSS

**Spec:** `docs/superpowers/specs/2026-03-13-market-risk-redesign.md`

---

## Chunk 1: 백엔드 — 임계값 로직, 타입, 데이터 수집

### Task 1: `market-thresholds.ts` 신규 작성

**Files:**

- Create: `web/src/lib/market-thresholds.ts`

---

- [ ] **Step 1: 파일 생성 — 임계값 정의 및 `getRiskLevel()` 함수**

`web/src/lib/market-thresholds.ts` 를 아래 내용으로 생성한다:

```typescript
/**
 * 투자 시황 절대 임계값 기반 위험도 계산
 *
 * 레벨: 0=안전, 1=주의, 2=위험, 3=극위험
 * 레벨가중치: 0, 1, 3, 6 (비선형 - 극위험에 민감하게 반응)
 */

export type RiskLevel = 0 | 1 | 2 | 3;

export interface RiskThreshold {
  label: string;
  /** 높을수록 위험(1) vs 낮을수록 위험(-1) */
  direction: 1 | -1;
  /** [주의 하한, 위험 하한, 극위험 하한] — direction=1이면 이 값 이상일 때 해당 레벨 */
  thresholds: [number, number, number];
  /** 위험 지수 계산 시 이 지표의 중요도 가중치 */
  weight: number;
}

export const RISK_THRESHOLDS: Record<string, RiskThreshold> = {
  VIX: {
    label: 'VIX (미국 공포지수)',
    direction: 1,
    thresholds: [20, 25, 30],
    weight: 3,
  },
  VKOSPI: {
    label: 'VKOSPI (한국 공포지수)',
    direction: 1,
    thresholds: [20, 25, 30],
    weight: 3,
  },
  USD_KRW: {
    label: '원/달러 환율',
    direction: 1,
    thresholds: [1350, 1400, 1450],
    weight: 3,
  },
  DXY: {
    label: '달러 인덱스',
    direction: 1,
    thresholds: [100, 104, 108],
    weight: 2,
  },
  US_10Y: {
    label: '미국 10년물 금리',
    direction: 1,
    thresholds: [4.0, 4.5, 5.0],
    weight: 2,
  },
  WTI: {
    label: 'WTI 원유',
    direction: 1,
    thresholds: [70, 80, 95],
    weight: 1,
  },
  KOSPI: {
    label: 'KOSPI',
    direction: -1,
    thresholds: [2600, 2400, 2200],
    weight: 2,
  },
  KOSDAQ: {
    label: 'KOSDAQ',
    direction: -1,
    thresholds: [800, 700, 600],
    weight: 1,
  },
  CNN_FEAR_GREED: {
    label: 'CNN 공포탐욕지수',
    direction: -1,
    thresholds: [60, 40, 20],
    weight: 2,
  },
  EWY: {
    label: 'EWY (한국 ETF)',
    direction: -1,
    thresholds: [65, 55, 45],
    weight: 1,
  },
};

/** 레벨별 가중치 (비선형: 극위험에 민감) */
const LEVEL_WEIGHTS: Record<RiskLevel, number> = { 0: 0, 1: 1, 2: 3, 3: 6 };

/**
 * 단일 지표의 위험 레벨 계산
 * value가 null/undefined이면 null 반환 (계산에서 제외)
 */
export function getRiskLevel(type: string, value: number | null | undefined): RiskLevel | null {
  if (value == null) return null;
  const t = RISK_THRESHOLDS[type];
  if (!t) return null;

  const [l1, l2, l3] = t.thresholds;

  if (t.direction === 1) {
    if (value >= l3) return 3;
    if (value >= l2) return 2;
    if (value >= l1) return 1;
    return 0;
  } else {
    if (value < l3) return 3;
    if (value < l2) return 2;
    if (value < l1) return 1;
    return 0;
  }
}

/**
 * 임계값 설명 문자열 반환 (UI 표시용)
 * 예: "1,450원 초과" / "2,600 이상"
 */
export function getRiskThresholdLabel(type: string, level: RiskLevel): string {
  const t = RISK_THRESHOLDS[type];
  if (!t) return '';
  const [l1, l2, l3] = t.thresholds;

  if (t.direction === 1) {
    if (level === 3) return `${l3.toLocaleString()} 이상`;
    if (level === 2) return `${l2.toLocaleString()}~${l3.toLocaleString()}`;
    if (level === 1) return `${l1.toLocaleString()}~${l2.toLocaleString()}`;
    return `${l1.toLocaleString()} 미만`;
  } else {
    if (level === 3) return `${l3.toLocaleString()} 미만`;
    if (level === 2) return `${l2.toLocaleString()}~${l3.toLocaleString()}`;
    if (level === 1) return `${l1.toLocaleString()}~${l2.toLocaleString()}`;
    return `${l1.toLocaleString()} 이상`;
  }
}

export interface RiskIndexResult {
  /** 0~100, 높을수록 위험 */
  riskIndex: number;
  /** 위험 레벨 breakdown */
  breakdown: Record<string, { level: RiskLevel; value: number }>;
  /** 데이터 있는 지표 수 */
  validCount: number;
  /** 위험(2) 이상 지표 수 */
  dangerCount: number;
}

/**
 * 전체 위험 지수 계산 (0~100, 높을수록 위험)
 * 데이터 없는 지표는 분자/분모 모두에서 제외
 */
export function calculateRiskIndex(
  values: Record<string, number | null | undefined>
): RiskIndexResult {
  let weightedSum = 0;
  let maxPossible = 0;
  let validCount = 0;
  let dangerCount = 0;
  const breakdown: Record<string, { level: RiskLevel; value: number }> = {};

  for (const [type, threshold] of Object.entries(RISK_THRESHOLDS)) {
    const value = values[type];
    const level = getRiskLevel(type, value);
    if (level === null || value == null) continue;

    validCount++;
    weightedSum += LEVEL_WEIGHTS[level] * threshold.weight;
    maxPossible += LEVEL_WEIGHTS[3] * threshold.weight; // 6 × weight
    breakdown[type] = { level, value };
    if (level >= 2) dangerCount++;
  }

  const riskIndex = maxPossible > 0
    ? Math.round((weightedSum / maxPossible) * 10000) / 100
    : 0;

  return { riskIndex, breakdown, validCount, dangerCount };
}

export interface RiskInterpretation {
  label: string;
  color: string;
  action: string;
}

export const RISK_INTERPRETATIONS: RiskInterpretation[] = [
  { label: '안전',   color: '#10b981', action: '적극 매수 가능' },
  { label: '주의',   color: '#eab308', action: '분할 매수, 비중 조절' },
  { label: '위험',   color: '#f97316', action: '신규 진입 자제, 방어적 투자' },
  { label: '극위험', color: '#ef4444', action: '현금 비중 확대, 손절 검토' },
];

export function getRiskInterpretation(riskIndex: number): RiskInterpretation {
  if (riskIndex >= 75) return RISK_INTERPRETATIONS[3];
  if (riskIndex >= 50) return RISK_INTERPRETATIONS[2];
  if (riskIndex >= 25) return RISK_INTERPRETATIONS[1];
  return RISK_INTERPRETATIONS[0];
}
```

- [ ] **Step 2: 타입 체크**

```bash
cd /Users/thlee/GoogleDrive/DashboardStock/web
npx tsc --noEmit 2>&1 | head -30
```

오류 없으면 통과. `market-thresholds.ts` 관련 타입 오류만 수정한다.

- [ ] **Step 3: 커밋**

```bash
git add web/src/lib/market-thresholds.ts
git commit -m "feat: 절대 임계값 기반 위험 지수 계산 함수 추가 (market-thresholds.ts)"
```

---

### Task 2: `market.ts` 타입 수정

**Files:**

- Modify: `web/src/types/market.ts`

---

- [ ] **Step 1: `IndicatorType`에 VKOSPI, CNN_FEAR_GREED 추가**

`web/src/types/market.ts` 파일에서 `IndicatorType` union을 수정한다:

```typescript
export type IndicatorType =
  | 'VIX'
  | 'USD_KRW'
  | 'US_10Y'
  | 'WTI'
  | 'KOSPI'
  | 'KOSDAQ'
  | 'GOLD'
  | 'DXY'
  | 'KR_3Y'
  | 'KORU'
  | 'EWY'
  | 'FEAR_GREED'
  | 'VKOSPI'        // 추가: 한국 공포지수
  | 'CNN_FEAR_GREED'; // 추가: CNN 공포탐욕지수
```

- [ ] **Step 2: `YAHOO_TICKERS`에 VKOSPI 추가**

```typescript
export const YAHOO_TICKERS: Record<string, string> = {
  VIX: '^VIX',
  USD_KRW: 'KRW=X',
  US_10Y: '^TNX',
  WTI: 'CL=F',
  KOSPI: '^KS11',
  KOSDAQ: '^KQ11',
  GOLD: 'GC=F',
  DXY: 'DX-Y.NYB',
  KR_3Y: '122630.KS',
  KORU: 'KORU',
  EWY: 'EWY',
  VKOSPI: '^VKOSPI', // 추가
};
```

- [ ] **Step 3: `MarketScoreHistory` 인터페이스에 `risk_index` 추가**

```typescript
export interface MarketScoreHistory {
  id: string;
  date: string;
  total_score: number;
  breakdown: Record<string, {
    indicator_type: IndicatorType;
    value: number;
    normalized: number;
    weighted_score: number;
    weight: number;
    direction: number;
  }>;
  weights_snapshot: Record<string, number>;
  event_risk_score: number | null;
  combined_score: number | null;
  risk_index: number | null; // 추가
}
```

- [ ] **Step 4: 타입 체크**

```bash
cd /Users/thlee/GoogleDrive/DashboardStock/web
npx tsc --noEmit 2>&1 | head -30
```

- [ ] **Step 5: 커밋**

```bash
git add web/src/types/market.ts
git commit -m "feat: IndicatorType에 VKOSPI, CNN_FEAR_GREED 추가 및 MarketScoreHistory.risk_index 추가"
```

---

### Task 3: DB 마이그레이션

**Files:**

- Create: `web/migrations/add_risk_index.sql`

---

- [ ] **Step 1: 마이그레이션 파일 생성**

```sql
-- market_score_history 테이블에 risk_index 컬럼 추가
-- DEFAULT NULL: 기존 레코드 하위 호환, 이전 히스토리는 null로 표시
ALTER TABLE market_score_history
  ADD COLUMN IF NOT EXISTS risk_index NUMERIC DEFAULT NULL;
```

파일을 `web/migrations/add_risk_index.sql`로 저장한다.

- [ ] **Step 2: Supabase SQL 에디터에서 실행**

Supabase 대시보드 → SQL Editor → 위 SQL 실행.
또는 CLI: `npx supabase db push` (환경 설정이 되어 있는 경우).

실행 후 확인:
```sql
SELECT column_name, data_type, column_default
FROM information_schema.columns
WHERE table_name = 'market_score_history' AND column_name = 'risk_index';
```

- [ ] **Step 3: 커밋**

```bash
git add web/migrations/add_risk_index.sql
git commit -m "feat: market_score_history에 risk_index 컬럼 추가 마이그레이션"
```

---

### Task 4: cron route 수정 (VIX 버그 수정 + 새 지표 + risk_index 저장)

**Files:**

- Modify: `web/src/lib/yahoo-finance.ts`
- Modify: `web/src/app/api/v1/cron/market-indicators/route.ts`

---

- [ ] **Step 1: `yahoo-finance.ts` — VIX 폴백 수정**

`web/src/lib/yahoo-finance.ts`의 `getQuote()` 함수를 수정한다:

```typescript
export async function getQuote(ticker: string): Promise<QuoteResult | null> {
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result: any = await yahooFinance.quote(ticker);
    if (!result) return null;

    // VIX 등 일부 지수는 regularMarketPrice가 null인 경우 있음
    // regularMarketPreviousClose → regularMarketOpen 순으로 폴백
    const price =
      result.regularMarketPrice ??
      result.regularMarketPreviousClose ??
      result.regularMarketOpen ??
      null;

    if (price == null) {
      console.warn(`[yahoo-finance] ${ticker}: 가격 필드 모두 null`);
      return null;
    }

    return {
      price,
      previousClose: result.regularMarketPreviousClose ?? price,
      changePct: result.regularMarketChangePercent ?? 0,
      name: result.shortName ?? result.longName ?? ticker,
    };
  } catch (e) {
    console.error(`Yahoo Finance quote(${ticker}) failed:`, e);
    return null;
  }
}
```

- [ ] **Step 2: cron route — CNN Fear & Greed fetch 함수 추가**

`web/src/app/api/v1/cron/market-indicators/route.ts` 파일 상단 import 아래에 다음 함수를 추가한다:

```typescript
/**
 * CNN Fear & Greed Index 조회 (비공식 API)
 * 실패 시 null 반환
 */
async function fetchCnnFearGreed(): Promise<number | null> {
  try {
    const res = await fetch(
      'https://production.dataviz.cnn.io/index/fearandgreed/graphdata/',
      { signal: AbortSignal.timeout(8000) }
    );
    if (!res.ok) return null;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const json: any = await res.json();
    const score = json?.fear_and_greed?.score;
    if (typeof score !== 'number' || score < 0 || score > 100) return null;
    return Math.round(score * 100) / 100;
  } catch {
    return null;
  }
}
```

- [ ] **Step 3: cron route — VKOSPI 수집 및 CNN_FEAR_GREED 저장**

cron route의 `Step 1b` Yahoo 호출 부분에서 `tickerEntries`는 이미 `YAHOO_TICKERS`를 순회하므로, `YAHOO_TICKERS`에 `VKOSPI`를 추가한 Task 2 이후 자동으로 수집된다. 추가 변경 없음.

`Step 1c` 이후, `upsertRows` 처리 아래에 CNN Fear & Greed 수집 코드를 추가한다:

```typescript
// Step 1d: CNN Fear & Greed 수집
const cnnScore = await fetchCnnFearGreed();
// CNN 실패 시 기존 FEAR_GREED(VIX 기반)로 폴백 — Step 5에서 FEAR_GREED 생성 후 대입
const cnnFearGreedValue = cnnScore; // null이면 Step 5 이후 폴백 처리
if (cnnFearGreedValue !== null) {
  upsertRows.push({
    date: today,
    indicator_type: 'CNN_FEAR_GREED' as IndicatorType,
    value: cnnFearGreedValue,
    raw_data: { source: 'cnn', method: 'api' },
  });
  results['CNN_FEAR_GREED'] = cnnFearGreedValue;
}
```

- [ ] **Step 4: cron route — 파일 상단 import 추가**

`web/src/app/api/v1/cron/market-indicators/route.ts` 파일 상단 import 블록에 다음을 추가한다:

```typescript
import { calculateRiskIndex, RISK_THRESHOLDS } from '@/lib/market-thresholds';
```

- [ ] **Step 5: cron route — risk_index 계산 및 저장**

기존 `Step 5` (FEAR_GREED 저장 블록) 직후에 다음을 추가한다.
**주의: Step 5의 `fearGreed` 변수가 이미 계산된 이후**여야 CNN 폴백에 재사용할 수 있다:

```typescript
// risk_index 계산 (Step 5의 fearGreed가 이미 계산된 이후)
const riskValues: Record<string, number | null> = {};
for (const type of Object.keys(RISK_THRESHOLDS)) {
  riskValues[type] = results[type] ?? null;
}
// CNN_FEAR_GREED 누락 시 Step 5에서 계산된 fearGreed 폴백
if (riskValues['CNN_FEAR_GREED'] == null && vixData) {
  riskValues['CNN_FEAR_GREED'] = fearGreed; // fearGreed는 Step 5에서 이미 계산됨
}
const { riskIndex } = calculateRiskIndex(riskValues);
```

그리고 같은 블록 바로 아래의 `supabase.from('market_score_history').upsert(...)` 호출에 `risk_index` 필드를 추가한다:

```typescript
await supabase.from('market_score_history').upsert(
  {
    date: today,
    total_score: totalScore,
    breakdown,
    weights_snapshot: weightsSnapshot,
    event_risk_score: eventRiskScore,
    combined_score: combinedScore,
    risk_index: riskIndex, // 추가
  },
  { onConflict: 'date' }
);
```

- [ ] **Step 6: 타입 체크**

```bash
cd /Users/thlee/GoogleDrive/DashboardStock/web
npx tsc --noEmit 2>&1 | head -40
```

타입 오류 수정 후 통과.

- [ ] **Step 7: 커밋**

```bash
git add web/src/lib/yahoo-finance.ts web/src/app/api/v1/cron/market-indicators/route.ts
git commit -m "feat: VIX 수집 폴백 수정, VKOSPI/CNN Fear&Greed 추가, risk_index cron 저장"
```

---

### Task 5: `market/page.tsx` 서버 데이터 조회 수정

**Files:**

- Modify: `web/src/app/market/page.tsx`

---

- [ ] **Step 1: scoreHistory 쿼리에 `risk_index` 추가**

`web/src/app/market/page.tsx` 에서 `scoreHistory` 쿼리를 수정한다:

```typescript
supabase.from("market_score_history")
  .select("date, total_score, breakdown, event_risk_score, combined_score, risk_index")
  .order("date", { ascending: false }).limit(90),
```

- [ ] **Step 2: 불필요 쿼리 및 props 제거**

Task 6의 새 `MarketClient`는 `weights`와 `indicatorRanges`를 사용하지 않는다. `page.tsx`에서 다음 항목을 제거한다:

1. `Promise.all` 배열에서 `indicator_weights` 쿼리 제거 (`{ data: weights }` 항목)
2. `allHistory` 쿼리 제거 (`{ data: allHistory }` 항목 — `indicatorRanges` 계산용)
3. `indicatorRanges` 집계 for 루프 제거
4. `MarketClient` 호출에서 `weights={weights || []}`, `indicatorRanges={indicatorRanges}` prop 제거

제거 후 `MarketClient` 호출:

```tsx
<MarketClient
  indicators={indicators || []}
  scoreHistory={scoreHistory || []}
  events={events || []}
/>
```

- [ ] **Step 3: 타입 체크**

```bash
cd /Users/thlee/GoogleDrive/DashboardStock/web
npx tsc --noEmit 2>&1 | head -20
```

- [ ] **Step 4: 커밋**

```bash
git add web/src/app/market/page.tsx
git commit -m "feat: market page 불필요 쿼리 제거 및 scoreHistory에 risk_index 추가"
```

---

## Chunk 2: 프론트엔드 — `market-client.tsx` UI 재설계

### Task 6: `market-client.tsx` 전면 재설계

**Files:**

- Modify: `web/src/components/market/market-client.tsx`

---

- [ ] **Step 1: Props 타입 및 import 수정**

파일 상단을 다음으로 교체한다:

```typescript
"use client";

import { useMemo } from "react";
import {
  Activity, DollarSign, TrendingUp, TrendingDown, BarChart3,
  Gauge, Droplets, Globe, Landmark, Flame, ShieldAlert,
  ShieldCheck, ShieldX, OctagonAlert,
} from "lucide-react";
import {
  getRiskLevel, getRiskInterpretation, getRiskThresholdLabel,
  calculateRiskIndex, RISK_THRESHOLDS,
  type RiskLevel,
} from "@/lib/market-thresholds";
import {
  getScoreInterpretation,
  type MarketScoreHistory,
} from "@/types/market";
import type { MarketEvent } from "@/types/market-event";
import { EventCalendar } from "./event-calendar";

interface IndicatorRow {
  indicator_type: string;
  value: number;
  prev_value: number | null;
  change_pct: number | null;
  date: string;
}

interface Props {
  indicators: IndicatorRow[];
  scoreHistory: Pick<MarketScoreHistory, "date" | "total_score" | "event_risk_score" | "combined_score" | "risk_index">[];
  events: MarketEvent[];
}
```

- [ ] **Step 2: 아이콘 매핑 및 포맷 함수 유지**

기존 `INDICATOR_ICONS`와 `formatValue` 함수는 그대로 유지한다. `ScoreGauge`, `NormalizedBar` 컴포넌트는 **삭제**한다.

- [ ] **Step 3: 위험 레벨 배지 컴포넌트 추가**

```typescript
const LEVEL_COLORS: Record<RiskLevel, { bg: string; text: string; border: string }> = {
  0: { bg: "bg-emerald-900/20", text: "text-emerald-400", border: "border-emerald-800/40" },
  1: { bg: "bg-yellow-900/20",  text: "text-yellow-400",  border: "border-yellow-800/40" },
  2: { bg: "bg-orange-900/20",  text: "text-orange-400",  border: "border-orange-800/40" },
  3: { bg: "bg-red-900/20",     text: "text-red-400",     border: "border-red-800/40" },
};
const LEVEL_LABELS: Record<RiskLevel, string> = { 0: "안전", 1: "주의", 2: "위험", 3: "극위험" };

function RiskBadge({ level }: { level: RiskLevel }) {
  const c = LEVEL_COLORS[level];
  return (
    <span className={`text-xs px-2 py-0.5 rounded-full font-semibold border ${c.bg} ${c.text} ${c.border}`}>
      {LEVEL_LABELS[level]}
    </span>
  );
}
```

- [ ] **Step 4: 경보 배너 컴포넌트 추가**

```typescript
function RiskAlertBanner({
  riskIndex, dangerCount, validCount,
}: {
  riskIndex: number;
  dangerCount: number;
  validCount: number;
}) {
  const interp = getRiskInterpretation(riskIndex);
  const level = riskIndex >= 75 ? 3 : riskIndex >= 50 ? 2 : riskIndex >= 25 ? 1 : 0;
  const Icon = level >= 3 ? ShieldX : level >= 2 ? OctagonAlert : level >= 1 ? ShieldAlert : ShieldCheck;

  return (
    <div
      className="card p-6 flex flex-col sm:flex-row items-start sm:items-center gap-4"
      style={{ borderColor: interp.color + "60", background: interp.color + "08" }}
    >
      <Icon className="w-10 h-10 shrink-0" style={{ color: interp.color }} />
      <div className="flex-1">
        <div className="flex items-center gap-3 flex-wrap">
          <span className="text-2xl font-bold" style={{ color: interp.color }}>
            {interp.label}
          </span>
          <span
            className="text-3xl font-black tabular-nums"
            style={{ color: interp.color }}
          >
            {riskIndex.toFixed(1)}
          </span>
          <span className="text-sm text-[var(--muted)]">/ 100</span>
        </div>
        <p className="text-sm text-[var(--muted)] mt-1">
          {validCount}개 지표 중 {dangerCount}개가 위험 구간 · {interp.action}
        </p>
      </div>
    </div>
  );
}
```

- [ ] **Step 5: 요약 카드 3개 컴포넌트 추가**

```typescript
function SummaryCard({
  title, value, sub, color,
}: {
  title: string;
  value: string | number;
  sub: string;
  color: string;
}) {
  return (
    <div className="card p-4">
      <div className="text-xs text-[var(--muted)] mb-1">{title}</div>
      <div className="text-xl font-bold tabular-nums" style={{ color }}>{value}</div>
      <div className="text-xs text-[var(--muted)] mt-1">{sub}</div>
    </div>
  );
}
```

- [ ] **Step 6: 지표 행 컴포넌트 추가**

```typescript
function IndicatorRow({
  ind, level,
}: {
  ind: IndicatorRow;
  level: RiskLevel | null;
}) {
  const t = RISK_THRESHOLDS[ind.indicator_type];
  const changePct = ind.change_pct ?? 0;
  const isUp = changePct > 0;
  const isDown = changePct < 0;
  const thresholdLabel = level !== null ? getRiskThresholdLabel(ind.indicator_type, level) : null;

  return (
    <div className="px-4 py-3 flex items-center gap-3 flex-wrap hover:bg-[var(--card-hover)] transition-colors">
      {/* 레벨 배지 */}
      <div className="w-14 shrink-0">
        {level !== null ? <RiskBadge level={level} /> : (
          <span className="text-xs text-[var(--muted)]">-</span>
        )}
      </div>

      {/* 지표명 */}
      <div className="flex-1 min-w-[6rem]">
        <span className="text-sm font-medium">{t?.label ?? ind.indicator_type}</span>
        <span className="text-xs text-[var(--muted)] ml-1.5">{ind.indicator_type}</span>
      </div>

      {/* 현재값 */}
      <span className="text-sm font-bold tabular-nums">
        {formatValue(ind.indicator_type, ind.value)}
      </span>

      {/* 변화율 */}
      <span className={`text-xs tabular-nums ${isUp ? "text-red-400" : isDown ? "text-blue-400" : "text-[var(--muted)]"}`}>
        {changePct > 0 ? "+" : ""}{changePct.toFixed(2)}%
      </span>

      {/* 임계값 기준 */}
      {thresholdLabel && (
        <span className="text-xs text-[var(--muted)] ml-auto">기준: {thresholdLabel}</span>
      )}
    </div>
  );
}
```

- [ ] **Step 7: 히스토리 차트 컴포넌트 수정**

기존 `recentHistory` 차트에서 `risk_index`를 사용하도록 수정한다. `risk_index`가 null이면 `combined_score`로 폴백:

```typescript
function RiskHistoryChart({ history }: {
  history: Pick<MarketScoreHistory, "date" | "total_score" | "risk_index">[];
}) {
  const reversed = [...history].reverse();
  return (
    <div className="card p-4 overflow-x-auto">
      <div className="flex items-end gap-1 h-40 min-w-[600px]">
        {reversed.map((entry) => {
          const val = entry.risk_index ?? null;
          if (val === null) return (
            <div key={entry.date} className="flex-1 flex flex-col items-center">
              <div className="w-full rounded-t bg-[var(--border)]" style={{ height: "4px" }} />
            </div>
          );
          const interp = getRiskInterpretation(val);
          const height = Math.max(4, val);
          return (
            <div key={entry.date} className="flex-1 flex flex-col items-center gap-1 group relative">
              <div className="absolute bottom-full mb-2 hidden group-hover:block z-10">
                <div className="bg-[#1e293b] border border-[var(--border)] rounded-lg px-3 py-2 text-xs whitespace-nowrap shadow-lg">
                  <div className="font-medium">{entry.date}</div>
                  <div style={{ color: interp.color }}>
                    위험지수 {val.toFixed(1)} - {interp.label}
                  </div>
                </div>
              </div>
              <div
                className="w-full rounded-t transition-all duration-300 hover:opacity-80"
                style={{ height: `${height}%`, background: interp.color, minHeight: "4px" }}
              />
            </div>
          );
        })}
      </div>
      <div className="flex gap-1 mt-2 min-w-[600px]">
        {reversed.map((entry, i) => (
          <div key={entry.date} className="flex-1 text-center">
            {i % 5 === 0 && (
              <span className="text-[10px] text-[var(--muted)]">{entry.date.slice(5)}</span>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
```

- [ ] **Step 8: 메인 `MarketClient` 컴포넌트 재작성**

기존 `MarketClient` 함수 전체를 아래로 교체한다:

```typescript
export function MarketClient({ indicators, scoreHistory, events }: Props) {
  // 현재 지표값 맵
  const valueMap = useMemo(() => {
    const m: Record<string, number> = {};
    for (const ind of indicators) m[ind.indicator_type] = ind.value;
    return m;
  }, [indicators]);

  // 위험 지수 계산
  const { riskIndex, breakdown, validCount, dangerCount } = useMemo(
    () => calculateRiskIndex(valueMap),
    [valueMap]
  );

  // 최신 risk_index (DB 저장값 있으면 사용, 없으면 실시간 계산값)
  const displayRiskIndex = useMemo(() => {
    if (scoreHistory.length > 0 && scoreHistory[0].risk_index != null) {
      return scoreHistory[0].risk_index;
    }
    return riskIndex;
  }, [scoreHistory, riskIndex]);

  // 이벤트 리스크
  const latestEventRisk = scoreHistory[0]?.event_risk_score ?? null;
  const eventInterp = latestEventRisk != null ? getScoreInterpretation(latestEventRisk) : null;

  // 7일 추이 (위험 레벨 변화)
  const trend7d = useMemo(() => {
    const recent = scoreHistory.slice(0, 7).map(h => h.risk_index).filter((v): v is number => v != null);
    if (recent.length < 2) return null;
    const diff = recent[0] - recent[recent.length - 1];
    return diff;
  }, [scoreHistory]);

  // 지표 정렬: 위험 레벨 내림차순
  const sortedIndicators = useMemo(() => {
    return [...indicators].sort((a, b) => {
      const la = breakdown[a.indicator_type]?.level ?? -1;
      const lb = breakdown[b.indicator_type]?.level ?? -1;
      return lb - la;
    });
  }, [indicators, breakdown]);

  const recentHistory = scoreHistory.slice(0, 30);

  return (
    <div className="space-y-6">
      {/* 페이지 제목 */}
      <div>
        <h1 className="text-2xl font-bold">투자 시황</h1>
        <p className="text-sm text-[var(--muted)] mt-1">절대 임계값 기반 위험 경보</p>
      </div>

      {/* 경보 배너 */}
      <RiskAlertBanner
        riskIndex={displayRiskIndex}
        dangerCount={dangerCount}
        validCount={validCount}
      />

      {/* 요약 카드 3개 */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <SummaryCard
          title="위험 지표"
          value={`${dangerCount} / ${validCount}`}
          sub="위험(🟠) 이상 지표 수"
          color={dangerCount >= 4 ? "#ef4444" : dangerCount >= 2 ? "#f97316" : "#10b981"}
        />
        <SummaryCard
          title="이벤트 리스크"
          value={latestEventRisk != null ? `${latestEventRisk.toFixed(0)}점` : "-"}
          sub={eventInterp?.label ?? "데이터 없음"}
          color={eventInterp?.color ?? "var(--muted)"}
        />
        <SummaryCard
          title="7일 추이"
          value={
            trend7d == null ? "-"
            : trend7d > 0 ? `▲ ${trend7d.toFixed(1)}`
            : trend7d < 0 ? `▼ ${Math.abs(trend7d).toFixed(1)}`
            : "→ 보합"
          }
          sub={
            trend7d == null ? "데이터 없음"
            : trend7d > 2 ? "위험도 상승 중"
            : trend7d < -2 ? "위험도 하락 중"
            : "안정적"
          }
          color={
            trend7d == null ? "var(--muted)"
            : trend7d > 5 ? "#ef4444"
            : trend7d > 2 ? "#f97316"
            : trend7d < -2 ? "#10b981"
            : "var(--muted)"
          }
        />
      </div>

      {/* 지표별 위험 현황 */}
      <section>
        <h2 className="text-lg font-semibold mb-3">지표별 위험 현황</h2>
        <div className="card divide-y divide-[var(--border)] overflow-hidden">
          {sortedIndicators.map((ind) => {
            const level = breakdown[ind.indicator_type]?.level ?? getRiskLevel(ind.indicator_type, ind.value);
            return (
              <IndicatorRow key={ind.indicator_type} ind={ind} level={level} />
            );
          })}
        </div>
      </section>

      {/* 최근 30일 위험 지수 추이 */}
      {recentHistory.length > 0 && (
        <section>
          <h2 className="text-lg font-semibold mb-3">최근 30일 위험 지수 추이</h2>
          <RiskHistoryChart history={recentHistory} />
        </section>
      )}

      {/* 예정 이벤트 */}
      {events.length > 0 && <EventCalendar events={events} />}
    </div>
  );
}
```

- [ ] **Step 9: 타입 체크**

```bash
cd /Users/thlee/GoogleDrive/DashboardStock/web
npx tsc --noEmit 2>&1 | head -50
```

모든 타입 오류 수정 후 통과.

- [ ] **Step 10: 빌드 확인**

```bash
cd /Users/thlee/GoogleDrive/DashboardStock/web
npm run build 2>&1 | tail -20
```

빌드 성공 확인.

- [ ] **Step 11: 커밋**

```bash
git add web/src/components/market/market-client.tsx
git commit -m "feat: market-client UI 전면 재설계 — 위험 경보 배너, 지표별 위험 레벨 표시"
```

---

## 검증

- [ ] **로컬 서버 실행 후 `/market` 페이지 접속**

```bash
cd /Users/thlee/GoogleDrive/DashboardStock/web
npm run dev
```

확인 항목:

1. 경보 배너에 위험 지수와 단계(안전/주의/위험/극위험)가 표시되는가
2. USD/KRW가 1,400원 이상이면 🟠 위험 이상으로 표시되는가
3. VIX 데이터가 있으면 카드에 표시되는가 (없으면 "-"로 표시)
4. 지표 목록이 위험 레벨 내림차순으로 정렬되는가
5. 히스토리 차트에서 `risk_index` null인 항목은 낮은 회색 바로 표시되는가

- [ ] **cron 수동 트리거 (VIX 수집 확인)**

```bash
curl -X POST https://<your-domain>/api/v1/cron/market-indicators \
  -H "Authorization: Bearer $CRON_SECRET"
```

응답에서 `indicators` 수가 이전보다 증가했는지 확인 (VKOSPI 추가).
Supabase에서 `SELECT indicator_type, value FROM market_indicators WHERE date = TODAY ORDER BY indicator_type` 로 VIX, VKOSPI 데이터 확인.
