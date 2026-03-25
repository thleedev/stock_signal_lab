# Standard 모델 상승확률 기반 재순위화 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Standard 모델의 순위화를 중기(1~4주) 상승 확률 + 하락 리스크 최소화 기준으로 전환

**Architecture:** 기존 technical-score를 추세 점수(0~58)로 재설계하고, risk-score 모듈을 신규 생성하여 기술적 과열+수급 이탈을 감산(-15%). 가중치를 신호10/추세40/밸류20/수급30으로 재배분.

**Tech Stack:** TypeScript, Next.js 16, Supabase, Vitest

**Spec:** `docs/superpowers/specs/2026-03-25-standard-model-rerank-design.md`

---

## File Structure

| 파일 | 역할 | 변경 유형 |
|------|------|----------|
| `web/src/types/ai-recommendation.ts` | 타입/가중치 정의 | 수정 |
| `web/src/lib/ai-recommendation/technical-score.ts` | 추세 점수 계산 (기존 기술 점수) | 수정 |
| `web/src/lib/ai-recommendation/risk-score.ts` | 리스크 감점 계산 | 신규 |
| `web/src/lib/ai-recommendation/index.ts` | 오케스트레이터 (가중치 공식) | 수정 |
| `web/src/app/api/v1/ai-recommendations/generate/route.ts` | API 라우트 (가중치 파라미터) | 수정 |
| `web/src/app/api/v1/ai-recommendations/route.ts` | API 라우트 (응답) | 수정 |
| `web/src/components/signals/AiRecommendationSection.tsx` | UI 컴포넌트 | 수정 |
| `web/src/components/signals/StockRankingSection.tsx` | UI 컴포넌트 (정규화 공식) | 수정 |
| `web/src/components/signals/UnifiedAnalysisSection.tsx` | UI 컴포넌트 (정규화 공식) | 수정 |
| `supabase/migrations/` | DB 마이그레이션 | 신규 |
| `web/src/lib/ai-recommendation/__tests__/technical-score.test.ts` | 추세 점수 테스트 | 신규 |
| `web/src/lib/ai-recommendation/__tests__/risk-score.test.ts` | 리스크 점수 테스트 | 신규 |

---

## Task 1: 타입 및 가중치 변경

**Files:**
- Modify: `web/src/types/ai-recommendation.ts`

- [ ] **Step 1: AiRecommendationWeights 인터페이스 변경**

`technical` → `trend` 리네이밍, `risk` 필드 추가:

```typescript
export interface AiRecommendationWeights {
  signal: number;
  trend: number;       // technical → trend
  valuation: number;
  supply: number;
  risk: number;        // 신규 (감산)
}
```

- [ ] **Step 2: DEFAULT_WEIGHTS 변경**

```typescript
export const DEFAULT_WEIGHTS: AiRecommendationWeights = {
  signal: 10,
  trend: 40,
  valuation: 20,
  supply: 30,
  risk: 15,
};
```

- [ ] **Step 3: AiRecommendation 인터페이스 변경**

리네이밍 + 신규 필드:

```typescript
// 리네이밍
weight_technical → weight_trend
technical_score → trend_score

// 추가
risk_score: number | null;
trend_days: number | null;
weight_risk: number;
```

- [ ] **Step 4: 커밋**

```bash
git add web/src/types/ai-recommendation.ts
git commit -m "refactor: AiRecommendation 타입에 trend/risk 필드 추가, technical→trend 리네이밍"
```

---

## Task 2: 추세 점수 재설계 (테스트 먼저)

**Files:**
- Create: `web/src/lib/ai-recommendation/__tests__/technical-score.test.ts`
- Modify: `web/src/lib/ai-recommendation/technical-score.ts`

- [ ] **Step 1: 테스트 파일 생성**

핵심 테스트 케이스:

```typescript
import { describe, it, expect } from 'vitest';
import { calcTechnicalScore, DailyPrice } from '../technical-score';

// 헬퍼: N일 치 가격 데이터 생성
function makePrices(count: number, opts?: {
  baseClose?: number;
  trend?: 'up' | 'down' | 'flat';
  volumeMultiplier?: number;
}): DailyPrice[] {
  const base = opts?.baseClose ?? 10000;
  const trend = opts?.trend ?? 'flat';
  const volMul = opts?.volumeMultiplier ?? 1;
  return Array.from({ length: count }, (_, i) => {
    const delta = trend === 'up' ? i * 50 : trend === 'down' ? -i * 50 : 0;
    const close = base + delta;
    return {
      date: `2026-01-${String(i + 1).padStart(2, '0')}`,
      open: close - 10,
      high: close + 20,
      low: close - 30,
      close,
      volume: 100000 * volMul,
    };
  });
}

describe('calcTechnicalScore (추세 점수)', () => {
  it('데이터 부족 시 0점, data_insufficient=true', () => {
    const result = calcTechnicalScore(makePrices(10), null, null);
    expect(result.data_insufficient).toBe(true);
    expect(result.score).toBe(0);
  });

  it('점수 범위가 0~58 내에 있어야 함', () => {
    const result = calcTechnicalScore(makePrices(65, { trend: 'up' }), null, null);
    expect(result.score).toBeGreaterThanOrEqual(0);
    expect(result.score).toBeLessThanOrEqual(58);
  });

  it('상승 추세(정배열) 종목이 높은 점수를 받아야 함', () => {
    const upTrend = calcTechnicalScore(makePrices(65, { trend: 'up' }), null, null);
    const flat = calcTechnicalScore(makePrices(65, { trend: 'flat' }), null, null);
    expect(upTrend.score).toBeGreaterThan(flat.score);
  });

  it('trend_days 필드가 반환되어야 함', () => {
    const result = calcTechnicalScore(makePrices(65, { trend: 'up' }), null, null);
    expect(result.trend_days).toBeGreaterThanOrEqual(0);
  });

  it('감점 항목이 없어야 함 (리스크 레이어로 이전)', () => {
    // 어떤 입력이든 최소 0점
    const result = calcTechnicalScore(makePrices(65, { trend: 'down' }), null, null);
    expect(result.score).toBeGreaterThanOrEqual(0);
  });
});
```

- [ ] **Step 2: 테스트 실행 — 실패 확인**

Run: `cd web && npx vitest run src/lib/ai-recommendation/__tests__/technical-score.test.ts`
Expected: FAIL (trend_days 미존재, 범위 불일치 등)

- [ ] **Step 3: technical-score.ts 수정**

주요 변경:
1. `TechnicalScoreResult`에 `trend_days: number` 추가
2. MA정배열: 4점 → 12점 (완전정배열), 5점 (부분정배열)
3. 추세 지속일수 계산 로직 신규 추가 (20일선 위 연속일 역순 카운트)
4. RSI: 5점 → 4점
5. 불새패턴: 5점 → 3점
6. 이격도 반등: 5점 → 3점
7. 거래량 바닥 탈출: 5점 → 3점
8. 연속하락 후 반등: 4점 → 3점
9. 볼린저: 4점 → 2점
10. 52주 저점: 3점 → 2점
11. **감점 제거**: 쌍봉(-8), RSI과열(-6), 극단급등(-4) 코드 삭제 (쌍봉 boolean 판정은 유지 — risk-score에서 참조)
12. clamp 범위: `Math.max(0, Math.min(score, 58))`

- [ ] **Step 4: 테스트 실행 — 통과 확인**

Run: `cd web && npx vitest run src/lib/ai-recommendation/__tests__/technical-score.test.ts`
Expected: PASS

- [ ] **Step 5: 커밋**

