# 시장 이벤트 리스크 스코어 구현 계획

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 선물옵션 만기일, 경제이벤트, 공휴일을 자동 수집하여 리스크 점수화하고, 기존 마켓 스코어와 통합한 3-레이어 시장 스코어 시스템을 구축한다. 기존 50점 고정 버그도 수정한다.

**Architecture:** `market_events` 단일 테이블에 모든 이벤트를 통합 저장. 규칙 기반(만기일) + Nager.Date API(공휴일) + FRED API(경제이벤트)로 자동 수집. 이벤트 리스크 스코어를 계산하여 기존 마켓 스코어와 0.7/0.3 가중 합산한 통합 스코어를 산출.

**Tech Stack:** Next.js 16 (App Router), Supabase PostgreSQL, TypeScript, Tailwind CSS v4

**Spec:** `docs/superpowers/specs/2026-03-11-market-events-risk-score-design.md`

---

## 파일 구조

### 신규 파일

| 파일 | 역할 |
| --- | --- |
| `supabase/migrations/021_market_events.sql` | market_events 테이블 + RLS + 트리거 + score_history 확장 |
| `web/src/types/market-event.ts` | MarketEvent 타입 및 상수 정의 |
| `web/src/lib/market-events.ts` | 만기일 계산, 공휴일/경제이벤트 수집, 리스크 스코어 계산 |
| `web/src/app/api/v1/cron/market-events/route.ts` | 이벤트 수집 크론 엔드포인트 |
| `web/src/app/api/v1/market-events/route.ts` | 이벤트 CRUD API |
| `web/src/components/market/event-calendar.tsx` | 이벤트 캘린더 컴포넌트 (market 페이지용) |
| `web/src/components/market/event-summary-card.tsx` | 이벤트 요약 카드 (대시보드용) |
| `data/economic-calendar.json` | 경제이벤트 fallback 수동 관리 파일 |

### 수정 파일

| 파일 | 변경 내용 |
| --- | --- |
| `web/src/types/market.ts` | MarketScoreHistory에 event_risk_score, combined_score 추가 |
| `web/src/lib/market-score.ts` | calculateEventRiskScore, calculateCombinedScore 함수 추가 |
| `web/src/components/market/market-client.tsx` | 50점 버그 수정 + 3-스코어 표시 + 이벤트 섹션 |
| `web/src/app/market/page.tsx` | 이벤트 데이터 로드 + min/max 전달 + 이벤트 리스크 스코어 전달 |
| `web/src/app/page.tsx` | 이벤트 요약 카드 + 통합 스코어 표시 |
| `web/src/app/api/v1/cron/market-indicators/route.ts` | 이벤트 리스크 + 통합 스코어 계산/저장 추가 |
| `scripts/run-migrations.sh` | migration 021 추가 |

---

## Chunk 1: 데이터 레이어 (DB + 타입 + 유틸)

### Task 1: DB 마이그레이션 파일 생성

**Files:**

- Create: `supabase/migrations/021_market_events.sql`
- Modify: `scripts/run-migrations.sh`

- [ ] **Step 1: market_events 테이블 마이그레이션 작성**

```sql
-- supabase/migrations/021_market_events.sql

-- 1. market_events 테이블
CREATE TABLE IF NOT EXISTS market_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_date DATE NOT NULL,
  event_type TEXT NOT NULL,
  event_category TEXT NOT NULL,
  title TEXT NOT NULL,
  description TEXT,
  country TEXT DEFAULT 'KR',
  impact_level INTEGER DEFAULT 1,
  risk_score NUMERIC(5,2) DEFAULT 0,
  source TEXT NOT NULL,
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(event_date, event_type, title)
);

CREATE INDEX IF NOT EXISTS idx_market_events_date ON market_events(event_date);
CREATE INDEX IF NOT EXISTS idx_market_events_category ON market_events(event_category);

-- updated_at 자동 갱신 트리거
CREATE OR REPLACE FUNCTION update_market_events_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_market_events_updated_at
  BEFORE UPDATE ON market_events
  FOR EACH ROW EXECUTE FUNCTION update_market_events_updated_at();

-- RLS
ALTER TABLE market_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY "market_events_read" ON market_events FOR SELECT USING (true);
CREATE POLICY "market_events_service_write" ON market_events FOR INSERT WITH CHECK (true);
CREATE POLICY "market_events_service_update" ON market_events FOR UPDATE USING (true);
CREATE POLICY "market_events_service_delete" ON market_events FOR DELETE USING (true);

-- 2. market_score_history 확장
ALTER TABLE market_score_history
  ADD COLUMN IF NOT EXISTS event_risk_score NUMERIC(5,2),
  ADD COLUMN IF NOT EXISTS combined_score NUMERIC(5,2);
```

- [ ] **Step 2: run-migrations.sh에 021 추가**

`scripts/run-migrations.sh`의 MIGRATIONS 배열에 추가:

```bash
MIGRATIONS=(
  "014_market_indicators.sql"
  "015_watchlist.sql"
  "016_stock_cache.sql"
  "017_market_score_history.sql"
  "021_market_events.sql"
)
```

마이그레이션 목록 섹션에도 추가:

```
echo "5. 021_market_events.sql     - 시장 이벤트 테이블 + 점수 이력 확장"
```

- [ ] **Step 3: 커밋**

```bash
git add supabase/migrations/021_market_events.sql scripts/run-migrations.sh
git commit -m "feat: add market_events migration and score_history extension"
```

---

### Task 2: MarketEvent 타입 정의

**Files:**

- Create: `web/src/types/market-event.ts`

- [ ] **Step 1: 타입 파일 작성**

