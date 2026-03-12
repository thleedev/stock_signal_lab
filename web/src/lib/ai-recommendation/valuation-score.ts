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
  if (pbr !== null && pbr > 0 && pbr < 1.0) score += 7;
  if (per !== null && per > 0 && per < 10) score += 7;
  if (roe !== null && roe > 10) score += 6;
  return { score, per, pbr, roe };
}
