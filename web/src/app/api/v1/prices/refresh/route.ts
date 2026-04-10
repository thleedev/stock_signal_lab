import { NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase';
import { fetchAllStockPrices } from '@/lib/naver-stock-api';

export const dynamic = 'force-dynamic';
export const maxDuration = 30; // Vercel 함수 최대 실행시간 (초)

const BATCH_SIZE = 500;

/**
 * POST /api/v1/prices/refresh
 * 네이버에서 전종목 현재가를 조회해 stock_cache를 갱신합니다.
 */
export async function POST() {
  const prices = await fetchAllStockPrices();

  if (prices.size === 0) {
    return NextResponse.json({ error: '네이버 시세 조회 실패' }, { status: 502 });
  }

  const supabase = createServiceClient();
  const now = new Date().toISOString();

  // name, market 포함해야 NOT NULL 제약 위반 없이 upsert 가능
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
  const errors: string[] = [];
  for (let i = 0; i < rows.length; i += BATCH_SIZE) {
    const { error } = await supabase
      .from('stock_cache')
      .upsert(rows.slice(i, i + BATCH_SIZE), { onConflict: 'symbol' });
    if (!error) {
      updated += Math.min(BATCH_SIZE, rows.length - i);
    } else {
      errors.push(error.message);
    }
  }

  return NextResponse.json({
    ok: errors.length === 0,
    total: prices.size,
    updated,
    ...(errors.length > 0 ? { errors } : {}),
  });
}