```typescript
// web/src/types/market-event.ts

export type EventType =
  | 'futures_expiry'
  | 'options_expiry'
  | 'simultaneous_expiry'
  | 'holiday'
  | 'fomc'
  | 'cpi'
  | 'employment'
  | 'gdp'
  | 'earnings'
  | 'ipo'
  | 'custom';

export type EventCategory = 'derivatives' | 'holiday' | 'economic' | 'corporate';

export type EventSource = 'rule_based' | 'nager_date' | 'fred_api' | 'manual';

export interface MarketEvent {
  id: string;
  event_date: string; // YYYY-MM-DD
  event_type: EventType;
  event_category: EventCategory;
  title: string;
  description: string | null;
  country: string;
  impact_level: number;
  risk_score: number;
  source: EventSource;
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

// 이벤트 유형별 기본 리스크 점수 매핑
export const EVENT_RISK_DEFAULTS: Record<EventType, { impact_level: number; risk_score: number; category: EventCategory }> = {
  simultaneous_expiry: { impact_level: 5, risk_score: -20, category: 'derivatives' },
  futures_expiry:      { impact_level: 3, risk_score: -10, category: 'derivatives' },
  options_expiry:      { impact_level: 2, risk_score: -5,  category: 'derivatives' },
  fomc:                { impact_level: 5, risk_score: -15, category: 'economic' },
  cpi:                 { impact_level: 4, risk_score: -12, category: 'economic' },
  employment:          { impact_level: 4, risk_score: -10, category: 'economic' },
  gdp:                 { impact_level: 3, risk_score: -8,  category: 'economic' },
  holiday:             { impact_level: 1, risk_score: 0,   category: 'holiday' },
  earnings:            { impact_level: 3, risk_score: -5,  category: 'corporate' },
  ipo:                 { impact_level: 2, risk_score: -3,  category: 'corporate' },
  custom:              { impact_level: 1, risk_score: 0,   category: 'corporate' },
};

// 카테고리 라벨
export const EVENT_CATEGORY_LABELS: Record<EventCategory, string> = {
  derivatives: '파생상품',
  holiday: '휴장',
  economic: '경제지표',
  corporate: '기업',
};

// 영향도 라벨
export function getImpactLabel(level: number): { label: string; color: string } {
  if (level >= 5) return { label: '매우 높음', color: '#ef4444' };
  if (level >= 4) return { label: '높음', color: '#f97316' };
  if (level >= 3) return { label: '보통', color: '#eab308' };
  if (level >= 2) return { label: '낮음', color: '#6b7280' };
  return { label: '미미', color: '#4b5563' };
}
```

- [ ] **Step 2: 커밋**

```bash
git add web/src/types/market-event.ts
git commit -m "feat: add MarketEvent types and risk score defaults"
```

---

### Task 3: MarketScoreHistory 타입 확장

**Files:**

- Modify: `web/src/types/market.ts:47-60`

- [ ] **Step 1: MarketScoreHistory 인터페이스에 필드 추가**

`web/src/types/market.ts` 수정 — `MarketScoreHistory` 인터페이스에 2개 필드 추가:

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
  event_risk_score: number | null;   // 추가
  combined_score: number | null;     // 추가
}
```

- [ ] **Step 2: 커밋**

```bash
git add web/src/types/market.ts
git commit -m "feat: extend MarketScoreHistory with event_risk_score and combined_score"
```

---

### Task 4: 이벤트 리스크 스코어 계산 유틸리티

**Files:**

- Modify: `web/src/lib/market-score.ts`

- [ ] **Step 1: calculateEventRiskScore 함수 추가**

`web/src/lib/market-score.ts` 파일 하단에 추가:

```typescript
import type { MarketEvent } from '@/types/market-event';

/**
 * 이벤트 리스크 스코어 계산 (0~100, 100=리스크없음)
 * 미래 이벤트만 반영, 시간 감쇠 적용, 패널티 상한 80
 */
export function calculateEventRiskScore(events: MarketEvent[], baseDate?: Date): number {
  const today = baseDate ?? new Date();
  const todayStr = today.toISOString().slice(0, 10);
  let totalPenalty = 0;

  for (const event of events) {
    const eventDate = new Date(event.event_date + 'T00:00:00');
    const todayDate = new Date(todayStr + 'T00:00:00');
    const daysUntil = Math.round((eventDate.getTime() - todayDate.getTime()) / (1000 * 60 * 60 * 24));

    // 과거 이벤트 제외
    if (daysUntil < 0) continue;

    // 시간 감쇠
    const decay = daysUntil === 0 ? 1.0
                : daysUntil <= 1 ? 0.8
                : daysUntil <= 3 ? 0.5
                : daysUntil <= 7 ? 0.2
                : 0;

    totalPenalty += Math.abs(event.risk_score) * decay;
  }

  // 패널티 상한 80 (최소 20점 보장)
  totalPenalty = Math.min(totalPenalty, 80);

  return Math.max(0, Math.min(100, 100 - totalPenalty));
}

/**
 * 통합 스코어 계산 = 마켓 스코어 × 0.7 + 이벤트 리스크 × 0.3
 */
export function calculateCombinedScore(marketScore: number, eventRiskScore: number): number {
  const combined = marketScore * 0.7 + eventRiskScore * 0.3;
  return Math.round(combined * 100) / 100;
}
```

- [ ] **Step 2: 커밋**

```bash
git add web/src/lib/market-score.ts
git commit -m "feat: add calculateEventRiskScore and calculateCombinedScore"
```

---

### Task 5: 이벤트 수집 유틸리티

**Files:**

- Create: `web/src/lib/market-events.ts`
- Create: `data/economic-calendar.json`

- [ ] **Step 1: 만기일 계산 + 공휴일 API + FRED 유틸 작성**

```typescript
// web/src/lib/market-events.ts

import { EVENT_RISK_DEFAULTS, type EventType, type MarketEvent } from '@/types/market-event';

/**
 * 특정 월의 둘째 목요일 계산
 */
export function getSecondThursday(year: number, month: number): Date {
  // month: 0-indexed (0=Jan)
  const firstDay = new Date(year, month, 1);
  const dayOfWeek = firstDay.getDay(); // 0=Sun
  // 목요일=4, 첫째 목요일 = 1 + ((4 - dayOfWeek + 7) % 7)
  const firstThursday = 1 + ((4 - dayOfWeek + 7) % 7);
  const secondThursday = firstThursday + 7;
  return new Date(year, month, secondThursday);
}

/**
 * 공휴일 목록에서 해당 날짜가 공휴일인지 확인
 * 공휴일이면 직전 영업일(평일 & 비공휴일) 반환
 */
export function adjustForHoliday(date: Date, holidays: Set<string>): Date {
  const d = new Date(date);
  const fmt = (dt: Date) => dt.toISOString().slice(0, 10);

  while (holidays.has(fmt(d)) || d.getDay() === 0 || d.getDay() === 6) {
    d.setDate(d.getDate() - 1);
  }
  return d;
}

/**
 * 향후 N개월의 선물옵션 만기일 생성
 */
