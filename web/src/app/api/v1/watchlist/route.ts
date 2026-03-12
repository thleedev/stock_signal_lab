import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase';

export const dynamic = 'force-dynamic';

export async function GET() {
  const supabase = createServiceClient();

  const { data, error } = await supabase
    .from('watchlist')
    .select('*')
    .order('sort_order', { ascending: true });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json(data);
}

export async function POST(request: NextRequest) {
  const supabase = createServiceClient();
  const body = await request.json();
  const { symbol, name, memo, buy_price, stop_loss_price, target_price } = body as {
    symbol: string; name: string; memo?: string; buy_price?: number;
    stop_loss_price?: number; target_price?: number;
  };

  if (!symbol || !name) {
    return NextResponse.json({ error: 'symbol and name required' }, { status: 400 });
  }

  // 중복 체크
  const { data: existing } = await supabase
    .from('watchlist')
    .select('id')
    .eq('symbol', symbol)
    .single();

  if (existing) {
    return NextResponse.json({ error: '이미 추가된 종목입니다' }, { status: 409 });
  }

  // 최대 sort_order 조회
  const { data: maxSort } = await supabase
    .from('watchlist')
    .select('sort_order')
    .order('sort_order', { ascending: false })
    .limit(1)
    .single();

  const { data, error } = await supabase
    .from('watchlist')
    .insert({
      symbol,
      name,
      memo: memo || null,
      buy_price: buy_price ?? null,
      stop_loss_price: stop_loss_price ?? null,
      target_price: target_price ?? null,
      sort_order: (maxSort?.sort_order ?? 0) + 1,
    })
    .select()
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json(data, { status: 201 });
}

export async function PATCH(request: NextRequest) {
  const supabase = createServiceClient();
  const body = await request.json();
  const { symbol, buy_price, stop_loss_price, target_price } = body as {
    symbol: string; buy_price?: number | null;
    stop_loss_price?: number | null; target_price?: number | null;
  };

  if (!symbol) {
    return NextResponse.json({ error: 'symbol required' }, { status: 400 });
  }

  const updates: Record<string, unknown> = {};
  if (buy_price !== undefined) updates.buy_price = buy_price;
  if (stop_loss_price !== undefined) updates.stop_loss_price = stop_loss_price;
  if (target_price !== undefined) updates.target_price = target_price;

  const { data, error } = await supabase
    .from('watchlist')
    .update(updates)
    .eq('symbol', symbol)
    .select()
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json(data);
}

export async function DELETE(request: NextRequest) {
  const supabase = createServiceClient();
  const { searchParams } = new URL(request.url);
  const symbol = searchParams.get('symbol');

  if (!symbol) {
    return NextResponse.json({ error: 'symbol required' }, { status: 400 });
  }

  const { error } = await supabase
    .from('watchlist')
    .delete()
    .eq('symbol', symbol);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ success: true });
}
