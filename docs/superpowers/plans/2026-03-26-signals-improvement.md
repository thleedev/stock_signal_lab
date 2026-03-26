# AI신호 종목추천/단기추천 개선 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** AI신호 메뉴의 필터 UI 일관성, 스냅샷 기반 성능 최적화, 노이즈 제거 필터, 순위 트래킹, DART API 연동을 구현한다.

**Architecture:** `stock_ranking_snapshot` 테이블에 크론(30분)이 스코어링 결과를 저장하고, API는 스냅샷에서 읽어 즉시 응답한다. DART API와 네이버 크롤링으로 리스크 데이터를 수집하며, 필터바를 버튼 그룹 기반으로 리디자인한다.

**Tech Stack:** Next.js 16, React 19, Supabase (Postgres), Tailwind CSS v4, DART OpenAPI, Naver 크롤링

---

## 파일 구조

### 신규 생성
- `supabase/migrations/050_stock_ranking_snapshot.sql` — 스냅샷 + DART 테이블 + stock_cache 컬럼
- `web/src/lib/dart-api.ts` — DART OpenAPI 클라이언트
- `web/src/lib/naver-stock-extra.ts` — 관리종목/유통주식수 크롤링
- `web/src/lib/scoring/risk-score.ts` — 리스크 점수 계산
- `web/src/lib/scoring/supply-score-additions.ts` — 수급 점수 추가 항목
- `web/src/lib/scoring/valuation-score-additions.ts` — 밸류에이션 점수 추가 항목
- `web/src/app/api/v1/stock-ranking/status/route.ts` — 스냅샷 갱신 상태 API
- `web/src/app/api/v1/stock-ranking/snapshot/route.ts` — 과거 스냅샷 조회 API
- `web/src/components/signals/RecommendationFilterBar.tsx` — 종목추천/단기추천 전용 필터바
- `web/src/hooks/use-snapshot-status.ts` — 스냅샷 상태 폴링 훅

### 수정
- `web/src/app/api/v1/cron/intraday-prices/route.ts` — 스냅샷 생성 + DART 수집 통합
- `web/src/app/api/v1/stock-ranking/route.ts` — 스냅샷 읽기 분기 + refresh 모드
- `web/src/hooks/use-stock-ranking.ts` — 스냅샷 기반 응답 처리
- `web/src/components/signals/UnifiedAnalysisSection.tsx` — 새 필터바 + 리스크 점수 반영
- `web/src/components/signals/ShortTermRecommendationSection.tsx` — 새 필터바 + 리스크 확장

### 테스트
- `web/src/lib/scoring/risk-score.test.ts`
- `web/src/lib/scoring/supply-score-additions.test.ts`
- `web/src/lib/scoring/valuation-score-additions.test.ts`
- `web/src/lib/dart-api.test.ts`
- `web/src/lib/naver-stock-extra.test.ts`

---

## Task 1: DB 마이그레이션

**Files:**
- Create: `supabase/migrations/050_stock_ranking_snapshot.sql`

- [ ] **Step 1: 마이그레이션 파일 작성**

```sql
-- 050_stock_ranking_snapshot.sql

-- 1. 순위 스냅샷 테이블
create table stock_ranking_snapshot (
  id bigint generated always as identity primary key,
  snapshot_date date not null,
  snapshot_time timestamptz not null,
  model text not null,
  symbol text not null,
  name text,
  market text,
  current_price int,
  market_cap bigint,
  daily_trading_value bigint,
  avg_trading_value_20d bigint,
  turnover_rate numeric,
  is_managed boolean default false,
  has_recent_cbw boolean default false,
  major_shareholder_pct numeric,
  score_total numeric,
  score_signal numeric,
  score_trend numeric,
  score_valuation numeric,
  score_supply numeric,
  score_risk numeric,
  score_momentum numeric,
  score_catalyst numeric,
  grade text,
  characters text[],
  recommendation text,
  signal_date date,
  raw_data jsonb,
  unique(snapshot_date, model, symbol)
);

create index idx_snapshot_date_model on stock_ranking_snapshot(snapshot_date, model);
create index idx_snapshot_symbol on stock_ranking_snapshot(symbol);

-- 2. DART 정보 테이블
create table stock_dart_info (
  symbol text primary key,
  has_recent_cbw boolean default false,
  major_shareholder_pct numeric,
  major_shareholder_delta numeric,
  audit_opinion text,
  has_treasury_buyback boolean default false,
  revenue_growth_yoy numeric,
  operating_profit_growth_yoy numeric,
  updated_at timestamptz default now()
);

-- 3. stock_cache 컬럼 추가
alter table stock_cache
  add column if not exists float_shares bigint,
  add column if not exists is_managed boolean default false;

-- 4. 스냅샷 갱신 상태 추적 (단일 행)
create table snapshot_update_status (
  id int primary key default 1 check (id = 1),
  updating boolean default false,
  last_updated timestamptz,
  model text
);

insert into snapshot_update_status (id, updating) values (1, false);
```

- [ ] **Step 2: Supabase에 마이그레이션 적용**

Run: `cd web && npx supabase db push`
Expected: 마이그레이션 성공, 4개 테이블/컬럼 생성

- [ ] **Step 3: 커밋**

```bash
git add supabase/migrations/050_stock_ranking_snapshot.sql
git commit -m "feat: 스냅샷/DART/상태 테이블 마이그레이션 추가"
```

---

## Task 2: 리스크 점수 모듈

**Files:**
- Create: `web/src/lib/scoring/risk-score.ts`
- Test: `web/src/lib/scoring/risk-score.test.ts`

- [ ] **Step 1: 테스트 작성**

```typescript
// web/src/lib/scoring/risk-score.test.ts
import { describe, it, expect } from 'vitest'
import { calcRiskScore } from './risk-score'

describe('calcRiskScore', () => {
  it('관리종목이면 -100 반환', () => {
    const result = calcRiskScore({ is_managed: true })
    expect(result).toBe(-100)
  })

  it('감사의견 비적정이면 -80 반환', () => {
    const result = calcRiskScore({ audit_opinion: '한정' })
    expect(result).toBe(-80)
  })

  it('CB/BW 최근 발행이면 -30 반환 (standard)', () => {
    const result = calcRiskScore({ has_recent_cbw: true }, 'standard')
    expect(result).toBe(-30)
  })

  it('CB/BW 최근 발행이면 -20 반환 (short_term)', () => {
    const result = calcRiskScore({ has_recent_cbw: true }, 'short_term')
    expect(result).toBe(-20)
  })

  it('최대주주 지분율 15%이면 -20 반환 (standard)', () => {
    const result = calcRiskScore({ major_shareholder_pct: 15 }, 'standard')
    expect(result).toBe(-20)
  })

  it('최대주주 지분 감소이면 -10 반환', () => {
    const result = calcRiskScore({ major_shareholder_delta: -3 })
    expect(result).toBe(-10)
  })

  it('거래대금 20억이면 -25 반환 (standard)', () => {
    const result = calcRiskScore({ daily_trading_value: 2_000_000_000 }, 'standard')
    expect(result).toBe(-25)
  })

  it('20일 평균 거래대금 40억이면 -15 반환 (standard)', () => {
    const result = calcRiskScore({ avg_trading_value_20d: 4_000_000_000 }, 'standard')
    expect(result).toBe(-15)
  })

  it('회전율 12%이면 -10 반환', () => {
    const result = calcRiskScore({ turnover_rate: 12 })
    expect(result).toBe(-10)
  })

  it('복합 감점 누적', () => {
    const result = calcRiskScore({
      has_recent_cbw: true,
      major_shareholder_pct: 15,
      daily_trading_value: 2_000_000_000,
    }, 'standard')
    // -30 + -20 + -25 = -75
    expect(result).toBe(-75)
  })

  it('리스크 없으면 0 반환', () => {
    const result = calcRiskScore({
      major_shareholder_pct: 30,
      daily_trading_value: 50_000_000_000,
      avg_trading_value_20d: 40_000_000_000,
      turnover_rate: 3,
    })
    expect(result).toBe(0)
  })
})
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `cd web && npx vitest run src/lib/scoring/risk-score.test.ts`
Expected: FAIL — 모듈 없음

- [ ] **Step 3: 구현**

```typescript
// web/src/lib/scoring/risk-score.ts

interface RiskInput {
  is_managed?: boolean
  audit_opinion?: string | null
  has_recent_cbw?: boolean
  major_shareholder_pct?: number | null
  major_shareholder_delta?: number | null
  daily_trading_value?: number | null
  avg_trading_value_20d?: number | null
  turnover_rate?: number | null
}