export function generateExpiryDates(
  fromDate: Date,
  monthsAhead: number,
  holidays: Set<string>
): Array<{ date: string; type: EventType; title: string }> {
  const results: Array<{ date: string; type: EventType; title: string }> = [];
  const simultaneousMonths = new Set([2, 5, 8, 11]); // 0-indexed: 3,6,9,12월

  for (let i = 0; i < monthsAhead; i++) {
    const targetDate = new Date(fromDate.getFullYear(), fromDate.getMonth() + i, 1);
    const year = targetDate.getFullYear();
    const month = targetDate.getMonth();

    const secondThursday = getSecondThursday(year, month);
    const adjustedDate = adjustForHoliday(secondThursday, holidays);
    const dateStr = adjustedDate.toISOString().slice(0, 10);

    const isSimultaneous = simultaneousMonths.has(month);
    const monthLabel = `${month + 1}월`;

    if (isSimultaneous) {
      results.push({
        date: dateStr,
        type: 'simultaneous_expiry',
        title: `${monthLabel} 선물옵션 동시만기일`,
      });
    } else {
      results.push({
        date: dateStr,
        type: 'futures_expiry',
        title: `${monthLabel} 선물만기일`,
      });
    }
  }

  return results;
}

/**
 * Nager.Date API에서 공휴일 가져오기
 */
export async function fetchHolidays(
  year: number,
  countryCode: 'KR' | 'US'
): Promise<Array<{ date: string; name: string }>> {
  try {
    const res = await fetch(
      `https://date.nager.at/api/v3/PublicHolidays/${year}/${countryCode}`,
      { next: { revalidate: 86400 * 30 } } // 30일 캐시
    );
    if (!res.ok) return [];
    const data = await res.json();
    return data.map((h: { date: string; localName: string }) => ({
      date: h.date,
      name: h.localName,
    }));
  } catch {
    return [];
  }
}

/**
 * 경제이벤트 fallback 데이터 로드
 * data/economic-calendar.json 형태:
 * [{ "date": "2026-03-18", "type": "fomc", "title": "FOMC 금리결정", "country": "US" }, ...]
 */
export async function loadFallbackEconomicEvents(): Promise<
  Array<{ date: string; type: EventType; title: string; country: string }>
> {
  try {
    const fs = await import('fs/promises');
    const path = await import('path');
    const filePath = path.join(process.cwd(), '..', 'data', 'economic-calendar.json');
    const content = await fs.readFile(filePath, 'utf-8');
    return JSON.parse(content);
  } catch {
    return [];
  }
}

/**
 * FRED API에서 FOMC 일정 가져오기
 * https://api.stlouisfed.org/fred/release/dates?release_id=10&api_key=...&file_type=json
 */
export async function fetchFOMCDates(year: number): Promise<string[]> {
  const apiKey = process.env.FRED_API_KEY;
  if (!apiKey) return [];

  try {
    const res = await fetch(
      `https://api.stlouisfed.org/fred/release/dates?release_id=10&api_key=${apiKey}&file_type=json&include_release_dates_with_no_data=true&sort_order=asc`,
    );
    if (!res.ok) return [];
    const data = await res.json();
    const dates: string[] = (data.release_dates || [])
      .map((d: { date: string }) => d.date)
      .filter((d: string) => d.startsWith(String(year)));
    return dates;
  } catch {
    return [];
  }
}

/**
 * MarketEvent 행 빌드 헬퍼
 */
export function buildEventRow(
  date: string,
  eventType: EventType,
  title: string,
  source: 'rule_based' | 'nager_date' | 'fred_api' | 'manual',
  country: string = 'KR',
  description: string | null = null,
  metadata: Record<string, unknown> = {}
): Omit<MarketEvent, 'id' | 'created_at' | 'updated_at'> {
  const defaults = EVENT_RISK_DEFAULTS[eventType];
  return {
    event_date: date,
    event_type: eventType,
    event_category: defaults.category,
    title,
    description,
    country,
    impact_level: defaults.impact_level,
    risk_score: defaults.risk_score,
    source,
    metadata,
  };
}
```

- [ ] **Step 2: fallback 경제캘린더 JSON 생성**

```json
[
  { "date": "2026-01-28", "type": "fomc", "title": "FOMC 금리결정 (1월)", "country": "US" },
  { "date": "2026-03-18", "type": "fomc", "title": "FOMC 금리결정 (3월)", "country": "US" },
  { "date": "2026-05-06", "type": "fomc", "title": "FOMC 금리결정 (5월)", "country": "US" },
  { "date": "2026-06-17", "type": "fomc", "title": "FOMC 금리결정 (6월)", "country": "US" },
  { "date": "2026-07-29", "type": "fomc", "title": "FOMC 금리결정 (7월)", "country": "US" },
  { "date": "2026-09-16", "type": "fomc", "title": "FOMC 금리결정 (9월)", "country": "US" },
  { "date": "2026-11-04", "type": "fomc", "title": "FOMC 금리결정 (11월)", "country": "US" },
  { "date": "2026-12-16", "type": "fomc", "title": "FOMC 금리결정 (12월)", "country": "US" },
  { "date": "2026-01-13", "type": "cpi", "title": "美 CPI 발표 (12월분)", "country": "US" },
  { "date": "2026-02-11", "type": "cpi", "title": "美 CPI 발표 (1월분)", "country": "US" },
  { "date": "2026-03-11", "type": "cpi", "title": "美 CPI 발표 (2월분)", "country": "US" },
  { "date": "2026-01-09", "type": "employment", "title": "美 고용보고서 (12월분)", "country": "US" },
  { "date": "2026-02-06", "type": "employment", "title": "美 고용보고서 (1월분)", "country": "US" },
  { "date": "2026-03-06", "type": "employment", "title": "美 고용보고서 (2월분)", "country": "US" }
]
```

파일 위치: `data/economic-calendar.json`

- [ ] **Step 3: 커밋**

```bash
git add web/src/lib/market-events.ts data/economic-calendar.json
git commit -m "feat: add market event collection utilities and fallback calendar"
```

---

## Chunk 2: API 레이어 (크론 + CRUD)

### Task 6: 이벤트 수집 크론 엔드포인트

**Files:**

- Create: `web/src/app/api/v1/cron/market-events/route.ts`

- [ ] **Step 1: 크론 라우트 작성**

```typescript
// web/src/app/api/v1/cron/market-events/route.ts

import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase';
import {
  fetchHolidays,
  generateExpiryDates,
  fetchFOMCDates,
  loadFallbackEconomicEvents,
  buildEventRow,
} from '@/lib/market-events';

