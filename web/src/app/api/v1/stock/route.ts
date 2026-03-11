import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase';

/**
 * GET /api/v1/stock?symbol=005930&period=30d
 *
 * 종목 상세 데이터 (일봉, 신호, 거래)
 */
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const symbol = searchParams.get('symbol');
  const period = searchParams.get('period') ?? '30d';

  if (!symbol) {
    return NextResponse.json({ error: 'symbol required' }, { status: 400 });
  }

  const supabase = createServiceClient();
  const days = parseInt(period) || 30;
  const dateFrom = new Date(Date.now() - days * 86400000).toISOString().slice(0, 10);

  try {
    const [pricesRes, signalsRes, tradesRes] = await Promise.all([
      supabase
        .from('daily_prices')
        .select('*')
        .eq('symbol', symbol)
        .gte('date', dateFrom)
        .order('date', { ascending: true }),
      supabase
        .from('signals')
        .select('*')
        .eq('symbol', symbol)
        .order('timestamp', { ascending: false })
        .limit(50),
      supabase
        .from('virtual_trades')
        .select('*')
        .eq('symbol', symbol)
        .order('created_at', { ascending: false })
        .limit(30),
    ]);

    return NextResponse.json({
      symbol,
      prices: pricesRes.data ?? [],
      signals: signalsRes.data ?? [],
      trades: tradesRes.data ?? [],
    });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
