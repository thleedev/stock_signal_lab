# 점수 체계 재설계 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 기술전환 + 수급강도 + 가치매력 + 신호보너스 4축 스코어링으로 전 종목(~4,242개) 균등 평가

**Architecture:** 신규 모듈 4개를 `web/src/lib/scoring/`에 생성하고, `route.ts` 내 inline `calcScore()`를 대체한다. 기술전환 축은 `daily_prices` 테이블을 Supabase 배치 쿼리로 조회하여 MA/RSI/볼린저 계산에 사용한다.

**Tech Stack:** TypeScript, Vitest, Next.js App Router, Supabase

---

## 파일 구조

### 새로 생성
| 파일 | 역할 |
|---|---|
| `web/src/lib/scoring/technical-reversal.ts` | 기술전환 점수 (0~100), MA/RSI/볼린저 |
| `web/src/lib/scoring/technical-reversal.test.ts` | Vitest 단위 테스트 |
| `web/src/lib/scoring/supply-strength.ts` | 수급강도 점수 (0~100), streak 중심 |
| `web/src/lib/scoring/supply-strength.test.ts` | Vitest 단위 테스트 |
| `web/src/lib/scoring/valuation-attractiveness.ts` | 가치매력 점수 (0~100), 목표주가 1순위 |
| `web/src/lib/scoring/valuation-attractiveness.test.ts` | Vitest 단위 테스트 |
| `web/src/lib/scoring/signal-bonus.ts` | SMS 신호 보너스 (0~100) |
| `web/src/lib/scoring/signal-bonus.test.ts` | Vitest 단위 테스트 |
| `web/src/lib/scoring/composite-score.ts` | 4축 가중 합산 + 리스크 감산 |
| `web/src/lib/scoring/composite-score.test.ts` | Vitest 단위 테스트 |

### 수정
| 파일 | 변경 내용 |
|---|---|
| `web/src/app/api/v1/stock-ranking/route.ts` | `calcScore()` 교체 + daily_prices 배치 쿼리 추가 |
| `web/src/components/signals/UnifiedAnalysisSection.tsx` | "모멘텀" → "기술전환" 레이블 변경 |

---

## Task 1: technical-reversal.ts

**Files:**
- Create: `web/src/lib/scoring/technical-reversal.ts`
- Test: `web/src/lib/scoring/technical-reversal.test.ts`

이미 존재하는 `calcSMA`, `calcRSI`, `calcBollingerUpper` (from `web/src/lib/ai-recommendation/technical-score.ts`)를 재사용한다.

최대 원점수 65 → 0~100 정규화.

- [ ] **Step 1: 실패 테스트 작성**

`web/src/lib/scoring/technical-reversal.test.ts`:
```typescript
import { describe, it, expect } from 'vitest';
import { calcTechnicalReversal } from './technical-reversal';
import type { DailyPrice } from '@/lib/ai-recommendation/technical-score';

function makePrice(close: number, volume = 1000000, date = '2026-01-01'): DailyPrice {
  return { date, open: close, high: close * 1.01, low: close * 0.99, close, volume };
}

describe('calcTechnicalReversal', () => {
  it('데이터 부족 (20일 미만) → 0점', () => {
    const prices = Array.from({ length: 10 }, (_, i) => makePrice(100 + i));
    const result = calcTechnicalReversal(prices, 120, 80);
    expect(result.normalizedScore).toBe(0);
    expect(result.data_insufficient).toBe(true);
  });

  it('골든크로스 + RSI 적정 + 52주 반등 → 고득점', () => {
    // MA5 > MA20 크로스 발생: 초반 20일은 낮은 가격, 이후 상승
    const prices: DailyPrice[] = [];
    // 40일치: 처음 25일 하락(100→85), 이후 15일 반등(85→95)
    for (let i = 0; i < 25; i++) prices.push(makePrice(100 - i * 0.6));
    for (let i = 0; i < 15; i++) prices.push(makePrice(85 + i * 0.7));
    const result = calcTechnicalReversal(prices, 105, 83);
    expect(result.normalizedScore).toBeGreaterThan(40);
    expect(result.data_insufficient).toBe(false);
  });

  it('RSI 70+ 과매수 → 감점', () => {
    // 강한 상승 연속 → RSI 높아짐
    const prices: DailyPrice[] = [];
    for (let i = 0; i < 30; i++) prices.push(makePrice(80 + i * 1.5));
    const result = calcTechnicalReversal(prices, 120, 80);
    expect(result.rawScore).toBeLessThan(40);
  });

  it('정배열 완성 → 가산점', () => {
    // MA5 > MA20 > MA60 충족: 60일 이상 점진 상승
    const prices: DailyPrice[] = [];
    for (let i = 0; i < 65; i++) prices.push(makePrice(70 + i * 0.5));
    const result = calcTechnicalReversal(prices, 105, 70);
    expect(result.ma_aligned).toBe(true);
  });
});
```

- [ ] **Step 2: 실패 확인**

```bash
cd web && npx vitest run src/lib/scoring/technical-reversal.test.ts 2>&1 | tail -20
```
Expected: FAIL (파일 없음)

- [ ] **Step 3: 구현 작성**

