import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase';
import { getStockIndicators } from '@/lib/kis-api';

export const dynamic = 'force-dynamic';

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ symbol: string }> }
) {
  const { symbol } = await params;
  const supabase = createServiceClient();

  // 캐시 체크 (5분 이내면 캐시 반환)
  const { data: cached } = await supabase
    .from('stock_cache')
    .select('*')
    .eq('symbol', symbol)
    .single();

  if (cached?.updated_at) {
    const cacheAge = Date.now() - new Date(cached.updated_at).getTime();
    if (cacheAge < 5 * 60 * 1000) {
      return NextResponse.json(cached);
    }
  }

  // KIS API 실시간 조회
  const indicators = await getStockIndicators(symbol);
  if (!indicators) {
    if (cached) return NextResponse.json(cached);
    return NextResponse.json({ error: 'Failed to fetch data' }, { status: 502 });
  }

  // stock_cache UPSERT
  const updateData = {
    symbol,
    name: cached?.name || symbol,
    market: cached?.market || 'KOSPI',
    current_price: indicators.price,
    price_change: indicators.price_change,
    price_change_pct: indicators.price_change_pct,
    volume: indicators.volume,
    market_cap: indicators.market_cap,
    per: indicators.per,
    pbr: indicators.pbr,
    eps: indicators.eps,
    bps: indicators.bps,
    high_52w: indicators.high_52w,
    low_52w: indicators.low_52w,
    dividend_yield: indicators.dividend_yield,
    updated_at: new Date().toISOString(),
  };

  const { data: updated, error } = await supabase
    .from('stock_cache')
    .upsert(updateData, { onConflict: 'symbol' })
    .select()
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json(updated);
}
