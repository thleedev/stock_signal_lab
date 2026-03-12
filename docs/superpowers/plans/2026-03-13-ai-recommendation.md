# AI 추천 기능 구현 계획

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `/signals` 페이지 상단에 오늘의 BUY 신호 종목을 규칙 기반 100점 만점으로 평가해 상위 N종목을 추천하는 "오늘의 AI 추천" 섹션을 추가한다.

**Architecture:** DB 마이그레이션 → 점수 계산 라이브러리(4개 모듈) → API 라우트(GET/POST) → Client Component → signals 페이지 통합 순으로 구현. 기술적 지표는 `daily_prices` DB 데이터만 사용하며 KIS 실시간 API는 호출하지 않는다.

**Tech Stack:** Next.js 16 App Router, TypeScript, Supabase (PostgreSQL), Tailwind CSS, Lucide React

**Spec:** `docs/superpowers/specs/2026-03-13-ai-recommendation-design.md`

---

## 파일 구조

**새로 생성:**
- `supabase/migrations/030_ai_recommendations.sql` — DB 테이블
- `web/src/types/ai-recommendation.ts` — TypeScript 타입
- `web/src/lib/ai-recommendation/index.ts` — 오케스트레이터
- `web/src/lib/ai-recommendation/signal-score.ts` — 신호 강도 점수
- `web/src/lib/ai-recommendation/technical-score.ts` — 기술적 분석 점수
- `web/src/lib/ai-recommendation/valuation-score.ts` — 밸류에이션 점수
- `web/src/lib/ai-recommendation/supply-score.ts` — 수급 점수
- `web/src/app/api/v1/ai-recommendations/route.ts` — GET 엔드포인트
- `web/src/app/api/v1/ai-recommendations/generate/route.ts` — POST 엔드포인트
- `web/src/components/signals/AiRecommendationSection.tsx` — UI 컴포넌트

**수정:**
- `web/src/app/signals/page.tsx` — 섹션 추가

---

## Chunk 1: DB 마이그레이션 + 타입 정의

### Task 1: DB 마이그레이션 생성

**Files:**
- Create: `supabase/migrations/030_ai_recommendations.sql`

- [ ] **Step 1: 마이그레이션 파일 생성**

```sql
-- supabase/migrations/030_ai_recommendations.sql
CREATE TABLE IF NOT EXISTS ai_recommendations (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  date                DATE NOT NULL,
  symbol              VARCHAR(10) NOT NULL,
  name                VARCHAR(100),
  rank                INT NOT NULL,
  total_score         NUMERIC(5,1) NOT NULL,

  -- 가중치 (재계산 시 사용한 값 저장)
  weight_signal       INT NOT NULL DEFAULT 30,
  weight_technical    INT NOT NULL DEFAULT 30,
  weight_valuation    INT NOT NULL DEFAULT 20,
  weight_supply       INT NOT NULL DEFAULT 20,

  -- 항목별 점수 (가중치 적용 전 원점수)
  signal_score        NUMERIC(4,1),
  technical_score     NUMERIC(4,1),
  valuation_score     NUMERIC(4,1),
  supply_score        NUMERIC(4,1),

  -- 기술적 지표 상세
  signal_count        INT,
  rsi                 NUMERIC(5,2),
  macd_cross          BOOLEAN DEFAULT FALSE,
  golden_cross        BOOLEAN DEFAULT FALSE,
  bollinger_bottom    BOOLEAN DEFAULT FALSE,
  phoenix_pattern     BOOLEAN DEFAULT FALSE,
  double_top          BOOLEAN DEFAULT FALSE,
  volume_surge        BOOLEAN DEFAULT FALSE,
  week52_low_near     BOOLEAN DEFAULT FALSE,

  -- 밸류에이션
  per                 NUMERIC(8,2),
  pbr                 NUMERIC(8,2),
  roe                 NUMERIC(8,2),

  -- 수급
  foreign_buying      BOOLEAN DEFAULT FALSE,
  institution_buying  BOOLEAN DEFAULT FALSE,
  volume_vs_sector    BOOLEAN DEFAULT FALSE,

  -- 메타
  total_candidates    INT,
  created_at          TIMESTAMPTZ DEFAULT NOW(),

  UNIQUE(date, symbol)
);

CREATE INDEX IF NOT EXISTS idx_ai_recommendations_date
  ON ai_recommendations(date DESC);
```

- [ ] **Step 2: Supabase에 마이그레이션 적용**

```bash
cd /Users/thlee/GoogleDrive/DashboardStock
npx supabase db push
```

Expected: 오류 없이 완료

---

### Task 2: TypeScript 타입 정의

**Files:**
- Create: `web/src/types/ai-recommendation.ts`

- [ ] **Step 1: 타입 파일 생성**

```typescript
// web/src/types/ai-recommendation.ts

export interface AiRecommendation {
  id: string;
  date: string;                 // YYYY-MM-DD
  symbol: string;
  name: string | null;
  rank: number;
  total_score: number;          // 0~100

  // 가중치 (재계산 시 사용한 값)
  weight_signal: number;        // 기본 30
  weight_technical: number;     // 기본 30
  weight_valuation: number;     // 기본 20
  weight_supply: number;        // 기본 20

  // 항목별 점수 (원점수)
  signal_score: number | null;
  technical_score: number | null;
  valuation_score: number | null;
  supply_score: number | null;

  // 기술적 지표
  signal_count: number | null;
  rsi: number | null;
  macd_cross: boolean;
  golden_cross: boolean;
  bollinger_bottom: boolean;
  phoenix_pattern: boolean;
  double_top: boolean;
  volume_surge: boolean;
  week52_low_near: boolean;

  // 밸류에이션
  per: number | null;
  pbr: number | null;
  roe: number | null;

  // 수급
  foreign_buying: boolean;
  institution_buying: boolean;
  volume_vs_sector: boolean;

  // 메타
  total_candidates: number | null;
  created_at: string;
}

export interface AiRecommendationWeights {
  signal: number;       // 0~100
  technical: number;    // 0~100
  valuation: number;    // 0~100
  supply: number;       // 0~100
}

export const DEFAULT_WEIGHTS: AiRecommendationWeights = {
  signal: 30,
  technical: 30,
  valuation: 20,
  supply: 20,
};

export interface AiRecommendationResponse {
  recommendations: AiRecommendation[];
  generated_at: string;
  total_candidates: number;
  needs_refresh: boolean;
}
```

