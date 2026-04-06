// web/src/app/api/v1/stock-ranking/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase';
import type { StockScore } from '@/types/batch';

export const dynamic = 'force-dynamic';

/** stock-ranking API 응답의 개별 종목 항목 타입 */
export type StockRankItem = {
  symbol: string;
  scored_at: string | null;
  score_total: number; // balanced weighted 종합 점수 (API에서 재계산)
  score_value: number;
  score_growth: number;
  score_supply: number;
  score_momentum: number;
  score_risk: number;
  score_signal: number;
  name: string | null;
  market: string | null;
  current_price: number | null;
  price_change_pct: number | null;
  per: number | null;
  pbr: number | null;
  roe: number | null;
  market_cap: number | null;
  dividend_yield: number | null;
  foreign_net_qty: number | null;
  institution_net_qty: number | null;
  foreign_net_5d: number | null;
  institution_net_5d: number | null;
  foreign_streak: number | null;
  institution_streak: number | null;
  short_sell_ratio: number | null;
  high_52w: number | null;
  low_52w: number | null;
  forward_per: number | null;
  target_price: number | null;
  invest_opinion: number | null;
  signal_count_30d: number | null;
  latest_signal_type: string | null;
  latest_signal_date: string | null;
  latest_signal_price: number | null;
  is_managed: boolean | null;
  volume: number | null;
  prices_updated_at: string | null;
};

const VALID_STYLES = ['balanced', 'value', 'growth', 'momentum', 'defensive'] as const;
type StyleId = typeof VALID_STYLES[number];

const STYLE_WEIGHTS: Record<StyleId, {
  value: number; growth: number; supply: number; momentum: number; risk: number; signal: number;
}> = {
  balanced:  { value: 20, growth: 15, supply: 20, momentum: 20, risk: 15, signal: 10 },
  value:     { value: 35, growth: 20, supply: 10, momentum: 10, risk: 15, signal: 10 },
  growth:    { value: 10, growth: 35, supply: 15, momentum: 20, risk: 10, signal: 10 },
  momentum:  { value: 10, growth: 10, supply: 20, momentum: 35, risk: 10, signal: 15 },
  defensive: { value: 20, growth: 10, supply: 15, momentum: 10, risk: 30, signal: 15 },
};

/**
 * 현재가와 전일 종가를 기반으로 모멘텀 점수를 실시간 조정합니다.
 * 등락률 1%당 2점 조정, 최대 ±20점 범위로 제한합니다.
 */
function adjustMomentum(base: number, currentPrice: number | null, prevClose: number | null): number {
  if (!currentPrice || !prevClose || prevClose === 0) return base;
  const changePct = (currentPrice - prevClose) / prevClose * 100;
  const adjustment = Math.max(-20, Math.min(20, changePct * 2));
  return Math.max(0, Math.min(100, base + adjustment));
}

/**
 * 스타일 가중치를 적용하여 종합 점수를 계산합니다.
 * 리스크 점수는 페널티로 적용됩니다.
 */
