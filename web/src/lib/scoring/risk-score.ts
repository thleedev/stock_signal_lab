/**
 * 리스크 점수 계산 모듈
 *
 * 관리종목 여부, 감사의견, CB/BW 발행, 대주주 지분, 거래대금, 회전율 등
 * 다양한 리스크 요인에 따라 감점을 누적하여 리스크 점수를 산출한다.
 *
 * 페널티 → composite-score 변환:
 *   riskPenalty = Math.min(0.20, Math.abs(riskScore) / 100 * 0.20)
 *   → riskScore -100 = 20%, -75 = 15%, -50 = 10%
 *
 * 스펙 페널티 매핑:
 *   관리종목 20%          → -100 (early return)
 *   감사의견 비적정 15%   → -75 (early return)
 *   CB/BW 최근 발행 10%  → -50
 *   RSI 75+ & 5일+20% 10% → -50
 *
 * 모델 종류:
 *   - standard: 중장기 투자 기준 (기본값)
 *   - short_term: 단기 투자 기준 (일부 감점 완화)
 */

/** 리스크 점수 계산에 필요한 입력 데이터 */
interface RiskInput {
  /** 관리종목 여부 */
  is_managed?: boolean
  /** 감사의견 ('적정' 이외면 비적정으로 처리) */
  audit_opinion?: string | null
  /** CB/BW 최근 발행 여부 */
  has_recent_cbw?: boolean
  /** 최대주주 지분율 (%) */
  major_shareholder_pct?: number | null
  /** 최대주주 지분율 변화량 (음수면 감소) */
  major_shareholder_delta?: number | null
  /** 자사주 매입 여부 (긍정적 시그널) */
  has_treasury_buyback?: boolean
  /** 당일 거래대금 (원) */
  daily_trading_value?: number | null
  /** 20일 평균 거래대금 (원) */
  avg_trading_value_20d?: number | null
  /** 주식 회전율 (%) */
  turnover_rate?: number | null
  /** 시가총액 (억원) */
  market_cap?: number | null
  /** RSI 값 (기술전환 모듈에서 계산, 과매수 과열 체크용) */
  rsi?: number | null
  /** 5일 누적 등락률 (%) — 급등 과열 체크용 */
  five_day_change_pct?: number | null
}

/** 점수 계산 모델 타입 */
type Model = 'standard' | 'short_term'

/**
 * 주어진 입력 데이터와 모델을 기반으로 리스크 점수를 계산한다.
 *
 * @param input - 리스크 관련 입력 데이터
 * @param model - 점수 계산 모델 ('standard' | 'short_term'), 기본값: 'standard'
 * @returns 리스크 감점 합계 (0 이하의 정수)
 */
export function calcRiskScore(input: RiskInput, model: Model = 'standard'): number {
  // 관리종목: 즉시 최대 감점 반환 (20% 페널티)
  if (input.is_managed) return -100

  // 감사의견 비적정: 즉시 -75 반환 (15% 페널티)
  if (input.audit_opinion && input.audit_opinion !== '적정') return -75

  let score = 0

  // CB/BW 최근 발행: 10% 페널티 → -50
  if (input.has_recent_cbw) {
    score += model === 'standard' ? -50 : -30
  }

  // RSI 75+ + 5일 +20%+ 동시: 10% 페널티 → -50 (스펙 기준)
  if (
    input.rsi != null && input.rsi >= 75 &&
    input.five_day_change_pct != null && input.five_day_change_pct >= 20
  ) {
    score += -50
  }

  // 최대주주 지분율 — 시총에 따라 차등 적용
  // 1조 이상: 적용 안 함, 3000억~1조: <5% 감점, 3000억 미만: <10% 감점
  if (input.major_shareholder_pct != null) {
    const cap = input.market_cap ?? 0 // 억원 단위
    let threshold = 10
    if (cap >= 10_000) threshold = 0       // 1조원(=10,000억) 이상: 적용 안 함
    else if (cap >= 3_000) threshold = 5   // 3000억~1조원

    if (threshold > 0 && input.major_shareholder_pct < threshold) {
      score += model === 'standard' ? -20 : -15
    }
  }

  // 최대주주 지분율 감소: -10
  if (input.major_shareholder_delta != null && input.major_shareholder_delta < 0) {
    score += -10
  }

  // 당일 거래대금 10억 미만: standard -20, short_term -15
  if (input.daily_trading_value != null && input.daily_trading_value < 1_000_000_000) {
    score += model === 'standard' ? -20 : -15
  }

  // 20일 평균 거래대금 20억 미만: standard only -10
  if (model === 'standard' && input.avg_trading_value_20d != null && input.avg_trading_value_20d < 2_000_000_000) {
    score += -10
  }

  // 회전율 10% 초과: -10 (과도한 단기 매매 신호)
  if (input.turnover_rate != null && input.turnover_rate > 10) {
    score += -10
  }

  return score
}
