import { type MarketCapTier } from './market-cap-tier';

export interface ValuationScoreResult {
  score: number; // 0~25
  per: number | null;
  pbr: number | null;
  roe: number | null;
}

export interface ForwardData {
  forwardPer: number | null;    // 추정 PER
  targetPrice: number | null;   // 목표주가
  investOpinion: number | null; // 투자의견 (1~5, 5=강력매수)
  currentPrice: number | null;  // 현재가 (상승여력 계산용)
}

/**
 * PEG 기반 점수 (대형주/중형주용)
 * PEG = PER / EPS성장률
 * EPS 성장률은 Forward PER과 Trailing PER의 차이에서 추정
 */
function calcPegScore(
  forwardPer: number | null,
  trailingPer: number | null,
): number {
  if (!forwardPer || !trailingPer || forwardPer <= 0 || trailingPer <= 0) return 0;

  // 암묵적 EPS 성장률: (Trailing / Forward - 1) * 100
  const epsGrowth = ((trailingPer / forwardPer) - 1) * 100;
  if (epsGrowth <= 0) return 0;  // 역성장이면 PEG 무의미

  const peg = forwardPer / epsGrowth;
  if (peg < 0.5) return 8;    // 성장 대비 극심한 저평가
  if (peg < 0.8) return 7;
  if (peg < 1.0) return 5;
  if (peg < 1.5) return 3;
  if (peg < 2.0) return 1;
  return 0;
}

export function calcValuationScore(
  per: number | null,
  pbr: number | null,
  roe: number | null,
  dividendYield: number | null = null,
  forward: ForwardData | null = null,
  marketCapTier: MarketCapTier = 'small',
): ValuationScoreResult {
  let score = 0;

  // ── Forward 데이터가 있으면 forward 기준 채점 ──
  if (forward && (forward.forwardPer || forward.targetPrice || forward.investOpinion)) {
    const usePeg = marketCapTier !== 'small' && forward.forwardPer && per && per > 0;

    if (usePeg) {
      // 대형주/중형주: PEG 기반 밸류에이션 (성장 대비 저평가 측정)
      score += calcPegScore(forward.forwardPer, per);
    } else {
      // 소형주 또는 PEG 계산 불가: Forward PER 절대값 기준
      if (forward.forwardPer !== null && forward.forwardPer > 0) {
        if (forward.forwardPer < 5) score += 8;
        else if (forward.forwardPer < 8) score += 6;
        else if (forward.forwardPer < 12) score += 4;
        else if (forward.forwardPer < 15) score += 2;
        else if (forward.forwardPer < 20) score += 1;
      } else if (per !== null && per > 0) {
        if (per < 5) score += 7;
        else if (per < 8) score += 5;
        else if (per < 12) score += 3;
        else if (per < 15) score += 1;
      }
    }

    // 목표주가 상승여력 (0~8) — 핵심 forward 지표
    if (forward.targetPrice && forward.currentPrice && forward.currentPrice > 0) {
      const upside = ((forward.targetPrice - forward.currentPrice) / forward.currentPrice) * 100;
      if (upside >= 50) score += 8;       // 50%+ 상승여력: 극저평가
      else if (upside >= 30) score += 6;  // 30~50%: 강한 저평가
      else if (upside >= 15) score += 4;  // 15~30%: 저평가
      else if (upside >= 5) score += 2;   // 5~15%: 약간 저평가
    }

    // 투자의견 (0~4) — 애널리스트 합의
    if (forward.investOpinion !== null && forward.investOpinion > 0) {
      if (forward.investOpinion >= 4.5) score += 4;
      else if (forward.investOpinion >= 3.5) score += 3;
      else if (forward.investOpinion >= 2.5) score += 1;
    }
  } else {
    // ── Forward 없으면 trailing 기준 (기존 로직) ──
    if (pbr !== null && pbr > 0) {
      if (pbr < 0.5) score += 7;
      else if (pbr < 0.8) score += 5;
      else if (pbr < 1.0) score += 3;
    }
    if (per !== null && per > 0) {
      if (per < 5) score += 7;
      else if (per < 8) score += 5;
      else if (per < 12) score += 3;
      else if (per < 15) score += 1;
    }
  }

  // ── 공통: ROE (0~6) — forward/trailing 무관하게 수익성 평가 ──
  if (roe !== null) {
    if (roe > 20) score += 6;
    else if (roe > 15) score += 5;
    else if (roe > 10) score += 3;
    else if (roe > 5) score += 1;
  }

  // ── 공통: 배당수익률 (0~5) ──
  if (dividendYield !== null && dividendYield > 0) {
    if (dividendYield >= 5) score += 5;
    else if (dividendYield >= 3) score += 3;
    else if (dividendYield >= 1.5) score += 1;
  }

  return { score: Math.min(score, 25), per, pbr, roe };
}
