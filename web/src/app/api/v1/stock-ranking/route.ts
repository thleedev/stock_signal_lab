import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase';
import { fetchBulkInvestorData, fetchNaverDailyPrices } from '@/lib/naver-stock-api';
import type { StockInvestorData, NaverDailyPrice } from '@/lib/naver-stock-api';
import { fetchBulkIndicators } from '@/lib/krx-api';
import { calcRiskScore } from '@/lib/scoring/risk-score';
import { calcSupplyAdditions } from '@/lib/scoring/supply-score-additions';
import { calcValuationAdditions } from '@/lib/scoring/valuation-score-additions';
import { getMarketCapTier, type MarketCapTier } from '@/lib/ai-recommendation/market-cap-tier';
import type { ScoreReason } from '@/types/score-reason';

export const dynamic = 'force-dynamic';

export interface StockRankItem {
  symbol: string;
  name: string;
  market: string;
  current_price: number | null;
  price_change_pct: number | null;
  per: number | null;
  pbr: number | null;
  roe: number | null;
  foreign_net_qty: number | null;
  institution_net_qty: number | null;
  foreign_net_5d: number | null;
  institution_net_5d: number | null;
  foreign_streak: number | null;
  institution_streak: number | null;
  short_sell_ratio: number | null;
  short_sell_updated_at: string | null;
  dividend_yield: number | null;
  market_cap: number | null;
  forward_per: number | null;
  target_price: number | null;
  invest_opinion: number | null;
  signal_count_30d: number | null;
  latest_signal_type: string | null;
  latest_signal_date: string | null;
  latest_signal_price: number | null;
  sector: string | null;
  high_52w: number | null;
  low_52w: number | null;
  // 초단기 모멘텀용 파생 필드 (daily_prices 기반)
  volume_ratio: number | null;      // 당일거래량 / 20일평균거래량
  close_position: number | null;    // (종가-저가)/(고가-저가), 고가=저가면 1.0
  trading_value: number | null;     // 거래대금 (원) = volume * close
  gap_pct: number | null;           // (당일시가-전일종가)/전일종가 * 100
  cum_return_3d: number | null;     // 3일 누적 수익률 (%)
  // 기본 점수 (stock_cache 기반)
  score_total: number;
  score_valuation: number;
  score_supply: number;
  score_signal: number;
  score_momentum: number;
  // 리스크/촉매 점수
  score_risk?: number;
  score_catalyst?: number;
  // 거래 관련 추가 필드
  daily_trading_value?: number | null;
  avg_trading_value_20d?: number | null;
  turnover_rate?: number | null;
  // DART/리스크 관련 필드
  is_managed?: boolean;
  has_recent_cbw?: boolean;
  major_shareholder_pct?: number | null;
  major_shareholder_delta?: number | null;
  audit_opinion?: string | null;
  has_treasury_buyback?: boolean;
  revenue_growth_yoy?: number | null;
  operating_profit_growth_yoy?: number | null;
  // 신호/등급 관련 필드
  signal_date?: string | null;
  grade?: string;
  characters?: string[];
  recommendation?: string;
  // AI 추천 데이터 (ai_recommendations 있는 경우)
  ai?: {
    total_score: number;
    signal_score: number;
    trend_score: number;
    valuation_score: number;
    supply_score: number;
    rsi: number | null;
    golden_cross: boolean;
    bollinger_bottom: boolean;
    phoenix_pattern: boolean;
    macd_cross: boolean;
    volume_surge: boolean;
    week52_low_near: boolean;
    double_top: boolean;
    disparity_rebound: boolean;
    volume_breakout: boolean;
    consecutive_drop_rebound: boolean;
    foreign_buying: boolean;
    institution_buying: boolean;
    volume_vs_sector: boolean;
    low_short_sell: boolean;
    // 정규화 점수 (0~100)
    signal_norm?: number;
    trend_norm?: number;
    valuation_norm?: number;
    supply_norm?: number;
    earnings_momentum_norm?: number;
    risk_norm?: number;
    // 점수 산출 근거
    signal_reasons?: ScoreReason[];
    trend_reasons?: ScoreReason[];
    valuation_reasons?: ScoreReason[];
    supply_reasons?: ScoreReason[];
    earnings_momentum_reasons?: ScoreReason[];
    risk_reasons?: ScoreReason[];
  };
}

/**
 * 각 카테고리 0~100 정규화 점수 산출 (애널리스트 관점)
 *
 * - score_valuation (0~100): 저평가 매력도 (PER·PBR·ROE 복합)
 * - score_supply    (0~100): 수급 동향 (외국인·기관·공매도)
 * - score_signal    (0~100): AI 신호 신뢰도 (빈도 + 최근성)
 * - score_momentum  (0~100): 기술적 모멘텀 (가격위치 + 등락률, 과열시 감점)
 */