```bash
git add web/src/lib/ai-recommendation/technical-score.ts web/src/lib/ai-recommendation/__tests__/technical-score.test.ts
git commit -m "refactor: 기술 점수를 추세 점수로 재설계 (MA정배열 12점, 추세지속일수 10점, 감점 리스크 이전)"
```

---

## Task 3: 리스크 점수 모듈 (테스트 먼저)

**Files:**
- Create: `web/src/lib/ai-recommendation/__tests__/risk-score.test.ts`
- Create: `web/src/lib/ai-recommendation/risk-score.ts`

- [ ] **Step 1: 리스크 점수 인터페이스 및 테스트 작성**

```typescript
// risk-score.test.ts
import { describe, it, expect } from 'vitest';
import { calcRiskScore, RiskScoreInput } from '../risk-score';

describe('calcRiskScore', () => {
  const baseInput: RiskScoreInput = {
    rsi: 50,
    pct5d: 3,
    disparity20: 1.03,
    bollingerUpper: 11000,
    currentPrice: 10000,
    doubleTop: false,
    foreignNet: 100,
    institutionNet: 100,
    foreignStreak: 3,
    institutionStreak: 3,
    shortSellRatio: null,
  };

  it('리스크 없는 종목은 0점', () => {
    const result = calcRiskScore(baseInput);
    expect(result.score).toBe(0);
  });

  it('RSI 과매수(≥70)이면 15점 감점', () => {
    const result = calcRiskScore({ ...baseInput, rsi: 75 });
    expect(result.score).toBeGreaterThanOrEqual(15);
  });

  it('외국인+기관 동반 순매도이면 20점 감점', () => {
    const result = calcRiskScore({
      ...baseInput,
      foreignNet: -100,
      institutionNet: -100,
    });
    expect(result.score).toBeGreaterThanOrEqual(20);
  });

  it('동반 매도와 개별 매도는 중복 불가', () => {
    const result = calcRiskScore({
      ...baseInput,
      foreignNet: -100,
      institutionNet: -100,
    });
    // 동반매도 20점 + 연속매도 가능 = 최대 34점, 개별매도 10+8=18이 아닌 20
    expect(result.score).toBeLessThanOrEqual(50);
  });

  it('점수 범위는 0~100', () => {
    // 모든 위험 신호 동시 발생
    const worst = calcRiskScore({
      rsi: 80,
      pct5d: 20,
      disparity20: 1.15,
      bollingerUpper: 9000,
      currentPrice: 10000,
      doubleTop: true,
      foreignNet: -100,
      institutionNet: -100,
      foreignStreak: -5,
      institutionStreak: -5,
      shortSellRatio: 15,
    });
    expect(worst.score).toBeGreaterThanOrEqual(0);
    expect(worst.score).toBeLessThanOrEqual(100);
  });

  it('공매도 비율 null이면 공매도 감점 미적용', () => {
    const withNull = calcRiskScore({ ...baseInput, shortSellRatio: null });
    const withHigh = calcRiskScore({ ...baseInput, shortSellRatio: 15 });
    expect(withHigh.score).toBeGreaterThan(withNull.score);
  });
});
```

- [ ] **Step 2: 테스트 실행 — 실패 확인**

Run: `cd web && npx vitest run src/lib/ai-recommendation/__tests__/risk-score.test.ts`
Expected: FAIL (모듈 미존재)

- [ ] **Step 3: risk-score.ts 구현**

