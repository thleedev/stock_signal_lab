# 순위 트래킹 리디자인 — 스냅샷 기반 수익률 추적 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 과거 스냅샷의 가격과 현재 가격을 비교하여 수익률을 추적하는 시스템 구축 — 세션 기반 다중 스냅샷 + 타임라인 UI + 종목별 수익률 추이

**Architecture:** `snapshot_sessions` 메타 테이블을 추가하여 각 스냅샷 실행을 세션으로 관리. 기존 `stock_ranking_snapshot`에 `session_id` FK를 추가하고 유니크 제약을 변경. 자동(크론)/수동 스냅샷 모두 세션 단위로 저장. UI는 날짜 → 타임라인 바 → 테이블 3단계로 탐색.

**Tech Stack:** Next.js 16 App Router, Supabase (PostgreSQL), TypeScript, lightweight-charts, Tailwind CSS v4

**Spec:** `docs/superpowers/specs/2026-03-27-snapshot-tracker-redesign-design.md`

---

## 파일 구조

### 신규 파일
- `supabase/migrations/054_snapshot_sessions.sql` — snapshot_sessions 테이블 + 마이그레이션
- `web/src/app/api/v1/stock-ranking/sessions/route.ts` — 세션 목록 조회 API
- `web/src/app/api/v1/stock-ranking/snapshot/history/route.ts` — 종목별 스냅샷 히스토리 API
- `web/src/components/signals/SnapshotTimeline.tsx` — 타임라인 바 컴포넌트
- `web/src/components/stock-modal/ReturnTrendSection.tsx` — 종목별 수익률 추이 섹션

### 수정 파일
- `web/src/app/api/v1/stock-ranking/snapshot/route.ts` — session_id 파라미터 추가 + POST 핸들러
- `web/src/app/api/v1/stock-ranking/route.ts` — 스냅샷 저장 시 세션 생성 로직
- `web/src/app/api/v1/cron/daily-prices/route.ts` — 스냅샷 트리거 시 가격 소스 우선순위 변경
- `web/src/components/signals/SnapshotTracker.tsx` — 세션 기반 조회 + 타임라인 통합 + 수동 저장 버튼
- `web/src/components/signals/RecommendationFilterBar.tsx` — 수동 스냅샷 저장 버튼 추가
- `web/src/components/stock-modal/StockDetailPanel.tsx` — 수익률 추이 섹션 추가

---

## Task 1: DB 마이그레이션 — snapshot_sessions 테이블 + FK 추가

**Files:**
- Create: `supabase/migrations/054_snapshot_sessions.sql`

- [ ] **Step 1: 마이그레이션 SQL 작성**

```sql
-- 054_snapshot_sessions.sql
-- 스냅샷 세션 메타 테이블 + stock_ranking_snapshot FK 연결

-- 1. snapshot_sessions 테이블 생성
CREATE TABLE IF NOT EXISTS snapshot_sessions (
  id          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  session_date DATE NOT NULL,
  session_time TIMESTAMPTZ NOT NULL,
  model       TEXT NOT NULL,
  trigger_type TEXT NOT NULL DEFAULT 'cron',
  total_count  INT,
  created_at  TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_snapshot_sessions_date_model
  ON snapshot_sessions (session_date, model);

-- 2. stock_ranking_snapshot에 session_id FK 추가
ALTER TABLE stock_ranking_snapshot
  ADD COLUMN IF NOT EXISTS session_id BIGINT REFERENCES snapshot_sessions(id);

CREATE INDEX IF NOT EXISTS idx_snapshot_session_id
  ON stock_ranking_snapshot (session_id);

-- 3. 기존 데이터 마이그레이션: (snapshot_date, model) 그룹별로 세션 생성
INSERT INTO snapshot_sessions (session_date, session_time, model, trigger_type, total_count)
SELECT
  snapshot_date,
  MAX(snapshot_time) AS session_time,
  model,
  'cron' AS trigger_type,
  COUNT(*) AS total_count
FROM stock_ranking_snapshot
GROUP BY snapshot_date, model;

-- 4. 기존 행들에 session_id 할당
UPDATE stock_ranking_snapshot srs
SET session_id = ss.id
FROM snapshot_sessions ss
WHERE srs.snapshot_date = ss.session_date
  AND srs.model = ss.model
  AND srs.session_id IS NULL;

-- 5. 유니크 제약 변경: 기존 제약 삭제 후 새 제약 추가
ALTER TABLE stock_ranking_snapshot
  DROP CONSTRAINT IF EXISTS stock_ranking_snapshot_snapshot_date_model_symbol_key;

ALTER TABLE stock_ranking_snapshot
  ADD CONSTRAINT stock_ranking_snapshot_session_id_symbol_key
  UNIQUE (session_id, symbol);

-- 6. RLS 정책 (기존 패턴 따름)
ALTER TABLE snapshot_sessions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "snapshot_sessions_select" ON snapshot_sessions
  FOR SELECT USING (true);
CREATE POLICY "snapshot_sessions_insert" ON snapshot_sessions
  FOR INSERT WITH CHECK (true);
```

- [ ] **Step 2: Supabase에 마이그레이션 적용**