export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  const authHeader = request.headers.get('authorization');
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const supabase = createServiceClient();
  const now = new Date();
  const year = now.getFullYear();
  const stats = { holidays: 0, expiry: 0, economic: 0, cleaned: 0 };

  // 1. 공휴일 수집 (한국 + 미국)
  for (const country of ['KR', 'US'] as const) {
    const holidays = await fetchHolidays(year, country);
    for (const h of holidays) {
      const row = buildEventRow(h.date, 'holiday', h.name, 'nager_date', country);
      await supabase.from('market_events').upsert(row, {
        onConflict: 'event_date,event_type,title',
      });
      stats.holidays++;
    }
  }

  // 2. 선물옵션 만기일 생성 (향후 3개월)
  const { data: krHolidayRows } = await supabase
    .from('market_events')
    .select('event_date')
    .eq('event_type', 'holiday')
    .eq('country', 'KR');

  const krHolidays = new Set((krHolidayRows || []).map((r: { event_date: string }) => r.event_date));
  const expiryDates = generateExpiryDates(now, 3, krHolidays);

  for (const exp of expiryDates) {
    const row = buildEventRow(exp.date, exp.type, exp.title, 'rule_based', 'KR');
    await supabase.from('market_events').upsert(row, {
      onConflict: 'event_date,event_type,title',
    });
    stats.expiry++;
  }

  // 3. 경제이벤트 (FRED API → fallback)
  const fomcDates = await fetchFOMCDates(year);
  if (fomcDates.length > 0) {
    for (const date of fomcDates) {
      const month = new Date(date).getMonth() + 1;
      const row = buildEventRow(date, 'fomc', `FOMC 금리결정 (${month}월)`, 'fred_api', 'US');
      await supabase.from('market_events').upsert(row, {
        onConflict: 'event_date,event_type,title',
      });
      stats.economic++;
    }
  }

  // fallback: 수동 관리 JSON에서 아직 DB에 없는 이벤트 추가
  const fallbackEvents = await loadFallbackEconomicEvents();
  for (const evt of fallbackEvents) {
    const row = buildEventRow(evt.date, evt.type, evt.title, 'manual', evt.country);
    await supabase.from('market_events').upsert(row, {
      onConflict: 'event_date,event_type,title',
      ignoreDuplicates: true, // FRED에서 이미 추가된 건 무시
    });
    stats.economic++;
  }

  // 4. 1년 이상 오래된 이벤트 정리
  const oneYearAgo = new Date(year - 1, now.getMonth(), now.getDate())
    .toISOString().slice(0, 10);
  const { count } = await supabase
    .from('market_events')
    .delete()
    .lt('event_date', oneYearAgo)
    .select('*', { count: 'exact', head: true });
  stats.cleaned = count ?? 0;

  return NextResponse.json({ success: true, stats });
}
```

- [ ] **Step 2: 커밋**

```bash
git add web/src/app/api/v1/cron/market-events/route.ts
git commit -m "feat: add market-events cron endpoint for automated collection"
```

---

### Task 7: 이벤트 CRUD API

**Files:**

- Create: `web/src/app/api/v1/market-events/route.ts`

- [ ] **Step 1: GET + POST 라우트 작성**

```typescript
// web/src/app/api/v1/market-events/route.ts

import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase';
import { buildEventRow } from '@/lib/market-events';
import type { EventType } from '@/types/market-event';

export const dynamic = 'force-dynamic';

// GET /api/v1/market-events?from=2026-03-01&to=2026-03-31&category=economic
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const from = searchParams.get('from');
  const to = searchParams.get('to');
  const category = searchParams.get('category');

  const supabase = createServiceClient();
  let query = supabase
    .from('market_events')
    .select('*')
    .order('event_date', { ascending: true });

  if (from) query = query.gte('event_date', from);
  if (to) query = query.lte('event_date', to);
  if (category) query = query.eq('event_category', category);

  const { data, error } = await query;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json(data);
}

// POST /api/v1/market-events - 수동 이벤트 추가
export async function POST(request: NextRequest) {
  const body = await request.json();
  const { event_date, event_type, title, description, country, metadata } = body as {
    event_date: string;
    event_type: EventType;
    title: string;
    description?: string;
    country?: string;
    metadata?: Record<string, unknown>;
  };

  if (!event_date || !event_type || !title) {
    return NextResponse.json({ error: 'event_date, event_type, title are required' }, { status: 400 });
  }

  const row = buildEventRow(
    event_date,
    event_type,
    title,
    'manual',
    country ?? 'KR',
    description ?? null,
    metadata ?? {}
  );

  const supabase = createServiceClient();
  const { data, error } = await supabase
    .from('market_events')
    .upsert(row, { onConflict: 'event_date,event_type,title' })
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data, { status: 201 });
}
```

- [ ] **Step 2: 커밋**

```bash
git add web/src/app/api/v1/market-events/route.ts
git commit -m "feat: add market-events CRUD API endpoint"
```

---

### Task 8: market-indicators 크론에 통합 스코어 계산 추가

**Files:**

- Modify: `web/src/app/api/v1/cron/market-indicators/route.ts:86-100`

- [ ] **Step 1: 이벤트 리스크 + 통합 스코어 계산/저장 추가**

`web/src/app/api/v1/cron/market-indicators/route.ts` 수정 — Step 3 (점수 히스토리 저장) 부분을 확장:

기존 import 라인에 추가:

```typescript
import { calculateEventRiskScore, calculateCombinedScore } from '@/lib/market-score';
```

기존 Step 3 (92행 부근) `supabase.from('market_score_history').upsert(...)` 호출 이전에 이벤트 리스크 계산 추가:

```typescript
  // Step 3: 이벤트 리스크 스코어 계산
  const sevenDaysLater = new Date();
  sevenDaysLater.setDate(sevenDaysLater.getDate() + 7);

  const { data: upcomingEvents } = await supabase
    .from('market_events')
    .select('*')
    .gte('event_date', today)
    .lte('event_date', sevenDaysLater.toISOString().slice(0, 10));

  const eventRiskScore = calculateEventRiskScore(upcomingEvents || []);
  const combinedScore = calculateCombinedScore(totalScore, eventRiskScore);
```

그리고 upsert 객체에 필드 추가:

```typescript
  await supabase.from('market_score_history').upsert(
    {
      date: today,
      total_score: totalScore,
      breakdown,
      weights_snapshot: weightsSnapshot,
      event_risk_score: eventRiskScore,      // 추가
      combined_score: combinedScore,          // 추가
    },
    { onConflict: 'date' }
  );
```

응답 JSON에도 추가:

```typescript
  return NextResponse.json({
    success: true,
    date: today,
    indicators: Object.keys(results).length,
    score: totalScore,
    event_risk_score: eventRiskScore,   // 추가
    combined_score: combinedScore,       // 추가
  });
