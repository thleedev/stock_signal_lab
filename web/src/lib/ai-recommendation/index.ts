import { SupabaseClient } from '@supabase/supabase-js';
import { AiRecommendation, AiRecommendationWeights, DEFAULT_WEIGHTS } from '@/types/ai-recommendation';
import { calcSignalScore } from './signal-score';
import { calcTechnicalScore, DailyPrice } from './technical-score';
import { calcValuationScore } from './valuation-score';
import { calcSupplyScore } from './supply-score';
import { fetchBulkInvestorData } from '@/lib/naver-stock-api';
import { getDailyPrices, delay } from '@/lib/kis-api';

// 오늘 날짜 KST (YYYY-MM-DD)
export function getTodayKst(): string {
  const now = new Date();
  const kst = new Date(now.getTime() + 9 * 60 * 60 * 1000);
  return kst.toISOString().slice(0, 10);
}

// 오늘 BUY/BUY_FORECAST 신호 종목 목록 조회 (중복 제거)
export async function fetchTodayBuySymbols(
  supabase: SupabaseClient,
  todayKst: string
): Promise<{ symbol: string; name: string }[]> {
  const startOfDay = `${todayKst}T00:00:00+09:00`;
  const endOfDay = `${todayKst}T23:59:59+09:00`;

  const { data } = await supabase
    .from('signals')
    .select('symbol, name')
    .in('signal_type', ['BUY', 'BUY_FORECAST'])
    .gte('timestamp', startOfDay)
    .lte('timestamp', endOfDay);

  if (!data) return [];

  const seen = new Set<string>();
  return data.filter((s) => {
    if (seen.has(s.symbol)) return false;
    seen.add(s.symbol);
    return true;
  });
}

