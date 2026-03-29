# 스코어링 투명화 + 체크리스트 판정 시스템 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 기존 종목추천 스코어링에 근거 레이어를 추가하고(접근법 A), 조건 기반 체크리스트 신규 페이지를 만든다(접근법 C).

**Architecture:** 기존 6개 스코어 모듈에 `reasons: ScoreReason[]` 필드와 `normalizedScore` 필드를 추가하고, 오케스트레이터에서 정규화 환산을 제거한다. 체크리스트 페이지는 기존 유틸 함수를 재사용하되 별도 판정 로직을 가진다.

**Tech Stack:** Next.js 16 (App Router), TypeScript, Tailwind CSS v4, Vitest

---

## 파일 구조

```
# 공통 타입 (신규)
web/src/types/score-reason.ts

# 접근법 A — 기존 모듈 수정
web/src/lib/ai-recommendation/signal-score.ts
web/src/lib/ai-recommendation/technical-score.ts
web/src/lib/ai-recommendation/supply-score.ts
web/src/lib/ai-recommendation/valuation-score.ts
web/src/lib/ai-recommendation/risk-score.ts
web/src/lib/ai-recommendation/earnings-momentum-score.ts
web/src/lib/ai-recommendation/index.ts
web/src/types/ai-recommendation.ts

# 접근법 A — UI (신규)
web/src/components/signals/ScoreReasonPopover.tsx

# 접근법 A — UI (수정)
web/src/components/signals/UnifiedAnalysisSection.tsx

# 접근법 C — 체크리스트 로직 (신규)
web/src/lib/checklist-recommendation/types.ts
web/src/lib/checklist-recommendation/checklist-conditions.ts
web/src/lib/checklist-recommendation/index.ts

# 접근법 C — UI (신규)
web/src/components/signals/ChecklistFilterPanel.tsx
web/src/components/signals/ChecklistSection.tsx

# 접근법 C — 라우팅 (수정)
web/src/components/signals/RecommendationView.tsx
web/src/app/signals/page.tsx
```

---

### Task 1: ScoreReason 타입 정의

**Files:**
- Create: `web/src/types/score-reason.ts`
- Test: `web/src/types/score-reason.test.ts`

- [ ] **Step 1: ScoreReason 타입 파일 생성**

```typescript
// web/src/types/score-reason.ts

/** 각 점수 항목의 산출 근거 */
export interface ScoreReason {
  /** 조건명 (예: "골든크로스") */
  label: string;
  /** 기여 점수 — 정규화 후 값 (예: +7.7). 감점이면 음수 */
  points: number;
  /** 수치 근거 (예: "5일선 12,340 > 20일선 12,100") */
  detail: string;
  /** 조건 충족 여부 */
  met: boolean;
}

/** 정규화된 점수 + 근거를 반환하는 모든 스코어 모듈의 공통 인터페이스 */
export interface NormalizedScoreBase {
  /** 원점수 (모듈별 고유 범위) */
  rawScore: number;
  /** 정규화 점수 (0~100) */
  normalizedScore: number;
  /** 산출 근거 목록 */
  reasons: ScoreReason[];
}
```

- [ ] **Step 2: 타입 검증 테스트 작성**

```typescript
// web/src/types/score-reason.test.ts
import { describe, it, expect } from 'vitest';
import type { ScoreReason, NormalizedScoreBase } from './score-reason';

describe('ScoreReason 타입', () => {
  it('ScoreReason 객체를 올바르게 생성할 수 있다', () => {
    const reason: ScoreReason = {
      label: '골든크로스',
      points: 7.7,
      detail: '5일선 12,340 > 20일선 12,100',
      met: true,
    };
    expect(reason.label).toBe('골든크로스');
    expect(reason.met).toBe(true);
  });

  it('NormalizedScoreBase 객체를 올바르게 생성할 수 있다', () => {
    const base: NormalizedScoreBase = {
      rawScore: 42,
      normalizedScore: 64.6,
      reasons: [
        { label: '테스트', points: 10, detail: '설명', met: true },
      ],
    };
    expect(base.normalizedScore).toBeGreaterThanOrEqual(0);
    expect(base.normalizedScore).toBeLessThanOrEqual(100);
    expect(base.reasons).toHaveLength(1);
  });
});
```

- [ ] **Step 3: 테스트 실행**

Run: `cd web && npx vitest run src/types/score-reason.test.ts`
Expected: PASS

- [ ] **Step 4: 커밋**

```bash
git add web/src/types/score-reason.ts web/src/types/score-reason.test.ts
git commit -m "feat: ScoreReason 타입 정의 — 점수 근거 레이어 기반 타입"
```

---

### Task 2: signal-score 모듈에 근거 레이어 + 정규화 추가

**Files:**
- Modify: `web/src/lib/ai-recommendation/signal-score.ts`
- Test: `web/src/lib/ai-recommendation/signal-score.test.ts`

- [ ] **Step 1: 테스트 작성**

```typescript
// web/src/lib/ai-recommendation/signal-score.test.ts
import { describe, it, expect } from 'vitest';
import { calcSignalScore } from './signal-score';

describe('calcSignalScore 근거 레이어', () => {
  it('3소스 신호 시 normalizedScore와 reasons를 반환한다', () => {
    const signals = [
      { source: 'quant', raw_data: { signal_price: 10000 } },
      { source: 'lassi', raw_data: { signal_price: 10000 } },
      { source: 'stockbot', raw_data: { signal_price: 10000 } },
    ];
    const result = calcSignalScore(signals, 5, 9500);

    expect(result.normalizedScore).toBeGreaterThanOrEqual(0);
    expect(result.normalizedScore).toBeLessThanOrEqual(100);
    expect(result.reasons.length).toBeGreaterThan(0);

    const multiSourceReason = result.reasons.find(r => r.label === '다중소스');
    expect(multiSourceReason).toBeDefined();
    expect(multiSourceReason!.met).toBe(true);
    expect(multiSourceReason!.points).toBeGreaterThan(0);
    expect(multiSourceReason!.detail).toContain('3개 소스');
  });

  it('신호 없을 때 normalizedScore 0, 모든 reasons.met = false', () => {
    const result = calcSignalScore([], 0, null);
    expect(result.normalizedScore).toBe(0);
    expect(result.reasons.every(r => !r.met)).toBe(true);
  });

  it('현재가 ≤ 신호가일 때 신호가 하회 근거가 충족된다', () => {
    const signals = [{ source: 'quant', raw_data: { signal_price: 10000 } }];
    const result = calcSignalScore(signals, 1, 9500);

    const belowReason = result.reasons.find(r => r.label === '신호가 하회');
    expect(belowReason).toBeDefined();
    expect(belowReason!.met).toBe(true);
    expect(belowReason!.detail).toContain('9,500');
    expect(belowReason!.detail).toContain('10,000');
  });
});
```

- [ ] **Step 2: 테스트 실행 → 실패 확인**

Run: `cd web && npx vitest run src/lib/ai-recommendation/signal-score.test.ts`
Expected: FAIL (`normalizedScore` 및 `reasons` 미존재)

- [ ] **Step 3: signal-score.ts 수정 — reasons + normalizedScore 추가**

`web/src/lib/ai-recommendation/signal-score.ts`를 다음과 같이 수정:

