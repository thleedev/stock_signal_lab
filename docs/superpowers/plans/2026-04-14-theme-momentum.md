# 주도주 & 테마 모멘텀 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** KRX 업종 + 네이버 테마를 일 1회 크롤해 종목 추천 점수의 수급/추세 축에 보너스로 반영하고, UI에 테마 태그·주도주 배지·핫 테마 배너를 추가한다.

**Architecture:** 크롤러(.github/scripts/batch/)가 `stock_sectors` / `stock_themes` / `theme_stocks` 테이블을 채우고, 추천 생성 API(index.ts)가 해당 데이터를 배치 조회해 `calcThemeBonus()` 순수 함수로 수급/추세 점수에 보너스를 적용한 뒤 `ai_recommendations`에 저장한다. UI는 테이블의 `theme_tags`, `is_leader`, `is_hot_theme` 컬럼을 읽어 배지를 렌더링한다.

**Tech Stack:** TypeScript, Supabase JS Client, Vitest, Next.js App Router, Tailwind CSS v4

---

## 파일 구조

| 파일 | 동작 |
|------|------|
| `supabase/migrations/069_theme_momentum.sql` | 새 테이블 3개 + ai_recommendations 컬럼 추가 |
| `web/src/types/theme.ts` | ThemeTag, ThemeBonusInput, ThemeBonusResult 타입 |
| `web/src/lib/ai-recommendation/theme-bonus.ts` | calcThemeBonus() 순수 함수 |
| `web/src/lib/ai-recommendation/__tests__/theme-bonus.test.ts` | 위 함수 Vitest 테스트 |
| `web/src/lib/ai-recommendation/index.ts` | theme_stocks 배치 조회 + 보너스 적용 (수정) |
| `.github/scripts/batch/step9-crawl-sectors.ts` | KRX 업종-종목 매핑 크롤러 |
| `.github/scripts/batch/step10-crawl-themes.ts` | 네이버 테마 크롤러 + 주도주 판별 |
| `.github/scripts/batch/index.ts` | 크롤러 스텝 추가 (수정) |
| `web/src/app/api/v1/hot-themes/route.ts` | 핫 테마 Top 10 조회 API |
| `web/src/components/signals/ThemeBadges.tsx` | 테마 태그 + 주도주 배지 컴포넌트 |
| `web/src/components/signals/HotThemesBanner.tsx` | 핫 테마 현황 배너 컴포넌트 |
| `web/src/components/signals/AiRecommendationSection.tsx` | ThemeBadges 추가 (수정) |
| `web/src/components/signals/ShortTermRecommendationSection.tsx` | ThemeBadges 추가 (수정) |
| `web/src/app/signals/page.tsx` | HotThemesBanner + 테마 필터 추가 (수정) |

---

## Task 1: DB 마이그레이션

**Files:**
- Create: `supabase/migrations/069_theme_momentum.sql`

- [x] **Step 1: 마이그레이션 파일 작성**

```sql
-- supabase/migrations/069_theme_momentum.sql

-- KRX 업종-종목 매핑 (상위 레이어)
CREATE TABLE IF NOT EXISTS stock_sectors (
  sector_code TEXT NOT NULL,
  sector_name TEXT NOT NULL,
  symbol      TEXT NOT NULL,
  updated_at  DATE NOT NULL DEFAULT CURRENT_DATE,
  PRIMARY KEY (sector_code, symbol)
);

CREATE INDEX IF NOT EXISTS idx_stock_sectors_symbol ON stock_sectors (symbol);

-- 네이버 테마 메타 + 당일 강도 (하위 레이어)
CREATE TABLE IF NOT EXISTS stock_themes (
  theme_id        TEXT NOT NULL,
  theme_name      TEXT NOT NULL,
  avg_change_pct  FLOAT,
  top_change_pct  FLOAT,
  stock_count     INT,
  momentum_score  FLOAT,          -- 정규화된 테마 강도 0~100
  is_hot          BOOLEAN NOT NULL DEFAULT FALSE,  -- 상위 10% 과열 여부
  date            DATE NOT NULL,
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (theme_id, date)
);

CREATE INDEX IF NOT EXISTS idx_stock_themes_date ON stock_themes (date);
CREATE INDEX IF NOT EXISTS idx_stock_themes_date_hot ON stock_themes (date, is_hot);

-- 테마-종목 매핑 (일별)
CREATE TABLE IF NOT EXISTS theme_stocks (
  theme_id   TEXT NOT NULL,
  symbol     TEXT NOT NULL,
  name       TEXT NOT NULL,
  change_pct FLOAT,
  is_leader  BOOLEAN NOT NULL DEFAULT FALSE,
  date       DATE NOT NULL,
  PRIMARY KEY (theme_id, symbol, date)
);

CREATE INDEX IF NOT EXISTS idx_theme_stocks_date_symbol ON theme_stocks (date, symbol);

-- ai_recommendations에 테마 컬럼 추가
ALTER TABLE ai_recommendations
  ADD COLUMN IF NOT EXISTS theme_tags    JSONB,
  ADD COLUMN IF NOT EXISTS is_leader     BOOLEAN DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS is_hot_theme  BOOLEAN DEFAULT FALSE;
```

- [x] **Step 2: 마이그레이션 적용**

```bash
# Supabase MCP 또는 대시보드에서 실행
# 또는 로컬:
cd /Users/thlee/GoogleDrive/DashboardStock
cat supabase/migrations/069_theme_momentum.sql
```

Supabase MCP(`mcp__plugin_supabase_supabase__apply_migration`)로 적용하거나 대시보드 SQL 에디터에서 실행.

- [x] **Step 3: 커밋**

```bash
git add supabase/migrations/069_theme_momentum.sql
git commit -m "feat: theme momentum - DB 마이그레이션 (stock_sectors/themes/theme_stocks)"
```

---

## Task 2: TypeScript 타입 정의