- [ ] **Step 3: 커밋**

```bash
git add supabase/migrations/030_ai_recommendations.sql web/src/types/ai-recommendation.ts
git commit -m "feat: add ai_recommendations table and TypeScript types"
```

---

## Chunk 2: 점수 계산 모듈

### Task 3: 신호 강도 점수 모듈

**Files:**
- Create: `web/src/lib/ai-recommendation/signal-score.ts`

- [ ] **Step 1: 신호 강도 점수 파일 생성**

```typescript
// web/src/lib/ai-recommendation/signal-score.ts
import { SupabaseClient } from '@supabase/supabase-js';

export interface SignalScoreResult {
  score: number;           // 0~30
  signal_count: number;    // 오늘 신호 소스 개수
  has_today_signal: boolean;
  has_frequent_signal: boolean;
  signal_below_price: boolean;
}

// raw_data JSONB에서 신호가격 추출 (기존 extractSignalPrice 로직과 동일)
function extractSignalPriceFromRaw(rawData: Record<string, unknown> | null): number | null {
  if (!rawData) return null;
  const fields = ['signal_price', 'recommend_price', 'buy_price', 'sell_price', 'price', 'current_price'];
  for (const field of fields) {
    const val = rawData[field] as number | undefined;
    if (val && val > 0) return val;
  }
  return null;
}

export async function calcSignalScore(
  supabase: SupabaseClient,
  symbol: string,
  todayKst: string,          // YYYY-MM-DD
  currentPrice: number | null
): Promise<SignalScoreResult> {
  // 오늘 BUY/BUY_FORECAST 신호 조회
  const startOfDay = `${todayKst}T00:00:00+09:00`;
  const endOfDay = `${todayKst}T23:59:59+09:00`;

  const { data: todaySignals } = await supabase
    .from('signals')
    .select('source, raw_data')
    .eq('symbol', symbol)
    .in('signal_type', ['BUY', 'BUY_FORECAST'])
    .gte('timestamp', startOfDay)
    .lte('timestamp', endOfDay);

  // 최근 30일 신호 빈도 (KST 기준 날짜 경계 사용)
  const nowKst = new Date(new Date().getTime() + 9 * 60 * 60 * 1000);
  const thirtyDaysAgoKst = new Date(nowKst.getTime() - 30 * 24 * 60 * 60 * 1000);
  const thirtyDaysAgoStr = thirtyDaysAgoKst.toISOString().slice(0, 10);
  const { count: recentCount } = await supabase
    .from('signals')
    .select('id', { count: 'exact', head: true })
    .eq('symbol', symbol)
    .in('signal_type', ['BUY', 'BUY_FORECAST'])
    .gte('timestamp', `${thirtyDaysAgoStr}T00:00:00+09:00`);

  const sources = new Set((todaySignals ?? []).map(s => s.source));
  const sourceCount = sources.size;
  const hasTodaySignal = sourceCount > 0;

  // 소스 수에 따른 점수 (상호 배타적)
  let score = 0;
  if (sourceCount >= 3) score += 15;
  else if (sourceCount === 2) score += 10;
  else if (sourceCount === 1) score += 5;

  // 오늘 신호 발생
  if (hasTodaySignal) score += 5;

  // 최근 30일 빈도
  const hasFrequentSignal = (recentCount ?? 0) >= 3;
  if (hasFrequentSignal) score += 5;

  // 신호가격 대비 현재가 (현재가 ≤ 신호가)
  let signalBelowPrice = false;
  if (currentPrice && todaySignals && todaySignals.length > 0) {
    const signalPrice = extractSignalPriceFromRaw(todaySignals[0].raw_data as Record<string, unknown>);
    if (signalPrice && currentPrice <= signalPrice) {
      score += 5;
      signalBelowPrice = true;
    }
  }

  return {
    score: Math.min(score, 30),
    signal_count: sourceCount,
    has_today_signal: hasTodaySignal,
    has_frequent_signal: hasFrequentSignal,
    signal_below_price: signalBelowPrice,
  };
}
```

---

### Task 4: 기술적 분석 점수 모듈

**Files:**
- Create: `web/src/lib/ai-recommendation/technical-score.ts`

- [ ] **Step 1: 기술적 분석 모듈 생성**

