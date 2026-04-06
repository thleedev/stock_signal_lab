# GHA 전환 Plan A: DB 마이그레이션 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** GHA 배치 아키텍처에 필요한 DB 스키마 변경 — stock_scores, batch_runs 테이블 생성, daily_prices.is_provisional 컬럼 추가

**Architecture:** Supabase 마이그레이션 파일로 스키마 변경. 기존 테이블은 건드리지 않고 신규 테이블만 추가. RLS는 service role이 GHA에서 쓰기, anon은 읽기만.

**Tech Stack:** PostgreSQL (Supabase), SQL migration files

---

## 파일 구조

```
supabase/migrations/
  057_add_stock_scores.sql       # stock_scores 테이블 (신규)
  058_add_batch_runs.sql         # batch_runs 테이블 (신규)
  059_add_is_provisional.sql     # daily_prices.is_provisional 컬럼 추가
```

---

### Task 1: stock_scores 테이블 생성

**Files:**
- Create: `supabase/migrations/057_add_stock_scores.sql`

- [ ] **Step 1: 마이그레이션 파일 작성**

```sql
-- 057_add_stock_scores.sql
-- GHA 배치에서 계산한 축별 점수 저장
-- 클라이언트는 이 테이블에서 SELECT + 가중치 합산만 수행

CREATE TABLE IF NOT EXISTS stock_scores (
  symbol          VARCHAR(10)   NOT NULL REFERENCES stock_cache(symbol) ON DELETE CASCADE,
  scored_at       DATE          NOT NULL,
  prev_close      NUMERIC,                      -- 전일 종가 (모멘텀 실시간 보정 기준)
  score_value     NUMERIC       DEFAULT 0,      -- 가치 점수 (0~100)
  score_growth    NUMERIC       DEFAULT 0,      -- 성장 점수 (0~100)
  score_supply    NUMERIC       DEFAULT 0,      -- 수급 점수 (0~100)
  score_momentum  NUMERIC       DEFAULT 0,      -- 모멘텀 점수 T-1 기준 (0~100)
  score_risk      NUMERIC       DEFAULT 0,      -- 리스크 점수 (0~100, 높을수록 위험)
  score_signal    NUMERIC       DEFAULT 0,      -- 신호 점수 (0~100)
  updated_at      TIMESTAMPTZ   DEFAULT NOW(),
  PRIMARY KEY (symbol)
);

CREATE INDEX IF NOT EXISTS stock_scores_scored_at_idx ON stock_scores(scored_at);
CREATE INDEX IF NOT EXISTS stock_scores_value_idx ON stock_scores(score_value DESC);
CREATE INDEX IF NOT EXISTS stock_scores_momentum_idx ON stock_scores(score_momentum DESC);

ALTER TABLE stock_scores ENABLE ROW LEVEL SECURITY;

-- anon: 읽기만
CREATE POLICY "stock_scores_read" ON stock_scores
  FOR SELECT USING (true);

-- service role: 모든 작업 (GHA 배치)
CREATE POLICY "stock_scores_service_write" ON stock_scores
  FOR ALL USING (auth.role() = 'service_role');

COMMENT ON TABLE stock_scores IS 'GHA 배치가 매일 16:10 KST 이후 계산하는 축별 점수. 클라이언트는 읽기만.';
COMMENT ON COLUMN stock_scores.prev_close IS '전일 종가 — stock_cache.current_price와 비교해 모멘텀 실시간 보정에 사용';
COMMENT ON COLUMN stock_scores.score_risk IS '높을수록 리스크 큼 (감점 방향으로 사용)';
```

- [ ] **Step 2: Supabase에 마이그레이션 적용**

```bash
cd /Users/thlee/GoogleDrive/DashboardStock
npx supabase db push
```

예상 출력:
```
Applying migration 057_add_stock_scores.sql...
Done.
```

- [ ] **Step 3: 테이블 생성 확인**

```bash
npx supabase db diff
```

`stock_scores` 테이블이 목록에 없으면 정상 (이미 적용됨).

- [ ] **Step 4: 커밋**

```bash
git add supabase/migrations/057_add_stock_scores.sql
git commit -m "feat: stock_scores 테이블 추가 (GHA 배치 축별 점수 저장)"
```

---

### Task 2: batch_runs 테이블 생성

**Files:**
- Create: `supabase/migrations/058_add_batch_runs.sql`

- [ ] **Step 1: 마이그레이션 파일 작성**

