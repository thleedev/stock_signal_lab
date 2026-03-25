/**
 * 초단기 밸류에이션 스코어
 *
 * 원점수 범위: 0 ~ 75 -> 정규화: raw / 75 * 100
 *
 * 구성 요소:
 *   A. Forward PER (최대 30점) 또는 PBR 폴백 (최대 30점)
 *   B. 목표주가 괴리율 (최대 25점) - Forward 데이터 있을 때만
 *   C. ROE (최대 20점) - 공통
 */

// ---------------------------------------------------------------------------
// 인터페이스 정의
// ---------------------------------------------------------------------------

export interface ShortTermValuationInput {
  /** Forward PER, null이면 미제공 */
  forwardPer: number | null;
  /** 목표주가 괴리율 (%), null이면 미제공 */
  targetPriceUpside: number | null;
  /** Trailing PER, null이면 미제공 */
  per: number | null;
  /** PBR, null이면 미제공 */
  pbr: number | null;
  /** ROE (%), null이면 미제공 */
  roe: number | null;
}

export interface ShortTermValuationResult {
  /** 원점수 (0 ~ 75) */
  raw: number;
  /** 정규화 점수 (0 ~ 100) */
  normalized: number;
}

// ---------------------------------------------------------------------------
// A. Forward PER 점수 (최대 30점)
// ---------------------------------------------------------------------------

/**
 * Forward PER 기반 점수를 계산한다.
 *
 * - < 8: +30
 * - [8, 12): +20
 * - [12, 20): +10
 * - >= 20 또는 null/적자: 0
 */
function calcForwardPerScore(forwardPer: number | null): number {
  if (forwardPer === null || forwardPer <= 0) return 0;
  if (forwardPer < 8) return 30;
  if (forwardPer < 12) return 20;
  if (forwardPer < 20) return 10;
  return 0;
}

// ---------------------------------------------------------------------------
// B. 목표주가 괴리율 점수 (최대 25점)
// ---------------------------------------------------------------------------

/**
 * 목표주가 괴리율 기반 점수를 계산한다.
 *
 * - >= 30%: +25
 * - [15%, 30%): +15
 * - [5%, 15%): +5
 * - < 5% 또는 null: 0
 */
function calcTargetPriceUpsideScore(targetPriceUpside: number | null): number {
  if (targetPriceUpside === null) return 0;
  if (targetPriceUpside >= 30) return 25;
  if (targetPriceUpside >= 15) return 15;
  if (targetPriceUpside >= 5) return 5;
  return 0;
}

// ---------------------------------------------------------------------------
// C. PBR 폴백 점수 (최대 30점) - Forward 데이터 없을 때
// ---------------------------------------------------------------------------

/**
 * PBR 기반 폴백 점수를 계산한다.
 *
 * - < 0.5: +30
 * - [0.5, 1.0): +15
 * - [1.0, 1.5): +5
 * - >= 1.5 또는 null: 0
 */
function calcPbrFallbackScore(pbr: number | null): number {
  if (pbr === null || pbr < 0) return 0;
  if (pbr < 0.5) return 30;
  if (pbr < 1.0) return 15;
  if (pbr < 1.5) return 5;
  return 0;
}

// ---------------------------------------------------------------------------
// D. ROE 점수 (최대 20점) - 공통
// ---------------------------------------------------------------------------

/**
 * ROE 기반 점수를 계산한다.
 *
 * - > 15%: +20
 * - (10%, 15%]: +10
 * - (5%, 10%]: +5
 * - <= 5% 또는 null: 0
 */
function calcRoeScore(roe: number | null): number {
  if (roe === null) return 0;
  if (roe > 15) return 20;
  if (roe > 10) return 10;
  if (roe > 5) return 5;
  return 0;
}

// ---------------------------------------------------------------------------
// 메인 함수
// ---------------------------------------------------------------------------

/**
 * 초단기 밸류에이션 스코어를 계산한다.
 *
 * Forward 데이터(forwardPer)가 있으면 Forward PER + 목표주가 괴리율을 사용하고,
 * 없으면 PBR을 폴백으로 사용한다. ROE는 공통으로 적용된다.
 *
 * 원점수 범위: 0 ~ 75
 * 정규화: raw / 75 * 100 -> 0 ~ 100
 */
export function calcShortTermValuationScore(
  input: ShortTermValuationInput,
): ShortTermValuationResult {
  let score = 0;

  // Forward PER 존재 여부에 따라 분기
  const hasForwardData = input.forwardPer !== null && input.forwardPer > 0;

  if (hasForwardData) {
    // Forward 데이터가 있는 경우: Forward PER + 목표주가 괴리율
    score += calcForwardPerScore(input.forwardPer);
    score += calcTargetPriceUpsideScore(input.targetPriceUpside);
  } else {
    // Forward 없는 경우: PBR 폴백
    score += calcPbrFallbackScore(input.pbr);
  }

  // 공통: ROE
  score += calcRoeScore(input.roe);

  // 원점수 clamp (0 ~ 75)
  const raw = Math.max(0, Math.min(75, score));

  // 정규화: raw / 75 * 100
  const normalized = Math.max(0, Math.min(100, (raw / 75) * 100));

  return { raw, normalized };
}
