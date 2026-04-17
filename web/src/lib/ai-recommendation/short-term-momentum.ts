/**
 * 초단기 모멘텀 추천 오케스트레이터
 *
 * BUY 신호 종목을 대상으로 5가지 스코어(모멘텀, 수급, 촉매, 밸류에이션, 리스크)를
 * 가중 합산하여 초단기 매매 후보를 선별한다.
 *
 * 데이터 흐름:
 *   1. 오늘 BUY 신호 종목 가져오기
 *   2. 병렬 데이터 조회 (stock_cache, daily_prices, signals)
 *   3. 섹터 통계 사전 집계
 *   4. 종목별: 파생값 계산 → 프리필터 → 5 스코어 → 가중합 → 등급/배지
 *   5. 정렬 후 상위 limit개 반환
 */

import { SupabaseClient } from '@supabase/supabase-js';
import {
  ShortTermWeights,
  DEFAULT_SHORT_TERM_WEIGHTS,
  ShortTermScoreBreakdown,
} from '@/types/ai-recommendation';
import { getTodayKst, fetchTodayBuySymbols } from './index';
import { applyPreFilter, PreFilterInput } from './short-term/pre-filter';
import { calcMomentumScore, MomentumInput } from './short-term/momentum-score';
import { calcShortTermSupplyScore, ShortTermSupplyInput } from './short-term/supply-score';
import { calcCatalystScore, CatalystInput } from './short-term/catalyst-score';
import { calcShortTermValuationScore, ShortTermValuationInput } from './short-term/valuation-score';
import { calcRiskPenalty, RiskInput } from './short-term/risk-penalty';
import { extractSignalPrice } from '@/lib/signal-constants';

// ---------------------------------------------------------------------------
// 반환 타입
// ---------------------------------------------------------------------------

export interface ShortTermRecommendation {
  symbol: string;
  name: string | null;
  market: string | null;
  rank: number;
  totalScore: number;
  grade: string;
  gradeLabel: string;
  breakdown: ShortTermScoreBreakdown;
}

// ---------------------------------------------------------------------------
// 헬퍼: 등급 판정
// ---------------------------------------------------------------------------

/**
 * 총점 기반 등급을 반환한다.
 *
 * 임계값 근거:
 *   - 프리필터 통과 종목의 실제 점수 분포: 30~85 (중앙값 약 45)
 *   - 데이터 미수신(장중) 구간의 구조적 감점 고려
 *   - A+ (78+): 모멘텀·수급·촉매 모두 최상위권 (상위 ~5%)
 *   - A  (65+): 주요 지표 양호, 리스크 낮음 (상위 ~15%)
 *   - B+ (52+): 평균 이상 (상위 ~35%)
 *   - B  (40+): 프리필터 통과 평균 수준 (상위 ~60%)
 *   - C  (28+): 조건 일부 부족 (관망)
 *   - D  (28미만): 여러 조건 미충족
 */
function assignGrade(score: number): { grade: string; label: string } {
  if (score >= 78) return { grade: 'A+', label: '적극매수' };
  if (score >= 65) return { grade: 'A', label: '매수' };
  if (score >= 52) return { grade: 'B+', label: '관심' };
  if (score >= 40) return { grade: 'B', label: '보통' };
  if (score >= 28) return { grade: 'C', label: '관망' };
  return { grade: 'D', label: '주의' };
}

// ---------------------------------------------------------------------------
// 헬퍼: 배지 생성
// ---------------------------------------------------------------------------

interface BadgeInput {
  volumeRatio: number;
  sectorRank: number | null;
  institutionNet: number | null;
  foreignNet: number | null;
  signalPriceGapPct: number | null;
}

/** 조건에 따라 배지 목록을 반환한다. */
function generateBadges(input: BadgeInput): string[] {
  const badges: string[] = [];

  if (input.volumeRatio >= 2) badges.push('🔥 거래량 폭발');
  if (input.sectorRank !== null && input.sectorRank <= 3) badges.push('📈 섹터 강세');

  const foreignBuy = (input.foreignNet ?? 0) > 0;
  const institutionBuy = (input.institutionNet ?? 0) > 0;

  if (institutionBuy) badges.push('🏛️ 기관 매수');
  if (foreignBuy) badges.push('🌍 외국인 매수');
  if (foreignBuy && institutionBuy) badges.push('⚡ 동반 매수');
  if (input.signalPriceGapPct !== null && input.signalPriceGapPct >= 7) {
    badges.push('⚠️ 추격 주의');
  }

  return badges;
}