// 메인 계산 함수
export async function generateRecommendations(
  supabase: SupabaseClient,
  weights: AiRecommendationWeights = DEFAULT_WEIGHTS,
  limit = 5
): Promise<{ recommendations: AiRecommendation[]; total_candidates: number }> {
  const todayKst = getTodayKst();
  const candidates = await fetchTodayBuySymbols(supabase, todayKst);
  const total_candidates = candidates.length;

  if (total_candidates === 0) {
    return { recommendations: [], total_candidates: 0 };
  }

  const symbols = candidates.map((c) => c.symbol);
  const startOfDay = `${todayKst}T00:00:00+09:00`;
  const endOfDay = `${todayKst}T23:59:59+09:00`;
  const nowKst = new Date(new Date().getTime() + 9 * 60 * 60 * 1000);
  const thirtyDaysAgoKst = new Date(nowKst.getTime() - 30 * 24 * 60 * 60 * 1000);
  const thirtyDaysAgoStr = thirtyDaysAgoKst.toISOString().slice(0, 10);

  // 모든 데이터 병렬 배치 조회 (N+1 제거)
  const [
    { data: cacheData },
    { data: sectorData },
    { data: allStocksForSector },
    { data: allSectorInfo },
    { data: todaySignalRows },
    { data: recentSignalRows },
    { data: priceRows },
  ] = await Promise.all([
    // 종목별 재무/가격 캐시
    supabase
      .from('stock_cache')
      .select('symbol, per, pbr, roe, volume, current_price, high_52w, low_52w, short_sell_ratio, short_sell_updated_at, foreign_net_qty, institution_net_qty, investor_updated_at')
      .in('symbol', symbols),
    // 종목별 섹터
    supabase.from('stock_info').select('symbol, sector').in('symbol', symbols),
    // 섹터 평균 거래대금 계산용 전체 종목
    supabase.from('stock_cache').select('symbol, volume, current_price'),
    supabase.from('stock_info').select('symbol, sector'),
    // 오늘 BUY 신호 (전 종목 한 번에)
    supabase
      .from('signals')
      .select('symbol, source, raw_data')
      .in('symbol', symbols)
      .in('signal_type', ['BUY', 'BUY_FORECAST'])
      .gte('timestamp', startOfDay)
      .lte('timestamp', endOfDay),
    // 최근 30일 BUY 신호 (전 종목 한 번에, count용)
    supabase
      .from('signals')
      .select('symbol')
      .in('symbol', symbols)
      .in('signal_type', ['BUY', 'BUY_FORECAST'])
      .gte('timestamp', `${thirtyDaysAgoStr}T00:00:00+09:00`),
    // 기술지표용 일별 가격 (전 종목 한 번에, 최신 65일)
    supabase
      .from('daily_prices')
      .select('symbol, date, open, high, low, close, volume')
      .in('symbol', symbols)
      .order('date', { ascending: false })
      .limit(symbols.length * 65),
  ]);

  // 조회 결과를 symbol 기준 Map으로 변환
  const cacheMap = new Map((cacheData ?? []).map((c) => [c.symbol, c]));
  const sectorMap = new Map(
    (sectorData ?? []).map((s) => [s.symbol, s.sector as string | null])
  );

  // 섹터별 평균 거래대금 사전 집계
  const symbolSectorMap = new Map(
    (allSectorInfo ?? []).map((s) => [s.symbol, s.sector as string | null])
  );
  const sectorTurnoverMap = new Map<string, number[]>();
  for (const stock of allStocksForSector ?? []) {
    const sec = symbolSectorMap.get(stock.symbol);
    if (!sec) continue;
    const turnover = (stock.volume ?? 0) * (stock.current_price ?? 0);
    if (turnover > 0) {
      if (!sectorTurnoverMap.has(sec)) sectorTurnoverMap.set(sec, []);
      sectorTurnoverMap.get(sec)!.push(turnover);
    }
  }
  const sectorAvgMap = new Map<string, number>();
  for (const [sec, turnovers] of sectorTurnoverMap) {
    sectorAvgMap.set(sec, turnovers.reduce((a, b) => a + b, 0) / turnovers.length);
  }

  // 오늘 신호: symbol → [{source, raw_data}]
  const todaySignalMap = new Map<string, Array<{ source: string; raw_data: unknown }>>();
  for (const row of todaySignalRows ?? []) {
    const sym = row.symbol as string;
    if (!todaySignalMap.has(sym)) todaySignalMap.set(sym, []);
    todaySignalMap.get(sym)!.push({ source: row.source, raw_data: row.raw_data });
  }

  // 최근 30일 신호 카운트: symbol → count
  const recentCountMap = new Map<string, number>();
  for (const row of recentSignalRows ?? []) {
    const sym = row.symbol as string;
    recentCountMap.set(sym, (recentCountMap.get(sym) ?? 0) + 1);
  }

  // 일별 가격: symbol → DailyPrice[] (시간 오름차순, 최신 65일)
  const priceMap = new Map<string, DailyPrice[]>();
  for (const row of priceRows ?? []) {
    const sym = row.symbol as string;
    if (!priceMap.has(sym)) priceMap.set(sym, []);
    priceMap.get(sym)!.push(row as DailyPrice);
  }
  // DESC로 가져왔으므로 각 종목별 reverse() → 시간 오름차순, 최신 65일 슬라이스
  for (const [sym, rows] of priceMap) {
    priceMap.set(sym, rows.reverse().slice(-65));
  }

  // 기술지표 daily_prices: DB에 없는 종목은 KIS API로 실시간 조회 후 DB 저장
  const nowKst2 = new Date(new Date().getTime() + 9 * 60 * 60 * 1000);
  const todayCompact = nowKst2.toISOString().slice(0, 10).replace(/-/g, '');
  const d30Compact = new Date(nowKst2.getTime() - 30 * 86400000)
    .toISOString().slice(0, 10).replace(/-/g, '');

  const symbolsNeedingPrices = symbols.filter(
    (sym) => (priceMap.get(sym) ?? []).length < 20
  );

  if (symbolsNeedingPrices.length > 0) {
    for (const sym of symbolsNeedingPrices) {
      const prices = await getDailyPrices(sym, d30Compact, todayCompact);
      if (prices.length > 0) {
        const sorted = [...prices].sort((a, b) => a.date.localeCompare(b.date));
        priceMap.set(sym, sorted.slice(-65));
        // DB에 저장 (background, 실패해도 무시)
        supabase
          .from('daily_prices')
          .upsert(
            prices.map((p) => ({ symbol: sym, ...p })),
            { onConflict: 'symbol,date' }
          )
          .then(() => {/* fire-and-forget */});
      }
      await delay(300);
    }
  }

  // 투자자 데이터: stock_cache 캐시 우선, 당일 데이터 없으면 Naver live 배치 호출
  const todayStr = todayKst;
  const symbolsNeedingLiveFetch = symbols.filter((sym) => {
    const cache = cacheMap.get(sym);
    if (!cache?.investor_updated_at) return true;
    const updatedDate = (cache.investor_updated_at as string).slice(0, 10);
    return updatedDate !== todayStr;
  });

  let liveInvestorMap = new Map<string, { foreign_net: number; institution_net: number }>();
  if (symbolsNeedingLiveFetch.length > 0) {
    liveInvestorMap = await fetchBulkInvestorData(symbolsNeedingLiveFetch);
  }

  // 각 종목 점수 계산 (순수 함수 호출 — DB 쿼리 없음)
  const scored = candidates.map(({ symbol, name }) => {
    const cache = cacheMap.get(symbol);
    const sector = sectorMap.get(symbol) ?? null;
    const sectorAvgTurnover = sector ? (sectorAvgMap.get(sector) ?? null) : null;

    const todaySignals = todaySignalMap.get(symbol) ?? [];
    const recentCount = recentCountMap.get(symbol) ?? 0;
    const prices = priceMap.get(symbol) ?? [];

    const signalResult = calcSignalScore(todaySignals, recentCount, cache?.current_price ?? null);
    const technicalResult = calcTechnicalScore(
      prices,
      cache?.high_52w ?? null,
      cache?.low_52w ?? null
    );

    // 투자자 데이터: 캐시 우선, 없으면 live
    const cachedInvestorFresh =
      cache?.investor_updated_at &&
      (cache.investor_updated_at as string).slice(0, 10) === todayStr;
    const foreignNet: number | null = cachedInvestorFresh
      ? (cache!.foreign_net_qty as number | null)
      : (liveInvestorMap.get(symbol)?.foreign_net ?? null);
    const institutionNet: number | null = cachedInvestorFresh
      ? (cache!.institution_net_qty as number | null)
      : (liveInvestorMap.get(symbol)?.institution_net ?? null);

    // 공매도 비율: 당일 데이터만 사용 (휴장일 stale 방지)
    const shortSellFresh =
      cache?.short_sell_updated_at &&
      (cache.short_sell_updated_at as string).slice(0, 10) === todayStr;
    const shortSellRatio: number | null = shortSellFresh
      ? (cache!.short_sell_ratio as number | null)
      : null;

    const supplyResult = calcSupplyScore(
      cache?.volume ?? null,
      cache?.current_price ?? null,
      sectorAvgTurnover,
      foreignNet,
      institutionNet,
      shortSellRatio,
    );
    const valuationResult = calcValuationScore(
      cache?.per ?? null,
      cache?.pbr ?? null,
      cache?.roe ?? null
    );

    // 가중치 적용 총점
    const total_score =
      (signalResult.score / 30) * weights.signal +
      (Math.max(0, technicalResult.score) / 30) * weights.technical +
      (valuationResult.score / 20) * weights.valuation +
      (supplyResult.score / 20) * weights.supply;

    return {
      symbol,
      name: name ?? null,
      total_score: Math.round(total_score * 10) / 10,
      signal_score: signalResult.score,
      technical_score: technicalResult.score,
      valuation_score: valuationResult.score,
      supply_score: supplyResult.score,
      signal_count: signalResult.signal_count,
      rsi: technicalResult.rsi,
      macd_cross: technicalResult.macd_cross,
      golden_cross: technicalResult.golden_cross,
      bollinger_bottom: technicalResult.bollinger_bottom,
      phoenix_pattern: technicalResult.phoenix_pattern,
      double_top: technicalResult.double_top,
      volume_surge: technicalResult.volume_surge,
      week52_low_near: technicalResult.week52_low_near,
      per: valuationResult.per,
      pbr: valuationResult.pbr,
      roe: valuationResult.roe,
      foreign_buying: supplyResult.foreign_buying,
      institution_buying: supplyResult.institution_buying,
      volume_vs_sector: supplyResult.volume_vs_sector,
      low_short_sell: supplyResult.low_short_sell,
    };
  });

  // 총점 내림차순 정렬 후 상위 limit개
  const sorted = scored.sort((a, b) => b.total_score - a.total_score).slice(0, limit);

  const recommendations: AiRecommendation[] = sorted.map((item, idx) => ({
    ...item,
    id: '',
    date: todayKst,
    rank: idx + 1,
    weight_signal: weights.signal,
    weight_technical: weights.technical,
    weight_valuation: weights.valuation,
    weight_supply: weights.supply,
    total_candidates,
    created_at: new Date().toISOString(),
  }));

  return { recommendations, total_candidates };
}
