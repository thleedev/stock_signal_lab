/**
 * 초단기 수급 스코어
 *
 * 원점수 범위: -25 ~ 55 -> 정규화: (raw + 25) / 80 * 100
 *
 * 구성 요소:
 *   A. 당일 주체별 매수 (최대 30점, v1: 최대 22점)
 *   B. 2일 연속성 (최대 15점, v1: 최대 10점)
 *   C. 수급 경고 (최대 -25점)
 *
 * v1에서 프로그램 매매(programNet/programStreak)는 null -> 0점 처리.
 */

// ---------------------------------------------------------------------------
// 인터페이스 정의
// ---------------------------------------------------------------------------

export interface ShortTermSupplyInput {
  /** 외국인 당일 순매수 금액 */
  foreignNet: number | null;
  /** 기관 당일 순매수 금액 */
  institutionNet: number | null;
  /** 프로그램 순매수 금액 (v1: always null) */
  programNet: number | null;
  /** 외국인 연속 매수 일수 (양수=연속 매수, 음수=연속 매도) */
  foreignStreak: number | null;
  /** 기관 연속 매수 일수 */
  institutionStreak: number | null;
  /** 프로그램 연속 매수 일수 (v1: always null) */
  programStreak: number | null;
}

export interface ShortTermSupplyResult {
  /** 원점수 (-25 ~ 55) */
  raw: number;
  /** 정규화 점수 (0 ~ 100) */
  normalized: number;
  /** 외국인 당일 순매수 여부 */
  foreignBuying: boolean;
  /** 기관 당일 순매수 여부 */
  institutionBuying: boolean;
}

// ---------------------------------------------------------------------------
// 헬퍼: null -> 0 변환
// ---------------------------------------------------------------------------

/** null 값을 0으로 변환한다. */
function n(value: number | null): number {
  return value ?? 0;
}

// ---------------------------------------------------------------------------
// A. 당일 주체별 매수 (최대 30점, v1: 최대 22점)
// ---------------------------------------------------------------------------

/**
 * 당일 주체별 순매수 점수를 계산한다.
 *
 * - 외국인 순매수 (> 0): +10
 * - 기관 순매수 (> 0): +10
 * - 프로그램 순매수 (> 0): +8 (v1: null -> 0점)
 * - 외국인+기관 동반 순매수: +12 보너스
 */
function calcDailyBuyingScore(
  foreignNet: number,
  institutionNet: number,
  programNet: number,
): number {
  let score = 0;

  const foreignBuying = foreignNet > 0;
  const institutionBuying = institutionNet > 0;

  if (foreignBuying) score += 10;
  if (institutionBuying) score += 10;
  if (programNet > 0) score += 8;
  if (foreignBuying && institutionBuying) score += 12;

  return score;
}

// ---------------------------------------------------------------------------
// B. 2일 연속성 (최대 15점, v1: 최대 10점)
// ---------------------------------------------------------------------------

/**
 * 연속 순매수 점수를 계산한다.
 *
 * v2 (short_term 전환 포착 우선): 전환 첫날 최고, 지속은 감소
 * - 외국인/기관 매수 전환 첫날 (streak === 1): +10
 * - 2일 연속: +7
 * - 3~4일: +4
 * - 5일+: +3
 * - 프로그램 2일 연속 (streak >= 2): +5 (v1: null -> 0점)
 */
function calcStreakBonusScore(
  foreignStreak: number,
  institutionStreak: number,
  programStreak: number,
): number {
  let score = 0;

  // 전환 포착 우선: 첫날 최고, 지속은 점차 감소
  if (foreignStreak === 1) score += 10;
  else if (foreignStreak === 2) score += 7;
  else if (foreignStreak >= 3 && foreignStreak <= 4) score += 4;
  else if (foreignStreak >= 5) score += 3;

  if (institutionStreak === 1) score += 10;
  else if (institutionStreak === 2) score += 7;
  else if (institutionStreak >= 3 && institutionStreak <= 4) score += 4;
  else if (institutionStreak >= 5) score += 3;

  if (programStreak >= 2) score += 5;

  return score;
}

// ---------------------------------------------------------------------------
// C. 수급 경고 (최대 -25점)
// ---------------------------------------------------------------------------

/**
 * 수급 경고 감점을 계산한다.
 *
 * - 외국인/기관 둘 다 순매도 (both <= 0): -15
 * - 3일 이상 연속 매도 (streak <= -3): -10 (각각)
 */
function calcWarningPenalty(
  foreignNet: number,
  institutionNet: number,
  foreignStreak: number,
  institutionStreak: number,
): number {
  let penalty = 0;

  // 외국인/기관 동반 매도
  if (foreignNet <= 0 && institutionNet <= 0) {
    penalty -= 15;
  }

  // 3일 이상 연속 매도
  if (foreignStreak <= -3) penalty -= 10;
  if (institutionStreak <= -3) penalty -= 10;

  return penalty;
}

// ---------------------------------------------------------------------------
// 메인 함수
// ---------------------------------------------------------------------------

/**
 * 초단기 수급 스코어를 계산한다.
 *
 * 원점수 범위: -25 ~ 55
 * 정규화: (raw + 25) / 80 * 100 -> 0 ~ 100
 */
export function calcShortTermSupplyScore(input: ShortTermSupplyInput): ShortTermSupplyResult {
  // 수급 데이터 자체가 없으면 중립 처리 (null → 0 변환 후 "동반 매도" 패널티 방지)
  const supplyDataAvailable = input.foreignNet !== null || input.institutionNet !== null;
  if (!supplyDataAvailable) {
    const neutralRaw = 0; // -25 ~ 55 범위에서 중립 위치
    return {
      raw: neutralRaw,
      normalized: Math.round(((neutralRaw + 25) / 80) * 100), // 31
      foreignBuying: false,
      institutionBuying: false,
    };
  }

  const foreignNet = n(input.foreignNet);
  const institutionNet = n(input.institutionNet);
  const programNet = n(input.programNet);
  const foreignStreak = n(input.foreignStreak);
  const institutionStreak = n(input.institutionStreak);
  const programStreak = n(input.programStreak);

  const a = calcDailyBuyingScore(foreignNet, institutionNet, programNet);
  const b = calcStreakBonusScore(foreignStreak, institutionStreak, programStreak);
  const c = calcWarningPenalty(foreignNet, institutionNet, foreignStreak, institutionStreak);

  // 원점수 합산 후 범위 clamp
  const rawUnclamped = a + b + c;
  const raw = Math.max(-25, Math.min(55, rawUnclamped));

  // 정규화: (raw + 25) / 80 * 100
  const normalized = Math.max(0, Math.min(100, ((raw + 25) / 80) * 100));

  return {
    raw,
    normalized,
    foreignBuying: foreignNet > 0,
    institutionBuying: institutionNet > 0,
  };
}