```typescript
// web/src/lib/ai-recommendation/technical-score.ts
import { SupabaseClient } from '@supabase/supabase-js';

export interface TechnicalScoreResult {
  score: number;            // 기술적 점수 (-8~30)
  rsi: number | null;
  macd_cross: boolean;
  golden_cross: boolean;
  bollinger_bottom: boolean;
  phoenix_pattern: boolean;
  double_top: boolean;
  volume_surge: boolean;
  week52_low_near: boolean;
  data_insufficient: boolean;
}

// EMA 계산
function calcEMA(closes: number[], period: number): number[] {
  if (closes.length < period) return [];
  const k = 2 / (period + 1);
  const emas: number[] = [closes.slice(0, period).reduce((a, b) => a + b, 0) / period];
  for (let i = period; i < closes.length; i++) {
    emas.push(closes[i] * k + emas[emas.length - 1] * (1 - k));
  }
  return emas;
}

// RSI 계산 (14일)
function calcRSI(closes: number[]): number | null {
  if (closes.length < 15) return null;
  const recent = closes.slice(-15);
  let gains = 0, losses = 0;
  for (let i = 1; i < recent.length; i++) {
    const diff = recent[i] - recent[i - 1];
    if (diff > 0) gains += diff;
    else losses -= diff;
  }
  if (losses === 0) return 100;
  const rs = gains / losses;
  return 100 - 100 / (1 + rs);
}

// 이동평균 배열 계산
function calcSMA(values: number[], period: number): number[] {
  const result: number[] = [];
  for (let i = period - 1; i < values.length; i++) {
    const slice = values.slice(i - period + 1, i + 1);
    result.push(slice.reduce((a, b) => a + b, 0) / period);
  }
  return result;
}

// 볼린저 밴드 하단
function calcBollingerLower(closes: number[], period = 20, stdMultiplier = 2): number | null {
  if (closes.length < period) return null;
  const slice = closes.slice(-period);
  const mean = slice.reduce((a, b) => a + b, 0) / period;
  const variance = slice.reduce((a, b) => a + Math.pow(b - mean, 2), 0) / period;
  return mean - stdMultiplier * Math.sqrt(variance);
}

export async function calcTechnicalScore(
  supabase: SupabaseClient,
  symbol: string,
  high52w: number | null,
  low52w: number | null,
): Promise<TechnicalScoreResult> {
  // 최근 65일 OHLCV 조회 (MACD 26일 + 여유)
  // 최신 65일을 DESC로 가져온 뒤 reverse() → 시간 오름차순 (CRITICAL fix: ASC+limit는 가장 오래된 데이터를 가져옴)
  const { data: pricesDesc } = await supabase
    .from('daily_prices')
    .select('date, open, high, low, close, volume')
    .eq('symbol', symbol)
    .order('date', { ascending: false })
    .limit(65);
  const prices = (pricesDesc ?? []).reverse();

  const empty: TechnicalScoreResult = {
    score: 0, rsi: null, macd_cross: false, golden_cross: false,
    bollinger_bottom: false, phoenix_pattern: false, double_top: false,
    volume_surge: false, week52_low_near: false, data_insufficient: true,
  };

  if (!prices || prices.length < 20) return empty;

  const closes = prices.map(p => p.close);
  const volumes = prices.map(p => p.volume ?? 0);
  const highs = prices.map(p => p.high);
  const lows = prices.map(p => p.low);
  const opens = prices.map(p => p.open);
  const currentPrice = closes[closes.length - 1];

  let score = 0;

  // RSI (14일)
  const rsi = calcRSI(closes);
  const rsiInZone = rsi !== null && rsi >= 30 && rsi <= 50;
  if (rsiInZone) score += 5;

  // 골든크로스: 5일선이 20일선 상향 돌파 (최근 3일 내)
  const sma5 = calcSMA(closes, 5);
  const sma20 = calcSMA(closes, 20);
  let goldenCross = false;
  if (sma5.length >= 4 && sma20.length >= 4) {
    const offset5 = closes.length - sma5.length;
    const offset20 = closes.length - sma20.length;
    // 최근 3일 중 5일선이 20일선을 아래에서 위로 돌파했는지 확인
    for (let i = Math.max(sma5.length - 3, 1); i < sma5.length; i++) {
      const idx5 = i;
      const idx20 = i - (offset20 - offset5);
      if (idx20 >= 1 && idx20 < sma20.length) {
        if (sma5[idx5 - 1] <= sma20[idx20 - 1] && sma5[idx5] > sma20[idx20]) {
          goldenCross = true;
          break;
        }
      }
    }
  }
  if (goldenCross) score += 5;

  // 볼린저 밴드 하단 이탈 후 복귀 (최근 5일 내)
  let bollingerBottom = false;
  if (closes.length >= 25) {
    // 최근 5일 전부터 볼린저 하단 확인
    for (let i = closes.length - 5; i < closes.length - 1; i++) {
      const lower = calcBollingerLower(closes.slice(0, i + 1));
      if (lower !== null && closes[i] < lower && closes[closes.length - 1] >= lower) {
        bollingerBottom = true;
        break;
      }
    }
  }
  if (bollingerBottom) score += 4;

  // MACD 골든크로스 (12/26/9) — 최근 3일 내 발생 여부 확인
  let macdCross = false;
  if (closes.length >= 35) {
    const ema12 = calcEMA(closes, 12);
    const ema26 = calcEMA(closes, 26);
    const offset = ema12.length - ema26.length;
    const macdLine = ema26.map((v, i) => ema12[i + offset] - v);
    const signalLine = calcEMA(macdLine, 9);
    if (macdLine.length >= 4 && signalLine.length >= 4) {
      const mOffset = macdLine.length - signalLine.length;
      // 최근 3개 봉에서 크로스 여부 확인 (설계 문서: 3일 내)
      for (let i = macdLine.length - 3; i < macdLine.length; i++) {
        const si = i - mOffset;
        if (si >= 1 && si < signalLine.length) {
          const prev = macdLine[i - 1] - signalLine[si - 1];
          const curr = macdLine[i] - signalLine[si];
          if (prev <= 0 && curr > 0) { macdCross = true; break; }
        }
      }
    }
  }
  if (macdCross) score += 4;

  // 불새패턴: 최근 5거래일 중 3일 이상 음봉/보합, 마지막 2일 내 +3% 이상 장대 양봉
  let phoenixPattern = false;
  if (closes.length >= 5 && opens.length >= 5) {
    const recentCloses = closes.slice(-5);
    const recentOpens = opens.slice(-5);
    const bearDays = recentCloses.slice(0, 3).filter((c, i) => c <= recentOpens[i]).length;
    // 마지막 2일 내 장대 양봉 확인
    for (let i = 3; i < 5; i++) {
      const body = recentCloses[i] - recentOpens[i];
      const totalRange = highs[closes.length - 5 + i] - lows[closes.length - 5 + i];
      const bodyRatio = totalRange > 0 ? body / totalRange : 0;
      const pctGain = recentOpens[i] > 0 ? (body / recentOpens[i]) * 100 : 0;
      if (bearDays >= 3 && body > 0 && pctGain >= 3 && bodyRatio >= 0.6) {
        phoenixPattern = true;
        break;
      }
    }
  }
  if (phoenixPattern) score += 5;

  // 거래량 급증: 20일 평균 대비 2배 이상
  let volumeSurge = false;
  if (volumes.length >= 21) {
    const avgVol = volumes.slice(-21, -1).reduce((a, b) => a + b, 0) / 20;
    if (avgVol > 0 && volumes[volumes.length - 1] >= avgVol * 2) {
      volumeSurge = true;
    }
  }
  if (volumeSurge) score += 4;

  // 52주 저점 근처 (±5%)
  let week52LowNear = false;
  if (low52w && low52w > 0) {
    const ratio = currentPrice / low52w;
    if (ratio >= 0.95 && ratio <= 1.05) week52LowNear = true;
  }
  if (week52LowNear) score += 3;

  // 쌍봉 패턴: 최근 20거래일 내 두 고점이 ±2% 이내, 사이에 -5% 이상 하락,
  // 현재가가 두 번째 고점의 -3% 이내 (매도 경고 구간에서만 페널티)
  let doubleTup = false;
  if (highs.length >= 20) {
    const recentHighs = highs.slice(-20);
    const recentClosesFull = closes.slice(-20);
    for (let i = 1; i < recentHighs.length - 2; i++) {
      for (let j = i + 2; j < recentHighs.length; j++) {
        const h1 = recentHighs[i], h2 = recentHighs[j];
        const priceDiff = Math.abs(h1 - h2) / Math.max(h1, h2);
        if (priceDiff <= 0.02) {
          const between = recentClosesFull.slice(i, j);
          const minBetween = Math.min(...between);
          const dropRatio = (Math.min(h1, h2) - minBetween) / Math.min(h1, h2);
          // 현재가가 두 번째 고점의 97%~100% 구간 (쌍봉 고점 근처 = 매도 경고)
          const nearSecondPeak = currentPrice >= h2 * 0.97 && currentPrice <= h2 * 1.03;
          if (dropRatio >= 0.05 && nearSecondPeak) {
            doubleTup = true;
            break;
          }
        }
      }
      if (doubleTup) break;
    }
  }
  if (doubleTup) score -= 8;

  return {
    score: Math.max(-8, Math.min(score, 30)),
    rsi,
    macd_cross: macdCross,
    golden_cross: goldenCross,
    bollinger_bottom: bollingerBottom,
    phoenix_pattern: phoenixPattern,
    double_top: doubleTup,
    volume_surge: volumeSurge,
    week52_low_near: week52LowNear,
    data_insufficient: false,
  };
}
```