```

- [ ] **Step 2: 커밋**

```bash
git add web/src/app/api/v1/cron/market-indicators/route.ts
git commit -m "feat: integrate event risk score into market-indicators cron"
```

---

## Chunk 3: 50점 버그 수정 + 마켓 페이지 개선

### Task 9: 50점 버그 수정 — 서버에서 min/max 전달

**Files:**

- Modify: `web/src/app/market/page.tsx`
- Modify: `web/src/components/market/market-client.tsx`

- [ ] **Step 1: market/page.tsx에서 indicator별 90일 min/max 조회 추가**

`web/src/app/market/page.tsx` 수정 — indicators 조회 후 min/max 조회 추가:

```typescript
import { createServiceClient } from "@/lib/supabase";
import { MarketClient } from "@/components/market/market-client";

export const dynamic = "force-dynamic";

export default async function MarketPage() {
  const supabase = createServiceClient();

  // 가중치 전체 조회
  const { data: weights } = await supabase
    .from("indicator_weights")
    .select("*")
    .order("indicator_type");

  // 지표별 최신 데이터
  const { data: rawIndicators } = await supabase
    .from("market_indicators")
    .select("*")
    .order("date", { ascending: false });

  const seen = new Set<string>();
  const indicators = (rawIndicators || []).filter((row: { indicator_type: string }) => {
    if (seen.has(row.indicator_type)) return false;
    seen.add(row.indicator_type);
    return true;
  });

  // 90일 min/max 조회 (각 indicator_type별)
  const ninetyDaysAgo = new Date();
  ninetyDaysAgo.setDate(ninetyDaysAgo.getDate() - 90);
  const sinceDate = ninetyDaysAgo.toISOString().slice(0, 10);

  const indicatorRanges: Record<string, { min: number; max: number }> = {};
  for (const ind of indicators) {
    const { data: history } = await supabase
      .from("market_indicators")
      .select("value")
      .eq("indicator_type", ind.indicator_type)
      .gte("date", sinceDate);

    if (history && history.length > 0) {
      const values = history.map((h: { value: number }) => Number(h.value));
      indicatorRanges[ind.indicator_type] = {
        min: Math.min(...values),
        max: Math.max(...values),
      };
    }
  }

  // 점수 히스토리 최근 90건
  const { data: scoreHistory } = await supabase
    .from("market_score_history")
    .select("date, total_score, breakdown, event_risk_score, combined_score")
    .order("date", { ascending: false })
    .limit(90);

  // 이벤트 (이번 주 ~ 다음 달)
  const today = new Date().toISOString().slice(0, 10);
  const thirtyDaysLater = new Date();
  thirtyDaysLater.setDate(thirtyDaysLater.getDate() + 30);

  const { data: events } = await supabase
    .from("market_events")
    .select("*")
    .gte("event_date", today)
    .lte("event_date", thirtyDaysLater.toISOString().slice(0, 10))
    .order("event_date", { ascending: true });

  return (
    <MarketClient
      indicators={indicators || []}
      weights={weights || []}
      scoreHistory={scoreHistory || []}
      indicatorRanges={indicatorRanges}
      events={events || []}
    />
  );
}
```

- [ ] **Step 2: market-client.tsx Props 확장 및 50점 버그 수정**

`web/src/components/market/market-client.tsx` 수정:

**Props 인터페이스 확장:**

```typescript
import type { MarketEvent } from "@/types/market-event";

interface Props {
  indicators: IndicatorRow[];
  weights: IndicatorWeight[];
  scoreHistory: Pick<MarketScoreHistory, "date" | "total_score" | "breakdown" | "event_risk_score" | "combined_score">[];
  indicatorRanges: Record<string, { min: number; max: number }>;
  events: MarketEvent[];
}
```

**latestBreakdown useMemo 수정 (50점 버그 핵심 수정):**

기존 synthetic breakdown 로직 (160~184행)을 교체:

```typescript
  const latestBreakdown = useMemo(() => {
    if (scoreHistory.length > 0 && scoreHistory[0].breakdown) {
      return scoreHistory[0].breakdown;
    }
    // scoreHistory 없을 때: indicatorRanges의 min/max 기반 정규화
    if (indicators.length === 0) return null;

    const DIRECTION: Record<string, number> = {
      VIX: -1, USD_KRW: -1, US_10Y: -1, DXY: -1,
      KOSPI: 1, KOSDAQ: 1, GOLD: 1, WTI: 1,
    };

    const synthetic: Record<string, { normalized: number; weight: number }> = {};
    for (const ind of indicators) {
      if (ind.indicator_type === "FEAR_GREED") continue;
      const dir = DIRECTION[ind.indicator_type] ?? 1;
      const range = indicatorRanges[ind.indicator_type];

      let normalized: number;
      if (!range || range.max === range.min) {
        normalized = 50; // 데이터 부족
      } else {
        const raw = ((ind.value - range.min) / (range.max - range.min)) * 100;
        const clamped = Math.max(0, Math.min(100, raw));
        normalized = dir === -1 ? 100 - clamped : clamped;
      }

      synthetic[ind.indicator_type] = {
        normalized,
        weight: currentWeights[ind.indicator_type] ?? 1,
      };
    }
    return Object.keys(synthetic).length > 0 ? synthetic : null;
  }, [scoreHistory, indicators, currentWeights, indicatorRanges]);
```

- [ ] **Step 3: 커밋**

```bash
git add web/src/app/market/page.tsx web/src/components/market/market-client.tsx
git commit -m "fix: resolve market score always-50 bug with proper min/max normalization"
```

---

### Task 10: market-client에 3-스코어 표시 추가

**Files:**

- Modify: `web/src/components/market/market-client.tsx`

- [ ] **Step 1: 종합 점수 게이지 섹션을 3-스코어로 확장**

`web/src/components/market/market-client.tsx`에서 기존 게이지 섹션 (267~278행)을 교체:

```tsx
      {/* ─── 1. 3-스코어 게이지 ─────────────────────── */}
      <section className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {/* 통합 스코어 */}
        <div className="card p-6 flex flex-col items-center gap-4">
          <div className="text-sm text-[var(--muted)]">통합 스코어</div>
          <ScoreGauge score={combinedScore} color={combinedInterp.color} />
          <span
            className="inline-block px-4 py-1.5 rounded-full text-sm font-semibold"
            style={{ background: combinedInterp.color + "22", color: combinedInterp.color }}
          >
            {combinedInterp.label}
          </span>
          <p className="text-sm text-[var(--muted)]">{combinedInterp.signal}</p>
        </div>

        {/* 마켓 심리 */}
        <div className="card p-6 flex flex-col items-center gap-4">
          <div className="text-sm text-[var(--muted)]">마켓 심리</div>
          <ScoreGauge score={totalScore} color={interpretation.color} />
          <span
            className="inline-block px-4 py-1.5 rounded-full text-sm font-semibold"
            style={{ background: interpretation.color + "22", color: interpretation.color }}
          >
            {interpretation.label}
          </span>
        </div>

        {/* 이벤트 리스크 */}
        <div className="card p-6 flex flex-col items-center gap-4">
          <div className="text-sm text-[var(--muted)]">이벤트 리스크</div>
          <ScoreGauge score={eventRiskScore} color={eventInterp.color} />
          <span
            className="inline-block px-4 py-1.5 rounded-full text-sm font-semibold"
            style={{ background: eventInterp.color + "22", color: eventInterp.color }}
          >
            {eventInterp.label}
          </span>
        </div>
      </section>