function calcWeightedScore(
  score: Pick<StockScore, 'score_value' | 'score_growth' | 'score_supply' | 'score_momentum' | 'score_risk' | 'score_signal'> & { score_momentum_adjusted: number },
  weights: typeof STYLE_WEIGHTS[StyleId],
): number {
  const total = weights.value + weights.growth + weights.supply + weights.momentum + weights.signal;
  if (total === 0) return 0;
  const positive =
    score.score_value * weights.value +
    score.score_growth * weights.growth +
    score.score_supply * weights.supply +
    score.score_momentum_adjusted * weights.momentum +
    score.score_signal * weights.signal;
  const riskPenalty = score.score_risk * (weights.risk / 100);
  return Math.max(0, Math.min(100, Math.round(positive / total - riskPenalty)));
}

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const market = searchParams.get('market') ?? 'all';
  const styleParam = searchParams.get('style') ?? 'balanced';
  const style: StyleId = VALID_STYLES.includes(styleParam as StyleId) ? (styleParam as StyleId) : 'balanced';
  const dateParam = searchParams.get('date') ?? 'all'; // 'all' | 'signal_all' | 'YYYY-MM-DD'
  const page = Math.max(1, parseInt(searchParams.get('page') ?? '1'));
  const limit = Math.min(500, Math.max(10, parseInt(searchParams.get('limit') ?? '50')));
  const offset = (page - 1) * limit;

  const supabase = createServiceClient();
  const weights = STYLE_WEIGHTS[style];

  // stock_scores와 stock_cache를 JOIN하여 종목 점수 및 현재가 정보를 조회합니다.
  let query = supabase
    .from('stock_scores')
    .select(`
      symbol, scored_at, prev_close,
      score_value, score_growth, score_supply, score_momentum, score_risk, score_signal, score_total,
      stock_cache!inner(
        symbol, name, market, current_price, price_change_pct,
        per, pbr, roe, market_cap, dividend_yield,
        foreign_net_qty, institution_net_qty, foreign_net_5d, institution_net_5d,
        foreign_streak, institution_streak, short_sell_ratio,
        high_52w, low_52w, forward_per, target_price, invest_opinion,
        signal_count_30d, latest_signal_type, latest_signal_date, latest_signal_price,
        is_managed, volume, updated_at
      )
    `, { count: 'exact' });

  if (market !== 'all') {
    query = query.eq('stock_cache.market', market);
  }

  // date 파라미터로 신호 필터링
  // 'today'(YYYY-MM-DD) = 전체 종목(필터 없음), 'signal_all' = 30일 내 신호 보유, 'all' = 전체
  if (dateParam === 'signal_all') {
    query = query.gt('stock_cache.signal_count_30d', 0);
  }

  const { data: rawData, count, error } = await query
    .not('stock_cache.current_price', 'is', null)
    .order('score_total', { ascending: false })
    .range(offset, offset + limit - 1);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const items = (rawData ?? []).map(row => {
    const cache = row.stock_cache as unknown as Record<string, unknown>;
    const currentPrice = cache.current_price as number | null;
    const prevClose = row.prev_close as number | null;
    // 실시간 등락률을 반영하여 모멘텀 점수를 조정합니다.
    const momentumAdjusted = adjustMomentum(
      row.score_momentum as number,
      currentPrice,
      prevClose,
    );
    const scoreTotal = calcWeightedScore(
      {
        score_value: row.score_value as number,
        score_growth: row.score_growth as number,
        score_supply: row.score_supply as number,
        score_momentum: row.score_momentum as number,
        score_momentum_adjusted: momentumAdjusted,
        score_risk: row.score_risk as number,
        score_signal: row.score_signal as number,
      },
      weights,
    );

    return {
      symbol: row.symbol,
      scored_at: row.scored_at,
      score_total: scoreTotal,
      score_value: row.score_value,
      score_growth: row.score_growth,
      score_supply: row.score_supply,
      score_momentum: momentumAdjusted,
      score_risk: row.score_risk,
      score_signal: row.score_signal,
      name: cache.name,
      market: cache.market,
      current_price: currentPrice,
      price_change_pct: cache.price_change_pct,
      per: cache.per,
      pbr: cache.pbr,
      roe: cache.roe,
      market_cap: cache.market_cap,
      dividend_yield: cache.dividend_yield,
      foreign_net_qty: cache.foreign_net_qty,
      institution_net_qty: cache.institution_net_qty,
      foreign_net_5d: cache.foreign_net_5d,
      institution_net_5d: cache.institution_net_5d,
      foreign_streak: cache.foreign_streak,
      institution_streak: cache.institution_streak,
      short_sell_ratio: cache.short_sell_ratio,
      high_52w: cache.high_52w,
      low_52w: cache.low_52w,
      forward_per: cache.forward_per,
      target_price: cache.target_price,
      invest_opinion: cache.invest_opinion,
      signal_count_30d: cache.signal_count_30d,
      latest_signal_type: cache.latest_signal_type,
      latest_signal_date: cache.latest_signal_date,
      latest_signal_price: cache.latest_signal_price,
      is_managed: cache.is_managed,
      volume: cache.volume,
      prices_updated_at: cache.updated_at,
    };
  });

  // 종합 점수 내림차순으로 정렬합니다.
  items.sort((a, b) => b.score_total - a.score_total);

  return NextResponse.json({
    items,
    total: count ?? 0,
    page,
    limit,
    style,
    scored_at: items[0]?.scored_at ?? null,
  });
}
