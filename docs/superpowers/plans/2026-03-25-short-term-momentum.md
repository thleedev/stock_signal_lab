# 초단기 반응형 종목 점수 모델 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** BUY 신호 종목 중 "내일~모레 반응이 올 자리"를 정량 평가하는 초단기 모멘텀 순위 모델을 구축하고, signals 페이지에 "단기추천" 탭으로 노출한다.

**Architecture:** 기존 `ai-recommendation/` 모듈을 확장하여 `short-term/` 하위 디렉토리에 5개 스코어링 함수 + 1차 필터를 추가. DB는 `ai_recommendations` 테이블에 `model_type` + `score_breakdown` JSONB 컬럼 추가로 기존 데이터와 공존. API는 기존 엔드포인트에 `model` 파라미터 추가.

**Tech Stack:** Next.js 16, React 19, TypeScript, Supabase (PostgreSQL), Tailwind CSS v4, Vitest

**Design Spec:** `docs/superpowers/specs/2026-03-25-short-term-momentum-design.md`

---

## 파일 구조

### 신규 생성

| 파일 | 책임 |
|------|------|
| `web/src/lib/ai-recommendation/short-term/pre-filter.ts` | 1차 필터 6개 조건 |
| `web/src/lib/ai-recommendation/short-term/momentum-score.ts` | 가격×거래량 매트릭스 + 종가위치 + 갭업/패턴 + 거래대금 |
| `web/src/lib/ai-recommendation/short-term/supply-score.ts` | 당일 주체별 + 2일 연속 + 경고 |
| `web/src/lib/ai-recommendation/short-term/catalyst-score.ts` | 신호 신선도 + 섹터/테마 + 신호가 위치 |
| `web/src/lib/ai-recommendation/short-term/valuation-score.ts` | 초단기용 밸류에이션 (배점 재조정) |
| `web/src/lib/ai-recommendation/short-term/risk-penalty.ts` | 과열 + 캔들 위험 + 추격 |
| `web/src/lib/ai-recommendation/short-term-momentum.ts` | 오케스트레이터 — generateShortTermRecommendations() |
| `web/src/lib/ai-recommendation/__tests__/short-term-scoring.test.ts` | 초단기 스코어링 단위 테스트 |
| `web/src/components/signals/ShortTermRecommendationSection.tsx` | 단기추천 탭 UI 컴포넌트 |
| `supabase/migrations/0XX_short_term_momentum.sql` | model_type + score_breakdown 컬럼 추가 |

### 수정

| 파일 | 변경 내용 |
|------|-----------|
| `web/src/types/ai-recommendation.ts` | ModelType, ShortTermWeights, ShortTermScoreBreakdown 타입 추가 |
| `web/src/app/api/v1/ai-recommendations/route.ts` | model 파라미터 + WHERE model_type 필터 추가 |
| `web/src/app/api/v1/ai-recommendations/generate/route.ts` | model 파라미터 + short_term 분기 추가 |
| `web/src/app/signals/page.tsx` | 3탭 구조 (AI신호 / 종목추천 / 단기추천) |

---

## Task 1: DB 마이그레이션 + 타입 정의

**Files:**
- Create: `supabase/migrations/0XX_short_term_momentum.sql`
- Modify: `web/src/types/ai-recommendation.ts`

- [ ] **Step 1: 마이그레이션 SQL 작성**

다음 마이그레이션 번호를 확인하고 파일 생성:

```sql
-- 초단기 모멘텀 모델 지원
ALTER TABLE ai_recommendations
  ADD COLUMN IF NOT EXISTS model_type TEXT DEFAULT 'standard',
  ADD COLUMN IF NOT EXISTS score_breakdown JSONB;

CREATE INDEX IF NOT EXISTS idx_ai_rec_model_date
  ON ai_recommendations(model_type, date);

-- 기존 UNIQUE 제약 업데이트 (model_type 포함)
ALTER TABLE ai_recommendations DROP CONSTRAINT IF EXISTS ai_recommendations_date_symbol_key;
ALTER TABLE ai_recommendations ADD CONSTRAINT ai_recommendations_date_symbol_model_key
  UNIQUE(date, symbol, model_type);
```

- [ ] **Step 2: 타입 정의 추가**

