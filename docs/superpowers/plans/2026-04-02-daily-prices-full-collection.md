# Daily Prices 전종목 수집 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 매일 장마감 후 네이버 fchart API로 전종목(~4,200개) 일봉을 daily_prices에 수집한다.

**Architecture:** `daily-prices` 엔드포인트를 `?mode=sync` / `?mode=backfill` 쿼리 파라미터로 모드 분기. Sync 모드(평일 16:30 KST)는 stock_cache 업데이트 + 전종목 일봉 수집을 한 번에 처리. Backfill 모드(매일 07:30 KST)는 history < 60일 종목 90일치 보정. KIS API 일봉 호출은 제거하고 네이버 fchart로 통일.

**Tech Stack:** Next.js App Router, Supabase, 네이버 fchart API (`fetchNaverDailyPrices`), Vercel Cron

---

## 파일 변경 목록

| 파일 | 변경 |
|------|------|
| `web/vercel.json` | 크론 3개 → 2개로 정리, mode 쿼리 파라미터 추가 |
| `web/src/app/api/v1/cron/daily-prices/route.ts` | 모드 감지 로직 변경 + Step 4 교체 (KIS → 네이버 전종목) |

---

### Task 1: vercel.json 크론 정리

**Files:**
- Modify: `web/vercel.json`

- [ ] **Step 1: vercel.json 수정**

기존 3개 크론을 제거하고 아래 2개로 교체:

```json
{
  "crons": [
    {
      "path": "/api/v1/cron/daily-prices?mode=sync",
      "schedule": "30 7 * * 1-5"
    },
    {
      "path": "/api/v1/cron/daily-prices?mode=backfill",
      "schedule": "30 22 * * *"
    }
  ]
}
```

- `30 7 * * 1-5` = UTC 07:30, 월~금 = KST 16:30 평일 (장마감 후)
- `30 22 * * *` = UTC 22:30, 매일 = KST 07:30 (백필)

- [ ] **Step 2: 커밋**

```bash
git add web/vercel.json
git commit -m "chore: 크론 2개로 정리 (sync/backfill 모드 분리)"
```

---

### Task 2: daily-prices route — 모드 감지 로직 변경

**Files:**
- Modify: `web/src/app/api/v1/cron/daily-prices/route.ts` (현재 48~52번째 줄 부근)

현재 코드 (요일 기반):
```typescript
const dayOfWeek = kst.getUTCDay();
if (dayOfWeek === 0 || dayOfWeek === 6) {
  return runRepairMode(request);
}
```

- [ ] **Step 1: 쿼리 파라미터 기반 모드 감지로 교체**

위 블록을 아래로 교체:

```typescript
const { searchParams } = new URL(request.url);
const mode = searchParams.get('mode') ?? (dayOfWeek === 0 || dayOfWeek === 6 ? 'backfill' : 'sync');

if (mode === 'backfill') {
  return runRepairMode(request);
}
```

- `?mode=sync` → 평일 장마감 후 전종목 수집
- `?mode=backfill` → 백필 (history 부족 종목)
- 쿼리 파라미터 없을 경우: 기존 요일 감지 폴백 (수동 호출 호환)

- [ ] **Step 2: 커밋**

```bash
git add web/src/app/api/v1/cron/daily-prices/route.ts
git commit -m "refactor: daily-prices 모드 감지를 쿼리 파라미터 기반으로 변경"
```

---

### Task 3: daily-prices route — Step 4 교체 (KIS → 네이버 전종목)

**Files:**
- Modify: `web/src/app/api/v1/cron/daily-prices/route.ts` (현재 166~198번째 줄 Step 4 블록)

현재 Step 4 (KIS API, dpSymbols만):
```typescript
// ═══ Step 4: KIS API 일봉 수집 ═══
let savedCount = 0;
const dpArr = [...dpSymbols];
for (let i = 0; i < dpArr.length; i += 5) {
  const chunk = dpArr.slice(i, i + 5);
  const results = await Promise.allSettled(
    chunk.map(async (symbol) => {
      const prices = await getDailyPrices(symbol, todayCompact, todayCompact);
      if (prices.length === 0) return 0;
      const todayPrice = prices.find((p) => p.date === today);
      if (!todayPrice) return 0;
      const rows = [{ symbol, date: todayPrice.date, open: todayPrice.open,
        high: todayPrice.high, low: todayPrice.low, close: todayPrice.close, volume: todayPrice.volume }];
      const { error } = await supabase.from('daily_prices').upsert(rows, { onConflict: 'symbol,date' });
      return error ? 0 : rows.length;
    })
  );
  for (const r of results) if (r.status === 'fulfilled') savedCount += r.value;
  if (i + 5 < dpArr.length) await delay(1000);
}
lap(`일봉 저장: ${savedCount}건`);
```

