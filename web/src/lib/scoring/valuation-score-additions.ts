/**
 * 밸류에이션 점수 추가 항목 모듈
 *
 * 매출 성장률(YoY)과 영업이익 성장률(YoY)을 기반으로
 * 추가 점수를 계산합니다.
 *
 * 임계값 기준:
 *   - 20% 이상  : +10점
 *   - 5% 이상   : +5점
 *   - 0% 이상   : 0점
 *   - 0% 미만   : -5점
 *   - null/undefined: 0점
 */

interface ValuationAdditionInput {
  /** 전년 대비 매출 성장률 (%) */
  revenue_growth_yoy?: number | null
  /** 전년 대비 영업이익 성장률 (%) */
  operating_profit_growth_yoy?: number | null
}

/**
 * 성장률 퍼센트를 점수로 변환합니다.
 * @param pct - 성장률 (%)
 * @returns 점수 (+10 / +5 / 0 / -5)
 */
function growthScore(pct: number | null | undefined): number {
  if (pct == null) return 0
  if (pct >= 20) return 10
  if (pct >= 5) return 5
  if (pct >= 0) return 0
  return -5
}

/**
 * 밸류에이션 추가 점수를 계산합니다.
 *
 * 매출 성장률과 영업이익 성장률 각각의 점수를 합산하여 반환합니다.
 *
 * @param input - 매출 및 영업이익 성장률 입력값
 * @returns 합산 추가 점수
 */
export function calcValuationAdditions(input: ValuationAdditionInput): number {
  return (
    growthScore(input.revenue_growth_yoy) +
    growthScore(input.operating_profit_growth_yoy)
  )
}