**Files:**
- Create: `web/src/types/theme.ts`

- [ ] **Step 1: 타입 파일 작성**

```typescript
// web/src/types/theme.ts

/** UI에서 추천 카드에 표시하는 테마 태그 */
export interface ThemeTag {
  theme_id: string;
  theme_name: string;
  momentum_score: number;
  is_hot: boolean;
}

/** calcThemeBonus() 입력 */
export interface ThemeBonusInput {
  /** 해당 종목이 속한 테마 목록 (theme_stocks → stock_themes join) */
  themes: Array<{
    theme_id: string;
    theme_name: string;
    momentum_score: number | null;
    is_hot: boolean;
  }>;
  /** theme_stocks.is_leader */
  is_leader: boolean;
}

/** calcThemeBonus() 출력 */
export interface ThemeBonusResult {
  /** 수급 점수에 가산할 점수 (테마 강도 최대 +10 + 주도주 +5) */
  supply_bonus: number;
  /** 추세/촉매 점수에 가산할 점수 (주도주 +3) */
  trend_bonus: number;
  /** 리스크 점수에 추가 감점 (과열 테마 +5, 양수로 표현) */
  risk_deduction: number;
  /** UI용 테마 태그 (강도 순 최대 2개) */
  theme_tags: ThemeTag[];
  is_leader: boolean;
  is_hot_theme: boolean;
}
```

- [ ] **Step 2: 커밋**

```bash
git add web/src/types/theme.ts
git commit -m "feat: theme momentum - ThemeTag/ThemeBonusInput/ThemeBonusResult 타입 정의"
```

---

## Task 3: calcThemeBonus() 순수 함수 (TDD)

**Files:**
- Create: `web/src/lib/ai-recommendation/__tests__/theme-bonus.test.ts`
- Create: `web/src/lib/ai-recommendation/theme-bonus.ts`

- [ ] **Step 1: 실패하는 테스트 작성**

```typescript
// web/src/lib/ai-recommendation/__tests__/theme-bonus.test.ts
import { describe, it, expect } from 'vitest';
import { calcThemeBonus } from '../theme-bonus';

describe('calcThemeBonus', () => {
  it('테마 미소속 종목은 보너스 없음', () => {
    const result = calcThemeBonus({ themes: [], is_leader: false });
    expect(result.supply_bonus).toBe(0);
    expect(result.trend_bonus).toBe(0);
    expect(result.risk_deduction).toBe(0);
    expect(result.theme_tags).toEqual([]);
    expect(result.is_leader).toBe(false);
    expect(result.is_hot_theme).toBe(false);
  });

  it('테마 강도 100이면 수급 보너스 +10', () => {
    const result = calcThemeBonus({
      themes: [{ theme_id: 't1', theme_name: '반도체', momentum_score: 100, is_hot: false }],
      is_leader: false,
    });
    expect(result.supply_bonus).toBe(10);
    expect(result.trend_bonus).toBe(0);
  });

  it('테마 강도 50이면 수급 보너스 +5', () => {
    const result = calcThemeBonus({
      themes: [{ theme_id: 't1', theme_name: 'AI', momentum_score: 50, is_hot: false }],
      is_leader: false,
    });
    expect(result.supply_bonus).toBe(5);
  });

  it('주도주이면 수급 +5, 추세 +3 추가', () => {
    const result = calcThemeBonus({
      themes: [{ theme_id: 't1', theme_name: '방산', momentum_score: 0, is_hot: false }],
      is_leader: true,
    });
    expect(result.supply_bonus).toBe(5);
    expect(result.trend_bonus).toBe(3);
  });

  it('테마 강도 80 + 주도주 → 수급 +13, 추세 +3', () => {
    const result = calcThemeBonus({
      themes: [{ theme_id: 't1', theme_name: '2차전지', momentum_score: 80, is_hot: false }],
      is_leader: true,
    });
    expect(result.supply_bonus).toBe(13); // 8(테마) + 5(주도주)
    expect(result.trend_bonus).toBe(3);
  });

  it('과열 테마 소속이면 risk_deduction +5', () => {
    const result = calcThemeBonus({
      themes: [{ theme_id: 't1', theme_name: 'AI', momentum_score: 90, is_hot: true }],
      is_leader: false,
    });
    expect(result.risk_deduction).toBe(5);
    expect(result.is_hot_theme).toBe(true);
  });

  it('여러 테마 중 가장 강한 테마로 보너스 계산', () => {
    const result = calcThemeBonus({
      themes: [
        { theme_id: 't1', theme_name: 'AI', momentum_score: 80, is_hot: false },
        { theme_id: 't2', theme_name: '반도체', momentum_score: 60, is_hot: false },
        { theme_id: 't3', theme_name: '방산', momentum_score: 40, is_hot: false },
      ],
      is_leader: false,
    });
    expect(result.supply_bonus).toBe(8); // 80/100 * 10
  });

  it('테마 태그는 강도 순 최대 2개', () => {
    const result = calcThemeBonus({
      themes: [
        { theme_id: 't1', theme_name: 'AI', momentum_score: 80, is_hot: false },
        { theme_id: 't2', theme_name: '반도체', momentum_score: 60, is_hot: false },
        { theme_id: 't3', theme_name: '방산', momentum_score: 40, is_hot: false },
      ],
      is_leader: false,
    });
    expect(result.theme_tags).toHaveLength(2);
    expect(result.theme_tags[0].theme_name).toBe('AI');
    expect(result.theme_tags[1].theme_name).toBe('반도체');
  });

  it('momentum_score가 null인 테마는 0으로 처리', () => {
    const result = calcThemeBonus({
      themes: [{ theme_id: 't1', theme_name: 'X', momentum_score: null, is_hot: false }],
      is_leader: false,
    });
    expect(result.supply_bonus).toBe(0);
  });
});
```

- [ ] **Step 2: 테스트 실패 확인**

