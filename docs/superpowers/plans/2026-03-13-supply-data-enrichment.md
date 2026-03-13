# Supply Data Enrichment Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 네이버 투자자 API(종목별 외국인/기관 순매수)와 KRX 공매도 비율을 AI 추천 수급 점수에 실제 연결하여 supply_score가 최대 20점을 활용하도록 한다.

**Architecture:** (1) Naver `/api/stock/{symbol}/investor` API로 generate 시점에 후보 종목 배치 조회 → supply_score에 반영. (2) KRX 공매도 비율은 daily-prices cron에서 전종목 1회 수집 → `stock_cache.short_sell_ratio`에 캐시 → supply_score에서 읽기. (3) DB migration으로 stock_cache와 ai_recommendations 테이블에 컬럼 추가.

**Tech Stack:** Next.js 15 App Router, TypeScript, Supabase (PostgreSQL), Naver Finance API (인증 불필요), KRX OpenAPI (POST)

---

## 점수 설계 변경

### supply_score (max 20점, 기존 max 6점)
| 지표 | 점수 | 데이터 소스 |
|------|------|-----------|
| 외국인 순매수 > 0 | +7 | Naver investor API (generate 시 실시간) |
| 기관 순매수 > 0 | +7 | Naver investor API (generate 시 실시간) |
| 섹터 거래대금 ≥ 2배 | +4 | stock_cache (기존, 점수만 6→4로 조정) |
| 공매도 비율 < 1% | +2 | KRX → stock_cache.short_sell_ratio |
| **합계** | **max 20** | |

### technical_score: 변경 없음 (max 30, 정규화 /30 유지)

---

## 파일 구조

```
supabase/migrations/
  031_supply_data.sql          # 신규: stock_cache 컬럼 추가, ai_recommendations 컬럼 추가

web/src/lib/
  naver-stock-api.ts           # 수정: fetchStockInvestorData() 추가
  krx-shortsell-api.ts         # 신규: fetchKrxShortSell() (전종목 공매도 비율 1회 조회)

web/src/lib/ai-recommendation/
  supply-score.ts              # 수정: foreignNet/institutionNet/shortSellRatio 파라미터 추가, 점수 재설계
  index.ts                     # 수정: Naver investor 배치 조회 추가, cacheData select 확장

web/src/types/
  ai-recommendation.ts         # 수정: low_short_sell boolean 필드 추가

web/src/app/api/v1/cron/
  daily-prices/route.ts        # 수정: KRX 공매도 수집 + stock_cache 업데이트 추가

web/src/components/signals/
  AiRecommendationSection.tsx  # 수정: 외국인/기관 순매수, 공매도 낮음 배지 추가
```

---

## Chunk 1: DB 마이그레이션 및 타입 업데이트

### Task 1: DB 마이그레이션

**Files:**
- Create: `supabase/migrations/031_supply_data.sql`

- [ ] **Step 1: 마이그레이션 파일 생성**

```sql
-- stock_cache에 수급 데이터 컬럼 추가
ALTER TABLE stock_cache
  ADD COLUMN IF NOT EXISTS short_sell_ratio NUMERIC(8,4),        -- 공매도 비율 (%)
  ADD COLUMN IF NOT EXISTS foreign_net_qty BIGINT,               -- 외국인 순매수 수량 (당일)
  ADD COLUMN IF NOT EXISTS institution_net_qty BIGINT,           -- 기관 순매수 수량 (당일)
  ADD COLUMN IF NOT EXISTS investor_updated_at TIMESTAMPTZ;      -- 수급 데이터 최종 업데이트

-- ai_recommendations에 공매도 낮음 컬럼 추가
ALTER TABLE ai_recommendations
  ADD COLUMN IF NOT EXISTS low_short_sell BOOLEAN DEFAULT false;
```

- [ ] **Step 2: Supabase 대시보드 또는 CLI로 마이그레이션 적용**

```bash
# 로컬 supabase CLI 사용 시:
# supabase db push
# 또는 Supabase 대시보드 SQL Editor에서 직접 실행
```

---

### Task 2: TypeScript 타입 업데이트

**Files:**
- Modify: `web/src/types/ai-recommendation.ts`

- [ ] **Step 1: `AiRecommendation` 인터페이스에 `low_short_sell` 추가**