Run: Supabase 대시보드 SQL Editor에서 위 SQL 실행
Expected: 테이블 생성, FK 추가, 기존 데이터 마이그레이션 완료

- [ ] **Step 3: 마이그레이션 검증**

SQL Editor에서 검증:
```sql
-- 세션 테이블 확인
SELECT COUNT(*) FROM snapshot_sessions;

-- FK 연결 확인 (session_id가 NULL인 행이 0이어야 함)
SELECT COUNT(*) FROM stock_ranking_snapshot WHERE session_id IS NULL;

-- 새 유니크 제약 확인
SELECT conname FROM pg_constraint
WHERE conrelid = 'stock_ranking_snapshot'::regclass AND contype = 'u';
```

- [ ] **Step 4: 커밋**

```bash
git add supabase/migrations/054_snapshot_sessions.sql
git commit -m "feat: snapshot_sessions 테이블 추가 및 FK 마이그레이션"
```

---

## Task 2: 세션 목록 조회 API

**Files:**
- Create: `web/src/app/api/v1/stock-ranking/sessions/route.ts`

- [ ] **Step 1: API 라우트 작성**

```typescript
// 세션 목록 조회 API
// 특정 날짜의 스냅샷 세션 목록을 반환합니다.
// GET /api/v1/stock-ranking/sessions?date=2026-03-27&model=standard
import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const date = searchParams.get('date');
  const model = searchParams.get('model') || 'standard';

  const supabase = createServiceClient();

  let query = supabase
    .from('snapshot_sessions')
    .select('id, session_date, session_time, model, trigger_type, total_count')
    .eq('model', model)
    .order('session_time', { ascending: true });

  if (date) {
    query = query.eq('session_date', date);
  } else {
    // 날짜 미지정 시 최근 30일
    const since = new Date();
    since.setDate(since.getDate() - 30);
    query = query.gte('session_date', since.toISOString().slice(0, 10));
  }

  const { data, error } = await query;

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json(
    { sessions: data ?? [] },
    { headers: { 'Cache-Control': 'public, s-maxage=60, stale-while-revalidate=120' } },
  );
}
```

- [ ] **Step 2: 동작 검증**

Run: `curl "http://localhost:3000/api/v1/stock-ranking/sessions?date=2026-03-27&model=standard"`
Expected: `{ "sessions": [{ "id": 1, "session_date": "2026-03-27", "session_time": "...", ... }] }`

- [ ] **Step 3: 커밋**

```bash
git add web/src/app/api/v1/stock-ranking/sessions/route.ts
git commit -m "feat: 스냅샷 세션 목록 조회 API 추가"
```

---

## Task 3: 스냅샷 조회 API — session_id 지원 + POST 수동 저장

**Files:**
- Modify: `web/src/app/api/v1/stock-ranking/snapshot/route.ts`

- [ ] **Step 1: GET 핸들러에 session_id 파라미터 추가**

기존 GET 핸들러를 수정하여 `session_id` 파라미터를 우선 처리하고, `date`만 있으면 해당 날짜의 최신 세션을 반환.

```typescript
// 과거 스냅샷 조회 API
// session_id 또는 date 파라미터로 조회
// GET /api/v1/stock-ranking/snapshot?session_id=123
// GET /api/v1/stock-ranking/snapshot?date=2026-03-27&model=standard (하위 호환)
import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const sessionId = searchParams.get('session_id');
  const date = searchParams.get('date');
  const model = searchParams.get('model') || 'standard';

  if (!sessionId && !date) {
    return NextResponse.json({ error: 'session_id 또는 date 파라미터 필요' }, { status: 400 });
  }

  const supabase = createServiceClient();

  // session_id로 직접 조회
  if (sessionId) {
    // 세션 메타 조회
    const { data: session } = await supabase
      .from('snapshot_sessions')
      .select('*')
      .eq('id', Number(sessionId))
      .single();

    if (!session) {
      return NextResponse.json({ error: '세션을 찾을 수 없습니다' }, { status: 404 });
    }

    const { data, error } = await supabase
      .from('stock_ranking_snapshot')
      .select('*')
      .eq('session_id', Number(sessionId))
      .order('score_total', { ascending: false });

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json(
      {
        date: session.session_date,
        model: session.model,
        session_id: session.id,
        snapshot_time: session.session_time,
        trigger_type: session.trigger_type,
        items: (data ?? []).map((row) => ({
          ...((row.raw_data as Record<string, unknown>) ?? {}),
          symbol: row.symbol,
          name: row.name,
          market: row.market,
          current_price: row.current_price,
          score_total: row.score_total,
          grade: row.grade,
          characters: row.characters,
          recommendation: row.recommendation,
          signal_date: row.signal_date,
        })),
        total: data?.length ?? 0,
      },
      { headers: { 'Cache-Control': 'public, s-maxage=300, stale-while-revalidate=600' } },
    );
  }

  // date 기반 조회 (하위 호환) — 해당 날짜의 최신 세션
  const { data: latestSession } = await supabase
    .from('snapshot_sessions')
    .select('id, session_time, trigger_type')
    .eq('session_date', date!)
    .eq('model', model)
    .order('session_time', { ascending: false })
    .limit(1)
    .single();

  if (!latestSession) {
    return NextResponse.json(
      { date, model, snapshot_time: null, items: [], total: 0 },
      { headers: { 'Cache-Control': 'public, s-maxage=60' } },
    );
  }

  const { data, error } = await supabase
    .from('stock_ranking_snapshot')
    .select('*')
    .eq('session_id', latestSession.id)
    .order('score_total', { ascending: false });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json(
    {
      date,
      model,
      session_id: latestSession.id,
      snapshot_time: latestSession.session_time,
      trigger_type: latestSession.trigger_type,
      items: (data ?? []).map((row) => ({
        ...((row.raw_data as Record<string, unknown>) ?? {}),
        symbol: row.symbol,
        name: row.name,
        market: row.market,
        current_price: row.current_price,
        score_total: row.score_total,
        grade: row.grade,
        characters: row.characters,
        recommendation: row.recommendation,
        signal_date: row.signal_date,
      })),
      total: data?.length ?? 0,
    },
    { headers: { 'Cache-Control': 'public, s-maxage=300, stale-while-revalidate=600' } },
  );
}
```