---

### Task 5: 밸류에이션 점수 모듈

**Files:**
- Create: `web/src/lib/ai-recommendation/valuation-score.ts`

- [ ] **Step 1: 밸류에이션 모듈 생성**

```typescript
// web/src/lib/ai-recommendation/valuation-score.ts

export interface ValuationScoreResult {
  score: number;       // 0~20
  per: number | null;
  pbr: number | null;
  roe: number | null;
}

export function calcValuationScore(
  per: number | null,
  pbr: number | null,
  roe: number | null,
): ValuationScoreResult {
  let score = 0;
  if (pbr !== null && pbr > 0 && pbr < 1.0) score += 7;
  if (per !== null && per > 0 && per < 10) score += 7;
  if (roe !== null && roe > 10) score += 6;
  return { score, per, pbr, roe };
}
```

---

### Task 6: 수급 점수 모듈

**Files:**
- Create: `web/src/lib/ai-recommendation/supply-score.ts`

- [ ] **Step 1: 수급 모듈 생성**

```typescript
// web/src/lib/ai-recommendation/supply-score.ts
// 주의: 섹터별 평균 거래대금은 오케스트레이터에서 사전 집계 후 sectorAvgTurnover로 전달받는다.
// 이 함수는 DB 쿼리를 직접 실행하지 않는다 (N+1 방지).

export interface SupplyScoreResult {
  score: number;
  foreign_buying: boolean;    // KIS 미구현 → 항상 false
  institution_buying: boolean;// KIS 미구현 → 항상 false
  volume_vs_sector: boolean;
}

export function calcSupplyScore(
  currentVolume: number | null,
  currentPrice: number | null,
  sectorAvgTurnover: number | null,  // 오케스트레이터에서 사전 계산
): SupplyScoreResult {
  let score = 0;
  let volumeVsSector = false;

  if (
    currentVolume && currentPrice && sectorAvgTurnover &&
    currentVolume > 0 && currentPrice > 0 && sectorAvgTurnover > 0
  ) {
    const myTurnover = currentVolume * currentPrice;
    if (myTurnover >= sectorAvgTurnover * 2) {
      volumeVsSector = true;
      score += 6;
    }
  }

  return { score, foreign_buying: false, institution_buying: false, volume_vs_sector: volumeVsSector };
}
```

---

### Task 7: 오케스트레이터 (index.ts)

**Files:**
- Create: `web/src/lib/ai-recommendation/index.ts`

- [ ] **Step 1: 오케스트레이터 생성**

