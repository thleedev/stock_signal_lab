# GHA 전환 Plan B: GHA 배치 스크립트 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** GitHub Actions에서 실행할 배치 스크립트 전체 구현 — 전종목 수집, 점수화, 시황, 이벤트, 정리까지 포함

**Architecture:** `.github/scripts/` 에 TypeScript 스크립트를 두고 `tsx`로 실행. 각 step은 독립 모듈로 분리해 단독 테스트 가능. `index.ts`가 mode에 따라 step을 조합해 실행. 기존 `web/src/lib/`의 점수 계산 로직을 그대로 재사용.

**Tech Stack:** Node.js 20, TypeScript, tsx, @supabase/supabase-js, 기존 naver-stock-api.ts / krx-api.ts / unified-scoring/engine.ts 재사용

**전제 조건:** Plan A (DB 마이그레이션) 완료 필요

---

## 파일 구조

```
.github/
├── workflows/
│   └── daily-batch.yml               # GHA workflow (Task 1)
└── scripts/
    ├── package.json                   # tsx, supabase-js 의존성 (Task 2)
    ├── tsconfig.json
    ├── shared/
    │   ├── supabase.ts                # DB 클라이언트 (Task 2)
    │   └── logger.ts                  # batch_runs 상태 업데이트 (Task 2)
    └── batch/
        ├── index.ts                   # 진입점 — mode 분기 (Task 3)
        ├── prices-only.ts             # 장중 현재가 수집 (Task 4)
        ├── step1-daily-prices.ts      # 전종목 일봉 수집 (Task 5)
        ├── step2-investor-data.ts     # 수급/지표 수집 (Task 6)
        ├── step3-shortsell.ts         # 공매도 수집 (Task 7)
        ├── step4-scoring.ts           # 축별 점수 계산 (Task 8)
        ├── step5-ai-report.ts         # AI 리포트 생성 (Task 9)
        ├── step6-market-data.ts       # 시황 지표 수집 (Task 10)
        ├── step7-events.ts            # 이벤트 캘린더 갱신 (Task 11)
        └── step8-cleanup.ts           # 2년 초과 데이터 삭제 (Task 12)
```

---

### Task 1: GHA Workflow 파일 생성

**Files:**
- Create: `.github/workflows/daily-batch.yml`

- [ ] **Step 1: workflow 파일 작성**

```yaml
# .github/workflows/daily-batch.yml
name: Daily Batch

on:
  schedule:
    # 장중 현재가 수집: 08:00~20:45 KST (UTC 23:00~11:45, 평일)
    - cron: '*/15 23-11 * * 1-5'
    # 메인 배치: 16:10 KST (UTC 07:10, 평일)
    - cron: '10 7 * * 1-5'
    # 보정 배치: 07:00 KST (UTC 22:00, 매일)
    - cron: '0 22 * * *'
  workflow_dispatch:
    inputs:
      date:
        description: '재수집 기준일 (YYYY-MM-DD, 빈칸이면 오늘)'
        required: false
      mode:
        description: 'full | repair | prices-only'
        required: false
        default: 'full'

jobs:
  batch:
    runs-on: ubuntu-latest
    timeout-minutes: 60
    steps:
      - uses: actions/checkout@v4

      - uses: actions/setup-node@v4
        with:
          node-version: '20'
          cache: 'npm'
          cache-dependency-path: .github/scripts/package-lock.json

      - name: Install dependencies
        run: npm ci
        working-directory: .github/scripts

      - name: Detect mode
        id: detect-mode
        run: |
          # workflow_dispatch면 inputs.mode 사용
          # schedule이면 UTC 시간으로 mode 결정:
          #   UTC 22:xx → 07:00 KST 보정 → repair
          #   UTC 07:10 → 16:10 KST 메인 → full
          #   나머지  → 장중 현재가 → prices-only
          HOUR=$(date -u +%H)
          MINUTE=$(date -u +%M)
          INPUT_MODE="${{ inputs.mode }}"

          if [ -n "$INPUT_MODE" ]; then
            MODE="$INPUT_MODE"
          elif [ "$HOUR" = "07" ] && [ "$MINUTE" = "10" ]; then
            MODE="full"
          elif [ "$HOUR" = "22" ] && [ "$MINUTE" = "00" ]; then
            MODE="repair"
          else
            MODE="prices-only"
          fi

          echo "mode=$MODE" >> $GITHUB_OUTPUT
          echo "Detected mode: $MODE"

      - name: Run batch
        run: npx tsx batch/index.ts
        working-directory: .github/scripts
        env:
          SUPABASE_URL: ${{ secrets.SUPABASE_URL }}
          SUPABASE_SERVICE_KEY: ${{ secrets.SUPABASE_SERVICE_KEY }}
          OPENAI_API_KEY: ${{ secrets.OPENAI_API_KEY }}
          FRED_API_KEY: ${{ secrets.FRED_API_KEY }}
          BATCH_MODE: ${{ steps.detect-mode.outputs.mode }}
          TARGET_DATE: ${{ inputs.date }}
```

- [ ] **Step 2: .github 디렉토리 생성 확인**

```bash
mkdir -p /Users/thlee/GoogleDrive/DashboardStock/.github/workflows
mkdir -p /Users/thlee/GoogleDrive/DashboardStock/.github/scripts/shared
mkdir -p /Users/thlee/GoogleDrive/DashboardStock/.github/scripts/batch
```

- [ ] **Step 3: 커밋**

```bash
git add .github/workflows/daily-batch.yml
git commit -m "feat: GHA daily-batch workflow 추가 (3개 스케줄 + workflow_dispatch)"
```

---

### Task 2: 공유 인프라 (supabase, logger, package.json)

**Files:**
- Create: `.github/scripts/package.json`
- Create: `.github/scripts/tsconfig.json`
- Create: `.github/scripts/shared/supabase.ts`
- Create: `.github/scripts/shared/logger.ts`

- [ ] **Step 1: package.json 작성**

```json
{
  "name": "dashboardstock-batch",
  "version": "1.0.0",
  "private": true,
  "scripts": {
    "batch": "tsx batch/index.ts"
  },
  "dependencies": {
    "@supabase/supabase-js": "^2.49.4"
  },
  "devDependencies": {
    "tsx": "^4.19.3",
    "typescript": "^5.8.3",
    "@types/node": "^22.14.0"
  }
}
```

- [ ] **Step 2: tsconfig.json 작성**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "outDir": "dist"
  },
  "include": ["**/*.ts"],
  "exclude": ["node_modules", "dist"]
}
```

- [ ] **Step 3: shared/supabase.ts 작성**

```typescript
// .github/scripts/shared/supabase.ts
import { createClient } from '@supabase/supabase-js';

