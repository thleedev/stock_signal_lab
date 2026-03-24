import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase';

export const dynamic = 'force-dynamic';

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ symbol: string }> }
) {
  const { symbol } = await params;
  const supabase = createServiceClient();

  const [{ data: cache }, { data: info }] = await Promise.all([
    supabase
      .from('stock_cache')
      .select('symbol, name, current_price, price_change_pct, per, pbr, roe, eps, bps, market_cap, high_52w, low_52w, dividend_yield, volume')
      .eq('symbol', symbol)
      .single(),
    supabase
      .from('stock_info')
      .select('symbol, name')
      .eq('symbol', symbol)
      .single(),
  ]);

  if (!cache) {
    return NextResponse.json({ error: '종목을 찾을 수 없습니다' }, { status: 404 });
  }

  // stock_info에서 이름 보완
  const isCodeLike = (name: string) => name === symbol || /^\d{6}$/.test(name);
  const name = (isCodeLike(cache.name ?? '') && info?.name) ? info.name : cache.name;

  return NextResponse.json({
    symbol: cache.symbol,
    name,
    current_price: cache.current_price ?? null,
    price_change_pct: cache.price_change_pct ?? null,
    per: cache.per ?? null,
    pbr: cache.pbr ?? null,
    roe: cache.roe ?? null,
    eps: cache.eps ?? null,
    bps: cache.bps ?? null,
    market_cap: cache.market_cap ?? null,
    high_52w: cache.high_52w ?? null,
    low_52w: cache.low_52w ?? null,
    dividend_yield: cache.dividend_yield ?? null,
    volume: cache.volume ?? null,
  }, {
    headers: { 'Cache-Control': 'public, s-maxage=30, stale-while-revalidate=60' },
  });
}