```typescript
import { extractSignalPrice } from '@/lib/signal-constants';
import type { ScoreReason, NormalizedScoreBase } from '@/types/score-reason';

export interface SignalScoreResult extends NormalizedScoreBase {
  score: number; // 0~30 (하위 호환)
  signal_count: number;
  has_today_signal: boolean;
  has_frequent_signal: boolean;
  signal_below_price: boolean;
}

const MAX_RAW = 30;

function fmt(n: number): string {
  return n.toLocaleString('ko-KR');
}

export function calcSignalScore(
  todaySignals: Array<{ source: string; raw_data: unknown }>,
  recentCount: number,
  currentPrice: number | null
): SignalScoreResult {
  const reasons: ScoreReason[] = [];
  const sources = new Set(todaySignals.map((s) => s.source));
  const sourceCount = sources.size;
  const hasTodaySignal = sourceCount > 0;

  let score = 0;

  // 다중소스
  let multiPts = 0;
  if (sourceCount >= 3) multiPts = 15;
  else if (sourceCount === 2) multiPts = 10;
  else if (sourceCount === 1) multiPts = 5;
  score += multiPts;
  reasons.push({
    label: '다중소스',
    points: (multiPts / MAX_RAW) * 100,
    detail: sourceCount > 0
      ? `${sourceCount}개 소스 (${[...sources].join(', ')})`
      : '신호 없음',
    met: sourceCount > 0,
  });

  // 당일 신호 존재
  const todayPts = hasTodaySignal ? 5 : 0;
  score += todayPts;
  reasons.push({
    label: '당일 신호',
    points: (todayPts / MAX_RAW) * 100,
    detail: hasTodaySignal ? '당일 매수 신호 발생' : '당일 신호 없음',
    met: hasTodaySignal,
  });

  // 최근 30일 빈번 신호
  const hasFrequentSignal = recentCount >= 3;
  const freqPts = hasFrequentSignal ? 5 : 0;
  score += freqPts;
  reasons.push({
    label: '빈번 신호',
    points: (freqPts / MAX_RAW) * 100,
    detail: `최근 30일 ${recentCount}회 (기준: 3회 이상)`,
    met: hasFrequentSignal,
  });

  // 신호가 하회 (현재가 ≤ 신호가)
  let signalBelowPrice = false;
  let belowPts = 0;
  let belowDetail = '신호가 데이터 없음';
  if (currentPrice && todaySignals.length > 0) {
    const signalPrice = extractSignalPrice(
      todaySignals[0].raw_data as Record<string, unknown> | null
    );
    if (signalPrice) {
      if (currentPrice <= signalPrice) {
        belowPts = 5;
        signalBelowPrice = true;
        belowDetail = `현재가 ${fmt(currentPrice)} ≤ 신호가 ${fmt(signalPrice)}`;
      } else {
        belowDetail = `현재가 ${fmt(currentPrice)} > 신호가 ${fmt(signalPrice)}`;
      }
    }
  }
  score += belowPts;
  reasons.push({
    label: '신호가 하회',
    points: (belowPts / MAX_RAW) * 100,
    detail: belowDetail,
    met: signalBelowPrice,
  });

  const rawScore = Math.min(score, MAX_RAW);

  return {
    rawScore,
    normalizedScore: Math.round((rawScore / MAX_RAW) * 1000) / 10,
    reasons,
    score: rawScore,
    signal_count: sourceCount,
    has_today_signal: hasTodaySignal,
    has_frequent_signal: hasFrequentSignal,
    signal_below_price: signalBelowPrice,
  };
}
```

- [ ] **Step 4: 테스트 실행 → 통과 확인**

Run: `cd web && npx vitest run src/lib/ai-recommendation/signal-score.test.ts`
Expected: PASS

- [ ] **Step 5: 커밋**

```bash
git add web/src/lib/ai-recommendation/signal-score.ts web/src/lib/ai-recommendation/signal-score.test.ts
git commit -m "feat: signal-score에 근거 레이어 + 0~100 정규화 추가"
```

---

### Task 3: technical-score 모듈에 근거 레이어 + 정규화 추가

**Files:**
- Modify: `web/src/lib/ai-recommendation/technical-score.ts`
- Test: `web/src/lib/ai-recommendation/technical-score.test.ts`

- [ ] **Step 1: 테스트 작성**

```typescript
// web/src/lib/ai-recommendation/technical-score.test.ts
import { describe, it, expect } from 'vitest';
import { calcTechnicalScore, type DailyPrice } from './technical-score';

function makePrices(count: number, baseClose: number, trend: 'up' | 'flat' = 'flat'): DailyPrice[] {
  return Array.from({ length: count }, (_, i) => {
    const close = trend === 'up' ? baseClose + i * 100 : baseClose;
    return {
      date: `2026-03-${String(i + 1).padStart(2, '0')}`,
      open: close - 50,
      high: close + 100,
      low: close - 100,
      close,
      volume: 100000 + i * 1000,
    };
  });
}

describe('calcTechnicalScore 근거 레이어', () => {
  it('충분한 데이터에서 normalizedScore와 reasons를 반환한다', () => {
    const prices = makePrices(40, 10000, 'up');
    const result = calcTechnicalScore(prices, 15000, 8000, 'small');

    expect(result.normalizedScore).toBeGreaterThanOrEqual(0);
    expect(result.normalizedScore).toBeLessThanOrEqual(100);
    expect(result.reasons.length).toBeGreaterThan(0);
    // 모든 reason에 label, detail이 존재
    for (const r of result.reasons) {
      expect(r.label).toBeTruthy();
      expect(r.detail).toBeTruthy();
      expect(typeof r.points).toBe('number');
      expect(typeof r.met).toBe('boolean');
    }
  });

  it('데이터 부족 시 normalizedScore 0, reasons 비어있음', () => {
    const result = calcTechnicalScore([], null, null, 'small');
    expect(result.normalizedScore).toBe(0);
    expect(result.reasons).toHaveLength(0);
    expect(result.data_insufficient).toBe(true);
  });
});
```

- [ ] **Step 2: 테스트 실행 → 실패 확인**

Run: `cd web && npx vitest run src/lib/ai-recommendation/technical-score.test.ts`
Expected: FAIL

- [ ] **Step 3: technical-score.ts 수정**

`TechnicalScoreResult`에 `NormalizedScoreBase`를 extend하고, 각 조건 블록에서 `reasons.push()`를 추가한다. 만점은 65 유지, `normalizedScore = (rawScore / 65) * 100`.

각 조건의 reasons detail 형식:
- RSI: `"RSI {값} (매수구간 30~50)"` 또는 `"RSI {값} (구간 밖)"`
- 골든크로스: `"5일선 {sma5} > 20일선 {sma20} ({날짜} 상향돌파)"` 또는 `"5일선 {sma5} ≤ 20일선 {sma20}"`
- 볼린저: `"볼린저 하단 {lower} 이탈 후 복귀"` 또는 `"볼린저 하단 미이탈"`
- MACD: `"MACD {macd} > Signal {signal}"` 또는 `"MACD {macd} ≤ Signal {signal}"`
- 불새패턴: `"{일}일 음봉 후 +{pct}% 장대양봉"` 또는 `"불새패턴 미발생"`
- 거래량 급증: `"거래량 {vol}주 (20일 평균 대비 {ratio}배)"` 또는 `"거래량 평균 범위"`
- 이동평균 정배열: `"5일 {sma5} > 20일 {sma20} > 60일 {sma60}"` 등
- 52주 위치: `"52주 위치 {pct}% (저점 {low} ~ 고점 {high})"`
- 이격도 반등: `"이격도 {pct}% + 양봉 (20일선 {sma20})"`
- 거래량 바닥 탈출: `"10일 평균 {avg10} → 오늘 {today} ({ratio}배 탈출)"`
- 연속하락 반등: `"{days}일 연속 하락 후 +{pct}% 반등"`
- 추세지속: `"SMA20 위 {days}일 연속"`

기존 boolean 필드(`golden_cross`, `macd_cross` 등) 및 `score` 필드는 하위 호환을 위해 유지.

- [ ] **Step 4: 테스트 실행 → 통과 확인**

Run: `cd web && npx vitest run src/lib/ai-recommendation/technical-score.test.ts`
Expected: PASS

- [ ] **Step 5: 커밋**

```bash
git add web/src/lib/ai-recommendation/technical-score.ts web/src/lib/ai-recommendation/technical-score.test.ts
git commit -m "feat: technical-score에 근거 레이어 + 0~100 정규화 추가"
```

---

### Task 4: supply-score 모듈에 근거 레이어 + 정규화 추가

**Files:**
- Modify: `web/src/lib/ai-recommendation/supply-score.ts`
- Test: `web/src/lib/ai-recommendation/supply-score.test.ts`

- [ ] **Step 1: 테스트 작성**