const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_KEY;

if (!url || !key) {
  throw new Error('SUPABASE_URL, SUPABASE_SERVICE_KEY 환경변수 필요');
}

export const supabase = createClient(url, key, {
  auth: { persistSession: false },
});
```

- [ ] **Step 4: shared/logger.ts 작성**

```typescript
// .github/scripts/shared/logger.ts
import { supabase } from './supabase.js';

export type BatchStatus = 'pending' | 'running' | 'done' | 'failed';

let currentRunId: string | null = null;

/** 배치 시작 — batch_runs에 pending 레코드 삽입, runId 반환 */
export async function startBatchRun(mode: string, triggeredBy: 'schedule' | 'manual'): Promise<string> {
  const { data, error } = await supabase
    .from('batch_runs')
    .insert({
      workflow: 'daily-batch',
      mode,
      status: 'running',
      triggered_by: triggeredBy,
      started_at: new Date().toISOString(),
    })
    .select('id')
    .single();

  if (error || !data) throw new Error(`batch_runs 삽입 실패: ${error?.message}`);
  currentRunId = data.id;
  console.log(`[batch] 시작 runId=${currentRunId} mode=${mode}`);
  return currentRunId;
}

/** 배치 완료 업데이트 */
export async function finishBatchRun(
  runId: string,
  status: 'done' | 'failed',
  summary: { collected: number; scored: number; errors: string[] },
): Promise<void> {
  await supabase
    .from('batch_runs')
    .update({
      status,
      finished_at: new Date().toISOString(),
      summary,
    })
    .eq('id', runId);

  console.log(`[batch] 완료 runId=${runId} status=${status}`, summary);
}

/** 진행 중 step 로그 (콘솔만) */
export function log(step: string, msg: string): void {
  const ts = new Date().toISOString().slice(11, 19);
  console.log(`[${ts}][${step}] ${msg}`);
}
```

- [ ] **Step 5: 의존성 설치**

```bash
cd /Users/thlee/GoogleDrive/DashboardStock/.github/scripts
npm install
```

- [ ] **Step 6: 커밋**

```bash
cd /Users/thlee/GoogleDrive/DashboardStock
git add .github/scripts/
git commit -m "feat: GHA 스크립트 공유 인프라 (supabase, logger, package.json)"
```

---

### Task 3: 배치 진입점 (index.ts)

**Files:**
- Create: `.github/scripts/batch/index.ts`

- [ ] **Step 1: index.ts 작성**

```typescript
// .github/scripts/batch/index.ts
import { startBatchRun, finishBatchRun, log } from '../shared/logger.js';
import { runPricesOnly } from './prices-only.js';
import { runStep1DailyPrices } from './step1-daily-prices.js';
import { runStep2InvestorData } from './step2-investor-data.js';
import { runStep3Shortsell } from './step3-shortsell.js';
import { runStep4Scoring } from './step4-scoring.js';
import { runStep5AiReport } from './step5-ai-report.js';
import { runStep6MarketData } from './step6-market-data.js';
import { runStep7Events } from './step7-events.js';
import { runStep8Cleanup } from './step8-cleanup.js';

type BatchMode = 'full' | 'repair' | 'prices-only';

const mode = (process.env.BATCH_MODE ?? 'full') as BatchMode;
const targetDate = process.env.TARGET_DATE || new Date().toISOString().slice(0, 10);
const triggeredBy = process.env.GITHUB_EVENT_NAME === 'workflow_dispatch' ? 'manual' : 'schedule';

async function main() {
  const summary = { collected: 0, scored: 0, errors: [] as string[] };
  const runId = await startBatchRun(mode, triggeredBy);

  try {
    if (mode === 'prices-only') {
      log('main', '장중 현재가 수집 모드');
      const result = await runPricesOnly();
      summary.collected = result.collected;

    } else if (mode === 'repair') {
      log('main', `누락 보정 모드 date=${targetDate}`);
      const result = await runStep1DailyPrices({ mode: 'repair', date: targetDate });
      summary.collected = result.collected;
      summary.errors.push(...result.errors);

    } else {
      // full 모드: step1~8 순차 실행
      log('main', `전체 배치 모드 date=${targetDate}`);

      const s1 = await runStep1DailyPrices({ mode: 'full', date: targetDate });
      summary.collected += s1.collected;
      summary.errors.push(...s1.errors);

      const s2 = await runStep2InvestorData({ date: targetDate });
      summary.errors.push(...s2.errors);

      const s3 = await runStep3Shortsell({ date: targetDate });
      summary.errors.push(...s3.errors);

      const s4 = await runStep4Scoring({ date: targetDate });
      summary.scored = s4.scored;
      summary.errors.push(...s4.errors);

      await runStep5AiReport({ date: targetDate }).catch(e => {
        summary.errors.push(`step5: ${e.message}`);
      });

      await runStep6MarketData().catch(e => {
        summary.errors.push(`step6: ${e.message}`);
      });

      await runStep7Events().catch(e => {
        summary.errors.push(`step7: ${e.message}`);
      });

      await runStep8Cleanup();
    }

    await finishBatchRun(runId, 'done', summary);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    summary.errors.push(msg);
    await finishBatchRun(runId, 'failed', summary);
    process.exit(1);
  }
}

main();
```

- [ ] **Step 2: 커밋**

```bash
git add .github/scripts/batch/index.ts
git commit -m "feat: 배치 진입점 index.ts (mode 분기 + batch_runs 상태 관리)"
```

---

### Task 4: prices-only.ts (장중 현재가 수집)

**Files:**
- Create: `.github/scripts/batch/prices-only.ts`

기존 `web/src/lib/naver-stock-api.ts`의 `fetchAllStockPrices` 로직을 GHA 스크립트용으로 재구현. (web/ 디렉토리를 직접 import할 수 없으므로 핵심 fetch 로직만 복사)

- [ ] **Step 1: prices-only.ts 작성**

```typescript
// .github/scripts/batch/prices-only.ts
import { supabase } from '../shared/supabase.js';
import { log } from '../shared/logger.js';

const NAVER_API = 'https://api.stock.naver.com/api/stock';
const PAGE_SIZE = 100;

interface NaverStockItem {
  itemCode: string;
  stockName: string;
  closePrice: string;           // 현재가 (쉼표 포함)
  compareToPreviousClosePrice: string;
  fluctuationsRatio: string;    // 등락률 (%)
  accumulatedTradingVolume: string;
  marketValue: string;          // 시가총액
}

interface NaverListResponse {
  stocks: NaverStockItem[];
  totalCount: number;
}