type Model = 'standard' | 'short_term'

export function calcRiskScore(input: RiskInput, model: Model = 'standard'): number {
  let score = 0

  // 관리종목: 사실상 제외
  if (input.is_managed) return -100

  // 감사의견 비적정
  if (input.audit_opinion && input.audit_opinion !== '적정') {
    return -80
  }

  // CB/BW 최근 발행
  if (input.has_recent_cbw) {
    score += model === 'standard' ? -30 : -20
  }

  // 최대주주 지분율 < 20%
  if (input.major_shareholder_pct != null && input.major_shareholder_pct < 20) {
    score += model === 'standard' ? -20 : -15
  }

  // 최대주주 지분 감소
  if (input.major_shareholder_delta != null && input.major_shareholder_delta < 0) {
    score += -10
  }

  // 거래대금 < 30억
  if (input.daily_trading_value != null && input.daily_trading_value < 3_000_000_000) {
    score += model === 'standard' ? -25 : -15
  }

  // 20일 평균 거래대금 < 50억 (standard만)
  if (model === 'standard' && input.avg_trading_value_20d != null && input.avg_trading_value_20d < 5_000_000_000) {
    score += -15
  }

  // 회전율 > 10%
  if (input.turnover_rate != null && input.turnover_rate > 10) {
    score += -10
  }

  return score
}
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `cd web && npx vitest run src/lib/scoring/risk-score.test.ts`
Expected: PASS 전체

- [ ] **Step 5: 커밋**

```bash
git add web/src/lib/scoring/risk-score.ts web/src/lib/scoring/risk-score.test.ts
git commit -m "feat: 리스크 점수 계산 모듈 추가 (TDD)"
```

---

## Task 3: 수급 점수 추가 항목 모듈

**Files:**
- Create: `web/src/lib/scoring/supply-score-additions.ts`
- Test: `web/src/lib/scoring/supply-score-additions.test.ts`

- [ ] **Step 1: 테스트 작성**

```typescript
// web/src/lib/scoring/supply-score-additions.test.ts
import { describe, it, expect } from 'vitest'
import { calcSupplyAdditions } from './supply-score-additions'

describe('calcSupplyAdditions', () => {
  it('거래대금 300억 이상이면 +15', () => {
    expect(calcSupplyAdditions({ daily_trading_value: 35_000_000_000 })).toBe(15)
  })

  it('거래대금 100억~300억이면 +10', () => {
    expect(calcSupplyAdditions({ daily_trading_value: 15_000_000_000 })).toBe(10)
  })

  it('거래대금 100억 미만이면 0', () => {
    expect(calcSupplyAdditions({ daily_trading_value: 5_000_000_000 })).toBe(0)
  })

  it('거래대금 급증 2배 이상이면 +10', () => {
    expect(calcSupplyAdditions({
      daily_trading_value: 20_000_000_000,
      avg_trading_value_20d: 8_000_000_000,
    })).toBe(10 + 10) // 등급 10 + 급증 10
  })

  it('거래대금 급증 1.5배이면 +5', () => {
    expect(calcSupplyAdditions({
      daily_trading_value: 15_000_000_000,
      avg_trading_value_20d: 9_000_000_000,
    })).toBe(10 + 5) // 등급 10 + 급증 5
  })

  it('회전율 1~5%이면 +5', () => {
    expect(calcSupplyAdditions({ turnover_rate: 3 })).toBe(5)
  })

  it('회전율 5% 초과이면 0', () => {
    expect(calcSupplyAdditions({ turnover_rate: 7 })).toBe(0)
  })

  it('자사주 매입이면 +10', () => {
    expect(calcSupplyAdditions({ has_treasury_buyback: true })).toBe(10)
  })

  it('최대주주 지분 증가이면 +5', () => {
    expect(calcSupplyAdditions({ major_shareholder_delta: 2.5 })).toBe(5)
  })

  it('복합 점수 누적', () => {
    const result = calcSupplyAdditions({
      daily_trading_value: 35_000_000_000,
      avg_trading_value_20d: 15_000_000_000,
      turnover_rate: 3,
      has_treasury_buyback: true,
      major_shareholder_delta: 1,
    })
    // 등급 15 + 급증 10 + 회전율 5 + 자사주 10 + 지분증가 5 = 45
    expect(result).toBe(45)
  })
})
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `cd web && npx vitest run src/lib/scoring/supply-score-additions.test.ts`
Expected: FAIL

- [ ] **Step 3: 구현**

```typescript
// web/src/lib/scoring/supply-score-additions.ts

interface SupplyAdditionInput {
  daily_trading_value?: number | null
  avg_trading_value_20d?: number | null
  turnover_rate?: number | null
  has_treasury_buyback?: boolean
  major_shareholder_delta?: number | null
}

export function calcSupplyAdditions(input: SupplyAdditionInput): number {
  let score = 0

  const tv = input.daily_trading_value ?? 0
  const avgTv = input.avg_trading_value_20d ?? 0

  // 거래대금 등급 (100억 이상만 가산)
  if (tv >= 30_000_000_000) score += 15
  else if (tv >= 10_000_000_000) score += 10

  // 거래대금 급증 (오늘 / 20일 평균)
  if (avgTv > 0) {
    const ratio = tv / avgTv
    if (ratio >= 2) score += 10
    else if (ratio >= 1.5) score += 5
  }

  // 회전율
  const tr = input.turnover_rate ?? 0
  if (tr >= 1 && tr <= 5) score += 5

  // 자사주 매입
  if (input.has_treasury_buyback) score += 10

  // 최대주주 지분 증가
  if (input.major_shareholder_delta != null && input.major_shareholder_delta > 0) {
    score += 5
  }

  return score
}
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `cd web && npx vitest run src/lib/scoring/supply-score-additions.test.ts`
Expected: PASS

- [ ] **Step 5: 커밋**

```bash
git add web/src/lib/scoring/supply-score-additions.ts web/src/lib/scoring/supply-score-additions.test.ts
git commit -m "feat: 수급 점수 추가 항목 모듈 (거래대금/회전율/자사주/지분)"
```

---

## Task 4: 밸류에이션 점수 추가 항목 모듈

**Files:**
- Create: `web/src/lib/scoring/valuation-score-additions.ts`
- Test: `web/src/lib/scoring/valuation-score-additions.test.ts`

- [ ] **Step 1: 테스트 작성**

```typescript
// web/src/lib/scoring/valuation-score-additions.test.ts
import { describe, it, expect } from 'vitest'
import { calcValuationAdditions } from './valuation-score-additions'

describe('calcValuationAdditions', () => {
  it('매출 성장률 25%이면 +10', () => {
    expect(calcValuationAdditions({ revenue_growth_yoy: 25 })).toBe(10)
  })

  it('매출 성장률 10%이면 +5', () => {
    expect(calcValuationAdditions({ revenue_growth_yoy: 10 })).toBe(5)
  })

  it('매출 성장률 3%이면 0', () => {
    expect(calcValuationAdditions({ revenue_growth_yoy: 3 })).toBe(0)
  })

  it('매출 역성장이면 -5', () => {
    expect(calcValuationAdditions({ revenue_growth_yoy: -10 })).toBe(-5)
  })

  it('영업이익 성장률 30%이면 +10', () => {
    expect(calcValuationAdditions({ operating_profit_growth_yoy: 30 })).toBe(10)
  })

  it('복합 가산', () => {
    const result = calcValuationAdditions({
      revenue_growth_yoy: 25,
      operating_profit_growth_yoy: 25,
    })
    expect(result).toBe(20) // 10 + 10
  })

  it('null이면 0', () => {
    expect(calcValuationAdditions({})).toBe(0)
  })
})
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `cd web && npx vitest run src/lib/scoring/valuation-score-additions.test.ts`
Expected: FAIL

- [ ] **Step 3: 구현**

```typescript
// web/src/lib/scoring/valuation-score-additions.ts

interface ValuationAdditionInput {
  revenue_growth_yoy?: number | null
  operating_profit_growth_yoy?: number | null
}

function growthScore(pct: number | null | undefined): number {
  if (pct == null) return 0
  if (pct >= 20) return 10
  if (pct >= 5) return 5
  if (pct >= 0) return 0
  return -5
}

export function calcValuationAdditions(input: ValuationAdditionInput): number {
  return growthScore(input.revenue_growth_yoy) + growthScore(input.operating_profit_growth_yoy)
}
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `cd web && npx vitest run src/lib/scoring/valuation-score-additions.test.ts`
Expected: PASS

- [ ] **Step 5: 커밋**

