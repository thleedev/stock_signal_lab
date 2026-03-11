import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase';
import { getStockIndicators, delay } from '@/lib/kis-api';

export const dynamic = 'force-dynamic';
export const maxDuration = 120;

/**
 * 우선순위 가격 업데이트
 * 관심종목 + 포트종목 + 최근 신호 종목만 업데이트
 * 08:00~20:00 사이 5분 간격 실행 권장
 */
export async function POST(request: NextRequest) {
  const authHeader = request.headers.get('authorization');
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const supabase = createServiceClient();
  const startTime = Date.now();

  // 우선순위 종목 수집
  const symbolSet = new Set<string>();

  // 1. 관심종목
  const { data: favs } = await supabase.from('favorite_stocks').select('symbol');
  for (const f of favs ?? []) symbolSet.add(f.symbol);

  // 2. 포트종목
  const { data: watchlist } = await supabase.from('watchlist').select('symbol');
  for (const w of watchlist ?? []) symbolSet.add(w.symbol);

  // 3. 최근 7일 신호 종목
  const weekAgo = new Date(Date.now() - 7 * 86400000).toISOString();
  const { data: signals } = await supabase
    .from('signals')
    .select('symbol')
    .gte('timestamp', weekAgo);
  for (const s of signals ?? []) if (s.symbol) symbolSet.add(s.symbol);

  const symbols = Array.from(symbolSet);
  if (symbols.length === 0) {
    return NextResponse.json({ success: true, updated: 0, message: '업데이트 대상 없음' });
  }

  let updated = 0;
  let skipped = 0;
  let failed = 0;

  // 배치 처리 (10건/초)
  const BATCH_SIZE = 10;
  for (let i = 0; i < symbols.length; i += BATCH_SIZE) {
    const batch = symbols.slice(i, i + BATCH_SIZE);

    const results = await Promise.allSettled(
      batch.map(async (symbol) => {
        const data = await getStockIndicators(symbol);
        if (!data) throw new Error(`Failed: ${symbol}`);

        // 변동 감지: 기존 가격과 비교
        const { data: cached } = await supabase
          .from('stock_cache')
          .select('current_price, volume')
          .eq('symbol', symbol)
          .single();

        if (cached && cached.current_price === data.price && cached.volume === data.volume) {
          return { symbol, action: 'skipped' as const };
        }

        await supabase.from('stock_cache').update({
          current_price: data.price,
          price_change: data.price_change,
          price_change_pct: data.price_change_pct,
          volume: data.volume,
          market_cap: data.market_cap,
          per: data.per,
          pbr: data.pbr,
          eps: data.eps,
          bps: data.bps,
          high_52w: data.high_52w,
          low_52w: data.low_52w,
          dividend_yield: data.dividend_yield,
          updated_at: new Date().toISOString(),
        }).eq('symbol', symbol);

        return { symbol, action: 'updated' as const };
      })
    );

    for (const r of results) {
      if (r.status === 'fulfilled') {
        if (r.value.action === 'updated') updated++;
        else skipped++;
      } else {
        failed++;
      }
    }

    if (i + BATCH_SIZE < symbols.length) {
      await delay(1100);
    }
  }

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);

  return NextResponse.json({
    success: true,
    total: symbols.length,
    updated,
    skipped,
    failed,
    elapsed: `${elapsed}초`,
  });
}
