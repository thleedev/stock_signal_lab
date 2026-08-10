import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase';
import { toActiveSignal, type ActiveSignalRow } from '@/lib/signal-constants';
import { parseActiveParams } from './params';

export const dynamic = 'force-dynamic';

const BUY_COLUMNS = 'symbol, name, market, latest_signal_date, latest_signal_type, latest_signal_price';
const SELL_COLUMNS = 'symbol, name, market, latest_sell_date';

/**
 * GET /api/v1/signals/active
 * stock_cache 기준 현재 BUY/SELL 상태 종목을 페이지 단위로 반환합니다.
 * /signals 의 date=all 모드가 최초 200행 이후를 이어받을 때 사용합니다.
 */
export async function GET(request: NextRequest) {
  const { type, offset, limit } = parseActiveParams(new URL(request.url).searchParams);
  const supabase = createServiceClient();

  const query =
    type === 'buy'
      ? supabase
          .from('stock_cache')
          .select(BUY_COLUMNS, { count: 'exact' })
          .eq('has_active_sell', false)
          .not('latest_signal_date', 'is', null)
          .order('latest_signal_date', { ascending: false })
      : supabase
          .from('stock_cache')
          .select(SELL_COLUMNS, { count: 'exact' })
          .eq('has_active_sell', true)
          .not('latest_sell_date', 'is', null)
          .order('latest_sell_date', { ascending: false });

  const { data, count, error } = await query.range(offset, offset + limit - 1);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const items = (data ?? []).map((row) => toActiveSignal(row as unknown as ActiveSignalRow, type));
  const total = count ?? 0;

  return NextResponse.json({ items, total, hasMore: offset + items.length < total });
}