```typescript
// web/src/lib/ai-recommendation/supply-score.test.ts
import { describe, it, expect } from 'vitest';
import { calcSupplyScore } from './supply-score';

describe('calcSupplyScore 근거 레이어', () => {
  it('외국인+기관 순매수 시 reasons에 근거가 포함된다', () => {
    const result = calcSupplyScore(
      500000, 10000, 2000000000,
      45230, 12100, 0.5,
      100000, 50000, 3, 1,
      50000 // 시총 5만억
    );

    expect(result.normalizedScore).toBeGreaterThanOrEqual(0);
    expect(result.normalizedScore).toBeLessThanOrEqual(100);

    const foreignReason = result.reasons.find(r => r.label === '외국인 당일');
    expect(foreignReason).toBeDefined();
    expect(foreignReason!.met).toBe(true);
    expect(foreignReason!.detail).toContain('45,230');
  });

  it('모두 null일 때 normalizedScore가 50 근처(중립)', () => {
    const result = calcSupplyScore(null, null, null, null, null, null, null, null, null, null, null);
    // supply score 범위 -10~45, null이면 0점 → 정규화 (0+10)/55*100 ≈ 18.2
    expect(result.normalizedScore).toBeGreaterThanOrEqual(0);
    expect(result.normalizedScore).toBeLessThanOrEqual(100);
  });
});
```

- [ ] **Step 2: 테스트 실행 → 실패 확인**

Run: `cd web && npx vitest run src/lib/ai-recommendation/supply-score.test.ts`

- [ ] **Step 3: supply-score.ts 수정**

`SupplyScoreResult`에 `NormalizedScoreBase`를 extend. 범위 -10~45, `normalizedScore = ((rawScore + 10) / 55) * 100`.

각 조건의 reasons detail:
- 외국인 당일: `"외국인 +{수량}주 ({금액}원, 시총 대비 {%}%)"` (소형주는 금액 생략)
- 기관 당일: `"기관 +{수량}주 ({금액}원)"`
- 5일 누적: `"외국인 5일 누적 +{수량}주 (시총 대비 {%}%)"`
- 연속 매수/매도: `"외국인 {일}일 연속 매수"` 또는 `"외국인 {일}일 연속 매도 ⚠️"`
- 섹터 거래대금: `"거래대금 {억}억 (섹터 평균 대비 {배}배)"`
- 동반매수: `"외국인+기관 동반 순매수"`
- 공매도: `"공매도 {%}% (기준: 1% 미만)"`

- [ ] **Step 4: 테스트 실행 → 통과 확인**

Run: `cd web && npx vitest run src/lib/ai-recommendation/supply-score.test.ts`

- [ ] **Step 5: 커밋**

```bash
git add web/src/lib/ai-recommendation/supply-score.ts web/src/lib/ai-recommendation/supply-score.test.ts
git commit -m "feat: supply-score에 근거 레이어 + 0~100 정규화 추가"
```

---

### Task 5: valuation-score, risk-score, earnings-momentum-score에 근거 레이어 추가

**Files:**
- Modify: `web/src/lib/ai-recommendation/valuation-score.ts`
- Modify: `web/src/lib/ai-recommendation/risk-score.ts`
- Modify: `web/src/lib/ai-recommendation/earnings-momentum-score.ts`
- Test: `web/src/lib/ai-recommendation/valuation-score.test.ts`
- Test: `web/src/lib/ai-recommendation/risk-score.test.ts`
- Test: `web/src/lib/ai-recommendation/earnings-momentum-score.test.ts`

- [ ] **Step 1: valuation-score 테스트 작성**

```typescript
// web/src/lib/ai-recommendation/valuation-score.test.ts
import { describe, it, expect } from 'vitest';
import { calcValuationScore } from './valuation-score';

describe('calcValuationScore 근거 레이어', () => {
  it('Forward PER + 목표주가 시 reasons에 근거 포함', () => {
    const result = calcValuationScore(
      12, 0.8, 15.3, 2.5,
      { forwardPer: 9.8, targetPrice: 85000, investOpinion: 4.5, currentPrice: 62000 },
      'mid'
    );
    expect(result.normalizedScore).toBeGreaterThanOrEqual(0);
    expect(result.normalizedScore).toBeLessThanOrEqual(100);

    const targetReason = result.reasons.find(r => r.label === '목표주가 상승여력');
    expect(targetReason).toBeDefined();
    expect(targetReason!.met).toBe(true);
    expect(targetReason!.detail).toContain('85,000');
    expect(targetReason!.detail).toContain('62,000');
  });
});
```

- [ ] **Step 2: risk-score 테스트 작성**

```typescript
// web/src/lib/ai-recommendation/risk-score.test.ts
import { describe, it, expect } from 'vitest';
import { calcRiskScore } from './risk-score';

describe('calcRiskScore 근거 레이어', () => {
  it('RSI 과매수 + 급등 시 reasons에 감점 근거 포함', () => {
    const result = calcRiskScore({
      rsi: 75, pct5d: 18, disparity20: 1.12,
      bollingerUpper: 11000, currentPrice: 11500,
      doubleTop: false,
      foreignNet: -5000, institutionNet: -3000,
      foreignStreak: -4, institutionStreak: -2,
      shortSellRatio: 12,
    });
    expect(result.normalizedScore).toBeGreaterThanOrEqual(0);
    expect(result.normalizedScore).toBeLessThanOrEqual(100);

    const rsiReason = result.reasons.find(r => r.label === 'RSI 과매수');
    expect(rsiReason).toBeDefined();
    expect(rsiReason!.met).toBe(true);
    expect(rsiReason!.detail).toContain('75');
  });
});
```

- [ ] **Step 3: earnings-momentum-score 테스트 작성**

```typescript
// web/src/lib/ai-recommendation/earnings-momentum-score.test.ts
import { describe, it, expect } from 'vitest';
import { calcEarningsMomentumScore } from './earnings-momentum-score';

describe('calcEarningsMomentumScore 근거 레이어', () => {
  it('EPS 성장 + 목표주가 시 reasons 포함', () => {
    const result = calcEarningsMomentumScore({
      forwardPer: 10, trailingPer: 15,
      targetPrice: 85000, currentPrice: 62000,
      investOpinion: 4.5, roe: 18,
      revenueGrowthYoy: null, operatingProfitGrowthYoy: 25,
    });
    expect(result.normalizedScore).toBeGreaterThanOrEqual(0);
    expect(result.normalizedScore).toBeLessThanOrEqual(100);
    expect(result.reasons.length).toBeGreaterThan(0);

    const epsReason = result.reasons.find(r => r.label === 'EPS 성장률');
    expect(epsReason).toBeDefined();
    expect(epsReason!.met).toBe(true);
  });
});
```

- [ ] **Step 4: 테스트 실행 → 전부 실패 확인**

Run: `cd web && npx vitest run src/lib/ai-recommendation/valuation-score.test.ts src/lib/ai-recommendation/risk-score.test.ts src/lib/ai-recommendation/earnings-momentum-score.test.ts`

- [ ] **Step 5: 3개 모듈 수정**

**valuation-score.ts**: `ValuationScoreResult`에 `NormalizedScoreBase` extend. 만점 25, `normalizedScore = (raw / 25) * 100`. reasons:
- PEG/ForwardPER: `"PEG {값} (Forward PER {값} / EPS성장률 {%}%)"` 또는 `"Forward PER {값}"`
- 목표주가: `"목표 {값} vs 현재 {값} (상승여력 {%}%)"`
- 투자의견: `"애널리스트 합의 {값}/5"`
- PBR: `"PBR {값}"`
- PER: `"Trailing PER {값}"`
- ROE: `"ROE {%}%"`
- 배당수익률: `"배당수익률 {%}%"`

**risk-score.ts**: `RiskScoreResult`에 `NormalizedScoreBase` extend. 만점 100이므로 `normalizedScore = rawScore`. reasons:
- RSI 과매수: `"RSI {값} (기준: 70 이상)"`
- 5일 급등: `"5일 등락률 +{%}% (기준: 10% 이상)"`
- 이격도 과열: `"이격도 {%}% (기준: 110% 이상)"`
- 볼린저 상단: `"현재가 {값} > 볼린저 상단 {값}"`
- 쌍봉: `"고점1 {값} ↔ 고점2 {값}"`
- 스마트머니 이탈: `"외국인 -{수량}주, 기관 -{수량}주"`
- 연속매도: `"외국인 {일}일 연속 매도"`
- 공매도: `"공매도 {%}% (기준: 10% 이상)"`

**earnings-momentum-score.ts**: `EarningsMomentumResult`에 `NormalizedScoreBase` extend. 만점 100, `normalizedScore = rawScore`. reasons:
- EPS 성장률: `"암묵적 EPS 성장률 {%}% (Forward PER {값} vs Trailing PER {값})"`
- 목표주가: `"목표 {값} vs 현재 {값} (상승여력 {%}%)"`
- 투자의견: `"애널리스트 합의 {값}/5"`
- ROE: `"ROE {%}%"`
- 실적성장: `"영업이익 YoY +{%}%"` 또는 `"매출 YoY +{%}%"`