```bash
git add web/src/lib/scoring/valuation-score-additions.ts web/src/lib/scoring/valuation-score-additions.test.ts
git commit -m "feat: 밸류에이션 점수 추가 항목 모듈 (매출/영업이익 성장률)"
```

---

## Task 5: 네이버 크롤링 확장 (관리종목/유통주식수)

**Files:**
- Create: `web/src/lib/naver-stock-extra.ts`
- Test: `web/src/lib/naver-stock-extra.test.ts`

- [ ] **Step 1: 테스트 작성**

```typescript
// web/src/lib/naver-stock-extra.test.ts
import { describe, it, expect } from 'vitest'
import { parseStockExtra } from './naver-stock-extra'

describe('parseStockExtra', () => {
  it('HTML에서 유통주식수를 파싱한다', () => {
    const html = `
      <table class="tb_type1">
        <tr><th>유통주식수</th><td>12,345,678</td></tr>
      </table>
    `
    const result = parseStockExtra(html)
    expect(result.floatShares).toBe(12345678)
  })

  it('관리종목 마크를 감지한다', () => {
    const html = `<span class="spt_con4">관리종목</span>`
    const result = parseStockExtra(html)
    expect(result.isManaged).toBe(true)
  })

  it('관리종목이 아닌 경우 false', () => {
    const html = `<div>일반 종목</div>`
    const result = parseStockExtra(html)
    expect(result.isManaged).toBe(false)
  })

  it('유통주식수가 없으면 null', () => {
    const html = `<div>데이터 없음</div>`
    const result = parseStockExtra(html)
    expect(result.floatShares).toBeNull()
  })
})
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `cd web && npx vitest run src/lib/naver-stock-extra.test.ts`
Expected: FAIL

- [ ] **Step 3: 구현**

```typescript
// web/src/lib/naver-stock-extra.ts

export interface StockExtraInfo {
  floatShares: number | null
  isManaged: boolean
}

export function parseStockExtra(html: string): StockExtraInfo {
  let floatShares: number | null = null
  let isManaged = false

  // 유통주식수 파싱
  const floatMatch = html.match(/유통주식수<\/th>\s*<td[^>]*>([\d,]+)/)
  if (floatMatch) {
    floatShares = parseInt(floatMatch[1].replace(/,/g, ''), 10)
  }

  // 관리종목 감지
  if (html.includes('관리종목')) {
    isManaged = true
  }

  return { floatShares, isManaged }
}

export async function fetchStockExtra(symbol: string): Promise<StockExtraInfo> {
  const url = `https://finance.naver.com/item/main.naver?code=${symbol}`
  const res = await fetch(url, {
    headers: { 'User-Agent': 'Mozilla/5.0' },
    signal: AbortSignal.timeout(4000),
  })
  if (!res.ok) return { floatShares: null, isManaged: false }
  const html = await res.text()
  return parseStockExtra(html)
}

export async function fetchBatchStockExtra(
  symbols: string[],
  concurrency = 10,
): Promise<Map<string, StockExtraInfo>> {
  const results = new Map<string, StockExtraInfo>()
  for (let i = 0; i < symbols.length; i += concurrency) {
    const batch = symbols.slice(i, i + concurrency)
    const settled = await Promise.allSettled(
      batch.map(async (sym) => ({ sym, info: await fetchStockExtra(sym) })),
    )
    for (const r of settled) {
      if (r.status === 'fulfilled') {
        results.set(r.value.sym, r.value.info)
      }
    }
  }
  return results
}
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `cd web && npx vitest run src/lib/naver-stock-extra.test.ts`
Expected: PASS

- [ ] **Step 5: 커밋**

```bash
git add web/src/lib/naver-stock-extra.ts web/src/lib/naver-stock-extra.test.ts
git commit -m "feat: 네이버 관리종목/유통주식수 크롤링 모듈"
```

---

## Task 6: DART API 클라이언트

**Files:**
- Create: `web/src/lib/dart-api.ts`
- Test: `web/src/lib/dart-api.test.ts`

- [ ] **Step 1: 테스트 작성**

```typescript
// web/src/lib/dart-api.test.ts
import { describe, it, expect } from 'vitest'
import {
  parseCbBwFromDisclosures,
  parseMajorShareholderFromReport,
  parseAuditOpinion,
  parseTreasuryBuyback,
  parseFinancialGrowth,
} from './dart-api'

describe('parseCbBwFromDisclosures', () => {
  it('CB 관련 공시가 있으면 true', () => {
    const disclosures = [
      { report_nm: '전환사채권 발행결정', rcept_dt: '20260101' },
    ]
    expect(parseCbBwFromDisclosures(disclosures)).toBe(true)
  })

  it('BW 관련 공시가 있으면 true', () => {
    const disclosures = [
      { report_nm: '신주인수권부사채 발행결정', rcept_dt: '20260101' },
    ]
    expect(parseCbBwFromDisclosures(disclosures)).toBe(true)
  })

  it('관련 없는 공시만 있으면 false', () => {
    const disclosures = [
      { report_nm: '주주총회 소집결의', rcept_dt: '20260101' },
    ]
    expect(parseCbBwFromDisclosures(disclosures)).toBe(false)
  })
})

describe('parseMajorShareholderFromReport', () => {
  it('지분율과 변동을 파싱한다', () => {
    const data = { trmend_posesn_stock_qota_rt: '25.30', bsis_posesn_stock_qota_rt: '23.10' }
    const result = parseMajorShareholderFromReport(data)
    expect(result.pct).toBeCloseTo(25.3)
    expect(result.delta).toBeCloseTo(2.2)
  })
})

describe('parseAuditOpinion', () => {
  it('적정 의견을 파싱한다', () => {
    expect(parseAuditOpinion({ audit_opinion: '적정' })).toBe('적정')
  })

  it('한정 의견을 파싱한다', () => {
    expect(parseAuditOpinion({ audit_opinion: '한정' })).toBe('한정')
  })
})

describe('parseTreasuryBuyback', () => {
  it('자사주 매입 공시가 있으면 true', () => {
    const disclosures = [
      { report_nm: '자기주식 취득결정', rcept_dt: '20260301' },
    ]
    expect(parseTreasuryBuyback(disclosures)).toBe(true)
  })

  it('없으면 false', () => {
    expect(parseTreasuryBuyback([])).toBe(false)
  })
})

describe('parseFinancialGrowth', () => {
  it('매출/영업이익 성장률을 계산한다', () => {
    const current = { revenue: 1000, operating_profit: 200 }
    const previous = { revenue: 800, operating_profit: 150 }
    const result = parseFinancialGrowth(current, previous)
    expect(result.revenueGrowth).toBeCloseTo(25)
    expect(result.operatingProfitGrowth).toBeCloseTo(33.33, 1)
  })

  it('이전 데이터 없으면 null', () => {
    const result = parseFinancialGrowth({ revenue: 1000, operating_profit: 200 }, null)
    expect(result.revenueGrowth).toBeNull()
    expect(result.operatingProfitGrowth).toBeNull()
  })
})
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `cd web && npx vitest run src/lib/dart-api.test.ts`
Expected: FAIL

- [ ] **Step 3: 구현**

```typescript
// web/src/lib/dart-api.ts

const DART_BASE = 'https://opendart.fss.or.kr/api'

function dartKey(): string {
  const key = process.env.DART_API_KEY
  if (!key) throw new Error('DART_API_KEY 환경변수가 설정되지 않았습니다')
  return key
}

// --- 파서 (순수 함수, 테스트 가능) ---

interface Disclosure {
  report_nm: string
  rcept_dt: string
}

export function parseCbBwFromDisclosures(disclosures: Disclosure[]): boolean {
  const keywords = ['전환사채', '신주인수권부사채', 'CB', 'BW']
  return disclosures.some((d) =>
    keywords.some((kw) => d.report_nm.includes(kw)),
  )
}

export function parseMajorShareholderFromReport(data: {
  trmend_posesn_stock_qota_rt: string
  bsis_posesn_stock_qota_rt: string
}): { pct: number; delta: number } {
  const pct = parseFloat(data.trmend_posesn_stock_qota_rt)
  const prev = parseFloat(data.bsis_posesn_stock_qota_rt)
  return { pct, delta: pct - prev }
}

export function parseAuditOpinion(data: { audit_opinion: string }): string {
  return data.audit_opinion
}

export function parseTreasuryBuyback(disclosures: Disclosure[]): boolean {
  const keywords = ['자기주식 취득', '자사주 취득', '자기주식취득']
  return disclosures.some((d) =>
    keywords.some((kw) => d.report_nm.includes(kw)),
  )
}

