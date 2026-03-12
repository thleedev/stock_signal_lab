# AI신호 날짜조회 + 일간리포트 AI분석 강화 + 시황탭 수정 Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** AI신호 탭에 과거 날짜 조회를 추가하고, 일간 리포트를 30년차 애널리스트 수준 AI 분석으로 강화하며, 투자시황 탭의 정규화 버그를 수정한다.

**Architecture:** 기존 Next.js App Router + Supabase 구조를 유지하며 확장. AI 프로바이더 추상화 레이어 추가, KIS OpenAPI로 매매동향 수집, DateSelector 공용 컴포넌트로 날짜 선택 통일.

**Tech Stack:** Next.js 16, React 19, TypeScript, Supabase (PostgreSQL), Gemini 2.0 Flash, KIS OpenAPI, Yahoo Finance (yahoo-finance2), Tailwind CSS v4

**Spec:** `docs/superpowers/specs/2026-03-12-ai-signal-daily-report-design.md`

---

## File Structure

### New Files
| Path | Responsibility |
|------|---------------|
| `web/src/components/common/date-selector.tsx` | 7일 빠른 선택 + 달력 피커 공용 컴포넌트 |
| `web/src/lib/ai/types.ts` | AIProvider 인터페이스 및 타입 정의 |
| `web/src/lib/ai/gemini.ts` | Gemini API 구현체 |
| `web/src/lib/ai/index.ts` | AI 프로바이더 팩토리 |
| `web/src/lib/kis/investor-trends.ts` | KIS API 투자자별 매매동향 조회 |
| `web/src/lib/kis/fallback-scraper.ts` | 네이버 금융 매매동향 폴백 |

### Modified Files
| Path | Changes |
|------|---------|
| `web/src/types/market.ts` | KR_3Y Yahoo 티커 추가, 절대 범위 상수 추가 |
| `web/src/app/api/v1/cron/market-indicators/route.ts` | 히스토리 백필, 정규화 수정 |
| `web/src/lib/market-score.ts` | 단일 데이터 포인트 폴백 정규화 |
| `web/src/app/signals/page.tsx` | date 파라미터, DateSelector, ISR 전략 |
| `web/src/app/signals/signal-columns.tsx` | isToday prop, 가격 상세 표시 |
| `web/src/app/reports/page.tsx` | 구조화된 리포트 UI, 매매동향 시각화, DateSelector |
| `web/src/app/api/v1/cron/daily-report/route.ts` | AI 프로바이더 사용, 7섹션 프롬프트, 매매동향 포함 |
| `web/src/lib/kis-api.ts` | 투자자별 매매동향 함수 추가 |

### DB Migrations
| Migration | Changes |
|-----------|---------|
| `supabase/migrations/XXX_investor_trends.sql` | `investor_trends` 테이블 생성 |
| `supabase/migrations/XXX_report_sections.sql` | `daily_report_summary.ai_report_sections JSONB` 추가 |

---

## Chunk 1: 투자시황 탭 수정 (Market Tab Fix)

### Task 1: KR_3Y 티커 추가 및 절대 범위 상수 정의

**Files:**
- Modify: `web/src/types/market.ts`

- [ ] **Step 1: KR_3Y Yahoo 티커 추가 및 절대 범위 상수 정의**

`YAHOO_TICKERS`에 KR_3Y 추가하고, 단일 데이터 포인트일 때 사용할 절대 범위 정의:

```typescript
// YAHOO_TICKERS에 추가
KR_3Y: '148070.KS', // KOSEF 국고채3년 ETF (대안: 직접 입력)

// 파일 하단에 절대 범위 상수 추가
export const ABSOLUTE_RANGES: Record<string, { min: number; max: number }> = {
  VIX: { min: 10, max: 50 },
  USD_KRW: { min: 1100, max: 1500 },
  US_10Y: { min: 1.0, max: 5.5 },
  WTI: { min: 40, max: 130 },
  KOSPI: { min: 1800, max: 3200 },
  KOSDAQ: { min: 500, max: 1100 },
  GOLD: { min: 1600, max: 2500 },
  DXY: { min: 90, max: 115 },
  KR_3Y: { min: 1.0, max: 5.0 },
  KORU: { min: 5, max: 30 },
  EWY: { min: 40, max: 80 },
  FEAR_GREED: { min: 0, max: 100 },
};
```

