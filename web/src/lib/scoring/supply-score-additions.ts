/**
 * 수급 점수 추가 항목 모듈
 *
 * 거래대금 티어, 거래대금 급증 비율, 회전율, 자사주 매입,
 * 최대주주 지분 증가 등을 기반으로 수급 점수 보너스를 계산합니다.
 */

interface SupplyAdditionInput {
  /** 당일 거래대금 (원) */
  daily_trading_value?: number | null
  /** 20일 평균 거래대금 (원) */
  avg_trading_value_20d?: number | null
  /** 회전율 (%) */
  turnover_rate?: number | null
  /** 자사주 매입 여부 */
  has_treasury_buyback?: boolean
  /** 최대주주 지분 변동 (양수: 증가) */
  major_shareholder_delta?: number | null
}

/**
 * 수급 점수 추가 항목을 계산합니다.
 *
 * 점수 규칙:
 * - 거래대금 300억 이상: +15점
 * - 거래대금 100억~300억: +10점
 * - 거래대금 급증 2배 이상: +10점
 * - 거래대금 급증 1.5배 이상: +5점
 * - 회전율 1~5%: +5점
 * - 자사주 매입: +10점
 * - 최대주주 지분 증가: +5점
 *
 * @param input 수급 데이터 입력값
 * @returns 합산된 추가 점수
 */
export function calcSupplyAdditions(input: SupplyAdditionInput): number {
  let score = 0

  const tv = input.daily_trading_value ?? 0
  const avgTv = input.avg_trading_value_20d ?? 0

  // 거래대금 티어 점수
  if (tv >= 30_000_000_000) score += 15
  else if (tv >= 10_000_000_000) score += 10

  // 거래대금 급증 비율 점수
  if (avgTv > 0) {
    const ratio = tv / avgTv
    if (ratio >= 2) score += 10
    else if (ratio >= 1.5) score += 5
  }

  // 회전율 점수 (1~5% 구간)
  const tr = input.turnover_rate ?? 0
  if (tr >= 1 && tr <= 5) score += 5

  // 자사주 매입 점수
  if (input.has_treasury_buyback) score += 10

  // 최대주주 지분 증가 점수
  if (input.major_shareholder_delta != null && input.major_shareholder_delta > 0) {
    score += 5
  }

  return score
}
