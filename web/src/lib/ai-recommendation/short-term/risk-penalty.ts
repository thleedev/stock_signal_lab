/**
 * 초단기 리스크 패널티
 *
 * 감점 절대값 합산 후 clamp(0, 100)
 *
 * 구성 요소:
 *   A. 과열 패널티
 *   B. 캔들 위험 패널티 (open null이면 전부 skip)
 *   C. 추격매수 패널티
 *
 * 결과값은 양수로 저장되며, 최종 공식에서 차감된다.
 * (예: raw=20이면 20점 감점)
 */

// ---------------------------------------------------------------------------
// 인터페이스 정의
// ---------------------------------------------------------------------------

export interface RiskInput {
  /** 당일 등락률 (%) */
  priceChangePct: number;
  /** 3거래일 누적 수익률 (%) */
  cumReturn3d: number;
  /** 거래량 비율 (당일 / 20일 평균) */
  volumeRatio: number;
  /** 당일 시가, null이면 캔들 위험 skip */
  todayOpen: number | null;
  /** 당일 종가 */
  todayClose: number;
  /** 당일 고가 */
  todayHigh: number;
  /** 윗꼬리 길이: high - max(open, close) */
  upperShadow: number;
  /** 몸통 크기: abs(close - open) */
  bodySize: number;
  /** 신호가 대비 괴리율 (%), null이면 신호가 없음 */
  signalPriceGapPct: number | null;
  /** 거래대금 (원) */
  tradingValue: number;
  /** 2일 연속 장대양봉(각 >= +5%) 후 3일째 여부 */
  isConsecutive2dLargeBullish: boolean;
}

export interface RiskResult {
  /** 원점수 (0 ~ 100), 양수 = 감점 절대값 */
  raw: number;
  /** 정규화 점수 (raw와 동일, 이미 0~100) */
  normalized: number;
}

// ---------------------------------------------------------------------------
// A. 과열 패널티
// ---------------------------------------------------------------------------

/**
 * 과열 감점을 계산한다.
 *
 * - 당일 >= +12%: -20
 * - 3거래일 누적 >= +20%: -20
 * - 당일 >= +10% + 거래량 < 20일 평균 (volumeRatio < 1.0): -15
 *
 * 조건별 독립 누적된다.
 */
function calcOverheatPenalty(
  priceChangePct: number,
  cumReturn3d: number,
  volumeRatio: number,
): number {
  let penalty = 0;

  if (priceChangePct >= 12) penalty += 20;
  if (cumReturn3d >= 20) penalty += 20;
  if (priceChangePct >= 10 && volumeRatio < 1.0) penalty += 15;

  return penalty;
}

// ---------------------------------------------------------------------------
// B. 캔들 위험 패널티 (open null이면 전부 skip)
// ---------------------------------------------------------------------------

/**
 * 캔들 패턴 위험 감점을 계산한다.
 *
 * - 윗꼬리 >= 몸통 2배: -12
 * - 종가 < 시가 (음봉전환) + 등락률 양전 (changePct > 0): -10
 * - 종가 < 시가 * 0.97 (장마감 급락): -12
 *
 * open이 null이면 모든 캔들 위험을 skip한다.
 */
function calcCandlePenalty(
  todayOpen: number | null,
  todayClose: number,
  upperShadow: number,
  bodySize: number,
  priceChangePct: number,
): number {
  // open이 null이면 캔들 위험 전부 skip
  if (todayOpen === null) return 0;

  let penalty = 0;

  // 윗꼬리 >= 몸통 2배
  if (upperShadow >= bodySize * 2) penalty += 12;

  // 종가 < 시가 (음봉전환) + 등락률 양전
  if (todayClose < todayOpen && priceChangePct > 0) penalty += 10;

  // 종가 < 시가 * 0.97 (장마감 급락)
  if (todayClose < todayOpen * 0.97) penalty += 12;

  return penalty;
}

// ---------------------------------------------------------------------------
// C. 추격매수 패널티
// ---------------------------------------------------------------------------

/**
 * 추격매수 위험 감점을 계산한다.
 *
 * - 신호가 대비 [+7%, +12%): -12
 * - 신호가 대비 >= +12%: -20
 * - 거래대금 < 100억 + 등락률 > +3%: -10
 * - 2일 연속 장대양봉(각 >= +5%) 후 3일째: -15
 *
 * 신호가 대비 조건은 하나만 적용 (상위 조건 우선).
 */
function calcChasePenalty(
  signalPriceGapPct: number | null,
  tradingValue: number,
  priceChangePct: number,
  isConsecutive2dLargeBullish: boolean,
): number {
  let penalty = 0;

  // 신호가 대비 괴리율 (상위 조건 우선, 하나만 적용)
  if (signalPriceGapPct !== null) {
    if (signalPriceGapPct >= 12) {
      penalty += 20;
    } else if (signalPriceGapPct >= 7) {
      penalty += 12;
    }
  }

  // 거래대금 < 100억 + 등락률 > +3%
  const TRADING_VALUE_100B = 100_0000_0000; // 100억 원
  if (tradingValue < TRADING_VALUE_100B && priceChangePct > 3) {
    penalty += 10;
  }

  // 2일 연속 장대양봉 후 3일째
  if (isConsecutive2dLargeBullish) {
    penalty += 15;
  }

  return penalty;
}

// ---------------------------------------------------------------------------
// 메인 함수
// ---------------------------------------------------------------------------

/**
 * 리스크 패널티를 계산한다.
 *
 * 각 카테고리(과열, 캔들, 추격매수)의 감점을 절대값으로 합산한 뒤
 * clamp(0, 100)으로 제한한다.
 *
 * 결과값은 양수이며 최종 공식에서 차감된다.
 */
export function calcRiskPenalty(input: RiskInput): RiskResult {
  const overheat = calcOverheatPenalty(
    input.priceChangePct,
    input.cumReturn3d,
    input.volumeRatio,
  );

  const candle = calcCandlePenalty(
    input.todayOpen,
    input.todayClose,
    input.upperShadow,
    input.bodySize,
    input.priceChangePct,
  );

  const chase = calcChasePenalty(
    input.signalPriceGapPct,
    input.tradingValue,
    input.priceChangePct,
    input.isConsecutive2dLargeBullish,
  );

  // 감점 절대값 합산 후 clamp(0, 100)
  const raw = Math.max(0, Math.min(100, overheat + candle + chase));

  return { raw, normalized: raw };
}