export function parseFinancialGrowth(
  current: { revenue: number; operating_profit: number },
  previous: { revenue: number; operating_profit: number } | null,
): { revenueGrowth: number | null; operatingProfitGrowth: number | null } {
  if (!previous || previous.revenue === 0 || previous.operating_profit === 0) {
    return { revenueGrowth: null, operatingProfitGrowth: null }
  }
  return {
    revenueGrowth: ((current.revenue - previous.revenue) / Math.abs(previous.revenue)) * 100,
    operatingProfitGrowth:
      ((current.operating_profit - previous.operating_profit) / Math.abs(previous.operating_profit)) * 100,
  }
}

// --- API 호출 ---

async function dartFetch(path: string, params: Record<string, string>): Promise<unknown> {
  const url = new URL(`${DART_BASE}${path}.json`)
  url.searchParams.set('crtfc_key', dartKey())
  for (const [k, v] of Object.entries(params)) {
    url.searchParams.set(k, v)
  }
  const res = await fetch(url.toString(), { signal: AbortSignal.timeout(10000) })
  if (!res.ok) throw new Error(`DART API ${res.status}`)
  return res.json()
}

export interface DartStockInfo {
  has_recent_cbw: boolean
  major_shareholder_pct: number | null
  major_shareholder_delta: number | null
  audit_opinion: string | null
  has_treasury_buyback: boolean
  revenue_growth_yoy: number | null
  operating_profit_growth_yoy: number | null
}

export async function fetchDartInfo(corpCode: string): Promise<DartStockInfo> {
  const sixMonthsAgo = new Date()
  sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6)
  const bgn = sixMonthsAgo.toISOString().slice(0, 10).replace(/-/g, '')
  const end = new Date().toISOString().slice(0, 10).replace(/-/g, '')

  const [disclosures, shareholder, audit, financials] = await Promise.allSettled([
    dartFetch('/list', { corp_code: corpCode, bgn_de: bgn, end_de: end, page_count: '100' }),
    dartFetch('/hyslrSttus', { corp_code: corpCode, bsns_year: String(new Date().getFullYear() - 1), reprt_code: '11011' }),
    dartFetch('/irdsSttus', { corp_code: corpCode, bsns_year: String(new Date().getFullYear() - 1), reprt_code: '11011' }),
    dartFetch('/fnlttSinglAcntAll', { corp_code: corpCode, bsns_year: String(new Date().getFullYear() - 1), reprt_code: '11011', fs_div: 'CFS' }),
  ])

  let has_recent_cbw = false
  let has_treasury_buyback = false
  if (disclosures.status === 'fulfilled') {
    const list = ((disclosures.value as { list?: Disclosure[] }).list) ?? []
    has_recent_cbw = parseCbBwFromDisclosures(list)
    has_treasury_buyback = parseTreasuryBuyback(list)
  }

  let major_shareholder_pct: number | null = null
  let major_shareholder_delta: number | null = null
  if (shareholder.status === 'fulfilled') {
    const data = shareholder.value as { list?: Array<{ trmend_posesn_stock_qota_rt: string; bsis_posesn_stock_qota_rt: string }> }
    if (data.list?.[0]) {
      const parsed = parseMajorShareholderFromReport(data.list[0])
      major_shareholder_pct = parsed.pct
      major_shareholder_delta = parsed.delta
    }
  }

  let audit_opinion: string | null = null
  if (audit.status === 'fulfilled') {
    const data = audit.value as { list?: Array<{ audit_opinion: string }> }
    if (data.list?.[0]) {
      audit_opinion = parseAuditOpinion(data.list[0])
    }
  }

  let revenue_growth_yoy: number | null = null
  let operating_profit_growth_yoy: number | null = null
  if (financials.status === 'fulfilled') {
    // 재무제표 데이터에서 매출/영업이익 추출 후 성장률 계산
    // DART 재무제표 응답 구조에 맞게 파싱 필요 (구현 시 실제 응답 구조 확인)
    const data = financials.value as { list?: Array<{ account_nm: string; thstrm_amount: string; frmtrm_amount: string }> }
    if (data.list) {
      const revenue = data.list.find((r) => r.account_nm === '매출액' || r.account_nm === '수익(매출액)')
      const op = data.list.find((r) => r.account_nm === '영업이익')
      if (revenue && op) {
        const cur = {
          revenue: parseInt(revenue.thstrm_amount?.replace(/,/g, '') || '0', 10),
          operating_profit: parseInt(op.thstrm_amount?.replace(/,/g, '') || '0', 10),
        }
        const prev = {
          revenue: parseInt(revenue.frmtrm_amount?.replace(/,/g, '') || '0', 10),
          operating_profit: parseInt(op.frmtrm_amount?.replace(/,/g, '') || '0', 10),
        }
        const growth = parseFinancialGrowth(cur, prev)
        revenue_growth_yoy = growth.revenueGrowth
        operating_profit_growth_yoy = growth.operatingProfitGrowth
      }
    }
  }

  return {
    has_recent_cbw,
    major_shareholder_pct,
    major_shareholder_delta,
    audit_opinion,
    has_treasury_buyback,
    revenue_growth_yoy,
    operating_profit_growth_yoy,
  }
}
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `cd web && npx vitest run src/lib/dart-api.test.ts`
Expected: PASS (파서 테스트만, API 호출은 통합 테스트)

- [ ] **Step 5: 커밋**

```bash
git add web/src/lib/dart-api.ts web/src/lib/dart-api.test.ts
git commit -m "feat: DART OpenAPI 클라이언트 (CB/BW, 지분율, 감사의견, 자사주, 재무)"
```

---

## Task 7: stock-ranking API 리팩터 — 스냅샷 읽기

**Files:**
- Modify: `web/src/app/api/v1/stock-ranking/route.ts`

- [ ] **Step 1: 스냅샷 읽기 함수 추가**

`route.ts` 상단에 스냅샷 조회 헬퍼를 추가한다. 기존 `calcScore()` 함수는 유지하고, `GET()` 함수 내에서 스냅샷 분기를 추가한다.

```typescript
// route.ts 상단 (import 아래)에 추가

async function readSnapshot(
  supabase: SupabaseClient,
  model: string,
  date: string,
): Promise<{ items: StockRankItem[]; snapshot_time: string | null } | null> {
  let query = supabase
    .from('stock_ranking_snapshot')
    .select('*')
    .eq('model', model)

  if (date === 'all' || date === 'signal_all') {
    // 가장 최근 스냅샷 날짜 사용
    const { data: latest } = await supabase
      .from('stock_ranking_snapshot')
      .select('snapshot_date')
      .eq('model', model)
      .order('snapshot_date', { ascending: false })
      .limit(1)
      .single()

    if (!latest) return null
    query = query.eq('snapshot_date', latest.snapshot_date)
  } else {
    query = query.eq('snapshot_date', date)
  }

  const { data, error } = await query.order('score_total', { ascending: false })
  if (error || !data?.length) return null

  const items: StockRankItem[] = data.map((row: Record<string, unknown>) => ({
    ...((row.raw_data as Record<string, unknown>) ?? {}),
    symbol: row.symbol as string,
    name: row.name as string,
    market: row.market as string,
    current_price: row.current_price as number,
    market_cap: row.market_cap as number,
    score_total: Number(row.score_total),
    score_signal: Number(row.score_signal),
    score_valuation: Number(row.score_valuation),
    score_supply: Number(row.score_supply),
    score_momentum: Number(row.score_momentum),
    score_risk: Number(row.score_risk ?? 0),
    // 노이즈 필터용 필드
    daily_trading_value: row.daily_trading_value as number,
    avg_trading_value_20d: row.avg_trading_value_20d as number,
    turnover_rate: Number(row.turnover_rate ?? 0),
    is_managed: row.is_managed as boolean,
    has_recent_cbw: row.has_recent_cbw as boolean,
    major_shareholder_pct: Number(row.major_shareholder_pct ?? 0),
    signal_date: row.signal_date as string | null,
    grade: row.grade as string,
    characters: row.characters as string[],
    recommendation: row.recommendation as string,
  })) as StockRankItem[]

  return {
    items,
    snapshot_time: data[0]?.snapshot_time as string ?? null,
  }
}
```

- [ ] **Step 2: GET 함수에 스냅샷 분기 추가**

`GET()` 함수 시작 부분에서 `refresh` 파라미터를 확인하고, refresh가 아닌 경우 스냅샷에서 읽는 분기를 추가한다.