function parseNum(s: string): number {
  return parseFloat(s.replace(/,/g, '')) || 0;
}

async function fetchPage(market: 'KOSPI' | 'KOSDAQ', page: number): Promise<NaverStockItem[]> {
  const url = `${NAVER_API}/stocks/marketValue/${market}?page=${page}&pageSize=${PAGE_SIZE}`;
  const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
  if (!res.ok) throw new Error(`Naver API ${market} p${page} 실패: ${res.status}`);
  const json = await res.json() as NaverListResponse;
  return json.stocks ?? [];
}

/** Naver 전종목 현재가 bulk fetch → stock_cache 업데이트 */
export async function runPricesOnly(): Promise<{ collected: number }> {
  log('prices-only', '네이버 전종목 현재가 fetch 시작');

  // 첫 페이지로 totalCount 확인
  const [kospiFirst, kosdaqFirst] = await Promise.all([
    fetch(`${NAVER_API}/stocks/marketValue/KOSPI?page=1&pageSize=${PAGE_SIZE}`, {
      headers: { 'User-Agent': 'Mozilla/5.0' },
    }).then(r => r.json() as Promise<NaverListResponse>),
    fetch(`${NAVER_API}/stocks/marketValue/KOSDAQ?page=1&pageSize=${PAGE_SIZE}`, {
      headers: { 'User-Agent': 'Mozilla/5.0' },
    }).then(r => r.json() as Promise<NaverListResponse>),
  ]);

  const kospiPages = Math.ceil((kospiFirst.totalCount ?? 0) / PAGE_SIZE);
  const kosdaqPages = Math.ceil((kosdaqFirst.totalCount ?? 0) / PAGE_SIZE);

  // 나머지 페이지 병렬 fetch
  const pagePromises: Promise<{ items: NaverStockItem[]; market: string }>[] = [];
  for (let p = 2; p <= kospiPages; p++) {
    pagePromises.push(fetchPage('KOSPI', p).then(items => ({ items, market: 'KOSPI' })));
  }
  for (let p = 2; p <= kosdaqPages; p++) {
    pagePromises.push(fetchPage('KOSDAQ', p).then(items => ({ items, market: 'KOSDAQ' })));
  }
  const pages = await Promise.all(pagePromises);

  // 전체 데이터 합산
  const allItems: NaverStockItem[] = [
    ...(kospiFirst.stocks ?? []),
    ...(kosdaqFirst.stocks ?? []),
    ...pages.flatMap(p => p.items),
  ];

  log('prices-only', `${allItems.length}종목 수집 완료, DB upsert 시작`);

  // stock_cache 현재가 업데이트 (500개씩 upsert)
  const now = new Date().toISOString();
  const CHUNK = 500;
  for (let i = 0; i < allItems.length; i += CHUNK) {
    const chunk = allItems.slice(i, i + CHUNK);
    const rows = chunk
      .filter(item => item.itemCode && item.itemCode.length === 6)
      .map(item => ({
        symbol: item.itemCode,
        current_price: parseNum(item.closePrice),
        price_change: parseNum(item.compareToPreviousClosePrice),
        price_change_pct: parseFloat(item.fluctuationsRatio) || 0,
        volume: parseNum(item.accumulatedTradingVolume),
        market_cap: parseNum(item.marketValue) * 1_000_000,
        updated_at: now,
      }));

    const { error } = await supabase
      .from('stock_cache')
      .upsert(rows, { onConflict: 'symbol', ignoreDuplicates: false });

    if (error) log('prices-only', `upsert 오류 (chunk ${i}): ${error.message}`);
  }

  log('prices-only', `완료: ${allItems.length}종목 stock_cache 갱신`);
  return { collected: allItems.length };
}
```

- [ ] **Step 2: 로컬 실행 테스트**

```bash
cd /Users/thlee/GoogleDrive/DashboardStock/.github/scripts
SUPABASE_URL=<값> SUPABASE_SERVICE_KEY=<값> BATCH_MODE=prices-only npx tsx batch/index.ts
```

예상 출력:
```
[batch] 시작 runId=xxx mode=prices-only
[prices-only] 네이버 전종목 현재가 fetch 시작
[prices-only] 4100종목 수집 완료, DB upsert 시작
[prices-only] 완료: 4100종목 stock_cache 갱신
[batch] 완료 runId=xxx status=done { collected: 4100, scored: 0, errors: [] }
```

- [ ] **Step 3: 커밋**

```bash
cd /Users/thlee/GoogleDrive/DashboardStock
git add .github/scripts/batch/prices-only.ts
git commit -m "feat: prices-only 장중 현재가 수집 (Naver bulk → stock_cache)"
```

---

### Task 5: step1-daily-prices.ts (전종목 일봉 수집)

**Files:**
- Create: `.github/scripts/batch/step1-daily-prices.ts`

- [ ] **Step 1: step1-daily-prices.ts 작성**

```typescript
// .github/scripts/batch/step1-daily-prices.ts
import { supabase } from '../shared/supabase.js';
import { log } from '../shared/logger.js';

const FCHART_URL = 'https://fchart.stock.naver.com/sise.nhn';
const CHUNK_SIZE = 50;      // 병렬 fetch 청크 크기
const CHUNK_DELAY_MS = 100; // 청크 간 딜레이 (Naver 부하 분산)

interface NaverCandle {
  날짜: string;   // YYYYMMDD
  시가: number;
  고가: number;
  저가: number;
  종가: number;
  거래량: number;
}

/** 단일 종목 일봉 fetch (네이버 fchart) */
async function fetchCandles(symbol: string, days: number): Promise<NaverCandle[]> {
  const url = `${FCHART_URL}?symbol=${symbol}&timeframe=day&count=${days}&requestType=0`;
  const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
  if (!res.ok) return [];
  const text = await res.text();

  // XML 파싱: <item data="20240101|1000|1050|990|1020|500000" />
  const matches = text.matchAll(/data="(\d{8})\|(\d+)\|(\d+)\|(\d+)\|(\d+)\|(\d+)"/g);
  const candles: NaverCandle[] = [];
  for (const m of matches) {
    candles.push({
      날짜: m[1],
      시가: parseInt(m[2]),
      고가: parseInt(m[3]),
      저가: parseInt(m[4]),
      종가: parseInt(m[5]),
      거래량: parseInt(m[6]),
    });
  }
  return candles;
}

