// N+1 방지: 오케스트레이터에서 사전 집계/조회 후 전달받는다. DB 쿼리 없음.

export interface SupplyScoreResult {
  score: number;               // 0~45
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
  foreignNet5d: number | null,       // 외국인 5일 누적 순매수
  institutionNet5d: number | null,   // 기관 5일 누적 순매수
  foreignStreak: number | null,      // 외국인 연속 매수일수
  institutionStreak: number | null,  // 기관 연속 매수일수
  marketCap: number | null,          // 시가총액
): SupplyScoreResult {
  let score = 0;

  // ── 당일 순매수 (기본 시그널) ──
  const foreignBuying = foreignNet !== null && foreignNet > 0;
  if (foreignBuying) score += 9;

  const institutionBuying = institutionNet !== null && institutionNet > 0;
  if (institutionBuying) score += 9;

  // ── 5일 누적 순매수 (추세 확인) ──
  if (foreignNet5d !== null && foreignNet5d > 0) score += 5;
  if (institutionNet5d !== null && institutionNet5d > 0) score += 5;

  // ── 연속 매수 (매집 의지) ──
  const fStreak = foreignStreak ?? 0;
  if (fStreak >= 5) score += 7;
  else if (fStreak >= 3) score += 5;
  else if (fStreak >= 2) score += 3;

  const iStreak = institutionStreak ?? 0;
  if (iStreak >= 5) score += 7;
  else if (iStreak >= 3) score += 5;
  else if (iStreak >= 2) score += 3;

  // ── 섹터 거래대금 급증(2배) ──
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

  // ── 동반매수 시너지 (스마트머니 합류) ──
  // 당일 동반매수
  if (foreignBuying && institutionBuying) score += 3;
  // 5일 동반 순매수 (추세적 합류)
  if (foreignNet5d !== null && foreignNet5d > 0 &&
      institutionNet5d !== null && institutionNet5d > 0) score += 2;

  // ── 시총 대비 순매수 비율 (유의미한 규모인지) ──
  if (marketCap && marketCap > 0 && currentPrice && currentPrice > 0) {
    const totalNetAmount = ((foreignNet ?? 0) + (institutionNet ?? 0)) * currentPrice;
    const ratio = totalNetAmount / marketCap;
    if (ratio > 0.001) score += 3;        // 시총 대비 0.1% 이상 순매수
    else if (ratio > 0.0005) score += 1;  // 0.05% 이상
  }

  // ── 공매도 비율 낮음 ──
  const lowShortSell = shortSellRatio !== null && shortSellRatio >= 0 && shortSellRatio < 1;
  if (lowShortSell) score += 2;

  return {
    score: Math.min(score, 45),
    foreign_buying: foreignBuying,
    institution_buying: institutionBuying,
    volume_vs_sector: volumeVsSector,
    low_short_sell: lowShortSell,
  };
}