```sql
-- 058_add_batch_runs.sql
-- GHA 배치 실행 상태 추적
-- Supabase Realtime으로 프론트엔드가 구독 → 완료 시 데이터 재조회

CREATE TABLE IF NOT EXISTS batch_runs (
  id            UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  workflow      TEXT          NOT NULL DEFAULT 'daily-batch',
  mode          TEXT          NOT NULL DEFAULT 'full',  -- 'full' | 'repair' | 'prices-only'
  status        TEXT          NOT NULL DEFAULT 'pending', -- 'pending' | 'running' | 'done' | 'failed'
  triggered_by  TEXT          NOT NULL DEFAULT 'schedule', -- 'schedule' | 'manual'
  started_at    TIMESTAMPTZ   DEFAULT NOW(),
  finished_at   TIMESTAMPTZ,
  summary       JSONB,        -- { collected: number, scored: number, errors: string[] }
  created_at    TIMESTAMPTZ   DEFAULT NOW()
);

-- 최근 실행 조회용
CREATE INDEX IF NOT EXISTS batch_runs_started_at_idx ON batch_runs(started_at DESC);
CREATE INDEX IF NOT EXISTS batch_runs_status_idx ON batch_runs(status);

ALTER TABLE batch_runs ENABLE ROW LEVEL SECURITY;

-- anon: 읽기만 (프론트엔드 상태 구독)
CREATE POLICY "batch_runs_read" ON batch_runs
  FOR SELECT USING (true);

-- service role: 모든 작업 (GHA 배치)
CREATE POLICY "batch_runs_service_write" ON batch_runs
  FOR ALL USING (auth.role() = 'service_role');

-- Realtime 활성화
ALTER PUBLICATION supabase_realtime ADD TABLE batch_runs;

COMMENT ON TABLE batch_runs IS 'GHA 배치 실행 이력. Supabase Realtime으로 프론트엔드가 완료 감지.';
COMMENT ON COLUMN batch_runs.mode IS 'full=전체배치, repair=누락보정, prices-only=현재가만';
COMMENT ON COLUMN batch_runs.summary IS '{ collected: 수집건수, scored: 점수계산건수, errors: [에러메시지] }';
```

- [ ] **Step 2: 마이그레이션 적용**

```bash
npx supabase db push
```

- [ ] **Step 3: Realtime 활성화 확인**

Supabase 대시보드 → Database → Replication → `batch_runs` 테이블이 supabase_realtime publication에 포함됐는지 확인.

- [ ] **Step 4: 커밋**

```bash
git add supabase/migrations/058_add_batch_runs.sql
git commit -m "feat: batch_runs 테이블 추가 (GHA 배치 상태 추적 + Realtime)"
```

---

### Task 3: daily_prices.is_provisional 컬럼 추가

**Files:**
- Create: `supabase/migrations/059_add_is_provisional.sql`

- [ ] **Step 1: 마이그레이션 파일 작성**

```sql
-- 059_add_is_provisional.sql
-- 장중 임시 캔들(Yahoo 실시간)과 확정 캔들(Naver 배치) 구분

ALTER TABLE daily_prices
  ADD COLUMN IF NOT EXISTS is_provisional BOOLEAN NOT NULL DEFAULT FALSE;

COMMENT ON COLUMN daily_prices.is_provisional IS
  'true = 장중 임시 캔들 (현재가 기준, 미확정). false = 배치 확정 종가. 배치 실행 후 false로 덮어씀.';

-- 임시 캔들만 빠르게 조회할 때 사용
CREATE INDEX IF NOT EXISTS daily_prices_provisional_idx
  ON daily_prices(is_provisional) WHERE is_provisional = TRUE;
```

- [ ] **Step 2: 마이그레이션 적용**

```bash
npx supabase db push
```

- [ ] **Step 3: 기존 데이터 확인 (is_provisional = false 기본값)**

```bash
npx supabase db diff
```

기존 daily_prices 행은 모두 `is_provisional = false` (DEFAULT 적용됨).

- [ ] **Step 4: 커밋**

```bash
git add supabase/migrations/059_add_is_provisional.sql
git commit -m "feat: daily_prices.is_provisional 컬럼 추가 (임시/확정 캔들 구분)"
```

---

### Task 4: TypeScript 타입 업데이트

**Files:**
- Create: `web/src/types/batch.ts`
- Modify: `web/src/types/` (필요 시)

- [ ] **Step 1: batch 관련 타입 파일 작성**

```typescript
// web/src/types/batch.ts

export type BatchMode = 'full' | 'repair' | 'prices-only';
export type BatchStatus = 'pending' | 'running' | 'done' | 'failed';
export type BatchTriggeredBy = 'schedule' | 'manual';

export interface BatchRun {
  id: string;
  workflow: string;
  mode: BatchMode;
  status: BatchStatus;
  triggered_by: BatchTriggeredBy;
  started_at: string;
  finished_at: string | null;
  summary: BatchSummary | null;
  created_at: string;
}

export interface BatchSummary {
  collected: number;
  scored: number;
  errors: string[];
}

export interface StockScore {
  symbol: string;
  scored_at: string;       // YYYY-MM-DD
  prev_close: number | null;
  score_value: number;
  score_growth: number;
  score_supply: number;
  score_momentum: number;
  score_risk: number;
  score_signal: number;
  updated_at: string;
}
```

- [ ] **Step 2: 커밋**

```bash
git add web/src/types/batch.ts
git commit -m "feat: BatchRun, StockScore 타입 추가"
```

---

## 검증

Plan A 완료 후 확인 사항:

```bash
# 1. stock_scores 테이블 존재 확인
npx supabase db diff  # 차이 없음 = 모두 적용됨

# 2. 타입 오류 없음
cd web && npm run build
```
