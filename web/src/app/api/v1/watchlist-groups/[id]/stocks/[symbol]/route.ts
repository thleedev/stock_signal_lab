// web/src/app/api/v1/watchlist-groups/[id]/stocks/[symbol]/route.ts
import { NextRequest } from 'next/server';
import { createServiceClient } from '@/lib/supabase';

type Params = { params: Promise<{ id: string; symbol: string }> };

// DELETE — 그룹에서 종목 제거
export async function DELETE(_: NextRequest, { params }: Params) {
  const { id, symbol } = await params;
  const supabase = createServiceClient();

  const { error } = await supabase
    .from('watchlist_group_stocks')
    .delete()
    .eq('group_id', id)
    .eq('symbol', symbol);

  if (error) return Response.json({ error: error.message }, { status: 500 });

  // 다른 그룹에도 없으면 favorite_stocks + stock_cache 정리
  const { data: remaining } = await supabase
    .from('watchlist_group_stocks')
    .select('symbol')
    .eq('symbol', symbol)
    .limit(1);

  if (!remaining?.length) {
    await Promise.all([
      supabase.from('favorite_stocks').delete().eq('symbol', symbol),
      supabase.from('stock_cache').update({ is_favorite: false }).eq('symbol', symbol),
    ]);
  }

  return Response.json({ success: true });
}