수급 섹션 끝에 추가:
```typescript
  // 수급
  foreign_buying: boolean;
  institution_buying: boolean;
  volume_vs_sector: boolean;
  low_short_sell: boolean;   // ← 추가
```

- [ ] **Step 2: 변경 확인 (타입 오류 없는지 확인)**

```bash
cd web && npx tsc --noEmit 2>&1 | head -30
```

---

## Chunk 2: API 함수 추가

### Task 3: Naver 종목별 투자자 API 함수

Naver Finance의 `https://m.stock.naver.com/api/stock/{symbol}/investor` 엔드포인트는
당일 외국인/기관/개인 순매수 수량을 제공한다.

실제 응답 예시:
```json
{
  "investorList": [
    { "investorType": "개인", "tradingVolume": { "buy": "1,234", "sell": "5,678", "net": "-4,444" } },
    { "investorType": "기관", "tradingVolume": { "buy": "9,000", "sell": "3,000", "net": "6,000" } },
    { "investorType": "외국인", "tradingVolume": { "buy": "2,000", "sell": "500", "net": "1,500" } }
  ]
}
```

**Files:**
- Modify: `web/src/lib/naver-stock-api.ts`

- [ ] **Step 1: `fetchStockInvestorData` 함수 추가 (파일 끝에 append)**

```typescript
export interface StockInvestorData {
  foreign_net: number;       // 외국인 순매수 수량 (양수=순매수, 음수=순매도)
  institution_net: number;   // 기관 순매수 수량
  individual_net: number;    // 개인 순매수 수량
}

/**
 * 종목별 당일 투자자별 매매동향 (외국인/기관/개인 순매수)
 * https://m.stock.naver.com/api/stock/{symbol}/investor
 */
export async function fetchStockInvestorData(symbol: string): Promise<StockInvestorData | null> {
  try {
    const res = await fetch(`${NAVER_STOCK_API}/stock/${symbol}/investor`, {
      headers: { 'User-Agent': 'Mozilla/5.0' },
    });
    if (!res.ok) return null;

    const data = await res.json();
    const list = data.investorList as Array<{
      investorType: string;
      tradingVolume: { buy: string; sell: string; net: string };
    }> | undefined;
    if (!list || list.length === 0) return null;

    const parseNet = (str: string | undefined): number => {
      if (!str) return 0;
      return parseInt(str.replace(/,/g, ''), 10) || 0;
    };

    const find = (type: string) => list.find((i) => i.investorType === type);
    const foreign = find('외국인');
    const institution = find('기관');
    const individual = find('개인');

    return {
      foreign_net: parseNet(foreign?.tradingVolume?.net),
      institution_net: parseNet(institution?.tradingVolume?.net),
      individual_net: parseNet(individual?.tradingVolume?.net),
    };
  } catch {
    return null;
  }
}

/**
 * 여러 종목 투자자 데이터 배치 조회 (최대 concurrency 병렬)
 */
export async function fetchBulkInvestorData(
  symbols: string[],
  concurrency = 20
): Promise<Map<string, StockInvestorData>> {
  const result = new Map<string, StockInvestorData>();
  if (symbols.length === 0) return result;

  for (let i = 0; i < symbols.length; i += concurrency) {
    const batch = symbols.slice(i, i + concurrency);
    await Promise.allSettled(
      batch.map(async (symbol) => {
        const data = await fetchStockInvestorData(symbol);
        if (data) result.set(symbol, data);
      })
    );
  }

  return result;
}
```

---

### Task 4: KRX 공매도 API 함수

KRX는 `https://data.krx.co.kr/comm/bldAttendant/getJsonData.cmd` POST로
전종목 공매도 현황을 한 번에 반환한다.

**Files:**
- Create: `web/src/lib/krx-shortsell-api.ts`

- [ ] **Step 1: KRX 공매도 API 파일 생성**