`web/src/lib/scoring/technical-reversal.ts`:
```typescript
import { calcSMA, calcRSI, calcBollingerUpper } from '@/lib/ai-recommendation/technical-score';
import type { DailyPrice } from '@/lib/ai-recommendation/technical-score';
import type { ScoreReason, NormalizedScoreBase } from '@/types/score-reason';

export interface TechnicalReversalResult extends NormalizedScoreBase {
  data_insufficient: boolean;
  golden_cross: boolean;
  rsi: number | null;
  ma_aligned: boolean;
  bollinger_rebound: boolean;
  week52_rebound: boolean;
  week52_high_zone: boolean;
  volume_surge: boolean;
  consecutive_drop_rebound: boolean;
}

const MAX_RAW = 65;

export function calcTechnicalReversal(
  prices: DailyPrice[],
  high52w: number | null,
  low52w: number | null,
): TechnicalReversalResult {
  const empty: TechnicalReversalResult = {
    rawScore: 0, normalizedScore: 0, reasons: [],
    data_insufficient: true, golden_cross: false, rsi: null,
    ma_aligned: false, bollinger_rebound: false, week52_rebound: false,
    week52_high_zone: false, volume_surge: false, consecutive_drop_rebound: false,
  };

  if (prices.length < 20) return empty;

  const closes = prices.map((p) => p.close);
  const volumes = prices.map((p) => p.volume);
  const reasons: ScoreReason[] = [];
  let rawScore = 0;

  // ── MA5, MA20, MA60 ──
  const ma5 = calcSMA(closes, 5);
  const ma20 = calcSMA(closes, 20);
  const ma60 = prices.length >= 60 ? calcSMA(closes, 60) : [];

  const lastMa5 = ma5[ma5.length - 1];
  const lastMa20 = ma20[ma20.length - 1];
  const prevMa5 = ma5.length >= 2 ? ma5[ma5.length - 2] : null;
  const prevMa20 = ma20.length >= 2 ? ma20[ma20.length - 2] : null;

  // 골든크로스: MA5가 MA20 상향 돌파 (최근 5일 내)
  let goldenCross = false;
  const crossLookback = Math.min(5, ma5.length - 1, ma20.length - 1);
  for (let i = 1; i <= crossLookback; i++) {
    const cur5 = ma5[ma5.length - i];
    const cur20 = ma20[ma20.length - i];
    const pre5 = ma5[ma5.length - i - 1];
    const pre20 = ma20.length - i - 1 >= 0 ? ma20[ma20.length - i - 1] : null;
    if (cur5 > cur20 && pre5 !== undefined && pre20 !== null && pre5 <= pre20) {
      goldenCross = true;
      break;
    }
  }
  if (goldenCross) {
    rawScore += 25;
    reasons.push({ label: 'MA5 골든크로스', points: Math.round((25 / MAX_RAW) * 100), detail: 'MA5 > MA20 상향 돌파 (5일 내)', met: true });
  } else {
    reasons.push({ label: 'MA5 골든크로스', points: 0, detail: '미발생', met: false });
  }

  // RSI 점수 (25~45 = 과매도 회복 구간, 70+ = 과매수 감점)
  const rsi = calcRSI(closes);
  let rsiScore = 0;
  let rsiDetail = rsi !== null ? `RSI ${rsi.toFixed(1)}` : 'RSI 계산 불가';
  if (rsi !== null) {
    if (rsi >= 25 && rsi <= 45) {
      rsiScore = 20;
      rsiDetail = `RSI ${rsi.toFixed(1)} (과매도 회복 구간)`;
    } else if (rsi > 45 && rsi <= 55) {
      rsiScore = 8;
      rsiDetail = `RSI ${rsi.toFixed(1)} (중립)`;
    } else if (rsi >= 70) {
      rsiScore = -15;
      rsiDetail = `RSI ${rsi.toFixed(1)} (과매수 경보)`;
    }
  }
  rawScore += rsiScore;
  reasons.push({ label: 'RSI', points: Math.round((rsiScore / MAX_RAW) * 100), detail: rsiDetail, met: rsiScore > 0 });

  // 52주 저점 +5~20% 반등 구간
  const lastClose = closes[closes.length - 1];
  let week52Rebound = false;
  let week52ReboundScore = 0;
  if (low52w && low52w > 0) {
    const reboundPct = ((lastClose - low52w) / low52w) * 100;
    if (reboundPct >= 5 && reboundPct <= 20) {
      week52ReboundScore = 20;
      week52Rebound = true;
      reasons.push({ label: '52주 저점 반등', points: Math.round((20 / MAX_RAW) * 100), detail: `52주 저점 대비 +${reboundPct.toFixed(1)}% (진입 구간)`, met: true });
    } else {
      reasons.push({ label: '52주 저점 반등', points: 0, detail: `52주 저점 대비 ${reboundPct >= 0 ? '+' : ''}${reboundPct.toFixed(1)}%`, met: false });
    }
  } else {
    reasons.push({ label: '52주 저점 반등', points: 0, detail: '52주 데이터 없음', met: false });
  }
  rawScore += week52ReboundScore;

  // 거래량 급증 (당일 거래량 > 20일 평균 1.5배)
  const volSMA20 = volumes.length >= 20
    ? volumes.slice(-20).reduce((a, b) => a + b, 0) / 20
    : null;
  const lastVol = volumes[volumes.length - 1];
  const volumeSurge = volSMA20 !== null && lastVol >= volSMA20 * 1.5;
  if (volumeSurge) {
    rawScore += 15;
    const ratio = (lastVol / volSMA20!).toFixed(1);
    reasons.push({ label: '거래량 급증', points: Math.round((15 / MAX_RAW) * 100), detail: `20일 평균 대비 ${ratio}배`, met: true });
  } else {
    reasons.push({ label: '거래량 급증', points: 0, detail: volSMA20 !== null ? `20일 평균 대비 ${(lastVol / volSMA20).toFixed(1)}배` : '거래량 데이터 부족', met: false });
  }

  // 볼린저 하단 터치 후 양봉 반등
  let bollingerRebound = false;
  if (prices.length >= 21) {
    const prevPrices = prices.slice(0, -1);
    const prevCloses = prevPrices.map((p) => p.close);
    const bolLower = calcBollingerUpper(prevCloses, 20, -2); // 하단 = mean - 2*std
    // 전일 종가가 볼린저 하단 이하이고 당일 양봉
    const prevClose = closes[closes.length - 2];
    const prevOpen = prices[prices.length - 2]?.open ?? prevClose;
    const curClose = closes[closes.length - 1];
    const curOpen = prices[prices.length - 1]?.open ?? curClose;
    // 볼린저 하단 계산 (20일 SMA - 2*std)
    const slice20 = prevCloses.slice(-20);
    const mean20 = slice20.reduce((a, b) => a + b, 0) / 20;
    const variance20 = slice20.reduce((a, b) => a + Math.pow(b - mean20, 2), 0) / 20;
    const bolLow = mean20 - 2 * Math.sqrt(variance20);
    if (prevClose <= bolLow && curClose > curOpen) {
      bollingerRebound = true;
      rawScore += 15;
      reasons.push({ label: '볼린저 하단 반등', points: Math.round((15 / MAX_RAW) * 100), detail: `볼린저 하단(${bolLow.toFixed(0)}) 터치 후 양봉`, met: true });
    } else {
      reasons.push({ label: '볼린저 하단 반등', points: 0, detail: '볼린저 하단 미터치', met: false });
    }
  } else {
    reasons.push({ label: '볼린저 하단 반등', points: 0, detail: '데이터 부족', met: false });
  }

  // MA5 > MA20 > MA60 정배열
  const maAligned = ma60.length > 0 &&
    lastMa5 > lastMa20 &&
    lastMa20 > ma60[ma60.length - 1];
  if (maAligned) {
    rawScore += 10;
    reasons.push({ label: 'MA 정배열', points: Math.round((10 / MAX_RAW) * 100), detail: 'MA5 > MA20 > MA60', met: true });
  } else {
    reasons.push({ label: 'MA 정배열', points: 0, detail: '정배열 미충족', met: false });
  }

  // 52주 고점 90%+ 모멘텀
  let week52HighZone = false;
  if (high52w && low52w && high52w > low52w) {
    const position = (lastClose - low52w) / (high52w - low52w);
    if (position >= 0.9) {
      week52HighZone = true;
      rawScore += 10;
      reasons.push({ label: '52주 고점 구간', points: Math.round((10 / MAX_RAW) * 100), detail: `52주 범위 ${(position * 100).toFixed(0)}% (강한 모멘텀)`, met: true });
    } else {
      reasons.push({ label: '52주 고점 구간', points: 0, detail: `52주 범위 ${(position * 100).toFixed(0)}%`, met: false });
    }
  } else {
    reasons.push({ label: '52주 고점 구간', points: 0, detail: '52주 데이터 없음', met: false });
  }

  // 연속 하락 후 첫 양봉 (3일+ 하락 후)
  let consecutiveDropRebound = false;
  if (prices.length >= 5) {
    const lastCandles = prices.slice(-5);
    let dropDays = 0;
    for (let i = 0; i < lastCandles.length - 1; i++) {
      if (lastCandles[i].close < lastCandles[i === 0 ? 0 : i - 1]?.close ?? lastCandles[i].open) break;
      if (lastCandles[i].close < (i > 0 ? lastCandles[i - 1].close : lastCandles[i].open)) dropDays++;
    }
    // 직전 3일+ 하락, 당일 양봉
    const recentDrops = closes.slice(-4, -1);
    let drops = 0;
    for (let i = 1; i < recentDrops.length; i++) {
      if (recentDrops[i] < recentDrops[i - 1]) drops++;
    }
    const todayBullish = lastClose > (prices[prices.length - 1].open ?? lastClose);
    if (drops >= 2 && todayBullish) {
      consecutiveDropRebound = true;
      rawScore += 10;
      reasons.push({ label: '연속하락 반등', points: Math.round((10 / MAX_RAW) * 100), detail: `${drops}일+ 하락 후 양봉 반등`, met: true });
    } else {
      reasons.push({ label: '연속하락 반등', points: 0, detail: '연속하락 반등 패턴 없음', met: false });
    }
  } else {
    reasons.push({ label: '연속하락 반등', points: 0, detail: '데이터 부족', met: false });
  }

  // MA 역배열 감점
  const maReverse = ma60.length > 0 &&
    lastMa5 < lastMa20 && lastMa20 < ma60[ma60.length - 1];
  if (maReverse) {
    rawScore -= 5;
    reasons.push({ label: 'MA 역배열', points: -Math.round((5 / MAX_RAW) * 100), detail: 'MA5 < MA20 < MA60 역배열', met: false });
  }

  // 5일 급락 감점 (-15%+)
  if (prices.length >= 6) {
    const price5dAgo = closes[closes.length - 6];
    const cum5d = ((lastClose - price5dAgo) / price5dAgo) * 100;
    if (cum5d <= -15) {
      rawScore -= 10;
      reasons.push({ label: '5일 급락', points: -Math.round((10 / MAX_RAW) * 100), detail: `5일 누적 ${cum5d.toFixed(1)}% 급락`, met: false });
    }
  }

  const clampedRaw = Math.max(-20, Math.min(rawScore, MAX_RAW));
  // 정규화: 0~65 → 0~100 (음수는 0 처리)
  const normalizedScore = Math.round(Math.max(0, (clampedRaw / MAX_RAW) * 100) * 10) / 10;

  return {
    rawScore: clampedRaw,
    normalizedScore,
    reasons,
    data_insufficient: false,
    golden_cross: goldenCross,
    rsi,
    ma_aligned: maAligned,
    bollinger_rebound: bollingerRebound,
    week52_rebound: week52Rebound,
    week52_high_zone: week52HighZone,
    volume_surge: volumeSurge,
    consecutive_drop_rebound: consecutiveDropRebound,
  };
}
```

