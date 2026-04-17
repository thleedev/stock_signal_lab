# Volume Surge Pre-Signal 스코어링 보완 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 거래량 폭증(vol_ratio 300%+) 종목을 초단기 추천에서 B등급 이상으로 포착 — 한국정보통신(025770) 사례처럼 AI 신호 없이도 급등 전 2일을 B등급 추천으로 잡기

**Architecture:** 4개 파일 수정. pre-filter 3곳 완화(거래대금/종가위치/촉매 조건), supply_score 수급 없음 기본값 중립화(31→50), catalyst_score에 거래량 폭증 항목 추가(최대 55점), short-term-momentum 오케스트레이터에서 volRatioT1 계산 후 catalyst에 전달.

**Tech Stack:** TypeScript, Vitest

---

## 파일 구조

| 파일 | 변경 내용 |
|------|---------|
| `web/src/lib/ai-recommendation/short-term/pre-filter.ts` | `PreFilterInput`에 `volumeRatio` 추가, 거래대금·종가위치·촉매 조건 완화 |
| `web/src/lib/ai-recommendation/short-term/supply-score.ts` | 수급 없음 시 raw: 0→15 (정규화 31→50) |
| `web/src/lib/ai-recommendation/short-term/catalyst-score.ts` | `CatalystInput`에 `volRatioToday/volRatioT1` 추가, `calcVolumeSurgeScore` 함수 신설 |
| `web/src/lib/ai-recommendation/short-term-momentum.ts` | `volRatioT1` 계산 추가, pre-filter·catalyst 호출 시 전달 |
| `web/src/lib/ai-recommendation/__tests__/short-term-scoring.test.ts` | 기존 테스트 수정 + 신규 케이스 추가 |

---

## Task 1: pre-filter — volumeRatio 파라미터 추가 및 필터 완화

**Files:**
- Modify: `web/src/lib/ai-recommendation/short-term/pre-filter.ts:14-114`
- Modify: `web/src/lib/ai-recommendation/__tests__/short-term-scoring.test.ts`

- [ ] **Step 1: 실패 테스트 작성**

`web/src/lib/ai-recommendation/__tests__/short-term-scoring.test.ts` 끝에 추가:

```typescript
describe('applyPreFilter — 거래량 폭증 완화', () => {
  const smallCap: PreFilterInput = {
    priceChangePct: 4.0,
    tradingValue: 10_0000_0000,   // 10억 (200억 미달)
    closePosition: 0.35,          // 0.5 미달
    highPrice: 8500,
    lowPrice: 8000,
    foreignNet: null,
    institutionNet: null,
    daysSinceLastBuy: 999,        // 신호 없음
    sectorStrong: false,
    cumReturn3d: 7,
    volumeRatio: 9.21,            // 921%
  };

  it('거래량 921% — 거래대금 미달이어도 통과', () => {
    const result = applyPreFilter(smallCap);
    expect(result.reasons).not.toContain('거래대금 미달');
  });

  it('거래량 921% — 종가위치 0.35여도 통과', () => {
    const result = applyPreFilter(smallCap);
    expect(result.reasons).not.toContain('종가위치 미달');
  });

  it('거래량 921% — 신호 없어도 촉매 통과', () => {
    const result = applyPreFilter(smallCap);
    expect(result.reasons).not.toContain('촉매 미달');
  });

  it('거래량 921% — 최종 통과', () => {
    const result = applyPreFilter(smallCap);
    expect(result.passed).toBe(true);
  });

  it('거래량 200% + 거래대금 미달 — 여전히 탈락', () => {
    const result = applyPreFilter({ ...smallCap, volumeRatio: 2.0 });
    expect(result.passed).toBe(false);
    expect(result.reasons).toContain('거래대금 미달');
  });

  it('거래량 600% + 종가위치 0.28 — 탈락 (0.3 미만)', () => {
    const result = applyPreFilter({ ...smallCap, volumeRatio: 6.0, closePosition: 0.28 });
    expect(result.passed).toBe(false);
    expect(result.reasons).toContain('종가위치 미달');
  });
});
```

- [ ] **Step 2: 테스트 실행 — 실패 확인**

```bash
cd web && npx vitest run src/lib/ai-recommendation/__tests__/short-term-scoring.test.ts 2>&1 | tail -20
```

