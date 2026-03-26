import { NextRequest } from 'next/server';
import { createServiceClient } from '@/lib/supabase';

// GET /api/v1/signals — 신호 목록 조회 (필터: source, symbol, date, signal_type)
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const source = searchParams.get('source');
  const symbol = searchParams.get('symbol');
  const date = searchParams.get('date');
  const signalType = searchParams.get('signal_type');
  const limit = Math.min(parseInt(searchParams.get('limit') || '50'), 200);
  const offset = parseInt(searchParams.get('offset') || '0');

  const supabase = createServiceClient();

  let query = supabase
    .from('signals')
    .select('*', { count: 'exact' })
    .order('timestamp', { ascending: false })
    .range(offset, offset + limit - 1);

  if (source) query = query.eq('source', source);
  if (symbol) query = query.eq('symbol', symbol);
  if (signalType) query = query.eq('signal_type', signalType);
  if (date) {
    // date = 'YYYY-MM-DD' → 해당 일자 범위
    query = query
      .gte('timestamp', `${date}T00:00:00+09:00`)
      .lt('timestamp', `${date}T23:59:59+09:00`);
  }

  const { data, error, count } = await query;

  if (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }

  return Response.json({
    signals: data,
    total: count,
    limit,
    offset,
  }, {
    headers: { 'Cache-Control': 'public, s-maxage=10, stale-while-revalidate=30' },
  });
}