- [ ] **Step 2: POST 핸들러 추가 — 수동 스냅샷 생성**

같은 파일에 POST 핸들러를 추가. `snapshot_update_status` 락을 활용하여 동시 요청을 방지.

```typescript
export async function POST(request: NextRequest) {
  const supabase = createServiceClient();

  // 락 확인
  const { data: status } = await supabase
    .from('snapshot_update_status')
    .select('updating')
    .eq('id', 1)
    .single();

  if (status?.updating) {
    return NextResponse.json(
      { error: '스냅샷 업데이트가 이미 진행 중입니다' },
      { status: 409 },
    );
  }

  // 락 획득
  await supabase
    .from('snapshot_update_status')
    .update({ updating: true, model: 'manual' })
    .eq('id', 1);

  try {
    // stock-ranking API를 refresh+snapshot으로 호출
    const baseUrl = process.env.VERCEL_URL
      ? `https://${process.env.VERCEL_URL}`
      : 'http://localhost:3000';

    const body = await request.json().catch(() => ({}));
    const model = (body as Record<string, string>).model || 'standard';

    const res = await fetch(
      `${baseUrl}/api/v1/stock-ranking?refresh=true&snapshot=true&trigger_type=manual`,
      { headers: { 'Cache-Control': 'no-cache' } },
    );

    if (!res.ok) {
      return NextResponse.json(
        { error: `스냅샷 생성 실패 (${res.status})` },
        { status: 500 },
      );
    }

    return NextResponse.json({ status: 'completed', model });
  } finally {
    // 락 해제
    await supabase
      .from('snapshot_update_status')
      .update({ updating: false, last_updated: new Date().toISOString() })
      .eq('id', 1);
  }
}
```

- [ ] **Step 3: 동작 검증**

GET 테스트:
```
curl "http://localhost:3000/api/v1/stock-ranking/snapshot?date=2026-03-27"
```

POST 테스트:
```
curl -X POST "http://localhost:3000/api/v1/stock-ranking/snapshot" \
  -H "Content-Type: application/json" \
  -d '{"model":"standard"}'
```

- [ ] **Step 4: 커밋**

```bash
git add web/src/app/api/v1/stock-ranking/snapshot/route.ts
git commit -m "feat: 스냅샷 조회 API — session_id 지원 + POST 수동 저장"
```

---

## Task 4: stock-ranking 스냅샷 저장 로직 — 세션 생성 통합

**Files:**
- Modify: `web/src/app/api/v1/stock-ranking/route.ts:1331-1377`

- [ ] **Step 1: 스냅샷 저장 블록을 세션 기반으로 변경**

기존 `if (saveSnapshot)` 블록 (line 1331-1377)을 수정:

```typescript
    // ── 스냅샷 저장 (snapshot=true 파라미터 시에만 — daily-prices 크론에서 호출) ──
    if (saveSnapshot) {
      void (async () => {
        try {
          const triggerType = searchParams.get('trigger_type') || 'cron';
          const now = new Date().toISOString();

          // 1. 세션 생성
          const { data: session, error: sessionError } = await supabase
            .from('snapshot_sessions')
            .insert({
              session_date: todayStr,
              session_time: now,
              model: model || 'standard',
              trigger_type: triggerType,
              total_count: allScored.length,
            })
            .select('id')
            .single();

          if (sessionError || !session) {
            console.error('세션 생성 실패:', sessionError);
            return;
          }

          // 2. 스냅샷 행 저장 (session_id 포함)
          const snapshotRows = allScored.map((item: StockRankItem) => ({
            snapshot_date: todayStr,
            snapshot_time: now,
            model: model || 'standard',
            session_id: session.id,
            symbol: item.symbol,
            name: item.name,
            market: item.market,
            current_price: item.current_price,
            market_cap: item.market_cap,
            daily_trading_value: item.trading_value ?? null,
            avg_trading_value_20d: item.avg_trading_value_20d ?? null,
            turnover_rate: item.turnover_rate ?? null,
            is_managed: item.is_managed ?? false,
            has_recent_cbw: item.has_recent_cbw ?? false,
            major_shareholder_pct: item.major_shareholder_pct ?? null,
            score_total: item.score_total,
            score_signal: item.score_signal,
            score_trend: item.score_momentum,
            score_valuation: item.score_valuation,
            score_supply: item.score_supply,
            score_risk: item.score_risk ?? 0,
            score_momentum: item.score_momentum,
            score_catalyst: item.score_catalyst ?? 0,
            grade: item.grade ?? null,
            characters: item.characters ?? null,
            recommendation: item.recommendation ?? null,
            signal_date: item.latest_signal_date ?? null,
            raw_data: item,
          }));

          for (let i = 0; i < snapshotRows.length; i += 500) {
            await supabase
              .from('stock_ranking_snapshot')
              .upsert(snapshotRows.slice(i, i + 500), {
                onConflict: 'session_id,symbol',
                ignoreDuplicates: false,
              });
          }
        } catch (e) {
          console.error('스냅샷 저장 실패:', e);
        }
      })();
    }