```typescript
// web/src/lib/ai-recommendation/index.ts
import { SupabaseClient } from '@supabase/supabase-js';
import { AiRecommendation, AiRecommendationWeights, DEFAULT_WEIGHTS } from '@/types/ai-recommendation';
import { calcSignalScore } from './signal-score';
import { calcTechnicalScore } from './technical-score';
import { calcValuationScore } from './valuation-score';
import { calcSupplyScore } from './supply-score';

// 오늘 날짜 KST (YYYY-MM-DD)
export function getTodayKst(): string {
  const now = new Date();
  const kst = new Date(now.getTime() + 9 * 60 * 60 * 1000);
  return kst.toISOString().slice(0, 10);
}

// 오늘 BUY/BUY_FORECAST 신호 종목 목록 조회
export async function fetchTodayBuySymbols(
  supabase: SupabaseClient,
  todayKst: string
): Promise<{ symbol: string; name: string }[]> {
  const startOfDay = `${todayKst}T00:00:00+09:00`;
  const endOfDay = `${todayKst}T23:59:59+09:00`;

  const { data } = await supabase
    .from('signals')
    .select('symbol, name')
    .in('signal_type', ['BUY', 'BUY_FORECAST'])
    .gte('timestamp', startOfDay)
    .lte('timestamp', endOfDay);

  if (!data) return [];

  // 종목 중복 제거
  const seen = new Set<string>();
  return data.filter(s => {
    if (seen.has(s.symbol)) return false;
    seen.add(s.symbol);
    return true;
  });
}

// 메인 계산 함수
export async function generateRecommendations(
  supabase: SupabaseClient,
  weights: AiRecommendationWeights = DEFAULT_WEIGHTS,
  limit = 5
): Promise<{ recommendations: AiRecommendation[]; total_candidates: number }> {
  const todayKst = getTodayKst();
  const candidates = await fetchTodayBuySymbols(supabase, todayKst);
  const total_candidates = candidates.length;

  if (total_candidates === 0) {
    return { recommendations: [], total_candidates: 0 };
  }

  // stock_cache에서 전체 종목 메타 일괄 조회
  const symbols = candidates.map(c => c.symbol);
  const { data: cacheData } = await supabase
    .from('stock_cache')
    .select('symbol, per, pbr, roe, volume, current_price, high_52w, low_52w')
    .in('symbol', symbols);

  const { data: sectorData } = await supabase
    .from('stock_info')
    .select('symbol, sector')
    .in('symbol', symbols);

  const cacheMap = new Map((cacheData ?? []).map(c => [c.symbol, c]));
  const sectorMap = new Map((sectorData ?? []).map(s => [s.symbol, s.sector as string | null]));

  // 섹터별 평균 거래대금 사전 집계 (N+1 방지: 종목별 쿼리 대신 한 번에 계산)
  // stock_cache 전체에서 volume * current_price를 섹터별로 집계
  const { data: allStocksForSector } = await supabase
    .from('stock_cache')
    .select('symbol, volume, current_price');
  const { data: allSectorInfo } = await supabase
    .from('stock_info')
    .select('symbol, sector');

  const symbolSectorMap = new Map((allSectorInfo ?? []).map(s => [s.symbol, s.sector as string | null]));
  const sectorTurnoverMap = new Map<string, number[]>();
  for (const stock of (allStocksForSector ?? [])) {
    const sec = symbolSectorMap.get(stock.symbol);
    if (!sec) continue;
    const turnover = (stock.volume ?? 0) * (stock.current_price ?? 0);
    if (turnover > 0) {
      if (!sectorTurnoverMap.has(sec)) sectorTurnoverMap.set(sec, []);
      sectorTurnoverMap.get(sec)!.push(turnover);
    }
  }
  const sectorAvgMap = new Map<string, number>();
  for (const [sec, turnovers] of sectorTurnoverMap) {
    sectorAvgMap.set(sec, turnovers.reduce((a, b) => a + b, 0) / turnovers.length);
  }

  // 각 종목 점수 병렬 계산 (Promise.all)
  const scored = await Promise.all(
    candidates.map(async ({ symbol, name }) => {
      const cache = cacheMap.get(symbol);
      const sector = sectorMap.get(symbol) ?? null;
      const sectorAvgTurnover = sector ? (sectorAvgMap.get(sector) ?? null) : null;

      const [signalResult, technicalResult] = await Promise.all([
        calcSignalScore(supabase, symbol, todayKst, cache?.current_price ?? null),
        calcTechnicalScore(supabase, symbol, cache?.high_52w ?? null, cache?.low_52w ?? null),
      ]);
      const supplyResult = calcSupplyScore(
        cache?.volume ?? null,
        cache?.current_price ?? null,
        sectorAvgTurnover,
      );
      const valuationResult = calcValuationScore(
        cache?.per ?? null,
        cache?.pbr ?? null,
        cache?.roe ?? null,
      );

      // 가중치 적용 총점 (각 원점수 / 만점 * 가중치 합산)
      const total_score =
        (signalResult.score / 30) * weights.signal +
        (Math.max(0, technicalResult.score) / 30) * weights.technical +
        (valuationResult.score / 20) * weights.valuation +
        (supplyResult.score / 20) * weights.supply;

      return {
        symbol,
        name,
        total_score: Math.round(total_score * 10) / 10,
        signal_score: signalResult.score,
        technical_score: technicalResult.score,
        valuation_score: valuationResult.score,
        supply_score: supplyResult.score,
        signal_count: signalResult.signal_count,
        rsi: technicalResult.rsi,
        macd_cross: technicalResult.macd_cross,
        golden_cross: technicalResult.golden_cross,
        bollinger_bottom: technicalResult.bollinger_bottom,
        phoenix_pattern: technicalResult.phoenix_pattern,
        double_top: technicalResult.double_top,
        volume_surge: technicalResult.volume_surge,
        week52_low_near: technicalResult.week52_low_near,
        per: valuationResult.per,
        pbr: valuationResult.pbr,
        roe: valuationResult.roe,
        foreign_buying: supplyResult.foreign_buying,
        institution_buying: supplyResult.institution_buying,
        volume_vs_sector: supplyResult.volume_vs_sector,
      };
    })
  );

  // 총점 내림차순 정렬 후 상위 limit개
  const sorted = scored.sort((a, b) => b.total_score - a.total_score).slice(0, limit);

  const todayStr = todayKst;
  const recommendations: AiRecommendation[] = sorted.map((item, idx) => ({
    id: '',
    date: todayStr,
    rank: idx + 1,
    total_score: item.total_score,
    weight_signal: weights.signal,
    weight_technical: weights.technical,
    weight_valuation: weights.valuation,
    weight_supply: weights.supply,
    total_candidates,
    created_at: new Date().toISOString(),
    ...item,
    name: item.name ?? null,
  }));

  return { recommendations, total_candidates };
}
```

- [ ] **Step 2: 커밋**

```bash
git add web/src/lib/ai-recommendation/
git commit -m "feat: add AI recommendation scoring engine (signal/technical/valuation/supply)"
```

---

## Chunk 3: API 라우트

### Task 8: GET 엔드포인트

**Files:**
- Create: `web/src/app/api/v1/ai-recommendations/route.ts`

- [ ] **Step 1: GET 라우트 생성**

```typescript
// web/src/app/api/v1/ai-recommendations/route.ts
// GET은 읽기 전용 — Lazy Generation 없음 (생성은 POST /generate로 일원화)
import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase';
import { getTodayKst, fetchTodayBuySymbols } from '@/lib/ai-recommendation';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const limit = Math.min(Math.max(parseInt(searchParams.get('limit') ?? '5'), 3), 10);
    const dateParam = searchParams.get('date');

    const supabase = createServiceClient();
    const todayKst = dateParam ?? getTodayKst();

    // 기존 오늘 데이터 조회
    const { data: existing } = await supabase
      .from('ai_recommendations')
      .select('*')
      .eq('date', todayKst)
      .order('rank', { ascending: true })
      .limit(limit);

    // 오늘 BUY 종목 수 조회 (needs_refresh 판단용) — 실패 시 false로 안전 fallback
    let currentCount = 0;
    try {
      const currentCandidates = await fetchTodayBuySymbols(supabase, todayKst);
      currentCount = currentCandidates.length;
    } catch {
      // 신호 수 조회 실패 시 needs_refresh를 false로 처리
    }

    const storedCount = existing?.[0]?.total_candidates ?? 0;
    const needs_refresh = existing && existing.length > 0 ? currentCount > storedCount : false;

    return NextResponse.json({
      recommendations: existing ?? [],
      generated_at: existing?.[0]?.created_at ?? null,
      total_candidates: currentCount,
      needs_refresh,
    });
  } catch (error) {
    console.error('[ai-recommendations GET]', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
```

---

### Task 9: POST /generate 엔드포인트

**Files:**
- Create: `web/src/app/api/v1/ai-recommendations/generate/route.ts`

