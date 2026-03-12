import { SupabaseClient } from '@supabase/supabase-js';
import { AiRecommendation, AiRecommendationWeights, DEFAULT_WEIGHTS } from '@/types/ai-recommendation';
import { calcSignalScore } from './signal-score';
import { calcTechnicalScore } from './technical-score';
import { calcValuationScore } from './valuation-score';
import { calcSupplyScore } from './supply-score';

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

  // stock_cache와 stock_info 병렬 조회
  const [{ data: cacheData }, { data: sectorData }] = await Promise.all([
    supabase
      .from('stock_cache')
      .select('symbol, per, pbr, roe, volume, current_price, high_52w, low_52w')
      .in('symbol', symbols),
    supabase.from('stock_info').select('symbol, sector').in('symbol', symbols),
  ]);

  const cacheMap = new Map((cacheData ?? []).map((c) => [c.symbol, c]));
  const sectorMap = new Map(
    (sectorData ?? []).map((s) => [s.symbol, s.sector as string | null])
  );

  // 섹터별 평균 거래대금 사전 집계 (N+1 방지)
  const [{ data: allStocksForSector }, { data: allSectorInfo }] = await Promise.all([
    supabase.from('stock_cache').select('symbol, volume, current_price'),
    supabase.from('stock_info').select('symbol, sector'),
  ]);

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

  // 각 종목 점수 병렬 계산
  const scored = await Promise.all(
    candidates.map(async ({ symbol, name }) => {
      const cache = cacheMap.get(symbol);
      const sector = sectorMap.get(symbol) ?? null;
      const sectorAvgTurnover = sector ? (sectorAvgMap.get(sector) ?? null) : null;

      const [signalResult, technicalResult] = await Promise.all([
        calcSignalScore(supabase, symbol, todayKst, cache?.current_price ?? null),
        calcTechnicalScore(supabase, symbol, cache?.high_52w ?? null, cache?.low_52w ?? null),
      ]);

      const supplyResult = calcSupplyScore(
        cache?.volume ?? null,
        cache?.current_price ?? null,
        sectorAvgTurnover
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
      };
    })
  );

  // 총점 내림차순 정렬 후 상위 limit개
  const sorted = scored.sort((a, b) => b.total_score - a.total_score).slice(0, limit);

  const recommendations: AiRecommendation[] = sorted.map((item, idx) => ({
    id: '',
    date: todayKst,
    rank: idx + 1,
    total_score: item.total_score,
    weight_signal: weights.signal,
    weight_technical: weights.technical,
    weight_valuation: weights.valuation,
    weight_supply: weights.supply,
    total_candidates,
    created_at: new Date().toISOString(),
    ...item,
  }));

  return { recommendations, total_candidates };
}