`web/src/types/ai-recommendation.ts` 끝에 추가:

```typescript
export type ModelType = 'standard' | 'short_term';

export interface ShortTermWeights {
  momentum: number;   // 기본 45
  supply: number;     // 기본 28
  catalyst: number;   // 기본 22
  valuation: number;  // 기본 5
  risk: number;       // 기본 15 (감산)
}

export const DEFAULT_SHORT_TERM_WEIGHTS: ShortTermWeights = {
  momentum: 45,
  supply: 28,
  catalyst: 22,
  valuation: 5,
  risk: 15,
};

export interface ShortTermScoreBreakdown {
  momentum: number;
  supply: number;
  catalyst: number;
  valuation: number;
  risk: number;
  total: number;
  grade: string;
  preFilterPassed: boolean;
  preFilterReasons?: string[];
  badges?: string[];
}
```

- [ ] **Step 3: 커밋**

```bash
git add supabase/migrations/0XX_short_term_momentum.sql web/src/types/ai-recommendation.ts
git commit -m "feat: 초단기 모멘텀 모델 DB 마이그레이션 + 타입 정의"
```

---

## Task 2: 1차 필터 (pre-filter)

**Files:**
- Create: `web/src/lib/ai-recommendation/short-term/pre-filter.ts`
- Test: `web/src/lib/ai-recommendation/__tests__/short-term-scoring.test.ts`

- [ ] **Step 1: 테스트 파일 생성 — 1차 필터 테스트 작성**

```typescript
import { describe, it, expect } from 'vitest';
import { applyPreFilter, type PreFilterInput } from '../short-term/pre-filter';

describe('applyPreFilter', () => {
  const base: PreFilterInput = {
    priceChangePct: 2.0,
    tradingValue: 300_0000_0000, // 300억 (원 단위)
    closePosition: 0.7,
    highPrice: 10500,
    lowPrice: 10000,
    foreignNet: 1000,
    institutionNet: -500,
    daysSinceLastBuy: 0,
    sectorStrong: false,
    cumReturn3d: 10,
  };

  it('모든 조건 충족 시 통과', () => {
    const result = applyPreFilter(base);
    expect(result.passed).toBe(true);
    expect(result.reasons).toHaveLength(0);
  });

  it('등락률 0.5% 미만 탈락', () => {
    const result = applyPreFilter({ ...base, priceChangePct: 0.3 });
    expect(result.passed).toBe(false);
    expect(result.reasons).toContain('등락률 범위 미달');
  });

  it('등락률 8% 이상 탈락', () => {
    const result = applyPreFilter({ ...base, priceChangePct: 8.5 });
    expect(result.passed).toBe(false);
  });

  it('거래대금 200억 미달 탈락', () => {
    const result = applyPreFilter({ ...base, tradingValue: 150_0000_0000 });
    expect(result.passed).toBe(false);
    expect(result.reasons).toContain('거래대금 미달');
  });

  it('종가 위치 0.5 미만 탈락', () => {
    const result = applyPreFilter({ ...base, closePosition: 0.4 });
    expect(result.passed).toBe(false);
  });

  it('고가=저가 (상한가) 시 종가위치 1.0 간주 → 통과', () => {
    const result = applyPreFilter({ ...base, highPrice: 10000, lowPrice: 10000, closePosition: 0 });
    expect(result.passed).toBe(true);
  });

  it('수급 없음 탈락 (외국인/기관 모두 순매도)', () => {
    const result = applyPreFilter({ ...base, foreignNet: -100, institutionNet: -200 });
    expect(result.passed).toBe(false);
    expect(result.reasons).toContain('수급 미달');
  });

  it('3일 누적 20% 초과 탈락', () => {
    const result = applyPreFilter({ ...base, cumReturn3d: 22 });
    expect(result.passed).toBe(false);
    expect(result.reasons).toContain('과열');
  });

  it('신호 5일 이상 지남 + 섹터 약세 → 촉매 미달', () => {
    const result = applyPreFilter({ ...base, daysSinceLastBuy: 6, sectorStrong: false });
    expect(result.passed).toBe(false);
    expect(result.reasons).toContain('촉매 미달');
  });
});
```