function calcScore(
  stock: Omit<StockRankItem, 'score_total' | 'score_valuation' | 'score_supply' | 'score_signal' | 'score_momentum' | 'ai'>,
  todayStr: string,
  sectorAvgPct: number | null = null, // 같은 섹터 평균 등락률
  scoringModel: string = 'standard', // 점수 계산 모델
) {
  // ── 시총 티어 결정 (전체 스코어링에서 참조) ──
  const tier: MarketCapTier = getMarketCapTier(stock.market_cap ?? null);

  // ── 밸류에이션 (0~100) ── 대형주/중형주: PEG 기반 추가
  const hasForward = stock.forward_per !== null || stock.target_price !== null || stock.invest_opinion !== null;
  let vPer = 0, vPbr = 0, vRoe = 0, vUpside = 0, vOpinion = 0;

  if (hasForward) {
    const usePeg = tier !== 'small' && stock.forward_per && stock.per && stock.per > 0 && stock.forward_per > 0;

    if (usePeg) {
      // 대형주/중형주: PEG 기반 (성장 대비 저평가)
      const epsGrowth = ((stock.per! / stock.forward_per!) - 1) * 100;
      if (epsGrowth > 0) {
        const peg = stock.forward_per! / epsGrowth;
        if (peg < 0.5) vPer = 35;
        else if (peg < 0.8) vPer = 30;
        else if (peg < 1.0) vPer = 22;
        else if (peg < 1.5) vPer = 12;
        else if (peg < 2.0) vPer = 5;
      } else {
        // 역성장: Forward PER 절대값 폴백
        if (stock.forward_per! < 8) vPer = 18;
        else if (stock.forward_per! < 12) vPer = 8;
        else if (stock.forward_per! < 15) vPer = 3;
      }
    } else if (stock.forward_per !== null && stock.forward_per > 0) {
      // Forward PER 절대값 기준 (소형주 또는 PEG 계산 불가)
      if (stock.forward_per < 5) vPer = 35;
      else if (stock.forward_per < 8) vPer = 28;
      else if (stock.forward_per < 12) vPer = 18;
      else if (stock.forward_per < 15) vPer = 8;
      else if (stock.forward_per < 20) vPer = 3;
    } else if (stock.per !== null && stock.per > 0) {
      if (stock.per < 5) vPer = 35;
      else if (stock.per < 8) vPer = 28;
      else if (stock.per < 12) vPer = 18;
      else if (stock.per < 15) vPer = 8;
      else if (stock.per < 20) vPer = 3;
    }
    // 목표주가 상승여력 (0~25)
    if (stock.target_price && stock.current_price && stock.current_price > 0) {
      const upside = ((stock.target_price - stock.current_price) / stock.current_price) * 100;
      if (upside >= 50) vUpside = 25;
      else if (upside >= 30) vUpside = 20;
      else if (upside >= 15) vUpside = 12;
      else if (upside >= 5) vUpside = 5;
    }
    // 투자의견 (0~15)
    if (stock.invest_opinion !== null && stock.invest_opinion > 0) {
      if (stock.invest_opinion >= 4.5) vOpinion = 15;
      else if (stock.invest_opinion >= 3.5) vOpinion = 10;
      else if (stock.invest_opinion >= 2.5) vOpinion = 3;
    }
  } else {
    // Forward 없으면 trailing 기준
    if (stock.per !== null && stock.per > 0) {
      if (stock.per < 5) vPer = 35;
      else if (stock.per < 8) vPer = 28;
      else if (stock.per < 12) vPer = 18;
      else if (stock.per < 15) vPer = 8;
      else if (stock.per < 20) vPer = 3;
    }
    if (stock.pbr !== null && stock.pbr > 0) {
      if (stock.pbr < 0.3) vPbr = 35;
      else if (stock.pbr < 0.5) vPbr = 30;
      else if (stock.pbr < 0.8) vPbr = 20;
      else if (stock.pbr < 1.0) vPbr = 10;
      else if (stock.pbr < 1.5) vPbr = 3;
    }
  }
  if (stock.roe !== null) {
    if (stock.roe > 25) vRoe = 30;
    else if (stock.roe > 20) vRoe = 25;
    else if (stock.roe > 15) vRoe = 20;
    else if (stock.roe > 10) vRoe = 12;
    else if (stock.roe > 5) vRoe = 5;
  }
  // 배당수익률 가산 (0~15)
  let vDiv = 0;
  if (stock.dividend_yield !== null && stock.dividend_yield > 0) {
    if (stock.dividend_yield >= 5) vDiv = 15;
    else if (stock.dividend_yield >= 3) vDiv = 10;
    else if (stock.dividend_yield >= 1.5) vDiv = 5;
  }
  let score_valuation = Math.min(100, vPer + vPbr + vRoe + vDiv + vUpside + vOpinion);

  // 밸류에이션 추가 점수 (성장률 기반)
  const valBonus = calcValuationAdditions({
    revenue_growth_yoy: (stock as Record<string, unknown>).revenue_growth_yoy as number | null | undefined,
    operating_profit_growth_yoy: (stock as Record<string, unknown>).operating_profit_growth_yoy as number | null | undefined,
  });
  score_valuation = Math.min(100, Math.max(0, score_valuation + valBonus));

  // ── 수급 (0~100) ── 시총 티어별 차등 스코어링
  let score_supply = 0;
  const foreignBuying = stock.foreign_net_qty !== null && stock.foreign_net_qty > 0;
  const instBuying = stock.institution_net_qty !== null && stock.institution_net_qty > 0;
  const foreign5d = stock.foreign_net_5d ?? 0;
  const inst5d = stock.institution_net_5d ?? 0;
  const foreignStreak = stock.foreign_streak ?? 0;
  const instStreak = stock.institution_streak ?? 0;
  const mcap = stock.market_cap ?? 0;
  const price = stock.current_price ?? 0;

  if (tier === 'small') {
    // 소형주: 기존 절대값 기준 유지
    if (foreignBuying) score_supply += 20;
    if (instBuying) score_supply += 20;
    if (foreign5d > 0) score_supply += 12;
    if (inst5d > 0) score_supply += 12;
  } else {
    // 대형주/중형주: 시총 대비 비율 기반
    const calcRatioScore = (netQty: number, mc: number, pr: number, t: MarketCapTier): number => {
      if (mc <= 0 || pr <= 0) return 0;
      const ratio = (netQty * pr) / mc;
      if (t === 'large') {
        if (ratio >= 0.003) return 20; if (ratio >= 0.001) return 15;
        if (ratio >= 0.0005) return 8; if (ratio > 0) return 4; return 0;
      }
      if (ratio >= 0.005) return 20; if (ratio >= 0.001) return 15;
      if (ratio >= 0.0005) return 8; if (ratio > 0) return 4; return 0;
    };
    score_supply += calcRatioScore(stock.foreign_net_qty ?? 0, mcap, price, tier);
    score_supply += calcRatioScore(stock.institution_net_qty ?? 0, mcap, price, tier);
    // 5일 누적도 비율 기반
    const calc5dRatio = (net5d: number, mc: number, pr: number, t: MarketCapTier): number => {
      if (mc <= 0 || pr <= 0 || net5d <= 0) return 0;
      const ratio = (net5d * pr) / mc;
      if (t === 'large') {
        if (ratio >= 0.003) return 12; if (ratio >= 0.001) return 8;
        if (ratio >= 0.0005) return 4; return 0;
      }
      if (ratio >= 0.005) return 12; if (ratio >= 0.002) return 8;
      if (ratio >= 0.001) return 4; return 0;
    };
    score_supply += calc5dRatio(foreign5d, mcap, price, tier);
    score_supply += calc5dRatio(inst5d, mcap, price, tier);
  }

  // 연속 매수 (전 티어 공통)
  if (foreignStreak >= 5) score_supply += 20;
  else if (foreignStreak >= 3) score_supply += 15;
  else if (foreignStreak >= 2) score_supply += 8;

  if (instStreak >= 5) score_supply += 20;
  else if (instStreak >= 3) score_supply += 15;
  else if (instStreak >= 2) score_supply += 8;

  // 동반매수 시너지
  if (foreign5d > 0 && inst5d > 0) score_supply += 10;

  // 공매도
  const shortSellFresh = stock.short_sell_updated_at?.slice(0, 10) === todayStr;
  if (shortSellFresh && stock.short_sell_ratio !== null && stock.short_sell_ratio >= 0) {
    if (stock.short_sell_ratio < 0.5) score_supply += 10;
    else if (stock.short_sell_ratio < 1) score_supply += 5;
  }
  score_supply = Math.min(100, score_supply);

  // 수급 추가 점수 (거래대금·회전율·자사주·대주주 기반)
  const supplyBonus = calcSupplyAdditions({
    daily_trading_value: (stock as Record<string, unknown>).trading_value as number | null | undefined,
    avg_trading_value_20d: (stock as Record<string, unknown>).avg_trading_value_20d as number | null | undefined,
    turnover_rate: (stock as Record<string, unknown>).turnover_rate as number | null | undefined,
    has_treasury_buyback: (stock as Record<string, unknown>).has_treasury_buyback as boolean | undefined,
    major_shareholder_delta: (stock as Record<string, unknown>).major_shareholder_delta as number | null | undefined,
  });
  score_supply = Math.min(100, Math.max(0, score_supply + supplyBonus));

  // ── 신호 신뢰도 (0~100) ──
  // 반복 추천 + 매수가 대비 현재가 위치
  let score_signal = 0;
  const cnt = stock.signal_count_30d ?? 0;

  // 신호 존재 자체가 핵심 — 반복될수록 확신
  if (cnt >= 5) score_signal += 55;
  else if (cnt >= 3) score_signal += 45;
  else if (cnt >= 2) score_signal += 40;
  else if (cnt >= 1) score_signal += 35;

  // 매수가 대비 현재가 갭 (변별력 핵심, 최대 ±30점)
  if (stock.latest_signal_price && stock.latest_signal_price > 0 && stock.current_price && stock.current_price > 0) {
    const gap = ((stock.current_price - stock.latest_signal_price) / stock.latest_signal_price) * 100;
    if (gap <= -3) score_signal += 30;         // 매수가 -3% 이하: 최적 진입
    else if (gap <= 0) score_signal += 25;     // 매수가 이하: 진입 기회
    else if (gap < 3) score_signal += 20;      // +3% 미만: 아직 초입
    else if (gap < 7) score_signal += 12;      // +3~7%: 유효
    else if (gap < 15) score_signal += 5;      // +7~15%: 상당 반영
    else score_signal -= 10;                    // +15% 이상: 추격매수 감점
  } else {
    // 매수가 정보 없으면 기본 가산 (갭 분석 불가 → 중간 보너스)
    if (cnt >= 1) score_signal += 20;
  }
  score_signal = Math.max(0, Math.min(100, score_signal));

  // ── 기술/모멘텀 (0~100) ──
  // 52주 범위 내 상대 위치(하단일수록 유리) + 단기 등락률(과열 감점)
  let score_momentum = 0;

  // 52주 범위 내 상대 위치: 티어별 차등
  if (stock.current_price && stock.high_52w && stock.low_52w &&
      stock.high_52w > stock.low_52w) {
    const range = stock.high_52w - stock.low_52w;
    const position = (stock.current_price - stock.low_52w) / range; // 0=저점, 1=고점

    if (tier === 'large') {
      // 대형주: 52주 신고가 돌파가 강한 매수 시그널
      if (position >= 0.95) score_momentum += 40;       // 신고가 돌파: 기관 매집 증거
      else if (position >= 0.85) score_momentum += 30;
      else if (position >= 0.70) score_momentum += 20;
      else if (position >= 0.50) score_momentum += 12;
      else if (position >= 0.30) score_momentum += 5;
      else score_momentum += 2;                          // 대형주 52주 저점 = 위험 신호
    } else if (tier === 'mid') {
      // 중형주: 균형 잡힌 관점
      if (position >= 0.95) score_momentum += 30;
      else if (position <= 0.15) score_momentum += 30;
      else if (position <= 0.30) score_momentum += 25;
      else if (position >= 0.85) score_momentum += 20;
      else if (position <= 0.50) score_momentum += 15;
      else score_momentum += 8;
    } else {
      // 소형주: 바닥 반등 기대 + 중간 구간 보강
      if (position <= 0.15) score_momentum += 40;
      else if (position <= 0.30) score_momentum += 35;
      else if (position <= 0.50) score_momentum += 28;
      else if (position <= 0.70) score_momentum += 20;
      else if (position <= 0.85) score_momentum += 12;
      else score_momentum += 5;
    }
  }

  // 단기 등락률: 티어별 차등 (대형주는 안정적 상승이 최적)
  if (stock.price_change_pct !== null) {
    const pct = stock.price_change_pct;
    if (tier === 'large') {
      // 대형주: 완만한 상승이 최적, 급등은 오히려 경계
      if (pct >= 0.5 && pct < 2) score_momentum += 40;     // 안정적 상승: 최적
      else if (pct >= 2 && pct < 4) score_momentum += 30;  // 상승 진행
      else if (pct >= 4 && pct < 7) score_momentum += 15;  // 강한 상승
      else if (pct >= 7) score_momentum -= 5;               // 대형주 급등 = 이벤트성
      else if (pct >= 0 && pct < 0.5) score_momentum += 25; // 보합: 안정
      else if (pct > -2) score_momentum += 10;              // 소폭 조정
      else if (pct > -5) score_momentum += 3;
      else score_momentum -= 10;
    } else {
      // 중형주/소형주: 기존 로직 유지
      if (pct >= 1 && pct < 3) score_momentum += 30;
      else if (pct >= 3 && pct < 5) score_momentum += 40;
      else if (pct >= 5 && pct < 10) score_momentum += 25;
      else if (pct >= 10 && pct < 15) score_momentum += 10;
      else if (pct >= 15 && pct < 25) score_momentum -= 5;
      else if (pct >= 25) score_momentum -= 20;
      else if (pct >= 0 && pct < 1) score_momentum += 15;
      else if (pct > -3) score_momentum += 5;
      else if (pct > -5) score_momentum += 3;
      else if (pct > -10) score_momentum += 0;
      else score_momentum -= 10;
    }
  }

  // 섹터 상대강도: 같은 섹터 평균 대비 얼마나 강한지
  if (sectorAvgPct !== null && stock.price_change_pct !== null) {
    const relStrength = stock.price_change_pct - sectorAvgPct;
    if (relStrength >= 5) score_momentum += 20;        // 섹터 대비 +5% 이상: 강한 주도주
    else if (relStrength >= 2) score_momentum += 12;   // 섹터 대비 +2% 이상: 상대 강세
    else if (relStrength >= 0) score_momentum += 5;    // 섹터 평균 이상
    else if (relStrength < -5) score_momentum -= 10;   // 섹터 대비 크게 뒤처짐
  }
  score_momentum = Math.max(0, Math.min(100, score_momentum));

  // ── 리스크 점수 (감점 방식, 0 이하) ──
  const riskScore = calcRiskScore({
    is_managed: (stock as Record<string, unknown>).is_managed as boolean | undefined,
    audit_opinion: (stock as Record<string, unknown>).audit_opinion as string | null | undefined,
    has_recent_cbw: (stock as Record<string, unknown>).has_recent_cbw as boolean | undefined,
    major_shareholder_pct: (stock as Record<string, unknown>).major_shareholder_pct as number | null | undefined,
    major_shareholder_delta: (stock as Record<string, unknown>).major_shareholder_delta as number | null | undefined,
    daily_trading_value: (stock as Record<string, unknown>).trading_value as number | null | undefined,
    avg_trading_value_20d: (stock as Record<string, unknown>).avg_trading_value_20d as number | null | undefined,
    turnover_rate: (stock as Record<string, unknown>).turnover_rate as number | null | undefined,
    market_cap: (stock as Record<string, unknown>).market_cap as number | null | undefined,
  }, scoringModel as 'standard' | 'short_term');

  // 티어별 가중 합산 (risk는 비율 감산 방식)
  const tierWeights = {
    large:  { signal: 10, momentum: 30, valuation: 20, supply: 40 },
    mid:    { signal: 10, momentum: 32, valuation: 22, supply: 36 },
    small:  { signal: 12, momentum: 35, valuation: 23, supply: 30 },
  }[tier];
  const wSum = tierWeights.signal + tierWeights.momentum + tierWeights.valuation + tierWeights.supply;
  const base = (score_signal * tierWeights.signal +
     score_momentum * tierWeights.momentum +
     score_valuation * tierWeights.valuation +
     score_supply * tierWeights.supply) / wSum;
  // risk 감산: 0이면 감산 없음, -100이면 15% 감산
  const riskPenalty = Math.min(0.15, Math.abs(riskScore) / 100 * 0.15);
  const score_total = Math.min(100, Math.max(0, Math.round(base * (1 - riskPenalty))));
  return { score_total, score_valuation, score_supply, score_signal, score_momentum, score_risk: riskScore };
}