```

- [ ] **Step 2: 동작 검증**

```
curl "http://localhost:3000/api/v1/stock-ranking?refresh=true&snapshot=true" -H "Cache-Control: no-cache"
```

SQL로 세션 생성 확인:
```sql
SELECT * FROM snapshot_sessions ORDER BY id DESC LIMIT 5;
SELECT COUNT(*) FROM stock_ranking_snapshot WHERE session_id = (SELECT MAX(id) FROM snapshot_sessions);
```

- [ ] **Step 3: 커밋**

```bash
git add web/src/app/api/v1/stock-ranking/route.ts
git commit -m "feat: 스냅샷 저장 시 snapshot_sessions 세션 생성 통합"
```

---

## Task 5: 종목별 스냅샷 히스토리 API

**Files:**
- Create: `web/src/app/api/v1/stock-ranking/snapshot/history/route.ts`

- [ ] **Step 1: API 라우트 작성**

```typescript
// 종목별 스냅샷 히스토리 API
// 특정 종목의 과거 스냅샷 데이터를 세션별로 반환합니다.
// GET /api/v1/stock-ranking/snapshot/history?symbol=005930&model=standard&limit=30
import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const symbol = searchParams.get('symbol');
  const model = searchParams.get('model') || 'standard';
  const limit = Math.min(Number(searchParams.get('limit') || '30'), 100);

  if (!symbol) {
    return NextResponse.json({ error: 'symbol 파라미터 필요' }, { status: 400 });
  }

  const supabase = createServiceClient();

  // snapshot + session JOIN
  const { data, error } = await supabase
    .from('stock_ranking_snapshot')
    .select(`
      session_id,
      current_price,
      score_total,
      grade,
      snapshot_sessions!inner (
        id,
        session_date,
        session_time,
        trigger_type
      )
    `)
    .eq('symbol', symbol)
    .eq('model', model)
    .order('snapshot_time', { ascending: false })
    .limit(limit);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const items = (data ?? []).map((row) => {
    const session = row.snapshot_sessions as unknown as {
      id: number;
      session_date: string;
      session_time: string;
      trigger_type: string;
    };
    return {
      session_id: row.session_id,
      session_date: session.session_date,
      session_time: session.session_time,
      trigger_type: session.trigger_type,
      snapshot_price: row.current_price,
      grade: row.grade,
      score_total: row.score_total,
    };
  });

  return NextResponse.json(
    { symbol, model, items },
    { headers: { 'Cache-Control': 'public, s-maxage=120, stale-while-revalidate=300' } },
  );
}
```

- [ ] **Step 2: 동작 검증**

```
curl "http://localhost:3000/api/v1/stock-ranking/snapshot/history?symbol=005930"
```

Expected: `{ "symbol": "005930", "model": "standard", "items": [{ "session_id": ..., "session_date": "2026-03-27", "snapshot_price": 65000, "grade": "A", ... }] }`

- [ ] **Step 3: 커밋**

```bash
git add web/src/app/api/v1/stock-ranking/snapshot/history/route.ts
git commit -m "feat: 종목별 스냅샷 히스토리 API 추가"
```

---

## Task 6: 타임라인 바 컴포넌트

**Files:**
- Create: `web/src/components/signals/SnapshotTimeline.tsx`

- [ ] **Step 1: 타임라인 컴포넌트 작성**

```typescript
'use client';

import React from 'react';

interface Session {
  id: number;
  session_time: string;
  trigger_type: string;
  total_count: number;
}

interface SnapshotTimelineProps {
  sessions: Session[];
  activeSessionId: number | null;
  onSelect: (sessionId: number) => void;
}

/**
 * 같은 날짜의 여러 스냅샷 세션을 시간별 점(dot)으로 표시하는 타임라인 바.
 * 세션이 2개 이상일 때만 표시.
 */