Expected: `volumeRatio` 속성 없어서 TypeScript 오류 또는 테스트 실패

- [ ] **Step 3: pre-filter.ts 수정**

`web/src/lib/ai-recommendation/short-term/pre-filter.ts` 전체 교체:

```typescript
/**
 * 초단기 모멘텀 추천 - 1차 필터 (pre-filter)
 *
 * 스코어링 전에 명백히 부적격한 종목을 제거한다.
 * 통과 조건:
 *   - 등락률: >= +0.5% AND < +8%
 *   - 거래대금: >= 200억 OR 거래량비율 >= 300% (소형주 거래량 폭증 예외)
 *   - 종가 위치: >= 0.5 (거래량비율 >= 500% 시 0.3까지 완화)
 *   - 수급: 외국인/기관 중 1개 이상 순매수
 *   - 과열: 3일 누적 +20% 초과 제외
 *   - 촉매: 최근 3일 내 BUY 신호 OR 당일 섹터 강세 OR 거래량비율 >= 300%
 */

export interface PreFilterInput {
  /** 당일 등락률 (%) */
  priceChangePct: number;
  /** 당일 거래대금 (원) */
  tradingValue: number;
  /** (종가-저가)/(고가-저가), 0~1 범위 */
  closePosition: number;
  /** 당일 고가 */
  highPrice: number;
  /** 당일 저가 */
  lowPrice: number;
  /** 외국인 순매수 (주 수, null 허용) */
  foreignNet: number | null;
  /** 기관 순매수 (주 수, null 허용) */
  institutionNet: number | null;
  /** 마지막 BUY 신호로부터 경과일 */
  daysSinceLastBuy: number;
  /** 당일 섹터 강세 여부 */
  sectorStrong: boolean;
  /** 3거래일 누적 등락률 (%) */
  cumReturn3d: number;
  /** 당일 OHLCV 데이터 존재 여부 (false면 거래대금/종가위치 필터 완화) */
  hasTodayCandle?: boolean;
  /** 오늘 BUY 소스 수 (0~3, 촉매 강도 판단용) */
  todayBuySources?: number;
  /** 당일 거래량 / 20일 평균 거래량 (1.0 = 평균, 3.0 = 3배) */
  volumeRatio?: number;
}

export interface PreFilterResult {
  /** 필터 통과 여부 */
  passed: boolean;
  /** 탈락 사유 목록 (통과 시 빈 배열) */
  reasons: string[];
}

/** 최소 거래대금 기준: 200억 원 */
const TRADING_VALUE_MIN = 200_0000_0000;

/** 거래대금 필터 면제 거래량비율 기준: 3배 (300%) */
const VOL_RATIO_TRADING_VALUE_EXEMPT = 3.0;

/** 종가위치 완화 거래량비율 기준: 5배 (500%) */
const VOL_RATIO_CLOSE_POS_RELAX = 5.0;

/** 촉매 인정 거래량비율 기준: 3배 (300%) */
const VOL_RATIO_CATALYST = 3.0;

/**
 * 1차 필터를 적용하여 종목의 초단기 모멘텀 후보 자격을 판정한다.
 *
 * @param input - 필터 입력 데이터
 * @returns 통과 여부 및 탈락 사유
 */
export function applyPreFilter(input: PreFilterInput): PreFilterResult {
  const reasons: string[] = [];

  // 종가위치: 고가=저가(상한가/하한가) 시 1.0 간주
  const closePos =
    input.highPrice === input.lowPrice ? 1.0 : input.closePosition;

  const hasCandle = input.hasTodayCandle !== false;
  const volRatio = input.volumeRatio ?? 0;

  // 촉매 강도 판단: BUY 소스 2개 이상 또는 섹터 강세이면 "강한 촉매"
  const strongCatalyst = (input.todayBuySources ?? 0) >= 2 || input.sectorStrong;

  // 거래량 폭증 여부
  const isVolSurge = volRatio >= VOL_RATIO_TRADING_VALUE_EXEMPT;       // 3배+
  const isVolLargeSurge = volRatio >= VOL_RATIO_CLOSE_POS_RELAX;       // 5배+

  // 1. 등락률 범위 검증
  if (hasCandle) {
    const signalToday = (input.todayBuySources ?? 0) >= 1;
    const lowerBound = strongCatalyst ? -1 : signalToday ? 0 : 0.5;
    if (input.priceChangePct < lowerBound || input.priceChangePct >= 8) {
      reasons.push('등락률 범위 미달');
    }
  }

  // 2. 거래대금 검증 — 거래량 300%+ 이면 소형주도 통과
  if (hasCandle && input.tradingValue < TRADING_VALUE_MIN && !isVolSurge) {
    reasons.push('거래대금 미달');
  }

  // 3. 종가 위치 검증
  //    - 거래량 500%+: 0.3까지 허용 (세력 매집 시 막판 눌림 패턴)
  //    - 강한 촉매: 0.4까지 허용
  //    - 기본: 0.5 이상
  const closePosMin = isVolLargeSurge ? 0.3 : strongCatalyst ? 0.4 : 0.5;
  if (hasCandle && closePos < closePosMin) {
    reasons.push('종가위치 미달');
  }

  // 4. 수급 검증 (외국인/기관 중 1개 이상 순매수)
  const hasForeignBuy = (input.foreignNet ?? 0) > 0;
  const hasInstitutionBuy = (input.institutionNet ?? 0) > 0;
  const supplyDataExists = input.foreignNet !== null || input.institutionNet !== null;
  if (supplyDataExists && !hasForeignBuy && !hasInstitutionBuy) {
    reasons.push('수급 미달');
  }

  // 5. 과열 검증 (3일 누적 +20% 초과 제외)
  if (input.cumReturn3d > 20) {
    reasons.push('과열');
  }

  // 6. 촉매 검증 — BUY 신호 OR 섹터 강세 OR 거래량 300%+
  const hasCatalyst =
    input.daysSinceLastBuy <= 3 || input.sectorStrong || isVolSurge;
  if (!hasCatalyst) {
    reasons.push('촉매 미달');
  }

  return { passed: reasons.length === 0, reasons };
}
```