- [ ] **Step 6: 테스트 실행 → 통과 확인**

Run: `cd web && npx vitest run src/lib/ai-recommendation/valuation-score.test.ts src/lib/ai-recommendation/risk-score.test.ts src/lib/ai-recommendation/earnings-momentum-score.test.ts`

- [ ] **Step 7: 커밋**

```bash
git add web/src/lib/ai-recommendation/valuation-score.ts web/src/lib/ai-recommendation/risk-score.ts web/src/lib/ai-recommendation/earnings-momentum-score.ts web/src/lib/ai-recommendation/valuation-score.test.ts web/src/lib/ai-recommendation/risk-score.test.ts web/src/lib/ai-recommendation/earnings-momentum-score.test.ts
git commit -m "feat: valuation/risk/earnings-momentum 모듈에 근거 레이어 + 정규화 추가"
```

---

### Task 6: 오케스트레이터 정규화 환산 제거 + reasons 전달

**Files:**
- Modify: `web/src/lib/ai-recommendation/index.ts`
- Modify: `web/src/types/ai-recommendation.ts`

- [ ] **Step 1: ai-recommendation.ts 타입에 reasons 필드 추가**

`AiRecommendation` 인터페이스에 추가:

```typescript
import type { ScoreReason } from './score-reason';

// 기존 필드 유지 + 추가
export interface AiRecommendation {
  // ... 기존 필드 모두 유지 ...

  // 정규화 점수 (0~100) — 신규
  signal_norm: number;
  trend_norm: number;
  valuation_norm: number;
  supply_norm: number;
  earnings_momentum_norm: number;
  risk_norm: number;

  // 근거 목록 — 신규
  signal_reasons: ScoreReason[];
  trend_reasons: ScoreReason[];
  valuation_reasons: ScoreReason[];
  supply_reasons: ScoreReason[];
  earnings_momentum_reasons: ScoreReason[];
  risk_reasons: ScoreReason[];
}
```

- [ ] **Step 2: index.ts 오케스트레이터 수정**

총점 계산 부분을 다음과 같이 변경:

```typescript
// 기존 (제거)
// const base =
//   (signalResult.score / 30) * weights.signal +
//   (technicalResult.score / 65) * weights.trend +
//   ...

// 신규: 각 모듈이 normalizedScore를 직접 반환
const base =
  (signalResult.normalizedScore / 100) * weights.signal +
  (technicalResult.normalizedScore / 100) * weights.trend +
  (valuationResult.normalizedScore / 100) * weights.valuation +
  (supplyResult.normalizedScore / 100) * weights.supply +
  (earningsMomentumResult.normalizedScore / 100) * weights.earnings_momentum;

const total_score = Math.max(0, Math.min(
  base - (riskResult.normalizedScore / 100) * weights.risk,
  100
));
```

반환 객체에 `*_norm` 및 `*_reasons` 필드 추가:

```typescript
return {
  // ... 기존 필드 유지 ...
  signal_norm: signalResult.normalizedScore,
  trend_norm: technicalResult.normalizedScore,
  valuation_norm: valuationResult.normalizedScore,
  supply_norm: supplyResult.normalizedScore,
  earnings_momentum_norm: earningsMomentumResult.normalizedScore,
  risk_norm: riskResult.normalizedScore,
  signal_reasons: signalResult.reasons,
  trend_reasons: technicalResult.reasons,
  valuation_reasons: valuationResult.reasons,
  supply_reasons: supplyResult.reasons,
  earnings_momentum_reasons: earningsMomentumResult.reasons,
  risk_reasons: riskResult.reasons,
};
```

- [ ] **Step 3: 빌드 확인**

Run: `cd web && npx tsc --noEmit`
Expected: 타입 에러 없음

- [ ] **Step 4: 커밋**

```bash
git add web/src/lib/ai-recommendation/index.ts web/src/types/ai-recommendation.ts
git commit -m "feat: 오케스트레이터 정규화 환산 제거, reasons 전달 구조 완성"
```

---

### Task 7: ScoreReasonPopover UI 컴포넌트 (접근법 A)

**Files:**
- Create: `web/src/components/signals/ScoreReasonPopover.tsx`

- [ ] **Step 1: ScoreReasonPopover 컴포넌트 생성**

```typescript
// web/src/components/signals/ScoreReasonPopover.tsx
'use client';

import { useState, useRef, useEffect } from 'react';
import type { ScoreReason } from '@/types/score-reason';

interface Props {
  label: string;           // "추세", "밸류" 등
  normalizedScore: number; // 0~100
  reasons: ScoreReason[];
  variant?: 'default' | 'risk'; // risk는 감점 표시
  children: React.ReactNode;    // 클릭 트리거 (기존 점수 바)
}

export default function ScoreReasonPopover({
  label, normalizedScore, reasons, variant = 'default', children,
}: Props) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  return (
    <div ref={ref} className="relative">
      <button type="button" onClick={() => setOpen(!open)} className="w-full text-left">
        {children}
      </button>

      {open && (
        <div className="absolute z-50 top-full mt-1 left-0 right-0 min-w-[280px] max-w-[360px] rounded-lg border border-[var(--border)] bg-[var(--card)] shadow-lg p-3 space-y-2">
          {/* 헤더 */}
          <div className="flex items-center justify-between text-sm font-semibold">
            <span>{label}</span>
            <span className={variant === 'risk' ? 'text-red-400' : 'text-[var(--accent)]'}>
              {Math.round(normalizedScore)}/100
            </span>
          </div>

          <div className="h-px bg-[var(--border)]" />

          {/* 근거 목록 */}
          <div className="space-y-1.5">
            {reasons.map((r, i) => (
              <div key={i} className="flex items-start gap-2 text-xs">
                <span className="mt-0.5 shrink-0">
                  {r.met ? '✅' : '❌'}
                </span>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1.5">
                    <span className="font-medium text-[var(--text)]">{r.label}</span>
                    {r.met && (
                      <span className={`font-mono ${variant === 'risk' ? 'text-red-400' : 'text-green-400'}`}>
                        {r.points > 0 ? '+' : ''}{r.points.toFixed(1)}
                      </span>
                    )}
                  </div>
                  <p className="text-[var(--muted)] break-words">{r.detail}</p>
                </div>
              </div>
            ))}
          </div>

          {reasons.length === 0 && (
            <p className="text-xs text-[var(--muted)]">데이터 부족</p>
          )}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: 커밋**

```bash
git add web/src/components/signals/ScoreReasonPopover.tsx
git commit -m "feat: ScoreReasonPopover 컴포넌트 — 점수 근거 팝오버 UI"
```

---

### Task 8: UnifiedAnalysisSection에 팝오버 연결

**Files:**
- Modify: `web/src/components/signals/UnifiedAnalysisSection.tsx`

- [ ] **Step 1: 기존 점수 바 영역을 ScoreReasonPopover로 감싸기**

`UnifiedAnalysisSection.tsx`에서 각 종목 카드의 점수 표시 영역(sig, tech, val, sup)을 찾아 `ScoreReasonPopover`로 래핑한다.

현재 `normScores(item)` 함수가 0~100 정규화를 수행하는데, 이제 `item.ai`에 `*_norm`과 `*_reasons`가 직접 들어오므로:

1. `StockRankItem` 타입의 `ai` 필드에 `*_norm`, `*_reasons` 추가 (stock-ranking route에서 전달)
2. `normScores()` 함수를 수정하여 `ai.*_norm` 값을 우선 사용
3. 점수 바 렌더링 부분에서 `ScoreReasonPopover`로 감싸기:

```tsx
import ScoreReasonPopover from './ScoreReasonPopover';

// 점수 바 영역 (기존 코드를 감싸는 형태)
<ScoreReasonPopover
  label="추세"
  normalizedScore={item.ai?.trend_norm ?? scores.tech}
  reasons={item.ai?.trend_reasons ?? []}
>
  {/* 기존 점수 바 JSX */}
  <div className="...">추세 {scores.tech}</div>