export function SnapshotTimeline({ sessions, activeSessionId, onSelect }: SnapshotTimelineProps) {
  if (sessions.length < 2) return null;

  // 시간 포맷: "16:00"
  const formatTime = (iso: string) => {
    const d = new Date(iso);
    return d.toLocaleTimeString('ko-KR', {
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
      timeZone: 'Asia/Seoul',
    });
  };

  return (
    <div className="px-4 py-2 border-b border-[var(--border)]">
      <div className="flex items-center gap-2 text-[10px] text-[var(--muted)] mb-1.5">
        <span>타임라인</span>
        <span className="flex items-center gap-1">
          <span className="w-2 h-2 rounded-full bg-blue-500 inline-block" />자동
        </span>
        <span className="flex items-center gap-1">
          <span className="w-2 h-2 rounded-full bg-green-500 inline-block" />수동
        </span>
      </div>

      {/* 타임라인 바 */}
      <div className="relative h-8 flex items-center">
        {/* 배경 라인 */}
        <div className="absolute left-0 right-0 h-0.5 bg-[var(--border)] rounded-full" />

        {/* 세션 점들 */}
        {sessions.map((s, idx) => {
          const pct = sessions.length === 1 ? 50 : (idx / (sessions.length - 1)) * 100;
          const isActive = s.id === activeSessionId;
          const dotColor = s.trigger_type === 'manual' ? 'bg-green-500' : 'bg-blue-500';

          return (
            <button
              key={s.id}
              onClick={() => onSelect(s.id)}
              className="absolute -translate-x-1/2 flex flex-col items-center group"
              style={{ left: `${pct}%` }}
              title={`${formatTime(s.session_time)} (${s.trigger_type === 'manual' ? '수동' : '자동'}) · ${s.total_count}종목`}
            >
              <div
                className={`w-3.5 h-3.5 rounded-full border-2 transition-all ${
                  isActive
                    ? `${dotColor} border-white shadow-md scale-125`
                    : `${dotColor}/50 border-transparent hover:scale-110`
                }`}
              />
              <span className={`mt-1 text-[9px] whitespace-nowrap ${
                isActive ? 'text-[var(--foreground)] font-semibold' : 'text-[var(--muted)]'
              }`}>
                {formatTime(s.session_time)}
              </span>
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
git add web/src/components/signals/SnapshotTimeline.tsx
git commit -m "feat: 스냅샷 타임라인 바 컴포넌트 추가"
```

---

## Task 7: SnapshotTracker 리뉴얼 — 세션 기반 + 타임라인 + 수동 저장

**Files:**
- Modify: `web/src/components/signals/SnapshotTracker.tsx`

- [ ] **Step 1: 세션 기반 데이터 로딩으로 변경**

전체 컴포넌트를 리뉴얼합니다. 핵심 변경 사항:

1. 날짜 선택 시 `/api/v1/stock-ranking/sessions?date=...` 호출하여 세션 목록 로드
2. 세션이 여러 개면 `SnapshotTimeline` 표시
3. 선택된 세션의 `/api/v1/stock-ranking/snapshot?session_id=...` 호출
4. 헤더에 "스냅샷 저장" 버튼 추가
5. 종목 클릭 시 `openStockModal` 호출 (수익률 추이 탭 열기 용)

상태 추가:
```typescript
const [sessions, setSessions] = useState<Session[]>([]);
const [activeSessionId, setActiveSessionId] = useState<number | null>(null);
const [saving, setSaving] = useState(false);
```

세션 목록 로드:
```typescript
const fetchSessions = useCallback(async (date: string) => {
  const res = await window.fetch(
    `/api/v1/stock-ranking/sessions?date=${date}&model=standard`,
  );
  if (res.ok) {
    const { sessions: list } = await res.json();
    setSessions(list);
    if (list.length > 0) {
      // 가장 최신 세션 선택
      setActiveSessionId(list[list.length - 1].id);
    } else {
      setActiveSessionId(null);
      setSnapshotData(null);
    }
  }
}, []);
```

세션별 스냅샷 로드 (기존 fetchSnapshot 수정):
```typescript
const fetchSnapshot = useCallback(async (sessionId: number) => {
  setLoading(true);
  try {
    const res = await window.fetch(
      `/api/v1/stock-ranking/snapshot?session_id=${sessionId}`,
    );
    if (res.ok) {
      const data: SnapshotResponse = await res.json();
      setSnapshotData(data);
    } else {
      setSnapshotData(null);
    }
  } catch {
    setSnapshotData(null);
  } finally {
    setLoading(false);
  }
}, []);
```

수동 스냅샷 저장:
```typescript
const handleSaveSnapshot = useCallback(async () => {
  setSaving(true);
  try {
    const res = await window.fetch('/api/v1/stock-ranking/snapshot', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: scoreMode === 'short_term' ? 'short_term' : 'standard' }),
    });
    if (res.ok) {
      // 현재 날짜로 새로고침
      const today = new Date().toISOString().slice(0, 10);
      setSelectedDate(today);
      fetchSessions(today);
    }
  } finally {
    setSaving(false);
  }
}, [scoreMode, fetchSessions]);
```

useEffect 수정:
```typescript
// 날짜 변경 → 세션 목록 로드
useEffect(() => {
  if (selectedDate) fetchSessions(selectedDate);
}, [selectedDate, fetchSessions]);

// 세션 선택 → 스냅샷 로드
useEffect(() => {
  if (activeSessionId) fetchSnapshot(activeSessionId);
}, [activeSessionId, fetchSnapshot]);
```

헤더에 저장 버튼 추가 (닫기 버튼 왼쪽):
```tsx
<button
  onClick={handleSaveSnapshot}
  disabled={saving}
  className="px-3 py-1.5 text-xs font-medium rounded-lg bg-[var(--accent)] text-white hover:bg-[var(--accent)]/90 disabled:opacity-50 transition-colors"
>
  {saving ? '저장 중...' : '스냅샷 저장'}
</button>
```

타임라인 바 삽입 (날짜 선택 영역과 테이블 사이):
```tsx
<SnapshotTimeline
  sessions={sessions}
  activeSessionId={activeSessionId}
  onSelect={setActiveSessionId}
/>
```

SnapshotResponse 타입에 `session_id`, `trigger_type` 필드 추가:
```typescript
interface SnapshotResponse {
  date: string;
  model: string;
  session_id: number | null;
  snapshot_time: string | null;
  trigger_type: string | null;
  items: SnapshotItem[];
  total: number;
}
```

- [ ] **Step 2: 종목 클릭 핸들러 추가**

테이블 행에 클릭 이벤트 추가. `useStockModal` 훅 사용:

```typescript
import { useStockModal } from '@/contexts/stock-modal-context';

// 컴포넌트 내부
const { openStockModal } = useStockModal();

// 행 클릭 핸들러
const handleRowClick = useCallback((row: TrackerRow) => {
  openStockModal(row.symbol, row.name);
}, [openStockModal]);
```

`<tr>` 에 추가:
```tsx
<tr
  key={row.symbol}
  onClick={() => handleRowClick(row)}
  className="hover:bg-[var(--card-hover)] transition-colors cursor-pointer"
>
```

- [ ] **Step 3: 동작 검증**

1. 순위 트래킹 모달 열기
2. 날짜 선택 → 세션 목록이 로드되는지 확인
3. 세션 2개 이상일 때 타임라인 바 표시 확인
4. "스냅샷 저장" 버튼 클릭 → POST 호출 확인
5. 종목 클릭 → 종목 상세 모달 열기 확인

- [ ] **Step 4: 커밋**

```bash
git add web/src/components/signals/SnapshotTracker.tsx
git commit -m "feat: SnapshotTracker — 세션 기반 조회 + 타임라인 + 수동 저장"
```

---

## Task 8: RecommendationFilterBar — 수동 스냅샷 저장 버튼 추가

**Files:**
- Modify: `web/src/components/signals/RecommendationFilterBar.tsx`

- [ ] **Step 1: 저장 버튼 추가**

`RecommendationFilterBarProps`에 추가:
```typescript
onSaveSnapshot?: () => void;
savingSnapshot?: boolean;
```

기존 BarChart3 버튼(순위 트래킹) 옆에 스냅샷 저장 버튼 추가. 기존 아이콘 버튼 그룹 영역 (line ~354 부근)에:

```tsx
{/* 스냅샷 저장 버튼 */}
{onSaveSnapshot && (
  <button
    onClick={onSaveSnapshot}
    disabled={savingSnapshot}
    className="p-2 rounded-lg border border-[var(--border)] text-[var(--muted)] hover:text-[var(--foreground)] hover:bg-[var(--card-hover)] disabled:opacity-50 transition-colors"
    title="현재 스냅샷 저장"
  >
    {savingSnapshot ? (
      <Loader2 size={16} className="animate-spin" />
    ) : (
      <Camera size={16} />
    )}
  </button>
)}
```

import에 `Camera, Loader2` 추가:
```typescript
import { Search, RefreshCw, MoreHorizontal, BarChart3, SlidersHorizontal, Camera, Loader2 } from 'lucide-react';
```

- [ ] **Step 2: 부모 컴포넌트(UnifiedAnalysisSection)에서 연결**

`UnifiedAnalysisSection.tsx`에 스냅샷 저장 콜백 추가:

```typescript
const [savingSnapshot, setSavingSnapshot] = useState(false);

const handleSaveSnapshot = useCallback(async () => {
  setSavingSnapshot(true);
  try {
    await window.fetch('/api/v1/stock-ranking/snapshot', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: 'standard' }),
    });
  } finally {
    setSavingSnapshot(false);
  }
}, []);
```

`<RecommendationFilterBar>` prop에 추가:
```tsx
onSaveSnapshot={handleSaveSnapshot}
savingSnapshot={savingSnapshot}
```

- [ ] **Step 3: 커밋**

```bash
git add web/src/components/signals/RecommendationFilterBar.tsx web/src/components/signals/UnifiedAnalysisSection.tsx
git commit -m "feat: RecommendationFilterBar — 수동 스냅샷 저장 버튼 추가"
```

---

## Task 9: 종목별 수익률 추이 섹션

**Files:**
- Create: `web/src/components/stock-modal/ReturnTrendSection.tsx`
- Modify: `web/src/components/stock-modal/StockDetailPanel.tsx`

- [ ] **Step 1: ReturnTrendSection 컴포넌트 작성**

```typescript
'use client';

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { TrendingUp, TrendingDown, Loader2 } from 'lucide-react';

