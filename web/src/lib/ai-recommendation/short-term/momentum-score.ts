/**
 * 초단기 모멘텀 스코어 (가격×거래량 통합)
 *
 * 원점수 범위: -10 ~ 90 → 정규화: (raw + 10) / 100 × 100
 *
 * 구성 요소:
 *   A. 가격-거래량 동반 시그널 (최대 35점)
 *   B. 종가 위치 (최대 20점)
 *   C. 갭업 + 전일 패턴 (합산 후 clamp 20점)
 *   D. 거래대금 (최대 15점)
 */

// ---------------------------------------------------------------------------
// 인터페이스 정의
// ---------------------------------------------------------------------------

export interface MomentumInput {
  /** 당일 등락률 (%) */
  priceChangePct: number;
  /** 당일 거래량 / 20일 평균 거래량 */
  volumeRatio: number;
  /** (종가-저가)/(고가-저가), already calculated */
  closePosition: number;
  /** 고가=저가 여부 */
  highEqualsLow: boolean;
  /** (시가-전일종가)/전일종가 * 100, null if open is null */
  gapPct: number | null;
  /** 전일 (종가-시가)/시가 * 100, null if unavailable */
  prevBodyPct: number | null;
  /** 2일 연속 양봉 */
  isConsecutiveBullish: boolean;
  /** 전일 고점 돌파 (todayClose > prevHigh) */
  prevHighBreakout: boolean;
  /** 3일 박스 상단 돌파 */
  box3dBreakout: boolean;
  /** 거래대금 (원) */
  tradingValue: number;
  /** 2일 연속 장대양봉(각 ≥ +5%) - for risk */
  isConsecutive2dLargeBullish: boolean;
}

export interface MomentumResult {
  /** 원점수 (-10 ~ 90) */
  raw: number;
  /** 정규화 점수 (0 ~ 100) */
  normalized: number;
}

// ---------------------------------------------------------------------------
// A. 가격-거래량 동반 시그널 (최대 35점)
// ---------------------------------------------------------------------------

/**
 * 등락률 × 거래량 배수 매트릭스에서 점수를 반환한다.
 *
 * 거래량 배수 = 당일 거래량 / 20일 평균 거래량
 * 구간: [이상, 미만) 형식
 */
function calcPriceVolumeScore(priceChangePct: number, volumeRatio: number): number {
  // 거래량 구간 인덱스: 0 = ≥2배, 1 = [1.5, 2), 2 = <1.5
  const volIdx = volumeRatio >= 2 ? 0 : volumeRatio >= 1.5 ? 1 : 2;

  // 등락률 구간별 점수 매트릭스 (행: 등락률 구간, 열: 거래량 구간)
  // 등락률 우선순위 순서대로 매칭
  const pct = priceChangePct;

  if (pct >= 8) {
    // 등락률 ≥ +8%
    return [-5, -8, -10][volIdx];
  }
  if (pct >= 6) {
    // 등락률 [+6%, +8%)
    return [15, 12, 5][volIdx];
  }
  if (pct >= 3) {
    // 등락률 [+3%, +6%)
    return [30, 25, 15][volIdx];
  }
  if (pct >= 1) {
    // 등락률 [+1%, +3%) — 최적 구간
    return [35, 28, 18][volIdx];
  }
  if (pct >= 0.5) {
    // 등락률 [+0.5%, +1%)
    return [22, 15, 8][volIdx];
  }
  // 등락률 [-1%, +0.5%)
  if (pct >= -1) {
    return [12, 8, 3][volIdx];
  }

  // 등락률 < -1%: 매트릭스 범위 밖 → 0점
  return 0;
}

// ---------------------------------------------------------------------------
// B. 종가 위치 (최대 20점)
// ---------------------------------------------------------------------------

/**
 * 종가 위치 점수를 반환한다.
 * 고가=저가 → 종가위치 1.0 처리
 * open null 케이스는 closePosition 값 그대로 사용 (호출자가 0 전달)
 */