```typescript
/**
 * KRX 공매도 종합현황 조회
 * POST https://data.krx.co.kr/comm/bldAttendant/getJsonData.cmd
 * bld: dbms/MDC/STAT/standard/MDCSTAT02401
 *
 * 응답: 전종목 당일 공매도거래량 / 총거래량 / 공매도비율
 */

export interface KrxShortSellItem {
  symbol: string;          // 종목코드 (6자리)
  short_sell_ratio: number; // 공매도 비율 (%)
}

function getTodayKrxFormat(): string {
  // KST 기준 오늘 날짜 YYYYMMDD
  const now = new Date();
  const kst = new Date(now.getTime() + 9 * 60 * 60 * 1000);
  return kst.toISOString().slice(0, 10).replace(/-/g, '');
}

/**
 * 전종목 공매도 비율 조회 (당일)
 * @returns Map<symbol, short_sell_ratio(%)>
 */
export async function fetchKrxShortSell(): Promise<Map<string, number>> {
  const result = new Map<string, number>();
  const today = getTodayKrxFormat();

  try {
    const body = new URLSearchParams({
      bld: 'dbms/MDC/STAT/standard/MDCSTAT02401',
      locale: 'ko_KR',
      trdDd: today,
      mktId: 'ALL',       // KOSPI + KOSDAQ
      share: '1',
      money: '1',
      csvxls_isNo: 'false',
    });

    const res = await fetch(
      'https://data.krx.co.kr/comm/bldAttendant/getJsonData.cmd',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
          'User-Agent': 'Mozilla/5.0',
          Referer: 'https://data.krx.co.kr/',
        },
        body: body.toString(),
      }
    );

    if (!res.ok) {
      console.error(`[KRX short-sell] HTTP ${res.status}`);
      return result;
    }

    const data = await res.json();
    const output = data.output as Array<Record<string, string>> | undefined;
    if (!output || output.length === 0) {
      console.warn('[KRX short-sell] No data returned');
      return result;
    }

    for (const row of output) {
      // ISU_SRT_CD: 단축코드(6자리), CVSRTSRT: 공매도비율
      const symbol = row['ISU_SRT_CD']?.trim();
      const ratioStr = row['CVSRTSRT']?.replace(/,/g, '');
      if (!symbol || symbol.length !== 6) continue;
      const ratio = parseFloat(ratioStr || '0') || 0;
      result.set(symbol, ratio);
    }

    console.log(`[KRX short-sell] Fetched ${result.size} symbols`);
  } catch (e) {
    console.error('[KRX short-sell] Error:', e);
  }

  return result;
}
```

---

## Chunk 3: 수급 점수 및 오케스트레이터 업데이트

### Task 5: supply-score.ts 점수 재설계

**Files:**
- Modify: `web/src/lib/ai-recommendation/supply-score.ts`

현재 max 6점 → max 20점으로 확장. 파라미터에 `foreignNet`, `institutionNet`, `shortSellRatio` 추가.

- [ ] **Step 1: supply-score.ts 전체 교체**

```typescript
// N+1 방지: 오케스트레이터에서 사전 집계 후 전달받는다. DB 쿼리 없음.

export interface SupplyScoreResult {
  score: number;             // 0~20
  foreign_buying: boolean;   // 외국인 순매수 > 0
  institution_buying: boolean; // 기관 순매수 > 0
  volume_vs_sector: boolean; // 섹터 거래대금 2배 이상
  low_short_sell: boolean;   // 공매도 비율 < 1%
}

export function calcSupplyScore(
  currentVolume: number | null,
  currentPrice: number | null,
  sectorAvgTurnover: number | null,  // 오케스트레이터 사전 집계
  foreignNet: number | null,         // 외국인 순매수 수량 (Naver investor)
  institutionNet: number | null,     // 기관 순매수 수량 (Naver investor)
  shortSellRatio: number | null,     // 공매도 비율 % (KRX → stock_cache)
): SupplyScoreResult {
  let score = 0;

  // 외국인 순매수 +7
  const foreignBuying = foreignNet !== null && foreignNet > 0;
  if (foreignBuying) score += 7;

  // 기관 순매수 +7
  const institutionBuying = institutionNet !== null && institutionNet > 0;
  if (institutionBuying) score += 7;

  // 섹터 거래대금 급증(2배) +4
  let volumeVsSector = false;
  if (currentVolume && currentPrice && sectorAvgTurnover &&
      currentVolume > 0 && currentPrice > 0 && sectorAvgTurnover > 0) {
    const myTurnover = currentVolume * currentPrice;
    if (myTurnover >= sectorAvgTurnover * 2) {
      volumeVsSector = true;
      score += 4;
    }
  }

  // 공매도 비율 낮음 (< 1%) +2
  const lowShortSell = shortSellRatio !== null && shortSellRatio >= 0 && shortSellRatio < 1;
  if (lowShortSell) score += 2;

  return {
    score: Math.min(score, 20),
    foreign_buying: foreignBuying,
    institution_buying: institutionBuying,
    volume_vs_sector: volumeVsSector,
    low_short_sell: lowShortSell,
  };
}
```