/**
 * 여러 종목의 일봉 데이터를 병렬 fetch (네이버 fchart API)
 * concurrency 제한으로 API 부하 방지
 */
async function fetchBulkDailyPrices(
  symbols: string[],
  concurrency = 10,
  days = 22,
): Promise<Map<string, NaverDailyPrice[]>> {
  const result = new Map<string, NaverDailyPrice[]>();
  if (symbols.length === 0) return result;

  const queue = [...symbols];
  const workers = Array.from({ length: Math.min(concurrency, queue.length) }, async () => {
    while (queue.length > 0) {
      const sym = queue.shift()!;
      try {
        const prices = await fetchNaverDailyPrices(sym, days);
        if (prices.length > 0) result.set(sym, prices);
      } catch {
        // 개별 종목 실패 무시
      }
    }
  });
  await Promise.all(workers);
  return result;
}

function kstDayRange(dateStr: string) {
  return {
    start: `${dateStr}T00:00:00+09:00`,
    end: `${dateStr}T23:59:59+09:00`,
  };
}

/**
 * 스냅샷 테이블에서 캐싱된 랭킹 결과를 읽어온다.
 * 스냅샷이 없으면 null 반환 → 실시간 계산으로 폴백
 */
async function readSnapshot(
  supabase: ReturnType<typeof createServiceClient>,
  model: string,
  date: string,
): Promise<{ items: StockRankItem[]; snapshot_time: string | null } | null> {
  // 해당 날짜의 최신 세션 찾기
  let targetDate = date;
  if (date === 'all' || date === 'signal_all') {
    const { data: latest } = await supabase
      .from('snapshot_sessions')
      .select('session_date')
      .eq('model', model)
      .order('session_date', { ascending: false })
      .limit(1)
      .single();
    if (!latest) return null;
    targetDate = latest.session_date;
  }

  const { data: latestSession } = await supabase
    .from('snapshot_sessions')
    .select('id, session_time')
    .eq('session_date', targetDate)
    .eq('model', model)
    .order('session_time', { ascending: false })
    .limit(1)
    .single();

  if (!latestSession) return null;

  // 해당 세션의 스냅샷만 조회 (페이지네이션)
  const allData: Record<string, unknown>[] = [];
  let offset = 0;
  while (true) {
    const { data: page, error: pageError } = await supabase
      .from('stock_ranking_snapshot')
      .select('*')
      .eq('session_id', latestSession.id)
      .order('score_total', { ascending: false })
      .range(offset, offset + 999);
    if (pageError || !page?.length) break;
    allData.push(...page);
    if (page.length < 1000) break;
    offset += 1000;
  }
  if (!allData.length) return null;

  return {
    items: allData.map((row: Record<string, unknown>) => ({
      ...(row.raw_data as Record<string, unknown> ?? {}),
      symbol: row.symbol as string,
      name: row.name as string,
      market: row.market as string,
      current_price: row.current_price as number,
      market_cap: row.market_cap as number,
      score_total: Number(row.score_total),
      score_signal: Number(row.score_signal),
      score_valuation: Number(row.score_valuation),
      score_supply: Number(row.score_supply),
      score_momentum: Number(row.score_momentum),
      score_risk: Number(row.score_risk ?? 0),
      daily_trading_value: row.daily_trading_value as number | null,
      avg_trading_value_20d: row.avg_trading_value_20d as number | null,
      turnover_rate: Number(row.turnover_rate ?? 0),
      is_managed: row.is_managed as boolean,
      has_recent_cbw: row.has_recent_cbw as boolean,
      major_shareholder_pct: Number(row.major_shareholder_pct ?? 0),
      signal_date: row.signal_date as string | null,
      grade: row.grade as string,
      characters: row.characters as string[],
      recommendation: row.recommendation as string,
    })) as StockRankItem[],
    snapshot_time: latestSession.session_time as string,
  }
}

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);

    // 체크리스트 모드: 별도 오케스트레이터 사용
    const mode = searchParams.get('mode');
    if (mode === 'checklist') {
      const conditionsParam = searchParams.get('conditions') ?? '';
      const activeIds = conditionsParam.split(',').filter(Boolean);
      const supabase = createServiceClient();
      const { generateChecklist } = await import('@/lib/checklist-recommendation/index');
      const result = await generateChecklist(supabase, activeIds);
      return NextResponse.json(result);
    }

    // 페이지네이션은 클라이언트에서 처리 — 서버는 전체 반환
    const page = 1;
    const limit = 99999;
    const q = searchParams.get('q')?.trim().toLowerCase() ?? '';
    const market = searchParams.get('market') ?? 'all';
    const model = searchParams.get('model') || 'standard';
    const refresh = searchParams.get('refresh') === 'true';
    const saveSnapshot = searchParams.get('snapshot') === 'true';

    const supabase = createServiceClient();
    const now = new Date();
    const todayStr = new Date(now.getTime() + 9 * 60 * 60 * 1000).toISOString().slice(0, 10);

    // ── 단일 종목 경량 경로: symbol 파라미터 시 스냅샷 로드 없이 즉시 응답 ──
    const singleSymbol = searchParams.get('symbol');
    if (singleSymbol) {
      const { data: row } = await supabase
        .from('stock_cache')
        .select('*')
        .eq('symbol', singleSymbol)
        .single();
      if (!row) return NextResponse.json({ items: [], total: 0 });

      // DART 데이터
      const { data: dart } = await supabase
        .from('stock_dart_info')
        .select('*')
        .eq('symbol', singleSymbol)
        .maybeSingle();

      // 수급 + 지표 실시간 fetch (병렬)
      const [invMap, indMap] = await Promise.all([
        fetchBulkInvestorData([singleSymbol], 1),
        fetchBulkIndicators([singleSymbol], 1),
      ]);

      const inv = invMap.get(singleSymbol);
      if (inv) {
        row.foreign_net_qty = inv.foreign_net;
        row.institution_net_qty = inv.institution_net;
        row.foreign_net_5d = inv.foreign_net_5d;
        row.institution_net_5d = inv.institution_net_5d;
        row.foreign_streak = inv.foreign_streak;
        row.institution_streak = inv.institution_streak;
      }
      const ind = indMap.get(singleSymbol);
      if (ind) {
        if (ind.per !== null) row.per = ind.per;
        if (ind.pbr !== null) row.pbr = ind.pbr;
        if (ind.roe !== null) row.roe = ind.roe;
        if (ind.high_52w !== null) row.high_52w = ind.high_52w;
        if (ind.low_52w !== null) row.low_52w = ind.low_52w;
        if (ind.dividend_yield !== null) row.dividend_yield = ind.dividend_yield;
        if (ind.forward_per !== null) row.forward_per = ind.forward_per;
        if (ind.target_price !== null) row.target_price = ind.target_price;
        if (ind.invest_opinion !== null) row.invest_opinion = ind.invest_opinion;
      }

      // DART 병합
      if (dart) {
        row.is_managed = row.is_managed ?? false;
        row.has_recent_cbw = dart.has_recent_cbw ?? false;
        row.major_shareholder_pct = dart.major_shareholder_pct ?? null;
        row.major_shareholder_delta = dart.major_shareholder_delta ?? null;
        row.audit_opinion = dart.audit_opinion ?? null;
        row.has_treasury_buyback = dart.has_treasury_buyback ?? false;
        row.revenue_growth_yoy = dart.revenue_growth_yoy ?? null;
        row.operating_profit_growth_yoy = dart.operating_profit_growth_yoy ?? null;
      }

      // 회전율 계산
      const floatShares = row.float_shares as number | null;
      const volume = row.volume as number | null;
      row.turnover_rate = floatShares ? ((volume ?? 0) / floatShares) * 100 : null;

      const scores = calcScore(row as Parameters<typeof calcScore>[0], todayStr, null, model);
      const item: StockRankItem = { ...row, ...scores, volume_ratio: null, close_position: null, trading_value: null, gap_pct: null, cum_return_3d: null } as unknown as StockRankItem;

      return NextResponse.json({ items: [item], total: 1, today: todayStr });
    }

    const dateParam = searchParams.get('date');
    const showAll = !dateParam || dateParam === 'all';
    const showWeek = dateParam === 'week';
    const showSignalAll = dateParam === 'signal_all'; // 신호전체: 최근 30일 신호 있는 종목

    // ── 스냅샷 캐시 읽기 (refresh가 아닐 때만) ──
    if (!refresh) {
      const snapshotDate = showAll || showSignalAll ? 'all' : (showWeek ? todayStr : (dateParam ?? todayStr));
      const snapshot = await readSnapshot(supabase, model, snapshotDate);
      if (snapshot) {
        let snapshotItems = snapshot.items;

        // ── 스냅샷 신호 데이터 실시간 보강 (필터링 전에 먼저 실행) ──
        // stock_cache가 stale일 수 있으므로 signals 테이블에서 직접 집계
        {
          const thirtyDaysAgo = new Date(new Date().getTime() + 9 * 60 * 60 * 1000 - 30 * 86400000)
            .toISOString().slice(0, 10);
          // 최근 30일 BUY 신호를 signals 테이블에서 직접 조회
          const allSignalRows: Record<string, unknown>[] = [];
          const { data: sigData } = await supabase
            .from('signals')
            .select('symbol, timestamp, signal_type, raw_data')
            .in('signal_type', ['BUY', 'BUY_FORECAST'])
            .gte('timestamp', `${thirtyDaysAgo}T00:00:00+09:00`)
            .order('timestamp', { ascending: false })
            .limit(5000);
          if (sigData) allSignalRows.push(...sigData);

          // 종목별 집계
          const sigAggMap = new Map<string, { count: number; latestDate: string; latestPrice: number | null }>();
          for (const row of allSignalRows) {
            const sym = row.symbol as string;
            const existing = sigAggMap.get(sym);
            if (!existing) {
              sigAggMap.set(sym, {
                count: 1,
                latestDate: row.timestamp as string,
                latestPrice: null, // 매수가 추출은 생략 (성능)
              });
            } else {
              existing.count++;
            }
          }

          // 스냅샷 아이템에 반영 (없는 종목은 0으로 리셋)
          for (const item of snapshotItems) {
            const agg = sigAggMap.get(item.symbol);
            if (agg) {
              item.signal_count_30d = agg.count;
              item.latest_signal_date = agg.latestDate;
              if (agg.latestDate) {
                (item as unknown as Record<string, unknown>).signal_date = agg.latestDate.slice(0, 10);
              }
            } else {
              // signals 테이블에 없으면 stale 데이터 제거
              item.signal_count_30d = 0;
              (item as unknown as Record<string, unknown>).signal_date = null;
            }
          }
        }

        // signal_all: 신호 있는 종목만 (보강 후 필터)
        if (showSignalAll) {
          snapshotItems = snapshotItems.filter((s) =>
            (s.signal_count_30d ?? 0) > 0 || s.signal_date
          );
        }
        // 특정 날짜(오늘 등): 해당 날짜 BUY 신호 있는 종목만
        if (!showAll && !showSignalAll && !showWeek && dateParam) {
          const { data: sigRows } = await supabase
            .from('signals')
            .select('symbol')
            .gte('timestamp', `${dateParam}T00:00:00+09:00`)
            .lte('timestamp', `${dateParam}T23:59:59+09:00`)
            .in('signal_type', ['BUY', 'BUY_FORECAST']);
          if (sigRows && sigRows.length > 0) {
            const dateSigs = new Set(sigRows.map((r) => r.symbol as string));
            snapshotItems = snapshotItems.filter((s) => dateSigs.has(s.symbol));
          } else {
            return NextResponse.json({ items: [], total: 0, page: 1, limit: 99999, today: todayStr });
          }
        }

        // ── 스냅샷 live 보강: 수급/지표 stale 종목 실시간 업데이트 ──
        // q 검색이면 해당 종목만, 아니면 30개 제한
        const staleSymbols = snapshotItems.filter((s) => {
          const invDate = ((s as unknown as Record<string, unknown>).investor_updated_at as string | undefined)?.slice(0, 10);
          return invDate !== todayStr;
        }).map((s) => s.symbol);
        const indNullSymbols = snapshotItems.filter((s) =>
          s.per == null || s.high_52w == null
        ).map((s) => s.symbol);

        // q 검색(상세패널 단일 종목 등)이면 제한 없이 개별 boost
        const isTargetedQuery = !!q && snapshotItems.length <= 5;
        const doInvFetch = staleSymbols.length > 0 && (isTargetedQuery || staleSymbols.length <= 30);
        const doIndFetch = indNullSymbols.length > 0 && (isTargetedQuery || indNullSymbols.length <= 30);

        if (doInvFetch || doIndFetch) {
          const [liveInvMap, liveIndMap] = await Promise.all([
            doInvFetch
              ? (async () => {
                  const m = new Map<string, StockInvestorData>();
                  const chunks = [];
                  for (let i = 0; i < staleSymbols.length; i += 200)
                    chunks.push(staleSymbols.slice(i, i + 200));
                  const results = await Promise.all(chunks.map(c => fetchBulkInvestorData(c, 20)));
                  for (const r of results) for (const [k, v] of r) m.set(k, v);
                  return m;
                })()
              : Promise.resolve(new Map<string, StockInvestorData>()),
            doIndFetch
              ? fetchBulkIndicators(indNullSymbols, 20)
              : Promise.resolve(new Map()),
          ]);

          for (const item of snapshotItems) {
            const inv = liveInvMap.get(item.symbol);
            if (inv) {
              item.foreign_net_qty = inv.foreign_net;
              item.institution_net_qty = inv.institution_net;
              item.foreign_net_5d = inv.foreign_net_5d;
              item.institution_net_5d = inv.institution_net_5d;
              item.foreign_streak = inv.foreign_streak;
              item.institution_streak = inv.institution_streak;
              (item as unknown as Record<string, unknown>).investor_updated_at = todayStr;
            }
            const ind = liveIndMap.get(item.symbol);
            if (ind) {
              if (ind.per !== null) item.per = ind.per;
              if (ind.pbr !== null) item.pbr = ind.pbr;
              if (ind.roe !== null) item.roe = ind.roe;
              if (ind.high_52w !== null) item.high_52w = ind.high_52w;
              if (ind.low_52w !== null) item.low_52w = ind.low_52w;
              if (ind.dividend_yield !== null) item.dividend_yield = ind.dividend_yield;
              if (ind.forward_per !== null) item.forward_per = ind.forward_per;
              if (ind.target_price !== null) item.target_price = ind.target_price;
              if (ind.invest_opinion !== null) item.invest_opinion = ind.invest_opinion;
            }
          }
        }

        // ── 전체 종목 점수 재계산 (수급/지표 보강 + 신호 보강 반영) ──
        for (const item of snapshotItems) {
          const scores = calcScore(item as Parameters<typeof calcScore>[0], todayStr, null, model);
          item.score_signal = scores.score_signal;
          item.score_momentum = scores.score_momentum;
          item.score_valuation = scores.score_valuation;
          item.score_supply = scores.score_supply;
          item.score_risk = scores.score_risk;
          item.score_total = scores.score_total;

          // 근거 레이어 생성 (스냅샷 경로)
          if (!item.ai) {
            const fmt = (n: number | null) => n !== null ? Math.round(n).toLocaleString('ko-KR') : '-';
            const foreignBuying = item.foreign_net_qty !== null && (item.foreign_net_qty as number) > 0;
            const instBuying = item.institution_net_qty !== null && (item.institution_net_qty as number) > 0;
            const pct = (item.price_change_pct as number) ?? 0;

            const trendReasons: ScoreReason[] = [
              { label: '등락률', points: pct > 0 ? 10 : 0, detail: `${pct >= 0 ? '+' : ''}${pct.toFixed(1)}%`, met: pct > 0 },
            ];
            if (item.high_52w && item.low_52w && item.current_price) {
              const pos = (((item.current_price as number) - (item.low_52w as number)) / ((item.high_52w as number) - (item.low_52w as number))) * 100;
              trendReasons.push({ label: '52주 위치', points: pos < 30 ? 8 : 0, detail: `${pos.toFixed(0)}% (저점 ${fmt(item.low_52w as number)} ~ 고점 ${fmt(item.high_52w as number)})`, met: pos < 30 });
            }

            const supplyReasons: ScoreReason[] = [
              { label: '외국인', points: foreignBuying ? 9 : 0, detail: foreignBuying ? `순매수 +${fmt(item.foreign_net_qty as number)}주` : (item.foreign_net_qty !== null ? `순매도 ${fmt(item.foreign_net_qty as number)}주` : '데이터 없음'), met: foreignBuying },
              { label: '기관', points: instBuying ? 9 : 0, detail: instBuying ? `순매수 +${fmt(item.institution_net_qty as number)}주` : (item.institution_net_qty !== null ? `순매도 ${fmt(item.institution_net_qty as number)}주` : '데이터 없음'), met: instBuying },
            ];
            if (item.foreign_streak) {
              const fs = item.foreign_streak as number;
              supplyReasons.push({ label: '외국인 연속', points: fs > 0 ? 5 : 0, detail: fs > 0 ? `${fs}일 연속 매수` : `${Math.abs(fs)}일 연속 매도`, met: fs > 0 });
            }
            if (item.institution_streak) {
              const is_ = item.institution_streak as number;
              supplyReasons.push({ label: '기관 연속', points: is_ > 0 ? 5 : 0, detail: is_ > 0 ? `${is_}일 연속 매수` : `${Math.abs(is_)}일 연속 매도`, met: is_ > 0 });
            }

            const valReasons: ScoreReason[] = [];
            if (item.forward_per) valReasons.push({ label: 'Forward PER', points: (item.forward_per as number) < 15 ? 8 : 0, detail: `${(item.forward_per as number).toFixed(1)}`, met: (item.forward_per as number) < 15 });
            else if (item.per) valReasons.push({ label: 'PER', points: (item.per as number) < 12 ? 8 : 0, detail: `${(item.per as number).toFixed(1)}`, met: (item.per as number) < 12 });
            if (item.roe) valReasons.push({ label: 'ROE', points: (item.roe as number) > 10 ? 6 : 0, detail: `${(item.roe as number).toFixed(1)}%`, met: (item.roe as number) > 10 });
            if (item.target_price && item.current_price && (item.current_price as number) > 0) {
              const upside = (((item.target_price as number) - (item.current_price as number)) / (item.current_price as number)) * 100;
              valReasons.push({ label: '목표주가', points: upside >= 15 ? 8 : 0, detail: `목표 ${fmt(item.target_price as number)} vs 현재 ${fmt(item.current_price as number)} (${upside >= 0 ? '+' : ''}${upside.toFixed(0)}%)`, met: upside >= 15 });
            }

            const sigReasons: ScoreReason[] = [];
            const sigCount = (item.signal_count_30d as number) ?? 0;
            sigReasons.push({ label: '30일 신호', points: sigCount >= 3 ? 10 : sigCount > 0 ? 5 : 0, detail: `최근 30일 ${sigCount}회`, met: sigCount > 0 });

            item.ai = {
              total_score: scores.score_total,
              signal_score: 0, trend_score: 0, valuation_score: 0, supply_score: 0,
              rsi: null,
              golden_cross: false, bollinger_bottom: false, phoenix_pattern: false,
              macd_cross: false, volume_surge: false, week52_low_near: false,
              double_top: false, disparity_rebound: false, volume_breakout: false,
              consecutive_drop_rebound: false, foreign_buying: foreignBuying,
              institution_buying: instBuying, volume_vs_sector: false, low_short_sell: false,
              trend_norm: scores.score_momentum,
              supply_norm: scores.score_supply,
              signal_norm: scores.score_signal,
              valuation_norm: scores.score_valuation,
              trend_reasons: trendReasons,
              supply_reasons: supplyReasons,
              valuation_reasons: valReasons,
              signal_reasons: sigReasons,
            };
          }
        }

        // 검색 필터 적용
        if (q) {
          snapshotItems = snapshotItems.filter((s) =>
            s.name?.toLowerCase().includes(q) || s.symbol?.toLowerCase().includes(q)
          );
        }
        // 마켓 필터 적용
        const filteredItems = market !== 'all'
          ? snapshotItems.filter((s) => s.market === market)
          : snapshotItems;

        // ETF 분리 — market='ETF'인 종목은 별도 스코어링 (모멘텀 60% + 수급 40%)
        const regularFiltered = filteredItems.filter(s => s.market !== 'ETF');
        const etfFiltered = filteredItems.filter(s => s.market === 'ETF');
        for (const item of etfFiltered) {
          item.score_total = Math.round(
            (item.score_momentum * 60 + item.score_supply * 40) / 100
          );
        }
        etfFiltered.sort((a, b) => b.score_total - a.score_total);

        const { data: status } = await supabase
          .from('snapshot_update_status')
          .select('updating, last_updated')
          .single();

        // 스냅샷이 30분 이상 오래되었으면 stale 표시
        const snapshotAge = snapshot.snapshot_time
          ? Date.now() - new Date(snapshot.snapshot_time).getTime()
          : Infinity;
        const isStale = snapshotAge > 30 * 60 * 1000;

        return NextResponse.json({
          items: regularFiltered,
          etf_items: etfFiltered,
          total: regularFiltered.length,
          etf_total: etfFiltered.length,
          page: 1,
          limit: 99999,
          today: todayStr,
          snapshot_time: snapshot.snapshot_time,
          updating: status?.updating ?? false,
          stale: isStale,
        }, {
          headers: { 'Cache-Control': 'public, s-maxage=30, stale-while-revalidate=60' },
        });
      }
    }

    // 이번주(월~오늘) 범위 계산
    const weekStart = (() => {
      const day = now.getUTCDay(); // UTC 기준 요일 (KST +9h 반영된 now)
      const kstDay = new Date(now.getTime() + 9 * 60 * 60 * 1000).getDay();
      const daysFromMonday = kstDay === 0 ? 6 : kstDay - 1;
      return new Date(now.getTime() + 9 * 60 * 60 * 1000 - daysFromMonday * 86400000)
        .toISOString().slice(0, 10);
    })();

    const dateStr = showAll || showWeek || showSignalAll ? todayStr : dateParam;

    // ── 날짜 지정 시: 해당 날짜/기간 BUY 신호 심볼 먼저 조회
    let dateSymbols: Set<string> | null = null;
    // 선택된 날짜의 실제 신호 날짜 (stock_cache.latest_signal_date 대체)
    const dateSignalMap = new Map<string, string>();
    if (!showAll && !showSignalAll) {
      const start = showWeek ? `${weekStart}T00:00:00+09:00` : kstDayRange(dateStr).start;
      const end = showWeek ? `${todayStr}T23:59:59+09:00` : kstDayRange(dateStr).end;
      const { data: sigRows } = await supabase
        .from('signals')
        .select('symbol, timestamp')
        .gte('timestamp', start)
        .lte('timestamp', end)
        .in('signal_type', ['BUY', 'BUY_FORECAST'])
        .order('timestamp', { ascending: false });
      if (sigRows && sigRows.length > 0) {
        dateSymbols = new Set<string>();
        for (const r of sigRows) {
          const sym = r.symbol as string;
          dateSymbols.add(sym);
          // 해당 날짜의 가장 최근 BUY 신호 시각 저장
          if (!dateSignalMap.has(sym)) {
            dateSignalMap.set(sym, r.timestamp as string);
          }
        }
      } else {
        // 해당 날짜/기간 신호 없음 → 빈 결과 반환
        return NextResponse.json({ items: [], total: 0, page, limit, today: todayStr });
      }
    }

    // ── stock_cache + ai_recommendations 병렬 조회
    const allRows: Record<string, unknown>[] = [];
    let from = 0;

    const aiSelect = 'symbol, total_score, signal_score, technical_score, valuation_score, supply_score, rsi, golden_cross, bollinger_bottom, phoenix_pattern, macd_cross, volume_surge, week52_low_near, double_top, disparity_rebound, volume_breakout, consecutive_drop_rebound, foreign_buying, institution_buying, volume_vs_sector, low_short_sell';
    const [, aiRecsResult, sectorResult, dartResult] = await Promise.all([
      (async () => {
        while (true) {
          let query = supabase
            .from('stock_cache')
            .select('symbol, name, market, current_price, price_change_pct, per, pbr, roe, foreign_net_qty, institution_net_qty, foreign_net_5d, institution_net_5d, foreign_streak, institution_streak, short_sell_ratio, short_sell_updated_at, investor_updated_at, signal_count_30d, latest_signal_type, latest_signal_date, latest_signal_price, high_52w, low_52w, dividend_yield, market_cap, forward_per, target_price, invest_opinion, float_shares, is_managed, volume')
            .not('current_price', 'is', null)
            .range(from, from + 999);
          if (market !== 'all') query = query.eq('market', market);
          const { data } = await query;
          if (!data || data.length === 0) break;
          allRows.push(...data);
          if (data.length < 1000) break;
          from += 1000;
        }
      })(),
      supabase
        .from('ai_recommendations')
        .select(aiSelect)
        .eq('date', todayStr),
      supabase
        .from('stock_info')
        .select('symbol, sector'),
      supabase
        .from('stock_dart_info')
        .select('*'),
    ]);

    const aiRecMap = new Map(
      (aiRecsResult.data ?? []).map((r) => [r.symbol as string, r])
    );
    const sectorMap = new Map(
      (sectorResult.data ?? []).map((r) => [r.symbol as string, r.sector as string | null])
    );

    // DART 데이터 맵 생성
    const dartMap = new Map<string, Record<string, unknown>>();
    if (dartResult.data) {
      for (const d of dartResult.data) {
        dartMap.set(d.symbol as string, d as Record<string, unknown>);
      }
    }

    // sector + DART 정보를 allRows에 병합
    for (const row of allRows) {
      row.sector = sectorMap.get(row.symbol as string) ?? null;

      // DART 데이터 병합 (리스크/수급/밸류에이션 스코어링용)
      const dart = dartMap.get(row.symbol as string) ?? {};
      row.is_managed = (row.is_managed as boolean) ?? false;
      const floatShares = row.float_shares as number | null;
      const volume = row.volume as number | null;
      row.turnover_rate = floatShares ? ((volume ?? 0) / floatShares) * 100 : null;
      row.has_recent_cbw = (dart.has_recent_cbw as boolean) ?? false;
      row.major_shareholder_pct = (dart.major_shareholder_pct as number) ?? null;
      row.major_shareholder_delta = (dart.major_shareholder_delta as number) ?? null;
      row.audit_opinion = (dart.audit_opinion as string) ?? null;
      row.has_treasury_buyback = (dart.has_treasury_buyback as boolean) ?? false;
      row.revenue_growth_yoy = (dart.revenue_growth_yoy as number) ?? null;
      row.operating_profit_growth_yoy = (dart.operating_profit_growth_yoy as number) ?? null;
    }

    // ── 신호 종목 중 수급 stale인 종목 live 보강 ──
    // 화면에 표시될 종목만 대상 (전 종목 X)
    const signalSymbols = allRows
      .filter((r) => {
        const sym = r.symbol as string;
        // 날짜 필터된 종목이거나 신호가 있는 종목
        const isRelevant = dateSymbols ? dateSymbols.has(sym) : ((r.signal_count_30d as number) ?? 0) > 0;
        if (!isRelevant) return false;
        const invDate = (r.investor_updated_at as string)?.slice(0, 10);
        return invDate !== todayStr; // stale인 것만
      })
      .map((r) => r.symbol as string);

    // 지표 null 종목: 검색 대상 + 신호 종목 중 지표 없는 것 보강
    const relevantForIndicators = new Set<string>([
      ...signalSymbols,
      // q 검색으로 직접 조회한 종목도 포함
      ...(q ? allRows.filter(r => (r.symbol as string).includes(q) || (r.name as string)?.toLowerCase().includes(q)).map(r => r.symbol as string) : []),
    ]);
    const indicatorNullSymbols = [...relevantForIndicators].filter((sym) => {
      const r = allRows.find((row) => row.symbol === sym);
      return r && (r.per === null || r.high_52w === null);
    });

    // q 검색 종목도 수급 fetch 대상에 추가
    const invFetchSymbols = [...new Set([
      ...signalSymbols,
      ...(q ? allRows.filter(r => {
        const sym = r.symbol as string;
        const name = (r.name as string)?.toLowerCase() ?? '';
        return (sym.includes(q) || name.includes(q)) && !(r.investor_updated_at as string)?.startsWith(todayStr);
      }).map(r => r.symbol as string) : []),
    ])];
    // 수급 + 지표 병렬 live 조회
    const [liveInvMap, liveIndMap] = await Promise.all([
      invFetchSymbols.length > 0
        ? (async () => {
            const m = new Map<string, StockInvestorData>();
            const chunks = [];
            for (let i = 0; i < invFetchSymbols.length; i += 200)
              chunks.push(invFetchSymbols.slice(i, i + 200));
            const results = await Promise.all(chunks.map(c => fetchBulkInvestorData(c, 20)));
            for (const r of results) for (const [k, v] of r) m.set(k, v);
            return m;
          })()
        : Promise.resolve(new Map<string, StockInvestorData>()),
      indicatorNullSymbols.length > 0
        ? fetchBulkIndicators(indicatorNullSymbols, 20)
        : Promise.resolve(new Map()),
    ]);

    // live 결과를 allRows에 반영
    for (const row of allRows) {
      const sym = row.symbol as string;
      const inv = liveInvMap.get(sym);
      if (inv) {
        row.foreign_net_qty = inv.foreign_net;
        row.institution_net_qty = inv.institution_net;
        row.foreign_net_5d = inv.foreign_net_5d;
        row.institution_net_5d = inv.institution_net_5d;
        row.foreign_streak = inv.foreign_streak;
        row.institution_streak = inv.institution_streak;
        row.investor_updated_at = todayStr;
      }
      const ind = liveIndMap.get(sym);
      if (ind) {
        if (ind.per !== null) row.per = ind.per;
        if (ind.pbr !== null) row.pbr = ind.pbr;
        if (ind.roe !== null) row.roe = ind.roe;
        if (ind.high_52w !== null) row.high_52w = ind.high_52w;
        if (ind.low_52w !== null) row.low_52w = ind.low_52w;
        if (ind.dividend_yield !== null) row.dividend_yield = ind.dividend_yield;
        if (ind.forward_per !== null) row.forward_per = ind.forward_per;
        if (ind.target_price !== null) row.target_price = ind.target_price;
        if (ind.invest_opinion !== null) row.invest_opinion = ind.invest_opinion;
      }
    }

    // live 결과를 stock_cache에도 비동기 저장 (다음 요청에서도 유효하도록)
    if (liveInvMap.size > 0 || liveIndMap.size > 0) {
      const cacheUpdates: Record<string, unknown>[] = [];
      for (const sym of new Set([...liveInvMap.keys(), ...liveIndMap.keys()])) {
        const update: Record<string, unknown> = { symbol: sym };
        const inv = liveInvMap.get(sym);
        if (inv) {
          update.foreign_net_qty = inv.foreign_net;
          update.institution_net_qty = inv.institution_net;
          update.foreign_net_5d = inv.foreign_net_5d;
          update.institution_net_5d = inv.institution_net_5d;
          update.foreign_streak = inv.foreign_streak;
          update.institution_streak = inv.institution_streak;
          update.investor_updated_at = new Date().toISOString();
        }
        const ind = liveIndMap.get(sym);
        if (ind) {
          if (ind.per !== null) update.per = ind.per;
          if (ind.pbr !== null) update.pbr = ind.pbr;
          if (ind.high_52w !== null) update.high_52w = ind.high_52w;
          if (ind.low_52w !== null) update.low_52w = ind.low_52w;
          if (ind.forward_per !== null) update.forward_per = ind.forward_per;
          if (ind.target_price !== null) update.target_price = ind.target_price;
          if (ind.invest_opinion !== null) update.invest_opinion = ind.invest_opinion;
        }
        cacheUpdates.push(update);
      }
      // 비동기 — 응답 차단하지 않음
      Promise.resolve(supabase.from('stock_cache').upsert(cacheUpdates, { onConflict: 'symbol' }))
        .catch((e: unknown) => console.error('[stock-ranking] cache upsert error:', e));
    }

    // ── 섹터별 평균 등락률 집계 (인메모리, 추가 쿼리 없음) ──
    const sectorPctMap = new Map<string, number[]>();
    for (const r of allRows) {
      const sec = sectorMap.get(r.symbol as string);
      const pct = r.price_change_pct as number | null;
      if (sec && pct !== null) {
        if (!sectorPctMap.has(sec)) sectorPctMap.set(sec, []);
        sectorPctMap.get(sec)!.push(pct);
      }
    }
    const sectorAvgPctMap = new Map<string, number>();
    for (const [sec, pcts] of sectorPctMap) {
      sectorAvgPctMap.set(sec, pcts.reduce((a, b) => a + b, 0) / pcts.length);
    }

    // ── 점수 계산 + ai 병합 (날짜 필터는 스코어링 후 적용)
    const allScored: StockRankItem[] = allRows
      .filter((r) => r.symbol && r.name)
      .map((r) => {
        const base = r as Omit<StockRankItem, 'score_total' | 'score_valuation' | 'score_supply' | 'score_signal' | 'score_momentum' | 'ai'>;
        const dateSig = dateSignalMap.get(base.symbol);
        if (dateSig) {
          base.latest_signal_date = dateSig;
          base.latest_signal_type = 'BUY';
        }
        const sector = sectorMap.get(base.symbol) ?? null;
        const sectorAvgPct = sector ? (sectorAvgPctMap.get(sector) ?? null) : null;
        const scores = calcScore(base, todayStr, sectorAvgPct, model);
        const aiRec = aiRecMap.get(base.symbol);
        const item: StockRankItem = {
          ...base,
          ...scores,
          volume_ratio: null,
          close_position: null,
          trading_value: null,
          gap_pct: null,
          cum_return_3d: null,
        };
        if (aiRec) {
          // AI 추천 데이터는 패턴 정보만 보존 (점수는 calcScore 결과 사용)
          const rsiVal = aiRec.rsi as number | null;
          // boolean 플래그 기반 추세 근거 생성
          const trendReasons: ScoreReason[] = [];
          const pushTrend = (met: boolean, label: string, detailMet: string, detailNot: string) =>
            trendReasons.push({ label, points: met ? 8 : 0, detail: met ? detailMet : detailNot, met });
          pushTrend(!!aiRec.golden_cross, '골든크로스', '5일선 > 20일선 상향돌파', '미발생');
          pushTrend(!!aiRec.macd_cross, 'MACD 크로스', 'MACD > Signal 상향돌파', '미발생');
          pushTrend(!!aiRec.bollinger_bottom, '볼린저 하단', '볼린저 하단 이탈 후 복귀', '미이탈');
          pushTrend(!!aiRec.phoenix_pattern, '불새패턴', '음봉 후 장대양봉 반등', '미발생');
          pushTrend(!!aiRec.volume_surge, '거래량 급증', '20일 평균 대비 2배+ 거래량', '평균 범위');
          pushTrend(!!aiRec.disparity_rebound, '이격도 반등', '20일선 저이격 + 양봉', '미발생');
          pushTrend(!!aiRec.volume_breakout, '거래량 바닥 탈출', '거래량 바닥에서 급증', '미발생');
          pushTrend(!!aiRec.consecutive_drop_rebound, '연속하락 반등', '연속 하락 후 반등', '미발생');
          if (rsiVal !== null) {
            const inZone = rsiVal >= 30 && rsiVal <= 50;
            trendReasons.push({ label: 'RSI', points: inZone ? 6 : 0, detail: `RSI ${rsiVal.toFixed(1)} ${inZone ? '(매수구간)' : ''}`, met: inZone });
          }

          // 수급 근거
          const supplyReasons: ScoreReason[] = [];
          supplyReasons.push({ label: '외국인', points: aiRec.foreign_buying ? 9 : 0, detail: aiRec.foreign_buying ? '외국인 순매수' : '순매도 또는 데이터 없음', met: !!aiRec.foreign_buying });
          supplyReasons.push({ label: '기관', points: aiRec.institution_buying ? 9 : 0, detail: aiRec.institution_buying ? '기관 순매수' : '순매도 또는 데이터 없음', met: !!aiRec.institution_buying });
          supplyReasons.push({ label: '섹터 거래대금', points: aiRec.volume_vs_sector ? 4 : 0, detail: aiRec.volume_vs_sector ? '섹터 평균 대비 2배+ 거래대금' : '평균 범위', met: !!aiRec.volume_vs_sector });
          supplyReasons.push({ label: '공매도', points: aiRec.low_short_sell ? 2 : 0, detail: aiRec.low_short_sell ? '공매도 비율 1% 미만' : '공매도 비율 1% 이상 또는 데이터 없음', met: !!aiRec.low_short_sell });

          // 정규화 점수 (원점수 → 0~100)
          const trendNorm = Math.round(Math.min(100, Math.max(0, ((aiRec.technical_score ?? 0) / 65) * 100)) * 10) / 10;
          const supplyNorm = Math.round(Math.min(100, Math.max(0, (((aiRec.supply_score ?? 0) + 10) / 55) * 100)) * 10) / 10;
          const signalNorm = Math.round(Math.min(100, Math.max(0, ((aiRec.signal_score ?? 0) / 30) * 100)) * 10) / 10;
          const valuationNorm = Math.round(Math.min(100, Math.max(0, ((aiRec.valuation_score ?? 0) / 25) * 100)) * 10) / 10;

          item.ai = {
            total_score: aiRec.total_score ?? 0,
            signal_score: aiRec.signal_score ?? 0,
            trend_score: aiRec.technical_score ?? 0,
            valuation_score: aiRec.valuation_score ?? 0,
            supply_score: aiRec.supply_score ?? 0,
            rsi: rsiVal,
            golden_cross: aiRec.golden_cross ?? false,
            bollinger_bottom: aiRec.bollinger_bottom ?? false,
            phoenix_pattern: aiRec.phoenix_pattern ?? false,
            macd_cross: aiRec.macd_cross ?? false,
            volume_surge: aiRec.volume_surge ?? false,
            week52_low_near: aiRec.week52_low_near ?? false,
            double_top: aiRec.double_top ?? false,
            disparity_rebound: aiRec.disparity_rebound ?? false,
            volume_breakout: aiRec.volume_breakout ?? false,
            consecutive_drop_rebound: aiRec.consecutive_drop_rebound ?? false,
            foreign_buying: aiRec.foreign_buying ?? false,
            institution_buying: aiRec.institution_buying ?? false,
            volume_vs_sector: aiRec.volume_vs_sector ?? false,
            low_short_sell: aiRec.low_short_sell ?? false,
            trend_norm: trendNorm,
            supply_norm: supplyNorm,
            signal_norm: signalNorm,
            valuation_norm: valuationNorm,
            trend_reasons: trendReasons,
            supply_reasons: supplyReasons,
          };
        } else {
          // AI 추천 없는 종목: calcScore 결과 기반 요약 근거 생성
          const fmt = (n: number | null) => n !== null ? Math.round(n).toLocaleString('ko-KR') : '-';
          const foreignBuying = base.foreign_net_qty !== null && base.foreign_net_qty > 0;
          const instBuying = base.institution_net_qty !== null && base.institution_net_qty > 0;

          const trendReasons: ScoreReason[] = [];
          const pct = base.price_change_pct ?? 0;
          trendReasons.push({ label: '등락률', points: pct > 0 ? 10 : 0, detail: `${pct >= 0 ? '+' : ''}${pct.toFixed(1)}%`, met: pct > 0 });
          if (base.high_52w && base.low_52w && base.current_price) {
            const pos = ((base.current_price - base.low_52w) / (base.high_52w - base.low_52w)) * 100;
            trendReasons.push({ label: '52주 위치', points: pos < 30 ? 8 : 0, detail: `${pos.toFixed(0)}% (저점 ${fmt(base.low_52w)} ~ 고점 ${fmt(base.high_52w)})`, met: pos < 30 });
          }

          const supplyReasons: ScoreReason[] = [];
          supplyReasons.push({ label: '외국인', points: foreignBuying ? 9 : 0, detail: foreignBuying ? `순매수 +${fmt(base.foreign_net_qty)}주` : (base.foreign_net_qty !== null ? `순매도 ${fmt(base.foreign_net_qty)}주` : '데이터 없음'), met: foreignBuying });
          supplyReasons.push({ label: '기관', points: instBuying ? 9 : 0, detail: instBuying ? `순매수 +${fmt(base.institution_net_qty)}주` : (base.institution_net_qty !== null ? `순매도 ${fmt(base.institution_net_qty)}주` : '데이터 없음'), met: instBuying });
          if (base.foreign_streak) {
            const fs = base.foreign_streak;
            supplyReasons.push({ label: '외국인 연속', points: fs > 0 ? 5 : 0, detail: fs > 0 ? `${fs}일 연속 매수` : `${Math.abs(fs)}일 연속 매도`, met: fs > 0 });
          }
          if (base.institution_streak) {
            const is_ = base.institution_streak;
            supplyReasons.push({ label: '기관 연속', points: is_ > 0 ? 5 : 0, detail: is_ > 0 ? `${is_}일 연속 매수` : `${Math.abs(is_)}일 연속 매도`, met: is_ > 0 });
          }

          const valReasons: ScoreReason[] = [];
          if (base.forward_per) valReasons.push({ label: 'Forward PER', points: base.forward_per < 15 ? 8 : 0, detail: `${base.forward_per.toFixed(1)}`, met: base.forward_per < 15 });
          else if (base.per) valReasons.push({ label: 'PER', points: base.per < 12 ? 8 : 0, detail: `${base.per.toFixed(1)}`, met: base.per < 12 });
          if (base.pbr) valReasons.push({ label: 'PBR', points: base.pbr < 1 ? 6 : 0, detail: `${base.pbr.toFixed(2)}`, met: base.pbr < 1 });
          if (base.roe) valReasons.push({ label: 'ROE', points: base.roe > 10 ? 6 : 0, detail: `${base.roe.toFixed(1)}%`, met: base.roe > 10 });
          if (base.target_price && base.current_price && base.current_price > 0) {
            const upside = ((base.target_price - base.current_price) / base.current_price) * 100;
            valReasons.push({ label: '목표주가', points: upside >= 15 ? 8 : 0, detail: `목표 ${fmt(base.target_price)} vs 현재 ${fmt(base.current_price)} (${upside >= 0 ? '+' : ''}${upside.toFixed(0)}%)`, met: upside >= 15 });
          }

          const sigReasons: ScoreReason[] = [];
          const sigCount = base.signal_count_30d ?? 0;
          sigReasons.push({ label: '30일 신호', points: sigCount >= 3 ? 10 : sigCount > 0 ? 5 : 0, detail: `최근 30일 ${sigCount}회`, met: sigCount > 0 });

          item.ai = {
            total_score: scores.score_total,
            signal_score: 0, trend_score: 0, valuation_score: 0, supply_score: 0,
            rsi: null,
            golden_cross: false, bollinger_bottom: false, phoenix_pattern: false,
            macd_cross: false, volume_surge: false, week52_low_near: false,
            double_top: false, disparity_rebound: false, volume_breakout: false,
            consecutive_drop_rebound: false, foreign_buying: foreignBuying,
            institution_buying: instBuying, volume_vs_sector: false, low_short_sell: false,
            trend_norm: scores.score_momentum,
            supply_norm: scores.score_supply,
            signal_norm: scores.score_signal,
            valuation_norm: scores.score_valuation,
            trend_reasons: trendReasons,
            supply_reasons: supplyReasons,
            valuation_reasons: valReasons,
            signal_reasons: sigReasons,
          };
        }
        return item;
      });

    // ── signal_count_30d 실시간 보강 (stock_cache 값이 stale할 수 있음) ──
    if (showSignalAll) {
      const thirtyDaysAgo = new Date(new Date().getTime() + 9 * 60 * 60 * 1000 - 30 * 86400000)
        .toISOString().slice(0, 10);
      const { data: sigData } = await supabase
        .from('signals')
        .select('symbol, timestamp')
        .in('signal_type', ['BUY', 'BUY_FORECAST'])
        .gte('timestamp', `${thirtyDaysAgo}T00:00:00+09:00`)
        .order('timestamp', { ascending: false })
        .limit(5000);
      const liveSignalSymbols = new Set<string>();
      if (sigData) {
        for (const row of sigData) {
          liveSignalSymbols.add(row.symbol as string);
        }
      }
      // stock_cache의 stale signal_count_30d를 보정
      for (const item of allScored) {
        if (!liveSignalSymbols.has(item.symbol)) {
          item.signal_count_30d = 0;
        }
      }
    }

    // ── 날짜 필터 적용 (스냅샷 저장용 allScored와 분리) ──
    const scored = allScored.filter((item) => {
      if (dateSymbols) return dateSymbols.has(item.symbol);
      if (showSignalAll) return (item.signal_count_30d ?? 0) > 0;
      return true;
    });

    // ── 초단기 모멘텀용 daily_prices 조회 ──
    const displaySymbols = scored.map(s => s.symbol);
    if (displaySymbols.length > 0) {
      type DailyPrice = { date: string; open: number | null; high: number; low: number; close: number; volume: number };
      const dpResults: Record<string, unknown>[] = [];
      for (let i = 0; i < displaySymbols.length; i += 300) {
        const chunk = displaySymbols.slice(i, i + 300);
        const { data } = await supabase
          .from('daily_prices')
          .select('symbol, date, open, high, low, close, volume')
          .in('symbol', chunk)
          .order('date', { ascending: false })
          .limit(chunk.length * 22);
        if (data) dpResults.push(...data);
      }

      // symbol별 그룹핑 (날짜 내림차순 유지)
      const dpMap = new Map<string, DailyPrice[]>();
      for (const p of dpResults) {
        const sym = p.symbol as string;
        if (!dpMap.has(sym)) dpMap.set(sym, []);
        dpMap.get(sym)!.push({
          date: p.date as string,
          open: p.open as number | null,
          high: p.high as number,
          low: p.low as number,
          close: p.close as number,
          volume: p.volume as number,
        });
      }

      // 각 scored item에 초단기 필드 계산
      for (const item of scored) {
        const prices = dpMap.get(item.symbol);
        if (!prices || prices.length === 0) continue;

        const today = prices[0];
        const yesterday = prices.length > 1 ? prices[1] : null;
        // 3일전 = prices[3] (today, -1d, -2d, -3d)
        const threeDaysAgo = prices.length > 3 ? prices[3] : null;

        // volume_ratio: 당일거래량 / 20일평균거래량
        const volSlice = prices.slice(1, 21); // 전일~20일전
        const avgVol = volSlice.length > 0
          ? volSlice.reduce((sum, p) => sum + p.volume, 0) / volSlice.length
          : 0;
        item.volume_ratio = avgVol > 0
          ? Math.round((today.volume / avgVol) * 100) / 100
          : null;

        // close_position: (종가-저가)/(고가-저가)
        item.close_position = today.high === today.low
          ? 1.0
          : Math.round(((today.close - today.low) / (today.high - today.low)) * 100) / 100;

        // trading_value: 거래대금
        item.trading_value = today.volume * today.close;

        // gap_pct: 갭 비율
        item.gap_pct = today.open != null && yesterday
          ? Math.round(((today.open - yesterday.close) / yesterday.close) * 10000) / 100
          : null;

        // cum_return_3d: 3일 누적 수익률
        item.cum_return_3d = threeDaysAgo && threeDaysAgo.close > 0
          ? Math.round(((today.close - threeDaysAgo.close) / threeDaysAgo.close) * 10000) / 100
          : null;

        // current_price를 daily_prices 기준으로 동기화
        // (stock_cache.current_price가 stale할 수 있으므로 daily_prices 종가로 보정)
        item.current_price = today.close;
        if (yesterday) {
          item.price_change_pct = Math.round(((today.close - yesterday.close) / yesterday.close) * 10000) / 100;
        }
      }

      // ── 장중 daily_prices live 보강 (오늘 데이터 없는 종목) ──
      const dpStaleSymbols = scored
        .filter(item => {
          const prices = dpMap.get(item.symbol);
          if (!prices || prices.length === 0) return true;
          return prices[0].date !== todayStr;
        })
        .filter(item => {
          // 신호 있는 종목만 (전체 2000+종목 다 fetch하면 안 됨)
          return (item.signal_count_30d ?? 0) > 0 || dateSymbols?.has(item.symbol);
        })
        .map(item => item.symbol);

      if (dpStaleSymbols.length > 0) {
        const liveDpMap = await fetchBulkDailyPrices(dpStaleSymbols, 10, 22);

        // scored items 업데이트
        for (const item of scored) {
          const livePrices = liveDpMap.get(item.symbol);
          if (!livePrices || livePrices.length === 0) continue;

          const liveToday = livePrices[0];
          const liveYesterday = livePrices.length > 1 ? livePrices[1] : null;
          const liveThreeDaysAgo = livePrices.length > 3 ? livePrices[3] : null;

          // volume_ratio
          const volSliceLive = livePrices.slice(1, 21);
          const avgVolLive = volSliceLive.length > 0
            ? volSliceLive.reduce((sum, p) => sum + p.volume, 0) / volSliceLive.length
            : 0;
          item.volume_ratio = avgVolLive > 0
            ? Math.round((liveToday.volume / avgVolLive) * 100) / 100
            : null;

          // close_position
          item.close_position = liveToday.high === liveToday.low
            ? 1.0
            : Math.round(((liveToday.close - liveToday.low) / (liveToday.high - liveToday.low)) * 100) / 100;

          // trading_value
          item.trading_value = liveToday.volume * liveToday.close;

          // gap_pct
          item.gap_pct = liveToday.open && liveYesterday
            ? Math.round(((liveToday.open - liveYesterday.close) / liveYesterday.close) * 10000) / 100
            : null;

          // cum_return_3d
          item.cum_return_3d = liveThreeDaysAgo && liveThreeDaysAgo.close > 0
            ? Math.round(((liveToday.close - liveThreeDaysAgo.close) / liveThreeDaysAgo.close) * 10000) / 100
            : null;

          // price_change_pct도 갱신 (장중 최신 반영)
          if (liveYesterday) {
            item.price_change_pct = Math.round(((liveToday.close - liveYesterday.close) / liveYesterday.close) * 10000) / 100;
          }
          // current_price도 갱신
          item.current_price = liveToday.close;
        }

        // daily_prices에 비동기 upsert (다음 요청에서 DB에서 직접 읽힘)
        const dpUpserts: Array<{symbol: string; date: string; open: number; high: number; low: number; close: number; volume: number}> = [];
        for (const [sym, prices] of liveDpMap) {
          const todayPrice = prices[0];
          if (todayPrice && todayPrice.date === todayStr) {
            dpUpserts.push({
              symbol: sym,
              date: todayPrice.date,
              open: todayPrice.open,
              high: todayPrice.high,
              low: todayPrice.low,
              close: todayPrice.close,
              volume: todayPrice.volume,
            });
          }
        }
        if (dpUpserts.length > 0) {
          Promise.resolve(
            supabase.from('daily_prices').upsert(dpUpserts, { onConflict: 'symbol,date' })
          ).catch((e: unknown) => console.error('[stock-ranking] daily_prices upsert error:', e));
        }

        // stock_cache의 price_change_pct, current_price도 갱신
        const cacheUpdatesForPct: Array<{symbol: string; price_change_pct: number; current_price: number}> = [];
        for (const [sym, prices] of liveDpMap) {
          const lpToday = prices[0];
          const lpYesterday = prices.length > 1 ? prices[1] : null;
          if (lpToday && lpYesterday) {
            cacheUpdatesForPct.push({
              symbol: sym,
              price_change_pct: Math.round(((lpToday.close - lpYesterday.close) / lpYesterday.close) * 10000) / 100,
              current_price: lpToday.close,
            });
          }
        }
        if (cacheUpdatesForPct.length > 0) {
          Promise.resolve(
            supabase.from('stock_cache').upsert(cacheUpdatesForPct, { onConflict: 'symbol' })
          ).catch((e: unknown) => console.error('[stock-ranking] cache pct upsert error:', e));
        }
      }
    }

    // ── 검색 필터
    const filtered = q
      ? scored.filter((s) => s.name?.toLowerCase().includes(q) || s.symbol?.toLowerCase().includes(q))
      : scored;

    // ── ETF 분리 — market='ETF'인 종목은 모멘텀(60%) + 수급(40%)으로 재계산 ──
    const regularItems: StockRankItem[] = [];
    const etfItems: StockRankItem[] = [];
    for (const item of filtered) {
      if (item.market === 'ETF') {
        const etfTotal = Math.round(
          (item.score_momentum * 60 + item.score_supply * 40) / 100
        );
        etfItems.push({ ...item, score_total: etfTotal });
      } else {
        regularItems.push(item);
      }
    }

    // ── 정렬: score_total 내림차순
    regularItems.sort((a, b) => b.score_total - a.score_total);
    etfItems.sort((a, b) => b.score_total - a.score_total);

    const total = regularItems.length;
    const offset = (page - 1) * limit;
    const items = regularItems.slice(offset, offset + limit);

    // ── 스냅샷 저장 (snapshot=true 파라미터 시에만 — daily-prices 크론에서 호출) ──
    if (saveSnapshot) {
      void (async () => {
        try {
          const triggerType = searchParams.get('trigger_type') || 'cron';
          const now = new Date().toISOString();

          // 1. 세션 생성
          const { data: session, error: sessionError } = await supabase
            .from('snapshot_sessions')
            .insert({
              session_date: todayStr,
              session_time: now,
              model: model || 'standard',
              trigger_type: triggerType,
              total_count: allScored.length,
            })
            .select('id')
            .single();

          if (sessionError || !session) {
            console.error('세션 생성 실패:', sessionError);
            return;
          }

          // 2. stock_cache에서 최신 가격 읽기 (스냅샷 정확성 보장)
          const priceMap = new Map<string, number>();
          const allSymbols = allScored.map((item: StockRankItem) => item.symbol);
          for (let i = 0; i < allSymbols.length; i += 1000) {
            const chunk = allSymbols.slice(i, i + 1000);
            const { data: priceRows } = await supabase
              .from('stock_cache')
              .select('symbol, current_price')
              .in('symbol', chunk);
            if (priceRows) {
              for (const row of priceRows) {
                if (row.current_price) priceMap.set(row.symbol, row.current_price);
              }
            }
          }

          // 3. 스냅샷 행 저장 (session_id 포함, stock_cache 최신 가격 적용)
          const snapshotRows = allScored.map((item: StockRankItem) => ({
            snapshot_date: todayStr,
            snapshot_time: now,
            model: model || 'standard',
            session_id: session.id,
            symbol: item.symbol,
            name: item.name,
            market: item.market,
            current_price: priceMap.get(item.symbol) ?? item.current_price,
            market_cap: item.market_cap,
            daily_trading_value: item.trading_value ?? null,
            avg_trading_value_20d: item.avg_trading_value_20d ?? null,
            turnover_rate: item.turnover_rate ?? null,
            is_managed: item.is_managed ?? false,
            has_recent_cbw: item.has_recent_cbw ?? false,
            major_shareholder_pct: item.major_shareholder_pct ?? null,
            score_total: item.score_total,
            score_signal: item.score_signal,
            score_trend: item.score_momentum,
            score_valuation: item.score_valuation,
            score_supply: item.score_supply,
            score_risk: item.score_risk ?? 0,
            score_momentum: item.score_momentum,
            score_catalyst: item.score_catalyst ?? 0,
            grade: item.grade ?? null,
            characters: item.characters ?? null,
            recommendation: item.recommendation ?? null,
            signal_date: item.latest_signal_date ?? null,
            raw_data: item,
          }));

          for (let i = 0; i < snapshotRows.length; i += 500) {
            await supabase
              .from('stock_ranking_snapshot')
              .upsert(snapshotRows.slice(i, i + 500), {
                onConflict: 'session_id,symbol',
                ignoreDuplicates: false,
              });
          }
        } catch (e) {
          console.error('스냅샷 저장 실패:', e);
        }
      })();
    }

    return NextResponse.json({
      items, total, page, limit, today: todayStr,
      etf_items: etfItems, etf_total: etfItems.length,
    }, {
      headers: { 'Cache-Control': 'public, s-maxage=30, stale-while-revalidate=60' },
    });
  } catch (e) {
    console.error('[stock-ranking]', e);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