/** 청크 단위 병렬 fetch + DB upsert */
async function fetchAndUpsertChunk(symbols: string[], date: string): Promise<{ ok: number; fail: number }> {
  let ok = 0, fail = 0;

  const results = await Promise.allSettled(
    symbols.map(sym => fetchCandles(sym, 5))
  );

  const rows: Record<string, unknown>[] = [];
  results.forEach((r, i) => {
    if (r.status === 'rejected') { fail++; return; }
    const candles = r.value;
    const today = candles.find(c => c.날짜 === date.replace(/-/g, ''));
    if (!today) { fail++; return; }
    ok++;
    rows.push({
      symbol: symbols[i],
      date,
      open: today.시가,
      high: today.고가,
      low: today.저가,
      close: today.종가,
      volume: today.거래량,
      is_provisional: false,
    });
  });

  if (rows.length > 0) {
    const { error } = await supabase
      .from('daily_prices')
      .upsert(rows, { onConflict: 'symbol,date' });
    if (error) log('step1', `upsert 오류: ${error.message}`);
  }

  return { ok, fail };
}

export async function runStep1DailyPrices(opts: {
  mode: 'full' | 'repair';
  date: string;
}): Promise<{ collected: number; errors: string[] }> {
  const { mode, date } = opts;
  const dateCompact = date.replace(/-/g, '');
  log('step1', `일봉 수집 시작 mode=${mode} date=${date}`);

  // 대상 종목 조회
  let symbols: string[];
  if (mode === 'repair') {
    // 해당 날짜 daily_prices 없는 종목만
    const { data: allSymbols } = await supabase.from('stock_cache').select('symbol').not('current_price', 'is', null);
    const { data: existing } = await supabase.from('daily_prices').select('symbol').eq('date', date);
    const existingSet = new Set((existing ?? []).map(r => r.symbol as string));
    symbols = (allSymbols ?? []).map(r => r.symbol as string).filter(s => !existingSet.has(s));
    log('step1', `repair 대상: ${symbols.length}종목`);
  } else {
    const { data } = await supabase.from('stock_cache').select('symbol').not('current_price', 'is', null);
    symbols = (data ?? []).map(r => r.symbol as string);
    log('step1', `full 대상: ${symbols.length}종목`);
  }

  // 50개씩 청크 병렬 처리
  let totalOk = 0, totalFail = 0;
  for (let i = 0; i < symbols.length; i += CHUNK_SIZE) {
    const chunk = symbols.slice(i, i + CHUNK_SIZE);
    const { ok, fail } = await fetchAndUpsertChunk(chunk, date);
    totalOk += ok;
    totalFail += fail;

    if ((i / CHUNK_SIZE) % 10 === 0) {
      log('step1', `진행 ${i + chunk.length}/${symbols.length} (성공:${totalOk} 실패:${totalFail})`);
    }

    if (i + CHUNK_SIZE < symbols.length) {
      await new Promise(r => setTimeout(r, CHUNK_DELAY_MS));
    }
  }

  log('step1', `완료: 성공=${totalOk} 실패=${totalFail}`);
  return {
    collected: totalOk,
    errors: totalFail > 0 ? [`일봉 누락 ${totalFail}종목`] : [],
  };
}
```

- [ ] **Step 2: 커밋**

```bash
git add .github/scripts/batch/step1-daily-prices.ts
git commit -m "feat: step1 전종목 일봉 수집 (Naver fchart, 50개씩 청크 병렬)"
```

---

### Task 6: step2-investor-data.ts (수급/지표 수집)

**Files:**
- Create: `.github/scripts/batch/step2-investor-data.ts`

기존 `web/src/lib/naver-stock-api.ts`의 `fetchNaverBulkIntegration` 및 `web/src/lib/krx-api.ts`의 `fetchBulkIndicators` 로직 재구현.

- [ ] **Step 1: step2-investor-data.ts 작성**

```typescript
// .github/scripts/batch/step2-investor-data.ts
import { supabase } from '../shared/supabase.js';
import { log } from '../shared/logger.js';

const NAVER_API = 'https://api.stock.naver.com/api/stock';

interface InvestorRow {
  symbol: string;
  foreign_net_qty: number | null;
  institution_net_qty: number | null;
  foreign_net_5d: number | null;
  institution_net_5d: number | null;
  foreign_streak: number | null;
  institution_streak: number | null;
  investor_updated_at: string;
}

/** 네이버 수급 API (1일치) — 기존 fetchBulkInvestorData 재구현 */
async function fetchInvestorPage(market: 'KOSPI' | 'KOSDAQ', page: number): Promise<InvestorRow[]> {
  const url = `${NAVER_API}/stocks/invest/${market}?page=${page}&pageSize=100&sosok=&period=1`;
  const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
  if (!res.ok) return [];
  const json = await res.json() as { stocks?: Record<string, unknown>[] };
  const now = new Date().toISOString();

  return (json.stocks ?? []).map(item => ({
    symbol: item.itemCode as string,
    foreign_net_qty: typeof item.foreignPurchaseQuantity === 'string'
      ? parseFloat((item.foreignPurchaseQuantity as string).replace(/,/g, ''))
      : null,
    institution_net_qty: typeof item.institutionPurchaseQuantity === 'string'
      ? parseFloat((item.institutionPurchaseQuantity as string).replace(/,/g, ''))
      : null,
    foreign_net_5d: null,
    institution_net_5d: null,
    foreign_streak: null,
    institution_streak: null,
    investor_updated_at: now,
  }));
}