- [ ] **Step 4: 테스트 실행 — 통과 확인**

```bash
cd web && npx vitest run src/lib/ai-recommendation/__tests__/short-term-scoring.test.ts 2>&1 | tail -20
```

Expected: 모든 테스트 PASS

- [ ] **Step 5: 커밋**

```bash
cd web && git add src/lib/ai-recommendation/short-term/pre-filter.ts src/lib/ai-recommendation/__tests__/short-term-scoring.test.ts && git commit -m "feat: pre-filter 거래량 폭증 소형주 예외 처리

- volumeRatio 파라미터 추가 (PreFilterInput)
- 거래대금 미달이어도 거래량 300%+ 이면 통과
- 종가위치 0.5→0.3 완화 (거래량 500%+ 시)
- 촉매 조건에 거래량 300%+ 추가"
```

---

## Task 2: supply-score — 수급 없음 기본값 중립화

**Files:**
- Modify: `web/src/lib/ai-recommendation/short-term/supply-score.ts:160-171`

현재 수급 데이터 없음 → raw=0 → normalized=31 (약세 성향)
목표: raw=15 → normalized=50 (중립)

계산: normalized = (raw + 25) / 80 * 100
50 = (raw + 25) / 80 * 100 → raw = 15

- [ ] **Step 1: 실패 테스트 작성**

`web/src/lib/ai-recommendation/__tests__/short-term-scoring.test.ts` 끝에 추가:

```typescript
import { calcShortTermSupplyScore } from '../short-term/supply-score';

describe('calcShortTermSupplyScore — 수급 없음 중립화', () => {
  it('외국인/기관 데이터 모두 null → normalized=50', () => {
    const result = calcShortTermSupplyScore({
      foreignNet: null,
      institutionNet: null,
      programNet: null,
      foreignStreak: null,
      institutionStreak: null,
      programStreak: null,
    });
    expect(result.normalized).toBe(50);
    expect(result.raw).toBe(15);
  });

  it('데이터 있으면 기존 로직 그대로', () => {
    const result = calcShortTermSupplyScore({
      foreignNet: 1000,
      institutionNet: 500,
      programNet: null,
      foreignStreak: 1,
      institutionStreak: 1,
      programStreak: null,
    });
    // 외국인(10)+기관(10)+동반보너스(12)+외국인첫날(10)+기관첫날(10) = 52 → clamp 55
    expect(result.normalized).toBeGreaterThan(50);
  });
});
```