```typescript
// GET 함수 내, 기존 로직 시작 전에 추가
const refresh = searchParams.get('refresh') === 'true'

if (!refresh) {
  const snapshot = await readSnapshot(supabase, model, dateParam)
  if (snapshot) {
    // 스냅샷 갱신 상태 조회
    const { data: status } = await supabase
      .from('snapshot_update_status')
      .select('updating, last_updated')
      .single()

    return NextResponse.json({
      items: snapshot.items,
      total: snapshot.items.length,
      snapshot_time: snapshot.snapshot_time,
      updating: status?.updating ?? false,
    }, {
      headers: { 'Cache-Control': 'public, s-maxage=30, stale-while-revalidate=60' },
    })
  }
  // 스냅샷 없으면 기존 실시간 계산으로 fallback
}

// ... 기존 실시간 계산 로직 ...
```

- [ ] **Step 3: 실시간 계산 후 비동기 스냅샷 업서트 추가**

기존 `GET()` 함수의 응답 직전에 비동기 스냅샷 저장 로직을 추가한다.

```typescript
// 기존 return 직전에 추가 (refresh=true이거나 스냅샷 미존재 시)
const todayStr = new Date(Date.now() + 9 * 3600000).toISOString().slice(0, 10)

// 비동기로 스냅샷 저장 (응답 차단 안 함)
void (async () => {
  try {
    const snapshotRows = sorted.map((item: StockRankItem) => ({
      snapshot_date: todayStr,
      snapshot_time: new Date().toISOString(),
      model: model || 'standard',
      symbol: item.symbol,
      name: item.name,
      market: item.market,
      current_price: item.current_price,
      market_cap: item.market_cap,
      daily_trading_value: item.trading_value,
      avg_trading_value_20d: item.avg_trading_value_20d ?? null,
      turnover_rate: item.turnover_rate ?? null,
      is_managed: item.is_managed ?? false,
      has_recent_cbw: item.has_recent_cbw ?? false,
      major_shareholder_pct: item.major_shareholder_pct ?? null,
      score_total: item.score_total,
      score_signal: item.score_signal,
      score_trend: item.score_momentum, // momentum이 trend 역할
      score_valuation: item.score_valuation,
      score_supply: item.score_supply,
      score_risk: item.score_risk ?? 0,
      score_momentum: item.score_momentum,
      score_catalyst: item.score_catalyst ?? 0,
      grade: item.grade,
      characters: item.characters,
      recommendation: item.recommendation,
      signal_date: item.latest_signal_date,
      raw_data: item,
    }))

    for (let i = 0; i < snapshotRows.length; i += 500) {
      await supabase
        .from('stock_ranking_snapshot')
        .upsert(snapshotRows.slice(i, i + 500), {
          onConflict: 'snapshot_date,model,symbol',
          ignoreDuplicates: false,
        })
    }
  } catch (e) {
    console.error('스냅샷 저장 실패:', e)
  }
})()
```

- [ ] **Step 4: StockRankItem 타입에 새 필드 추가**

기존 `StockRankItem` 인터페이스에 노이즈 필터/리스크 관련 필드를 추가한다.

```typescript
// 기존 인터페이스에 추가
interface StockRankItem {
  // ... 기존 필드 ...
  score_risk?: number
  score_catalyst?: number
  daily_trading_value?: number | null
  avg_trading_value_20d?: number | null
  turnover_rate?: number | null
  is_managed?: boolean
  has_recent_cbw?: boolean
  major_shareholder_pct?: number | null
  signal_date?: string | null
  grade?: string
  characters?: string[]
  recommendation?: string
}
```

- [ ] **Step 5: calcScore에 리스크/수급/밸류에이션 추가 항목 통합**

기존 `calcScore()` 함수에 새 모듈을 import하고 점수에 반영한다.

```typescript
import { calcRiskScore } from '@/lib/scoring/risk-score'
import { calcSupplyAdditions } from '@/lib/scoring/supply-score-additions'
import { calcValuationAdditions } from '@/lib/scoring/valuation-score-additions'

// calcScore 함수 내:

// 기존 supply 점수 계산 후
const supplyBonus = calcSupplyAdditions({
  daily_trading_value: stock.trading_value,
  avg_trading_value_20d: stock.avg_trading_value_20d,
  turnover_rate: stock.turnover_rate,
  has_treasury_buyback: stock.has_treasury_buyback,
  major_shareholder_delta: stock.major_shareholder_delta,
})
const finalSupply = Math.min(100, Math.max(0, score_supply + supplyBonus))

// 기존 valuation 점수 계산 후
const valBonus = calcValuationAdditions({
  revenue_growth_yoy: stock.revenue_growth_yoy,
  operating_profit_growth_yoy: stock.operating_profit_growth_yoy,
})
const finalValuation = Math.min(100, Math.max(0, score_valuation + valBonus))

// 리스크 점수 (신규)
const riskScore = calcRiskScore({
  is_managed: stock.is_managed,
  audit_opinion: stock.audit_opinion,
  has_recent_cbw: stock.has_recent_cbw,
  major_shareholder_pct: stock.major_shareholder_pct,
  major_shareholder_delta: stock.major_shareholder_delta,
  daily_trading_value: stock.trading_value,
  avg_trading_value_20d: stock.avg_trading_value_20d,
  turnover_rate: stock.turnover_rate,
}, model)

// 가중치 변경: signal(10) + trend(35) + valuation(20) + supply(25) + risk(10)
const score_total = (
  score_signal * 10 +
  score_momentum * 35 +
  finalValuation * 20 +
  finalSupply * 25 +
  Math.max(0, 100 + riskScore) * 10  // risk는 0~100으로 변환 (100=리스크없음)
) / 100
```

- [ ] **Step 6: DART/네이버 데이터를 stock 객체에 조인**

`GET()` 함수의 데이터 fetch 파이프라인에서 `stock_dart_info`와 `stock_cache`의 새 컬럼을 조인한다.

```typescript
// 기존 parallel fetch에 추가
const [stocksRes, aiRes, infoRes, dartRes] = await Promise.all([
  supabase.from('stock_cache').select('*').not('current_price', 'is', null),
  supabase.from('ai_recommendations').select('*').eq('date', todayStr),
  supabase.from('stock_info').select('symbol, sector'),
  supabase.from('stock_dart_info').select('*'),  // 추가
])

// DART 데이터 맵핑
const dartMap = new Map<string, Record<string, unknown>>()
if (dartRes.data) {
  for (const d of dartRes.data) {
    dartMap.set(d.symbol, d)
  }
}

// stock 객체 구성 시 DART + 네이버 데이터 병합
const dart = dartMap.get(stock.symbol) ?? {}
const enriched = {
  ...stock,
  is_managed: stock.is_managed ?? false,
  float_shares: stock.float_shares ?? null,
  turnover_rate: stock.float_shares
    ? ((stock.volume ?? 0) / stock.float_shares) * 100
    : null,
  has_recent_cbw: dart.has_recent_cbw ?? false,
  major_shareholder_pct: dart.major_shareholder_pct ?? null,
  major_shareholder_delta: dart.major_shareholder_delta ?? null,
  audit_opinion: dart.audit_opinion ?? null,
  has_treasury_buyback: dart.has_treasury_buyback ?? false,
  revenue_growth_yoy: dart.revenue_growth_yoy ?? null,
  operating_profit_growth_yoy: dart.operating_profit_growth_yoy ?? null,
}
```

- [ ] **Step 7: 빌드 확인**

Run: `cd web && npm run build`
Expected: 빌드 성공

- [ ] **Step 8: 커밋**

```bash
git add web/src/app/api/v1/stock-ranking/route.ts
git commit -m "feat: stock-ranking API 스냅샷 읽기/저장 + 리스크/수급/밸류에이션 스코어링 통합"
```

---

## Task 8: 스냅샷 상태 API + 과거 스냅샷 API

**Files:**
- Create: `web/src/app/api/v1/stock-ranking/status/route.ts`
- Create: `web/src/app/api/v1/stock-ranking/snapshot/route.ts`

- [ ] **Step 1: 상태 API 작성**

```typescript
// web/src/app/api/v1/stock-ranking/status/route.ts
import { NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase'

export const dynamic = 'force-dynamic'

export async function GET() {
  const supabase = createServiceClient()
  const { data } = await supabase
    .from('snapshot_update_status')
    .select('updating, last_updated, model')
    .single()

  return NextResponse.json({
    updating: data?.updating ?? false,
    last_updated: data?.last_updated ?? null,
    model: data?.model ?? null,
  }, {
    headers: { 'Cache-Control': 'no-cache' },
  })
}
```

- [ ] **Step 2: 과거 스냅샷 API 작성**

