import { NextRequest } from 'next/server';
import { createServiceClient } from '@/lib/supabase';

// GET /api/v1/favorites — 즐겨찾기 종목 목록
export async function GET() {
  const supabase = createServiceClient();

  const { data, error } = await supabase
    .from('favorite_stocks')
    .select('*')
    .order('added_at', { ascending: false });

  if (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }

  return Response.json({ favorites: data });
}

// POST /api/v1/favorites — 즐겨찾기 추가
export async function POST(request: NextRequest) {
  const body = await request.json();

  if (!body.symbol || !body.name) {
    return Response.json({ error: 'symbol and name are required' }, { status: 400 });
  }

  const supabase = createServiceClient();

  const { data, error } = await supabase
    .from('favorite_stocks')
    .upsert({
      symbol: body.symbol,
      name: body.name,
      note: body.note || null,
    })
    .select()
    .single();

  if (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }

  // stock_cache 동기화
  await supabase
    .from('stock_cache')
    .update({ is_favorite: true })
    .eq('symbol', body.symbol);

  return Response.json({ favorite: data }, { status: 201 });
}
