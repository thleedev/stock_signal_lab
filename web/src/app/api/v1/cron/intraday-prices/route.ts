import { NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase';
import { fetchAllStockPrices } from '@/lib/naver-stock-api';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/**
 * 장중 가격 업데이트 크론 (30분 간격, KST 09:00~16:00)
 * daily-prices 크론의 경량 버전: 네이버에서 전종목 가격만 갱신
 */
export async function GET() {
  // 장중(KST 08:00~20:00, 평일)에만 실행
  const kst = new Date(Date.now() + 9 * 60 * 60 * 1000);
  const kstHour = kst.getUTCHours();
  const kstDay = kst.getUTCDay(); // 0=일, 6=토
  if (kstDay === 0 || kstDay === 6 || kstHour < 8 || kstHour >= 20) {
    return NextResponse.json({ skipped: true, reason: '장외 시간' });
  }

  const supabase = createServiceClient();
  const priceMap = await fetchAllStockPrices();

  if (priceMap.size === 0) {
    return NextResponse.json({ error: '네이버 가격 조회 실패' }, { status: 502 });
  }

  const now = new Date().toISOString();
  const entries = Array.from(priceMap.values());
  const BATCH = 500;
  let updated = 0;

  for (let i = 0; i < entries.length; i += BATCH) {
    const batch = entries.slice(i, i + BATCH);
    const rows = batch.map((price) => {
      const row: Record<string, unknown> = {
        symbol: price.symbol,
        current_price: price.current_price,
        market_cap: price.market_cap,
        updated_at: now,
      };
      if (price.name) row.name = price.name;
      if (price.volume > 0) {
        row.volume = price.volume;
        row.price_change = price.price_change;
        row.price_change_pct = price.price_change_pct;
      }
      return row;
    });

    const { error } = await supabase
      .from('stock_cache')
      .upsert(rows, { onConflict: 'symbol', ignoreDuplicates: false });

    if (!error) updated += rows.length;
  }

  return NextResponse.json({
    success: true,
    updated,
    total: priceMap.size,
    timestamp: now,
  });
}
