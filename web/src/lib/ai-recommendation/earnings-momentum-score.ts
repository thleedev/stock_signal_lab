/**
 * 이익모멘텀 점수 모듈
 *
 * 대형주 주가의 가장 강력한 드라이버인 컨센서스 EPS 변화를 측정한다.
 * Forward PER과 Trailing PER 차이에서 암묵적 EPS 성장률을 추정하고,
 * 목표주가 상승여력과 투자의견을 결합한다.
 *
 * 원점수 범위: 0~100
 */

export interface EarningsMomentumInput {
  forwardPer: number | null;
  trailingPer: number | null;
  targetPrice: number | null;
  currentPrice: number | null;
  investOpinion: number | null;     // 1~5, 5=강력매수
  roe: number | null;
  revenueGrowthYoy: number | null;
  operatingProfitGrowthYoy: number | null;
}

export interface EarningsMomentumResult {
  score: number;  // 0~100
  implied_eps_growth: number | null;  // Forward PER 기반 암묵적 EPS 성장률
  target_upside: number | null;       // 목표주가 상승여력 (%)
}

/**
 * Forward PER과 Trailing PER의 차이에서 암묵적 EPS 성장률을 추정
 * EPS 성장률 ≈ (Trailing PER / Forward PER - 1) * 100
 */
function calcImpliedEpsGrowth(forwardPer: number | null, trailingPer: number | null): number | null {
  if (!forwardPer || !trailingPer || forwardPer <= 0 || trailingPer <= 0) return null;
  return ((trailingPer / forwardPer) - 1) * 100;
}

export function calcEarningsMomentumScore(input: EarningsMomentumInput): EarningsMomentumResult {
  let score = 0;
  const impliedEpsGrowth = calcImpliedEpsGrowth(input.forwardPer, input.trailingPer);

  // ── 암묵적 EPS 성장률 (0~30) ──
  // Forward PER < Trailing PER → EPS 성장 예상
  if (impliedEpsGrowth !== null) {
    if (impliedEpsGrowth >= 30) score += 30;       // EPS 30%+ 성장 예상
    else if (impliedEpsGrowth >= 20) score += 25;
    else if (impliedEpsGrowth >= 10) score += 18;
    else if (impliedEpsGrowth >= 5) score += 10;
    else if (impliedEpsGrowth >= 0) score += 5;
    // 역성장(forward > trailing) → 0점
  }

  // ── 목표주가 상승여력 (0~25) ──
  let targetUpside: number | null = null;
  if (input.targetPrice && input.currentPrice && input.currentPrice > 0) {
    targetUpside = ((input.targetPrice - input.currentPrice) / input.currentPrice) * 100;
    if (targetUpside >= 50) score += 25;
    else if (targetUpside >= 30) score += 20;
    else if (targetUpside >= 15) score += 12;
    else if (targetUpside >= 5) score += 5;
  }

  // ── 투자의견 (0~15) ──
  if (input.investOpinion !== null && input.investOpinion > 0) {
    if (input.investOpinion >= 4.5) score += 15;       // 강력매수 합의
    else if (input.investOpinion >= 3.5) score += 10;  // 매수
    else if (input.investOpinion >= 2.5) score += 3;   // 중립
  }

  // ── ROE 수준 (0~15) ──
  if (input.roe !== null) {
    if (input.roe >= 20) score += 15;
    else if (input.roe >= 15) score += 12;
    else if (input.roe >= 10) score += 7;
    else if (input.roe >= 5) score += 3;
  }

  // ── 실적 성장률 (0~15) ──
  // 영업이익 성장률 우선, 없으면 매출 성장률
  const profitGrowth = input.operatingProfitGrowthYoy;
  const revenueGrowth = input.revenueGrowthYoy;
  const growthRef = profitGrowth ?? revenueGrowth;

  if (growthRef !== null) {
    if (growthRef >= 30) score += 15;
    else if (growthRef >= 15) score += 10;
    else if (growthRef >= 5) score += 5;
    else if (growthRef < -10) score -= 5;  // 실적 역성장 감점
  }

  return {
    score: Math.max(0, Math.min(score, 100)),
    implied_eps_growth: impliedEpsGrowth,
    target_upside: targetUpside,
  };
}