</ScoreReasonPopover>
```

각 영역(신호, 추세, 밸류, 수급)에 동일 패턴 적용. 리스크는 `variant="risk"`로 표시.

- [ ] **Step 2: 빌드 확인**

Run: `cd web && npx tsc --noEmit`

- [ ] **Step 3: 커밋**

```bash
git add web/src/components/signals/UnifiedAnalysisSection.tsx
git commit -m "feat: 종목추천 점수 영역에 ScoreReasonPopover 연결"
```

---

### Task 9: 체크리스트 타입 및 조건 판정 로직 (접근법 C)

**Files:**
- Create: `web/src/lib/checklist-recommendation/types.ts`
- Create: `web/src/lib/checklist-recommendation/checklist-conditions.ts`
- Test: `web/src/lib/checklist-recommendation/checklist-conditions.test.ts`

- [ ] **Step 1: 타입 정의**

```typescript
// web/src/lib/checklist-recommendation/types.ts

export type ConditionCategory = 'trend' | 'supply' | 'valuation' | 'risk';

export interface ConditionDef {
  id: string;               // "ma_aligned", "rsi_buy_zone" 등
  label: string;             // "이동평균 정배열"
  category: ConditionCategory;
}

export interface ConditionResult {
  id: string;
  label: string;
  category: ConditionCategory;
  met: boolean;              // 충족 여부
  detail: string;            // 수치 근거
  na: boolean;               // 데이터 없어서 판정 불가
}

export type ChecklistGrade = 'A' | 'B' | 'C' | 'D';

export interface ChecklistItem {
  symbol: string;
  name: string;
  currentPrice: number | null;
  grade: ChecklistGrade;
  gradeLabel: string;        // "적극매수", "매수 고려" 등
  metCount: number;          // 충족 개수
  activeCount: number;       // 활성 조건 수 (토글 ON)
  metRatio: number;          // metCount / activeCount
  conditions: ConditionResult[];
}

export const ALL_CONDITIONS: ConditionDef[] = [
  // 추세
  { id: 'ma_aligned',       label: '이동평균 정배열',    category: 'trend' },
  { id: 'rsi_buy_zone',     label: 'RSI 매수구간',      category: 'trend' },
  { id: 'macd_golden',      label: 'MACD/골든크로스',   category: 'trend' },
  // 수급
  { id: 'foreign_buy',      label: '외국인 순매수',      category: 'supply' },
  { id: 'institution_buy',  label: '기관 순매수',        category: 'supply' },
  { id: 'volume_active',    label: '거래량 활성',        category: 'supply' },
  // 밸류
  { id: 'per_fair',         label: 'PER 적정',          category: 'valuation' },
  { id: 'target_upside',    label: '목표주가 괴리',      category: 'valuation' },
  { id: 'roe_good',         label: 'ROE 양호',          category: 'valuation' },
  // 리스크 (역방향: "위험 없음"이 충족)
  { id: 'no_overbought',    label: '과매수 없음',        category: 'risk' },
  { id: 'no_surge',         label: '급등 없음',          category: 'risk' },
  { id: 'no_smart_exit',    label: '스마트머니 이탈 없음', category: 'risk' },
];
```

- [ ] **Step 2: 조건 판정 테스트 작성**

```typescript
// web/src/lib/checklist-recommendation/checklist-conditions.test.ts
import { describe, it, expect } from 'vitest';
import { evaluateConditions } from './checklist-conditions';
import type { DailyPrice } from '@/lib/ai-recommendation/technical-score';

function makePrices(count: number, base: number): DailyPrice[] {
  return Array.from({ length: count }, (_, i) => ({
    date: `2026-03-${String(i + 1).padStart(2, '0')}`,
    open: base - 50 + i * 50, high: base + 200 + i * 50,
    low: base - 200 + i * 50, close: base + i * 50,
    volume: 100000,
  }));
}