- [ ] **Step 2: 테스트 실행 — 실패 확인**

```bash
cd web && npx vitest run src/lib/ai-recommendation/__tests__/short-term-scoring.test.ts
```

Expected: FAIL — `../short-term/pre-filter` 모듈 없음

- [ ] **Step 3: pre-filter 구현**

```typescript
// web/src/lib/ai-recommendation/short-term/pre-filter.ts

export interface PreFilterInput {
  priceChangePct: number;      // 당일 등락률 (%)
  tradingValue: number;        // 당일 거래대금 (원)
  closePosition: number;       // (종가-저가)/(고가-저가)
  highPrice: number;           // 당일 고가
  lowPrice: number;            // 당일 저가
  foreignNet: number | null;   // 외국인 순매수
  institutionNet: number | null; // 기관 순매수
  daysSinceLastBuy: number;    // 마지막 BUY 신호로부터 경과일
  sectorStrong: boolean;       // 당일 섹터 강세 여부
  cumReturn3d: number;         // 3거래일 누적 등락률 (%)
}

export interface PreFilterResult {
  passed: boolean;
  reasons: string[];
}

const TRADING_VALUE_MIN = 200_0000_0000; // 200억

export function applyPreFilter(input: PreFilterInput): PreFilterResult {
  const reasons: string[] = [];

  // 종가위치: 고가=저가 시 1.0 간주
  const closePos = input.highPrice === input.lowPrice ? 1.0 : input.closePosition;

  if (input.priceChangePct < 0.5 || input.priceChangePct >= 8) {
    reasons.push('등락률 범위 미달');
  }

  if (input.tradingValue < TRADING_VALUE_MIN) {
    reasons.push('거래대금 미달');
  }

  if (closePos < 0.5) {
    reasons.push('종가위치 미달');
  }

  const hasForeignBuy = (input.foreignNet ?? 0) > 0;
  const hasInstitutionBuy = (input.institutionNet ?? 0) > 0;
  if (!hasForeignBuy && !hasInstitutionBuy) {
    reasons.push('수급 미달');
  }

  if (input.cumReturn3d > 20) {
    reasons.push('과열');
  }

  const hasCatalyst = input.daysSinceLastBuy <= 3 || input.sectorStrong;
  if (!hasCatalyst) {
    reasons.push('촉매 미달');
  }

  return { passed: reasons.length === 0, reasons };
}
```

- [ ] **Step 4: 테스트 통과 확인**

```bash
cd web && npx vitest run src/lib/ai-recommendation/__tests__/short-term-scoring.test.ts
```

Expected: PASS

- [ ] **Step 5: 커밋**

```bash
git add web/src/lib/ai-recommendation/short-term/pre-filter.ts web/src/lib/ai-recommendation/__tests__/short-term-scoring.test.ts
git commit -m "feat: 초단기 모멘텀 1차 필터 구현 + 테스트"
```

---

## Task 3: 모멘텀 스코어 (가격×거래량 통합)

**Files:**
- Create: `web/src/lib/ai-recommendation/short-term/momentum-score.ts`
- Modify: `web/src/lib/ai-recommendation/__tests__/short-term-scoring.test.ts`

- [ ] **Step 1: 모멘텀 스코어 테스트 작성**

테스트 파일에 추가:

```typescript
import { calcMomentumScore, type MomentumInput } from '../short-term/momentum-score';

describe('calcMomentumScore', () => {
  const base: MomentumInput = {
    priceChangePct: 2.0,          // +2% (최적 구간)
    volumeRatio: 2.5,             // 20일 평균 대비 2.5배
    closePosition: 0.85,          // 양봉 장악형
    gapPct: 1.5,                  // +1.5% 갭업
    prevBodyPct: 4.0,             // 전일 4% 장대양봉
    prevClose: 10000,
    todayOpen: 10150,             // 갭업
    todayClose: 10200,
    prevHigh: 10100,
    prev3dHigh: 10050,
    isConsecutiveBullish: true,
    tradingValue: 850_0000_0000,  // 850억
    isConsecutive2dLargeBullish: false,
  };

  it('최적 조합: +2% + 거래량 2.5배 → 매트릭스 35점', () => {
    const result = calcMomentumScore(base);
    // 매트릭스 35 + 종가위치 20 + 갭업패턴 clamp20 + 거래대금 10 = 85
    expect(result.raw).toBeGreaterThanOrEqual(80);
  });

  it('+8% 초과 + 거래량 평이 → 매트릭스 음수', () => {
    const result = calcMomentumScore({ ...base, priceChangePct: 9, volumeRatio: 1.0 });
    expect(result.raw).toBeLessThan(30);
  });

  it('종가위치 0.3 → 감점', () => {
    const result = calcMomentumScore({ ...base, closePosition: 0.25 });
    expect(result.raw).toBeLessThan(70);
  });

  it('open이 null → 갭업/패턴 0점', () => {
    const result = calcMomentumScore({ ...base, todayOpen: null as unknown as number });
    expect(result.raw).toBeLessThan(base.tradingValue ? 70 : 50);
  });

  it('정규화: raw 범위 -10~90 → 0~100', () => {
    const result = calcMomentumScore(base);
    expect(result.normalized).toBeGreaterThanOrEqual(0);
    expect(result.normalized).toBeLessThanOrEqual(100);
  });
});
```

- [ ] **Step 2: 테스트 실행 — 실패 확인**

- [ ] **Step 3: momentum-score.ts 구현**

설계 문서 Section 4.1 기준으로 구현:
- A. 가격-거래량 매트릭스 (최대 35점)
- B. 종가위치 (최대 20점, 고가=저가 시 1.0)
- C. 갭업+전일 패턴 (합산 후 clamp 20)
- D. 거래대금 (최대 15점)
- 정규화: `(raw + 10) / 100 × 100`

```typescript
// web/src/lib/ai-recommendation/short-term/momentum-score.ts

export interface MomentumInput {
  priceChangePct: number;
  volumeRatio: number;
  closePosition: number;
  gapPct: number | null;
  prevBodyPct: number | null;
  prevClose: number | null;
  todayOpen: number | null;
  todayClose: number;
  prevHigh: number | null;
  prev3dHigh: number | null;
  isConsecutiveBullish: boolean;
  tradingValue: number;
  isConsecutive2dLargeBullish: boolean;
}

export interface MomentumResult {
  raw: number;
  normalized: number;
}

// 구현: 설계 문서 Section 4.1 참조
```

- [ ] **Step 4: 테스트 통과 확인**

- [ ] **Step 5: 커밋**

```bash
git add web/src/lib/ai-recommendation/short-term/momentum-score.ts web/src/lib/ai-recommendation/__tests__/short-term-scoring.test.ts
git commit -m "feat: 초단기 모멘텀 스코어 (가격×거래량 매트릭스) 구현"
```

---

## Task 4: 수급 스코어

**Files:**
- Create: `web/src/lib/ai-recommendation/short-term/supply-score.ts`
- Modify: `web/src/lib/ai-recommendation/__tests__/short-term-scoring.test.ts`

- [ ] **Step 1: 수급 스코어 테스트 작성**

```typescript
import { calcShortTermSupplyScore, type ShortTermSupplyInput } from '../short-term/supply-score';

describe('calcShortTermSupplyScore', () => {
  it('외국인+기관 동반 순매수 → 고점수', () => {
    const result = calcShortTermSupplyScore({
      foreignNet: 5000, institutionNet: 3000, programNet: null,
      foreignStreak: 2, institutionStreak: 2, programStreak: null,
    });
    // 외국인10 + 기관10 + 동반12 + 외연속5 + 기연속5 = 42
    expect(result.raw).toBeGreaterThanOrEqual(35);
  });

  it('외국인/기관 둘 다 매도 → 감점', () => {
    const result = calcShortTermSupplyScore({
      foreignNet: -1000, institutionNet: -500, programNet: null,
      foreignStreak: -3, institutionStreak: -1, programStreak: null,
    });
    expect(result.raw).toBeLessThan(0);
  });

  it('정규화: raw -25~55 → 0~100', () => {
    const result = calcShortTermSupplyScore({
      foreignNet: 5000, institutionNet: 3000, programNet: null,
      foreignStreak: 2, institutionStreak: 2, programStreak: null,
    });
    expect(result.normalized).toBeGreaterThanOrEqual(0);
    expect(result.normalized).toBeLessThanOrEqual(100);
  });
});
```

