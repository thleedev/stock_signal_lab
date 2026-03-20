export interface ValuationScoreResult {
  score: number; // 0~20
  per: number | null;
  pbr: number | null;
  roe: number | null;
}

export function calcValuationScore(
  per: number | null,
  pbr: number | null,
  roe: number | null
): ValuationScoreResult {
  let score = 0;

  // PBR 단계적 점수 (0~7)
  if (pbr !== null && pbr > 0) {
    if (pbr < 0.5) score += 7;       // 심각한 저평가
    else if (pbr < 0.8) score += 5;  // 저평가
    else if (pbr < 1.0) score += 3;  // 약간 저평가
  }

  // PER 단계적 점수 (0~7)
  if (per !== null && per > 0) {
    if (per < 5) score += 7;         // 극저평가
    else if (per < 8) score += 5;    // 저평가
    else if (per < 12) score += 3;   // 합리적
    else if (per < 15) score += 1;   // 보통
  }

  // ROE 단계적 점수 (0~6)
  if (roe !== null) {
    if (roe > 20) score += 6;        // 우수 수익성
    else if (roe > 15) score += 5;   // 양호
    else if (roe > 10) score += 3;   // 보통
    else if (roe > 5) score += 1;    // 최소
  }

  return { score: Math.min(score, 20), per, pbr, roe };
}
