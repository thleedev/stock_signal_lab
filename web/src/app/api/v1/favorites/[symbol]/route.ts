import { NextRequest } from 'next/server';
import { createServiceClient } from '@/lib/supabase';

// DELETE /api/v1/favorites/:symbol — 즐겨찾기 제거
export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ symbol: string }> }
) {
  const { symbol } = await params;
  const supabase = createServiceClient();

  const { error } = await supabase
    .from('favorite_stocks')
    .delete()
    .eq('symbol', symbol);

  if (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }

  // stock_cache 동기화
  await supabase
    .from('stock_cache')
    .update({ is_favorite: false })
    .eq('symbol', symbol);

  return Response.json({ success: true, symbol });
}