- [ ] **Step 4: 테스트 통과 확인**

```bash
cd web && npx vitest run src/lib/scoring/technical-reversal.test.ts 2>&1 | tail -20
```
Expected: PASS (4 tests)

- [ ] **Step 5: 커밋**

```bash
cd web && git add src/lib/scoring/technical-reversal.ts src/lib/scoring/technical-reversal.test.ts
git commit -m "feat: 기술전환 점수 모듈 추가 (MA/RSI/볼린저 기반 0~100 정규화)"
```

---

## Task 2: supply-strength.ts

**Files:**
- Create: `web/src/lib/scoring/supply-strength.ts`
- Test: `web/src/lib/scoring/supply-strength.test.ts`

기존 `supply-score.ts`의 시총 비율 로직 폐기. streak + 전환점 중심으로 재설계.

최대 원점수 65 → 0~100 정규화.

- [ ] **Step 1: 실패 테스트 작성**

`web/src/lib/scoring/supply-strength.test.ts`:
```typescript
import { describe, it, expect } from 'vitest';
import { calcSupplyStrength } from './supply-strength';

describe('calcSupplyStrength', () => {
  it('외국인+기관 동반 전환 매수 → 최고점', () => {
    const result = calcSupplyStrength({
      foreignStreak: 2,   // 2일 연속 (전환)
      institutionStreak: 1, // 1일 (첫 전환)
      foreignNetQty: 500000,
      institutionNetQty: 300000,
      foreignNet5d: 800000,
      institutionNet5d: 500000,
      shortSellRatio: 0.5,
    });
    expect(result.normalizedScore).toBeGreaterThan(70);
  });

  it('외국인+기관 3일+ 연속 매도 → 낮은 점수', () => {
    const result = calcSupplyStrength({
      foreignStreak: -4,
      institutionStreak: -3,
      foreignNetQty: -500000,
      institutionNetQty: -300000,
      foreignNet5d: -1000000,
      institutionNet5d: -600000,
      shortSellRatio: 2.5,
    });
    expect(result.normalizedScore).toBeLessThan(20);
  });

  it('외국인 1~2일 전환 → 수급 전환 최고 가산점', () => {
    const result = calcSupplyStrength({
      foreignStreak: 1,
      institutionStreak: -1,
      foreignNetQty: 100000,
      institutionNetQty: -50000,
      foreignNet5d: 100000,
      institutionNet5d: -50000,
      shortSellRatio: null,
    });
    expect(result.normalizedScore).toBeGreaterThan(30);
  });

  it('신호 없음 → 중립 점수', () => {
    const result = calcSupplyStrength({
      foreignStreak: 0,
      institutionStreak: 0,
      foreignNetQty: null,
      institutionNetQty: null,
      foreignNet5d: null,
      institutionNet5d: null,
      shortSellRatio: null,
    });
    expect(result.normalizedScore).toBe(0);
  });
});
```

- [ ] **Step 2: 실패 확인**

```bash
cd web && npx vitest run src/lib/scoring/supply-strength.test.ts 2>&1 | tail -20
```
Expected: FAIL (파일 없음)

- [ ] **Step 3: 구현 작성**

`web/src/lib/scoring/supply-strength.ts`:
```typescript
import type { ScoreReason, NormalizedScoreBase } from '@/types/score-reason';

export interface SupplyStrengthResult extends NormalizedScoreBase {
  foreign_buying: boolean;
  institution_buying: boolean;
  low_short_sell: boolean;
}

export interface SupplyStrengthInput {
  foreignStreak: number | null;
  institutionStreak: number | null;
  foreignNetQty: number | null;
  institutionNetQty: number | null;
  foreignNet5d: number | null;
  institutionNet5d: number | null;
  shortSellRatio: number | null;
}

const MAX_RAW = 65;

export function calcSupplyStrength(input: SupplyStrengthInput): SupplyStrengthResult {
  const {
    foreignStreak, institutionStreak,
    foreignNetQty, institutionNetQty,
    foreignNet5d, institutionNet5d,
    shortSellRatio,
  } = input;

  let rawScore = 0;
  const reasons: ScoreReason[] = [];

  const fStreak = foreignStreak ?? 0;
  const iStreak = institutionStreak ?? 0;
  const foreignBuying = foreignNetQty !== null && foreignNetQty > 0;
  const institutionBuying = institutionNetQty !== null && institutionNetQty > 0;

  // ── 외국인 매수 전환/지속 ──
  let fScore = 0;
  let fDetail = '';
  if (fStreak >= 1 && fStreak <= 2) {
    fScore = 20;
    fDetail = `외국인 매수 전환 ${fStreak}일 (새 수급 유입)`;
  } else if (fStreak >= 3 && fStreak <= 5) {
    fScore = 15;
    fDetail = `외국인 ${fStreak}일 연속 매수 (매집 중)`;
  } else if (fStreak > 5) {
    fScore = 5;
    fDetail = `외국인 ${fStreak}일 연속 매수 (과열 주의)`;
  } else if (fStreak <= -3) {
    fScore = -15;
    fDetail = `외국인 ${Math.abs(fStreak)}일 연속 매도 ⚠️`;
  } else {
    fDetail = fStreak < 0 ? `외국인 ${Math.abs(fStreak)}일 매도` : '외국인 중립';
  }
  rawScore += fScore;
  reasons.push({ label: '외국인 수급', points: Math.round((fScore / MAX_RAW) * 100), detail: fDetail, met: fScore > 0 });

  // ── 기관 매수 전환/지속 ──
  let iScore = 0;
  let iDetail = '';
  if (iStreak >= 1 && iStreak <= 2) {
    iScore = 20;
    iDetail = `기관 매수 전환 ${iStreak}일 (새 수급 유입)`;
  } else if (iStreak >= 3 && iStreak <= 5) {
    iScore = 15;
    iDetail = `기관 ${iStreak}일 연속 매수 (매집 중)`;
  } else if (iStreak > 5) {
    iScore = 5;
    iDetail = `기관 ${iStreak}일 연속 매수 (과열 주의)`;
  } else if (iStreak <= -3) {
    iScore = -15;
    iDetail = `기관 ${Math.abs(iStreak)}일 연속 매도 ⚠️`;
  } else {
    iDetail = iStreak < 0 ? `기관 ${Math.abs(iStreak)}일 매도` : '기관 중립';
  }
  rawScore += iScore;
  reasons.push({ label: '기관 수급', points: Math.round((iScore / MAX_RAW) * 100), detail: iDetail, met: iScore > 0 });

  // ── 외국인+기관 동반 매수 (스마트머니 동시 유입) ──
  const bothBuying = foreignBuying && institutionBuying;
  if (bothBuying) {
    rawScore += 10;
    reasons.push({ label: '동반 매수', points: Math.round((10 / MAX_RAW) * 100), detail: '외국인+기관 동반 순매수 (스마트머니 유입)', met: true });
  } else {
    reasons.push({ label: '동반 매수', points: 0, detail: '동반 매수 없음', met: false });
  }

  // ── 5일 누적 동반 순매수 ──
  const bothPositive5d = (foreignNet5d ?? 0) > 0 && (institutionNet5d ?? 0) > 0;
  if (bothPositive5d) {
    rawScore += 10;
    reasons.push({ label: '5일 누적 동반', points: Math.round((10 / MAX_RAW) * 100), detail: '5일 누적 외국인+기관 동반 순매수', met: true });
  } else {
    reasons.push({ label: '5일 누적 동반', points: 0, detail: '5일 누적 동반 매수 없음', met: false });
  }

  // ── 공매도 비율 낮음 ──
  const lowShortSell = shortSellRatio !== null && shortSellRatio >= 0 && shortSellRatio < 1;
  if (lowShortSell) {
    rawScore += 5;
    reasons.push({ label: '공매도', points: Math.round((5 / MAX_RAW) * 100), detail: `공매도 ${shortSellRatio!.toFixed(2)}% (1% 미만)`, met: true });
  } else {
    const detail = shortSellRatio !== null ? `공매도 ${shortSellRatio.toFixed(2)}%` : '공매도 데이터 없음';
    reasons.push({ label: '공매도', points: 0, detail, met: false });
  }

  const clampedRaw = Math.max(-30, Math.min(rawScore, MAX_RAW));
  const normalizedScore = Math.round(Math.max(0, (clampedRaw / MAX_RAW) * 100) * 10) / 10;

  return {
    rawScore: clampedRaw,
    normalizedScore,
    reasons,
    foreign_buying: foreignBuying,
    institution_buying: institutionBuying,
    low_short_sell: lowShortSell,
  };
}
```