- [ ] **Step 2: 테스트 실행 — 실패 확인**

```bash
cd web && npx vitest run src/lib/ai-recommendation/__tests__/short-term-scoring.test.ts --reporter=verbose 2>&1 | grep -A2 "수급 없음"
```

Expected: `normalized=31` 이어서 `expected 31 to be 50` 실패

- [ ] **Step 3: supply-score.ts 수정**

`web/src/lib/ai-recommendation/short-term/supply-score.ts` 163~170줄 교체:

```typescript
  if (!supplyDataAvailable) {
    // 수급 데이터 없음 = "모름(중립)" 으로 처리
    // raw=15 → normalized = (15+25)/80*100 = 50
    // (기존 raw=0 → normalized=31 은 "모름을 약세로 처리"하는 구조적 편향)
    const neutralRaw = 15;
    return {
      raw: neutralRaw,
      normalized: Math.round(((neutralRaw + 25) / 80) * 100), // 50
      foreignBuying: false,
      institutionBuying: false,
    };
  }
```

- [ ] **Step 4: 테스트 실행 — 통과 확인**

```bash
cd web && npx vitest run src/lib/ai-recommendation/__tests__/short-term-scoring.test.ts 2>&1 | tail -10
```

Expected: 모든 테스트 PASS

- [ ] **Step 5: 커밋**

```bash
cd web && git add src/lib/ai-recommendation/short-term/supply-score.ts src/lib/ai-recommendation/__tests__/short-term-scoring.test.ts && git commit -m "feat: supply-score 수급 없음 기본값 중립화 (31→50)

소형주는 외국인/기관 수급 데이터가 구조적으로 없음.
'모름'을 '최악'(31)이 아닌 '중립'(50)으로 처리."
```

---

## Task 3: catalyst-score — 거래량 폭증 항목 추가

**Files:**
- Modify: `web/src/lib/ai-recommendation/short-term/catalyst-score.ts`

현재 원점수 범위: -10 ~ 70 → 정규화: (raw+10)/80*100
거래량 폭증 항목 추가 후 원점수 최대 +55 → 범위: -10 ~ 100 (클램프 유지)

- [ ] **Step 1: 실패 테스트 작성**

`web/src/lib/ai-recommendation/__tests__/short-term-scoring.test.ts` 끝에 추가:

```typescript
import { calcCatalystScore } from '../short-term/catalyst-score';

describe('calcCatalystScore — 거래량 폭증', () => {
  const noSignalBase = {
    todayBuySources: 0,
    daysSinceLastBuy: 999,
    sectorRank: null,
    sectorCount: 20,
    sectorAvgChangePct: 0,
    stockChangePct: 4.0,
    stockRankInSector: null,
    sectorStockCount: 30,
    signalPriceGapPct: null,
    volRatioToday: 0,
    volRatioT1: 0,
  };

  it('신호 없음 + 거래량 0% → normalized 낮음 (<30)', () => {
    const result = calcCatalystScore(noSignalBase);
    expect(result.normalized).toBeLessThan(30);
  });

  it('오늘 거래량 921% (단일 폭증) → normalized >= 55', () => {
    const result = calcCatalystScore({ ...noSignalBase, volRatioToday: 9.21, volRatioT1: 1.7 });
    expect(result.normalized).toBeGreaterThanOrEqual(55);
  });

  it('오늘 661% + 전날 868% (양일 연속) → normalized >= 65', () => {
    const result = calcCatalystScore({ ...noSignalBase, volRatioToday: 6.61, volRatioT1: 8.68 });
    expect(result.normalized).toBeGreaterThanOrEqual(65);
  });

  it('오늘 거래량 200% → 폭증 보너스 없음', () => {
    const noSurge = calcCatalystScore({ ...noSignalBase, volRatioToday: 2.0 });
    const surge = calcCatalystScore({ ...noSignalBase, volRatioToday: 5.0 });
    expect(surge.normalized).toBeGreaterThan(noSurge.normalized);
  });
});
```

