import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase';
import { toActiveSignal, type ActiveSignalRow } from '@/lib/signal-constants';
import { fetchSectorMap, mergeSectors } from '@/lib/signal-sector';
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

  // latest_signal_date/latest_sell_date 만으로 정렬하면 동일 날짜 행이 많아
  // (BUY 상위 1000행 중 최다 그룹 286행) Postgres 가 순서를 보장하지 않습니다.
  // symbol 오름차순을 tiebreaker 로 더해 페이지 경계에서 행이 누락되거나
  // 중복되지 않게 합니다. /signals 의 최초 200행 조회와 반드시 동일해야 합니다.
  const query =
    type === 'buy'
      ? supabase
          .from('stock_cache')
          .select(BUY_COLUMNS, { count: 'exact' })
          .eq('has_active_sell', false)
          .not('latest_signal_date', 'is', null)
          .order('latest_signal_date', { ascending: false })
          .order('symbol', { ascending: true })
      : supabase
          .from('stock_cache')
          .select(SELL_COLUMNS, { count: 'exact' })
          .eq('has_active_sell', true)
          .not('latest_sell_date', 'is', null)
          .order('latest_sell_date', { ascending: false })
          .order('symbol', { ascending: true });

  const { data, count, error } = await query.range(offset, offset + limit - 1);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const raw = (data ?? []).map((row) => toActiveSignal(row as unknown as ActiveSignalRow, type));

  // stock_cache 에 업종이 없어 stock_info 에서 채웁니다.
  // 페이지의 최초 200행과 같은 함수를 써야 이어 붙인 행이 어긋나지 않습니다.
  const sectorMap = await fetchSectorMap(supabase, raw.map((s) => s.symbol));
  const items = mergeSectors(raw, sectorMap);
  const total = count ?? 0;

  return NextResponse.json({ items, total, hasMore: offset + items.length < total });
}