- [ ] **Step 2: 테스트 실행 — 실패 확인**

- [ ] **Step 3: supply-score.ts 구현**

설계 문서 Section 4.2 기준. v1에서 programNet/programStreak은 null → 0점 처리.
정규화: `(raw + 25) / 80 × 100`

- [ ] **Step 4: 테스트 통과 확인**

- [ ] **Step 5: 커밋**

```bash
git add web/src/lib/ai-recommendation/short-term/supply-score.ts web/src/lib/ai-recommendation/__tests__/short-term-scoring.test.ts
git commit -m "feat: 초단기 수급 스코어 구현"
```

---

## Task 5: 촉매 스코어

**Files:**
- Create: `web/src/lib/ai-recommendation/short-term/catalyst-score.ts`
- Modify: `web/src/lib/ai-recommendation/__tests__/short-term-scoring.test.ts`

- [ ] **Step 1: 촉매 스코어 테스트 작성**

```typescript
import { calcCatalystScore, type CatalystInput } from '../short-term/catalyst-score';

describe('calcCatalystScore', () => {
  it('오늘 BUY 2소스 + 섹터 상위3 + 신호가 이내 → 고점수', () => {
    const result = calcCatalystScore({
      todayBuySources: 2, daysSinceLastBuy: 0,
      sectorRank: 2, sectorCount: 20,
      sectorAvgChangePct: 1.5, stockChangePct: 3.0,
      signalPriceGapPct: -1.0, // 현재가 < 신호가
    });
    expect(result.raw).toBeGreaterThanOrEqual(40);
  });

  it('5일 이상 지난 신호 + 섹터 약세 → 저점수', () => {
    const result = calcCatalystScore({
      todayBuySources: 0, daysSinceLastBuy: 7,
      sectorRank: 18, sectorCount: 20,
      sectorAvgChangePct: -2.0, stockChangePct: 1.0,
      signalPriceGapPct: null,
    });
    expect(result.raw).toBeLessThanOrEqual(5);
  });

  it('정규화: raw -10~60 → 0~100', () => {
    const result = calcCatalystScore({
      todayBuySources: 3, daysSinceLastBuy: 0,
      sectorRank: 1, sectorCount: 20,
      sectorAvgChangePct: 3.0, stockChangePct: 5.0,
      signalPriceGapPct: -2.0,
    });
    expect(result.normalized).toBeGreaterThanOrEqual(0);
    expect(result.normalized).toBeLessThanOrEqual(100);
  });
});
```

- [ ] **Step 2: 테스트 실행 — 실패 확인**

- [ ] **Step 3: catalyst-score.ts 구현**

설계 문서 Section 4.3 기준:
- A. 신호 신선도 (최대 25점)
- B. 섹터/테마 모멘텀 (최대 25점)
- C. 신호가 대비 위치 (최대 10점, +7% 이상은 리스크로 이관)
- 정규화: `(raw + 10) / 70 × 100`

- [ ] **Step 4: 테스트 통과 확인**

- [ ] **Step 5: 커밋**

```bash
git add web/src/lib/ai-recommendation/short-term/catalyst-score.ts web/src/lib/ai-recommendation/__tests__/short-term-scoring.test.ts
git commit -m "feat: 초단기 촉매 스코어 (신호 신선도 + 섹터/테마) 구현"
```

---

## Task 6: 밸류에이션 스코어 + 리스크 패널티

**Files:**
- Create: `web/src/lib/ai-recommendation/short-term/valuation-score.ts`
- Create: `web/src/lib/ai-recommendation/short-term/risk-penalty.ts`
- Modify: `web/src/lib/ai-recommendation/__tests__/short-term-scoring.test.ts`

- [x] **Step 1: 밸류에이션 + 리스크 테스트 작성**

