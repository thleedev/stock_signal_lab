import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase';
import { fetchAllStockPrices } from '@/lib/naver-stock-api';
import { fetchBulkIndicators } from '@/lib/krx-api';

export const dynamic = 'force-dynamic';
export const maxDuration = 120;

/**
 * 우선순위 가격+지표 업데이트
 * 1) 네이버 전종목 시세로 가격 일괄 업데이트 (2~5초)
 * 2) 네이버 고병렬 투자지표 조회 (30병렬, 200종목 ~1초)
 *
 * 개선 전: 5병렬 × 200ms 딜레이 → 200종목 40~60초
 * 개선 후: 30병렬 × 딜레이 없음 → 200종목 ~1초
 */
export async function POST(request: NextRequest) {
  const authHeader = request.headers.get('authorization');
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const supabase = createServiceClient();
  const startTime = Date.now();
  const lap = (label: string) => {
    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    console.log(`[stock-cache-priority] ${label} (${elapsed}초)`);
    return elapsed;
  };

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

  lap(`우선순위 종목 ${symbols.length}개 수집`);

  try {
    // Step 1: 네이버 전종목 시세 + 고병렬 지표 조회 동시 실행
    const [priceMap, indicatorMap] = await Promise.all([
      fetchAllStockPrices(),
      fetchBulkIndicators(symbols, 30),
    ]);

    lap(`데이터 조회 완료 - 시세 ${priceMap.size}종목, 지표 ${indicatorMap.size}종목`);

    // Step 2: 가격+지표 일괄 업데이트
    let updated = 0;
    let skipped = 0;
    const now = new Date().toISOString();
    const BATCH_SIZE = 20;

    for (let i = 0; i < symbols.length; i += BATCH_SIZE) {
      const batch = symbols.slice(i, i + BATCH_SIZE);
      const results = await Promise.allSettled(
        batch.map(async (symbol) => {
          const price = priceMap.get(symbol);
          const indicator = indicatorMap.get(symbol);

          if (!price && !indicator) {
            skipped++;
            return;
          }

          const updateData: Record<string, unknown> = { updated_at: now };

          if (price) {
            updateData.current_price = price.current_price;
            updateData.market_cap = price.market_cap;
            if (price.volume > 0) {
              updateData.volume = price.volume;
              updateData.price_change = price.price_change;
              updateData.price_change_pct = price.price_change_pct;
            }
          }

          if (indicator) {
            updateData.per = indicator.per || null;
            updateData.pbr = indicator.pbr || null;
            updateData.eps = indicator.eps || null;
            updateData.bps = indicator.bps || null;
            updateData.roe = indicator.roe || null;
            updateData.high_52w = indicator.high_52w || null;
            updateData.low_52w = indicator.low_52w || null;
            updateData.dividend_yield = indicator.dividend_yield || null;
          }

          const { error: updateError } = await supabase
            .from('stock_cache')
            .update(updateData)
            .eq('symbol', symbol);

          if (updateError) throw new Error(`${symbol}: ${updateError.message}`);
        })
      );

      for (const r of results) {
        if (r.status === 'fulfilled') updated++;
      }
    }

    const elapsed = lap(`업데이트 완료: ${updated}성공, ${skipped}스킵`);

    return NextResponse.json({
      success: true,
      source: 'naver-bulk',
      total: symbols.length,
      priceCount: priceMap.size,
      indicatorCount: indicatorMap.size,
      updated,
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