describe('evaluateConditions', () => {
  it('12개 조건 결과를 반환한다', () => {
    const results = evaluateConditions({
      prices: makePrices(65, 10000),
      high52w: 15000, low52w: 8000,
      foreignNet: 5000, institutionNet: 3000,
      foreignStreak: 3, institutionStreak: 1,
      currentVolume: 200000, avgVolume20d: 100000,
      per: 10, forwardPer: 8, pbr: 0.8, roe: 15,
      targetPrice: 85000, currentPrice: 62000,
      investOpinion: 4.5,
      rsi: null, // 내부에서 계산
      pct5d: 3,
      shortSellRatio: 0.5,
    });

    expect(results).toHaveLength(12);
    // 모든 결과에 필수 필드 존재
    for (const r of results) {
      expect(r.id).toBeTruthy();
      expect(r.label).toBeTruthy();
      expect(typeof r.met).toBe('boolean');
      expect(r.detail).toBeTruthy();
    }
  });

  it('데이터 없으면 na=true로 표시', () => {
    const results = evaluateConditions({
      prices: [],
      high52w: null, low52w: null,
      foreignNet: null, institutionNet: null,
      foreignStreak: null, institutionStreak: null,
      currentVolume: null, avgVolume20d: null,
      per: null, forwardPer: null, pbr: null, roe: null,
      targetPrice: null, currentPrice: null,
      investOpinion: null,
      rsi: null, pct5d: 0, shortSellRatio: null,
    });

    const naCount = results.filter(r => r.na).length;
    expect(naCount).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 3: 테스트 실행 → 실패 확인**

Run: `cd web && npx vitest run src/lib/checklist-recommendation/checklist-conditions.test.ts`

- [ ] **Step 4: checklist-conditions.ts 구현**

```typescript
// web/src/lib/checklist-recommendation/checklist-conditions.ts
import { calcSMA, calcRSI } from '@/lib/ai-recommendation/technical-score';
import type { DailyPrice } from '@/lib/ai-recommendation/technical-score';
import type { ConditionResult } from './types';
import { ALL_CONDITIONS } from './types';

// calcRSI는 현재 모듈 내부 함수이므로 export 필요 → Task 3에서 이미 export됨
// 안 되어 있으면 별도 구현

export interface ConditionInput {
  prices: DailyPrice[];
  high52w: number | null;
  low52w: number | null;
  foreignNet: number | null;
  institutionNet: number | null;
  foreignStreak: number | null;
  institutionStreak: number | null;
  currentVolume: number | null;
  avgVolume20d: number | null;
  per: number | null;
  forwardPer: number | null;
  pbr: number | null;
  roe: number | null;
  targetPrice: number | null;
  currentPrice: number | null;
  investOpinion: number | null;
  rsi: number | null;
  pct5d: number;
  shortSellRatio: number | null;
}

function fmt(n: number): string {
  return n.toLocaleString('ko-KR');
}

export function evaluateConditions(input: ConditionInput): ConditionResult[] {
  const closes = input.prices.map(p => p.close);
  const hasEnoughData = closes.length >= 20;

  // 사전 계산
  const sma5 = hasEnoughData ? calcSMA(closes, 5) : [];
  const sma20 = hasEnoughData ? calcSMA(closes, 20) : [];
  const sma60 = closes.length >= 60 ? calcSMA(closes, 60) : [];

  const latest5 = sma5.length > 0 ? sma5[sma5.length - 1] : null;
  const latest20 = sma20.length > 0 ? sma20[sma20.length - 1] : null;
  const latest60 = sma60.length > 0 ? sma60[sma60.length - 1] : null;

  // RSI: 외부 전달값 우선, 없으면 내부 계산
  const rsi = input.rsi ?? (hasEnoughData ? calcRSI(closes) : null);

  const results: ConditionResult[] = [];

  for (const def of ALL_CONDITIONS) {
    let met = false;
    let detail = '데이터 부족';
    let na = false;

    switch (def.id) {
      case 'ma_aligned': {
        if (latest5 !== null && latest20 !== null && latest60 !== null) {
          met = latest5 > latest20 && latest20 > latest60;
          detail = met
            ? `5일 ${fmt(Math.round(latest5))} > 20일 ${fmt(Math.round(latest20))} > 60일 ${fmt(Math.round(latest60))}`
            : `5일 ${fmt(Math.round(latest5))}, 20일 ${fmt(Math.round(latest20))}, 60일 ${fmt(Math.round(latest60))} (정배열 아님)`;
        } else if (latest5 !== null && latest20 !== null) {
          met = false;
          detail = `60일선 데이터 부족 (5일 ${fmt(Math.round(latest5))}, 20일 ${fmt(Math.round(latest20))})`;
          na = true;
        } else { na = true; }
        break;
      }
      case 'rsi_buy_zone': {
        if (rsi !== null) {
          met = rsi >= 30 && rsi <= 50;
          detail = `RSI ${rsi.toFixed(1)} ${met ? '(매수구간 30~50)' : rsi < 30 ? '(과매도)' : '(구간 밖)'}`;
        } else { na = true; }
        break;
      }
      case 'macd_golden': {
        if (!hasEnoughData) { na = true; break; }
        // 골든크로스: 5일선이 20일선 상향돌파 (최근 3일)
        let found = false;
        let crossDetail = 'MACD/골든크로스 미발생';
        if (sma5.length >= 4 && sma20.length >= 4) {
          const offset = sma5.length - sma20.length;
          for (let i = Math.max(1, sma20.length - 3); i < sma20.length; i++) {
            const i5 = i + offset;
            if (i5 >= 1 && i5 < sma5.length) {
              if (sma5[i5 - 1] <= sma20[i - 1] && sma5[i5] > sma20[i]) {
                found = true;
                crossDetail = `골든크로스: 5일선 ${fmt(Math.round(sma5[i5]))} > 20일선 ${fmt(Math.round(sma20[i]))}`;
                break;
              }
            }
          }
        }
        met = found;
        detail = crossDetail;
        break;
      }
      case 'foreign_buy': {
        if (input.foreignNet !== null) {
          met = input.foreignNet > 0;
          const streak = input.foreignStreak ?? 0;
          const streakStr = streak > 0 ? ` (${streak}일 연속)` : streak === 1 ? ' (전환 첫날)' : '';
          detail = met
            ? `+${fmt(input.foreignNet)}주${streakStr}`
            : `${fmt(input.foreignNet)}주 (순매도)`;
        } else { na = true; }
        break;
      }
      case 'institution_buy': {
        if (input.institutionNet !== null) {
          met = input.institutionNet > 0;
          const streak = input.institutionStreak ?? 0;
          const streakStr = streak > 0 ? ` (${streak}일 연속)` : streak === 1 ? ' (전환 첫날)' : '';
          detail = met
            ? `+${fmt(input.institutionNet)}주${streakStr}`
            : `${fmt(input.institutionNet)}주 (순매도)`;
        } else { na = true; }
        break;
      }
      case 'volume_active': {
        if (input.currentVolume !== null && input.avgVolume20d !== null && input.avgVolume20d > 0) {
          const ratio = input.currentVolume / input.avgVolume20d;
          met = ratio >= 1.5;
          detail = `${fmt(input.currentVolume)}주 (평균 대비 ${ratio.toFixed(1)}배)`;
        } else { na = true; }
        break;
      }
      case 'per_fair': {
        if (input.forwardPer !== null && input.forwardPer > 0) {
          met = input.forwardPer < 15;
          detail = `Forward PER ${input.forwardPer.toFixed(1)} ${met ? '(기준: 15 미만)' : '(기준 초과)'}`;
        } else if (input.per !== null && input.per > 0) {
          met = input.per < 12;
          detail = `Trailing PER ${input.per.toFixed(1)} ${met ? '(기준: 12 미만)' : '(기준 초과)'}`;
        } else { na = true; }
        break;
      }
      case 'target_upside': {
        if (input.targetPrice !== null && input.currentPrice !== null && input.currentPrice > 0) {
          const upside = ((input.targetPrice - input.currentPrice) / input.currentPrice) * 100;
          met = upside >= 15;
          detail = `목표 ${fmt(input.targetPrice)} vs 현재 ${fmt(input.currentPrice)} (${upside >= 0 ? '+' : ''}${upside.toFixed(0)}%)`;
        } else { na = true; }
        break;
      }
      case 'roe_good': {
        if (input.roe !== null) {
          met = input.roe > 10;
          detail = `ROE ${input.roe.toFixed(1)}% ${met ? '' : '(기준: 10% 초과)'}`;
        } else { na = true; }
        break;
      }
      case 'no_overbought': {
        if (rsi !== null) {
          met = rsi < 70;
          detail = `RSI ${rsi.toFixed(1)} ${met ? '✅' : '(과매수 ≥70)'}`;
        } else { na = true; }
        break;
      }
      case 'no_surge': {
        met = input.pct5d < 15;
        detail = `5일 ${input.pct5d >= 0 ? '+' : ''}${input.pct5d.toFixed(1)}% ${met ? '✅' : '(급등 ≥15%)'}`;
        break;
      }
      case 'no_smart_exit': {
        if (input.foreignNet !== null && input.institutionNet !== null) {
          const bothSelling = input.foreignNet < 0 && input.institutionNet < 0;
          met = !bothSelling;
          detail = met
            ? '외국인·기관 동반매도 아님'
            : `외국인 ${fmt(input.foreignNet)}주, 기관 ${fmt(input.institutionNet)}주 (동반 매도 ⚠️)`;
        } else { na = true; }
        break;
      }
    }

    results.push({ id: def.id, label: def.label, category: def.category, met, detail, na });
  }

  return results;
}
```

참고: `calcRSI`가 현재 `technical-score.ts` 내부 함수인데 export해야 한다. Task 3에서 `technical-score.ts`를 수정할 때 `calcRSI`도 export하도록 변경한다.

- [ ] **Step 5: 테스트 실행 → 통과 확인**

Run: `cd web && npx vitest run src/lib/checklist-recommendation/checklist-conditions.test.ts`

- [ ] **Step 6: 커밋**

```bash
git add web/src/lib/checklist-recommendation/types.ts web/src/lib/checklist-recommendation/checklist-conditions.ts web/src/lib/checklist-recommendation/checklist-conditions.test.ts
git commit -m "feat: 체크리스트 12개 조건 판정 로직 구현"
```

---

### Task 10: 체크리스트 오케스트레이터

**Files:**
- Create: `web/src/lib/checklist-recommendation/index.ts`

- [ ] **Step 1: 오케스트레이터 구현**

기존 `ai-recommendation/index.ts`의 데이터 조회 패턴을 재사용하되, 점수가 아닌 조건 판정을 수행한다.

```typescript
// web/src/lib/checklist-recommendation/index.ts
import { SupabaseClient } from '@supabase/supabase-js';
import { fetchTodayBuySymbols, getTodayKst } from '@/lib/ai-recommendation/index';
import { calcSMA, type DailyPrice } from '@/lib/ai-recommendation/technical-score';
import { fetchBulkInvestorData, fetchNaverDailyPrices } from '@/lib/naver-stock-api';
import { fetchBulkIndicators } from '@/lib/krx-api';
import { evaluateConditions, type ConditionInput } from './checklist-conditions';
import type { ChecklistItem, ChecklistGrade } from './types';

function calcGrade(ratio: number): { grade: ChecklistGrade; gradeLabel: string } {
  if (ratio >= 0.8) return { grade: 'A', gradeLabel: '적극매수' };
  if (ratio >= 0.6) return { grade: 'B', gradeLabel: '매수 고려' };
  if (ratio >= 0.4) return { grade: 'C', gradeLabel: '관망' };
  return { grade: 'D', gradeLabel: '주의' };
}

export async function generateChecklist(
  supabase: SupabaseClient,
  activeConditionIds: string[],
  limit = 30,
): Promise<{ items: ChecklistItem[]; total_candidates: number }> {
  const todayKst = getTodayKst();
  const candidates = await fetchTodayBuySymbols(supabase, todayKst);
  if (candidates.length === 0) return { items: [], total_candidates: 0 };

  const symbols = candidates.map(c => c.symbol);

  // 기존 오케스트레이터와 동일한 병렬 데이터 조회 (생략 — ai-recommendation/index.ts의
  // Promise.all 패턴을 그대로 가져옴: cacheData, priceRows, todaySignalRows 등)
  // 여기서는 핵심 로직만 표시

  const [
    { data: cacheData },
    { data: priceRows },
  ] = await Promise.all([
    supabase
      .from('stock_cache')
      .select('symbol, per, pbr, roe, volume, current_price, high_52w, low_52w, short_sell_ratio, foreign_net_qty, institution_net_qty, investor_updated_at, foreign_net_5d, institution_net_5d, foreign_streak, institution_streak, market_cap, forward_per, target_price, invest_opinion')
      .in('symbol', symbols),
    supabase
      .from('daily_prices')
      .select('symbol, date, open, high, low, close, volume')
      .in('symbol', symbols)
      .order('date', { ascending: false })
      .limit(symbols.length * 65),
  ]);

  const cacheMap = new Map((cacheData ?? []).map(c => [c.symbol, c]));
  const priceMap = new Map<string, DailyPrice[]>();
  for (const row of priceRows ?? []) {
    const sym = row.symbol as string;
    if (!priceMap.has(sym)) priceMap.set(sym, []);
    priceMap.get(sym)!.push(row as DailyPrice);
  }
  for (const [sym, rows] of priceMap) {
    priceMap.set(sym, rows.reverse().slice(-65));
  }

  // 투자자 데이터 live 보강 (기존 패턴)
  const todayStr = todayKst;
  const symbolsNeedingLive = symbols.filter(sym => {
    const c = cacheMap.get(sym);
    if (!c?.investor_updated_at) return true;
    return (c.investor_updated_at as string).slice(0, 10) !== todayStr;
  });
  const liveInvestorMap = symbolsNeedingLive.length > 0
    ? await fetchBulkInvestorData(symbolsNeedingLive)
    : new Map();

  // 각 종목 조건 판정
  const items: ChecklistItem[] = candidates.map(({ symbol, name }) => {
    const cache = cacheMap.get(symbol);
    const prices = priceMap.get(symbol) ?? [];
    const closes = prices.map(p => p.close);
    const volumes = prices.map(p => p.volume);

    const cachedFresh = cache?.investor_updated_at &&
      (cache.investor_updated_at as string).slice(0, 10) === todayStr;
    const liveInv = liveInvestorMap.get(symbol);

    const foreignNet = cachedFresh ? cache!.foreign_net_qty : (liveInv?.foreign_net ?? null);
    const institutionNet = cachedFresh ? cache!.institution_net_qty : (liveInv?.institution_net ?? null);
    const foreignStreak = cachedFresh ? cache!.foreign_streak : (liveInv?.foreign_streak ?? null);
    const institutionStreak = cachedFresh ? cache!.institution_streak : (liveInv?.institution_streak ?? null);

    const avgVol20 = volumes.length >= 21
      ? volumes.slice(-21, -1).reduce((a, b) => a + b, 0) / 20
      : null;

    const pct5d = closes.length >= 6
      ? ((closes[closes.length - 1] - closes[closes.length - 6]) / closes[closes.length - 6]) * 100
      : 0;

    const condInput: ConditionInput = {
      prices,
      high52w: cache?.high_52w ?? null,
      low52w: cache?.low_52w ?? null,
      foreignNet: foreignNet as number | null,
      institutionNet: institutionNet as number | null,
      foreignStreak: foreignStreak as number | null,
      institutionStreak: institutionStreak as number | null,
      currentVolume: cache?.volume ?? null,
      avgVolume20d: avgVol20,
      per: cache?.per ?? null,
      forwardPer: cache?.forward_per ?? null,
      pbr: cache?.pbr ?? null,
      roe: cache?.roe ?? null,
      targetPrice: cache?.target_price ?? null,
      currentPrice: cache?.current_price ?? null,
      investOpinion: cache?.invest_opinion ?? null,
      rsi: null,
      pct5d,
      shortSellRatio: cache?.short_sell_ratio ?? null,
    };

    const allConditions = evaluateConditions(condInput);

    // 활성 조건만 필터
    const activeConditions = allConditions.filter(c => activeConditionIds.includes(c.id));
    const judgeable = activeConditions.filter(c => !c.na);
    const metCount = judgeable.filter(c => c.met).length;
    const activeCount = judgeable.length;
    const metRatio = activeCount > 0 ? metCount / activeCount : 0;

    const { grade, gradeLabel } = calcGrade(metRatio);

    return {
      symbol,
      name: name ?? symbol,
      currentPrice: cache?.current_price ?? null,
      grade,
      gradeLabel,
      metCount,
      activeCount,
      metRatio,
      conditions: allConditions, // 전체 반환 (UI에서 활성/비활성 표시)
    };
  });

  // 등급 → 충족비율 내림차순 정렬
  items.sort((a, b) => b.metRatio - a.metRatio);

  return { items: items.slice(0, limit), total_candidates: candidates.length };
}
```

- [ ] **Step 2: 커밋**

```bash
git add web/src/lib/checklist-recommendation/index.ts
git commit -m "feat: 체크리스트 오케스트레이터 — 데이터 조회 + 조건 판정 통합"
```

---

### Task 11: ChecklistFilterPanel + ChecklistSection UI 컴포넌트

**Files:**
- Create: `web/src/components/signals/ChecklistFilterPanel.tsx`
- Create: `web/src/components/signals/ChecklistSection.tsx`

- [ ] **Step 1: ChecklistFilterPanel 생성**

```typescript
// web/src/components/signals/ChecklistFilterPanel.tsx
'use client';

import { useState, useEffect } from 'react';
import { ALL_CONDITIONS, type ConditionCategory } from '@/lib/checklist-recommendation/types';

const STORAGE_KEY = 'checklist-conditions';

const CATEGORY_LABELS: Record<ConditionCategory, string> = {
  trend: '추세', supply: '수급', valuation: '밸류', risk: '리스크',
};

interface Props {
  onChange: (activeIds: string[]) => void;
}

export default function ChecklistFilterPanel({ onChange }: Props) {
  const [activeIds, setActiveIds] = useState<Set<string>>(() => {
    if (typeof window === 'undefined') return new Set(ALL_CONDITIONS.map(c => c.id));
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored) return new Set(JSON.parse(stored) as string[]);
    } catch { /* ignore */ }
    return new Set(ALL_CONDITIONS.map(c => c.id));
  });

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify([...activeIds]));
    onChange([...activeIds]);
  }, [activeIds, onChange]);

  const toggle = (id: string) => {
    setActiveIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const toggleCategory = (cat: ConditionCategory) => {
    const catIds = ALL_CONDITIONS.filter(c => c.category === cat).map(c => c.id);
    const allOn = catIds.every(id => activeIds.has(id));
    setActiveIds(prev => {
      const next = new Set(prev);
      for (const id of catIds) {
        if (allOn) next.delete(id); else next.add(id);
      }
      return next;
    });
  };

  const categories = ['trend', 'supply', 'valuation', 'risk'] as ConditionCategory[];

  return (
    <div className="rounded-lg border border-[var(--border)] bg-[var(--card)] p-3 space-y-3">
      <div className="text-xs font-semibold text-[var(--muted)]">조건 필터</div>
      {categories.map(cat => {
        const items = ALL_CONDITIONS.filter(c => c.category === cat);
        const allOn = items.every(c => activeIds.has(c.id));
        return (
          <div key={cat} className="space-y-1">
            <button
              type="button"
              onClick={() => toggleCategory(cat)}
              className="text-xs font-medium text-[var(--text)] flex items-center gap-1.5"
            >
              <span className={`w-3 h-3 rounded border ${allOn ? 'bg-[var(--accent)] border-[var(--accent)]' : 'border-[var(--border)]'}`} />
              {CATEGORY_LABELS[cat]}
            </button>
            <div className="flex flex-wrap gap-1.5 ml-4">
              {items.map(c => (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => toggle(c.id)}
                  className={`px-2 py-0.5 text-xs rounded-full border transition-colors ${
                    activeIds.has(c.id)
                      ? 'bg-[var(--accent)]/10 border-[var(--accent)] text-[var(--accent)]'
                      : 'border-[var(--border)] text-[var(--muted)]'
                  }`}
                >
                  {c.label}
                </button>
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}
```

- [ ] **Step 2: ChecklistSection 생성**

```typescript
// web/src/components/signals/ChecklistSection.tsx
'use client';

import { useState, useCallback, useEffect } from 'react';
import ChecklistFilterPanel from './ChecklistFilterPanel';
import { ALL_CONDITIONS } from '@/lib/checklist-recommendation/types';
import type { ChecklistItem, ConditionCategory, ChecklistGrade } from '@/lib/checklist-recommendation/types';

const GRADE_COLORS: Record<ChecklistGrade, string> = {
  A: 'bg-green-500', B: 'bg-blue-500', C: 'bg-orange-500', D: 'bg-red-500',
};
const CATEGORY_LABELS: Record<ConditionCategory, string> = {
  trend: '추세', supply: '수급', valuation: '밸류', risk: '리스크',
};

interface Props {
  initialDateMode?: 'today' | 'signal_all';
}

export default function ChecklistSection({ initialDateMode = 'today' }: Props) {
  const [activeIds, setActiveIds] = useState<string[]>(ALL_CONDITIONS.map(c => c.id));
  const [items, setItems] = useState<ChecklistItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [total, setTotal] = useState(0);

  const fetchData = useCallback(async (ids: string[]) => {
    setLoading(true);
    try {
      const res = await fetch(`/api/v1/stock-ranking?mode=checklist&conditions=${ids.join(',')}`);
      if (!res.ok) throw new Error('fetch failed');
      const data = await res.json();
      setItems(data.items ?? []);
      setTotal(data.total_candidates ?? 0);
    } catch {
      setItems([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (activeIds.length > 0) fetchData(activeIds);
    else setItems([]);
  }, [activeIds, fetchData]);

  const handleFilterChange = useCallback((ids: string[]) => {
    setActiveIds(ids);
  }, []);

  const categories = ['trend', 'supply', 'valuation', 'risk'] as ConditionCategory[];

  return (
    <div className="space-y-4">
      <ChecklistFilterPanel onChange={handleFilterChange} />

      {loading && <div className="text-center text-sm text-[var(--muted)] py-8">로딩 중...</div>}

      {!loading && items.length === 0 && (
        <div className="text-center text-sm text-[var(--muted)] py-8">오늘 매수 신호 종목이 없습니다</div>
      )}

      <div className="text-xs text-[var(--muted)]">{total}개 종목 중 상위 {items.length}개</div>

      <div className="space-y-3">
        {items.map(item => {
          const activeConditions = item.conditions.filter(c => activeIds.includes(c.id));
          return (
            <div key={item.symbol} className="rounded-lg border border-[var(--border)] bg-[var(--card)] p-3 space-y-2">
              {/* 헤더 */}
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className="font-semibold text-sm text-[var(--text)]">{item.name}</span>
                  <span className="text-xs text-[var(--muted)]">{item.symbol}</span>
                </div>
                <div className="flex items-center gap-2">
                  <span className={`px-2 py-0.5 rounded text-xs font-bold text-white ${GRADE_COLORS[item.grade]}`}>
                    {item.grade}
                  </span>
                  <span className="text-xs text-[var(--muted)]">
                    {item.metCount}/{item.activeCount} 충족
                  </span>
                </div>
              </div>

              {/* 카테고리별 조건 */}
              {categories.map(cat => {
                const catConditions = activeConditions.filter(c => c.category === cat);
                if (catConditions.length === 0) return null;
                const catMet = catConditions.filter(c => c.met && !c.na).length;
                const catTotal = catConditions.filter(c => !c.na).length;
                return (
                  <div key={cat}>
                    <div className="flex items-center justify-between text-xs text-[var(--muted)] mb-1">
                      <span>{CATEGORY_LABELS[cat]}</span>
                      <span>{catMet}/{catTotal}</span>
                    </div>
                    <div className="space-y-0.5">
                      {catConditions.map(c => (
                        <div key={c.id} className="flex items-start gap-1.5 text-xs">
                          <span className="mt-0.5 shrink-0">
                            {c.na ? '➖' : c.met ? '✅' : '❌'}
                          </span>
                          <span className={c.na ? 'text-[var(--muted)]' : c.met ? 'text-[var(--text)]' : 'text-[var(--muted)]'}>
                            {c.label}: {c.detail}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          );
        })}
      </div>
    </div>
  );
}
```

- [ ] **Step 3: 커밋**

```bash
git add web/src/components/signals/ChecklistFilterPanel.tsx web/src/components/signals/ChecklistSection.tsx
git commit -m "feat: 체크리스트 UI — 필터 패널 + 카드 목록 컴포넌트"
```

---

### Task 12: 탭 네비게이션에 체크리스트 탭 추가

**Files:**
- Modify: `web/src/components/signals/RecommendationView.tsx`
- Modify: `web/src/app/signals/page.tsx`

- [ ] **Step 1: RecommendationView.tsx에 체크리스트 탭 추가**

```typescript
// RecommendationView.tsx 변경사항

// import 추가
import ChecklistSection from './ChecklistSection';

// Props 타입 변경
interface Props {
  initialTab: 'analysis' | 'short-term' | 'checklist';  // checklist 추가
  // ... 나머지 동일
}

// handleTabChange 타입 변경
const handleTabChange = (tab: 'analysis' | 'short-term' | 'checklist') => {
  setActiveTab(tab);
  window.history.replaceState(null, '', `/signals?tab=${tab}`);
};

// 탭 버튼 추가 (단기추천 버튼 뒤에)
<button onClick={() => handleTabChange('checklist')} className={tabCls('checklist')}>
  체크리스트
</button>

// 탭 콘텐츠 추가
{activeTab === 'checklist' ? (
  <ChecklistSection initialDateMode={initialDateMode} />
) : activeTab === 'analysis' ? (
  // ... 기존
) : (
  // ... 기존
)}
```

- [ ] **Step 2: page.tsx에 checklist 탭 라우팅 추가**

`page.tsx`의 `activeTab` 결정 로직에 `checklist` 추가:

```typescript
const activeTab =
  params.tab === "analysis" ? "analysis"
  : params.tab === "short-term" ? "short-term"
  : params.tab === "checklist" ? "checklist"  // 추가
  : "signals";
```

그리고 `RecommendationView` 렌더링 조건에도 `checklist` 포함:

```typescript
if (activeTab === "analysis" || activeTab === "short-term" || activeTab === "checklist") {
  // signalMap 조회 로직
}
```

`RecommendationView`의 `initialTab` prop에 `checklist` 전달 가능하도록 타입 맞춤.

탭 바에서 AI 신호 탭에서도 체크리스트 링크 추가:

```tsx
<Link href="/signals?tab=checklist" className="...">체크리스트</Link>
```

- [ ] **Step 3: 빌드 확인**

Run: `cd web && npx tsc --noEmit`

- [ ] **Step 4: 커밋**

```bash
git add web/src/components/signals/RecommendationView.tsx web/src/app/signals/page.tsx
git commit -m "feat: 시그널 페이지에 체크리스트 탭 추가"
```

---

### Task 13: stock-ranking API에 checklist 모드 추가

**Files:**
- Modify: `web/src/app/api/v1/stock-ranking/route.ts`

- [ ] **Step 1: GET 핸들러에 mode=checklist 분기 추가**

`route.ts`의 GET 핸들러 상단에서 `searchParams.get('mode')` 확인:

```typescript
export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl;
  const mode = searchParams.get('mode');

  if (mode === 'checklist') {
    const conditionsParam = searchParams.get('conditions') ?? '';
    const activeIds = conditionsParam.split(',').filter(Boolean);
    const supabase = createServiceClient();

    const { generateChecklist } = await import('@/lib/checklist-recommendation/index');
    const result = await generateChecklist(supabase, activeIds);

    return NextResponse.json(result);
  }

  // ... 기존 로직 유지
}
```

- [ ] **Step 2: 빌드 확인**

Run: `cd web && npx tsc --noEmit`

- [ ] **Step 3: 커밋**

```bash
git add web/src/app/api/v1/stock-ranking/route.ts
git commit -m "feat: stock-ranking API에 mode=checklist 체크리스트 모드 추가"
```

---

### Task 14: calcRSI export + 전체 빌드 검증

**Files:**
- Modify: `web/src/lib/ai-recommendation/technical-score.ts` (calcRSI export)

- [ ] **Step 1: calcRSI를 export로 변경**

`technical-score.ts`에서 `function calcRSI` → `export function calcRSI`로 변경. (Task 3에서 이미 변경했을 수 있으나, 누락 시 여기서 보완)

- [ ] **Step 2: 전체 빌드 확인**

Run: `cd web && npm run build`
Expected: 빌드 성공

- [ ] **Step 3: 전체 테스트 실행**

Run: `cd web && npx vitest run`
Expected: 모든 테스트 통과

- [ ] **Step 4: 최종 커밋**

```bash
git add -A
git commit -m "fix: calcRSI export + 전체 빌드/테스트 검증"
```
