/**
 * composite-score.ts
 * 4축(기술전환 + 수급강도 + 가치매력 + 신호보너스) 가중 합산 + 리스크 감산
 *
 * 티어별 가중치:
 *   large: tech=30, supply=25, val=35, signal=10
 *   mid:   tech=35, supply=25, val=30, signal=10
 *   small: tech=38, supply=28, val=24, signal=10
 */

import { calcTechnicalReversal } from './technical-reversal';
import { calcSupplyStrength } from './supply-strength';
import { calcValuationAttractiveness } from './valuation-attractiveness';
import { calcSignalBonus } from './signal-bonus';
import { calcRiskScore } from './risk-score';
import { getMarketCapTier } from '@/lib/ai-recommendation/market-cap-tier';
import type { DailyPrice } from '@/lib/ai-recommendation/technical-score';

/** 통합 점수 계산에 필요한 입력값 */
export interface CompositeScoreInput {
  /** 일별 가격 배열 (오래된 순) */
  prices: DailyPrice[];
  /** 52주 고가 */
  high52w: number | null;
  /** 52주 저가 */
  low52w: number | null;
  /** 외국인 연속 매수(+)/매도(-) 일수 */
  foreignStreak: number | null;
  /** 기관 연속 매수(+)/매도(-) 일수 */
  institutionStreak: number | null;
  /** 외국인 당일 순매수 수량 */
  foreignNetQty: number | null;
  /** 기관 당일 순매수 수량 */
  institutionNetQty: number | null;
  /** 외국인 5일 누적 순매수 */
  foreignNet5d: number | null;
  /** 기관 5일 누적 순매수 */
  institutionNet5d: number | null;
  /** 공매도 비율 (%) */
  shortSellRatio: number | null;
  /** 현재주가 */
  currentPrice: number | null;
  /** 애널리스트 목표주가 */
  targetPrice: number | null;
  /** 예상 PER (Forward PER) */
  forwardPer: number | null;
  /** 12개월 Trailing PER */
  per: number | null;
  /** 주가순자산비율 */
  pbr: number | null;
  /** 자기자본이익률 (%) */
  roe: number | null;
  /** 배당수익률 (%) */
  dividendYield: number | null;
  /** 투자의견 수치 (예: 4 = Strong Buy) */
  investOpinion: number | null;
  /** 오늘 BUY 신호 소스(채널) 수 */
  todaySourceCount: number;
  /** 마지막 신호 경과 일수 (없으면 null) */
  daysSinceLastSignal: number | null;
  /** 최근 30일 BUY 신호 횟수 */
  recentCount30d: number;
  /** 마지막 신호 시점 주가 */
  lastSignalPrice: number | null;
  /** 시가총액 (억원) */
  marketCap: number | null;
  /** 관리종목 여부 */
  isManaged?: boolean;
  /** CB/BW 최근 발행 여부 */
  hasRecentCbw?: boolean;
  /** 감사의견 ('적정' 이외면 비적정) */
  auditOpinion?: string | null;
  /** 최대주주 지분율 (%) */
  majorShareholderPct?: number | null;
  /** 최대주주 지분율 변화량 */
  majorShareholderDelta?: number | null;
  /** 자사주 매입 여부 */
  hasTreasuryBuyback?: boolean;
  /** 당일 거래대금 (원) */
  dailyTradingValue?: number | null;
  /** 20일 평균 거래대금 (원) */
  avgTradingValue20d?: number | null;
  /** 주식 회전율 (%) */
  turnoverRate?: number | null;
}

/** 통합 점수 계산 결과 */
export interface CompositeScoreResult {
  /** 최종 종합 점수 (0~100) */
  score_total: number;
  /** 기술전환 점수 (0~100) */
  score_technical: number;
  /** 수급강도 점수 (0~100) */
  score_supply: number;
  /** 가치매력 점수 (0~100) */
  score_valuation: number;
  /** 신호보너스 점수 (0~100) */
  score_signal: number;
  /** 리스크 감점 (0 이하) */
  score_risk: number;
}