```typescript
// web/src/app/api/v1/stock-ranking/snapshot/route.ts
import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase'

export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url)
  const date = searchParams.get('date')
  const model = searchParams.get('model') || 'standard'

  if (!date) {
    return NextResponse.json({ error: 'date 파라미터 필요' }, { status: 400 })
  }

  const supabase = createServiceClient()
  const { data, error } = await supabase
    .from('stock_ranking_snapshot')
    .select('*')
    .eq('snapshot_date', date)
    .eq('model', model)
    .order('score_total', { ascending: false })

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  // 해당 날짜의 마감 스냅샷 (가장 늦은 snapshot_time)
  const latestTime = data?.length
    ? data.reduce((max, r) =>
        new Date(r.snapshot_time as string) > new Date(max) ? r.snapshot_time as string : max,
      data[0].snapshot_time as string)
    : null

  const items = data?.filter((r) => r.snapshot_time === latestTime) ?? []

  return NextResponse.json({
    date,
    model,
    snapshot_time: latestTime,
    items: items.map((row) => ({
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
    total: items.length,
  }, {
    headers: { 'Cache-Control': 'public, s-maxage=300, stale-while-revalidate=600' },
  })
}
```

- [ ] **Step 3: 빌드 확인**

Run: `cd web && npm run build`
Expected: 빌드 성공

- [ ] **Step 4: 커밋**

```bash
git add web/src/app/api/v1/stock-ranking/status/route.ts web/src/app/api/v1/stock-ranking/snapshot/route.ts
git commit -m "feat: 스냅샷 상태 API + 과거 스냅샷 조회 API"
```

---

## Task 9: 크론 확장 — 스냅샷 + DART 통합

**Files:**
- Modify: `web/src/app/api/v1/cron/intraday-prices/route.ts`

- [ ] **Step 1: 크론에 관리종목/유통주식수 수집 추가**

기존 크론의 가격 업서트 완료 후, 네이버 추가 데이터를 수집한다.

```typescript
// 기존 import에 추가
import { fetchBatchStockExtra } from '@/lib/naver-stock-extra'

// 기존 가격 업서트 로직 뒤에 추가
// --- 관리종목 / 유통주식수 갱신 ---
const allSymbols = rows.map((r: { symbol: string }) => r.symbol)
const extraMap = await fetchBatchStockExtra(allSymbols, 20)

const extraUpdates = Array.from(extraMap.entries()).map(([symbol, info]) => ({
  symbol,
  float_shares: info.floatShares,
  is_managed: info.isManaged,
}))

for (let i = 0; i < extraUpdates.length; i += 500) {
  await supabase
    .from('stock_cache')
    .upsert(extraUpdates.slice(i, i + 500), {
      onConflict: 'symbol',
      ignoreDuplicates: false,
    })
}
```

- [ ] **Step 2: 스냅샷 생성 로직 추가**

크론에서 stock-ranking API를 내부 호출하여 스냅샷을 생성한다.

```typescript
// --- 스냅샷 생성 ---
await supabase
  .from('snapshot_update_status')
  .update({ updating: true, model: 'standard' })
  .eq('id', 1)

try {
  const baseUrl = process.env.NEXT_PUBLIC_BASE_URL || 'http://localhost:3000'

  // standard + short_term 둘 다 갱신
  for (const model of ['standard', 'short_term']) {
    await supabase
      .from('snapshot_update_status')
      .update({ model })
      .eq('id', 1)

    const res = await fetch(
      `${baseUrl}/api/v1/stock-ranking?date=${todayStr}&model=${model}&refresh=true`,
      { signal: AbortSignal.timeout(120000) },
    )
    if (!res.ok) {
      console.error(`스냅샷 생성 실패 (${model}):`, res.status)
    }
  }

  // 30일 초과 스냅샷 삭제
  const thirtyDaysAgo = new Date(Date.now() + 9 * 3600000)
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30)
  const cutoff = thirtyDaysAgo.toISOString().slice(0, 10)

  await supabase
    .from('stock_ranking_snapshot')
    .delete()
    .lt('snapshot_date', cutoff)
} finally {
  await supabase
    .from('snapshot_update_status')
    .update({ updating: false, last_updated: new Date().toISOString() })
    .eq('id', 1)
}
```

- [ ] **Step 3: 20시 마감 시 DART 데이터 수집 추가**

```typescript
// KST 시간 확인
const kstHour = new Date(Date.now() + 9 * 3600000).getHours()

// 20시 마감 크론에서만 DART 수집
if (kstHour >= 20) {
  const { fetchDartInfo } = await import('@/lib/dart-api')

  // corp_code 매핑 (DART는 corp_code 사용, stock_info에서 조회 필요)
  // 주의: DART corp_code ↔ symbol 매핑 테이블이 없다면 별도 구축 필요
  // 여기서는 symbol 단위로 처리한다고 가정
  const { data: symbols } = await supabase
    .from('stock_cache')
    .select('symbol, dart_corp_code')
    .not('dart_corp_code', 'is', null)

  if (symbols) {
    for (let i = 0; i < symbols.length; i += 10) {
      const batch = symbols.slice(i, i + 10)
      const results = await Promise.allSettled(
        batch.map(async (s) => ({
          symbol: s.symbol,
          info: await fetchDartInfo(s.dart_corp_code),
        })),
      )

      const dartRows = results
        .filter((r): r is PromiseFulfilledResult<{ symbol: string; info: DartStockInfo }> =>
          r.status === 'fulfilled')
        .map((r) => ({
          symbol: r.value.symbol,
          ...r.value.info,
          updated_at: new Date().toISOString(),
        }))

      if (dartRows.length > 0) {
        await supabase
          .from('stock_dart_info')
          .upsert(dartRows, { onConflict: 'symbol', ignoreDuplicates: false })
      }
    }
  }
}
```

- [ ] **Step 4: 빌드 확인**

Run: `cd web && npm run build`
Expected: 빌드 성공

- [ ] **Step 5: 커밋**

```bash
git add web/src/app/api/v1/cron/intraday-prices/route.ts
git commit -m "feat: 크론에 스냅샷 생성 + 네이버 크롤링 + DART 수집 통합"
```

---

## Task 10: 스냅샷 상태 폴링 훅

**Files:**
- Create: `web/src/hooks/use-snapshot-status.ts`

- [ ] **Step 1: 훅 작성**

```typescript
// web/src/hooks/use-snapshot-status.ts
'use client'

import { useState, useEffect, useCallback } from 'react'

interface SnapshotStatus {
  updating: boolean
  last_updated: string | null
}

export function useSnapshotStatus(enabled: boolean = true, intervalMs: number = 30000) {
  const [status, setStatus] = useState<SnapshotStatus>({ updating: false, last_updated: null })

  const fetchStatus = useCallback(async () => {
    try {
      const res = await fetch('/api/v1/stock-ranking/status')
      if (res.ok) {
        const data = await res.json()
        setStatus(data)
      }
    } catch {
      // 무시
    }
  }, [])

  useEffect(() => {
    if (!enabled) return

    fetchStatus()
    const id = setInterval(fetchStatus, intervalMs)
    return () => clearInterval(id)
  }, [enabled, intervalMs, fetchStatus])

  return status
}
```

- [ ] **Step 2: use-stock-ranking 훅에 snapshot_time 반영**

```typescript
// web/src/hooks/use-stock-ranking.ts 수정

// RankingResponse에 필드 추가
interface RankingResponse {
  items: StockRankItem[]
  total: number
  snapshot_time?: string | null
  updating?: boolean
}
```

- [ ] **Step 3: 커밋**

```bash
git add web/src/hooks/use-snapshot-status.ts web/src/hooks/use-stock-ranking.ts
git commit -m "feat: 스냅샷 상태 폴링 훅 + use-stock-ranking 응답 타입 확장"
```

---

## Task 11: 종목추천/단기추천 전용 필터바 컴포넌트

**Files:**
- Create: `web/src/components/signals/RecommendationFilterBar.tsx`

- [ ] **Step 1: 필터바 컴포넌트 작성**

