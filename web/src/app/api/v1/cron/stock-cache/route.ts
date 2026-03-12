import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase';
import { fetchAllStockPrices } from '@/lib/naver-stock-api';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

export async function POST(request: NextRequest) {
  const authHeader = request.headers.get('authorization');
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const supabase = createServiceClient();
  const startTime = Date.now();
  const lap = (label: string) => console.log(`[stock-cache] ${label} (${((Date.now() - startTime) / 1000).toFixed(1)}초)`);

  try {
    // Step 1: 네이버 전종목 시세 조회
    const priceMap = await fetchAllStockPrices();
    lap(`시세 조회 완료: ${priceMap.size}종목`);

    // Step 2: stock_cache 종목 조회
    const { data: stocks, error } = await supabase
      .from('stock_cache')
      .select('symbol');

    if (error || !stocks) {
      return NextResponse.json({ error: error?.message || 'No stocks' }, { status: 500 });
    }

    let updated = 0;
    let failed = 0;
    const now = new Date().toISOString();

    const targets = stocks.filter(({ symbol }) => priceMap.has(symbol));
    const skipped = stocks.length - targets.length;

    // 배치 실행 (20건씩)
    const BATCH_SIZE = 20;
    for (let i = 0; i < targets.length; i += BATCH_SIZE) {
      const batch = targets.slice(i, i + BATCH_SIZE);
      const results = await Promise.allSettled(
        batch.map(async ({ symbol }) => {
          const price = priceMap.get(symbol)!;
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
          const { error: e } = await supabase
            .from('stock_cache')
            .update(updateData)
            .eq('symbol', symbol);
          if (e) throw new Error(`${symbol}: ${e.message}`);
        })
      );
      for (const r of results) {
        if (r.status === 'fulfilled') updated++;
        else failed++;
      }
    }
    lap(`가격 업데이트 완료: ${updated}성공 ${failed}실패 ${skipped}스킵`);

    // Step 3: AI 신호 집계 (배치 처리)
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

    const { data: signalCounts } = await supabase
      .from('signals')
      .select('symbol, signal_type, timestamp')
      .gte('timestamp', thirtyDaysAgo.toISOString())
      .order('timestamp', { ascending: false });

    if (signalCounts && signalCounts.length > 0) {
      const symbolSignals: Record<string, { count: number; latestType: string; latestDate: string }> = {};
      for (const s of signalCounts) {
        if (!s.symbol) continue;
        if (!symbolSignals[s.symbol]) {
          symbolSignals[s.symbol] = { count: 0, latestType: s.signal_type, latestDate: s.timestamp };
        }
        symbolSignals[s.symbol].count++;
      }

      const signalEntries = Object.entries(symbolSignals);
      for (let i = 0; i < signalEntries.length; i += BATCH_SIZE) {
        await Promise.allSettled(
          signalEntries.slice(i, i + BATCH_SIZE).map(([symbol, info]) =>
            supabase.from('stock_cache').update({
              signal_count_30d: info.count,
              latest_signal_type: info.latestType,
              latest_signal_date: info.latestDate,
            }).eq('symbol', symbol)
          )
        );
      }
      lap(`신호 집계 완료: ${signalEntries.length}종목`);
    }

    // Step 4: 보유/관심 상태 동기화
    const { data: favorites } = await supabase
      .from('favorite_stocks')
      .select('symbol');

    if (favorites) {
      const favSymbols = favorites.map((f) => f.symbol);
      await supabase.from('stock_cache').update({ is_favorite: false }).not('symbol', 'in', `(${favSymbols.join(',')})`);
      if (favSymbols.length > 0) {
        await supabase.from('stock_cache').update({ is_favorite: true }).in('symbol', favSymbols);
      }
    }
    lap('완료');

    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);

    return NextResponse.json({
      success: true,
      source: 'naver',
      fetched: priceMap.size,
      updated,
      failed,
      skipped,
      total: stocks.length,
      elapsed: `${elapsed}초`,
    });

  } catch (err) {
    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    console.error('[stock-cache] 오류:', err);
    return NextResponse.json({
      error: err instanceof Error ? err.message : 'Unknown error',
      elapsed: `${elapsed}초`,
    }, { status: 500 });
  }
}
