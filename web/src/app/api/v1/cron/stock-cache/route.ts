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

    // Step 2: stock_cache 전체 종목 조회 (Supabase 기본 1000행 제한 우회)
    const stocks: { symbol: string }[] = [];
    const PAGE_LIMIT = 1000;
    let from = 0;
    while (true) {
      const { data: page, error: pageError } = await supabase
        .from('stock_cache')
        .select('symbol')
        .range(from, from + PAGE_LIMIT - 1);
      if (pageError || !page) {
        if (stocks.length === 0) {
          return NextResponse.json({ error: pageError?.message || 'No stocks' }, { status: 500 });
        }
        break;
      }
      stocks.push(...page);
      if (page.length < PAGE_LIMIT) break;
      from += PAGE_LIMIT;
    }
    lap(`DB 종목 조회: ${stocks.length}종목`);

    let updated = 0;
    let failed = 0;
    const now = new Date().toISOString();

    const targets = stocks.filter(({ symbol }) => priceMap.has(symbol));
    const skipped = stocks.length - targets.length;

    // bulk upsert (500건씩 배치)
    const BATCH_SIZE = 500;
    for (let i = 0; i < targets.length; i += BATCH_SIZE) {
      const batch = targets.slice(i, i + BATCH_SIZE);
      const rows = batch.map(({ symbol }) => {
        const price = priceMap.get(symbol)!;
        const row: Record<string, unknown> = {
          symbol,
          current_price: price.current_price,
          market_cap: price.market_cap,
          updated_at: now,
        };
        if (price.volume > 0) {
          row.volume = price.volume;
          row.price_change = price.price_change;
          row.price_change_pct = price.price_change_pct;
        }
        return row;
      });

      const { error: e } = await supabase
        .from('stock_cache')
        .upsert(rows, { onConflict: 'symbol', ignoreDuplicates: false });

      if (e) {
        console.error(`[stock-cache] Batch upsert error:`, e.message);
        failed += batch.length;
      } else {
        updated += batch.length;
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
      const SIGNAL_BATCH = 500;
      for (let i = 0; i < signalEntries.length; i += SIGNAL_BATCH) {
        const rows = signalEntries.slice(i, i + SIGNAL_BATCH).map(([symbol, info]) => ({
          symbol,
          signal_count_30d: info.count,
          latest_signal_type: info.latestType,
          latest_signal_date: info.latestDate,
        }));
        await supabase
          .from('stock_cache')
          .upsert(rows, { onConflict: 'symbol', ignoreDuplicates: false });
      }
      lap(`신호 집계 완료: ${signalEntries.length}종목`);
    }

    // Step 4: 보유/관심 상태 동기화 (즐겨찾기 종목만 업데이트)
    const { data: favorites } = await supabase
      .from('favorite_stocks')
      .select('symbol');

    if (favorites && favorites.length > 0) {
      const favSymbols = favorites.map((f) => f.symbol);
      const FAV_BATCH = 500;
      for (let i = 0; i < favSymbols.length; i += FAV_BATCH) {
        const batch = favSymbols.slice(i, i + FAV_BATCH);
        await supabase.from('stock_cache').update({ is_favorite: true }).in('symbol', batch);
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