```bash
cd web && npm run test -- --run src/lib/ai-recommendation/__tests__/theme-bonus.test.ts
```

Expected: 오류 (모듈 없음)

- [ ] **Step 3: 구현 작성**

```typescript
// web/src/lib/ai-recommendation/theme-bonus.ts
import type { ThemeBonusInput, ThemeBonusResult, ThemeTag } from '@/types/theme';

/** 테마 모멘텀 보너스 계산 (순수 함수, DB 쿼리 없음) */
export function calcThemeBonus(input: ThemeBonusInput): ThemeBonusResult {
  const { themes, is_leader } = input;

  if (themes.length === 0 && !is_leader) {
    return {
      supply_bonus: 0,
      trend_bonus: 0,
      risk_deduction: 0,
      theme_tags: [],
      is_leader: false,
      is_hot_theme: false,
    };
  }

  // 가장 강한 테마의 momentum_score로 수급 보너스 계산
  const maxMomentum = themes.reduce((max, t) => {
    const score = t.momentum_score ?? 0;
    return score > max ? score : max;
  }, 0);

  const theme_supply_bonus = Math.round((maxMomentum / 100) * 10 * 10) / 10; // 최대 +10
  const leader_supply_bonus = is_leader ? 5 : 0;
  const trend_bonus = is_leader ? 3 : 0;
  const is_hot_theme = themes.some((t) => t.is_hot);
  const risk_deduction = is_hot_theme ? 5 : 0;

  // 테마 태그: 강도 순 정렬 후 최대 2개
  const theme_tags: ThemeTag[] = [...themes]
    .filter((t) => t.momentum_score !== null)
    .sort((a, b) => (b.momentum_score ?? 0) - (a.momentum_score ?? 0))
    .slice(0, 2)
    .map((t) => ({
      theme_id: t.theme_id,
      theme_name: t.theme_name,
      momentum_score: t.momentum_score ?? 0,
      is_hot: t.is_hot,
    }));

  return {
    supply_bonus: theme_supply_bonus + leader_supply_bonus,
    trend_bonus,
    risk_deduction,
    theme_tags,
    is_leader,
    is_hot_theme,
  };
}
```

- [ ] **Step 4: 테스트 통과 확인**

```bash
cd web && npm run test -- --run src/lib/ai-recommendation/__tests__/theme-bonus.test.ts
```

Expected: 전체 PASS

- [ ] **Step 5: 커밋**

```bash
git add web/src/lib/ai-recommendation/theme-bonus.ts \
        web/src/lib/ai-recommendation/__tests__/theme-bonus.test.ts
git commit -m "feat: theme momentum - calcThemeBonus() 순수 함수 + 테스트"
```

---

## Task 4: 추천 생성 오케스트레이터 수정

**Files:**
- Modify: `web/src/lib/ai-recommendation/index.ts`

> 기존 배치 조회 블록에 `theme_stocks` 쿼리를 추가하고, 종목별 점수 계산 후 보너스를 적용한다.

- [ ] **Step 1: theme_stocks 배치 조회 추가**

`index.ts`의 `Promise.all` 배치 조회 블록 끝에 추가 (기존 `dartRows` 조회 다음):

```typescript
// 기존 Promise.all 안에 추가 (마지막 항목 뒤)
supabase
  .from('theme_stocks')
  .select('theme_id, symbol, is_leader, theme_stocks_themes:stock_themes(theme_name, momentum_score, is_hot)')
  // NOTE: Supabase는 foreign key 없이 join을 지원하지 않으므로
  // 별도 쿼리 2개로 분리 (아래 참고)
```

Supabase JS에서 별도 테이블 join이 없으므로, `theme_stocks`와 `stock_themes`를 별도로 조회한다:

```typescript
// Promise.all 배열에 아래 2개 추가
supabase
  .from('theme_stocks')
  .select('theme_id, symbol, is_leader')
  .in('symbol', symbols)
  .eq('date', todayKst),

supabase
  .from('stock_themes')
  .select('theme_id, theme_name, momentum_score, is_hot')
  .eq('date', todayKst),
```

그리고 결과를 구조분해할당에 추가:

```typescript
const [
  { data: cacheData },
  // ... 기존 6개 ...
  { data: dartRows },
  { data: themeStockRows },  // 추가
  { data: themeMetaRows },   // 추가
] = await Promise.all([...]);
```

- [ ] **Step 2: theme 데이터를 Map으로 변환**

`dartMap` 생성 코드 이후에 추가:

```typescript
// theme_id → StockTheme 메타 Map
const themeMetaMap = new Map<string, { theme_name: string; momentum_score: number | null; is_hot: boolean }>(
  (themeMetaRows ?? []).map((t) => [
    t.theme_id as string,
    {
      theme_name: t.theme_name as string,
      momentum_score: t.momentum_score as number | null,
      is_hot: t.is_hot as boolean,
    },
  ])
);

// symbol → { is_leader, themes[] } Map
const symbolThemeMap = new Map<string, { is_leader: boolean; themes: Array<{ theme_id: string; theme_name: string; momentum_score: number | null; is_hot: boolean }> }>();
for (const row of themeStockRows ?? []) {
  const sym = row.symbol as string;
  const meta = themeMetaMap.get(row.theme_id as string);
  if (!symbolThemeMap.has(sym)) {
    symbolThemeMap.set(sym, { is_leader: false, themes: [] });
  }
  const entry = symbolThemeMap.get(sym)!;
  if (row.is_leader) entry.is_leader = true;
  if (meta) {
    entry.themes.push({
      theme_id: row.theme_id as string,
      theme_name: meta.theme_name,
      momentum_score: meta.momentum_score,
      is_hot: meta.is_hot,
    });
  }
}
```

- [ ] **Step 3: 점수 계산 후 보너스 적용**

`scored` 블록에서 `total_score` 계산 직전에 추가:

```typescript
// theme-bonus.ts import를 파일 상단에 추가:
// import { calcThemeBonus } from './theme-bonus';

// 종목별 scored 맵핑 내부, total_score 계산 직전에:
const themeEntry = symbolThemeMap.get(symbol);
const themeBonus = calcThemeBonus({
  themes: themeEntry?.themes ?? [],
  is_leader: themeEntry?.is_leader ?? false,
});

// 보너스를 원점수에 직접 가산 후 정규화 점수 재계산
// supply_score: rawScore에 보너스 가산 (상한 45 유지)
const boostedSupplyRaw = Math.min(supplyResult.score + themeBonus.supply_bonus, 45);
const boostedSupplyNorm = Math.round(((Math.max(boostedSupplyRaw, -10) - (-10)) / 55) * 100 * 10) / 10;

// technical_score: rawScore에 추세 보너스 가산 (상한 65 유지)
const boostedTrendRaw = Math.min(technicalResult.score + themeBonus.trend_bonus, 65);
const boostedTrendNorm = Math.round(((Math.max(boostedTrendRaw, 0)) / 65) * 100 * 10) / 10;

// risk: 과열 감점 추가
const boostedRiskNorm = Math.min(riskResult.normalizedScore + themeBonus.risk_deduction, 100);
```

그리고 `base` 계산을 수정:

```typescript
// 기존:
// const base =
//   (signalResult.normalizedScore / 100) * weights.signal +
//   (technicalResult.normalizedScore / 100) * weights.trend +
//   ...

// 수정:
const base =
  (signalResult.normalizedScore / 100) * weights.signal +
  (Math.min(boostedTrendNorm, 100) / 100) * weights.trend +
  (valuationResult.normalizedScore / 100) * weights.valuation +
  (Math.min(boostedSupplyNorm, 100) / 100) * weights.supply +
  (earningsMomentumResult.normalizedScore / 100) * weights.earnings_momentum;

const total_score = Math.max(0, Math.min(base - (boostedRiskNorm / 100) * weights.risk, 100));
```

- [ ] **Step 4: 저장 객체에 테마 컬럼 추가**

`return { symbol, name, total_score, ... }` 블록에 추가:

```typescript
theme_tags: themeBonus.theme_tags.length > 0 ? themeBonus.theme_tags : null,
is_leader: themeBonus.is_leader,
is_hot_theme: themeBonus.is_hot_theme,
```

그리고 Supabase upsert 구문에서 이 컬럼들이 포함되는지 확인 (이미 객체 전체를 insert하는 구조라면 자동 포함).

- [ ] **Step 5: 빌드 확인**

```bash
cd web && npm run build 2>&1 | tail -20
```

Expected: 타입 에러 없이 빌드 성공

- [ ] **Step 6: 커밋**

```bash
git add web/src/lib/ai-recommendation/index.ts
git commit -m "feat: theme momentum - 추천 생성 시 테마 보너스 적용"
```

---

## Task 5: KRX 섹터 크롤러

**Files:**
- Create: `.github/scripts/batch/step9-crawl-sectors.ts`

- [ ] **Step 1: 크롤러 작성**

```typescript
// .github/scripts/batch/step9-crawl-sectors.ts
import { SupabaseClient } from '@supabase/supabase-js';

interface KrxSectorRow {
  sector_code: string;
  sector_name: string;
  symbol: string;
}

/**
 * KRX 업종별 종목 매핑 크롤러
 * KRX REST API (data.krx.co.kr) 사용
 */
export async function crawlSectors(supabase: SupabaseClient): Promise<void> {
  console.log('[step9] KRX 섹터 크롤 시작');

  const today = new Date().toISOString().slice(0, 10);
  const rows: KrxSectorRow[] = [];

  // KRX 업종분류 현황 API (KOSPI 기준)
  // bld: dbms/MDC/STAT/standard/MDCSTAT03901 (업종별 주가지수)
  // 업종-종목 매핑은 MDCSTAT03501 (업종별 세부 종목)
  const url = 'https://data.krx.co.kr/comm/bldAttendant/getJsonData.cmd';
  const body = new URLSearchParams({
    bld: 'dbms/MDC/STAT/standard/MDCSTAT03501',
    locale: 'ko_KR',
    mktId: 'STK',       // KOSPI
    share: '1',
    money: '1',
    csvxls_isNo: 'false',
  });

  const resp = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
      'Referer': 'https://data.krx.co.kr/',
      'User-Agent': 'Mozilla/5.0',
    },
    body: body.toString(),
  });

  if (!resp.ok) {
    console.error(`[step9] KRX API 오류: ${resp.status}`);
    return;
  }

  const json = await resp.json() as { output?: Array<Record<string, string>> };
  const output = json.output ?? [];

  for (const item of output) {
    // KRX 응답 필드명 확인 후 아래 키 조정 필요
    const sectorCode = item['IDX_IND_NM'] ?? item['업종코드'] ?? '';
    const sectorName = item['IDX_IND_NM'] ?? item['업종명'] ?? '';
    const symbol = (item['ISU_SRT_CD'] ?? item['단축코드'] ?? '').replace(/^A/, '');
    if (!symbol || !sectorCode) continue;
    rows.push({ sector_code: sectorCode, sector_name: sectorName, symbol });
  }

  if (rows.length === 0) {
    console.warn('[step9] KRX 응답 데이터 없음 — 필드명 확인 필요');
    return;
  }

  // 기존 데이터 삭제 후 새로 insert (날짜 컬럼이 없어 전체 교체)
  const { error } = await supabase
    .from('stock_sectors')
    .upsert(
      rows.map((r) => ({ ...r, updated_at: today })),
      { onConflict: 'sector_code,symbol' }
    );

  if (error) {
    console.error('[step9] stock_sectors upsert 오류:', error.message);
  } else {
    console.log(`[step9] stock_sectors ${rows.length}건 저장 완료`);
  }
}
```