- [ ] **Step 2: Commit**

```bash
git add web/src/types/market.ts
git commit -m "fix: KR_3Y 티커 추가 및 절대 범위 상수 정의"
```

### Task 2: 정규화 폴백 로직 수정

**Files:**
- Modify: `web/src/lib/market-score.ts`

- [ ] **Step 1: calculateMarketScore 함수에서 절대 범위 폴백 적용**

`indicatorData`에서 min90d === max90d인 경우 `ABSOLUTE_RANGES`를 사용하도록 수정:

```typescript
import { ABSOLUTE_RANGES } from '@/types/market';

// calculateMarketScore 함수 내 정규화 로직 수정
// 기존: min90d === max90d이면 normalized = 50
// 변경: ABSOLUTE_RANGES 폴백 사용
let min = data.min90d;
let max = data.max90d;
if (min === max) {
  const abs = ABSOLUTE_RANGES[type];
  if (abs) {
    min = abs.min;
    max = abs.max;
  } else {
    // 범위를 알 수 없으면 50 유지
    breakdown[type] = { normalized: 50, weight: w.weight, ... };
    continue;
  }
}
```

- [ ] **Step 2: market-client.tsx의 합성 정규화도 동일하게 수정**

```typescript
// latestBreakdown useMemo 내 수정
if (!range || range.max === range.min) {
  const abs = ABSOLUTE_RANGES[ind.indicator_type];
  if (abs) {
    const raw = ((ind.value - abs.min) / (abs.max - abs.min)) * 100;
    const clamped = Math.max(0, Math.min(100, raw));
    normalized = dir === -1 ? 100 - clamped : clamped;
  } else {
    normalized = 50;
  }
}
```

- [ ] **Step 3: Commit**

```bash
git add web/src/lib/market-score.ts web/src/components/market/market-client.tsx
git commit -m "fix: 단일 데이터 포인트 정규화 절대 범위 폴백 적용"
```

### Task 3: Cron 히스토리 백필 기능 추가

**Files:**
- Modify: `web/src/app/api/v1/cron/market-indicators/route.ts`

- [ ] **Step 1: 최초 실행 시 90일 히스토리컬 데이터 자동 백필**

cron POST 핸들러에 백필 로직 추가. `market_indicators`에 해당 타입의 기존 데이터가 3일 미만이면 yahoo-finance2의 `historical` API로 90일 데이터 채움:

```typescript
// Step 1.5: 히스토리 데이터가 부족하면 백필
const { data: existingCounts } = await supabase
  .from('market_indicators')
  .select('indicator_type')
  .gte('date', sinceDate);

const countByType: Record<string, number> = {};
for (const row of existingCounts || []) {
  countByType[row.indicator_type] = (countByType[row.indicator_type] || 0) + 1;
}

const needsBackfill = resultTypes.filter(type => (countByType[type] || 0) < 3);

if (needsBackfill.length > 0) {
  const { getHistorical } = await import('@/lib/yahoo-finance');
  const backfillResults = await Promise.allSettled(
    needsBackfill.map(async (type) => {
      const ticker = YAHOO_TICKERS[type as keyof typeof YAHOO_TICKERS];
      if (!ticker) return { type, data: [] };
      const history = await getHistorical(ticker, 90);
      return { type, data: history };
    })
  );

  const backfillRows: Array<Record<string, unknown>> = [];
  for (const r of backfillResults) {
    if (r.status !== 'fulfilled') continue;
    const { type, data } = r.value;
    for (const d of data) {
      backfillRows.push({
        date: d.date,
        indicator_type: type,
        value: d.close,
        raw_data: { source: 'backfill' },
      });
    }
  }

  if (backfillRows.length > 0) {
    await supabase.from('market_indicators')
      .upsert(backfillRows, { onConflict: 'date,indicator_type', ignoreDuplicates: true });
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add web/src/app/api/v1/cron/market-indicators/route.ts
git commit -m "fix: cron 최초 실행 시 90일 히스토리 자동 백필"
```

### Task 4: 브라우저에서 시황 탭 확인

- [ ] **Step 1: Cron API 수동 호출로 데이터 채우기**

```bash
curl -X POST http://localhost:3000/api/v1/cron/market-indicators \
  -H "Authorization: Bearer $CRON_SECRET"
```