```

이 섹션을 사용하려면 컴포넌트 상단에 스코어 값을 계산하는 useMemo 추가:

```typescript
  // 이벤트 리스크 & 통합 스코어
  const eventRiskScore = useMemo(() => {
    if (scoreHistory.length > 0 && scoreHistory[0].event_risk_score != null) {
      return scoreHistory[0].event_risk_score;
    }
    return 100; // 이벤트 없으면 리스크 없음
  }, [scoreHistory]);

  const combinedScore = useMemo(() => {
    if (scoreHistory.length > 0 && scoreHistory[0].combined_score != null) {
      return scoreHistory[0].combined_score;
    }
    return totalScore * 0.7 + eventRiskScore * 0.3;
  }, [scoreHistory, totalScore, eventRiskScore]);

  const eventInterp = getScoreInterpretation(eventRiskScore);
  const combinedInterp = getScoreInterpretation(combinedScore);
```

- [ ] **Step 2: 커밋**

```bash
git add web/src/components/market/market-client.tsx
git commit -m "feat: display 3-layer score gauges (combined, market, event risk)"
```

---

### Task 11: 이벤트 캘린더 컴포넌트

**Files:**

- Create: `web/src/components/market/event-calendar.tsx`

- [ ] **Step 1: 이벤트 캘린더 컴포넌트 작성**

```tsx
// web/src/components/market/event-calendar.tsx

"use client";

import { useState, useMemo } from "react";
import { Calendar, AlertTriangle, Clock } from "lucide-react";
import type { MarketEvent } from "@/types/market-event";
import { EVENT_CATEGORY_LABELS, getImpactLabel } from "@/types/market-event";

interface Props {
  events: MarketEvent[];
}

type TabKey = "week" | "next_week" | "month";

function getWeekRange(offset: number): { from: Date; to: Date } {
  const now = new Date();
  const day = now.getDay();
  const monday = new Date(now);
  monday.setDate(now.getDate() - (day === 0 ? 6 : day - 1) + offset * 7);
  const sunday = new Date(monday);
  sunday.setDate(monday.getDate() + 6);
  return { from: monday, to: sunday };
}

function formatDate(dateStr: string): string {
  const d = new Date(dateStr + "T00:00:00");
  const days = ["일", "월", "화", "수", "목", "금", "토"];
  return `${d.getMonth() + 1}/${d.getDate()} (${days[d.getDay()]})`;
}

function dDayLabel(dateStr: string): string {
  const today = new Date();
  const todayStr = today.toISOString().slice(0, 10);
  const eventDate = new Date(dateStr + "T00:00:00");
  const todayDate = new Date(todayStr + "T00:00:00");
  const diff = Math.round((eventDate.getTime() - todayDate.getTime()) / (1000 * 60 * 60 * 24));
  if (diff === 0) return "오늘";
  if (diff === 1) return "내일";
  if (diff > 0) return `D-${diff}`;
  return `D+${Math.abs(diff)}`;
}