- [ ] **Step 2: 테스트 실행 — 실패 확인**

```bash
cd web && npx vitest run src/lib/ai-recommendation/__tests__/short-term-scoring.test.ts --reporter=verbose 2>&1 | grep -A3 "거래량 폭증"
```

Expected: `volRatioToday` 속성 없어서 타입 오류 또는 normalized 값 기준 미충족

- [ ] **Step 3: catalyst-score.ts 수정**

`web/src/lib/ai-recommendation/short-term/catalyst-score.ts` 전체 교체:

```typescript
/**
 * 초단기 촉매 스코어
 *
 * 원점수 범위: -10 ~ 100 -> 정규화: (raw + 10) / 110 * 100
 *
 * 구성 요소:
 *   A. 신호 신선도 (최대 25점)
 *   B. 섹터/테마 모멘텀 (최대 25점)
 *   C. 신호가 대비 현재 위치 (최대 20점)
 *   D. 거래량 폭증 (최대 55점) — NEW
 */

export interface CatalystInput {
  /** 오늘 BUY 소스 수 (0~3) */
  todayBuySources: number;
  /** 마지막 BUY로부터 경과일 (0=오늘) */
  daysSinceLastBuy: number;
  /** 섹터 상승률 순위 (1=최상), null이면 정보 없음 */
  sectorRank: number | null;
  /** 총 섹터 수 */
  sectorCount: number;
  /** 해당 섹터 평균 등락률 (%) */
  sectorAvgChangePct: number;
  /** 해당 종목 등락률 (%) */
  stockChangePct: number;
  /** 섹터 내 종목 등락률 순위, null이면 정보 없음 */
  stockRankInSector: number | null;
  /** 해당 섹터 내 종목 수 */
  sectorStockCount: number;
  /** (현재가-신호가)/신호가 * 100, null이면 신호가 없음 */
  signalPriceGapPct: number | null;
  /** 당일 거래량 / 20일 평균 거래량 (1.0=평균, 9.21=921%) */
  volRatioToday: number;
  /** 전일 거래량 / 20일 평균 거래량 */
  volRatioT1: number;
}

export interface CatalystResult {
  /** 원점수 (-10 ~ 100) */
  raw: number;
  /** 정규화 점수 (0 ~ 100) */
  normalized: number;
}

// ---------------------------------------------------------------------------
// A. 신호 신선도 (최대 25점)
// ---------------------------------------------------------------------------

function calcSignalFreshnessScore(
  todayBuySources: number,
  daysSinceLastBuy: number,
): number {
  if (todayBuySources >= 3) return 25;
  if (todayBuySources === 2) return 20;
  if (todayBuySources === 1) return 15;
  if (daysSinceLastBuy === 1) return 10;
  if (daysSinceLastBuy <= 3) return 5;
  return 0;
}

// ---------------------------------------------------------------------------
// B. 섹터/테마 모멘텀 (최대 25점)
// ---------------------------------------------------------------------------

function calcSectorMomentumScore(
  sectorRank: number | null,
  sectorCount: number,
  sectorAvgChangePct: number,
  stockChangePct: number,
  stockRankInSector: number | null,
  sectorStockCount: number,
): number {
  if (sectorAvgChangePct < -1) return -10;
  if (sectorAvgChangePct < 0 && stockChangePct > 0) return 3;
  if (sectorRank !== null && sectorRank <= 3) return 20;
  if (
    stockRankInSector !== null &&
    sectorStockCount > 0 &&
    stockRankInSector <= sectorStockCount * 0.3
  ) {
    return 15;
  }
  if (stockChangePct > sectorAvgChangePct) return 8;
  return 0;
}

// ---------------------------------------------------------------------------
// C. 신호가 대비 현재 위치 (최대 20점)
// ---------------------------------------------------------------------------

function calcSignalPricePositionScore(
  signalPriceGapPct: number | null,
): number {
  if (signalPriceGapPct === null) return 5;
  if (signalPriceGapPct <= -3) return 20;
  if (signalPriceGapPct <= 0) return 15;
  if (signalPriceGapPct < 3) return 8;
  if (signalPriceGapPct < 7) return 3;
  return 0;
}

// ---------------------------------------------------------------------------
// D. 거래량 폭증 패턴 (최대 55점) — NEW
// ---------------------------------------------------------------------------

/**
 * 거래량 폭증 패턴 점수를 계산한다.
 *
 * 근거: DB 분석 결과, 최근 3개월 15%+ 급등 종목 30건 전체에서
 *       전날·전전날 거래량이 20일 평균의 3배 이상이었음.
 *
 * - 양일 연속 500%+ (가장 강한 매집 신호): 55점
 * - 오늘 700%+ + 전날 200%+: 45점
 * - 오늘 500%+ (단일): 35점
 * - 오늘 300%+: 20점
 * - 기준 미달: 0점
 */
function calcVolumeSurgeScore(
  volRatioToday: number,
  volRatioT1: number,
): number {
  // 양일 연속 대량 (today >= 5배 AND T-1 >= 5배)
  if (volRatioToday >= 5.0 && volRatioT1 >= 5.0) return 55;
  // 오늘 초대량 + 전날 일부 (today >= 7배 AND T-1 >= 2배)
  if (volRatioToday >= 7.0 && volRatioT1 >= 2.0) return 45;
  // 오늘 대량 단일 (today >= 5배)
  if (volRatioToday >= 5.0) return 35;
  // 오늘 중량 (today >= 3배)
  if (volRatioToday >= 3.0) return 20;
  return 0;
}

// ---------------------------------------------------------------------------
// 메인 함수
// ---------------------------------------------------------------------------

/**
 * 초단기 촉매 스코어를 계산한다.
 *
 * 원점수 범위: -10 ~ 100
 * 정규화: (raw + 10) / 110 * 100 -> 0 ~ 100
 */
export function calcCatalystScore(input: CatalystInput): CatalystResult {
  const a = calcSignalFreshnessScore(input.todayBuySources, input.daysSinceLastBuy);
  const b = calcSectorMomentumScore(
    input.sectorRank,
    input.sectorCount,
    input.sectorAvgChangePct,
    input.stockChangePct,
    input.stockRankInSector,
    input.sectorStockCount,
  );
  const c = calcSignalPricePositionScore(input.signalPriceGapPct);
  const d = calcVolumeSurgeScore(input.volRatioToday, input.volRatioT1);

  // 원점수 합산 후 범위 clamp
  const rawUnclamped = a + b + c + d;
  const raw = Math.max(-10, Math.min(100, rawUnclamped));

  // 정규화: (raw + 10) / 110 * 100
  const normalized = Math.max(0, Math.min(100, ((raw + 10) / 110) * 100));

  return { raw, normalized };
}
```