```typescript
export interface RiskScoreInput {
  rsi: number | null;
  pct5d: number;              // 5일 누적 등락률 (%)
  disparity20: number;        // 20일선 대비 이격도 (1.10 = 110%)
  bollingerUpper: number | null;
  currentPrice: number;
  doubleTop: boolean;
  foreignNet: number | null;
  institutionNet: number | null;
  foreignStreak: number | null;
  institutionStreak: number | null;
  shortSellRatio: number | null;
}

export interface RiskScoreResult {
  score: number;  // 0~100
  rsi_overbought: boolean;
  surge_5d: boolean;
  high_disparity: boolean;
  bollinger_upper_break: boolean;
  double_top_risk: boolean;
  smart_money_exit: boolean;
  short_sell_high: boolean;
}

export function calcRiskScore(input: RiskScoreInput): RiskScoreResult {
  let techRisk = 0;
  let supplyRisk = 0;

  // --- 기술적 위험 (최대 50) ---
  const rsiOverbought = input.rsi !== null && input.rsi >= 70;
  if (rsiOverbought) techRisk += 15;

  let surge5d = false;
  if (input.pct5d >= 15) { techRisk += 12; surge5d = true; }
  else if (input.pct5d >= 10) { techRisk += 8; surge5d = true; }

  const highDisparity = input.disparity20 >= 1.10;
  if (highDisparity) techRisk += 10;

  const bollingerBreak = input.bollingerUpper !== null && input.currentPrice > input.bollingerUpper;
  if (bollingerBreak) techRisk += 8;

  const doubleTopRisk = input.doubleTop;
  if (doubleTopRisk) techRisk += 5;

  techRisk = Math.min(techRisk, 50);

  // --- 수급 이탈 (최대 50) ---
  const fSell = input.foreignNet !== null && input.foreignNet < 0;
  const iSell = input.institutionNet !== null && input.institutionNet < 0;
  let smartMoneyExit = false;

  if (fSell && iSell) {
    supplyRisk += 20; smartMoneyExit = true;
  } else if (fSell) {
    supplyRisk += 10;
  } else if (iSell) {
    supplyRisk += 8;
  }

  if (input.foreignStreak !== null && input.foreignStreak <= -3) supplyRisk += 8;
  if (input.institutionStreak !== null && input.institutionStreak <= -3) supplyRisk += 6;

  const shortSellHigh = input.shortSellRatio !== null && input.shortSellRatio >= 10;
  if (shortSellHigh) supplyRisk += 8;

  supplyRisk = Math.min(supplyRisk, 50);

  const score = Math.min(techRisk + supplyRisk, 100);

  return {
    score,
    rsi_overbought: rsiOverbought,
    surge_5d: surge5d,
    high_disparity: highDisparity,
    bollinger_upper_break: bollingerBreak,
    double_top_risk: doubleTopRisk,
    smart_money_exit: smartMoneyExit,
    short_sell_high: shortSellHigh,
  };
}
```

- [ ] **Step 4: 테스트 실행 — 통과 확인**

Run: `cd web && npx vitest run src/lib/ai-recommendation/__tests__/risk-score.test.ts`
Expected: PASS

- [ ] **Step 5: 커밋**

```bash
git add web/src/lib/ai-recommendation/risk-score.ts web/src/lib/ai-recommendation/__tests__/risk-score.test.ts
git commit -m "feat: 리스크 감점 모듈 추가 (기술적 과열 + 수급 이탈, 0~100)"
```

---

## Task 4: 오케스트레이터 (index.ts) 수정

**Files:**
- Modify: `web/src/lib/ai-recommendation/index.ts`

- [ ] **Step 1: import 추가**

```typescript
import { calcRiskScore, RiskScoreInput } from './risk-score';
```

- [ ] **Step 2: 총점 계산식 변경**

`index.ts` 308~312줄의 가중치 공식을 변경:

```typescript
// 변경 전
const total_score =
  (signalResult.score / 30) * weights.signal +
  ((technicalResult.score + 12) / 60) * weights.technical +
  (valuationResult.score / 25) * weights.valuation +
  ((supplyResult.score + 10) / 55) * weights.supply;

// 변경 후
// 리스크 입력 준비
const pct5d = closes.length >= 6
  ? ((currentPrice - closes[closes.length - 6]) / closes[closes.length - 6]) * 100
  : 0;
const sma20Latest = sma20Arr.length > 0 ? sma20Arr[sma20Arr.length - 1] : currentPrice;
const disparity20 = sma20Latest > 0 ? currentPrice / sma20Latest : 1.0;

const riskInput: RiskScoreInput = {
  rsi: technicalResult.rsi,
  pct5d,
  disparity20,
  bollingerUpper: /* 볼린저 상단 계산 */ null,
  currentPrice,
  doubleTop: technicalResult.double_top,
  foreignNet: foreignNet,
  institutionNet: institutionNet,
  foreignStreak: foreignStreak,
  institutionStreak: institutionStreak,
  shortSellRatio: shortSellRatio,
};
const riskResult = calcRiskScore(riskInput);

const base =
  (signalResult.score / 30) * weights.signal +
  (technicalResult.score / 58) * weights.trend +
  (valuationResult.score / 25) * weights.valuation +
  ((supplyResult.score + 10) / 55) * weights.supply;

const total_score = Math.max(0, Math.min(base - (riskResult.score / 100) * weights.risk, 100));
```

> 볼린저 상단 계산: `calcBollingerUpper()`를 technical-score.ts에서 export하거나 risk-score 내부에서 prices를 받아 계산. 구현 시 적절한 방식 선택.

- [ ] **Step 3: 반환 객체에 신규 필드 추가**

```typescript
return {
  // 기존 필드 (리네이밍 적용)
  trend_score: technicalResult.score,  // technical_score → trend_score
  weight_trend: weights.trend,          // weight_technical → weight_trend

  // 신규 필드
  risk_score: riskResult.score,
  trend_days: technicalResult.trend_days,
  weight_risk: weights.risk,

  // ... 나머지 기존 필드 유지
};
```

- [ ] **Step 4: weights 참조 일괄 변경**

`weights.technical` → `weights.trend` 참조를 모두 변경.

- [ ] **Step 5: 빌드 확인**

Run: `cd web && npx tsc --noEmit`
Expected: 타입 에러 없음

- [ ] **Step 6: 커밋**

```bash
git add web/src/lib/ai-recommendation/index.ts
git commit -m "feat: 오케스트레이터에 리스크 감산 + 추세 정규화 공식 적용"
```

---

## Task 5: API 라우트 수정

**Files:**
- Modify: `web/src/app/api/v1/ai-recommendations/generate/route.ts`
- Modify: `web/src/app/api/v1/ai-recommendations/route.ts`

- [ ] **Step 1: generate/route.ts — standard 모델 weight 처리 변경**

94~99줄:

```typescript
// 변경 전
const rawWeights = { signal: ..., technical: ..., valuation: ..., supply: ... };
const weightSum = rawWeights.signal + rawWeights.technical + rawWeights.valuation + rawWeights.supply;

// 변경 후
const rawWeights = {
  signal: Number(signal ?? DEFAULT_WEIGHTS.signal),
  trend: Number(trend ?? DEFAULT_WEIGHTS.trend),
  valuation: Number(valuation ?? DEFAULT_WEIGHTS.valuation),
  supply: Number(supply ?? DEFAULT_WEIGHTS.supply),
  risk: Number(risk ?? DEFAULT_WEIGHTS.risk),
};
const weightSum = rawWeights.signal + rawWeights.trend + rawWeights.valuation + rawWeights.supply;
// risk는 감산 전용이므로 합계에 미포함, 0~100 범위 검증만
```

- [ ] **Step 2: generate/route.ts — short_term insert 수정**

71, 75줄:

```typescript
// 변경 전
technical_score: 0,
weight_technical: 0,

// 변경 후
trend_score: 0,
weight_trend: 0,
risk_score: r.scores?.risk ?? 0,
trend_days: null,
weight_risk: 0,
```

- [ ] **Step 3: generate/route.ts — standard insert 수정**

반환 객체에서 `technical_score` → `trend_score`, `weight_technical` → `weight_trend` 리네이밍 + `risk_score`, `trend_days`, `weight_risk` 추가.

