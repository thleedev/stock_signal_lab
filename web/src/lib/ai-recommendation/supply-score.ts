// 주의: 섹터별 평균 거래대금은 오케스트레이터에서 사전 집계 후 sectorAvgTurnover로 전달받는다.
// 이 함수는 DB 쿼리를 직접 실행하지 않는다 (N+1 방지).

export interface SupplyScoreResult {
  score: number;
  foreign_buying: boolean; // KIS 미구현 → 항상 false
  institution_buying: boolean; // KIS 미구현 → 항상 false
  volume_vs_sector: boolean;
}

export function calcSupplyScore(
  currentVolume: number | null,
  currentPrice: number | null,
  sectorAvgTurnover: number | null // 오케스트레이터에서 사전 계산
): SupplyScoreResult {
  let score = 0;
  let volumeVsSector = false;

  if (
    currentVolume &&
    currentPrice &&
    sectorAvgTurnover &&
    currentVolume > 0 &&
    currentPrice > 0 &&
    sectorAvgTurnover > 0
  ) {
    const myTurnover = currentVolume * currentPrice;
    if (myTurnover >= sectorAvgTurnover * 2) {
      volumeVsSector = true;
      score += 6;
    }
  }

  return {
    score,
    foreign_buying: false,
    institution_buying: false,
    volume_vs_sector: volumeVsSector,
  };
}
