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

  const upsertData: Record<string, unknown> = {
    symbol: body.symbol,
    name: body.name,
    note: body.note || null,
  };
  if (body.group_name) {
    upsertData.group_name = body.group_name;
  }

  const { data, error } = await supabase
    .from('favorite_stocks')
    .upsert(upsertData)
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

// PATCH /api/v1/favorites — 그룹 일괄 변경
export async function PATCH(request: NextRequest) {
  const body = await request.json();

  if (!body.symbols || !body.group_name) {
    return Response.json({ error: 'symbols and group_name are required' }, { status: 400 });
  }

  const supabase = createServiceClient();

  const { error } = await supabase
    .from('favorite_stocks')
    .update({ group_name: body.group_name })
    .in('symbol', body.symbols);

  if (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }

  return Response.json({ success: true });
}