```typescript
// web/src/components/signals/RecommendationFilterBar.tsx
'use client'

import { useState } from 'react'

interface RecommendationFilterBarProps {
  // 검색
  searchValue: string
  onSearchChange: (q: string) => void
  // 날짜
  dateMode: 'today' | 'signal_all' | 'all'
  onDateChange: (mode: 'today' | 'signal_all' | 'all') => void
  // 시장
  market: 'all' | 'KOSPI' | 'KOSDAQ'
  onMarketChange: (m: 'all' | 'KOSPI' | 'KOSDAQ') => void
  // 정렬
  sortBy: 'score' | 'name' | 'updated' | 'gap'
  sortDir: 'asc' | 'desc'
  onSortChange: (by: 'score' | 'name' | 'updated' | 'gap') => void
  // 성격
  characterOptions: { key: string; label: string }[]
  selectedCharacter: string
  onCharacterChange: (c: string) => void
  // 노이즈 제외
  noiseFilter: boolean
  onNoiseFilterChange: (on: boolean) => void
  // 새로고침
  onRefresh: () => void
  refreshing: boolean
  // 스냅샷 상태
  updating?: boolean
}

const DATE_OPTIONS = [
  { key: 'today', label: '오늘' },
  { key: 'signal_all', label: '신호전체' },
  { key: 'all', label: '종목전체' },
] as const

const MARKET_OPTIONS = [
  { key: 'all', label: '전체' },
  { key: 'KOSPI', label: 'KOSPI' },
  { key: 'KOSDAQ', label: 'KOSDAQ' },
] as const

const SORT_OPTIONS = [
  { key: 'score', label: '점수' },
  { key: 'name', label: '이름' },
  { key: 'updated', label: '업데이트' },
  { key: 'gap', label: '괴리율' },
] as const

function ButtonGroup<T extends string>({
  options,
  selected,
  onChange,
  sortDir,
}: {
  options: readonly { key: T; label: string }[]
  selected: T
  onChange: (key: T) => void
  sortDir?: 'asc' | 'desc'
}) {
  return (
    <div className="flex rounded-lg border border-[var(--border)] overflow-hidden">
      {options.map((opt) => (
        <button
          key={opt.key}
          onClick={() => onChange(opt.key)}
          className={`px-2.5 py-1 text-xs font-medium transition-colors ${
            selected === opt.key
              ? 'bg-[var(--accent)] text-white'
              : 'bg-[var(--card)] text-[var(--muted-foreground)] hover:bg-[var(--border)]'
          }`}
        >
          {opt.label}
          {sortDir && selected === opt.key && (
            <span className="ml-0.5">{sortDir === 'desc' ? '↓' : '↑'}</span>
          )}
        </button>
      ))}
    </div>
  )
}

export default function RecommendationFilterBar(props: RecommendationFilterBarProps) {
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false)

  return (
    <div className="space-y-1">
      {/* 메인 필터바 — 한 행 */}
      <div className="flex items-center gap-2 overflow-x-auto pb-1">
        {/* 검색 */}
        <input
          type="text"
          placeholder="🔍 검색..."
          value={props.searchValue}
          onChange={(e) => props.onSearchChange(e.target.value)}
          className="w-28 sm:w-36 px-2.5 py-1.5 text-xs rounded-lg border border-[var(--border)] bg-[var(--card)] text-[var(--foreground)] placeholder:text-[var(--muted-foreground)] focus:outline-none focus:ring-1 focus:ring-[var(--accent)]"
        />

        {/* 날짜 */}
        <ButtonGroup
          options={DATE_OPTIONS}
          selected={props.dateMode}
          onChange={props.onDateChange}
        />

        {/* 시장 */}
        <ButtonGroup
          options={MARKET_OPTIONS}
          selected={props.market}
          onChange={props.onMarketChange}
        />

        {/* 정렬 — 모바일에서 숨김 */}
        <div className="hidden sm:block">
          <ButtonGroup
            options={SORT_OPTIONS}
            selected={props.sortBy}
            onChange={props.onSortChange}
            sortDir={props.sortDir}
          />
        </div>

        {/* 성격 드롭다운 — 모바일에서 숨김 */}
        <select
          value={props.selectedCharacter}
          onChange={(e) => props.onCharacterChange(e.target.value)}
          className="hidden sm:block px-2 py-1.5 text-xs rounded-lg border border-[var(--border)] bg-[var(--card)] text-[var(--foreground)]"
        >
          <option value="all">성격 전체</option>
          {props.characterOptions.map((opt) => (
            <option key={opt.key} value={opt.key}>
              {opt.label}
            </option>
          ))}
        </select>

        {/* 노이즈 제외 토글 — 모바일에서 숨김 */}
        <label className="hidden sm:flex items-center gap-1 text-xs text-[var(--muted-foreground)] cursor-pointer whitespace-nowrap">
          <input
            type="checkbox"
            checked={props.noiseFilter}
            onChange={(e) => props.onNoiseFilterChange(e.target.checked)}
            className="w-3.5 h-3.5 rounded accent-[var(--accent)]"
          />
          노이즈 제외
        </label>

        {/* 새로고침 */}
        <button
          onClick={props.onRefresh}
          disabled={props.refreshing}
          className="p-1.5 rounded-lg border border-[var(--border)] bg-[var(--card)] text-[var(--muted-foreground)] hover:bg-[var(--border)] disabled:opacity-50"
        >
          <span className={props.refreshing ? 'animate-spin inline-block' : ''}>🔄</span>
        </button>

        {/* 모바일 더보기 */}
        <button
          onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
          className="sm:hidden p-1.5 rounded-lg border border-[var(--border)] bg-[var(--card)] text-[var(--muted-foreground)]"
        >
          ⋯
        </button>
      </div>

      {/* 모바일 확장 메뉴 */}
      {mobileMenuOpen && (
        <div className="sm:hidden flex flex-wrap items-center gap-2 p-2 rounded-lg border border-[var(--border)] bg-[var(--card)]">
          <ButtonGroup
            options={SORT_OPTIONS}
            selected={props.sortBy}
            onChange={props.onSortChange}
            sortDir={props.sortDir}
          />
          <select
            value={props.selectedCharacter}
            onChange={(e) => props.onCharacterChange(e.target.value)}
            className="px-2 py-1.5 text-xs rounded-lg border border-[var(--border)] bg-[var(--card)]"
          >
            <option value="all">성격 전체</option>
            {props.characterOptions.map((opt) => (
              <option key={opt.key} value={opt.key}>
                {opt.label}
              </option>
            ))}
          </select>
          <label className="flex items-center gap-1 text-xs text-[var(--muted-foreground)] cursor-pointer">
            <input
              type="checkbox"
              checked={props.noiseFilter}
              onChange={(e) => props.onNoiseFilterChange(e.target.checked)}
              className="w-3.5 h-3.5 rounded accent-[var(--accent)]"
            />
            노이즈 제외
          </label>
        </div>
      )}

      {/* 스냅샷 업데이트 배너 */}
      {props.updating && (
        <div className="flex items-center gap-2 px-3 py-1.5 text-xs text-[var(--accent)] bg-[var(--accent)]/10 rounded-lg">
          <span className="animate-spin">⏳</span>
          순위 업데이트 중...
        </div>
      )}
    </div>
  )
}
```

- [ ] **Step 2: 빌드 확인**

Run: `cd web && npm run build`
Expected: 빌드 성공 (아직 사용하는 곳 없어도 컴파일 확인)

- [ ] **Step 3: 커밋**

```bash
git add web/src/components/signals/RecommendationFilterBar.tsx
git commit -m "feat: 종목추천/단기추천 전용 필터바 컴포넌트 (버튼그룹 기반)"
```

---

## Task 12: UnifiedAnalysisSection에 새 필터바 + 스코어링 통합

**Files:**
- Modify: `web/src/components/signals/UnifiedAnalysisSection.tsx`

- [ ] **Step 1: import 교체 및 상태 변수 추가**

기존 `FilterBar` import를 `RecommendationFilterBar`로 교체하고, 노이즈 필터/날짜 모드 상태를 추가한다.

```typescript
// 기존 FilterBar import 제거, 새 필터바 import
import RecommendationFilterBar from './RecommendationFilterBar'
import { useSnapshotStatus } from '@/hooks/use-snapshot-status'

// 컴포넌트 내 상태 추가
const [dateMode, setDateMode] = useState<'today' | 'signal_all' | 'all'>('today')
const [noiseFilter, setNoiseFilter] = useState(false)
const snapshotStatus = useSnapshotStatus()
```

- [ ] **Step 2: 날짜 변경 핸들러 수정**

기존의 날짜 목록(최근 7일) 대신 3개 모드로 변경한다.

```typescript
// 날짜 변경 시 doFetch 호출
const handleDateChange = (mode: 'today' | 'signal_all' | 'all') => {
  setDateMode(mode)
  const dateParam = mode === 'today'
    ? new Date(Date.now() + 9 * 3600000).toISOString().slice(0, 10)
    : mode
  doFetch(dateParam, market)
}
```

- [ ] **Step 3: 노이즈 필터 적용**