- [ ] **Step 1: POST 라우트 생성**

```typescript
// web/src/app/api/v1/ai-recommendations/generate/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase';
import { generateRecommendations, getTodayKst } from '@/lib/ai-recommendation';
import { AiRecommendationWeights, DEFAULT_WEIGHTS } from '@/types/ai-recommendation';

export const dynamic = 'force-dynamic';
export const maxDuration = 120;

export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}));
    const limit = Math.min(Math.max(parseInt(body.limit ?? '5'), 3), 10);

    // 가중치 검증 (부동소수점 오차 허용: Math.abs 사용)
    const rawWeights: AiRecommendationWeights = {
      signal: Number(body.weights?.signal ?? DEFAULT_WEIGHTS.signal),
      technical: Number(body.weights?.technical ?? DEFAULT_WEIGHTS.technical),
      valuation: Number(body.weights?.valuation ?? DEFAULT_WEIGHTS.valuation),
      supply: Number(body.weights?.supply ?? DEFAULT_WEIGHTS.supply),
    };
    const weightSum = rawWeights.signal + rawWeights.technical + rawWeights.valuation + rawWeights.supply;
    if (Math.abs(weightSum - 100) > 0.01) {
      return NextResponse.json({ error: `가중치 합계가 100이어야 합니다. 현재: ${weightSum}` }, { status: 400 });
    }

    const supabase = createServiceClient();
    const { recommendations, total_candidates } = await generateRecommendations(
      supabase, rawWeights, limit
    );

    if (recommendations.length > 0) {
      const todayKst = getTodayKst();
      // insert 먼저 (upsert), 그 다음 이전 데이터 정리 (insert 실패 시 데이터 손실 방지)
      // UNIQUE(date, symbol)이므로 onConflict update로 덮어씀
      const { error: upsertError } = await supabase.from('ai_recommendations').upsert(
        recommendations.map(r => ({ ...r, id: undefined })),
        { onConflict: 'date,symbol' }
      );
      if (!upsertError) {
        // 새 추천에 포함되지 않은 오늘의 이전 순위 데이터 정리 (limit 변경 시)
        const newSymbols = recommendations.map(r => r.symbol);
        await supabase.from('ai_recommendations')
          .delete()
          .eq('date', todayKst)
          .not('symbol', 'in', `(${newSymbols.join(',')})`);
      }
    }

    return NextResponse.json({
      recommendations,
      generated_at: new Date().toISOString(),
      total_candidates,
      needs_refresh: false,
    });
  } catch (error) {
    console.error('[ai-recommendations POST /generate]', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
```

- [ ] **Step 2: 개발 서버 실행 후 API 테스트**

```bash
cd /Users/thlee/GoogleDrive/DashboardStock/web
npm run dev
```

새 터미널에서:
```bash
# GET 테스트
curl http://localhost:3000/api/v1/ai-recommendations?limit=5

# POST 테스트 (기본 가중치)
curl -X POST http://localhost:3000/api/v1/ai-recommendations/generate \
  -H "Content-Type: application/json" \
  -d '{"limit": 5, "weights": {"signal": 30, "technical": 30, "valuation": 20, "supply": 20}}'
```

Expected: 200 응답, `recommendations` 배열 반환 (오늘 신호가 없으면 빈 배열)

- [ ] **Step 3: 커밋**

```bash
git add web/src/app/api/v1/ai-recommendations/
git commit -m "feat: add AI recommendations GET/POST API routes"
```

---

## Chunk 4: UI 컴포넌트 + 통합

### Task 10: AiRecommendationSection 컴포넌트

**Files:**
- Create: `web/src/components/signals/AiRecommendationSection.tsx`

- [ ] **Step 1: UI 컴포넌트 생성**

```tsx
// web/src/components/signals/AiRecommendationSection.tsx
'use client';

import { useState, useCallback } from 'react';
import { RefreshCw, Settings, AlertTriangle, ChevronDown, RotateCcw } from 'lucide-react';
import { AiRecommendation, AiRecommendationWeights, AiRecommendationResponse, DEFAULT_WEIGHTS } from '@/types/ai-recommendation';

const WEIGHT_STORAGE_KEY = 'ai-recommendation-weights';

function loadWeights(): AiRecommendationWeights {
  if (typeof window === 'undefined') return DEFAULT_WEIGHTS;
  try {
    const stored = localStorage.getItem(WEIGHT_STORAGE_KEY);
    if (stored) return JSON.parse(stored);
  } catch {}
  return DEFAULT_WEIGHTS;
}

function saveWeights(w: AiRecommendationWeights) {
  try { localStorage.setItem(WEIGHT_STORAGE_KEY, JSON.stringify(w)); } catch {}
}

// 점수 프로그레스 바
function ScoreBar({ score, max = 100 }: { score: number; max?: number }) {
  const pct = Math.max(0, Math.min(100, (score / max) * 100));
  const color = score >= 70 ? 'bg-green-500' : score >= 50 ? 'bg-blue-500' : 'bg-gray-400';
  return (
    <div className="w-full bg-gray-200 dark:bg-gray-700 rounded-full h-2">
      <div className={`${color} h-2 rounded-full transition-all`} style={{ width: `${pct}%` }} />
    </div>
  );
}

// 뱃지
function Badge({ label, variant }: { label: string; variant: 'green' | 'red' | 'gray' | 'orange' }) {
  const cls = {
    green: 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200',
    red: 'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200',
    gray: 'bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-400',
    orange: 'bg-orange-100 text-orange-800 dark:bg-orange-900 dark:text-orange-200',
  }[variant];
  return <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${cls}`}>{label}</span>;
}