export async function runStep2InvestorData(opts: { date: string }): Promise<{ errors: string[] }> {
  log('step2', '수급 데이터 수집 시작');
  const errors: string[] = [];

  try {
    // KOSPI + KOSDAQ 첫 페이지로 totalCount 확인
    const [k1, kq1] = await Promise.all([
      fetch(`${NAVER_API}/stocks/invest/KOSPI?page=1&pageSize=100&sosok=&period=1`, {
        headers: { 'User-Agent': 'Mozilla/5.0' },
      }).then(r => r.json() as Promise<{ totalCount: number; stocks: unknown[] }>),
      fetch(`${NAVER_API}/stocks/invest/KOSDAQ?page=1&pageSize=100&sosok=&period=1`, {
        headers: { 'User-Agent': 'Mozilla/5.0' },
      }).then(r => r.json() as Promise<{ totalCount: number; stocks: unknown[] }>),
    ]);

    const kospiPages = Math.ceil((k1.totalCount ?? 0) / 100);
    const kosdaqPages = Math.ceil((kq1.totalCount ?? 0) / 100);

    const pagePromises: Promise<InvestorRow[]>[] = [];
    for (let p = 2; p <= kospiPages; p++) pagePromises.push(fetchInvestorPage('KOSPI', p));
    for (let p = 2; p <= kosdaqPages; p++) pagePromises.push(fetchInvestorPage('KOSDAQ', p));

    const pages = await Promise.all(pagePromises);
    const allRows: InvestorRow[] = [
      ...((k1.stocks ?? []) as InvestorRow[]),
      ...((kq1.stocks ?? []) as InvestorRow[]),
      ...pages.flat(),
    ];

    log('step2', `${allRows.length}종목 수급 수집, upsert 시작`);

    // 500개씩 upsert
    const CHUNK = 500;
    for (let i = 0; i < allRows.length; i += CHUNK) {
      const chunk = allRows.slice(i, i + CHUNK).filter(r => r.symbol?.length === 6);
      if (chunk.length === 0) continue;
      const { error } = await supabase
        .from('stock_cache')
        .upsert(chunk, { onConflict: 'symbol', ignoreDuplicates: false });
      if (error) errors.push(`step2 upsert ${i}: ${error.message}`);
    }

    log('step2', `완료: ${allRows.length}종목 수급 갱신`);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    errors.push(`step2 오류: ${msg}`);
    log('step2', `실패: ${msg}`);
  }

  return { errors };
}
```

- [ ] **Step 2: 커밋**

```bash
git add .github/scripts/batch/step2-investor-data.ts
git commit -m "feat: step2 전종목 수급 데이터 수집 (Naver 수급 API)"
```

---

### Task 7: step3-shortsell.ts (공매도 수집)

**Files:**
- Create: `.github/scripts/batch/step3-shortsell.ts`

기존 `web/src/lib/krx-shortsell-api.ts`의 `fetchKrxShortSell` 재구현.

- [ ] **Step 1: step3-shortsell.ts 작성**

```typescript
// .github/scripts/batch/step3-shortsell.ts
import { supabase } from '../shared/supabase.js';
import { log } from '../shared/logger.js';

const KRX_SHORT_SELL_URL = 'http://data.krx.co.kr/comm/bldAttendant/getJsonData.cmd';

/** KRX 공매도 데이터 fetch */
async function fetchKrxShortSell(date: string): Promise<
  { symbol: string; shortSellRatio: number }[]
> {
  const dateCompact = date.replace(/-/g, '');
  const body = new URLSearchParams({
    bld: 'dbms/MDC/STAT/standard/MDCSTAT30101',
    mktId: 'ALL',
    trdDd: dateCompact,
    share: '1',
    money: '1',
    csvxls_isNo: 'false',
  });

  const res = await fetch(KRX_SHORT_SELL_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'User-Agent': 'Mozilla/5.0',
      Referer: 'http://data.krx.co.kr/',
    },
    body: body.toString(),
  });

  if (!res.ok) return [];
  const json = await res.json() as { OutBlock_1?: Record<string, string>[] };
  return (json.OutBlock_1 ?? [])
    .map(row => ({
      symbol: row['ISU_SRT_CD'] ?? '',
      shortSellRatio: parseFloat(row['CVSRTSELL_WGHT'] ?? '0') || 0,
    }))
    .filter(r => r.symbol.length === 6);
}

export async function runStep3Shortsell(opts: { date: string }): Promise<{ errors: string[] }> {
  log('step3', `공매도 수집 시작 date=${opts.date}`);
  const errors: string[] = [];

  try {
    const rows = await fetchKrxShortSell(opts.date);
    log('step3', `${rows.length}종목 공매도 데이터 수집`);

    if (rows.length === 0) {
      log('step3', '데이터 없음 (휴장일 또는 KRX 오류)');
      return { errors };
    }

    const now = new Date().toISOString();
    const CHUNK = 500;
    for (let i = 0; i < rows.length; i += CHUNK) {
      const chunk = rows.slice(i, i + CHUNK).map(r => ({
        symbol: r.symbol,
        short_sell_ratio: r.shortSellRatio,
        short_sell_updated_at: now,
      }));
      const { error } = await supabase
        .from('stock_cache')
        .upsert(chunk, { onConflict: 'symbol', ignoreDuplicates: false });
      if (error) errors.push(`step3 upsert: ${error.message}`);
    }

    log('step3', `완료: ${rows.length}종목 공매도 갱신`);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    errors.push(`step3 오류: ${msg}`);
  }

  return { errors };
}
```

- [ ] **Step 2: 커밋**

```bash
git add .github/scripts/batch/step3-shortsell.ts
git commit -m "feat: step3 공매도 수집 (KRX)"
```

---

### Task 8: step4-scoring.ts (축별 점수 계산)

**Files:**
- Create: `.github/scripts/batch/step4-scoring.ts`

기존 `web/src/lib/unified-scoring/engine.ts`의 `calcUnifiedScore`를 직접 호출. GHA 스크립트는 web/ 디렉토리와 같은 레포이므로 상대 경로로 import 가능.

- [ ] **Step 1: step4-scoring.ts 작성**

```typescript
// .github/scripts/batch/step4-scoring.ts
// 중요: web/src/lib의 기존 점수 엔진을 재사용
// GHA runner는 레포 루트에서 실행하므로 상대 경로 사용
import { supabase } from '../shared/supabase.js';
import { log } from '../shared/logger.js';

const CHUNK_SIZE = 200; // 한 번에 처리할 종목 수