> **주의**: KRX API 필드명(`IDX_IND_NM`, `ISU_SRT_CD`)은 실제 응답을 확인 후 조정 필요. 처음 실행 시 `console.log(output[0])`으로 필드명을 확인한다.

- [ ] **Step 2: 커밋**

```bash
git add .github/scripts/batch/step9-crawl-sectors.ts
git commit -m "feat: theme momentum - KRX 섹터 크롤러"
```

---

## Task 6: 네이버 테마 크롤러 + 주도주 판별

**Files:**
- Create: `.github/scripts/batch/step10-crawl-themes.ts`

- [ ] **Step 1: 크롤러 작성**

```typescript
// .github/scripts/batch/step10-crawl-themes.ts
import { SupabaseClient } from '@supabase/supabase-js';

interface NaverTheme {
  theme_id: string;
  theme_name: string;
  avg_change_pct: number;
}

interface NaverThemeStock {
  theme_id: string;
  symbol: string;
  name: string;
  change_pct: number;
  change_5d_pct: number | null; // 5일 등락률 (주도주 판별용)
}

/**
 * 네이버 증권 테마 페이지에서 테마 목록과 종목을 수집한다.
 * HTML 파싱 기반 (공식 API 없음).
 */
export async function crawlThemes(supabase: SupabaseClient): Promise<void> {
  console.log('[step10] 네이버 테마 크롤 시작');

  const today = new Date(
    new Date().getTime() + 9 * 60 * 60 * 1000
  ).toISOString().slice(0, 10); // KST 날짜

  // Step A: 테마 목록 수집
  const themes = await fetchThemeList();
  if (themes.length === 0) {
    console.warn('[step10] 테마 목록 없음');
    return;
  }
  console.log(`[step10] 테마 ${themes.length}개 수집`);

  // Step B: 테마별 종목 수집 (동시성 제한: 5개씩)
  const allStocks: NaverThemeStock[] = [];
  const CHUNK = 5;
  for (let i = 0; i < themes.length; i += CHUNK) {
    const chunk = themes.slice(i, i + CHUNK);
    const results = await Promise.allSettled(
      chunk.map((t) => fetchThemeStocks(t.theme_id))
    );
    for (let j = 0; j < results.length; j++) {
      const res = results[j];
      if (res.status === 'fulfilled') {
        allStocks.push(...res.value.map((s) => ({
          ...s,
          theme_id: chunk[j].theme_id,
        })));
      }
    }
    await new Promise((r) => setTimeout(r, 200)); // 요청 간격
  }

  // Step C: momentum_score 정규화 (min-max)
  const changePcts = themes.map((t) => t.avg_change_pct);
  const minPct = Math.min(...changePcts);
  const maxPct = Math.max(...changePcts);
  const span = maxPct - minPct || 1;

  const themeRows = themes.map((t) => {
    const momentum_score = Math.round(((t.avg_change_pct - minPct) / span) * 100 * 10) / 10;
    return {
      theme_id: t.theme_id,
      theme_name: t.theme_name,
      avg_change_pct: t.avg_change_pct,
      top_change_pct: null as number | null,
      stock_count: allStocks.filter((s) => s.theme_id === t.theme_id).length,
      momentum_score,
      is_hot: false, // 아래에서 갱신
      date: today,
      updated_at: new Date().toISOString(),
    };
  });

  // 상위 10% = is_hot
  const sortedScores = [...themeRows].sort((a, b) => (b.momentum_score ?? 0) - (a.momentum_score ?? 0));
  const hotCount = Math.max(1, Math.ceil(sortedScores.length * 0.1));
  const hotIds = new Set(sortedScores.slice(0, hotCount).map((t) => t.theme_id));
  themeRows.forEach((t) => { if (hotIds.has(t.theme_id)) t.is_hot = true; });

  // Step D: 주도주 판별 (stock_cache 데이터 활용)
  const symbols = [...new Set(allStocks.map((s) => s.symbol))];
  const { data: cacheData } = await supabase
    .from('stock_cache')
    .select('symbol, volume, current_price, foreign_net_qty, institution_net_qty')
    .in('symbol', symbols);

  const cacheMap = new Map((cacheData ?? []).map((c) => [c.symbol as string, c]));

  // 섹터 평균 거래대금 (간략 계산: 전체 stock_cache 기준)
  const { data: allCache } = await supabase
    .from('stock_cache')
    .select('volume, current_price');
  const avgTurnover = (allCache ?? []).reduce((sum, c) => {
    return sum + (c.volume ?? 0) * (c.current_price ?? 0);
  }, 0) / Math.max(allCache?.length ?? 1, 1);

  // 테마별 5일 수익률 상위 30% 기준 계산
  const leaderSymbols = new Set<string>();
  const themeGrouped = new Map<string, NaverThemeStock[]>();
  for (const s of allStocks) {
    if (!themeGrouped.has(s.theme_id)) themeGrouped.set(s.theme_id, []);
    themeGrouped.get(s.theme_id)!.push(s);
  }

  for (const [, stocks] of themeGrouped) {
    // 5일 등락률 기준 정렬 (없으면 당일 등락률 사용)
    const sorted = [...stocks].sort((a, b) =>
      ((b.change_5d_pct ?? b.change_pct) - (a.change_5d_pct ?? a.change_pct))
    );
    const top30Count = Math.max(1, Math.ceil(sorted.length * 0.3));
    const top30 = new Set(sorted.slice(0, top30Count).map((s) => s.symbol));

    for (const stock of stocks) {
      const cache = cacheMap.get(stock.symbol);
      const myTurnover = (cache?.volume ?? 0) * (cache?.current_price ?? 0);
      const volumeSurge = myTurnover > avgTurnover * 1.5;
      const smartMoney =
        (cache?.foreign_net_qty ?? 0) > 0 || (cache?.institution_net_qty ?? 0) > 0;
      const priceTop = top30.has(stock.symbol);

      // 3개 조건 중 2개 이상 → 주도주
      const conditionsMet = [priceTop, volumeSurge, smartMoney].filter(Boolean).length;
      if (conditionsMet >= 2) leaderSymbols.add(stock.symbol);
    }
  }

  // Step E: DB 저장
  // stock_themes upsert
  const { error: themeErr } = await supabase
    .from('stock_themes')
    .upsert(themeRows, { onConflict: 'theme_id,date' });
  if (themeErr) console.error('[step10] stock_themes 오류:', themeErr.message);

  // theme_stocks upsert
  const stockRows = allStocks.map((s) => ({
    theme_id: s.theme_id,
    symbol: s.symbol,
    name: s.name,
    change_pct: s.change_pct,
    is_leader: leaderSymbols.has(s.symbol),
    date: today,
  }));

  // 배치 upsert (500건 단위)
  const BATCH = 500;
  for (let i = 0; i < stockRows.length; i += BATCH) {
    const { error } = await supabase
      .from('theme_stocks')
      .upsert(stockRows.slice(i, i + BATCH), { onConflict: 'theme_id,symbol,date' });
    if (error) console.error('[step10] theme_stocks 오류:', error.message);
  }

  console.log(
    `[step10] 완료 — 테마 ${themeRows.length}개, 종목 ${stockRows.length}건, 주도주 ${leaderSymbols.size}개`
  );
}

/** 네이버 테마 목록 페이지 파싱 */
async function fetchThemeList(): Promise<NaverTheme[]> {
  const resp = await fetch('https://finance.naver.com/sise/theme.naver', {
    headers: { 'User-Agent': 'Mozilla/5.0', 'Accept-Language': 'ko-KR' },
  });
  const html = await resp.text();
  const themes: NaverTheme[] = [];

  // 테마 링크 패턴: /sise/sise_group_detail.naver?type=theme&no=XXX
  const linkRe = /sise_group_detail\.naver\?type=theme&no=(\d+)"[^>]*>([^<]+)</g;
  // 등락률 패턴: 테마명 다음에 나오는 등락률 (+X.XX% 또는 -X.XX%)
  // HTML 파싱 한계로 등락률은 별도 방식으로 추출
  const changeRe = /([+-]?\d+\.\d+)%/;

  // 테이블 행 단위로 파싱
  const rowRe = /<tr[^>]*>([\s\S]*?)<\/tr>/g;
  let rowMatch: RegExpExecArray | null;
  while ((rowMatch = rowRe.exec(html)) !== null) {
    const row = rowMatch[1];
    const linkMatch = linkRe.exec(row);
    if (!linkMatch) continue;
    const theme_id = linkMatch[1];
    const theme_name = linkMatch[2].trim();
    const changeMatch = changeRe.exec(row);
    const avg_change_pct = changeMatch ? parseFloat(changeMatch[1]) : 0;
    themes.push({ theme_id, theme_name, avg_change_pct });
  }

  return themes;
}

/** 네이버 테마 상세 페이지에서 종목 목록 파싱 */
async function fetchThemeStocks(theme_id: string): Promise<Omit<NaverThemeStock, 'theme_id'>[]> {
  const url = `https://finance.naver.com/sise/sise_group_detail.naver?type=theme&no=${theme_id}`;
  const resp = await fetch(url, {
    headers: { 'User-Agent': 'Mozilla/5.0', 'Accept-Language': 'ko-KR' },
  });
  const html = await resp.text();
  const stocks: Omit<NaverThemeStock, 'theme_id'>[] = [];

  // 종목 코드 패턴: /item/main.naver?code=XXXXXX
  const rowRe = /<tr[^>]*>([\s\S]*?)<\/tr>/g;
  const codeRe = /code=(\d{6})/;
  const nameRe = /title="([^"]+)"/;
  const changeRe = /([+-]?\d+\.\d+)%/g;

  let rowMatch: RegExpExecArray | null;
  while ((rowMatch = rowRe.exec(html)) !== null) {
    const row = rowMatch[1];
    const codeMatch = codeRe.exec(row);
    if (!codeMatch) continue;
    const symbol = codeMatch[1];
    const nameMatch = nameRe.exec(row);
    const name = nameMatch ? nameMatch[1] : symbol;
    const changes: number[] = [];
    let m: RegExpExecArray | null;
    while ((m = changeRe.exec(row)) !== null) {
      changes.push(parseFloat(m[1]));
    }
    stocks.push({
      symbol,
      name,
      change_pct: changes[0] ?? 0,
      change_5d_pct: changes[1] ?? null,
    });
  }

  return stocks;
}
```

- [ ] **Step 2: 커밋**

```bash
git add .github/scripts/batch/step10-crawl-themes.ts
git commit -m "feat: theme momentum - 네이버 테마 크롤러 + 주도주 판별"
```

---

## Task 7: 배치 인덱스에 크롤러 스텝 추가

**Files:**
- Modify: `.github/scripts/batch/index.ts`

- [ ] **Step 1: 기존 index.ts 열어서 구조 확인 후 수정**

```typescript
// .github/scripts/batch/index.ts 상단 import에 추가:
import { crawlSectors } from './step9-crawl-sectors';
import { crawlThemes } from './step10-crawl-themes';
```

기존 batch 실행 흐름(step1~step8) 끝에 추가:

```typescript
// full 모드일 때만 실행 (장 종료 후 배치)
if (mode === 'full') {
  await crawlSectors(supabase);
  await crawlThemes(supabase);
}
```

> `mode` 변수가 없다면 `process.env.BATCH_MODE`를 확인:
> ```typescript
> const mode = process.env.BATCH_MODE ?? 'full';
> ```

- [ ] **Step 2: 로컬 타입 체크**

```bash
cd .github/scripts && npx tsc --noEmit
```

Expected: 오류 없음

- [ ] **Step 3: 커밋**

```bash
git add .github/scripts/batch/index.ts
git commit -m "feat: theme momentum - 배치에 섹터/테마 크롤러 스텝 추가"
```

---

## Task 8: 핫 테마 API

**Files:**
- Create: `web/src/app/api/v1/hot-themes/route.ts`

- [ ] **Step 1: API 라우트 작성**

```typescript
// web/src/app/api/v1/hot-themes/route.ts
import { NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/server';

function getTodayKst(): string {
  return new Date(new Date().getTime() + 9 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

export async function GET() {
  const supabase = createServiceClient();
  const today = getTodayKst();

  const { data, error } = await supabase
    .from('stock_themes')
    .select('theme_id, theme_name, avg_change_pct, momentum_score, stock_count, is_hot')
    .eq('date', today)
    .order('momentum_score', { ascending: false })
    .limit(10);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ themes: data ?? [], date: today });
}
```

- [ ] **Step 2: 빌드 확인**

```bash
cd web && npm run build 2>&1 | grep -E "(error|Error)" | head -10
```

Expected: 오류 없음

- [ ] **Step 3: 커밋**

```bash
git add web/src/app/api/v1/hot-themes/route.ts
git commit -m "feat: theme momentum - 핫 테마 API /api/v1/hot-themes"
```

---

## Task 9: ThemeBadges 컴포넌트

**Files:**
- Create: `web/src/components/signals/ThemeBadges.tsx`

- [ ] **Step 1: 컴포넌트 작성**

```tsx
// web/src/components/signals/ThemeBadges.tsx
'use client';

import type { ThemeTag } from '@/types/theme';

interface ThemeBadgesProps {
  theme_tags: ThemeTag[] | null;
  is_leader: boolean;
  is_hot_theme: boolean;
}

export function ThemeBadges({ theme_tags, is_leader, is_hot_theme }: ThemeBadgesProps) {
  const tags = theme_tags ?? [];
  if (tags.length === 0 && !is_leader && !is_hot_theme) return null;

  return (
    <div className="flex flex-wrap gap-1 mt-1">
      {is_leader && (
        <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded text-xs font-medium bg-yellow-500/20 text-yellow-400 border border-yellow-500/30">
          👑 주도주
        </span>
      )}
      {tags.map((tag) => (
        <span
          key={tag.theme_id}
          className={`inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded text-xs font-medium border ${
            tag.is_hot
              ? 'bg-red-500/20 text-red-400 border-red-500/30'
              : 'bg-blue-500/20 text-blue-400 border-blue-500/30'
          }`}
          title={`테마 강도: ${tag.momentum_score.toFixed(0)}`}
        >
          🏷 {tag.theme_name}
          {tag.is_hot && ' 🔥'}
        </span>
      ))}
      {is_hot_theme && (
        <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded text-xs font-medium bg-orange-500/20 text-orange-400 border border-orange-500/30">
          ⚠️ 테마 과열
        </span>
      )}
    </div>
  );
}
```

- [ ] **Step 2: 커밋**

```bash
git add web/src/components/signals/ThemeBadges.tsx
git commit -m "feat: theme momentum - ThemeBadges 컴포넌트"
```

---

## Task 10: HotThemesBanner 컴포넌트

**Files:**
- Create: `web/src/components/signals/HotThemesBanner.tsx`

- [ ] **Step 1: 컴포넌트 작성**

```tsx
// web/src/components/signals/HotThemesBanner.tsx
'use client';

import { useEffect, useState } from 'react';

interface HotTheme {
  theme_id: string;
  theme_name: string;
  avg_change_pct: number | null;
  momentum_score: number | null;
  is_hot: boolean;
}

export function HotThemesBanner() {
  const [themes, setThemes] = useState<HotTheme[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch('/api/v1/hot-themes')
      .then((r) => r.json())
      .then((data) => setThemes(data.themes ?? []))
      .catch(console.error)
      .finally(() => setLoading(false));
  }, []);

  if (loading) return null;
  if (themes.length === 0) return null;

  return (
    <div className="rounded-lg border border-orange-500/30 bg-orange-500/10 px-4 py-2.5 mb-4">
      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-sm font-semibold text-orange-400 whitespace-nowrap">
          🔥 오늘의 핫 테마
        </span>
        <div className="flex gap-3 flex-wrap">
          {themes.slice(0, 5).map((t, i) => {
            const pct = t.avg_change_pct ?? 0;
            const isPos = pct >= 0;
            return (
              <span key={t.theme_id} className="text-sm whitespace-nowrap">
                <span className="text-zinc-400">{i + 1}위</span>{' '}
                <span className="text-zinc-200">{t.theme_name}</span>{' '}
                <span className={isPos ? 'text-red-400' : 'text-blue-400'}>
                  {isPos ? '+' : ''}{pct.toFixed(2)}%
                </span>
              </span>
            );
          })}
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: 커밋**

```bash
git add web/src/components/signals/HotThemesBanner.tsx
git commit -m "feat: theme momentum - HotThemesBanner 컴포넌트"
```

---

## Task 11: AiRecommendationSection에 테마 배지 추가

**Files:**
- Modify: `web/src/components/signals/AiRecommendationSection.tsx`

- [ ] **Step 1: ThemeBadges import 추가 및 렌더링**

파일 상단에 추가:

```typescript
import { ThemeBadges } from './ThemeBadges';
```

추천 카드 내 배지 행(기존 `⚡ 동반매수`, `🔥 거래량폭발` 등이 있는 곳) 바로 아래에 추가:

```tsx
<ThemeBadges
  theme_tags={rec.theme_tags ?? null}
  is_leader={rec.is_leader ?? false}
  is_hot_theme={rec.is_hot_theme ?? false}
/>
```

`rec` 객체의 타입(`AiRecommendation`)에 신규 필드가 없다면 `web/src/types/ai-recommendation.ts`에 추가:

```typescript
// web/src/types/ai-recommendation.ts 의 AiRecommendation 인터페이스에 추가:
theme_tags?: import('./theme').ThemeTag[] | null;
is_leader?: boolean | null;
is_hot_theme?: boolean | null;
```

- [ ] **Step 2: 빌드 확인**

```bash
cd web && npm run build 2>&1 | grep -E "(error|Error)" | head -10
```

- [ ] **Step 3: 커밋**

```bash
git add web/src/components/signals/AiRecommendationSection.tsx \
        web/src/types/ai-recommendation.ts
git commit -m "feat: theme momentum - AI추천 카드에 테마 배지 추가"
```

---

## Task 12: ShortTermRecommendationSection에 테마 배지 추가

**Files:**
- Modify: `web/src/components/signals/ShortTermRecommendationSection.tsx`

- [ ] **Step 1: ThemeBadges 추가**

AiRecommendationSection과 동일한 방식으로:

```typescript
import { ThemeBadges } from './ThemeBadges';
```

초단기 추천 카드의 배지 영역 아래에:

```tsx
<ThemeBadges
  theme_tags={rec.theme_tags ?? null}
  is_leader={rec.is_leader ?? false}
  is_hot_theme={rec.is_hot_theme ?? false}
/>
```

- [ ] **Step 2: 빌드 확인**

```bash
cd web && npm run build 2>&1 | grep -E "(error|Error)" | head -10
```

- [ ] **Step 3: 커밋**

```bash
git add web/src/components/signals/ShortTermRecommendationSection.tsx
git commit -m "feat: theme momentum - 초단기 추천 카드에 테마 배지 추가"
```

---

## Task 13: 신호 페이지에 배너 + 테마 필터 추가

**Files:**
- Modify: `web/src/app/signals/page.tsx`

- [ ] **Step 1: HotThemesBanner 추가**

파일 상단에 추가:

```typescript
import { HotThemesBanner } from '@/components/signals/HotThemesBanner';
```

AI 추천 섹션 위에 배너 삽입:

```tsx
<HotThemesBanner />
<AiRecommendationSection ... />
```

- [ ] **Step 2: 테마 필터 상태 추가**

```typescript
const [themeFilter, setThemeFilter] = useState<string>('all');
const [leaderOnly, setLeaderOnly] = useState(false);
```

기존 소스 필터 옆에 UI 추가:

```tsx
{/* 테마 필터 */}
<select
  value={themeFilter}
  onChange={(e) => setThemeFilter(e.target.value)}
  className="rounded border border-zinc-700 bg-zinc-800 px-2 py-1 text-sm text-zinc-200"
>
  <option value="all">전체 테마</option>
  {hotThemes.map((t) => (
    <option key={t.theme_id} value={t.theme_id}>
      {t.theme_name}
    </option>
  ))}
</select>

{/* 주도주 필터 토글 */}
<button
  onClick={() => setLeaderOnly((v) => !v)}
  className={`rounded px-2 py-1 text-sm border ${
    leaderOnly
      ? 'bg-yellow-500/20 text-yellow-400 border-yellow-500/40'
      : 'bg-zinc-800 text-zinc-400 border-zinc-700'
  }`}
>
  👑 주도주만
</button>
```

`hotThemes` 상태는 `/api/v1/hot-themes` 응답 재활용:

```typescript
const [hotThemes, setHotThemes] = useState<Array<{ theme_id: string; theme_name: string }>>([]);
useEffect(() => {
  fetch('/api/v1/hot-themes')
    .then((r) => r.json())
    .then((d) => setHotThemes(d.themes ?? []));
}, []);
```

추천 목록 필터링:

```typescript
const filteredRecs = recommendations.filter((rec) => {
  if (leaderOnly && !rec.is_leader) return false;
  if (themeFilter !== 'all') {
    const tags = rec.theme_tags ?? [];
    if (!tags.some((t) => t.theme_id === themeFilter)) return false;
  }
  return true;
});
```

- [ ] **Step 2: 빌드 + 린트 확인**

```bash
cd web && npm run build && npm run lint 2>&1 | tail -20
```

Expected: 오류 없음

- [ ] **Step 3: 커밋**

```bash
git add web/src/app/signals/page.tsx
git commit -m "feat: theme momentum - 신호 페이지에 핫 테마 배너 + 테마/주도주 필터 추가"
```

---

## 셀프리뷰

**스펙 커버리지 체크:**
- ✅ 테마-종목 매핑 일 1회 갱신 → Task 5~7
- ✅ KRX 업종(상위) + 네이버 테마(하위) 2계층 → Task 5, 6
- ✅ 테마 강도 정규화 0~100 → Task 6 (min-max 정규화)
- ✅ 주도주 복합 판별 (3개 중 2개 이상) → Task 6
- ✅ 수급 점수에 테마 강도 보너스 최대 +10 → Task 3, 4
- ✅ 주도주 → 수급 +5, 추세 +3 → Task 3, 4
- ✅ 과열 테마 → 리스크 -5 → Task 3, 4
- ✅ 테마 태그 UI (강도 순 최대 2개) → Task 9
- ✅ 주도주 배지 → Task 9
- ✅ 과열 경고 → Task 9
- ✅ 핫 테마 현황 배너 → Task 10, 13
- ✅ 테마 필터 + 주도주 필터 → Task 13
- ✅ KRX 업종은 UI 필터/그룹핑 용도만 (점수 미반영) → Task 5에서 stock_sectors만 저장, 점수 로직에 미포함

**타입 일관성:**
- `ThemeTag` → Task 2 정의, Task 3·9·11·12에서 사용
- `ThemeBonusInput.themes[].theme_id` → Task 4 `symbolThemeMap`에서 동일 필드 사용
- `rec.theme_tags` → Task 4 저장, Task 11·12 렌더링에서 동일 필드명

**플레이스홀더:**
- Task 5 KRX API 필드명: 실제 응답 확인 후 조정 필요 (명시적으로 안내됨)
- 나머지 TBD 없음
