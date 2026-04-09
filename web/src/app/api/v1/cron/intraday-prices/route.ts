import { NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase';
import { fetchAllStockPrices } from '@/lib/naver-stock-api';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const DEBOUNCE_MIN = 10; // 최소 갱신 간격 (분)
const BATCH_SIZE = 500;

/**
 * GET /api/v1/cron/intraday-prices
 * 신호 수신 시 fire-and-forget으로 호출되는 장중 현재가 갱신 엔드포인트.
 * DEBOUNCE_MIN 이내 이미 갱신된 경우 skip.
 */
export async function GET() {
  const supabase = createServiceClient();

  // 디바운스: stock_cache 마지막 updated_at 확인
  const { data: latest } = await supabase
    .from('stock_cache')
    .select('updated_at')
    .order('updated_at', { ascending: false })
    .limit(1)
    .single();

  if (latest?.updated_at) {
    const diffMin = (Date.now() - new Date(latest.updated_at).getTime()) / 60_000;
    if (diffMin < DEBOUNCE_MIN) {
      return NextResponse.json({ skipped: true, last_update_min_ago: diffMin.toFixed(1) });
    }
  }

  const prices = await fetchAllStockPrices();

  if (prices.size === 0) {
    return NextResponse.json({ error: '네이버 시세 조회 실패' }, { status: 502 });
  }

  const now = new Date().toISOString();
  const rows = [...prices.values()].map((p) => ({
    symbol: p.symbol,
    name: p.name,
    market: p.market,
    current_price: p.current_price,
    price_change: p.price_change,
    price_change_pct: p.price_change_pct,
    volume: p.volume,
    market_cap: p.market_cap,
    updated_at: now,
  }));

  let updated = 0;
  for (let i = 0; i < rows.length; i += BATCH_SIZE) {
    const { error } = await supabase
      .from('stock_cache')
      .upsert(rows.slice(i, i + BATCH_SIZE), { onConflict: 'symbol' });
    if (!error) updated += Math.min(BATCH_SIZE, rows.length - i);
  }

  // 90일 최고가 대비 등락률 갱신
  await supabase.rpc('refresh_high_90d_pct').catch(() => {});

  return NextResponse.json({ ok: true, total: prices.size, updated });
}
