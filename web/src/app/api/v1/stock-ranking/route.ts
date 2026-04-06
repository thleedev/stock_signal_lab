// web/src/app/api/v1/stock-ranking/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase';

export const dynamic = 'force-dynamic';

/**
 * stock-ranking API 응답의 개별 종목 항목 타입
 *
 * DB 컬럼 매핑 (step4-scoring.ts 기준):
 *   score_momentum → 기술전환 점수 (calcTechnicalReversal)
 *   score_value    → 가치매력 점수 (calcValuationAttractiveness)
 *   score_supply   → 수급강도 점수 (calcSupplyStrength)
 *   score_signal   → 신호보너스 점수 (calcSignalBonus)
 *   score_risk     → 리스크 감점 절대값 (0~100)
 *   score_total    → 최종 종합 점수 (calcCompositeScore, 티어별 가중치 적용)
 */
export type StockRankItem = {
  symbol: string;
  scored_at: string | null;
  score_total: number;
  score_value: number;      // 가치매력
  score_growth: number;     // (score_value와 동일값 저장됨 — 하위호환용)
  score_supply: number;     // 수급강도
  score_momentum: number;   // 기술전환 (DB 컬럼명이 momentum이나 실제로는 기술전환)
  score_risk: number;       // 리스크 감점 절대값
  score_signal: number;     // 신호보너스
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

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const market = searchParams.get('market') ?? 'all';
  const dateParam = searchParams.get('date') ?? 'all'; // 'all' | 'signal_all' | 'YYYY-MM-DD'
  const page = Math.max(1, parseInt(searchParams.get('page') ?? '1'));
  const limit = Math.min(9999, Math.max(10, parseInt(searchParams.get('limit') ?? '50')));
  const offset = (page - 1) * limit;

  const supabase = createServiceClient();

  // stock_scores와 stock_cache를 JOIN하여 종목 점수 및 현재가 정보를 조회합니다.
  let query = supabase
    .from('stock_scores')
    .select(`
      symbol, scored_at,
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
  // 'all' = 전체 종목, 'signal_all' = 30일 내 신호 보유, 'YYYY-MM-DD' = 해당 날짜에 신호가 있는 종목
  if (dateParam === 'signal_all') {
    query = query.gt('stock_cache.signal_count_30d', 0);
  } else if (/^\d{4}-\d{2}-\d{2}$/.test(dateParam)) {
    // 오늘 탭: 해당 날짜 UTC 자정(= KST 09:00) 이후 신호가 있는 종목
    // 한국 장 시간(09:00~15:30 KST = 00:00~06:30 UTC)에 신호가 들어오므로 GTE 단일 조건으로 충분
    query = query.gte('stock_cache.latest_signal_date', `${dateParam}T00:00:00Z`);
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

    return {
      symbol: row.symbol,
      scored_at: row.scored_at,
      // calcCompositeScore가 티어별 가중치로 계산한 score_total을 그대로 사용합니다.
      score_total: row.score_total as number,
      score_value: row.score_value as number,
      score_growth: row.score_growth as number,
      score_supply: row.score_supply as number,
      score_momentum: row.score_momentum as number,
      score_risk: row.score_risk as number,
      score_signal: row.score_signal as number,
      name: cache.name,
      market: cache.market,
      current_price: cache.current_price,
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

  return NextResponse.json({
    items,
    total: count ?? 0,
    page,
    limit,
    scored_at: items[0]?.scored_at ?? null,
  });
}