- [ ] **Step 4: 테스트 통과 확인**

```bash
cd web && npx vitest run src/lib/scoring/supply-strength.test.ts 2>&1 | tail -20
```
Expected: PASS (4 tests)

- [ ] **Step 5: 커밋**

```bash
cd web && git add src/lib/scoring/supply-strength.ts src/lib/scoring/supply-strength.test.ts
git commit -m "feat: 수급강도 점수 모듈 추가 (streak 중심 시총비율 폐기)"
```

---

## Task 3: valuation-attractiveness.ts

**Files:**
- Create: `web/src/lib/scoring/valuation-attractiveness.ts`
- Test: `web/src/lib/scoring/valuation-attractiveness.test.ts`

목표주가 괴리율이 1순위. PBR/ROE 복합은 보조. 최대 원점수 80 → 0~100 정규화.

- [x] **Step 1: 실패 테스트 작성**

`web/src/lib/scoring/valuation-attractiveness.test.ts`:
```typescript
import { describe, it, expect } from 'vitest';
import { calcValuationAttractiveness } from './valuation-attractiveness';

describe('calcValuationAttractiveness', () => {
  it('목표주가 괴리 30%+ → 최고 가산점 (35점)', () => {
    const result = calcValuationAttractiveness({
      currentPrice: 50000,
      targetPrice: 75000,  // +50% 괴리
      forwardPer: null, per: null, pbr: null, roe: null,
      dividendYield: null, investOpinion: null,
    });
    // 35점 / 80 * 100 = 43.75 이상
    expect(result.normalizedScore).toBeGreaterThanOrEqual(43);
  });

  it('PBR < 1.0 + ROE > 10% 복합 → 저평가 우량', () => {
    const result = calcValuationAttractiveness({
      currentPrice: 10000,
      targetPrice: null,
      forwardPer: null,
      per: null,
      pbr: 0.8,
      roe: 15,
      dividendYield: null,
      investOpinion: null,
    });
    // pbr<1+roe>10 = +20, pbr<1.0 자체 없음
    expect(result.normalizedScore).toBeGreaterThan(20);
  });

  it('Forward PER < Trailing PER (이익 성장) → 가산점', () => {
    const result = calcValuationAttractiveness({
      currentPrice: 100000,
      targetPrice: null,
      forwardPer: 10,   // 낮음 → 이익 성장
      per: 15,          // 현재 PER
      pbr: null, roe: null,
      dividendYield: null, investOpinion: null,
    });
    // Forward PER < Trailing PER → +20
    expect(result.normalizedScore).toBeGreaterThan(20);
  });

  it('목표주가 < 현재가 → 감점', () => {
    const result = calcValuationAttractiveness({
      currentPrice: 100000,
      targetPrice: 90000,  // 하향 조정
      forwardPer: null, per: null, pbr: null, roe: null,
      dividendYield: null, investOpinion: null,
    });
    expect(result.normalizedScore).toBe(0);
  });

  it('배당수익률 3%+ → 하방 지지 가산', () => {
    const result = calcValuationAttractiveness({
      currentPrice: 50000,
      targetPrice: null,
      forwardPer: null, per: null, pbr: null, roe: null,
      dividendYield: 4.5,
      investOpinion: null,
    });
    expect(result.normalizedScore).toBeGreaterThan(10);
  });
});
```

- [x] **Step 2: 실패 확인**

```bash
cd web && npx vitest run src/lib/scoring/valuation-attractiveness.test.ts 2>&1 | tail -20
```
Expected: FAIL (파일 없음)

- [x] **Step 3: 구현 작성**