- [ ] **Step 1: Step 4 블록 전체 교체**

위 블록을 아래로 교체:

```typescript
// ═══ Step 4: 네이버 fchart 전종목 일봉 수집 ═══
// KIS API 대신 네이버 fchart를 사용해 전종목 당일 캔들을 수집한다.
// concurrency=50으로 병렬 처리 → ~4,200종목 약 60~90초 예상
const FULL_DP_CONCURRENCY = 50;
const FULL_DP_UPSERT_BATCH = 1000;

let savedCount = 0;
const dpArr = [...integrationMap.keys()]; // stock_cache 전종목 (네이버 bulk에서 확보)

for (let i = 0; i < dpArr.length; i += FULL_DP_CONCURRENCY) {
  const chunk = dpArr.slice(i, i + FULL_DP_CONCURRENCY);
  const results = await Promise.allSettled(
    chunk.map(async (symbol) => {
      const prices = await fetchNaverDailyPrices(symbol, 3); // 최근 3일 조회 (오늘 캔들 확보)
      const todayPrice = prices.find((p) => p.date === today);
      if (!todayPrice) return null;
      return {
        symbol,
        date: todayPrice.date,
        open: todayPrice.open,
        high: todayPrice.high,
        low: todayPrice.low,
        close: todayPrice.close,
        volume: todayPrice.volume,
      };
    })
  );

  const rows = results
    .filter((r): r is PromiseFulfilledResult<NonNullable<typeof r extends PromiseFulfilledResult<infer T> ? T : never>> =>
      r.status === 'fulfilled' && r.value !== null)
    .map((r) => (r as PromiseFulfilledResult<NonNullable<{
      symbol: string; date: string; open: number; high: number; low: number; close: number; volume: number;
    }>>).value);

  for (let k = 0; k < rows.length; k += FULL_DP_UPSERT_BATCH) {
    const batch = rows.slice(k, k + FULL_DP_UPSERT_BATCH);
    const { error } = await supabase
      .from('daily_prices')
      .upsert(batch, { onConflict: 'symbol,date' });
    if (!error) savedCount += batch.length;
    else console.error('[daily-sync] 일봉 upsert 오류:', error.message);
  }
}
lap(`전종목 일봉 저장: ${savedCount}/${dpArr.length}건`);
```

- [ ] **Step 2: `getDailyPrices` import 제거 확인**

`kis-api`에서 `getDailyPrices`와 `delay`를 가져오는 import가 더 이상 사용되지 않으면 제거:

파일 상단 import 확인:
```typescript
import { getDailyPrices, delay } from '@/lib/kis-api';
```

`getDailyPrices`, `delay`가 파일 내 다른 곳에서 사용되지 않으면 해당 import 제거.
`fetchNaverDailyPrices`는 이미 import되어 있으므로 추가 불필요.

- [ ] **Step 3: response body 수정**

`daily_prices` 응답 필드 업데이트 (line 329 부근):

```typescript
daily_prices: { symbols: dpArr.length, saved: savedCount },
```

- [ ] **Step 4: 빌드 확인**

```bash
cd web && npm run build 2>&1 | tail -20
```

Expected: 타입 에러 없이 빌드 성공

- [ ] **Step 5: 커밋**

```bash
git add web/src/app/api/v1/cron/daily-prices/route.ts
git commit -m "feat: daily-prices Step 4를 네이버 전종목 일봉 수집으로 교체 (KIS 제거)"
```

---

### Task 4: 수동 동작 검증

- [ ] **Step 1: sync 모드 로컬 테스트**

개발 서버 실행 후:
```bash
curl -H "Authorization: Bearer $CRON_SECRET" \
  "http://localhost:3000/api/v1/cron/daily-prices?mode=sync"
```

Expected 응답:
```json
{
  "success": true,
  "daily_prices": { "symbols": 4200, "saved": 3000 },
  "elapsed": "XXX초"
}
```

`saved`가 `symbols`에 근접하면 성공. (장 마감 전이면 오늘 캔들 없어 0일 수 있음)

- [ ] **Step 2: backfill 모드 로컬 테스트**

```bash
curl -H "Authorization: Bearer $CRON_SECRET" \
  "http://localhost:3000/api/v1/cron/daily-prices?mode=backfill"
```

Expected 응답:
```json
{
  "success": true,
  "mode": "repair",
  "inspected_symbols": 4200,
  "repaired_symbols": N,
  "elapsed": "XXX초"
}
```

- [ ] **Step 3: Supabase에서 데이터 확인**

Supabase SQL:
```sql
SELECT symbol, count(*) as days
FROM daily_prices
WHERE symbol IN ('012750', '097950') -- 현대해상, CJ제일제당 종목코드
GROUP BY symbol;
```

결과에 행이 있으면 성공.
