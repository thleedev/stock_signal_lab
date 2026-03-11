import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase';

export async function PUT(request: NextRequest) {
  const supabase = createServiceClient();
  const { items } = await request.json() as {
    items: Array<{ symbol: string; sort_order: number }>;
  };

  if (!items || !Array.isArray(items)) {
    return NextResponse.json({ error: 'items array required' }, { status: 400 });
  }

  // 각 항목의 sort_order 업데이트
  const updates = items.map(({ symbol, sort_order }) =>
    supabase
      .from('watchlist')
      .update({ sort_order })
      .eq('symbol', symbol)
  );

  await Promise.all(updates);

  return NextResponse.json({ success: true });
}