`web/src/lib/scoring/valuation-attractiveness.ts`:
```typescript
import type { ScoreReason, NormalizedScoreBase } from '@/types/score-reason';

export interface ValuationAttractivenessInput {
  currentPrice: number | null;
  targetPrice: number | null;
  forwardPer: number | null;
  per: number | null;
  pbr: number | null;
  roe: number | null;
  dividendYield: number | null;
  investOpinion: number | null;
}

export interface ValuationAttractivenessResult extends NormalizedScoreBase {
  upside_pct: number | null;
}

const MAX_RAW = 80;

export function calcValuationAttractiveness(input: ValuationAttractivenessInput): ValuationAttractivenessResult {
  const { currentPrice, targetPrice, forwardPer, per, pbr, roe, dividendYield, investOpinion } = input;
  let rawScore = 0;
  const reasons: ScoreReason[] = [];
  let upsidePct: number | null = null;

  // ── 1순위: 목표주가 괴리율 ──
  if (targetPrice && currentPrice && currentPrice > 0) {
    upsidePct = ((targetPrice - currentPrice) / currentPrice) * 100;
    let upsideScore = 0;
    let upsideDetail = '';
    if (upsidePct >= 30) {
      upsideScore = 35;
      upsideDetail = `목표주가 ${Math.round(targetPrice).toLocaleString('ko-KR')} (현재 대비 +${upsidePct.toFixed(1)}%) — 강한 저평가`;
    } else if (upsidePct >= 20) {
      upsideScore = 25;
      upsideDetail = `목표주가 ${Math.round(targetPrice).toLocaleString('ko-KR')} (+${upsidePct.toFixed(1)}%) — 유의미한 상승여력`;
    } else if (upsidePct >= 10) {
      upsideScore = 15;
      upsideDetail = `목표주가 ${Math.round(targetPrice).toLocaleString('ko-KR')} (+${upsidePct.toFixed(1)}%) — 소폭 상승여력`;
    } else if (upsidePct < 0) {
      upsideScore = -10;
      upsideDetail = `목표주가 ${Math.round(targetPrice).toLocaleString('ko-KR')} (${upsidePct.toFixed(1)}%) — 하향 조정`;
    } else {
      upsideDetail = `목표주가 ${Math.round(targetPrice).toLocaleString('ko-KR')} (+${upsidePct.toFixed(1)}%) — 상승여력 미미`;
    }
    rawScore += upsideScore;
    reasons.push({ label: '목표주가 괴리', points: Math.round((upsideScore / MAX_RAW) * 100), detail: upsideDetail, met: upsideScore > 0 });
  } else {
    reasons.push({ label: '목표주가 괴리', points: 0, detail: '목표주가 없음', met: false });
  }

  // ── 2순위: Forward PER < Trailing PER (이익 성장 기대) ──
  if (forwardPer && per && forwardPer > 0 && per > 0 && forwardPer < per) {
    rawScore += 20;
    reasons.push({ label: 'Forward PER', points: Math.round((20 / MAX_RAW) * 100), detail: `Forward PER ${forwardPer.toFixed(1)} < Trailing PER ${per.toFixed(1)} (이익 성장 예상)`, met: true });
  } else {
    const detail = forwardPer && per
      ? `Forward PER ${forwardPer.toFixed(1)} vs PER ${per.toFixed(1)}`
      : forwardPer ? `Forward PER ${forwardPer.toFixed(1)} (Trailing 없음)` : 'Forward PER 없음';
    reasons.push({ label: 'Forward PER', points: 0, detail, met: false });
  }

  // ── PBR < 1.0 + ROE > 10% (저평가 우량주) ──
  if (pbr !== null && pbr > 0 && pbr < 1.0 && roe !== null && roe > 10) {
    rawScore += 20;
    reasons.push({ label: 'PBR+ROE 복합', points: Math.round((20 / MAX_RAW) * 100), detail: `PBR ${pbr.toFixed(2)} + ROE ${roe.toFixed(1)}% (저평가 우량)`, met: true });
  } else {
    const detail = pbr !== null && roe !== null
      ? `PBR ${pbr.toFixed(2)}, ROE ${roe.toFixed(1)}%`
      : '데이터 부족';
    reasons.push({ label: 'PBR+ROE 복합', points: 0, detail, met: false });
  }

  // ── PBR < 0.7 자산가치 매력 ──
  if (pbr !== null && pbr > 0 && pbr < 0.7) {
    rawScore += 15;
    reasons.push({ label: 'PBR 극저평가', points: Math.round((15 / MAX_RAW) * 100), detail: `PBR ${pbr.toFixed(2)} (순자산 대비 극저평가)`, met: true });
  } else if (pbr !== null && pbr > 0) {
    reasons.push({ label: 'PBR 극저평가', points: 0, detail: `PBR ${pbr.toFixed(2)}`, met: false });
  } else {
    reasons.push({ label: 'PBR 극저평가', points: 0, detail: 'PBR 없음', met: false });
  }

  // ── 배당수익률 3%+ ──
  if (dividendYield !== null && dividendYield >= 3) {
    rawScore += 10;
    reasons.push({ label: '배당수익률', points: Math.round((10 / MAX_RAW) * 100), detail: `배당 ${dividendYield.toFixed(1)}% (하방 지지선)`, met: true });
  } else {
    reasons.push({ label: '배당수익률', points: 0, detail: dividendYield !== null ? `배당 ${dividendYield.toFixed(1)}%` : '배당 없음', met: false });
  }

  // ── 애널리스트 Strong Buy (invest_opinion >= 4) ──
  if (investOpinion !== null && investOpinion >= 4) {
    rawScore += 10;
    reasons.push({ label: '애널리스트 의견', points: Math.round((10 / MAX_RAW) * 100), detail: `투자의견 ${investOpinion.toFixed(1)} (Strong Buy 컨센서스)`, met: true });
  } else {
    reasons.push({ label: '애널리스트 의견', points: 0, detail: investOpinion !== null ? `투자의견 ${investOpinion.toFixed(1)}` : '의견 없음', met: false });
  }

  // ── 감점: PER > 50 ──
  const activePer = forwardPer ?? per;
  if (activePer !== null && activePer > 50) {
    rawScore -= 10;
    reasons.push({ label: 'PER 과대', points: -Math.round((10 / MAX_RAW) * 100), detail: `PER ${activePer.toFixed(1)} > 50 (밸류 부담)`, met: false });
  }

  const clampedRaw = Math.max(-20, Math.min(rawScore, MAX_RAW));
  const normalizedScore = Math.round(Math.max(0, (clampedRaw / MAX_RAW) * 100) * 10) / 10;

  return {
    rawScore: clampedRaw,
    normalizedScore,
    reasons,
    upside_pct: upsidePct,
  };
}
```

- [x] **Step 4: 테스트 통과 확인**

```bash
cd web && npx vitest run src/lib/scoring/valuation-attractiveness.test.ts 2>&1 | tail -20
```
Expected: PASS (5 tests)

- [x] **Step 5: 커밋**

```bash
cd web && git add src/lib/scoring/valuation-attractiveness.ts src/lib/scoring/valuation-attractiveness.test.ts
git commit -m "feat: 가치매력 점수 모듈 추가 (목표주가 괴리율 1순위)"
```

---

## Task 4: signal-bonus.ts

**Files:**
- Create: `web/src/lib/scoring/signal-bonus.ts`
- Test: `web/src/lib/scoring/signal-bonus.test.ts`

SMS 신호는 10% 가중치 내 보너스. 신호 없어도 다른 축으로 A등급 가능.

- [ ] **Step 1: 실패 테스트 작성**

`web/src/lib/scoring/signal-bonus.test.ts`:
```typescript
import { describe, it, expect } from 'vitest';
import { calcSignalBonus } from './signal-bonus';

describe('calcSignalBonus', () => {
  it('오늘 2개+ 소스 신호 → 60점', () => {
    const result = calcSignalBonus({ todaySourceCount: 2, daysSinceLastSignal: 0, recentCount30d: 1, currentPrice: 10000, lastSignalPrice: 10000 });
    expect(result.normalizedScore).toBe(60);
  });

  it('오늘 1개 소스 신호 → 40점', () => {
    const result = calcSignalBonus({ todaySourceCount: 1, daysSinceLastSignal: 0, recentCount30d: 1, currentPrice: 10000, lastSignalPrice: 10000 });
    expect(result.normalizedScore).toBe(40);
  });

  it('3~10일 경과 + 현재가 ≤ 신호가 → 50점', () => {
    const result = calcSignalBonus({ todaySourceCount: 0, daysSinceLastSignal: 5, recentCount30d: 1, currentPrice: 9500, lastSignalPrice: 10000 });
    expect(result.normalizedScore).toBe(50);
  });

  it('3~10일 경과 + 현재가 > 신호가 → 30점', () => {
    const result = calcSignalBonus({ todaySourceCount: 0, daysSinceLastSignal: 7, recentCount30d: 1, currentPrice: 10500, lastSignalPrice: 10000 });
    expect(result.normalizedScore).toBe(30);
  });

  it('30일 내 3회+ 반복 신호 (경과 11일+) → 20점', () => {
    const result = calcSignalBonus({ todaySourceCount: 0, daysSinceLastSignal: 15, recentCount30d: 4, currentPrice: 10000, lastSignalPrice: null });
    expect(result.normalizedScore).toBe(20);
  });

  it('신호 없음 → 0점', () => {
    const result = calcSignalBonus({ todaySourceCount: 0, daysSinceLastSignal: null, recentCount30d: 0, currentPrice: 10000, lastSignalPrice: null });
    expect(result.normalizedScore).toBe(0);
  });
});
```

- [ ] **Step 2: 실패 확인**