export function EventCalendar({ events }: Props) {
  const [tab, setTab] = useState<TabKey>("week");

  const filteredEvents = useMemo(() => {
    const fmt = (d: Date) => d.toISOString().slice(0, 10);
    let from: string, to: string;

    if (tab === "week") {
      const range = getWeekRange(0);
      from = fmt(range.from);
      to = fmt(range.to);
    } else if (tab === "next_week") {
      const range = getWeekRange(1);
      from = fmt(range.from);
      to = fmt(range.to);
    } else {
      const now = new Date();
      from = fmt(new Date(now.getFullYear(), now.getMonth(), 1));
      to = fmt(new Date(now.getFullYear(), now.getMonth() + 1, 0));
    }

    return events.filter((e) => e.event_date >= from && e.event_date <= to);
  }, [events, tab]);

  // 날짜별 그룹핑
  const grouped = useMemo(() => {
    const map = new Map<string, MarketEvent[]>();
    for (const e of filteredEvents) {
      const list = map.get(e.event_date) || [];
      list.push(e);
      map.set(e.event_date, list);
    }
    return Array.from(map.entries()).sort(([a], [b]) => a.localeCompare(b));
  }, [filteredEvents]);

  const TABS: { key: TabKey; label: string }[] = [
    { key: "week", label: "이번 주" },
    { key: "next_week", label: "다음 주" },
    { key: "month", label: "이번 달" },
  ];

  return (
    <section>
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-lg font-semibold flex items-center gap-2">
          <Calendar className="w-5 h-5" />
          시장 이벤트 캘린더
        </h2>
        <div className="flex gap-1">
          {TABS.map((t) => (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              className={`px-3 py-1.5 text-sm rounded-lg transition-colors ${
                tab === t.key
                  ? "bg-[var(--accent)] text-white"
                  : "text-[var(--muted)] hover:bg-[var(--card-hover)]"
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>
      </div>

      <div className="card divide-y divide-[var(--border)]">
        {grouped.length === 0 && (
          <div className="p-8 text-center text-[var(--muted)] text-sm">
            해당 기간에 예정된 이벤트가 없습니다
          </div>
        )}

        {grouped.map(([date, dayEvents]) => (
          <div key={date} className="p-4">
            <div className="flex items-center gap-2 mb-3">
              <span className="text-sm font-semibold">{formatDate(date)}</span>
              <span className="text-xs px-2 py-0.5 rounded-full bg-[var(--accent)]/20 text-[var(--accent-light)]">
                {dDayLabel(date)}
              </span>
            </div>

            <div className="space-y-2 ml-4">
              {dayEvents.map((evt) => {
                const impact = getImpactLabel(evt.impact_level);
                return (
                  <div
                    key={evt.id}
                    className="flex items-center justify-between p-3 rounded-lg bg-[var(--background)] hover:bg-[var(--card-hover)] transition-colors"
                  >
                    <div className="flex items-center gap-3">
                      {evt.impact_level >= 4 ? (
                        <AlertTriangle className="w-4 h-4 flex-shrink-0" style={{ color: impact.color }} />
                      ) : (
                        <Clock className="w-4 h-4 flex-shrink-0 text-[var(--muted)]" />
                      )}
                      <div>
                        <div className="text-sm font-medium">{evt.title}</div>
                        <div className="flex items-center gap-2 mt-0.5">
                          <span className="text-xs px-1.5 py-0.5 rounded bg-[var(--card-hover)] text-[var(--muted)]">
                            {EVENT_CATEGORY_LABELS[evt.event_category] ?? evt.event_category}
                          </span>
                          {evt.country !== "KR" && (
                            <span className="text-xs text-[var(--muted)]">{evt.country}</span>
                          )}
                          {evt.metadata && (evt.metadata as Record<string, string>).forecast_value && (
                            <span className="text-xs text-[var(--muted)]">
                              예상: {(evt.metadata as Record<string, string>).forecast_value}
                            </span>
                          )}
                        </div>
                      </div>
                    </div>

                    <div className="text-right flex-shrink-0">
                      <span className="text-xs font-medium" style={{ color: impact.color }}>
                        {impact.label}
                      </span>
                      {evt.risk_score !== 0 && (
                        <div className="text-xs text-[var(--muted)]">
                          {evt.risk_score > 0 ? "+" : ""}{evt.risk_score}
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
```

- [ ] **Step 2: market-client.tsx에 EventCalendar 통합**

`web/src/components/market/market-client.tsx`에서 import 추가:

```typescript
import { EventCalendar } from "./event-calendar";
```

가중치 조절 섹션 앞에 (점수 히스토리 섹션 뒤에) 추가:

```tsx
      {/* ─── 3.5 이벤트 캘린더 ───────────────────── */}
      {events.length > 0 && <EventCalendar events={events} />}
```

- [ ] **Step 3: 커밋**

```bash
git add web/src/components/market/event-calendar.tsx web/src/components/market/market-client.tsx
git commit -m "feat: add event calendar component to market page"
```

---

## Chunk 4: 대시보드 통합

### Task 12: 이벤트 요약 카드 컴포넌트

**Files:**

- Create: `web/src/components/market/event-summary-card.tsx`

- [ ] **Step 1: 이벤트 요약 카드 작성**

```tsx
// web/src/components/market/event-summary-card.tsx

import Link from "next/link";
import { Calendar, AlertTriangle } from "lucide-react";
import type { MarketEvent } from "@/types/market-event";
import { getImpactLabel } from "@/types/market-event";
import { getScoreInterpretation } from "@/types/market";

interface Props {
  events: MarketEvent[];
  eventRiskScore: number;
  combinedScore: number;
  marketScore: number;
}

function dDayLabel(dateStr: string): string {
  const today = new Date();
  const todayStr = new Date(today.getTime() + 9 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const eventDate = new Date(dateStr + "T00:00:00");
  const todayDate = new Date(todayStr + "T00:00:00");
  const diff = Math.round((eventDate.getTime() - todayDate.getTime()) / (1000 * 60 * 60 * 24));
  if (diff === 0) return "오늘";
  if (diff === 1) return "내일";
  return `D-${diff}`;
}

export function EventSummaryCard({ events, eventRiskScore, combinedScore, marketScore }: Props) {
  const topEvents = events.slice(0, 3);
  const combinedInterp = getScoreInterpretation(combinedScore);
  const marketInterp = getScoreInterpretation(marketScore);
  const eventInterp = getScoreInterpretation(eventRiskScore);

  return (
    <div className="space-y-4">
      {/* 3-스코어 요약 */}
      <div className="grid grid-cols-3 gap-3">
        <Link href="/market" className="card p-3 text-center hover:border-[var(--accent)] transition-colors">
          <div className="text-xs text-[var(--muted)]">통합</div>
          <div className="text-2xl font-bold mt-1" style={{ color: combinedInterp.color }}>
            {Math.round(combinedScore)}
          </div>
          <div className="text-xs mt-0.5" style={{ color: combinedInterp.color }}>
            {combinedInterp.label}
          </div>
        </Link>
        <Link href="/market" className="card p-3 text-center hover:border-[var(--accent)] transition-colors">
          <div className="text-xs text-[var(--muted)]">마켓</div>
          <div className="text-2xl font-bold mt-1" style={{ color: marketInterp.color }}>
            {Math.round(marketScore)}
          </div>
          <div className="text-xs mt-0.5" style={{ color: marketInterp.color }}>
            {marketInterp.label}
          </div>
        </Link>
        <Link href="/market" className="card p-3 text-center hover:border-[var(--accent)] transition-colors">
          <div className="text-xs text-[var(--muted)]">이벤트</div>
          <div className="text-2xl font-bold mt-1" style={{ color: eventInterp.color }}>
            {Math.round(eventRiskScore)}
          </div>
          <div className="text-xs mt-0.5" style={{ color: eventInterp.color }}>
            {eventInterp.label}
          </div>
        </Link>
      </div>

      {/* 이벤트 목록 */}
      {topEvents.length > 0 && (
        <div className="card p-4">
          <div className="flex items-center justify-between mb-3">
            <h2 className="font-semibold text-sm flex items-center gap-1.5">
              <Calendar className="w-4 h-4" />
              주요 이벤트
            </h2>
            <Link href="/market" className="text-xs text-[var(--accent-light)] hover:underline">
              전체 →
            </Link>
          </div>
          <div className="space-y-2">
            {topEvents.map((evt) => {
              const impact = getImpactLabel(evt.impact_level);
              return (
                <div key={evt.id} className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    {evt.impact_level >= 4 ? (
                      <AlertTriangle className="w-3.5 h-3.5" style={{ color: impact.color }} />
                    ) : (
                      <Calendar className="w-3.5 h-3.5 text-[var(--muted)]" />
                    )}
                    <span className="text-sm">{evt.title}</span>
                  </div>
                  <span className="text-xs px-2 py-0.5 rounded-full" style={{
                    background: impact.color + "22",
                    color: impact.color,
                  }}>
                    {dDayLabel(evt.event_date)}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: 커밋**

```bash
git add web/src/components/market/event-summary-card.tsx
git commit -m "feat: add event summary card component for dashboard"
```

---

### Task 13: 대시보드 메인 페이지에 통합

**Files:**

- Modify: `web/src/app/page.tsx`

- [ ] **Step 1: page.tsx에 이벤트 + 스코어 데이터 로드 추가**

`web/src/app/page.tsx` 수정:

import 추가:

```typescript
import { EventSummaryCard } from "@/components/market/event-summary-card";
```

`DashboardPage` 함수 내부 — 기존 `latestScore` 쿼리를 확장하여 event_risk_score, combined_score도 가져오기:

```typescript
  // 시황 점수 (확장)
  const { data: latestScore } = await supabase
    .from("market_score_history")
    .select("total_score, event_risk_score, combined_score")
    .order("date", { ascending: false })
    .limit(1)
    .single();

  const score = latestScore?.total_score ?? null;
  const eventRiskScore = latestScore?.event_risk_score ?? 100;
  const combinedScore = latestScore?.combined_score ?? score ?? 50;
  const scoreInfo = score !== null ? getScoreInterpretation(combinedScore) : null;
```

이벤트 데이터 로드 추가 (기존 watchlist 쿼리 뒤):

```typescript
  // 이벤트 (향후 7일)
  const sevenDaysLater = new Date(kst.getTime() + 7 * 24 * 60 * 60 * 1000)
    .toISOString().slice(0, 10);

  const { data: events } = await supabase
    .from("market_events")
    .select("*")
    .gte("event_date", today)
    .lte("event_date", sevenDaysLater)
    .order("event_date", { ascending: true })
    .order("impact_level", { ascending: false })
    .limit(10);
```

- [ ] **Step 2: 기존 시황 카드를 EventSummaryCard로 교체**

기존 `grid grid-cols-1 md:grid-cols-4` 영역에서 시황 Link 카드 (119~133행)를 제거하고, 그리드 아래에 EventSummaryCard 추가:

```tsx
      {/* 시장 요약 */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {(["lassi", "stockbot", "quant"] as const).map((src) => (
          <div key={src} className={`card p-4 ${SOURCE_COLORS[src]} border`}>
            <div className="text-sm font-medium mb-2 opacity-80">{SOURCE_LABELS[src]}</div>
            <div className="text-3xl font-bold">{counts[src].total}</div>
            <div className="text-sm mt-1 opacity-70">
              매수 {counts[src].buy} / 매도 {counts[src].sell}
            </div>
          </div>
        ))}
      </div>

      {/* 투자 시황 + 이벤트 */}
      <EventSummaryCard
        events={events || []}
        eventRiskScore={eventRiskScore}
        combinedScore={combinedScore}
        marketScore={score ?? 50}
      />
```

- [ ] **Step 3: 커밋**

```bash
git add web/src/app/page.tsx
git commit -m "feat: integrate event summary and 3-layer score into dashboard"
```

---

### Task 14: 점수 히스토리 차트에 탭 추가

**Files:**

- Modify: `web/src/components/market/market-client.tsx`

- [ ] **Step 1: 히스토리 차트 섹션에 스코어 전환 탭 추가**

`web/src/components/market/market-client.tsx`의 점수 히스토리 섹션 (339행 부근)을 수정:

컴포넌트 상단에 state 추가:

```typescript
  const [chartTab, setChartTab] = useState<"combined" | "market" | "event">("combined");
```

히스토리 섹션 교체:

```tsx
      {recentHistory.length > 0 && (
        <section>
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-semibold">최근 30일 점수 추이</h2>
            <div className="flex gap-1">
              {[
                { key: "combined" as const, label: "통합" },
                { key: "market" as const, label: "마켓" },
                { key: "event" as const, label: "이벤트" },
              ].map((t) => (
                <button
                  key={t.key}
                  onClick={() => setChartTab(t.key)}
                  className={`px-3 py-1 text-xs rounded-lg transition-colors ${
                    chartTab === t.key
                      ? "bg-[var(--accent)] text-white"
                      : "text-[var(--muted)] hover:bg-[var(--card-hover)]"
                  }`}
                >
                  {t.label}
                </button>
              ))}
            </div>
          </div>
          <div className="card p-4 overflow-x-auto">
            <div className="flex items-end gap-1 h-40 min-w-[600px]">
              {[...recentHistory].reverse().map((entry) => {
                const scoreValue =
                  chartTab === "combined" ? (entry.combined_score ?? entry.total_score)
                  : chartTab === "event" ? (entry.event_risk_score ?? 100)
                  : entry.total_score;
                const interp = getScoreInterpretation(scoreValue);
                const height = Math.max(4, (scoreValue / 100) * 100);
                return (
                  <div
                    key={entry.date}
                    className="flex-1 flex flex-col items-center gap-1 group relative"
                  >
                    <div className="absolute bottom-full mb-2 hidden group-hover:block z-10">
                      <div className="bg-[#1e293b] border border-[var(--border)] rounded-lg px-3 py-2 text-xs whitespace-nowrap shadow-lg">
                        <div className="font-medium">{entry.date}</div>
                        <div style={{ color: interp.color }}>
                          {scoreValue.toFixed(1)}점 - {interp.label}
                        </div>
                      </div>
                    </div>
                    <div
                      className="w-full rounded-t transition-all duration-300 hover:opacity-80 cursor-pointer"
                      style={{
                        height: `${height}%`,
                        background: interp.color,
                        minHeight: "4px",
                      }}
                    />
                  </div>
                );
              })}
            </div>
            <div className="flex gap-1 mt-2 min-w-[600px]">
              {[...recentHistory].reverse().map((entry, i) => (
                <div key={entry.date} className="flex-1 text-center">
                  {i % 5 === 0 && (
                    <span className="text-[10px] text-[var(--muted)]">
                      {entry.date.slice(5)}
                    </span>
                  )}
                </div>
              ))}
            </div>
          </div>
        </section>
      )}
```

- [ ] **Step 2: 커밋**

```bash
git add web/src/components/market/market-client.tsx
git commit -m "feat: add score type tabs to history chart"
```

---

### Task 15: 최종 검증 및 커밋

- [ ] **Step 1: TypeScript 컴파일 확인**

```bash
cd web && npx tsc --noEmit
```

Expected: 에러 없음

- [ ] **Step 2: 빌드 확인**

```bash
cd web && npm run build
```

Expected: 정상 빌드

- [ ] **Step 3: 마이그레이션 적용 확인**

```bash
echo "Supabase Dashboard > SQL Editor에서 021_market_events.sql 실행 필요"
```

- [ ] **Step 4: 크론 테스트**

```bash
curl -X POST http://localhost:3000/api/v1/cron/market-events \
  -H "Authorization: Bearer $CRON_SECRET"
```

Expected: `{"success": true, "stats": {"holidays": ..., "expiry": ..., ...}}`

```bash
curl -X POST http://localhost:3000/api/v1/cron/market-indicators \
  -H "Authorization: Bearer $CRON_SECRET"
```

Expected: 응답에 `event_risk_score`, `combined_score` 필드 포함

- [ ] **Step 5: API 테스트**

```bash
curl http://localhost:3000/api/v1/market-events?from=2026-03-01&to=2026-03-31
```

Expected: 이벤트 배열 반환
