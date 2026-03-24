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

export function calcValuationScore(
  per: number | null,
  pbr: number | null,
  roe: number | null,
  dividendYield: number | null = null,
  forward: ForwardData | null = null,
): ValuationScoreResult {
  let score = 0;

  // ── Forward 데이터가 있으면 forward 기준 채점 ──
  if (forward && (forward.forwardPer || forward.targetPrice || forward.investOpinion)) {
    // Forward PER (0~8) — trailing PER 대신 사용
    if (forward.forwardPer !== null && forward.forwardPer > 0) {
      if (forward.forwardPer < 5) score += 8;
      else if (forward.forwardPer < 8) score += 6;
      else if (forward.forwardPer < 12) score += 4;
      else if (forward.forwardPer < 15) score += 2;
      else if (forward.forwardPer < 20) score += 1;
    } else if (per !== null && per > 0) {
      // forward PER 없으면 trailing PER 폴백
      if (per < 5) score += 7;
      else if (per < 8) score += 5;
      else if (per < 12) score += 3;
      else if (per < 15) score += 1;
    }

    // 목표주가 상승여력 (0~8) — 핵심 forward 지표
    if (forward.targetPrice && forward.currentPrice && forward.currentPrice > 0) {
      const upside = ((forward.targetPrice - forward.currentPrice) / forward.currentPrice) * 100;
      if (upside >= 50) score += 8;       // 50%+ 상승여력: 극저평가
      else if (upside >= 30) score += 6;  // 30~50%: 강한 저평가
      else if (upside >= 15) score += 4;  // 15~30%: 저평가
      else if (upside >= 5) score += 2;   // 5~15%: 약간 저평가
      // 5% 미만이나 마이너스: 0점
    }

    // 투자의견 (0~4) — 애널리스트 합의
    if (forward.investOpinion !== null && forward.investOpinion > 0) {
      if (forward.investOpinion >= 4.5) score += 4;       // 강력매수 합의
      else if (forward.investOpinion >= 3.5) score += 3;  // 매수
      else if (forward.investOpinion >= 2.5) score += 1;  // 중립
      // 2.5 미만: 매도 의견 → 0점
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
