// N+1 방지: 오케스트레이터에서 사전 집계/조회 후 전달받는다. DB 쿼리 없음.

import { getMarketCapTier, type MarketCapTier } from './market-cap-tier';
import type { ScoreReason, NormalizedScoreBase } from '@/types/score-reason';

export interface SupplyScoreResult extends NormalizedScoreBase {
  score: number;               // -10~45
  foreign_buying: boolean;     // 외국인 순매수 > 0
  institution_buying: boolean; // 기관 순매수 > 0
  volume_vs_sector: boolean;   // 섹터 거래대금 2배 이상
  low_short_sell: boolean;     // 공매도 비율 < 1%
}

/** 숫자를 한국어 형식으로 포맷 */
function fmt(n: number): string {
  return Math.round(n).toLocaleString('ko-KR');
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

// 정규화 범위 상수 (-10 ~ 45, 전체 스팬 55)
const RAW_MIN = -10;
const RAW_SPAN = 55; // 45 - (-10)

/** rawPoints를 정규화 points로 변환 */
function toNormalizedPoints(rawPoints: number): number {
  return (rawPoints / RAW_SPAN) * 100;
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
  const reasons: ScoreReason[] = [];
  const tier = getMarketCapTier(marketCap);
  const price = currentPrice ?? 0;
  const mcap = marketCap ?? 0;

  const foreignBuying = foreignNet !== null && foreignNet > 0;
  const institutionBuying = institutionNet !== null && institutionNet > 0;

  // ── 당일 순매수 (티어별 차등) ──
  if (foreignNet === null) {
    reasons.push({
      label: '외국인 당일',
      points: 0,
      detail: '데이터 없음',
      met: false,
    });
  } else if (tier === 'small') {
    // 소형주: 절대값 기준
    const rawPts = foreignBuying ? 9 : 0;
    if (foreignBuying) score += 9;
    reasons.push({
      label: '외국인 당일',
      points: toNormalizedPoints(rawPts),
      detail: foreignBuying ? `외국인 +${fmt(foreignNet)}주` : `외국인 ${fmt(foreignNet)}주`,
      met: foreignBuying,
    });
  } else {
    // 대형주/중형주: 시총 대비 비율 기반
    const foreignAmount = (foreignNet ?? 0) * price;
    const rawPts = calcRatioBasedScore(foreignAmount, mcap, tier);
    score += rawPts;
    const ratioStr = mcap > 0 ? ((foreignAmount / mcap) * 100).toFixed(3) : '0.000';
    const amountStr = fmt(foreignAmount);
    const detail = foreignNet > 0
      ? `외국인 +${fmt(foreignNet)}주 (${amountStr}원, 시총 대비 ${ratioStr}%)`
      : `외국인 ${fmt(foreignNet)}주 (${amountStr}원, 시총 대비 ${ratioStr}%)`;
    reasons.push({
      label: '외국인 당일',
      points: toNormalizedPoints(rawPts),
      detail,
      met: rawPts > 0,
    });
  }

  if (institutionNet === null) {
    reasons.push({
      label: '기관 당일',
      points: 0,
      detail: '데이터 없음',
      met: false,
    });
  } else if (tier === 'small') {
    // 소형주: 절대값 기준
    const rawPts = institutionBuying ? 9 : 0;
    if (institutionBuying) score += 9;
    reasons.push({
      label: '기관 당일',
      points: toNormalizedPoints(rawPts),
      detail: institutionBuying ? `기관 +${fmt(institutionNet)}주` : `기관 ${fmt(institutionNet)}주`,
      met: institutionBuying,
    });
  } else {
    // 대형주/중형주: 시총 대비 비율 기반
    const instAmount = (institutionNet ?? 0) * price;
    const rawPts = calcRatioBasedScore(instAmount, mcap, tier);
    score += rawPts;
    const ratioStr = mcap > 0 ? ((instAmount / mcap) * 100).toFixed(3) : '0.000';
    const amountStr = fmt(instAmount);
    const detail = institutionNet > 0
      ? `기관 +${fmt(institutionNet)}주 (${amountStr}원, 시총 대비 ${ratioStr}%)`
      : `기관 ${fmt(institutionNet)}주 (${amountStr}원, 시총 대비 ${ratioStr}%)`;
    reasons.push({
      label: '기관 당일',
      points: toNormalizedPoints(rawPts),
      detail,
      met: rawPts > 0,
    });
  }

  // ── 5일 누적 순매수 (티어별 차등) ──
  if (foreignNet5d === null) {
    reasons.push({
      label: '외국인 5일 누적',
      points: 0,
      detail: '데이터 없음',
      met: false,
    });
  } else if (tier === 'small') {
    const rawPts = foreignNet5d > 0 ? 5 : 0;
    if (foreignNet5d > 0) score += 5;
    const ratioStr = mcap > 0 && price > 0
      ? (((foreignNet5d * price) / mcap) * 100).toFixed(3)
      : '0.000';
    reasons.push({
      label: '외국인 5일 누적',
      points: toNormalizedPoints(rawPts),
      detail: `외국인 5일 누적 +${fmt(foreignNet5d)}주 (시총 대비 ${ratioStr}%)`,
      met: foreignNet5d > 0,
    });
  } else {
    const rawPts = calcStreakRatioBonus(foreignNet5d, mcap, price, tier);
    score += rawPts;
    const ratioStr = mcap > 0 && price > 0
      ? (((foreignNet5d * price) / mcap) * 100).toFixed(3)
      : '0.000';
    reasons.push({
      label: '외국인 5일 누적',
      points: toNormalizedPoints(rawPts),
      detail: `외국인 5일 누적 +${fmt(foreignNet5d)}주 (시총 대비 ${ratioStr}%)`,
      met: rawPts > 0,
    });
  }

  if (institutionNet5d === null) {
    reasons.push({
      label: '기관 5일 누적',
      points: 0,
      detail: '데이터 없음',
      met: false,
    });
  } else if (tier === 'small') {
    const rawPts = institutionNet5d > 0 ? 5 : 0;
    if (institutionNet5d > 0) score += 5;
    const ratioStr = mcap > 0 && price > 0
      ? (((institutionNet5d * price) / mcap) * 100).toFixed(3)
      : '0.000';
    reasons.push({
      label: '기관 5일 누적',
      points: toNormalizedPoints(rawPts),
      detail: `기관 5일 누적 +${fmt(institutionNet5d)}주 (시총 대비 ${ratioStr}%)`,
      met: institutionNet5d > 0,
    });
  } else {
    const rawPts = calcStreakRatioBonus(institutionNet5d, mcap, price, tier);
    score += rawPts;
    const ratioStr = mcap > 0 && price > 0
      ? (((institutionNet5d * price) / mcap) * 100).toFixed(3)
      : '0.000';
    reasons.push({
      label: '기관 5일 누적',
      points: toNormalizedPoints(rawPts),
      detail: `기관 5일 누적 +${fmt(institutionNet5d)}주 (시총 대비 ${ratioStr}%)`,
      met: rawPts > 0,
    });
  }

  // ── 연속 매수/매도 (매집 의지 or 이탈 경고) — 전 티어 공통 ──
  // 매수 전환 첫날에 보너스를 주되, 장기 streak과의 역전 폭은 억제
  const fStreak = foreignStreak ?? 0;
  let fStreakRawPts = 0;
  let fStreakDetail = '';
  let fStreakMet = false;

  if (fStreak === 1) { fStreakRawPts = 6; fStreakDetail = `외국인 ${fStreak}일 연속 매수`; fStreakMet = true; score += 6; }
  else if (fStreak >= 5) { fStreakRawPts = 5; fStreakDetail = `외국인 ${fStreak}일 연속 매수`; fStreakMet = true; score += 5; }
  else if (fStreak >= 3) { fStreakRawPts = 4; fStreakDetail = `외국인 ${fStreak}일 연속 매수`; fStreakMet = true; score += 4; }
  else if (fStreak >= 2) { fStreakRawPts = 6; fStreakDetail = `외국인 ${fStreak}일 연속 매수`; fStreakMet = true; score += 6; }
  else if (fStreak <= -3) { fStreakRawPts = -5; fStreakDetail = `외국인 ${Math.abs(fStreak)}일 연속 매도 ⚠️`; fStreakMet = false; score -= 5; }
  else { fStreakDetail = fStreak < 0 ? `외국인 ${Math.abs(fStreak)}일 연속 매도 ⚠️` : '외국인 연속매수 없음'; }

  reasons.push({
    label: '외국인 연속매수',
    points: toNormalizedPoints(fStreakRawPts),
    detail: fStreakDetail || '해당 없음',
    met: fStreakMet,
  });

  const iStreak = institutionStreak ?? 0;
  let iStreakRawPts = 0;
  let iStreakDetail = '';
  let iStreakMet = false;

  if (iStreak === 1) { iStreakRawPts = 6; iStreakDetail = `기관 ${iStreak}일 연속 매수`; iStreakMet = true; score += 6; }
  else if (iStreak >= 5) { iStreakRawPts = 5; iStreakDetail = `기관 ${iStreak}일 연속 매수`; iStreakMet = true; score += 5; }
  else if (iStreak >= 3) { iStreakRawPts = 4; iStreakDetail = `기관 ${iStreak}일 연속 매수`; iStreakMet = true; score += 4; }
  else if (iStreak >= 2) { iStreakRawPts = 6; iStreakDetail = `기관 ${iStreak}일 연속 매수`; iStreakMet = true; score += 6; }
  else if (iStreak <= -3) { iStreakRawPts = -5; iStreakDetail = `기관 ${Math.abs(iStreak)}일 연속 매도 ⚠️`; iStreakMet = false; score -= 5; }
  else { iStreakDetail = iStreak < 0 ? `기관 ${Math.abs(iStreak)}일 연속 매도 ⚠️` : '기관 연속매수 없음'; }

  reasons.push({
    label: '기관 연속매수',
    points: toNormalizedPoints(iStreakRawPts),
    detail: iStreakDetail || '해당 없음',
    met: iStreakMet,
  });

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
      const myTurnoverOk = myTurnover / 100_000_000;
      const ratio = myTurnover / sectorAvgTurnover;
      reasons.push({
        label: '섹터 거래대금',
        points: toNormalizedPoints(4),
        detail: `거래대금 ${myTurnoverOk.toFixed(0)}억 (섹터 평균 대비 ${ratio.toFixed(1)}배)`,
        met: true,
      });
    } else {
      const myTurnoverOk = myTurnover / 100_000_000;
      const ratio = myTurnover / sectorAvgTurnover;
      reasons.push({
        label: '섹터 거래대금',
        points: 0,
        detail: `거래대금 ${myTurnoverOk.toFixed(0)}억 (섹터 평균 대비 ${ratio.toFixed(1)}배)`,
        met: false,
      });
    }
  } else {
    reasons.push({
      label: '섹터 거래대금',
      points: 0,
      detail: '데이터 없음',
      met: false,
    });
  }

  // ── 동반매수 시너지 (스마트머니 합류) ──
  let synergyRawPts = 0;
  if (foreignBuying && institutionBuying) { score += 3; synergyRawPts += 3; }
  if (foreignNet5d !== null && foreignNet5d > 0 &&
      institutionNet5d !== null && institutionNet5d > 0) { score += 2; synergyRawPts += 2; }

  reasons.push({
    label: '동반매수 시너지',
    points: toNormalizedPoints(synergyRawPts),
    detail: synergyRawPts > 0 ? '외국인+기관 동반 순매수' : '동반매수 없음',
    met: synergyRawPts > 0,
  });

  // ── 공매도 비율 낮음 ──
  const lowShortSell = shortSellRatio !== null && shortSellRatio >= 0 && shortSellRatio < 1;
  if (lowShortSell) score += 2;

  if (shortSellRatio === null) {
    reasons.push({
      label: '공매도 비율',
      points: 0,
      detail: '데이터 없음',
      met: false,
    });
  } else {
    reasons.push({
      label: '공매도 비율',
      points: toNormalizedPoints(lowShortSell ? 2 : 0),
      detail: `공매도 ${shortSellRatio.toFixed(2)}% (기준: 1% 미만)`,
      met: lowShortSell,
    });
  }

  const rawScore = Math.max(-10, Math.min(score, 45));
  const normalizedScore = Math.round(((rawScore - RAW_MIN) / RAW_SPAN) * 100 * 10) / 10;

  return {
    score: rawScore,
    rawScore,
    normalizedScore: Math.max(0, Math.min(normalizedScore, 100)),
    reasons,
    foreign_buying: foreignBuying,
    institution_buying: institutionBuying,
    volume_vs_sector: volumeVsSector,
    low_short_sell: lowShortSell,
  };
}