// ---------------------------------------------------------------------------
// 헬퍼: 날짜 차이 계산 (일 단위)
// ---------------------------------------------------------------------------

/** YYYY-MM-DD 문자열 간 날짜 차이(일)를 반환한다. */
function daysDiff(todayStr: string, signalTime: string | null): number {
  if (!signalTime) return 999;
  const today = new Date(todayStr);
  const signalDate = new Date(signalTime.slice(0, 10));
  const diffMs = today.getTime() - signalDate.getTime();
  return Math.max(0, Math.floor(diffMs / (24 * 60 * 60 * 1000)));
}

// ---------------------------------------------------------------------------
// 헬퍼: 섹터 통계 집계
// ---------------------------------------------------------------------------

interface SectorStat {
  avgChangePct: number;
  rank: number;
  stockCount: number;
  /** 종목별 섹터 내 등락률 순위 (symbol -> rank) */
  stockRanks: Map<string, number>;
}

/**
 * 섹터별 평균 등락률, 등락률 순위, 종목 수, 종목별 섹터 내 순위를 계산한다.
 */
function aggregateSectorStats(
  sectorStocks: Array<{ symbol: string; sector: string | null; price_change_pct: number | null }>,
): Map<string, SectorStat> {
  // 섹터별 그룹핑
  const grouped = new Map<string, Array<{ symbol: string; changePct: number }>>();
  for (const s of sectorStocks) {
    if (!s.sector || s.price_change_pct === null) continue;
    if (!grouped.has(s.sector)) grouped.set(s.sector, []);
    grouped.get(s.sector)!.push({ symbol: s.symbol, changePct: s.price_change_pct });
  }

  // 섹터별 평균 등락률 계산
  const sectorAvgs: Array<{ sector: string; avgChangePct: number }> = [];
  for (const [sector, stocks] of grouped) {
    const avg = stocks.reduce((sum, s) => sum + s.changePct, 0) / stocks.length;
    sectorAvgs.push({ sector, avgChangePct: avg });
  }

  // 섹터를 평균 등락률 내림차순으로 정렬 후 순위 부여
  sectorAvgs.sort((a, b) => b.avgChangePct - a.avgChangePct);

  const result = new Map<string, SectorStat>();
  sectorAvgs.forEach((item, idx) => {
    const stocks = grouped.get(item.sector)!;
    // 섹터 내 종목을 등락률 내림차순으로 정렬 후 순위 부여
    const sorted = [...stocks].sort((a, b) => b.changePct - a.changePct);
    const stockRanks = new Map<string, number>();
    sorted.forEach((s, i) => stockRanks.set(s.symbol, i + 1));

    result.set(item.sector, {
      avgChangePct: item.avgChangePct,
      rank: idx + 1,
      stockCount: stocks.length,
      stockRanks,
    });
  });

  return result;
}

// ---------------------------------------------------------------------------
// 메인 오케스트레이터
// ---------------------------------------------------------------------------

/**
 * 초단기 모멘텀 추천을 생성한다.
 *
 * @param supabase - Supabase 클라이언트
 * @param weights - 가중치 (기본값: DEFAULT_SHORT_TERM_WEIGHTS)
 * @param limit - 최대 반환 종목 수 (기본값: 30)
 * @returns 추천 목록, 후보 수, 필터 탈락 목록
 */