```bash
cd web && npx vitest run src/lib/scoring/signal-bonus.test.ts 2>&1 | tail -20
```
Expected: FAIL (파일 없음)

- [ ] **Step 3: 구현 작성**

`web/src/lib/scoring/signal-bonus.ts`:
```typescript
import type { ScoreReason, NormalizedScoreBase } from '@/types/score-reason';

export interface SignalBonusInput {
  todaySourceCount: number;
  daysSinceLastSignal: number | null;
  recentCount30d: number;
  currentPrice: number | null;
  lastSignalPrice: number | null;
}

export type SignalBonusResult = NormalizedScoreBase;

export function calcSignalBonus(input: SignalBonusInput): SignalBonusResult {
  const { todaySourceCount, daysSinceLastSignal, recentCount30d, currentPrice, lastSignalPrice } = input;
  const reasons: ScoreReason[] = [];
  let score = 0;

  if (todaySourceCount >= 2) {
    // 오늘 2개+ 소스 신호
    score = 60;
    reasons.push({ label: '오늘 신호', points: 60, detail: `오늘 ${todaySourceCount}개 소스 동시 신호`, met: true });
  } else if (todaySourceCount === 1) {
    // 오늘 1개 소스 신호
    score = 40;
    reasons.push({ label: '오늘 신호', points: 40, detail: '오늘 1개 소스 신호', met: true });
  } else if (daysSinceLastSignal !== null && daysSinceLastSignal >= 3 && daysSinceLastSignal <= 10) {
    // 3~10일 경과: 현재가 vs 신호가 비교
    const belowOrAt = lastSignalPrice !== null && currentPrice !== null && currentPrice <= lastSignalPrice;
    score = belowOrAt ? 50 : 30;
    const detail = lastSignalPrice !== null && currentPrice !== null
      ? `${daysSinceLastSignal}일 경과, 현재가 ${currentPrice <= (lastSignalPrice ?? 0) ? '≤' : '>'} 신호가`
      : `${daysSinceLastSignal}일 경과`;
    reasons.push({ label: '최근 신호', points: score, detail, met: true });
  } else if (recentCount30d >= 3 && (daysSinceLastSignal === null || daysSinceLastSignal > 10)) {
    // 30일 내 3회+ 반복 신호 (단, 10일 초과)
    score = 20;
    reasons.push({ label: '반복 신호', points: 20, detail: `30일 내 ${recentCount30d}회 반복 신호`, met: true });
  } else {
    reasons.push({ label: '신호 없음', points: 0, detail: '최근 30일 BUY 신호 없음', met: false });
  }

  return {
    rawScore: score,
    normalizedScore: score,
    reasons,
  };
}
```

- [ ] **Step 4: 테스트 통과 확인**

```bash
cd web && npx vitest run src/lib/scoring/signal-bonus.test.ts 2>&1 | tail -20
```
Expected: PASS (6 tests)

- [ ] **Step 5: 커밋**

```bash
cd web && git add src/lib/scoring/signal-bonus.ts src/lib/scoring/signal-bonus.test.ts
git commit -m "feat: SMS 신호 보너스 모듈 추가 (10% 가중치, 신호 없어도 고득점 가능)"
```

---

## Task 5: composite-score.ts

**Files:**
- Create: `web/src/lib/scoring/composite-score.ts`
- Test: `web/src/lib/scoring/composite-score.test.ts`

4축 가중 합산 + 리스크 감산. 기존 `calcRiskScore()`는 그대로 사용.

- [ ] **Step 1: 실패 테스트 작성**

`web/src/lib/scoring/composite-score.test.ts`:
```typescript
import { describe, it, expect } from 'vitest';
import { calcCompositeScore } from './composite-score';
import type { DailyPrice } from '@/lib/ai-recommendation/technical-score';

function makePrice(close: number): DailyPrice {
  return { date: '2026-01-01', open: close, high: close * 1.01, low: close * 0.99, close, volume: 500000 };
}

describe('calcCompositeScore', () => {
  it('삼성전자 시뮬레이션: 가치 우량 + 기술 전환 → B+ (65점+)', () => {
    // 40일치 하락 후 반등 (52주 저점 +12% 위치)
    const prices: DailyPrice[] = [];
    for (let i = 0; i < 25; i++) prices.push(makePrice(60000 - i * 500));
    for (let i = 0; i < 15; i++) prices.push(makePrice(47500 + i * 600));
    // RSI ~42, MA5 > MA20 근접

    const result = calcCompositeScore({
      prices,
      high52w: 90000,
      low52w: 45000,
      foreignStreak: 3,
      institutionStreak: 1,
      foreignNetQty: 1000000,
      institutionNetQty: 500000,
      foreignNet5d: 2000000,
      institutionNet5d: 800000,
      shortSellRatio: 0.5,
      currentPrice: 56500,
      targetPrice: 72000,  // +27% 괴리
      forwardPer: 12,
      per: 16,
      pbr: 1.0,
      roe: 12,
      dividendYield: 2.0,
      investOpinion: 4.0,
      todaySourceCount: 0,
      daysSinceLastSignal: null,
      recentCount30d: 0,
      lastSignalPrice: null,
      marketCap: 3500000,   // 3,500조 (대형주)
      isManaged: false,
      hasRecentCbw: false,
      auditOpinion: null,
    });

    expect(result.score_total).toBeGreaterThanOrEqual(60);
  });

  it('관리종목 → 리스크 페널티 적용', () => {
    const prices: DailyPrice[] = Array.from({ length: 30 }, (_, i) => makePrice(50 + i));
    const result = calcCompositeScore({
      prices, high52w: 100, low52w: 50,
      foreignStreak: 2, institutionStreak: 2,
      foreignNetQty: 100, institutionNetQty: 100,
      foreignNet5d: 200, institutionNet5d: 200,
      shortSellRatio: 0.5,
      currentPrice: 80,
      targetPrice: 100, forwardPer: 8, per: 10,
      pbr: 0.6, roe: 15, dividendYield: 3, investOpinion: 4.5,
      todaySourceCount: 1, daysSinceLastSignal: 0, recentCount30d: 2, lastSignalPrice: 80,
      marketCap: 500,  // 소형주
      isManaged: true, hasRecentCbw: false, auditOpinion: null,
    });
    // 관리종목 20% 페널티
    const noRiskResult = calcCompositeScore({
      prices, high52w: 100, low52w: 50,
      foreignStreak: 2, institutionStreak: 2,
      foreignNetQty: 100, institutionNetQty: 100,
      foreignNet5d: 200, institutionNet5d: 200,
      shortSellRatio: 0.5,
      currentPrice: 80,
      targetPrice: 100, forwardPer: 8, per: 10,
      pbr: 0.6, roe: 15, dividendYield: 3, investOpinion: 4.5,
      todaySourceCount: 1, daysSinceLastSignal: 0, recentCount30d: 2, lastSignalPrice: 80,
      marketCap: 500,
      isManaged: false, hasRecentCbw: false, auditOpinion: null,
    });
    expect(result.score_total).toBeLessThan(noRiskResult.score_total);
  });

  it('신호 없는 종목도 가치+기술로 고득점 가능', () => {
    const prices: DailyPrice[] = [];
    for (let i = 0; i < 20; i++) prices.push(makePrice(80 + i * 0.5));
    for (let i = 0; i < 10; i++) prices.push(makePrice(90 + i * 0.3));
    const result = calcCompositeScore({
      prices, high52w: 150, low52w: 75,
      foreignStreak: 1, institutionStreak: 1,
      foreignNetQty: 50000, institutionNetQty: 30000,
      foreignNet5d: 80000, institutionNet5d: 50000,
      shortSellRatio: 0.3,
      currentPrice: 93,
      targetPrice: 130,   // +40% 괴리
      forwardPer: 6, per: 9, pbr: 0.5, roe: 18,
      dividendYield: 4, investOpinion: 4.5,
      todaySourceCount: 0, daysSinceLastSignal: null, recentCount30d: 0, lastSignalPrice: null,
      marketCap: 5000,   // 중형주
      isManaged: false, hasRecentCbw: false, auditOpinion: null,
    });
    expect(result.score_total).toBeGreaterThanOrEqual(70);
  });
});
```