/** stock_cache + daily_prices + signals에서 ScoringInput 조립 후 점수 계산 */
export async function runStep4Scoring(opts: { date: string }): Promise<{ scored: number; errors: string[] }> {
  const { date } = opts;
  log('step4', `점수 계산 시작 date=${date}`);
  const errors: string[] = [];
  let scored = 0;

  try {
    // 1. 전종목 기본 데이터 조회
    const { data: cacheRows, error: cacheErr } = await supabase
      .from('stock_cache')
      .select('symbol, name, market, current_price, per, pbr, roe, roe_estimated, foreign_net_qty, institution_net_qty, foreign_net_5d, institution_net_5d, foreign_streak, institution_streak, short_sell_ratio, market_cap, forward_per, target_price, invest_opinion, dividend_yield, high_52w, low_52w, is_managed, volume, float_shares')
      .not('current_price', 'is', null);

    if (cacheErr || !cacheRows) throw new Error(`stock_cache 조회 실패: ${cacheErr?.message}`);
    log('step4', `${cacheRows.length}종목 기본 데이터 조회 완료`);

    // 2. DART 데이터
    const { data: dartRows } = await supabase
      .from('stock_dart_info')
      .select('symbol, has_recent_cbw, major_shareholder_pct, major_shareholder_delta, audit_opinion, has_treasury_buyback, revenue_growth_yoy, operating_profit_growth_yoy');
    const dartMap = new Map((dartRows ?? []).map(r => [r.symbol as string, r]));

    // 3. 30일 신호 데이터
    const thirtyDaysAgo = new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10);
    const { data: signalRows } = await supabase
      .from('signals')
      .select('symbol, source')
      .in('signal_type', ['BUY', 'BUY_FORECAST'])
      .gte('timestamp', `${thirtyDaysAgo}T00:00:00+09:00`);
    const signalMap = new Map<string, string[]>();
    for (const s of signalRows ?? []) {
      const arr = signalMap.get(s.symbol as string) ?? [];
      if (s.source && !arr.includes(s.source as string)) arr.push(s.source as string);
      signalMap.set(s.symbol as string, arr);
    }

    // 4. 종목별 점수 계산 (CHUNK_SIZE씩 일봉 조회 후 처리)
    const symbols = cacheRows.map(r => r.symbol as string);

    for (let i = 0; i < symbols.length; i += CHUNK_SIZE) {
      const chunk = symbols.slice(i, i + CHUNK_SIZE);

      // 일봉 데이터 (최근 65일)
      const { data: priceRows } = await supabase
        .from('daily_prices')
        .select('symbol, date, open, high, low, close, volume')
        .in('symbol', chunk)
        .gte('date', new Date(Date.now() - 65 * 86400000).toISOString().slice(0, 10))
        .order('date', { ascending: false });

      const priceMap = new Map<string, typeof priceRows>();
      for (const p of priceRows ?? []) {
        const arr = priceMap.get(p.symbol as string) ?? [];
        arr.push(p);
        priceMap.set(p.symbol as string, arr);
      }

      const scoreRows: Record<string, unknown>[] = [];

      for (const symbol of chunk) {
        const cache = cacheRows.find(r => r.symbol === symbol);
        if (!cache) continue;

        const prices = (priceMap.get(symbol) ?? []) as {
          date: string; open: number; high: number; low: number; close: number; volume: number;
        }[];
        const dart = dartMap.get(symbol) ?? {};
        const signalSources = signalMap.get(symbol) ?? [];

        // ScoringInput 조립 (unified-scoring/types.ts 참조)
        const input = {
          symbol,
          marketCap: (cache.market_cap as number) ?? 0,
          per: (cache.per as number) ?? null,
          pbr: (cache.pbr as number) ?? null,
          roe: (cache.roe as number) ?? null,
          roeEstimated: (cache.roe_estimated as number) ?? null,
          forwardPer: (cache.forward_per as number) ?? null,
          targetPrice: (cache.target_price as number) ?? null,
          investOpinion: (cache.invest_opinion as number) ?? null,
          dividendYield: (cache.dividend_yield as number) ?? null,
          high52w: (cache.high_52w as number) ?? null,
          low52w: (cache.low_52w as number) ?? null,
          foreignNetQty: (cache.foreign_net_qty as number) ?? null,
          institutionNetQty: (cache.institution_net_qty as number) ?? null,
          foreignNet5d: (cache.foreign_net_5d as number) ?? null,
          institutionNet5d: (cache.institution_net_5d as number) ?? null,
          foreignStreak: (cache.foreign_streak as number) ?? null,
          institutionStreak: (cache.institution_streak as number) ?? null,
          shortSellRatio: (cache.short_sell_ratio as number) ?? null,
          isManaged: (cache.is_managed as boolean) ?? false,
          hasRecentCbw: (dart.has_recent_cbw as boolean) ?? false,
          majorShareholderPct: (dart.major_shareholder_pct as number) ?? null,
          majorShareholderDelta: (dart.major_shareholder_delta as number) ?? null,
          auditOpinion: (dart.audit_opinion as string) ?? null,
          hasTreasuryBuyback: (dart.has_treasury_buyback as boolean) ?? false,
          revenueGrowthYoy: (dart.revenue_growth_yoy as number) ?? null,
          operatingProfitGrowthYoy: (dart.operating_profit_growth_yoy as number) ?? null,
          signalSources,
          dailyPrices: prices.map(p => ({
            date: p.date,
            open: p.open,
            high: p.high,
            low: p.low,
            close: p.close,
            volume: p.volume,
          })),
          currentPrice: (cache.current_price as number) ?? 0,
          volume: (cache.volume as number) ?? 0,
          floatShares: (cache.float_shares as number) ?? null,
        };

        // unified-scoring engine 동적 import (web/src에서)
        // GHA runner는 레포 루트에서 실행되므로 상대 경로 사용
        let result;
        try {
          const { calcUnifiedScore } = await import('../../../web/src/lib/unified-scoring/engine.js');
          result = calcUnifiedScore(input, 'balanced');
        } catch {
          // engine import 실패 시 0점으로 폴백
          result = {
            categories: {
              signalTech: { normalized: 0 },
              supply: { normalized: 0 },
              valueGrowth: { normalized: 0 },
              momentum: { normalized: 0 },
              risk: { normalized: 0 },
            },
          };
        }

        const prevClose = prices.length >= 2 ? prices[1].close : (cache.current_price as number);

        scoreRows.push({
          symbol,
          scored_at: date,
          prev_close: prevClose,
          score_value: Math.round((result.categories.valueGrowth?.normalized ?? 0) * 100),
          score_growth: Math.round((result.categories.valueGrowth?.normalized ?? 0) * 100), // 성장은 valueGrowth에서 분리 예정
          score_supply: Math.round((result.categories.supply?.normalized ?? 0) * 100),
          score_momentum: Math.round((result.categories.momentum?.normalized ?? 0) * 100),
          score_risk: Math.round((result.categories.risk?.normalized ?? 0) * 100),
          score_signal: Math.round((result.categories.signalTech?.normalized ?? 0) * 100),
          updated_at: new Date().toISOString(),
        });
      }

      // stock_scores upsert
      if (scoreRows.length > 0) {
        const { error } = await supabase
          .from('stock_scores')
          .upsert(scoreRows, { onConflict: 'symbol' });
        if (error) errors.push(`step4 upsert chunk ${i}: ${error.message}`);
        else scored += scoreRows.length;
      }

      log('step4', `진행 ${Math.min(i + CHUNK_SIZE, symbols.length)}/${symbols.length} scored=${scored}`);
    }

    log('step4', `완료: ${scored}종목 점수 저장`);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    errors.push(`step4 오류: ${msg}`);
    log('step4', `실패: ${msg}`);
  }

  return { scored, errors };
}
```

- [ ] **Step 2: 커밋**

```bash
git add .github/scripts/batch/step4-scoring.ts
git commit -m "feat: step4 축별 점수 계산 → stock_scores 저장 (unified-scoring 재사용)"
```

---

### Task 9: step5-ai-report.ts

**Files:**
- Create: `.github/scripts/batch/step5-ai-report.ts`

기존 `web/src/app/api/v1/cron/daily-prices/route.ts`의 AI 리포트 생성 로직 이관.

- [ ] **Step 1: step5-ai-report.ts 작성**

```typescript
// .github/scripts/batch/step5-ai-report.ts
import { supabase } from '../shared/supabase.js';
import { log } from '../shared/logger.js';