function calcClosePositionScore(closePosition: number, highEqualsLow: boolean): number {
  const pos = highEqualsLow ? 1.0 : closePosition;

  if (pos >= 0.8) return 20;
  if (pos >= 0.6) return 12;
  if (pos >= 0.4) return 5;   // 3→5 (저가권 종목의 과도한 감점 완화)
  if (pos >= 0.3) return 0;   // 신규: 0.3~0.4 구간은 중립 (강한 촉매로 프리필터 통과한 종목)
  return -10;
}

// ---------------------------------------------------------------------------
// C. 갭업 + 전일 패턴 (합산 후 clamp 20점)
// ---------------------------------------------------------------------------

/**
 * 갭업 조건(상위 3개) 중 하나만 선택 + 패턴 조건(하위)은 복수 합산
 * → 전체 합산 후 20점 clamp
 *
 * gapPct null → 0점 반환 (open 데이터 없음)
 */
function calcGapPatternScore(
  gapPct: number | null,
  prevBodyPct: number | null,
  isConsecutiveBullish: boolean,
  prevHighBreakout: boolean,
  box3dBreakout: boolean,
): number {
  // open null → 0점
  if (gapPct === null) return 0;

  const isPrevLargeBullish = prevBodyPct !== null && prevBodyPct >= 3;
  const isSmallGapUp = gapPct >= 1 && gapPct < 3;
  const isFlatOpen = gapPct >= 0 && gapPct < 1;
  const isLargeGapUp = gapPct >= 3;
  const isGapDown = gapPct < 0;

  // --- 갭업 조건: 상위 3개 중 하나만 선택 (우선순위 순) ---
  let gapScore = 0;

  if (isPrevLargeBullish && isSmallGapUp) {
    // 전일 장대양봉 + 당일 소폭 갭업 [+1%, +3%)
    gapScore = 20;
  } else if (isPrevLargeBullish && isFlatOpen) {
    // 전일 장대양봉 + 당일 보합 출발
    gapScore = 15;
  } else if (isSmallGapUp) {
    // 당일 갭업 [+1%, +3%) (전일 무관)
    gapScore = 12;
  } else if (isLargeGapUp) {
    // 갭업 ≥ +3%
    gapScore = 3;
  } else if (isGapDown) {
    // 갭다운 (갭 < 0%)
    gapScore = 0;
  }

  // --- 패턴 조건: 복수 합산 ---
  let patternScore = 0;

  if (isConsecutiveBullish) patternScore += 10;
  if (prevHighBreakout) patternScore += 10;
  if (box3dBreakout) patternScore += 8;

  // 전체 합산 후 20점 clamp
  return Math.min(gapScore + patternScore, 20);
}

// ---------------------------------------------------------------------------
// D. 거래대금 (최대 15점)
// ---------------------------------------------------------------------------

/** 거래대금 기준 점수를 반환한다. */
function calcTradingValueScore(tradingValue: number): number {
  const tv = tradingValue;

  if (tv >= 1000_0000_0000) return 15; // ≥ 1,000억
  if (tv >= 500_0000_0000) return 10;  // [500억, 1,000억)
  if (tv >= 200_0000_0000) return 5;   // [200억, 500억)
  return 0;
}

// ---------------------------------------------------------------------------
// 메인 함수
// ---------------------------------------------------------------------------

/**
 * 초단기 모멘텀 스코어를 계산한다.
 *
 * 원점수 범위: -10 ~ 90
 * 정규화: (raw + 10) / 100 × 100 → 0 ~ 100
 */
export function calcMomentumScore(input: MomentumInput): MomentumResult {
  const a = calcPriceVolumeScore(input.priceChangePct, input.volumeRatio);
  const b = calcClosePositionScore(input.closePosition, input.highEqualsLow);
  const c = calcGapPatternScore(
    input.gapPct,
    input.prevBodyPct,
    input.isConsecutiveBullish,
    input.prevHighBreakout,
    input.box3dBreakout,
  );
  const d = calcTradingValueScore(input.tradingValue);

  // 원점수 합산 후 범위 clamp
  const rawUnclamped = a + b + c + d;
  const raw = Math.max(-10, Math.min(90, rawUnclamped));

  // 정규화: (raw + 10) / 100 × 100
  const normalized = Math.max(0, Math.min(100, ((raw + 10) / 100) * 100));

  return { raw, normalized };
}
