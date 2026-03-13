// N+1 방지: 오케스트레이터에서 사전 집계/조회 후 전달받는다. DB 쿼리 없음.

export interface SupplyScoreResult {
  score: number;               // 0~20
  foreign_buying: boolean;     // 외국인 순매수 > 0
  institution_buying: boolean; // 기관 순매수 > 0
  volume_vs_sector: boolean;   // 섹터 거래대금 2배 이상
  low_short_sell: boolean;     // 공매도 비율 < 1%
}

export function calcSupplyScore(
  currentVolume: number | null,
  currentPrice: number | null,
  sectorAvgTurnover: number | null,  // 오케스트레이터 사전 집계
  foreignNet: number | null,         // 외국인 순매수 수량 (Naver investor)
  institutionNet: number | null,     // 기관 순매수 수량 (Naver investor)
  shortSellRatio: number | null,     // 공매도 비율 % (KRX → stock_cache, 당일 데이터만)
): SupplyScoreResult {
  let score = 0;

  // 외국인 순매수 +7
  const foreignBuying = foreignNet !== null && foreignNet > 0;
  if (foreignBuying) score += 7;

  // 기관 순매수 +7
  const institutionBuying = institutionNet !== null && institutionNet > 0;
  if (institutionBuying) score += 7;

  // 섹터 거래대금 급증(2배) +4
  let volumeVsSector = false;
  if (
    currentVolume && currentPrice && sectorAvgTurnover &&
    currentVolume > 0 && currentPrice > 0 && sectorAvgTurnover > 0
  ) {
    const myTurnover = currentVolume * currentPrice;
    if (myTurnover >= sectorAvgTurnover * 2) {
      volumeVsSector = true;
      score += 4;
    }
  }

  // 공매도 비율 낮음 (< 1%) +2
  const lowShortSell = shortSellRatio !== null && shortSellRatio >= 0 && shortSellRatio < 1;
  if (lowShortSell) score += 2;

  return {
    score: Math.min(score, 20),
    foreign_buying: foreignBuying,
    institution_buying: institutionBuying,
    volume_vs_sector: volumeVsSector,
    low_short_sell: lowShortSell,
  };
}