- [ ] **Step 2: /market 페이지 새로고침 후 점수가 50이 아닌 실제 값으로 표시되는지 확인**

- [ ] **Step 3: KR_3Y 지표가 표시되는지 확인**

---

## Chunk 2: DateSelector 공용 컴포넌트 + AI신호 날짜 조회

### Task 5: DateSelector 컴포넌트 생성

**Files:**
- Create: `web/src/components/common/date-selector.tsx`

- [ ] **Step 1: DateSelector 클라이언트 컴포넌트 구현**

```typescript
"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Calendar, ChevronLeft, ChevronRight } from "lucide-react";

interface DateSelectorProps {
  selectedDate: string;      // YYYY-MM-DD
  basePath: string;          // "/signals" or "/reports"
  quickDays?: number;        // 기본 7
  preserveParams?: Record<string, string>; // source 등 기존 파라미터 보존
}

export default function DateSelector({
  selectedDate,
  basePath,
  quickDays = 7,
  preserveParams = {},
}: DateSelectorProps) {
  const router = useRouter();
  const [showCalendar, setShowCalendar] = useState(false);

  // KST 기준 오늘
  const now = new Date();
  const kst = new Date(now.getTime() + 9 * 60 * 60 * 1000);
  const today = kst.toISOString().slice(0, 10);

  // 최근 N일 생성
  const recentDays: string[] = [];
  for (let i = 0; i < quickDays; i++) {
    const d = new Date(kst.getTime() - i * 86400000);
    recentDays.push(d.toISOString().slice(0, 10));
  }

  // URL 생성 헬퍼
  const buildUrl = (date: string) => {
    const params = new URLSearchParams(preserveParams);
    if (date !== today) params.set("date", date);
    const qs = params.toString();
    return qs ? `${basePath}?${qs}` : basePath;
  };

  // 날짜 라벨
  const formatLabel = (dateStr: string) => {
    const [, m, d] = dateStr.split("-");
    const date = new Date(dateStr + "T00:00:00+09:00");
    const weekday = ["일", "월", "화", "수", "목", "금", "토"][date.getDay()];
    if (dateStr === today) return `오늘(${weekday})`;
    return `${parseInt(m)}/${parseInt(d)}(${weekday})`;
  };

  // 달력에서 날짜 선택
  const handleCalendarSelect = (dateStr: string) => {
    setShowCalendar(false);
    router.push(buildUrl(dateStr));
  };

  // 간단한 월 달력 컴포넌트
  const [calendarMonth, setCalendarMonth] = useState(() => {
    const d = new Date(selectedDate + "T00:00:00");
    return { year: d.getFullYear(), month: d.getMonth() };
  });

  const renderCalendar = () => {
    const { year, month } = calendarMonth;
    const firstDay = new Date(year, month, 1).getDay();
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const monthLabel = `${year}년 ${month + 1}월`;

    // 90일 전 제한
    const minDate = new Date(kst.getTime() - 90 * 86400000).toISOString().slice(0, 10);

    const cells: React.ReactNode[] = [];
    // 빈 셀
    for (let i = 0; i < firstDay; i++) {
      cells.push(<div key={`empty-${i}`} />);
    }
    // 날짜 셀
    for (let d = 1; d <= daysInMonth; d++) {
      const dateStr = `${year}-${String(month + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
      const isFuture = dateStr > today;
      const isTooOld = dateStr < minDate;
      const isSelected = dateStr === selectedDate;
      const isDisabled = isFuture || isTooOld;

      cells.push(
        <button
          key={dateStr}
          disabled={isDisabled}
          onClick={() => handleCalendarSelect(dateStr)}
          className={`p-2 text-sm rounded-lg transition-colors ${
            isSelected
              ? "bg-[var(--accent)] text-white"
              : isDisabled
                ? "text-[var(--muted)]/30 cursor-not-allowed"
                : "text-[var(--foreground)] hover:bg-[var(--card-hover)] cursor-pointer"
          }`}
        >
          {d}
        </button>
      );
    }

    return (
      <div className="absolute top-full mt-2 z-50 bg-[var(--card)] border border-[var(--border)] rounded-xl p-4 shadow-xl w-[300px]">
        <div className="flex items-center justify-between mb-3">
          <button
            onClick={() => setCalendarMonth(prev => {
              const d = new Date(prev.year, prev.month - 1, 1);
              return { year: d.getFullYear(), month: d.getMonth() };
            })}
            className="p-1 rounded hover:bg-[var(--card-hover)] cursor-pointer"
          >
            <ChevronLeft className="w-4 h-4" />
          </button>
          <span className="text-sm font-medium">{monthLabel}</span>
          <button
            onClick={() => setCalendarMonth(prev => {
              const d = new Date(prev.year, prev.month + 1, 1);
              return { year: d.getFullYear(), month: d.getMonth() };
            })}
            className="p-1 rounded hover:bg-[var(--card-hover)] cursor-pointer"
          >
            <ChevronRight className="w-4 h-4" />
          </button>
        </div>
        <div className="grid grid-cols-7 gap-1 text-center">
          {["일", "월", "화", "수", "목", "금", "토"].map(d => (
            <div key={d} className="text-xs text-[var(--muted)] py-1">{d}</div>
          ))}
          {cells}
        </div>
      </div>
    );
  };

  return (
    <div className="relative">
      <div className="flex gap-2 flex-wrap items-center">
        {recentDays.map((date) => (
          <button
            key={date}
            onClick={() => router.push(buildUrl(date))}
            className={`px-4 py-2 rounded-lg text-sm font-medium border transition-colors cursor-pointer ${
              selectedDate === date
                ? "bg-[var(--accent)] text-white border-[var(--accent)]"
                : "bg-[var(--card)] text-[var(--muted)] border-[var(--border)] hover:bg-[var(--card-hover)]"
            }`}
          >
            {formatLabel(date)}
          </button>
        ))}
        <button
          onClick={() => setShowCalendar(!showCalendar)}
          className={`p-2 rounded-lg border transition-colors cursor-pointer ${
            showCalendar
              ? "bg-[var(--accent)] text-white border-[var(--accent)]"
              : "bg-[var(--card)] text-[var(--muted)] border-[var(--border)] hover:bg-[var(--card-hover)]"
          }`}
          title="달력으로 날짜 선택"
        >
          <Calendar className="w-4 h-4" />
        </button>
      </div>
      {showCalendar && renderCalendar()}
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add web/src/components/common/date-selector.tsx
git commit -m "feat: DateSelector 공용 컴포넌트 (7일 버튼 + 달력 피커)"
```

### Task 6: AI신호 페이지에 날짜 조회 추가

**Files:**
- Modify: `web/src/app/signals/page.tsx`
- Modify: `web/src/app/signals/signal-columns.tsx`

- [ ] **Step 1: page.tsx에 date 파라미터 및 DateSelector 적용**

주요 변경:
- `searchParams`에 `date` 추가
- 날짜 기반 쿼리로 변경
- DateSelector 컴포넌트 렌더링
- 소스 탭 링크에 date 보존
- `isToday` prop을 SignalColumns에 전달

- [ ] **Step 2: signal-columns.tsx에 isToday prop 추가**

- `isToday: boolean` prop 추가
- 자동 새로고침 useEffect에서 `isToday`가 true일 때만 `router.refresh()` 호출

- [ ] **Step 3: signal-columns.tsx 가격 상세 표시 강화**

SignalCard에서 `raw_data`의 소스별 추가 가격 정보 표시:
- Quant: `buy_price`, `stop_loss_price`, `return_pct`
- Stockbot: `recommend_price`, `buy_range`, `target_price`

- [ ] **Step 4: Commit**

```bash
git add web/src/app/signals/page.tsx web/src/app/signals/signal-columns.tsx
git commit -m "feat: AI신호 탭 과거 날짜 조회 + 가격 상세 표시"
```

### Task 7: 브라우저에서 신호 탭 확인

- [ ] **Step 1: /signals 페이지에서 날짜 선택 UI 표시 확인**
- [ ] **Step 2: 과거 날짜 클릭 시 해당 날짜 신호 로드 확인**
- [ ] **Step 3: 소스 탭 전환 시 date 파라미터 유지 확인**
- [ ] **Step 4: 달력 피커 열고 과거 날짜 선택 가능 확인**

---

## Chunk 3: AI 프로바이더 추상화 + KIS 매매동향

### Task 8: AI 프로바이더 추상화 레이어

**Files:**
- Create: `web/src/lib/ai/types.ts`
- Create: `web/src/lib/ai/gemini.ts`
- Create: `web/src/lib/ai/index.ts`

- [ ] **Step 1: types.ts — 인터페이스 정의**

```typescript
export interface GenerateOptions {
  temperature?: number;
  maxTokens?: number;
}

export interface AIProvider {
  name: string;
  generateText(prompt: string, options?: GenerateOptions): Promise<string>;
}
```

- [ ] **Step 2: gemini.ts — Gemini 구현체**

기존 `daily-report/route.ts`의 Gemini 호출 로직을 이관:

```typescript
import type { AIProvider, GenerateOptions } from './types';

export class GeminiProvider implements AIProvider {
  name = 'gemini';
  private apiKey: string;

  constructor(apiKey: string) {
    this.apiKey = apiKey;
  }

  async generateText(prompt: string, options?: GenerateOptions): Promise<string> {
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${this.apiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: {
            temperature: options?.temperature ?? 0.5,
            maxOutputTokens: options?.maxTokens ?? 4096,
          },
        }),
      }
    );

    if (!response.ok) {
      throw new Error(`Gemini API error: ${response.status}`);
    }

    const data = await response.json();
    const text = data?.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!text) throw new Error('Gemini 응답에 텍스트 없음');
    return text;
  }
}
```

- [ ] **Step 3: index.ts — 팩토리 함수**

```typescript
import type { AIProvider } from './types';
import { GeminiProvider } from './gemini';