interface HistoryItem {
  session_id: number;
  session_date: string;
  session_time: string;
  trigger_type: string;
  snapshot_price: number | null;
  grade: string | null;
  score_total: number;
}

interface ReturnTrendSectionProps {
  symbol: string;
  currentPrice: number | null;
}

const GRADE_CLS: Record<string, string> = {
  S: 'bg-purple-100 text-purple-800 dark:bg-purple-900/40 dark:text-purple-300',
  A: 'bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-300',
  B: 'bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-300',
  C: 'bg-orange-100 text-orange-800 dark:bg-orange-900/40 dark:text-orange-300',
  D: 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300',
};

export function ReturnTrendSection({ symbol, currentPrice }: ReturnTrendSectionProps) {
  const [items, setItems] = useState<HistoryItem[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchHistory = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(
        `/api/v1/stock-ranking/snapshot/history?symbol=${symbol}&limit=30`,
      );
      if (res.ok) {
        const data = await res.json();
        setItems(data.items ?? []);
      }
    } catch {
      // 무시
    } finally {
      setLoading(false);
    }
  }, [symbol]);

  useEffect(() => {
    fetchHistory();
  }, [fetchHistory]);

  // 수익률 계산
  const rows = useMemo(() => {
    return items.map((item) => {
      let returnPct: number | null = null;
      if (item.snapshot_price && item.snapshot_price > 0 && currentPrice && currentPrice > 0) {
        returnPct = ((currentPrice - item.snapshot_price) / item.snapshot_price) * 100;
      }
      return { ...item, returnPct };
    });
  }, [items, currentPrice]);

  const fmtDate = (dateStr: string) => {
    const d = new Date(dateStr);
    return `${d.getMonth() + 1}/${d.getDate()}`;
  };

  const fmtTime = (iso: string) => {
    const d = new Date(iso);
    return d.toLocaleTimeString('ko-KR', {
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
      timeZone: 'Asia/Seoul',
    });
  };

  const fmtReturn = (v: number | null) => {
    if (v == null) return { text: '-', cls: 'text-[var(--muted)]' };
    const sign = v > 0 ? '+' : '';
    const cls = v > 0 ? 'text-[var(--danger)]' : v < 0 ? 'text-blue-500' : 'text-[var(--muted)]';
    return { text: `${sign}${v.toFixed(2)}%`, cls };
  };

  if (loading) {
    return (
      <div className="p-4">
        <h3 className="text-sm font-semibold text-[var(--foreground)] mb-3">수익률 추이</h3>
        <div className="flex items-center justify-center py-8 text-[var(--muted)] text-sm gap-2">
          <Loader2 size={14} className="animate-spin" />
          로딩 중...
        </div>
      </div>
    );
  }

  if (rows.length === 0) {
    return (
      <div className="p-4">
        <h3 className="text-sm font-semibold text-[var(--foreground)] mb-3">수익률 추이</h3>
        <p className="text-sm text-[var(--muted)] text-center py-6">스냅샷 데이터가 없습니다</p>
      </div>
    );
  }

  // 간이 라인 차트 (SVG)
  const validRows = rows.filter((r) => r.returnPct !== null);
  const maxAbs = Math.max(1, ...validRows.map((r) => Math.abs(r.returnPct!)));
  const chartW = 280;
  const chartH = 80;
  const padding = 8;

  const points = validRows
    .slice()
    .reverse() // 오래된 순
    .map((r, i, arr) => {
      const x = padding + (i / Math.max(1, arr.length - 1)) * (chartW - padding * 2);
      const y = chartH / 2 - (r.returnPct! / maxAbs) * (chartH / 2 - padding);
      return { x, y, returnPct: r.returnPct! };
    });

  const pathD = points.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x} ${p.y}`).join(' ');

  return (
    <div className="p-4">
      <h3 className="text-sm font-semibold text-[var(--foreground)] mb-3">수익률 추이</h3>

      {/* 간이 라인 차트 */}
      {validRows.length >= 2 && (
        <div className="mb-3 flex justify-center">
          <svg width={chartW} height={chartH} className="overflow-visible">
            {/* 0% 기준선 */}
            <line
              x1={padding}
              y1={chartH / 2}
              x2={chartW - padding}
              y2={chartH / 2}
              stroke="var(--border)"
              strokeDasharray="3 3"
            />
            {/* 라인 */}
            <path d={pathD} fill="none" stroke="var(--accent)" strokeWidth={2} />
            {/* 점 */}
            {points.map((p, i) => (
              <circle
                key={i}
                cx={p.x}
                cy={p.y}
                r={3}
                fill={p.returnPct >= 0 ? 'var(--danger)' : '#3b82f6'}
              />
            ))}
          </svg>
        </div>
      )}

      {/* 테이블 */}
      <div className="max-h-[200px] overflow-y-auto">
        <table className="w-full text-xs">
          <thead className="sticky top-0 bg-[var(--card)]">
            <tr className="text-[var(--muted)] border-b border-[var(--border)]">
              <th className="py-1.5 text-left">날짜</th>
              <th className="py-1.5 text-center">등급</th>
              <th className="py-1.5 text-right">당시가격</th>
              <th className="py-1.5 text-right">수익률</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[var(--border)]">
            {rows.map((row) => {
              const ret = fmtReturn(row.returnPct);
              const gradeCls = row.grade
                ? GRADE_CLS[row.grade] ?? 'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400'
                : '';
              return (
                <tr key={row.session_id}>
                  <td className="py-1.5 text-[var(--muted)]">
                    {fmtDate(row.session_date)}
                    <span className="ml-1 text-[9px]">{fmtTime(row.session_time)}</span>
                  </td>
                  <td className="py-1.5 text-center">
                    {row.grade ? (
                      <span className={`inline-block px-1 py-0.5 rounded text-[9px] font-bold ${gradeCls}`}>
                        {row.grade}
                      </span>
                    ) : '-'}
                  </td>
                  <td className="py-1.5 text-right tabular-nums">
                    {row.snapshot_price?.toLocaleString() ?? '-'}
                  </td>
                  <td className={`py-1.5 text-right font-semibold tabular-nums ${ret.cls}`}>
                    <span className="inline-flex items-center gap-0.5 justify-end">
                      {row.returnPct != null && row.returnPct > 0 && <TrendingUp size={9} />}
                      {row.returnPct != null && row.returnPct < 0 && <TrendingDown size={9} />}
                      {ret.text}
                    </span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: StockDetailPanel에 ReturnTrendSection 추가**

`StockDetailPanel.tsx` 수정. 우측 컬럼에서 `ConsensusSection` 앞에 추가:

import 추가:
```typescript
import { ReturnTrendSection } from './ReturnTrendSection';
```

JSX (MetricsGrid 아래, ConsensusSection 위에):
```tsx
{/* 수익률 추이 */}
<ReturnTrendSection
  symbol={modal.symbol}
  currentPrice={currentPrice}