- [ ] **Step 4: route.ts (GET) — 응답에 신규 필드 포함 확인**

DB 조회 결과에 `risk_score`, `trend_days` 컬럼이 포함되는지 확인. Supabase `select('*')` 사용 시 자동 포함.

- [ ] **Step 5: 빌드 확인**

Run: `cd web && npx tsc --noEmit`
Expected: 타입 에러 없음

- [ ] **Step 6: 커밋**

```bash
git add web/src/app/api/v1/ai-recommendations/
git commit -m "feat: API 라우트에 trend/risk 가중치 및 필드 반영"
```

---

## Task 6: 프론트엔드 컴포넌트 수정

**Files:**
- Modify: `web/src/components/signals/AiRecommendationSection.tsx`
- Modify: `web/src/components/signals/StockRankingSection.tsx`
- Modify: `web/src/components/signals/UnifiedAnalysisSection.tsx`

- [x] **Step 1: AiRecommendationSection.tsx**

102줄:

```typescript
// 변경 전
{ label: '기술적', score: item.technical_score, max: 30 }

// 변경 후
{ label: '추세', score: item.trend_score, max: 58 }
```

- [x] **Step 2: StockRankingSection.tsx**

112줄 정규화 공식:

```typescript
// 변경 전
tech: clamp((item.ai.technical_score + 12) / 60 * 100)

// 변경 후
tech: clamp(item.ai.trend_score / 58 * 100)
```

188~190줄 라벨: `기술` → `추세`

- [x] **Step 3: UnifiedAnalysisSection.tsx**

115줄 정규화 공식:

```typescript
// 변경 전
tech: clamp((item.ai.technical_score + 12) / 60 * 100)

// 변경 후
tech: clamp(item.ai.trend_score / 58 * 100)
```

- [x] **Step 4: 빌드 확인**

Run: `cd web && npx tsc --noEmit`
Expected: 타입 에러 없음

- [x] **Step 5: 커밋**

```bash
git add web/src/components/signals/
git commit -m "feat: 프론트엔드 컴포넌트에 추세/리스크 필드 반영, 정규화 공식 업데이트"
```

---

## Task 7: DB 마이그레이션

**Files:**
- Create: `supabase/migrations/20260325_add_risk_trend_columns.sql`

- [ ] **Step 1: 마이그레이션 SQL 작성**

```sql
-- 1. 신규 컬럼 추가
ALTER TABLE ai_recommendations
  ADD COLUMN IF NOT EXISTS risk_score REAL,
  ADD COLUMN IF NOT EXISTS trend_days INTEGER,
  ADD COLUMN IF NOT EXISTS weight_risk REAL;

-- 2. 리네이밍: technical_score → trend_score
ALTER TABLE ai_recommendations
  RENAME COLUMN technical_score TO trend_score;

-- 3. 리네이밍: weight_technical → weight_trend
ALTER TABLE ai_recommendations
  RENAME COLUMN weight_technical TO weight_trend;
```

- [ ] **Step 2: 커밋**

```bash
git add supabase/migrations/20260325_add_risk_trend_columns.sql
git commit -m "feat: DB 마이그레이션 — risk_score, trend_days 컬럼 추가, technical→trend 리네이밍"
```

---

## Task 8: 통합 테스트 및 빌드 확인

**Files:** (변경 없음 — 검증만)

- [ ] **Step 1: 전체 테스트 실행**

Run: `cd web && npm run test`
Expected: 모든 테스트 통과

- [ ] **Step 2: 프로덕션 빌드**

Run: `cd web && npm run build`
Expected: 빌드 성공

- [ ] **Step 3: lint 확인**

Run: `cd web && npm run lint`
Expected: 에러 없음

- [ ] **Step 4: 최종 커밋 (필요 시)**

빌드/lint 수정사항이 있으면 커밋.

```bash
git add -A
git commit -m "fix: 빌드/lint 오류 수정"
```