export function getAIProvider(name: string = 'gemini'): AIProvider {
  switch (name) {
    case 'gemini': {
      const apiKey = process.env.GEMINI_API_KEY;
      if (!apiKey) throw new Error('GEMINI_API_KEY 환경변수가 설정되지 않았습니다');
      return new GeminiProvider(apiKey);
    }
    default:
      throw new Error(`지원하지 않는 AI 프로바이더: ${name}`);
  }
}

export type { AIProvider, GenerateOptions } from './types';
```

- [ ] **Step 4: Commit**

```bash
git add web/src/lib/ai/
git commit -m "feat: AI 프로바이더 추상화 레이어 (Gemini 구현)"
```

### Task 9: KIS API 투자자별 매매동향 함수

**Files:**
- Modify: `web/src/lib/kis-api.ts`
- Create: `web/src/lib/kis/investor-trends.ts`
- Create: `web/src/lib/kis/fallback-scraper.ts`

- [ ] **Step 1: investor-trends.ts — KIS API 래퍼**

기존 `kis-api.ts`의 토큰 발급 로직을 재사용하여 투자자별 매매동향 조회:

```typescript
import { getKisToken } from '@/lib/kis-api';

interface InvestorTrendData {
  market: string;            // KOSPI, KOSDAQ
  investor_type: string;     // foreign, institution, individual
  buy_amount: number;
  sell_amount: number;
  net_amount: number;
}