// 추천 카드
function RecommendationCard({ item }: { item: AiRecommendation }) {
  const isWarning = item.double_top;
  return (
    <div className={`rounded-lg border p-4 ${isWarning ? 'border-orange-400 bg-orange-50 dark:bg-orange-950/20' : 'border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800'}`}>
      {isWarning && (
        <div className="flex items-center gap-1 text-orange-600 text-xs font-medium mb-2">
          <AlertTriangle className="w-3 h-3" />
          <span>쌍봉 패턴 감지 — 주의 필요</span>
        </div>
      )}

      {/* 헤더 */}
      <div className="flex items-start justify-between mb-3">
        <div className="flex items-center gap-2">
          <span className="text-lg font-bold text-blue-600 dark:text-blue-400">#{item.rank}</span>
          <div>
            <div className="font-semibold text-sm">{item.name ?? item.symbol}</div>
            <div className="text-xs text-gray-500">{item.symbol}</div>
          </div>
        </div>
        <div className="text-right">
          <div className="text-xl font-bold">{item.total_score.toFixed(1)}</div>
          <div className="text-xs text-gray-500">/ 100점</div>
        </div>
      </div>

      {/* 총점 바 */}
      <ScoreBar score={item.total_score} />

      {/* 카테고리별 점수 */}
      <div className="grid grid-cols-4 gap-1 mt-3 text-center">
        {[
          { label: '신호강도', score: item.signal_score, max: 30 },
          { label: '기술적', score: item.technical_score, max: 30 },
          { label: '밸류', score: item.valuation_score, max: 20 },
          { label: '수급', score: item.supply_score, max: 20 },
        ].map(({ label, score, max }) => (
          <div key={label} className="bg-gray-50 dark:bg-gray-700/50 rounded p-1">
            <div className="text-xs text-gray-500">{label}</div>
            <div className="text-sm font-semibold">
              {score !== null ? score.toFixed(1) : '-'}
              <span className="text-xs text-gray-400">/{max}</span>
            </div>
          </div>
        ))}
      </div>

      {/* 지표 뱃지 */}
      <div className="flex flex-wrap gap-1 mt-3">
        {item.golden_cross && <Badge label="✅ 골든크로스" variant="green" />}
        {item.bollinger_bottom && <Badge label="✅ 볼린저 하단 복귀" variant="green" />}
        {item.phoenix_pattern && <Badge label="✅ 불새패턴" variant="green" />}
        {item.macd_cross && <Badge label="✅ MACD 골든크로스" variant="green" />}
        {item.volume_surge && <Badge label="✅ 거래량 급증" variant="green" />}
        {item.week52_low_near && <Badge label="✅ 52주 저점 근처" variant="green" />}
        {item.rsi !== null && item.rsi >= 30 && item.rsi <= 50 && (
          <Badge label={`✅ RSI ${item.rsi.toFixed(0)}`} variant="green" />
        )}
        {item.pbr !== null && item.pbr < 1.0 && (
          <Badge label={`✅ PBR ${item.pbr.toFixed(2)}`} variant="green" />
        )}
        {item.per !== null && item.per < 10 && (
          <Badge label={`✅ PER ${item.per.toFixed(1)}`} variant="green" />
        )}
        {item.volume_vs_sector && <Badge label="✅ 섹터 거래대금 급증" variant="green" />}
        {item.double_top && <Badge label="⚠️ 쌍봉 (-8점)" variant="orange" />}
        {!item.foreign_buying && !item.institution_buying && (
          <Badge label="수급 미집계" variant="gray" />
        )}
      </div>
    </div>
  );
}

// 가중치 패널
function WeightPanel({
  weights,
  onChange,
  onReset,
}: {
  weights: AiRecommendationWeights;
  onChange: (w: AiRecommendationWeights) => void;
  onReset: () => void;
}) {
  const total = weights.signal + weights.technical + weights.valuation + weights.supply;
  const isValid = Math.abs(total - 100) <= 0.01;

  const handleChange = (key: keyof AiRecommendationWeights, val: number) => {
    onChange({ ...weights, [key]: val });
  };

  const items: { key: keyof AiRecommendationWeights; label: string }[] = [
    { key: 'signal', label: '신호강도' },
    { key: 'technical', label: '기술적 분석' },
    { key: 'valuation', label: '밸류에이션' },
    { key: 'supply', label: '수급' },
  ];

  return (
    <div className="mt-3 p-3 bg-gray-50 dark:bg-gray-700/50 rounded-lg border border-gray-200 dark:border-gray-600">
      <div className="flex items-center justify-between mb-2">
        <span className="text-sm font-medium">가중치 설정</span>
        <button onClick={onReset} className="flex items-center gap-1 text-xs text-gray-500 hover:text-gray-700">
          <RotateCcw className="w-3 h-3" /> 기본값 복원 (30/30/20/20)
        </button>
      </div>
      <div className="space-y-2">
        {items.map(({ key, label }) => (
          <div key={key} className="flex items-center gap-3">
            <span className="text-xs w-20 text-gray-600 dark:text-gray-400">{label}</span>
            <input
              type="range" min={0} max={100} step={10}
              value={weights[key]}
              onChange={e => handleChange(key, parseInt(e.target.value))}
              className="flex-1"
            />
            <span className="text-xs w-8 text-right font-mono">{weights[key]}%</span>
          </div>
        ))}
      </div>
      <div className={`text-xs mt-2 font-medium ${isValid ? 'text-green-600' : 'text-red-500'}`}>
        합계: {total}% {!isValid && '⚠️ 합계가 100이어야 합니다'}
      </div>
      {/* isValid 계산: Math.abs 사용 */}
    </div>
  );
}

// 메인 섹션
interface Props {
  initialData: AiRecommendationResponse | null;
}