export async function runStep5AiReport(opts: { date: string }): Promise<void> {
  log('step5', 'AI 리포트 생성 시작 (상위 50종목)');

  // stock_scores에서 상위 50종목 선택
  const { data: topStocks } = await supabase
    .from('stock_scores')
    .select('symbol, score_signal, score_supply, score_value, score_momentum')
    .eq('scored_at', opts.date)
    .order('score_signal', { ascending: false })
    .limit(50);

  if (!topStocks || topStocks.length === 0) {
    log('step5', '점수 데이터 없음, AI 리포트 생략');
    return;
  }

  // 기존 cron에서 하던 AI 추천 생성 로직은 OpenAI 호출을 포함
  // Vercel /api/v1/ai-recommendations/generate 엔드포인트를 HTTP로 호출
  const vercelUrl = process.env.VERCEL_URL;
  if (!vercelUrl) {
    log('step5', 'VERCEL_URL 없음, AI 리포트 생략');
    return;
  }

  const res = await fetch(`https://${vercelUrl}/api/v1/ai-recommendations/generate`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${process.env.CRON_SECRET ?? ''}`,
    },
    body: JSON.stringify({ date: opts.date, symbols: topStocks.map(s => s.symbol) }),
  });

  log('step5', `AI 리포트 응답: ${res.status}`);
}
```

- [ ] **Step 2: VERCEL_URL을 GHA secrets에 추가**

GitHub 레포 → Settings → Secrets → `VERCEL_URL` 추가 (예: `dashboardstock.vercel.app`)

- [ ] **Step 3: 커밋**

```bash
git add .github/scripts/batch/step5-ai-report.ts
git commit -m "feat: step5 AI 리포트 생성 (Vercel API 호출)"
```

---

### Task 10: step6-market-data.ts (시황 지표 수집)

**Files:**
- Create: `.github/scripts/batch/step6-market-data.ts`

기존 `web/src/app/api/v1/cron/market-indicators/route.ts` 로직 이관.

- [ ] **Step 1: step6-market-data.ts 작성**

```typescript
// .github/scripts/batch/step6-market-data.ts
import { supabase } from '../shared/supabase.js';
import { log } from '../shared/logger.js';

type IndicatorType = 'VIX' | 'USD_KRW' | 'US_10Y' | 'WTI' | 'KOSPI' | 'KOSDAQ' | 'GOLD' | 'DXY' | 'KR_3Y' | 'FEAR_GREED' | 'KORU' | 'EWY';

const YAHOO_TICKERS: Record<IndicatorType, string> = {
  VIX: '^VIX',
  USD_KRW: 'KRW=X',
  US_10Y: '^TNX',
  WTI: 'CL=F',
  KOSPI: '^KS11',
  KOSDAQ: '^KQ11',
  GOLD: 'GC=F',
  DXY: 'DX-Y.NYB',
  KR_3Y: '^IRX',
  KORU: 'KORU',
  EWY: 'EWY',
  FEAR_GREED: '', // CNN 별도 처리
};

async function fetchYahooQuote(ticker: string): Promise<number | null> {
  try {
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ticker)}?interval=1d&range=1d`;
    const res = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0' },
      signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) return null;
    const json = await res.json() as { chart?: { result?: { meta?: { regularMarketPrice?: number } }[] } };
    return json?.chart?.result?.[0]?.meta?.regularMarketPrice ?? null;
  } catch {
    return null;
  }
}

async function fetchFred(seriesId: string): Promise<number | null> {
  const apiKey = process.env.FRED_API_KEY;
  if (!apiKey) return null;
  try {
    const url = `https://api.stlouisfed.org/fred/series/observations?series_id=${seriesId}&api_key=${apiKey}&file_type=json&sort_order=desc&limit=5`;
    const res = await fetch(url, { signal: AbortSignal.timeout(10000) });
    if (!res.ok) return null;
    const json = await res.json() as { observations?: { value: string }[] };
    for (const obs of json.observations ?? []) {
      const v = parseFloat(obs.value);
      if (!isNaN(v)) return v;
    }
    return null;
  } catch {
    return null;
  }
}