/** 티어별 가중치 설정 */
const TIER_WEIGHTS = {
  large: { tech: 30, supply: 25, val: 35, signal: 10 },
  mid:   { tech: 35, supply: 25, val: 30, signal: 10 },
  small: { tech: 38, supply: 28, val: 24, signal: 10 },
} as const;

/**
 * 4축 통합 점수를 계산한다.
 *
 * 1. 시총 티어에 따라 가중치를 결정한다.
 * 2. 각 축(기술전환, 수급강도, 가치매력, 신호보너스)의 normalizedScore를 가중 합산한다.
 * 3. 리스크 페널티를 최대 20% 감산하여 최종 점수를 산출한다.
 *
 * @param input - 통합 점수 계산 입력값
 * @returns 축별 점수와 최종 종합 점수
 */
export function calcCompositeScore(input: CompositeScoreInput): CompositeScoreResult {
  // 시총 티어 결정
  const tier = getMarketCapTier(input.marketCap);
  const weights = TIER_WEIGHTS[tier];

  // 각 축 점수 계산
  const techResult = calcTechnicalReversal(input.prices, input.high52w, input.low52w);
  const supplyResult = calcSupplyStrength({
    foreignStreak: input.foreignStreak,
    institutionStreak: input.institutionStreak,
    foreignNetQty: input.foreignNetQty,
    institutionNetQty: input.institutionNetQty,
    foreignNet5d: input.foreignNet5d,
    institutionNet5d: input.institutionNet5d,
    shortSellRatio: input.shortSellRatio,
  });
  const valResult = calcValuationAttractiveness({
    currentPrice: input.currentPrice,
    targetPrice: input.targetPrice,
    forwardPer: input.forwardPer,
    per: input.per,
    pbr: input.pbr,
    roe: input.roe,
    dividendYield: input.dividendYield,
    investOpinion: input.investOpinion,
  });
  const signalResult = calcSignalBonus({
    todaySourceCount: input.todaySourceCount,
    daysSinceLastSignal: input.daysSinceLastSignal,
    recentCount30d: input.recentCount30d,
    currentPrice: input.currentPrice,
    lastSignalPrice: input.lastSignalPrice,
  });

  // 리스크 점수 계산 (0 이하 반환)
  const riskScore = calcRiskScore({
    is_managed: input.isManaged,
    has_recent_cbw: input.hasRecentCbw,
    audit_opinion: input.auditOpinion,
    major_shareholder_pct: input.majorShareholderPct,
    major_shareholder_delta: input.majorShareholderDelta,
    has_treasury_buyback: input.hasTreasuryBuyback,
    daily_trading_value: input.dailyTradingValue,
    avg_trading_value_20d: input.avgTradingValue20d,
    turnover_rate: input.turnoverRate,
    market_cap: input.marketCap,
  }, 'standard');

  // 기술전환 점수 보정:
  // 데이터가 충분하고 골든크로스(MA5>MA20) 상태인 종목은 "기술적으로 건강"하므로
  // tech 점수의 최솟값을 43으로 보장한다.
  // (RSI 과열 등으로 반전 신호 점수가 낮아도 추세 건강성은 인정)
  const techScore = (!techResult.data_insufficient && techResult.golden_cross)
    ? Math.max(techResult.normalizedScore, 43)
    : techResult.normalizedScore;

  // 가중 합산 (가중치 합계로 정규화)
  const wSum = weights.tech + weights.supply + weights.val + weights.signal;
  const base = (
    techScore * weights.tech +
    supplyResult.normalizedScore * weights.supply +
    valResult.normalizedScore * weights.val +
    signalResult.normalizedScore * weights.signal
  ) / wSum;

  // 리스크 페널티: 최대 20% 감산
  // riskScore는 0 이하이므로 절대값으로 변환 후 비율 적용
  const riskPenalty = Math.min(0.20, Math.abs(riskScore) / 100 * 0.20);
  const score_total = Math.min(100, Math.max(0, Math.round(base * (1 - riskPenalty))));

  return {
    score_total,
    score_technical: Math.round(techScore),
    score_supply: Math.round(supplyResult.normalizedScore),
    score_valuation: Math.round(valResult.normalizedScore),
    score_signal: Math.round(signalResult.normalizedScore),
    score_risk: riskScore,
  };
}