export function AiRecommendationSection({ initialData }: Props) {
  const [data, setData] = useState<AiRecommendationResponse | null>(initialData);
  const [limit, setLimit] = useState(5);
  const [loading, setLoading] = useState(false);
  const [showWeights, setShowWeights] = useState(false);
  // localStorage는 SSR에서 접근 불가 → useEffect에서 초기화
  const [weights, setWeights] = useState<AiRecommendationWeights>(DEFAULT_WEIGHTS);

  useEffect(() => {
    const saved = loadWeights();
    setWeights(saved);
    // 초기 데이터가 없으면 자동으로 생성 트리거 (Lazy Generation 클라이언트 위임)
    if (!initialData || initialData.recommendations.length === 0) {
      refresh(saved);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const refresh = useCallback(async (newWeights?: AiRecommendationWeights, newLimit?: number) => {
    setLoading(true);
    try {
      const w = newWeights ?? weights;
      const l = newLimit ?? limit;
      const res = await fetch('/api/v1/ai-recommendations/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ limit: l, weights: w }),
      });
      if (res.ok) {
        const json = await res.json();
        setData(json);
      }
    } finally {
      setLoading(false);
    }
  }, [weights, limit]);

  const handleWeightsChange = (w: AiRecommendationWeights) => {
    setWeights(w);
    saveWeights(w);
  };

  const handleWeightsApply = () => {
    const total = weights.signal + weights.technical + weights.valuation + weights.supply;
    if (Math.abs(total - 100) <= 0.01) {
      refresh(weights);
    }
  };

  const handleLimitChange = (newLimit: number) => {
    setLimit(newLimit);
    refresh(weights, newLimit);
  };

  const displayed = data?.recommendations?.slice(0, limit) ?? [];

  return (
    <div className="mb-6">
      {/* 헤더 */}
      <div className="flex items-center justify-between mb-2 flex-wrap gap-2">
        <div>
          <h2 className="text-base font-bold">🏆 오늘의 AI 추천</h2>
          {data && (
            <p className="text-xs text-gray-500 mt-0.5">
              오늘 BUY 신호 {data.total_candidates}종목 중 상위 {displayed.length}종목 •
              생성: {new Date(data.generated_at).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' })}
            </p>
          )}
        </div>
        <div className="flex items-center gap-2">
          {/* 종목 수 선택 */}
          <div className="flex items-center gap-1 border rounded px-2 py-1 text-sm">
            {[3, 5, 10].map(n => (
              <button
                key={n}
                onClick={() => handleLimitChange(n)}
                className={`px-2 py-0.5 rounded text-xs font-medium transition-colors ${
                  limit === n ? 'bg-blue-600 text-white' : 'text-gray-600 hover:bg-gray-100 dark:hover:bg-gray-700'
                }`}
              >
                {n}
              </button>
            ))}
          </div>
          {/* 가중치 설정 */}
          <button
            onClick={() => setShowWeights(v => !v)}
            className="flex items-center gap-1 text-xs px-2 py-1 border rounded hover:bg-gray-50 dark:hover:bg-gray-700"
          >
            <Settings className="w-3 h-3" />
            가중치
            <ChevronDown className={`w-3 h-3 transition-transform ${showWeights ? 'rotate-180' : ''}`} />
          </button>
          {/* 새로고침 */}
          <button
            onClick={() => refresh()}
            disabled={loading}
            className="flex items-center gap-1 text-xs px-2 py-1 border rounded hover:bg-gray-50 dark:hover:bg-gray-700 disabled:opacity-50"
          >
            <RefreshCw className={`w-3 h-3 ${loading ? 'animate-spin' : ''}`} />
            {loading ? '계산 중...' : '새로고침'}
          </button>
        </div>
      </div>

      {/* 가중치 패널 */}
      {showWeights && (
        <div>
          <WeightPanel
            weights={weights}
            onChange={handleWeightsChange}
            onReset={() => { handleWeightsChange(DEFAULT_WEIGHTS); }}
          />
          <button
            onClick={handleWeightsApply}
            disabled={loading || Math.abs(weights.signal + weights.technical + weights.valuation + weights.supply - 100) > 0.01}
            className="mt-2 w-full text-xs py-1.5 bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50"
          >
            이 가중치로 재계산
          </button>
        </div>
      )}

      {/* needs_refresh 알림 */}
      {data?.needs_refresh && (
        <div className="flex items-center justify-between p-2 mt-2 bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-300 rounded text-xs text-yellow-700 dark:text-yellow-300">
          <span>📡 신호 {data.total_candidates}개 감지 — 새로운 종목이 추가되었습니다</span>
          <button onClick={() => refresh()} className="underline font-medium">새로고침</button>
        </div>
      )}

      {/* 추천 카드 목록 */}
      <div className="mt-3 space-y-3">
        {loading && (
          <div className="text-center py-8 text-gray-400 text-sm">점수 계산 중...</div>
        )}
        {!loading && displayed.length === 0 && (
          <div className="text-center py-8 text-gray-400 text-sm">
            오늘 BUY 신호 종목이 없거나 아직 집계 중입니다.
          </div>
        )}
        {!loading && displayed.map(item => (
          <RecommendationCard key={item.symbol} item={item} />
        ))}
      </div>
    </div>
  );
}
```

---

### Task 11: signals/page.tsx에 섹션 통합

**Files:**
- Modify: `web/src/app/signals/page.tsx`

- [ ] **Step 1: `signals/page.tsx` 읽기**

현재 파일 구조 확인 후 다음 변경 적용.

**주의:** 서버 컴포넌트에서 자가 HTTP 호출(`fetch(NEXT_PUBLIC_APP_URL)`) 대신 lib 함수를 직접 import하여 호출한다. 이것이 기존 코드베이스(`signals/page.tsx`, `daily-report/route.ts`)의 일관된 패턴이다.

1. 상단 import에 추가:

```typescript
import { AiRecommendationSection } from '@/components/signals/AiRecommendationSection';
import { AiRecommendationResponse } from '@/types/ai-recommendation';
import { getTodayKst } from '@/lib/ai-recommendation';
```

2. 기존 `const supabase = createServiceClient();` 이후에 추가:

```typescript
// AI 추천 초기 데이터 서버사이드 조회 (lib 직접 호출, fetch() 자가 호출 금지)
const todayKst = getTodayKst();
const { data: aiRecs } = await supabase
  .from('ai_recommendations')
  .select('*')
  .eq('date', todayKst)
  .order('rank', { ascending: true })
  .limit(5);

const aiRecommendationsRes: AiRecommendationResponse | null = aiRecs && aiRecs.length > 0
  ? { recommendations: aiRecs, generated_at: aiRecs[0].created_at, total_candidates: aiRecs[0].total_candidates ?? 0, needs_refresh: false }
  : null;
```

3. JSX의 최상단 컨테이너 안에 기존 내용 **앞에** 삽입:

```tsx
<AiRecommendationSection initialData={aiRecommendationsRes} />
```

- [ ] **Step 2: 브라우저에서 /signals 페이지 확인**

`http://localhost:3000/signals` 접속 후 확인:
- 페이지 상단에 "오늘의 AI 추천" 섹션이 표시되는지
- 종목 수 3/5/10 버튼 동작
- ⚙️ 가중치 설정 패널 열림/닫힘
- 🔄 새로고침 버튼 → 스피너 표시 → 결과 갱신
- 오늘 BUY 신호 없으면 "오늘 BUY 신호 종목이 없거나..." 메시지 표시

- [ ] **Step 3: 최종 커밋**

```bash
git add web/src/components/signals/AiRecommendationSection.tsx web/src/app/signals/page.tsx
git commit -m "feat: add AiRecommendationSection to signals page"
```
