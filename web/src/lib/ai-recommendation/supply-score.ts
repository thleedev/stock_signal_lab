// N+1 방지: 오케스트레이터에서 사전 집계/조회 후 전달받는다. DB 쿼리 없음.

import { getMarketCapTier, type MarketCapTier } from './market-cap-tier';

export interface SupplyScoreResult {
  score: number;               // -10~45
  foreign_buying: boolean;     // 외국인 순매수 > 0
  institution_buying: boolean; // 기관 순매수 > 0
  volume_vs_sector: boolean;   // 섹터 거래대금 2배 이상
  low_short_sell: boolean;     // 공매도 비율 < 1%
}

/**
 * 시총 대비 순매수 비율 기반 점수 (대형주용)
 * 대형주는 절대 수량이 아닌 시총 대비 비율로 수급 강도를 판단한다.
 */
function calcRatioBasedScore(
  netAmount: number,
  marketCap: number,
  tier: MarketCapTier,
): number {
  if (marketCap <= 0) return 0;
  const ratio = netAmount / marketCap;

  if (tier === 'large') {
    // 대형주: 0.1%도 수천억 — 엄격한 기준
    if (ratio >= 0.003) return 15;   // 0.3%+ 시총 대비 (초대형 매집)
    if (ratio >= 0.001) return 10;   // 0.1%+
    if (ratio >= 0.0005) return 6;   // 0.05%+
    if (ratio > 0) return 3;
    return 0;
  }
  // 중형주: 대형주와 소형주 사이
  if (ratio >= 0.005) return 15;
  if (ratio >= 0.001) return 10;
  if (ratio >= 0.0005) return 6;
  if (ratio > 0) return 3;
  return 0;
}

/**
 * 연속매수 시총 대비 누적 비율 보너스 (대형주/중형주)
 */
function calcStreakRatioBonus(
  net5d: number | null,
  marketCap: number,
  currentPrice: number,
  tier: MarketCapTier,
): number {
  if (!net5d || !currentPrice || currentPrice <= 0 || marketCap <= 0) return 0;
  const amount5d = net5d * currentPrice;
  const ratio5d = amount5d / marketCap;

  if (tier === 'large') {
    if (ratio5d >= 0.003) return 10;  // 5일 누적 0.3%+ (국면 전환급)
    if (ratio5d >= 0.001) return 6;
    if (ratio5d >= 0.0005) return 3;
    return 0;
  }
  // 중형주
  if (ratio5d >= 0.005) return 10;
  if (ratio5d >= 0.002) return 6;
  if (ratio5d >= 0.001) return 3;
  return 0;
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
  marketCap: number | null,          // 시가총액 (억원)
): SupplyScoreResult {
  let score = 0;
  const tier = getMarketCapTier(marketCap);
  const price = currentPrice ?? 0;
  const mcap = marketCap ?? 0;

  const foreignBuying = foreignNet !== null && foreignNet > 0;
  const institutionBuying = institutionNet !== null && institutionNet > 0;

  // ── 당일 순매수 (티어별 차등) ──
  if (tier === 'small') {
    // 소형주: 기존 절대값 기준 유지
    if (foreignBuying) score += 9;
    if (institutionBuying) score += 9;
  } else {
    // 대형주/중형주: 시총 대비 비율 기반
    const foreignAmount = (foreignNet ?? 0) * price;
    const instAmount = (institutionNet ?? 0) * price;
    score += calcRatioBasedScore(foreignAmount, mcap, tier);
    score += calcRatioBasedScore(instAmount, mcap, tier);
  }

  // ── 5일 누적 순매수 (티어별 차등) ──
  if (tier === 'small') {
    if (foreignNet5d !== null && foreignNet5d > 0) score += 5;
    if (institutionNet5d !== null && institutionNet5d > 0) score += 5;
  } else {
    // 대형주/중형주: 5일 누적도 비율 기반
    score += calcStreakRatioBonus(foreignNet5d, mcap, price, tier);
    score += calcStreakRatioBonus(institutionNet5d, mcap, price, tier);
  }

  // ── 연속 매수/매도 (매집 의지 or 이탈 경고) — 전 티어 공통 ──
  // 매수 전환 첫날에 보너스를 주되, 장기 streak과의 역전 폭은 억제
  const fStreak = foreignStreak ?? 0;
  if (fStreak === 1) score += 6;       // 매수 전환 첫날 (초기진입 보너스)
  else if (fStreak >= 5) score += 5;   // 장기 매집 (7→5)
  else if (fStreak >= 3) score += 4;
  else if (fStreak >= 2) score += 6;   // 2일차 = 확인 매수 (첫날과 동급)
  else if (fStreak <= -3) score -= 5;  // 외국인 3일+ 연속 매도

  const iStreak = institutionStreak ?? 0;
  if (iStreak === 1) score += 6;       // 매수 전환 첫날
  else if (iStreak >= 5) score += 5;
  else if (iStreak >= 3) score += 4;
  else if (iStreak >= 2) score += 6;   // 확인 매수
  else if (iStreak <= -3) score -= 5;  // 기관 3일+ 연속 매도

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
  if (foreignBuying && institutionBuying) score += 3;
  if (foreignNet5d !== null && foreignNet5d > 0 &&
      institutionNet5d !== null && institutionNet5d > 0) score += 2;

  // ── 공매도 비율 낮음 ──
  const lowShortSell = shortSellRatio !== null && shortSellRatio >= 0 && shortSellRatio < 1;
  if (lowShortSell) score += 2;

  return {
    score: Math.max(-10, Math.min(score, 45)),
    foreign_buying: foreignBuying,
    institution_buying: institutionBuying,
    volume_vs_sector: volumeVsSector,
    low_short_sell: lowShortSell,
  };
}