```typescript
import { calcShortTermValuationScore } from '../short-term/valuation-score';
import { calcRiskPenalty, type RiskInput } from '../short-term/risk-penalty';
// (DONE)

describe('calcShortTermValuationScore', () => {
  it('Forward PER 7 + 목표주가 +35% + ROE 18% → 고점수', () => {
    const result = calcShortTermValuationScore({
      forwardPer: 7, targetPriceUpside: 35, per: null, pbr: null, roe: 18,
    });
    expect(result.raw).toBeGreaterThanOrEqual(60);
  });

  it('Forward 없음 + PBR 0.4 + ROE 8% → 폴백', () => {
    const result = calcShortTermValuationScore({
      forwardPer: null, targetPriceUpside: null, per: null, pbr: 0.4, roe: 8,
    });
    expect(result.raw).toBeGreaterThanOrEqual(30);
  });

  it('정규화: 0~75 → 0~100', () => {
    const result = calcShortTermValuationScore({
      forwardPer: 5, targetPriceUpside: 50, per: null, pbr: null, roe: 20,
    });
    expect(result.normalized).toBeLessThanOrEqual(100);
  });
});

describe('calcRiskPenalty', () => {
  it('패널티 없음 → 0', () => {
    const result = calcRiskPenalty({
      priceChangePct: 3.0, cumReturn3d: 10,
      volumeRatio: 2.0, closePosition: 0.8,
      todayOpen: 10100, todayClose: 10300,
      upperShadow: 50, bodySize: 200,
      signalPriceGapPct: 3.0,
      tradingValue: 500_0000_0000,
      isConsecutive2dLargeBullish: false,
    });
    expect(result.raw).toBe(0);
  });

  it('+12% 급등 + 3일 누적 22% → 패널티 40', () => {
    const result = calcRiskPenalty({
      priceChangePct: 13.0, cumReturn3d: 22,
      volumeRatio: 2.0, closePosition: 0.8,
      todayOpen: 10000, todayClose: 11300,
      upperShadow: 50, bodySize: 1300,
      signalPriceGapPct: 15.0,
      tradingValue: 500_0000_0000,
      isConsecutive2dLargeBullish: false,
    });
    // +12%(-20) + 3일누적(-20) + 신호가+12%(-20) = 60, clamp 100
    expect(result.raw).toBeGreaterThanOrEqual(40);
  });

  it('리스크 raw는 0~100 clamp', () => {
    const result = calcRiskPenalty({
      priceChangePct: 15.0, cumReturn3d: 25,
      volumeRatio: 0.8, closePosition: 0.2,
      todayOpen: 10000, todayClose: 10100,
      upperShadow: 500, bodySize: 100,
      signalPriceGapPct: 15.0,
      tradingValue: 80_0000_0000,
      isConsecutive2dLargeBullish: true,
    });
    expect(result.normalized).toBeLessThanOrEqual(100);
    expect(result.normalized).toBeGreaterThanOrEqual(0);
  });
});
```

- [x] **Step 2: 테스트 실행 — 실패 확인**

- [x] **Step 3: valuation-score.ts 구현**

설계 문서 Section 4.4 기준. 별도 함수 `calcShortTermValuationScore()`.
정규화: `raw / 75 × 100`

- [x] **Step 4: risk-penalty.ts 구현**

설계 문서 Section 4.5 기준.
- A. 과열 (최대 -55)
- B. 캔들 위험 (최대 -34, open null이면 skip)
- C. 추격 (최대 -57)
- 합산 절대값 clamp(0, 100)

- [x] **Step 5: 테스트 통과 확인**

- [x] **Step 6: 커밋**

```bash
git add web/src/lib/ai-recommendation/short-term/valuation-score.ts web/src/lib/ai-recommendation/short-term/risk-penalty.ts web/src/lib/ai-recommendation/__tests__/short-term-scoring.test.ts
git commit -m "feat: 초단기 밸류에이션 스코어 + 리스크 패널티 구현"
```

---

## Task 7: 오케스트레이터 (generateShortTermRecommendations)

**Files:**
- Create: `web/src/lib/ai-recommendation/short-term-momentum.ts`

- [ ] **Step 1: 오케스트레이터 구현**

기존 `index.ts`의 `generateRecommendations()`를 참조하되, 초단기 전용 로직:

```typescript
// web/src/lib/ai-recommendation/short-term-momentum.ts

import { SupabaseClient } from '@supabase/supabase-js';
import { ShortTermWeights, DEFAULT_SHORT_TERM_WEIGHTS, ShortTermScoreBreakdown } from '@/types/ai-recommendation';
import { applyPreFilter } from './short-term/pre-filter';
import { calcMomentumScore } from './short-term/momentum-score';
import { calcShortTermSupplyScore } from './short-term/supply-score';
import { calcCatalystScore } from './short-term/catalyst-score';
import { calcShortTermValuationScore } from './short-term/valuation-score';
import { calcRiskPenalty } from './short-term/risk-penalty';
import { getTodayKst, fetchTodayBuySymbols } from './index';

export async function generateShortTermRecommendations(
  supabase: SupabaseClient,
  weights: ShortTermWeights = DEFAULT_SHORT_TERM_WEIGHTS,
  limit = 30,
): Promise<{ recommendations: ShortTermRecommendation[]; total_candidates: number }> {
  // 1. 오늘 BUY 신호 종목 조회 (기존 함수 재활용)
  // 2. stock_cache + daily_prices 병렬 조회
  // 3. 섹터별 평균 등락률 + 순위 집계
  // 4. 종목별 루프:
  //    a. 3일 OHLCV에서 파생값 계산 (종가위치, 갭, 거래대금, 3일 누적 등)
  //    b. 1차 필터 적용
  //    c. 5개 스코어 함수 호출
  //    d. 가중합 + clamp(0, 100)
  //    e. 등급 부여
  // 5. 점수순 정렬 + limit
  // 6. 배지 생성
}
```

핵심 가중합 로직:
```typescript
const positiveWeightSum = weights.momentum + weights.supply + weights.catalyst + weights.valuation;
const total =
  (momentum.normalized * weights.momentum +
   supply.normalized * weights.supply +
   catalyst.normalized * weights.catalyst +
   valuation.normalized * weights.valuation) / positiveWeightSum * 100
  - risk.normalized * (weights.risk / 100);

const finalScore = Math.max(0, Math.min(100, total));
```

- [ ] **Step 2: 빌드 확인**

```bash
cd web && npx tsc --noEmit
```

- [ ] **Step 3: 커밋**

```bash
git add web/src/lib/ai-recommendation/short-term-momentum.ts
git commit -m "feat: 초단기 모멘텀 오케스트레이터 구현"
```

---

## Task 8: API 엔드포인트 수정

**Files:**
- Modify: `web/src/app/api/v1/ai-recommendations/route.ts`
- Modify: `web/src/app/api/v1/ai-recommendations/generate/route.ts`

- [ ] **Step 1: GET 라우트 수정**

`route.ts`에 `model` 쿼리 파라미터 추가:

```typescript
const model = searchParams.get('model') ?? 'standard';
// ...
let query = supabase
  .from('ai_recommendations')
  .select('*')
  .eq('date', today)
  .eq('model_type', model)  // 추가
  .order('rank', { ascending: true })
  .limit(limitNum);
```

- [ ] **Step 2: POST 라우트 수정**

`generate/route.ts`에 model 분기 추가:

```typescript
const { model = 'standard', limit, weights } = await req.json();

if (model === 'short_term') {
  // ShortTermWeights 유효성 검증 (momentum+supply+catalyst+valuation = 100)
  const result = await generateShortTermRecommendations(supabase, weights, limit || 30);
  // DELETE WHERE date = today AND model_type = 'short_term'
  // INSERT with model_type = 'short_term', score_breakdown = JSONB
  return NextResponse.json({ ... });
}

// 기존 standard 로직 (변경 없음)
```

DELETE 패턴:
```typescript
await supabase
  .from('ai_recommendations')
  .delete()
  .eq('date', today)
  .eq('model_type', model);  // model_type별 분리 삭제
```

- [ ] **Step 3: 빌드 확인**

```bash
cd web && npx tsc --noEmit
```

- [ ] **Step 4: 커밋**

```bash
git add web/src/app/api/v1/ai-recommendations/route.ts web/src/app/api/v1/ai-recommendations/generate/route.ts
git commit -m "feat: AI 추천 API에 model 파라미터 추가 (short_term 지원)"
```

---

## Task 9: 단기추천 UI 컴포넌트

**Files:**
- Create: `web/src/components/signals/ShortTermRecommendationSection.tsx`