export async function generateShortTermRecommendations(
  supabase: SupabaseClient,
  weights: ShortTermWeights = DEFAULT_SHORT_TERM_WEIGHTS,
  limit = 30,
): Promise<{
  recommendations: ShortTermRecommendation[];
  total_candidates: number;
  filtered_out: Array<{ symbol: string; name: string | null; reasons: string[] }>;
}> {
  const todayKst = getTodayKst();
  const candidates = await fetchTodayBuySymbols(supabase, todayKst);
  const total_candidates = candidates.length;

  if (total_candidates === 0) {
    return { recommendations: [], total_candidates: 0, filtered_out: [] };
  }

  const symbols = candidates.map((c) => c.symbol);
  const threeDaysAgoDate = new Date(
    new Date().getTime() + 9 * 60 * 60 * 1000 - 3 * 24 * 60 * 60 * 1000,
  );
  const threeDaysAgoStr = threeDaysAgoDate.toISOString().slice(0, 10);

  // daily_prices 조회용: 21거래일 ≈ 30 캘린더일 전 날짜 (종목별 limit 보장을 위해 날짜 필터 사용)
  const thirtyDaysAgoDate = new Date(
    new Date().getTime() + 9 * 60 * 60 * 1000 - 30 * 24 * 60 * 60 * 1000,
  );
  const thirtyDaysAgoStr = thirtyDaysAgoDate.toISOString().slice(0, 10);

  // -----------------------------------------------------------------------
  // 1. 병렬 데이터 조회 (Promise.allSettled으로 장애 내성 확보)
  // -----------------------------------------------------------------------
  const [cacheResult, priceResult, signalResult, sectorResult] = await Promise.allSettled([
    // stock_cache: 종목별 기본 정보 (volume 포함 — 장중 todayVolume 보완용)
    supabase
      .from('stock_cache')
      .select(
        'symbol, name, market, sector, current_price, price_change_pct, volume, ' +
        'foreign_net_qty, institution_net_qty, foreign_streak, institution_streak, ' +
        'forward_per, target_price, invest_opinion, per, pbr, roe, dividend_yield, ' +
        'high_52w, low_52w, market_cap',
      )
      .in('symbol', symbols),

    // daily_prices: 최근 30일 (날짜 필터 + 명시적 limit으로 Supabase 1000행 한도 우회)
    supabase
      .from('daily_prices')
      .select('symbol, date, open, high, low, close, volume')
      .in('symbol', symbols)
      .gte('date', thirtyDaysAgoStr)
      .order('date', { ascending: false })
      .limit(Math.max(symbols.length * 30, 3000)),

    // signals: 최근 3일 내 BUY 신호
    supabase
      .from('signals')
      .select('symbol, source, signal_type, timestamp, raw_data')
      .in('symbol', symbols)
      .gte('timestamp', `${threeDaysAgoStr}T00:00:00+09:00`),

    // 섹터 통계용: 후보 종목의 섹터에 해당하는 전체 종목 등락률
    // (후보 종목의 섹터를 먼저 알 수 없으므로, stock_cache 전체에서 조회)
    supabase
      .from('stock_cache')
      .select('symbol, sector, price_change_pct')
      .not('price_change_pct', 'is', null),
  ]);

  // 조회 결과 추출 (실패 시 빈 배열로 폴백)
  const cacheData =
    cacheResult.status === 'fulfilled' ? (cacheResult.value.data ?? []) : [];
  const priceData =
    priceResult.status === 'fulfilled' ? (priceResult.value.data ?? []) : [];
  const signalData =
    signalResult.status === 'fulfilled' ? (signalResult.value.data ?? []) : [];
  const sectorStocksData =
    sectorResult.status === 'fulfilled' ? (sectorResult.value.data ?? []) : [];

  // -----------------------------------------------------------------------
  // 2. 데이터를 symbol 기준 Map으로 변환
  // -----------------------------------------------------------------------

  // stock_cache Map
  const cacheMap = new Map(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    cacheData.map((c: any) => [c.symbol as string, c]),
  );

  // daily_prices: symbol -> 날짜 내림차순 배열
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const priceMap = new Map<string, any[]>();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  for (const row of priceData as any[]) {
    const sym = row.symbol as string;
    if (!priceMap.has(sym)) priceMap.set(sym, []);
    priceMap.get(sym)!.push(row);
  }
  // DESC로 가져왔으므로 [0]이 최신

  // signals: symbol -> 신호 배열
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const signalMap = new Map<string, any[]>();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  for (const row of signalData as any[]) {
    const sym = row.symbol as string;
    if (!signalMap.has(sym)) signalMap.set(sym, []);
    signalMap.get(sym)!.push(row);
  }

  // -----------------------------------------------------------------------
  // 3. 섹터 통계 사전 집계
  // -----------------------------------------------------------------------
  const sectorStats = aggregateSectorStats(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    sectorStocksData as Array<{ symbol: string; sector: string | null; price_change_pct: number | null }>,
  );
  const totalSectorCount = sectorStats.size;

  // -----------------------------------------------------------------------
  // 4. 종목별 스코어링
  // -----------------------------------------------------------------------
  const filtered_out: Array<{ symbol: string; name: string | null; reasons: string[] }> = [];
  const scored: Array<ShortTermRecommendation & { _sortScore: number }> = [];

  for (const { symbol, name } of candidates) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const cache: any = cacheMap.get(symbol);
    const prices = priceMap.get(symbol) ?? []; // 날짜 내림차순 (newest first)
    const signalsForStock = signalMap.get(symbol) ?? [];

    // 가격 데이터가 전혀 없고 캐시도 없으면 건너뛰기
    if (prices.length === 0 && !cache?.current_price) {
      filtered_out.push({ symbol, name: name ?? null, reasons: ['가격 데이터 없음'] });
      continue;
    }

    // --- 파생값 계산 ---
    // daily_prices 최신 행이 오늘인지 확인 → 아니면 stock_cache 보완
    const latestPrice = prices[0] ?? null;
    const isLatestToday = latestPrice?.date === todayKst;
    const today = isLatestToday
      ? latestPrice
      : {
          // stock_cache에서 가상 당일 캔들 생성
          // volume: stock_cache.volume 사용 (prices-only 배치가 15분마다 갱신)
          // open: null 유지 (갭률 계산 불가)
          date: todayKst,
          close: cache?.current_price ?? latestPrice?.close ?? 0,
          open: null,
          high: cache?.current_price ?? latestPrice?.close ?? 0,
          low: cache?.current_price ?? latestPrice?.close ?? 0,
          volume: (cache?.volume as number | null) ?? 0,
        };
    const yesterday = isLatestToday
      ? (prices.length > 1 ? prices[1] : null)
      : latestPrice;
    const threeDaysAgoPrice = isLatestToday
      ? (prices.length > 2 ? prices[2] : null)
      : (prices.length > 1 ? prices[1] : null);

    const todayClose = today.close as number;
    const todayOpen = today.open as number | null;
    const todayHigh = today.high as number;
    const todayLow = today.low as number;
    const todayVolume = today.volume as number;

    // 종가 위치
    const closePosition =
      todayHigh === todayLow ? 1.0 : (todayClose - todayLow) / (todayHigh - todayLow);

    // 갭률
    const gapPct =
      todayOpen != null && yesterday
        ? ((todayOpen - (yesterday.close as number)) / (yesterday.close as number)) * 100
        : null;

    // 전일 몸통
    const prevBodyPct =
      yesterday && yesterday.open
        ? (((yesterday.close as number) - (yesterday.open as number)) / (yesterday.open as number)) * 100
        : null;

    // 2일 연속 양봉
    const isConsecutiveBullish = yesterday
      ? todayClose > (todayOpen ?? todayClose) &&
        (yesterday.close as number) > ((yesterday.open as number) ?? (yesterday.close as number))
      : false;

    // 전일 고점 돌파
    const prevHighBreakout = yesterday ? todayClose > (yesterday.high as number) : false;

    // 3일 박스 돌파
    const box3dHigh = Math.max(yesterday?.high ?? 0, threeDaysAgoPrice?.high ?? 0);
    const box3dBreakout = todayClose > box3dHigh && box3dHigh > 0;

    // 거래대금 (장중 당일 데이터 없으면 전일 거래대금으로 추정)
    const rawTradingValue = todayVolume * todayClose;
    const tradingValue = rawTradingValue > 0
      ? rawTradingValue
      : (yesterday ? (yesterday.volume as number) * (yesterday.close as number) : 0);

    // 거래량 비율 (20일 평균 대비)
    const volSlice = prices.slice(1, 21); // 전일부터 최대 20일
    const avgVol =
      volSlice.length > 0
        ? volSlice.reduce((sum: number, p: { volume: number }) => sum + p.volume, 0) / volSlice.length
        : 0;
    const volumeRatio = avgVol > 0 ? todayVolume / avgVol : 1;
    // 전일 거래량 비율 (20일 평균 대비) — 거래량 폭증 연속성 감지용
    const yesterdayVolume = (yesterday?.volume as number) ?? 0;
    const volRatioT1 = avgVol > 0 ? yesterdayVolume / avgVol : 0;

    // 3일 누적 수익률
    const cumReturn3d = threeDaysAgoPrice
      ? ((todayClose - (threeDaysAgoPrice.close as number)) / (threeDaysAgoPrice.close as number)) * 100
      : 0;

    // 캔들 위험용 파생값
    const bodySize = Math.abs(todayClose - (todayOpen ?? todayClose));
    const upperShadow = todayHigh - Math.max(todayClose, todayOpen ?? todayClose);

    // 2일 연속 장대양봉 (각 >= +5%)
    const todayBodyPct =
      todayOpen && todayOpen > 0
        ? ((todayClose - todayOpen) / todayOpen) * 100
        : 0;
    const isConsecutive2dLargeBullish =
      yesterday && yesterday.open
        ? (prevBodyPct ?? 0) >= 5 && todayBodyPct >= 5
        : false;

    // 등락률 (stock_cache 우선, 없으면 전일 대비 계산)
    const priceChangePct: number =
      cache?.price_change_pct ??
      (yesterday
        ? ((todayClose - (yesterday.close as number)) / (yesterday.close as number)) * 100
        : 0);

    // 수급 데이터
    const foreignNet: number | null = (cache?.foreign_net_qty as number | null) ?? null;
    const institutionNet: number | null = (cache?.institution_net_qty as number | null) ?? null;
    const foreignStreak: number | null = (cache?.foreign_streak as number | null) ?? null;
    const institutionStreak: number | null = (cache?.institution_streak as number | null) ?? null;

    // 신호 신선도
    const todaySignals = signalsForStock.filter(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (s: any) =>
        s.timestamp?.startsWith(todayKst) &&
        (s.signal_type === 'BUY' || s.signal_type === 'BUY_FORECAST'),
    );
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const todayBuySources = new Set(todaySignals.map((s: any) => s.source)).size;
    const lastBuySignal = signalsForStock.find(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (s: any) => s.signal_type === 'BUY' || s.signal_type === 'BUY_FORECAST',
    );
    const daysSinceLastBuy = lastBuySignal
      ? daysDiff(todayKst, lastBuySignal.timestamp)
      : 999;

    // 신호가 대비 괴리율
    const signalPrice = extractSignalPrice(lastBuySignal?.raw_data ?? null);
    const currentPrice: number | null = cache?.current_price ?? todayClose;
    const signalPriceGapPct =
      signalPrice && currentPrice
        ? ((currentPrice - signalPrice) / signalPrice) * 100
        : null;

    // 섹터 통계
    const sector: string | null = cache?.sector ?? null;
    const sectorStat = sector ? sectorStats.get(sector) : undefined;
    const sectorRank = sectorStat?.rank ?? null;
    const sectorAvgChangePct = sectorStat?.avgChangePct ?? 0;
    const sectorStockCount = sectorStat?.stockCount ?? 0;
    const stockRankInSector = sectorStat?.stockRanks.get(symbol) ?? null;
    const sectorStrong = sectorRank !== null && sectorRank <= 3;

    // --- 프리필터 적용 ---
    const preFilterInput: PreFilterInput = {
      priceChangePct,
      tradingValue,
      closePosition,
      highPrice: todayHigh,
      lowPrice: todayLow,
      foreignNet,
      institutionNet,
      daysSinceLastBuy,
      sectorStrong,
      cumReturn3d,
      hasTodayCandle: isLatestToday,
      todayBuySources,
      volumeRatio,
    };

    const preFilterResult = applyPreFilter(preFilterInput);
    if (!preFilterResult.passed) {
      filtered_out.push({ symbol, name: name ?? null, reasons: preFilterResult.reasons });
      continue;
    }

    // --- 5가지 스코어 계산 ---

    // 모멘텀
    const momentumInput: MomentumInput = {
      priceChangePct,
      volumeRatio,
      closePosition,
      highEqualsLow: todayHigh === todayLow,
      gapPct,
      prevBodyPct,
      isConsecutiveBullish,
      prevHighBreakout,
      box3dBreakout,
      tradingValue,
      isConsecutive2dLargeBullish,
    };
    const momentum = calcMomentumScore(momentumInput);

    // 수급
    const supplyInput: ShortTermSupplyInput = {
      foreignNet,
      institutionNet,
      programNet: null, // v1: 미지원
      foreignStreak,
      institutionStreak,
      programStreak: null, // v1: 미지원
    };
    const supply = calcShortTermSupplyScore(supplyInput);

    // 촉매
    const catalystInput: CatalystInput = {
      todayBuySources,
      daysSinceLastBuy,
      sectorRank,
      sectorCount: totalSectorCount,
      sectorAvgChangePct,
      stockChangePct: priceChangePct,
      stockRankInSector,
      sectorStockCount,
      signalPriceGapPct,
      volRatioToday: volumeRatio,
      volRatioT1,
    };
    const catalyst = calcCatalystScore(catalystInput);

    // 밸류에이션
    const targetPriceUpside =
      cache?.target_price && currentPrice
        ? ((cache.target_price - currentPrice) / currentPrice) * 100
        : null;
    const valuationInput: ShortTermValuationInput = {
      forwardPer: cache?.forward_per ?? null,
      targetPriceUpside,
      per: cache?.per ?? null,
      pbr: cache?.pbr ?? null,
      roe: cache?.roe ?? null,
    };
    const valuation = calcShortTermValuationScore(valuationInput);

    // 리스크
    const riskInput: RiskInput = {
      priceChangePct,
      cumReturn3d,
      volumeRatio,
      todayOpen,
      todayClose,
      todayHigh,
      upperShadow,
      bodySize,
      signalPriceGapPct,
      tradingValue,
      isConsecutive2dLargeBullish,
    };
    const risk = calcRiskPenalty(riskInput);

    // --- 가중합 계산 ---
    // 양수 가중치(momentum + supply + catalyst + valuation) 합계로 정규화
    const positiveWeightSum = weights.momentum + weights.supply + weights.catalyst + weights.valuation;
    const baseScore =
      momentum.normalized * (weights.momentum / positiveWeightSum) +
      supply.normalized * (weights.supply / positiveWeightSum) +
      catalyst.normalized * (weights.catalyst / positiveWeightSum) +
      valuation.normalized * (weights.valuation / positiveWeightSum);
    const finalScore = Math.max(
      0,
      Math.min(100, baseScore - risk.normalized * (weights.risk / 100)),
    );
    const totalScore = Math.round(finalScore * 10) / 10;

    // --- 등급 & 배지 ---
    const { grade, label: gradeLabel } = assignGrade(totalScore);
    const badges = generateBadges({
      volumeRatio,
      sectorRank,
      institutionNet,
      foreignNet,
      signalPriceGapPct,
    });

    const breakdown: ShortTermScoreBreakdown = {
      momentum: Math.round(momentum.normalized * 10) / 10,
      supply: Math.round(supply.normalized * 10) / 10,
      catalyst: Math.round(catalyst.normalized * 10) / 10,
      valuation: Math.round(valuation.normalized * 10) / 10,
      risk: Math.round(risk.normalized * 10) / 10,
      total: totalScore,
      grade,
      gradeLabel,
      preFilterPassed: true,
      badges,
    };

    scored.push({
      symbol,
      name: name ?? null,
      market: (cache?.market as string | undefined) ?? null,
      rank: 0, // 정렬 후 설정
      totalScore,
      grade,
      gradeLabel,
      breakdown,
      _sortScore: totalScore,
    });
  }

  // -----------------------------------------------------------------------
  // 5. 정렬 후 상위 limit개 선별
  // -----------------------------------------------------------------------
  scored.sort((a, b) => b._sortScore - a._sortScore);

  const recommendations: ShortTermRecommendation[] = scored
    .slice(0, limit)
    .map((item, idx) => ({
      symbol: item.symbol,
      name: item.name,
      market: item.market,
      rank: idx + 1,
      totalScore: item.totalScore,
      grade: item.grade,
      gradeLabel: item.gradeLabel,
      breakdown: item.breakdown,
    }));

  return { recommendations, total_candidates, filtered_out };
}