export async function fetchInvestorTrends(date: string): Promise<InvestorTrendData[]> {
  // KIS API: 투자자별 매매동향 (FHKST03010100)
  // 실패 시 빈 배열 반환
}
```

- [ ] **Step 2: fallback-scraper.ts — 네이버 폴백**

```typescript
export async function fetchInvestorTrendsFromNaver(date: string): Promise<InvestorTrendData[]> {
  // 네이버 금융 모바일 API에서 투자자별 매매동향 조회
  // 실패 시 빈 배열 반환
}
```

- [ ] **Step 3: Commit**

```bash
git add web/src/lib/kis/
git commit -m "feat: KIS API 투자자별 매매동향 + 네이버 폴백"
```

### Task 10: DB 마이그레이션

**Files:**
- Create: `supabase/migrations/030_investor_trends.sql`
- Create: `supabase/migrations/031_report_sections.sql`

- [ ] **Step 1: investor_trends 테이블 생성**

```sql
CREATE TABLE IF NOT EXISTS investor_trends (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  date DATE NOT NULL,
  market VARCHAR(10),
  investor_type VARCHAR(20),
  buy_amount BIGINT,
  sell_amount BIGINT,
  net_amount BIGINT,
  top_buy_stocks JSONB,
  top_sell_stocks JSONB,
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(date, market, investor_type)
);
```

- [ ] **Step 2: daily_report_summary에 ai_report_sections 컬럼 추가**

```sql
ALTER TABLE daily_report_summary
  ADD COLUMN IF NOT EXISTS ai_report_sections JSONB;
