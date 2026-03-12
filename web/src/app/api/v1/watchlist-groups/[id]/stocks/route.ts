// web/src/app/api/v1/watchlist-groups/[id]/stocks/route.ts
import { NextRequest } from 'next/server';
import { createServiceClient } from '@/lib/supabase';

type Params = { params: Promise<{ id: string }> };

// GET — 그룹 내 종목 목록
export async function GET(_: NextRequest, { params }: Params) {
  const { id } = await params;
  const supabase = createServiceClient();

  const { data, error } = await supabase
    .from('watchlist_group_stocks')
    .select('symbol, added_at')
    .eq('group_id', id)
    .order('added_at', { ascending: true });

  if (error) return Response.json({ error: error.message }, { status: 500 });
  return Response.json({ stocks: data });
}

// POST — 그룹에 종목 추가 { symbol, name }
export async function POST(request: NextRequest, { params }: Params) {
  const { id } = await params;
  const body = await request.json();
  if (!body.symbol || !body.name) {
    return Response.json({ error: 'symbol and name are required' }, { status: 400 });
  }

  const supabase = createServiceClient();

  // favorite_stocks 마스터에 없으면 upsert
  await supabase
    .from('favorite_stocks')
    .upsert({ symbol: body.symbol, name: body.name }, { onConflict: 'symbol' });

  // stock_cache.is_favorite 동기화
  await supabase
    .from('stock_cache')
    .update({ is_favorite: true })
    .eq('symbol', body.symbol);

  // 그룹에 추가
  const { error } = await supabase
    .from('watchlist_group_stocks')
    .insert({ group_id: id, symbol: body.symbol });

  if (error) {
    if (error.code === '23505') {
      return Response.json({ error: '이미 그룹에 있는 종목입니다.' }, { status: 409 });
    }
    return Response.json({ error: error.message }, { status: 500 });
  }

  return Response.json({ success: true }, { status: 201 });
}
