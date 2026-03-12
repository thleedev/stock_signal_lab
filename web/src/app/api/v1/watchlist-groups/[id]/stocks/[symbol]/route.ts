// web/src/app/api/v1/watchlist-groups/[id]/stocks/[symbol]/route.ts
import { NextRequest } from 'next/server';
import { createServiceClient } from '@/lib/supabase';

type Params = { params: { id: string; symbol: string } };

// DELETE — 그룹에서 종목 제거
export async function DELETE(_: NextRequest, { params }: Params) {
  const supabase = createServiceClient();

  const { error } = await supabase
    .from('watchlist_group_stocks')
    .delete()
    .eq('group_id', params.id)
    .eq('symbol', params.symbol);

  if (error) return Response.json({ error: error.message }, { status: 500 });

  // 다른 그룹에도 없으면 favorite_stocks + stock_cache 정리
  const { data: remaining } = await supabase
    .from('watchlist_group_stocks')
    .select('symbol')
    .eq('symbol', params.symbol)
    .limit(1);

  if (!remaining?.length) {
    await Promise.all([
      supabase.from('favorite_stocks').delete().eq('symbol', params.symbol),
      supabase.from('stock_cache').update({ is_favorite: false }).eq('symbol', params.symbol),
    ]);
  }

  return Response.json({ success: true });
}