```

- [ ] **Step 3: Supabase에 마이그레이션 적용**

```bash
# Supabase 대시보드 SQL Editor에서 직접 실행하거나:
npx supabase db push
```

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/
git commit -m "feat: investor_trends 테이블 + ai_report_sections 컬럼"
```

---

## Chunk 4: 일간 리포트 강화

### Task 11: daily-report cron 강화

**Files:**
- Modify: `web/src/app/api/v1/cron/daily-report/route.ts`

- [ ] **Step 1: maxDuration 설정 및 AI 프로바이더 사용**

```typescript
export const maxDuration = 120;

// 기존 generateAiSummary 함수 → getAIProvider() 사용으로 교체
import { getAIProvider } from '@/lib/ai';
```

- [ ] **Step 2: 매매동향 데이터 수집 로직 추가**

cron 실행 순서에 KIS API 매매동향 수집 → investor_trends 저장 추가.

- [ ] **Step 3: 7섹션 프롬프트로 강화**

30년차 애널리스트 페르소나, 7섹션 상세 리포트 프롬프트:
1. 시장 종합 진단
2. AI 매매신호 분석
3. 주목 종목 상세
4. 투자자별 매매동향
5. 업종 동향
6. 리스크 점검
7. 애널리스트 종합 의견

- [ ] **Step 4: AI 응답 파싱 → ai_report_sections JSONB 저장**

`## 섹션제목` 기준으로 파싱하여 구조화. `ai_summary`에도 전체 텍스트 병렬 저장.

- [ ] **Step 5: Commit**

```bash
git add web/src/app/api/v1/cron/daily-report/route.ts
git commit -m "feat: 일간 리포트 7섹션 AI 분석 강화 (30년차 애널리스트)"
```

### Task 12: 리포트 페이지 UI 리뉴얼

**Files:**
- Modify: `web/src/app/reports/page.tsx`

- [ ] **Step 1: DateSelector 적용 (기존 7일 버튼 교체)**

- [ ] **Step 2: AI 리포트 섹션별 접이식 카드 UI**

`ai_report_sections` JSONB에서 섹션 읽어서 collapsible 카드로 표시.
`ai_report_sections`가 없는 과거 리포트는 기존 `ai_summary` 텍스트 폴백.

- [ ] **Step 3: 매매동향 시각화 섹션 추가**

`investor_trends` 테이블에서 해당 날짜 데이터 조회.
외국인/기관/개인 순매수·순매도 금액 막대로 시각화.

- [ ] **Step 4: Commit**

```bash
git add web/src/app/reports/page.tsx
git commit -m "feat: 리포트 페이지 UI 리뉴얼 (접이식 섹션, 매매동향)"
```

---

## Chunk 5: 통합 테스트 및 수정

### Task 13: 브라우저 통합 테스트

- [ ] **Step 1: /market 페이지 확인**
  - 지표 점수가 50이 아닌 실제 값인지 확인
  - KR_3Y 표시 확인
  - 30일 히스토리 차트 확인

- [ ] **Step 2: /signals 페이지 확인**
  - 날짜 선택기 표시 확인
  - 과거 날짜 선택 → 해당 날짜 신호 로드
  - 소스 탭 전환 시 date 유지
  - 달력 피커 동작
  - 가격 정보 상세 표시

- [ ] **Step 3: /reports 페이지 확인**
  - DateSelector 동작
  - 접이식 섹션 카드 (리포트가 있는 날짜)
  - 매매동향 시각화 (데이터가 있는 날짜)
  - 기존 ai_summary 폴백 표시

- [ ] **Step 4: Cron 수동 실행 테스트**

```bash
# 일간 리포트 cron
curl -X POST http://localhost:3000/api/v1/cron/daily-report \
  -H "Authorization: Bearer $CRON_SECRET"
```
  - 7섹션 리포트 생성 확인
  - ai_report_sections JSONB 저장 확인
  - /reports 페이지에서 새 리포트 확인

- [ ] **Step 5: 발견된 이슈 수정 및 최종 커밋**