- [ ] **Step 1: 컴포넌트 구현**

기존 `AiRecommendationSection.tsx` (391줄)를 참조하되 초단기 전용:

핵심 차이점:
- 가중치 5개 슬라이더 (모멘텀/수급/촉매/밸류 합=100, 리스크 별도 0~30)
- localStorage 키: `short-term-weights`
- API 호출: `model=short_term`
- 등급 라벨: A/B+/B/C/D
- 배지: 🔥 거래량 폭발, 📈 섹터 강세, 🏛️ 기관, 🌍 외국인, ⚡ 동반, ⚠️ 추격
- 필터 제외 종목 접기/펼치기 섹션
- stale-while-revalidate: `generated_at` 기준 5분 경과 시 자동 재생성

```typescript
// web/src/components/signals/ShortTermRecommendationSection.tsx
'use client';

import { useState, useEffect, useCallback } from 'react';
import { DEFAULT_SHORT_TERM_WEIGHTS, type ShortTermWeights } from '@/types/ai-recommendation';

// 디자인 토큰은 .claude/steering/design-tokens.md 참조
```

- [ ] **Step 2: 빌드 확인**

```bash
cd web && npx tsc --noEmit
```

- [ ] **Step 3: 커밋**

```bash
git add web/src/components/signals/ShortTermRecommendationSection.tsx
git commit -m "feat: 단기추천 UI 컴포넌트 구현"
```

---

## Task 10: 시그널 페이지 3탭 구조

**Files:**
- Modify: `web/src/app/signals/page.tsx`

- [ ] **Step 1: 탭 구조 변경**

기존 2탭 → 3탭:
```
기존: [AI신호] [종목분석]
변경: [AI신호] [종목추천] [단기추천]
```

변경사항:
- 탭 이름: "종목분석" → "종목추천"
- 세 번째 탭 "단기추천" 추가
- `ShortTermRecommendationSection` 임포트 + 렌더링

```typescript
import ShortTermRecommendationSection from '@/components/signals/ShortTermRecommendationSection';

// 탭 정의
const tabs = ['AI신호', '종목추천', '단기추천'];
```

- [ ] **Step 2: 빌드 확인**

```bash
cd web && npx tsc --noEmit
```

- [ ] **Step 3: 전체 테스트 실행**

```bash
cd web && npx vitest run
```

- [ ] **Step 4: 커밋**

```bash
git add web/src/app/signals/page.tsx
git commit -m "feat: 시그널 페이지 3탭 구조 (AI신호/종목추천/단기추천)"
```

---

## Task 11: 통합 테스트 + 최종 검증

- [ ] **Step 1: 전체 빌드**

```bash
cd web && npm run build
```

- [ ] **Step 2: 전체 테스트**

```bash
cd web && npm run test
```

- [ ] **Step 3: lint 확인**

```bash
cd web && npm run lint
```

- [ ] **Step 4: 개발 서버에서 수동 확인**

```bash
cd web && npm run dev
```

확인 항목:
1. `/signals` 페이지 접속 → 3탭 표시 확인
2. "단기추천" 탭 클릭 → 자동 생성 트리거
3. 가중치 슬라이더 조작 → 합계 100% 유지
4. "이 가중치로 재계산" 버튼 → API 호출 + 결과 갱신
5. 기존 "종목추천" 탭이 정상 작동 (기존 모델 결과만 표시)
6. 필터 제외 종목 접기/펼치기

- [ ] **Step 5: 최종 커밋**

```bash
git add -A
git commit -m "feat: 초단기 반응형 종목 점수 모델 통합 완료"
```

---

## 의존성 그래프

```
Task 1 (DB + Types)
  ├── Task 2 (Pre-filter)
  ├── Task 3 (Momentum)
  ├── Task 4 (Supply)
  ├── Task 5 (Catalyst)
  └── Task 6 (Valuation + Risk)
       └── Task 7 (Orchestrator) ← Task 2~6 모두 필요
            └── Task 8 (API)
                 └── Task 9 (UI Component)
                      └── Task 10 (Page 3-tab)
                           └── Task 11 (Integration)
```

Task 2~6은 **병렬 실행 가능** (서로 독립적). Task 7부터 순차.
