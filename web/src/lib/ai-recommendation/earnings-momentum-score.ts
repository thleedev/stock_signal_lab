/**
 * 이익모멘텀 점수 모듈
 *
 * 대형주 주가의 가장 강력한 드라이버인 컨센서스 EPS 변화를 측정한다.
 * Forward PER과 Trailing PER 차이에서 암묵적 EPS 성장률을 추정하고,
 * 목표주가 상승여력과 투자의견을 결합한다.
 *
 * 원점수 범위: 0~100
 */

import { type ScoreReason, type NormalizedScoreBase } from '@/types/score-reason';

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

export interface EarningsMomentumResult extends NormalizedScoreBase {
  score: number;  // 0~100
  implied_eps_growth: number | null;  // Forward PER 기반 암묵적 EPS 성장률
  target_upside: number | null;       // 목표주가 상승여력 (%)
}

function fmt(n: number): string {
  return Math.round(n).toLocaleString('ko-KR');
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
  const reasons: ScoreReason[] = [];
  const impliedEpsGrowth = calcImpliedEpsGrowth(input.forwardPer, input.trailingPer);

  // ── 암묵적 EPS 성장률 (0~30) ──
  // Forward PER < Trailing PER → EPS 성장 예상
  let epsPoints = 0;
  if (impliedEpsGrowth !== null) {
    if (impliedEpsGrowth >= 30) epsPoints = 30;
    else if (impliedEpsGrowth >= 20) epsPoints = 25;
    else if (impliedEpsGrowth >= 10) epsPoints = 18;
    else if (impliedEpsGrowth >= 5) epsPoints = 10;
    else if (impliedEpsGrowth >= 0) epsPoints = 5;
    // 역성장(forward > trailing) → 0점
    score += epsPoints;
  }
  reasons.push({
    label: 'EPS 성장률',
    points: epsPoints,
    detail: impliedEpsGrowth !== null
      ? `암묵적 EPS 성장률 ${Math.round(impliedEpsGrowth * 10) / 10}% (Forward PER ${Math.round((input.forwardPer ?? 0) * 10) / 10} vs Trailing PER ${Math.round((input.trailingPer ?? 0) * 10) / 10})`
      : 'EPS 성장률 계산 불가 (데이터 없음)',
    met: impliedEpsGrowth !== null && impliedEpsGrowth > 0,
  });

  // ── 목표주가 상승여력 (0~25) ──
  let targetUpside: number | null = null;
  let upsidePoints = 0;
  if (input.targetPrice && input.currentPrice && input.currentPrice > 0) {
    targetUpside = ((input.targetPrice - input.currentPrice) / input.currentPrice) * 100;
    if (targetUpside >= 50) upsidePoints = 25;
    else if (targetUpside >= 30) upsidePoints = 20;
    else if (targetUpside >= 15) upsidePoints = 12;
    else if (targetUpside >= 5) upsidePoints = 5;
    score += upsidePoints;
  }
  reasons.push({
    label: '목표주가 상승여력',
    points: upsidePoints,
    detail: targetUpside !== null
      ? `목표 ${fmt(input.targetPrice!)} vs 현재 ${fmt(input.currentPrice!)} (상승여력 ${Math.round(targetUpside * 10) / 10}%)`
      : '목표주가 데이터 없음',
    met: targetUpside !== null && targetUpside >= 5,
  });

  // ── 투자의견 (0~15) ──
  let opinionPoints = 0;
  if (input.investOpinion !== null && input.investOpinion > 0) {
    if (input.investOpinion >= 4.5) opinionPoints = 15;
    else if (input.investOpinion >= 3.5) opinionPoints = 10;
    else if (input.investOpinion >= 2.5) opinionPoints = 3;
    score += opinionPoints;
  }
  reasons.push({
    label: '투자의견',
    points: opinionPoints,
    detail: input.investOpinion !== null
      ? `애널리스트 합의 ${Math.round(input.investOpinion * 10) / 10}/5`
      : '투자의견 데이터 없음',
    met: input.investOpinion !== null && input.investOpinion >= 2.5,
  });

  // ── ROE 수준 (0~15) ──
  let roePoints = 0;
  if (input.roe !== null) {
    if (input.roe >= 20) roePoints = 15;
    else if (input.roe >= 15) roePoints = 12;
    else if (input.roe >= 10) roePoints = 7;
    else if (input.roe >= 5) roePoints = 3;
    score += roePoints;
  }
  reasons.push({
    label: 'ROE 수준',
    points: roePoints,
    detail: input.roe !== null ? `ROE ${Math.round(input.roe * 10) / 10}%` : 'ROE 데이터 없음',
    met: input.roe !== null && input.roe >= 5,
  });

  // ── 실적 성장률 (0~15) ──
  // 영업이익 성장률 우선, 없으면 매출 성장률
  const profitGrowth = input.operatingProfitGrowthYoy;
  const revenueGrowth = input.revenueGrowthYoy;
  const growthRef = profitGrowth ?? revenueGrowth;
  let growthPoints = 0;

  if (growthRef !== null) {
    if (growthRef >= 30) growthPoints = 15;
    else if (growthRef >= 15) growthPoints = 10;
    else if (growthRef >= 5) growthPoints = 5;
    else if (growthRef < -10) growthPoints = -5;  // 실적 역성장 감점
    score += growthPoints;
  }

  const isProfit = profitGrowth !== null;
  reasons.push({
    label: '실적 성장',
    points: growthPoints,
    detail: growthRef !== null
      ? isProfit
        ? `영업이익 YoY +${Math.round(growthRef * 10) / 10}%`
        : `매출 YoY +${Math.round(growthRef * 10) / 10}%`
      : '실적 성장 데이터 없음',
    met: growthRef !== null && growthRef >= 5,
  });

  const rawScore = Math.max(0, Math.min(score, 100));
  // 이익모멘텀 스코어는 이미 0~100 범위이므로 normalizedScore = rawScore
  const normalizedScore = rawScore;

  return {
    score: rawScore,
    implied_eps_growth: impliedEpsGrowth,
    target_upside: targetUpside,
    rawScore,
    normalizedScore,
    reasons,
  };
}