- [ ] **Step 4: 테스트 실행 — 통과 확인**

```bash
cd web && npx vitest run src/lib/ai-recommendation/__tests__/short-term-scoring.test.ts 2>&1 | tail -15
```

Expected: 모든 테스트 PASS

- [ ] **Step 5: 커밋**

```bash
cd web && git add src/lib/ai-recommendation/short-term/catalyst-score.ts src/lib/ai-recommendation/__tests__/short-term-scoring.test.ts && git commit -m "feat: catalyst-score 거래량 폭증 항목 추가 (최대 55점)

- CatalystInput에 volRatioToday, volRatioT1 추가
- calcVolumeSurgeScore 함수 신설
- 정규화 범위 조정: (raw+10)/80 → (raw+10)/110
  (원점수 최대 100점 반영)"
```

---

## Task 4: short-term-momentum 오케스트레이터 — volRatioT1 계산 및 전달

**Files:**
- Modify: `web/src/lib/ai-recommendation/short-term-momentum.ts:384-521`

현재 `volumeRatio` = 오늘 거래량 / 최근 20일 평균 (이미 계산됨)
추가: `volRatioT1` = 전일 거래량 / 최근 20일 평균

- [ ] **Step 1: volRatioT1 계산 추가**

`short-term-momentum.ts` 390번째 줄 (`const volumeRatio = ...`) 바로 다음에 추가:

```typescript
    // 전일 거래량 비율 (20일 평균 대비) — 거래량 폭증 연속성 감지용
    const yesterdayVolume = yesterday?.volume as number ?? 0;
    const volRatioT1 = avgVol > 0 ? yesterdayVolume / avgVol : 0;
```

