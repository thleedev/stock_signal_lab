import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase';
import { fetchAllStockPrices, fetchStockIndicators } from '@/lib/naver-stock-api';
import { delay } from '@/lib/kis-api';

export const dynamic = 'force-dynamic';
export const maxDuration = 120;

/**
 * 우선순위 가격 업데이트
 * 1) 네이버 전종목 시세로 가격 일괄 업데이트 (2~5초)
 * 2) 우선순위 종목만 개별 투자지표(PER/PBR/52주 등) 업데이트
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

  const [{ data: favs }, { data: watchlist }, { data: signals }] = await Promise.all([
    supabase.from('favorite_stocks').select('symbol'),
    supabase.from('watchlist').select('symbol'),
    supabase.from('signals').select('symbol').gte('timestamp', new Date(Date.now() - 7 * 86400000).toISOString()),
  ]);

  for (const f of favs ?? []) symbolSet.add(f.symbol);
  for (const w of watchlist ?? []) symbolSet.add(w.symbol);
  for (const s of signals ?? []) if (s.symbol) symbolSet.add(s.symbol);

  const symbols = Array.from(symbolSet);
  if (symbols.length === 0) {
    return NextResponse.json({ success: true, updated: 0, message: '업데이트 대상 없음' });
  }

  try {
    // Step 1: 네이버 전종목 시세로 가격 업데이트
    const priceMap = await fetchAllStockPrices();

    let priceUpdated = 0;
    let skipped = 0;
    const now = new Date().toISOString();

    // 개별 update (upsert는 name NOT NULL 제약으로 실패)
    const updatePromises = symbols.map(async (symbol) => {
      const price = priceMap.get(symbol);
      if (!price) {
        skipped++;
        return;
      }

      const updateData: Record<string, unknown> = {
        current_price: price.current_price,
        market_cap: price.market_cap,
        updated_at: now,
      };
      if (price.volume > 0) {
        updateData.volume = price.volume;
        updateData.price_change = price.price_change;
        updateData.price_change_pct = price.price_change_pct;
      }

      const { error: updateError } = await supabase
        .from('stock_cache')
        .update(updateData)
        .eq('symbol', symbol);

      if (!updateError) priceUpdated++;
    });

    await Promise.all(updatePromises);

    // Step 2: 투자지표 개별 조회 (우선순위 종목만, 5건/초)
    let indicatorUpdated = 0;
    const BATCH_SIZE = 5;

    for (let i = 0; i < symbols.length; i += BATCH_SIZE) {
      if (Date.now() - startTime > 100_000) break; // 안전 마진

      const batch = symbols.slice(i, i + BATCH_SIZE);
      const results = await Promise.allSettled(
        batch.map(async (symbol) => {
          const ind = await fetchStockIndicators(symbol);
          if (!ind) return null;

          await supabase.from('stock_cache').update({
            per: ind.per,
            pbr: ind.pbr,
            eps: ind.eps,
            bps: ind.bps,
            high_52w: ind.high_52w,
            low_52w: ind.low_52w,
            dividend_yield: ind.dividend_yield,
          }).eq('symbol', symbol);

          return symbol;
        })
      );

      for (const r of results) {
        if (r.status === 'fulfilled' && r.value) indicatorUpdated++;
      }

      if (i + BATCH_SIZE < symbols.length) {
        await delay(200);
      }
    }

    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);

    return NextResponse.json({
      success: true,
      source: 'naver',
      total: symbols.length,
      priceUpdated,
      indicatorUpdated,
      skipped,
      elapsed: `${elapsed}초`,
    });

  } catch (err) {
    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    console.error('[stock-cache-priority] 오류:', err);
    return NextResponse.json({
      error: err instanceof Error ? err.message : 'Unknown error',
      elapsed: `${elapsed}초`,
    }, { status: 500 });
  }
}