---

### Task 6: index.ts 오케스트레이터 업데이트

Naver investor 배치 조회를 사전 단계에 추가하고, stock_cache에서 `short_sell_ratio` 읽기.

**Files:**
- Modify: `web/src/lib/ai-recommendation/index.ts`

- [ ] **Step 1: import 추가 (파일 상단)**

기존 import 아래에:
```typescript
import { fetchBulkInvestorData } from '@/lib/naver-stock-api';
```

- [ ] **Step 2: cacheData select에 short_sell_ratio 추가**

기존:
```typescript
supabase
  .from('stock_cache')
  .select('symbol, per, pbr, roe, volume, current_price, high_52w, low_52w')
  .in('symbol', symbols),
```
변경:
```typescript
supabase
  .from('stock_cache')
  .select('symbol, per, pbr, roe, volume, current_price, high_52w, low_52w, short_sell_ratio')
  .in('symbol', symbols),
```

- [ ] **Step 3: 섹터 집계 이후, 종목별 점수 계산 이전에 investor 배치 조회 추가**

섹터 집계 코드(`sectorAvgMap` 완성) 바로 아래에:
```typescript
  // 종목별 투자자 데이터 배치 조회 (Naver investor API, 병렬)
  const investorMap = await fetchBulkInvestorData(symbols);
```

- [ ] **Step 4: calcSupplyScore 호출부 업데이트**

기존:
```typescript
      const supplyResult = calcSupplyScore(
        cache?.volume ?? null,
        cache?.current_price ?? null,
        sectorAvgTurnover
      );
```
변경:
```typescript
      const investor = investorMap.get(symbol) ?? null;
      const supplyResult = calcSupplyScore(
        cache?.volume ?? null,
        cache?.current_price ?? null,
        sectorAvgTurnover,
        investor?.foreign_net ?? null,
        investor?.institution_net ?? null,
        cache?.short_sell_ratio ?? null,
      );
```

- [ ] **Step 5: return 객체에 `low_short_sell` 추가**

기존 return 객체에서 `volume_vs_sector` 아래에:
```typescript
        volume_vs_sector: supplyResult.volume_vs_sector,
        low_short_sell: supplyResult.low_short_sell,   // ← 추가
```

- [ ] **Step 6: TypeScript 빌드 확인**

```bash
cd web && npx tsc --noEmit 2>&1 | head -30
```
Expected: 오류 없음

---

## Chunk 4: Cron 업데이트 및 UI

### Task 7: daily-prices cron에 KRX 공매도 수집 추가

장 마감(16:00 KST) 후 cron이 실행될 때 KRX 공매도 + Naver investor 데이터를
`stock_cache`에 캐시해 두면 다음 generate 시 빠르게 읽을 수 있다.

**Files:**
- Modify: `web/src/app/api/v1/cron/daily-prices/route.ts`

- [ ] **Step 1: import 추가**

파일 상단에:
```typescript
import { fetchKrxShortSell } from '@/lib/krx-shortsell-api';
import { fetchBulkInvestorData } from '@/lib/naver-stock-api';
```

- [ ] **Step 2: 기존 `=== 2. KIS API로 일봉 수집 ===` 섹션 이후, return 직전에 추가**

`return NextResponse.json(...)` 호출 전 `try` 블록 안에 추가:

```typescript
    // === 3. 공매도 비율 수집 (KRX) → stock_cache 업데이트 ===
    const shortSellMap = await fetchKrxShortSell();
    if (shortSellMap.size > 0) {
      // 신호 종목만 업데이트 (전종목 upsert는 불필요)
      const symbolsArr = [...symbols];
      const shortSellUpdates = symbolsArr
        .filter((sym) => shortSellMap.has(sym))
        .map((sym) => ({
          symbol: sym,
          short_sell_ratio: shortSellMap.get(sym)!,
        }));

      if (shortSellUpdates.length > 0) {
        await supabase
          .from('stock_cache')
          .upsert(shortSellUpdates, { onConflict: 'symbol' });
        console.log(`[daily-prices] Short-sell updated: ${shortSellUpdates.length} symbols`);
      }
    }

    // === 4. 투자자별 매매동향 수집 (Naver) → stock_cache 업데이트 ===
    const symbolsArr = [...symbols];
    if (symbolsArr.length > 0) {
      const investorMap = await fetchBulkInvestorData(symbolsArr);
      const investorUpdates = symbolsArr
        .filter((sym) => investorMap.has(sym))
        .map((sym) => {
          const d = investorMap.get(sym)!;
          return {
            symbol: sym,
            foreign_net_qty: d.foreign_net,
            institution_net_qty: d.institution_net,
            investor_updated_at: new Date().toISOString(),
          };
        });

      if (investorUpdates.length > 0) {
        await supabase
          .from('stock_cache')
          .upsert(investorUpdates, { onConflict: 'symbol' });
        console.log(`[daily-prices] Investor data updated: ${investorUpdates.length} symbols`);
      }
    }
```

- [ ] **Step 3: return 응답에 수집 결과 추가**

기존:
```typescript
    return NextResponse.json({
      success: true,
      date: today,
      symbols: symbols.size,
      prices_saved: savedCount,
      splits_executed: splitResult,
    });
```
변경:
```typescript
    return NextResponse.json({
      success: true,
      date: today,
      symbols: symbols.size,
      prices_saved: savedCount,
      splits_executed: splitResult,
      short_sell_updated: shortSellMap.size > 0,
      investor_updated: symbolsArr.length,
    });
```

---

### Task 8: UI 배지 업데이트

**Files:**
- Modify: `web/src/components/signals/AiRecommendationSection.tsx`

- [ ] **Step 1: `RecommendationCard` 내 배지 목록 업데이트**

기존 `{item.volume_vs_sector && ...}` 아래:
```tsx
        {item.volume_vs_sector && (
          <Badge label="✅ 섹터 거래대금 급증" variant="green" />
        )}
```
아래에 추가:
```tsx
        {item.foreign_buying && <Badge label="✅ 외국인 순매수" variant="green" />}
        {item.institution_buying && <Badge label="✅ 기관 순매수" variant="green" />}
        {item.low_short_sell && <Badge label="✅ 공매도 낮음" variant="green" />}
```

- [ ] **Step 2: 수급 미집계 조건 업데이트**

기존:
```tsx
        {!item.foreign_buying && !item.institution_buying && !item.volume_vs_sector && (
          <Badge label="수급 미집계" variant="gray" />
        )}
```
변경:
```tsx
        {!item.foreign_buying && !item.institution_buying && !item.volume_vs_sector && !item.low_short_sell && (
          <Badge label="수급 미집계" variant="gray" />
        )}
```

---

### Task 9: 커밋 및 푸시

- [ ] **Step 1: 빌드 최종 확인**

```bash
cd web && npx tsc --noEmit 2>&1
```
Expected: 오류 없음

- [ ] **Step 2: 변경 파일 스테이징 및 커밋**

```bash
git add supabase/migrations/031_supply_data.sql \
        web/src/types/ai-recommendation.ts \
        web/src/lib/naver-stock-api.ts \
        web/src/lib/krx-shortsell-api.ts \
        web/src/lib/ai-recommendation/supply-score.ts \
        web/src/lib/ai-recommendation/index.ts \
        web/src/app/api/v1/cron/daily-prices/route.ts \
        web/src/components/signals/AiRecommendationSection.tsx

git commit -m "feat: 수급 점수 실데이터 연결 (Naver 투자자 API + KRX 공매도)"
```

- [ ] **Step 3: main 푸시**

```bash
git push origin main
```

---

## 검증 포인트

1. `npx tsc --noEmit` — 타입 오류 없음
2. `/signals` 페이지에서 AI 추천 "새로고침" → supply_score가 6 초과 값으로 업데이트되면 성공
3. 외국인/기관 순매수 배지 또는 공매도 낮음 배지가 표시되면 성공
4. 기존 종목 미집계일 때만 "수급 미집계" 배지 표시