- [ ] **Step 2: preFilterInput에 volumeRatio 추가**

`short-term-momentum.ts` 459~472번째 줄 `preFilterInput` 객체에 추가:

```typescript
    const preFilterInput: PreFilterInput = {
      priceChangePct,
      tradingValue,
      closePosition,
      highPrice: todayHigh,
      lowPrice: todayLow,
      foreignNet,
      institutionNet,
      daysSinceLastBuy,
      sectorStrong,
      cumReturn3d,
      hasTodayCandle: isLatestToday,
      todayBuySources,
      volumeRatio,   // ← 추가
    };
```

- [ ] **Step 3: catalystInput에 volRatioToday, volRatioT1 추가**

`short-term-momentum.ts` 510~521번째 줄 `catalystInput` 객체에 추가:

```typescript
    const catalystInput: CatalystInput = {
      todayBuySources,
      daysSinceLastBuy,
      sectorRank,
      sectorCount: totalSectorCount,
      sectorAvgChangePct,
      stockChangePct: priceChangePct,
      stockRankInSector,
      sectorStockCount,
      signalPriceGapPct,
      volRatioToday: volumeRatio,   // ← 추가
      volRatioT1,                    // ← 추가
    };
```

- [ ] **Step 4: 타입 체크 및 빌드**

```bash
cd web && npx tsc --noEmit 2>&1 | head -30
```

Expected: 오류 없음. 있으면 수정.

- [ ] **Step 5: 전체 테스트 실행**

```bash
cd web && npx vitest run 2>&1 | tail -20
```

Expected: 모든 테스트 PASS (기존 테스트 포함)

- [ ] **Step 6: 커밋**

```bash
cd web && git add src/lib/ai-recommendation/short-term-momentum.ts && git commit -m "feat: 오케스트레이터에서 volRatioT1 계산 및 catalyst/pre-filter 전달

거래량 연속 폭증 패턴 감지를 위한 전일 거래량비율 추가"
```

---

## Task 5: 통합 검증 — 빌드 및 최종 확인

**Files:** 없음 (검증만)

- [ ] **Step 1: 전체 테스트**

```bash
cd web && npx vitest run 2>&1 | tail -30
```

Expected: 모든 테스트 PASS, 실패 없음

- [ ] **Step 2: 프로덕션 빌드**

```bash
cd web && npm run build 2>&1 | tail -20
```

Expected: `✓ Compiled successfully` 또는 오류 없이 완료

- [ ] **Step 3: 점수 검증 (수동 계산)**

아래 스코어 조합으로 최종 점수가 B(40+)인지 확인:
- 4/14 시뮬레이션: momentum=53, supply=50, catalyst=69 (d=45, c=5, a=0, b=8+5), valuation=25
- 기대 최종 점수: `(53×28 + 50×18 + 69×27 + 25×12) / 85 ≈ 48` → B+

> 참고: 정규화 공식 변경으로 catalyst normalized = (45+5+8+10+10) / 110 * 100 ≈ 71
> 최종 = (53×28 + 50×18 + 71×27 + 25×12) / 85 ≈ 48.4 → B+

- [ ] **Step 4: 최종 커밋 (태그)**

```bash
cd web && git tag -a v-volume-surge-scoring -m "Volume Surge Pre-Signal 스코어링 보완 완료"
```

---

## 셀프 리뷰

**스펙 커버리지 확인:**
- ✅ pre-filter 거래대금 완화 (Task 1)
- ✅ pre-filter 종가위치 완화 (Task 1)
- ✅ pre-filter 촉매 조건 완화 (Task 1)
- ✅ supply 기본값 중립화 (Task 2)
- ✅ catalyst 거래량 폭증 항목 추가 (Task 3)
- ✅ 오케스트레이터 volRatioT1 전달 (Task 4)

**타입 일관성:**
- `PreFilterInput.volumeRatio: number` — Task 1 추가, Task 4 전달
- `CatalystInput.volRatioToday: number`, `CatalystInput.volRatioT1: number` — Task 3 추가, Task 4 전달
- `volumeRatio` (오케스트레이터 기존 변수, 비율 단위) → `volRatioToday`로 그대로 전달 ✅