- [ ] **Step 2: 실패 확인**

```bash
cd web && npx vitest run src/lib/scoring/composite-score.test.ts 2>&1 | tail -20
```
Expected: FAIL (파일 없음)

- [ ] **Step 3: 구현 작성**

`web/src/lib/scoring/composite-score.ts`:
```typescript
import { calcTechnicalReversal } from './technical-reversal';
import { calcSupplyStrength } from './supply-strength';
import { calcValuationAttractiveness } from './valuation-attractiveness';
import { calcSignalBonus } from './signal-bonus';
import { calcRiskScore } from './risk-score';
import { getMarketCapTier } from '@/lib/ai-recommendation/market-cap-tier';
import type { DailyPrice } from '@/lib/ai-recommendation/technical-score';

export interface CompositeScoreInput {
  // 기술전환
  prices: DailyPrice[];
  high52w: number | null;
  low52w: number | null;
  // 수급강도
  foreignStreak: number | null;
  institutionStreak: number | null;
  foreignNetQty: number | null;
  institutionNetQty: number | null;
  foreignNet5d: number | null;
  institutionNet5d: number | null;
  shortSellRatio: number | null;
  // 가치매력
  currentPrice: number | null;
  targetPrice: number | null;
  forwardPer: number | null;
  per: number | null;
  pbr: number | null;
  roe: number | null;
  dividendYield: number | null;
  investOpinion: number | null;
  // 신호 보너스
  todaySourceCount: number;
  daysSinceLastSignal: number | null;
  recentCount30d: number;
  lastSignalPrice: number | null;
  // 리스크
  marketCap: number | null;
  isManaged?: boolean;
  hasRecentCbw?: boolean;
  auditOpinion?: string | null;
  // 수급 추가 (DART)
  majorShareholderDelta?: number | null;
  hasTreasuryBuyback?: boolean;
}

export interface CompositeScoreResult {
  score_total: number;    // 0~100
  score_technical: number;  // 기술전환 0~100
  score_supply: number;     // 수급강도 0~100
  score_valuation: number;  // 가치매력 0~100
  score_signal: number;     // 신호보너스 0~100
  score_risk: number;       // 리스크 (0 이하)
}

// 티어별 가중치 (W1=기술, W2=수급, W3=가치, W4=신호)
const TIER_WEIGHTS = {
  large: { tech: 30, supply: 25, val: 35, signal: 10 },
  mid:   { tech: 35, supply: 25, val: 30, signal: 10 },
  small: { tech: 38, supply: 28, val: 24, signal: 10 },
};

export function calcCompositeScore(input: CompositeScoreInput): CompositeScoreResult {
  const tier = getMarketCapTier(input.marketCap);
  const weights = TIER_WEIGHTS[tier];

  const techResult = calcTechnicalReversal(input.prices, input.high52w, input.low52w);
  const supplyResult = calcSupplyStrength({
    foreignStreak: input.foreignStreak,
    institutionStreak: input.institutionStreak,
    foreignNetQty: input.foreignNetQty,
    institutionNetQty: input.institutionNetQty,
    foreignNet5d: input.foreignNet5d,
    institutionNet5d: input.institutionNet5d,
    shortSellRatio: input.shortSellRatio,
  });
  const valResult = calcValuationAttractiveness({
    currentPrice: input.currentPrice,
    targetPrice: input.targetPrice,
    forwardPer: input.forwardPer,
    per: input.per,
    pbr: input.pbr,
    roe: input.roe,
    dividendYield: input.dividendYield,
    investOpinion: input.investOpinion,
  });
  const signalResult = calcSignalBonus({
    todaySourceCount: input.todaySourceCount,
    daysSinceLastSignal: input.daysSinceLastSignal,
    recentCount30d: input.recentCount30d,
    currentPrice: input.currentPrice,
    lastSignalPrice: input.lastSignalPrice,
  });

  const riskScore = calcRiskScore({
    is_managed: input.isManaged,
    has_recent_cbw: input.hasRecentCbw,
    audit_opinion: input.auditOpinion,
    major_shareholder_delta: input.majorShareholderDelta,
    has_treasury_buyback: input.hasTreasuryBuyback,
    market_cap: input.marketCap,
  }, 'standard');

  const wSum = weights.tech + weights.supply + weights.val + weights.signal;
  const base = (
    techResult.normalizedScore * weights.tech +
    supplyResult.normalizedScore * weights.supply +
    valResult.normalizedScore * weights.val +
    signalResult.normalizedScore * weights.signal
  ) / wSum;

  // 리스크 페널티: 최대 20% 감산
  const riskPenalty = Math.min(0.20, Math.abs(riskScore) / 100 * 0.20);
  const score_total = Math.min(100, Math.max(0, Math.round(base * (1 - riskPenalty))));

  return {
    score_total,
    score_technical: Math.round(techResult.normalizedScore),
    score_supply: Math.round(supplyResult.normalizedScore),
    score_valuation: Math.round(valResult.normalizedScore),
    score_signal: Math.round(signalResult.normalizedScore),
    score_risk: riskScore,
  };
}
```

- [ ] **Step 4: 테스트 통과 확인**

```bash
cd web && npx vitest run src/lib/scoring/composite-score.test.ts 2>&1 | tail -20
```
Expected: PASS (3 tests)

- [ ] **Step 5: 커밋**

```bash
cd web && git add src/lib/scoring/composite-score.ts src/lib/scoring/composite-score.test.ts
git commit -m "feat: 4축 통합 점수 모듈 추가 (기술전환/수급강도/가치매력/신호보너스)"
```

---

## Task 6: route.ts calcScore() 교체

**Files:**
- Modify: `web/src/app/api/v1/stock-ranking/route.ts`

기존 `calcScore()` (lines 123~429)를 새 `calcCompositeScore()`로 교체하고, daily_prices 배치 쿼리를 추가한다.

**의존관계**: Task 5 완료 후 진행.

- [ ] **Step 1: 상단 import 추가**

`route.ts` 파일 상단 import 블록에 추가:
```typescript
import { calcCompositeScore, type CompositeScoreInput } from '@/lib/scoring/composite-score';
import type { DailyPrice } from '@/lib/ai-recommendation/technical-score';
```

- [ ] **Step 2: calcScore() 함수 교체**

`route.ts`의 `function calcScore(...)` (line 123~429) 전체를 아래로 교체:

```typescript
/**
 * 4축 재설계 스코어링 (기술전환 + 수급강도 + 가치매력 + 신호보너스)
 * daily_prices는 배치 사전 조회 후 전달.
 */
function calcScore(
  stock: Omit<StockRankItem, 'score_total' | 'score_valuation' | 'score_supply' | 'score_signal' | 'score_momentum' | 'ai'>,
  todayStr: string,
  sectorAvgPct: number | null = null,
  scoringModel: string = 'standard',
  prices: DailyPrice[] = [],
) {
  const input: CompositeScoreInput = {
    prices,
    high52w: stock.high_52w,
    low52w: stock.low_52w,
    foreignStreak: stock.foreign_streak,
    institutionStreak: stock.institution_streak,
    foreignNetQty: stock.foreign_net_qty,
    institutionNetQty: stock.institution_net_qty,
    foreignNet5d: stock.foreign_net_5d,
    institutionNet5d: stock.institution_net_5d,
    shortSellRatio: stock.short_sell_ratio,
    currentPrice: stock.current_price,
    targetPrice: stock.target_price,
    forwardPer: stock.forward_per,
    per: stock.per,
    pbr: stock.pbr,
    roe: stock.roe,
    dividendYield: stock.dividend_yield,
    investOpinion: stock.invest_opinion,
    todaySourceCount: (() => {
      // 오늘 신호 소스 수는 signal_count_30d로 근사 (라이브 경로는 0으로 처리)
      // ai_recommendations 경로에서는 덮어씀
      return 0;
    })(),
    daysSinceLastSignal: (() => {
      if (!stock.latest_signal_date) return null;
      const latestDate = new Date(stock.latest_signal_date);
      const today = new Date(todayStr);
      const diffMs = today.getTime() - latestDate.getTime();
      return Math.floor(diffMs / 86400000);
    })(),
    recentCount30d: stock.signal_count_30d ?? 0,
    lastSignalPrice: stock.latest_signal_price,
    marketCap: stock.market_cap,
    isManaged: (stock as Record<string, unknown>).is_managed as boolean | undefined,
    hasRecentCbw: (stock as Record<string, unknown>).has_recent_cbw as boolean | undefined,
    auditOpinion: (stock as Record<string, unknown>).audit_opinion as string | null | undefined,
    majorShareholderDelta: (stock as Record<string, unknown>).major_shareholder_delta as number | null | undefined,
    hasTreasuryBuyback: (stock as Record<string, unknown>).has_treasury_buyback as boolean | undefined,
  };

  const result = calcCompositeScore(input);

  return {
    score_total: result.score_total,
    score_valuation: result.score_valuation,
    score_supply: result.score_supply,
    score_signal: result.score_signal,
    score_momentum: result.score_technical,  // UI 호환: score_momentum = 기술전환
    score_risk: result.score_risk,
  };
}
```

- [ ] **Step 3: daily_prices 배치 쿼리 추가 (섹터 집계 직후)**

`route.ts` line ~1138 (섹터 평균 집계 완료 직후, 스코어링 map 전):
```typescript
// ── daily_prices 배치 조회 (기술전환 점수용, 최근 65거래일) ──
const dailyPricesMap = new Map<string, DailyPrice[]>();
try {
  const cutoffDate = new Date(now.getTime() + 9 * 60 * 60 * 1000 - 70 * 86400000)
    .toISOString().slice(0, 10);
  let dpOffset = 0;
  while (true) {
    const { data: dpRows } = await supabase
      .from('daily_prices')
      .select('symbol, date, open, high, low, close, volume')
      .gte('date', cutoffDate)
      .order('symbol')
      .order('date')
      .range(dpOffset, dpOffset + 9999);
    if (!dpRows?.length) break;
    for (const dp of dpRows) {
      const sym = dp.symbol as string;
      if (!dailyPricesMap.has(sym)) dailyPricesMap.set(sym, []);
      dailyPricesMap.get(sym)!.push({
        date: dp.date as string,
        open: dp.open as number,
        high: dp.high as number,
        low: dp.low as number,
        close: dp.close as number,
        volume: dp.volume as number,
      });
    }
    if (dpRows.length < 10000) break;
    dpOffset += 10000;
  }
} catch (e) {
  console.error('[stock-ranking] daily_prices 배치 쿼리 실패 (기술전환 0점으로 처리):', e);
}
```

- [ ] **Step 4: calcScore() 호출 시 prices 전달**

Line ~1152 `calcScore(base, todayStr, sectorAvgPct, model)` 를:
```typescript
const prices = dailyPricesMap.get(base.symbol) ?? [];
const scores = calcScore(base, todayStr, sectorAvgPct, model, prices);
```

- [ ] **Step 5: 단일 종목 경로도 prices 포함**

`singleSymbol` 경로 (line ~578)에서 calcScore 호출 찾아서 동일하게 처리:
```typescript
// daily_prices for single symbol
const { data: dpSingle } = await supabase
  .from('daily_prices')
  .select('date, open, high, low, close, volume')
  .eq('symbol', singleSymbol)
  .gte('date', new Date(now.getTime() + 9 * 60 * 60 * 1000 - 70 * 86400000).toISOString().slice(0, 10))
  .order('date');
const singlePrices: DailyPrice[] = (dpSingle ?? []).map((dp) => ({
  date: dp.date as string,
  open: dp.open as number,
  high: dp.high as number,
  low: dp.low as number,
  close: dp.close as number,
  volume: dp.volume as number,
}));
```
그리고 해당 경로의 `calcScore(...)` 호출에 `singlePrices` 전달.

- [ ] **Step 6: 빌드 확인**

```bash
cd web && npm run build 2>&1 | tail -30
```
Expected: 빌드 성공 (TypeScript 에러 없음)

- [ ] **Step 7: 커밋**

```bash
cd web && git add src/app/api/v1/stock-ranking/route.ts
git commit -m "feat: stock-ranking calcScore 4축 재설계 적용 + daily_prices 배치 쿼리"
```

---

## Task 7: UnifiedAnalysisSection.tsx 레이블 업데이트

**Files:**
- Modify: `web/src/components/signals/UnifiedAnalysisSection.tsx`

"모멘텀" → "기술전환" 텍스트 변경 및 새 점수 체계 설명 반영.

- [ ] **Step 1: "모멘텀" 레이블 검색**

```bash
cd web && grep -n "모멘텀\|momentum\|score_momentum" src/components/signals/UnifiedAnalysisSection.tsx
```

- [ ] **Step 2: 레이블 교체**

검색 결과에서 사용자 노출 텍스트 `"모멘텀"` → `"기술전환"` 변경. 툴팁 설명도 갱신:
- 기존: "기술적 모멘텀 (가격위치 + 등락률)"
- 신규: "기술전환 (MA 골든크로스 + RSI + 52주 반등)"

`normScores()` 함수는 수정 불필요 (이미 `score_momentum`을 0~100으로 받아 pass-through).

- [ ] **Step 3: 빌드 + 동작 확인**

```bash
cd web && npm run build 2>&1 | tail -15
```

- [ ] **Step 4: 커밋**

```bash
cd web && git add src/components/signals/UnifiedAnalysisSection.tsx
git commit -m "fix: 스코어 레이블 '모멘텀' → '기술전환' 업데이트"
```

---

## Task 8: 전체 테스트 + 검증

- [ ] **Step 1: 전체 유닛 테스트 실행**

```bash
cd web && npx vitest run src/lib/scoring/ 2>&1 | tail -30
```
Expected: 전체 PASS

- [ ] **Step 2: 삼성전자 시뮬레이션 검증 (dev 서버)**

```bash
cd web && npm run dev &
sleep 5
curl -s "http://localhost:3000/api/v1/stock-ranking?symbol=005930" | jq '.items[0] | {score_total, score_momentum, score_supply, score_valuation, score_signal, grade}'
```

Expected:
```json
{
  "score_total": 60-70 (B+ 이상),
  "score_momentum": 30-60,
  "score_supply": 40-70,
  "score_valuation": 50-70,
  "score_signal": 0
}
```

현행 시스템 D등급 → 새 시스템 B+ 이상 확인.

- [ ] **Step 3: 한국전력 검증**

```bash
curl -s "http://localhost:3000/api/v1/stock-ranking?symbol=015760" | jq '.items[0] | {score_total, grade}'
```

Expected: grade B 이상 (현재 D → 개선 확인)

- [ ] **Step 4: 최종 커밋**

```bash
cd web && git add -p
git commit -m "test: 4축 스코어링 재설계 통합 검증 완료"
```

---

## 참고: 향후 스코어 시뮬레이터 (별도 플랜)

현재 범위 외. 다음 플랜에서 구현:
- `/api/v1/score-simulator?date=YYYY-MM-DD&symbol=005930`
- 날짜별 점수 재현 + 1/2/4/8주 수익률 추적
- 점수-수익률 상관관계 차트 (Recharts)
- `/signals?tab=backtest` UI 페이지