필터링 파이프라인에 노이즈 제외 로직을 추가한다.

```typescript
// 기존 필터링 로직 뒤에 추가
let filtered = /* 기존 필터링 결과 */

if (noiseFilter) {
  filtered = filtered.filter((item: StockRankItem) => {
    const tv = item.daily_trading_value ?? item.trading_value ?? 0
    const avgTv = item.avg_trading_value_20d ?? 0
    const tr = item.turnover_rate ?? 0
    const managed = item.is_managed ?? false
    const cbw = item.has_recent_cbw ?? false
    const shareholder = item.major_shareholder_pct ?? 100

    if (tv < 10_000_000_000) return false       // 거래대금 100억 미만
    if (avgTv > 0 && avgTv < 5_000_000_000) return false  // 20일 평균 50억 미만
    if (tr > 0 && tr < 1) return false           // 회전율 1% 미만
    if (managed) return false                     // 관리종목
    if (cbw) return false                         // CB/BW
    if (shareholder < 20) return false            // 최대주주 지분율 20% 미만
    return true
  })
}
```

- [ ] **Step 4: 업데이트순 정렬 구현**

정렬 로직에서 `updated` 옵션이 `signal_date` 기준으로 정렬되도록 수정한다.

```typescript
// 기존 정렬 로직의 'updated' case 수정
case 'updated':
  filtered.sort((a, b) => {
    const dateA = a.signal_date || a.latest_signal_date || ''
    const dateB = b.signal_date || b.latest_signal_date || ''
    return sortDir === 'desc'
      ? dateB.localeCompare(dateA)
      : dateA.localeCompare(dateB)
  })
  break
```

- [ ] **Step 5: FilterBar JSX를 RecommendationFilterBar로 교체**

기존 `<FilterBar ... />` 를 새 필터바로 교체한다.

```tsx
<RecommendationFilterBar
  searchValue={search}
  onSearchChange={setSearch}
  dateMode={dateMode}
  onDateChange={handleDateChange}
  market={market}
  onMarketChange={(m) => { setMarket(m); doFetch(dateMode === 'today' ? todayStr : dateMode, m) }}
  sortBy={sortMode}
  sortDir={sortDir}
  onSortChange={handleSortChange}
  characterOptions={CHARACTER_DEFS}
  selectedCharacter={selectedCharacter}
  onCharacterChange={setSelectedCharacter}
  noiseFilter={noiseFilter}
  onNoiseFilterChange={setNoiseFilter}
  onRefresh={() => doFetch(dateMode === 'today' ? todayStr : dateMode, market, true)}
  refreshing={loading}
  updating={snapshotStatus.updating}
/>
```

- [ ] **Step 6: 가중치 변경 (risk 카테고리 추가)**

기존 기본 가중치를 스펙에 맞게 변경한다.

```typescript
// 기존: { signal: 10, trend: 40, valuation: 20, supply: 30 }
// 변경:
const DEFAULT_WEIGHTS = { signal: 10, trend: 35, valuation: 20, supply: 25, risk: 10 }
```

- [ ] **Step 7: 빌드 확인**

Run: `cd web && npm run build`
Expected: 빌드 성공

- [ ] **Step 8: 커밋**

```bash
git add web/src/components/signals/UnifiedAnalysisSection.tsx
git commit -m "feat: 종목추천 — 새 필터바 + 노이즈 필터 + 리스크 점수 + 업데이트순 정렬"
```

---

## Task 13: ShortTermRecommendationSection에 새 필터바 + 리스크 확장 통합

**Files:**
- Modify: `web/src/components/signals/ShortTermRecommendationSection.tsx`

- [ ] **Step 1: import 교체 및 상태 변수 추가**

UnifiedAnalysisSection과 동일한 패턴으로 변경한다.

```typescript
import RecommendationFilterBar from './RecommendationFilterBar'
import { useSnapshotStatus } from '@/hooks/use-snapshot-status'

const [dateMode, setDateMode] = useState<'today' | 'signal_all' | 'all'>('today')
const [noiseFilter, setNoiseFilter] = useState(false)
const snapshotStatus = useSnapshotStatus()
```

- [ ] **Step 2: 날짜 핸들러 + 노이즈 필터 + 업데이트순 정렬 추가**

Task 12의 Step 2~4와 동일한 로직을 적용한다.

```typescript
const handleDateChange = (mode: 'today' | 'signal_all' | 'all') => {
  setDateMode(mode)
  const dateParam = mode === 'today'
    ? new Date(Date.now() + 9 * 3600000).toISOString().slice(0, 10)
    : mode
  doFetch(dateParam, market)
}

// 노이즈 필터 (Task 12 Step 3과 동일)
if (noiseFilter) {
  filtered = filtered.filter((item: StockRankItem) => {
    const tv = item.daily_trading_value ?? item.trading_value ?? 0
    const avgTv = item.avg_trading_value_20d ?? 0
    const tr = item.turnover_rate ?? 0
    const managed = item.is_managed ?? false
    const cbw = item.has_recent_cbw ?? false
    const shareholder = item.major_shareholder_pct ?? 100

    if (tv < 10_000_000_000) return false
    if (avgTv > 0 && avgTv < 5_000_000_000) return false
    if (tr > 0 && tr < 1) return false
    if (managed) return false
    if (cbw) return false
    if (shareholder < 20) return false
    return true
  })
}

// 업데이트순 정렬
case 'updated':
  filtered.sort((a, b) => {
    const dateA = a.signal_date || a.latest_signal_date || ''
    const dateB = b.signal_date || b.latest_signal_date || ''
    return sortDir === 'desc'
      ? dateB.localeCompare(dateA)
      : dateA.localeCompare(dateB)
  })
  break
```

- [ ] **Step 3: computeShortTermScores에 새 리스크 항목 추가**

기존 risk 계산 함수에 DART/네이버 데이터 기반 감점을 추가한다.

```typescript
// computeShortTermScores 함수의 risk 섹션 끝에 추가
// 관리종목
if (item.is_managed) riskRaw += 100
// 감사의견 비적정
if (item.audit_opinion && item.audit_opinion !== '적정') riskRaw += 80
// CB/BW
if (item.has_recent_cbw) riskRaw += 20
// 최대주주 지분율 < 20%
if (item.major_shareholder_pct != null && item.major_shareholder_pct < 20) riskRaw += 15
// 최대주주 지분 감소
if (item.major_shareholder_delta != null && item.major_shareholder_delta < 0) riskRaw += 10
// 회전율 > 10%
if (item.turnover_rate != null && item.turnover_rate > 10) riskRaw += 10
// 거래대금 < 30억
const tv = item.daily_trading_value ?? item.trading_value ?? 0
if (tv > 0 && tv < 3_000_000_000) riskRaw += 15
```

- [ ] **Step 4: FilterBar JSX 교체**

```tsx
<RecommendationFilterBar
  searchValue={search}
  onSearchChange={setSearch}
  dateMode={dateMode}
  onDateChange={handleDateChange}
  market={market}
  onMarketChange={(m) => { setMarket(m); doFetch(dateMode === 'today' ? todayStr : dateMode, m) }}
  sortBy={sortMode}
  sortDir={sortDir}
  onSortChange={handleSortChange}
  characterOptions={SHORT_TERM_CHARACTER_DEFS}
  selectedCharacter={selectedCharacter}
  onCharacterChange={setSelectedCharacter}
  noiseFilter={noiseFilter}
  onNoiseFilterChange={setNoiseFilter}
  onRefresh={() => doFetch(dateMode === 'today' ? todayStr : dateMode, market, true)}
  refreshing={loading}
  updating={snapshotStatus.updating}
/>
```

- [ ] **Step 5: 빌드 확인**

Run: `cd web && npm run build`
Expected: 빌드 성공

- [ ] **Step 6: 커밋**

```bash
git add web/src/components/signals/ShortTermRecommendationSection.tsx
git commit -m "feat: 단기추천 — 새 필터바 + 노이즈 필터 + 리스크 확장"
```

---

## Task 14: 전체 통합 테스트 및 빌드 검증

- [ ] **Step 1: 단위 테스트 전체 실행**

Run: `cd web && npx vitest run`
Expected: 모든 테스트 PASS

- [ ] **Step 2: 빌드 확인**

Run: `cd web && npm run build`
Expected: 빌드 성공, 에러 없음

- [ ] **Step 3: 린트 확인**

Run: `cd web && npm run lint`
Expected: 에러 없음

- [ ] **Step 4: 최종 커밋**

```bash
git add -A
git commit -m "chore: AI신호 종목추천/단기추천 개선 — 전체 통합 완료"
```