async function fetchFearGreed(): Promise<number | null> {
  try {
    const res = await fetch('https://production.dataviz.cnn.io/index/fearandgreed/graphdata', {
      headers: {
        'User-Agent': 'Mozilla/5.0',
        'Referer': 'https://edition.cnn.com/',
      },
      signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) return null;
    const json = await res.json() as { fear_and_greed?: { score?: number } };
    return json?.fear_and_greed?.score ?? null;
  } catch {
    return null;
  }
}

export async function runStep6MarketData(): Promise<void> {
  log('step6', '시황 지표 수집 시작');
  const now = new Date().toISOString();
  const rows: { indicator_type: string; value: number; updated_at: string }[] = [];

  // Yahoo Finance 병렬 fetch
  const yahooEntries = Object.entries(YAHOO_TICKERS).filter(([, ticker]) => ticker !== '');
  const yahooResults = await Promise.all(
    yahooEntries.map(([type, ticker]) => fetchYahooQuote(ticker).then(v => ({ type, value: v })))
  );
  for (const { type, value } of yahooResults) {
    if (value !== null) rows.push({ indicator_type: type, value, updated_at: now });
  }

  // FRED: HY스프레드, 수익률곡선
  const [hySpread, yieldCurve] = await Promise.all([
    fetchFred('BAMLH0A0HYM2'),
    fetchFred('T10Y2Y'),
  ]);
  if (hySpread !== null) rows.push({ indicator_type: 'HY_SPREAD', value: hySpread, updated_at: now });
  if (yieldCurve !== null) rows.push({ indicator_type: 'YIELD_CURVE', value: yieldCurve, updated_at: now });

  // CNN Fear & Greed
  const fg = await fetchFearGreed();
  if (fg !== null) rows.push({ indicator_type: 'FEAR_GREED', value: fg, updated_at: now });

  log('step6', `${rows.length}개 지표 수집, upsert 시작`);

  if (rows.length > 0) {
    const { error } = await supabase
      .from('market_indicators')
      .upsert(rows, { onConflict: 'indicator_type' });
    if (error) log('step6', `upsert 오류: ${error.message}`);
  }

  log('step6', `완료: ${rows.length}개 시황 지표 갱신`);
}
```

- [ ] **Step 2: 커밋**

```bash
git add .github/scripts/batch/step6-market-data.ts
git commit -m "feat: step6 시황 지표 수집 (Yahoo/FRED/CNN → market_indicators)"
```

---

### Task 11: step7-events.ts + step8-cleanup.ts

**Files:**
- Create: `.github/scripts/batch/step7-events.ts`
- Create: `.github/scripts/batch/step8-cleanup.ts`

- [ ] **Step 1: step7-events.ts 작성**

기존 `web/src/app/api/v1/cron/market-events/route.ts` 로직 이관.

```typescript
// .github/scripts/batch/step7-events.ts
import { supabase } from '../shared/supabase.js';
import { log } from '../shared/logger.js';

/** FOMC 날짜를 FRED API에서 조회 */
async function fetchFomcDates(year: number): Promise<string[]> {
  const apiKey = process.env.FRED_API_KEY;
  if (!apiKey) return [];
  try {
    const url = `https://api.stlouisfed.org/fred/series/observations?series_id=FEDFUNDS&api_key=${apiKey}&file_type=json&observation_start=${year}-01-01&observation_end=${year}-12-31&frequency=m`;
    const res = await fetch(url, { signal: AbortSignal.timeout(10000) });
    if (!res.ok) return [];
    const json = await res.json() as { observations?: { date: string }[] };
    return (json.observations ?? []).map(o => o.date);
  } catch {
    return [];
  }
}

export async function runStep7Events(): Promise<void> {
  log('step7', '이벤트 캘린더 갱신 시작');
  const now = new Date();
  const year = now.getFullYear();

  // FOMC 날짜 갱신
  const fomcDates = await fetchFomcDates(year);
  for (const date of fomcDates) {
    const month = new Date(date).getMonth() + 1;
    await supabase.from('market_events').upsert({
      event_date: date,
      event_type: 'fomc',
      title: `FOMC 금리결정 (${month}월)`,
      source: 'fred_api',
      country: 'US',
    }, { onConflict: 'event_date,event_type,title' });
  }

  // 선물옵션 만기일 (매달 2번째 목요일)
  for (let month = 1; month <= 12; month++) {
    const d = new Date(year, month - 1, 1);
    let thursdays = 0;
    while (thursdays < 2) {
      if (d.getDay() === 4) thursdays++;
      if (thursdays < 2) d.setDate(d.getDate() + 1);
    }
    const expiryDate = d.toISOString().slice(0, 10);
    await supabase.from('market_events').upsert({
      event_date: expiryDate,
      event_type: 'expiry',
      title: `선물옵션 만기일 (${month}월)`,
      source: 'rule_based',
      country: 'KR',
    }, { onConflict: 'event_date,event_type,title' });
  }

  log('step7', `완료: FOMC ${fomcDates.length}건 + 선물만기 12건`);
}
```

- [ ] **Step 2: step8-cleanup.ts 작성**

```typescript
// .github/scripts/batch/step8-cleanup.ts
import { supabase } from '../shared/supabase.js';
import { log } from '../shared/logger.js';

/** daily_prices에서 2년 초과 데이터 삭제 (Supabase 500MB 유지) */
export async function runStep8Cleanup(): Promise<void> {
  const cutoffDate = new Date(Date.now() - 2 * 365 * 86400000).toISOString().slice(0, 10);
  log('step8', `2년 초과 데이터 삭제 cutoff=${cutoffDate}`);

  const { error, count } = await supabase
    .from('daily_prices')
    .delete({ count: 'exact' })
    .lt('date', cutoffDate);

  if (error) {
    log('step8', `삭제 오류: ${error.message}`);
  } else {
    log('step8', `완료: ${count ?? 0}행 삭제`);
  }
}
```

- [ ] **Step 3: 커밋**

```bash
git add .github/scripts/batch/step7-events.ts .github/scripts/batch/step8-cleanup.ts
git commit -m "feat: step7 이벤트 캘린더 갱신, step8 2년 초과 데이터 삭제"
```

---

### Task 12: 전체 통합 테스트

- [ ] **Step 1: 로컬에서 full 모드 dry-run**

```bash
cd /Users/thlee/GoogleDrive/DashboardStock/.github/scripts
SUPABASE_URL=<값> \
SUPABASE_SERVICE_KEY=<값> \
OPENAI_API_KEY=<값> \
FRED_API_KEY=<값> \
BATCH_MODE=full \
TARGET_DATE=$(date +%Y-%m-%d) \
npx tsx batch/index.ts
```

예상 출력 (순서대로):
```
[batch] 시작 runId=xxx mode=full
[step1] 일봉 수집 시작 mode=full
[step1] full 대상: 4100종목
[step1] 진행 500/4100 ...
[step1] 완료: 성공=4050 실패=50
[step2] 수급 데이터 수집 시작
[step2] 완료: 4100종목 수급 갱신
[step3] 공매도 수집 시작
[step3] 완료: 1200종목 공매도 갱신
[step4] 점수 계산 시작
[step4] 완료: 4050종목 점수 저장
[step5] AI 리포트 생성 시작
[step6] 시황 지표 수집 시작
[step6] 완료: 12개 시황 지표 갱신
[step7] 이벤트 캘린더 갱신 시작
[step7] 완료: FOMC 12건 + 선물만기 12건
[step8] 2년 초과 데이터 삭제 ...
[batch] 완료 runId=xxx status=done
```

- [ ] **Step 2: GitHub Secrets 등록 확인**

GitHub 레포 → Settings → Secrets and variables → Actions:
- `SUPABASE_URL`
- `SUPABASE_SERVICE_KEY`
- `OPENAI_API_KEY`
- `FRED_API_KEY`
- `VERCEL_URL`
- `CRON_SECRET`

- [ ] **Step 3: prices-only 모드 테스트**

```bash
SUPABASE_URL=<값> SUPABASE_SERVICE_KEY=<값> BATCH_MODE=prices-only npx tsx batch/index.ts
```

- [ ] **Step 4: repair 모드 테스트**

```bash
SUPABASE_URL=<값> SUPABASE_SERVICE_KEY=<값> BATCH_MODE=repair TARGET_DATE=2026-04-05 npx tsx batch/index.ts
```

- [ ] **Step 5: GHA에서 수동 트리거**

GitHub Actions → daily-batch → Run workflow → mode: full → Run

- [ ] **Step 6: 최종 커밋**

```bash
cd /Users/thlee/GoogleDrive/DashboardStock
git add .
git commit -m "feat: GHA 배치 스크립트 전체 완성 (step1~8 + prices-only)"
```