/>
```

- [ ] **Step 3: 동작 검증**

1. 종목 상세 모달 열기
2. 우측 컬럼에 "수익률 추이" 섹션 표시 확인
3. 과거 스냅샷 데이터가 있으면 차트 + 테이블 표시 확인
4. 데이터 없으면 "스냅샷 데이터가 없습니다" 표시 확인

- [ ] **Step 4: 커밋**

```bash
git add web/src/components/stock-modal/ReturnTrendSection.tsx web/src/components/stock-modal/StockDetailPanel.tsx
git commit -m "feat: 종목 상세 모달에 수익률 추이 섹션 추가"
```

---

## Task 10: daily-prices 크론 — 가격 소스 우선순위 적용

**Files:**
- Modify: `web/src/app/api/v1/cron/daily-prices/route.ts:242-257`

- [ ] **Step 1: 스냅샷 트리거에 실시간 가격 우선 적용**

기존 Step 8 블록을 수정. 현재는 `stock-ranking?refresh=true&snapshot=true`를 호출하는데, 이 때 stock-ranking 내부에서 `stock_cache.current_price`를 사용합니다. 실시간 가격 우선순위를 적용하려면, daily-prices 크론이 이미 Step 1에서 네이버에서 가격을 받아 `stock_cache`를 갱신한 후이므로, 크론 완료 직후 `stock_cache`의 가격이 곧 최신 실시간 가격입니다.

따라서 기존 로직은 이미 올바릅니다 — 크론이 먼저 모든 가격을 갱신한 후 스냅샷을 저장하므로, `stock_cache.current_price`가 이 시점에서 가장 최신입니다.

수동 스냅샷(POST)의 경우에는 stock-ranking API의 refresh 모드가 `stock_cache`에서 읽으므로, 수동 저장 전에 가격을 먼저 갱신해야 합니다. POST 핸들러를 수정:

`web/src/app/api/v1/stock-ranking/snapshot/route.ts`의 POST 핸들러에 가격 갱신 단계를 추가:

```typescript
// POST 핸들러 내부, stock-ranking 호출 전에:
// 실시간 가격 갱신 (수동 스냅샷 시 최신 가격 보장)
await fetch(`${baseUrl}/api/v1/prices`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
}).catch(() => {});
```

- [ ] **Step 2: 커밋**

```bash
git add web/src/app/api/v1/stock-ranking/snapshot/route.ts
git commit -m "feat: 수동 스냅샷 저장 전 실시간 가격 갱신 추가"
```

---

## 종속성 다이어그램

```
Task 1 (DB 마이그레이션)
  ├─→ Task 2 (세션 목록 API)
  ├─→ Task 3 (스냅샷 조회/POST API)
  ├─→ Task 4 (stock-ranking 세션 생성)
  └─→ Task 5 (히스토리 API)

Task 6 (타임라인 컴포넌트) — 독립

Task 2 + Task 3 + Task 6
  └─→ Task 7 (SnapshotTracker 리뉴얼)

Task 3
  └─→ Task 8 (FilterBar 저장 버튼)

Task 5
  └─→ Task 9 (ReturnTrendSection)

Task 3 + Task 4
  └─→ Task 10 (가격 소스 우선순위)
```

병렬 실행 가능한 그룹:
- **그룹 A** (Task 1 이후): Task 2, 3, 4, 5 — 모두 독립
- **그룹 B** (그룹 A 이후): Task 6, 7, 8, 9, 10 — Task 6은 독립, 나머지는 의존성 참조
