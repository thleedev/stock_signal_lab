import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase';
import { fetchAllStockPrices } from '@/lib/naver-stock-api';
import { fetchBulkIndicators } from '@/lib/krx-api';

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
    // Step 1: 우선순위 종목 수집 (기존 stock-cache-priority 로직 통합)
    const prioritySet = new Set<string>();
    const [{ data: favs }, { data: watchlist }, { data: recentSignals }] = await Promise.all([
      supabase.from('favorite_stocks').select('symbol'),
      supabase.from('watchlist').select('symbol'),
      supabase.from('signals').select('symbol').gte('timestamp', new Date(Date.now() - 7 * 86400000).toISOString()),
    ]);
    for (const f of favs ?? []) prioritySet.add(f.symbol);
    for (const w of watchlist ?? []) prioritySet.add(w.symbol);
    for (const s of recentSignals ?? []) if (s.symbol) prioritySet.add(s.symbol);
    const prioritySymbols = Array.from(prioritySet);
    lap(`우선순위 종목 ${prioritySymbols.length}개 수집`);

    // Step 2: 네이버 전종목 시세 + 우선순위 지표 동시 조회
    const [priceMap, indicatorMap] = await Promise.all([
      fetchAllStockPrices(),
      prioritySymbols.length > 0 ? fetchBulkIndicators(prioritySymbols, 30) : Promise.resolve(new Map()),
    ]);
    lap(`시세 ${priceMap.size}종목 + 지표 ${indicatorMap.size}종목 조회 완료`);

    // Step 3: stock_cache 전체 종목 조회 (1000행 페이징)
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

    // Step 4: 가격 + 지표 일괄 업데이트 (배치 upsert)
    let updated = 0;
    let failed = 0;
    const now = new Date().toISOString();
    const targets = stocks.filter(({ symbol }) => priceMap.has(symbol) || indicatorMap.has(symbol));
    const skipped = stocks.length - targets.length;

    const BATCH_SIZE = 500;
    for (let i = 0; i < targets.length; i += BATCH_SIZE) {
      const batch = targets.slice(i, i + BATCH_SIZE);
      const rows = batch.map(({ symbol }) => {
        const price = priceMap.get(symbol);
        const indicator = indicatorMap.get(symbol);
        const row: Record<string, unknown> = { symbol, updated_at: now };

        if (price) {
          row.current_price = price.current_price;
          row.market_cap = price.market_cap;
          if (price.volume > 0) {
            row.volume = price.volume;
            row.price_change = price.price_change;
            row.price_change_pct = price.price_change_pct;
          }
        }

        if (indicator) {
          row.per = indicator.per || null;
          row.pbr = indicator.pbr || null;
          row.eps = indicator.eps || null;
          row.bps = indicator.bps || null;
          row.roe = indicator.roe || null;
          row.high_52w = indicator.high_52w || null;
          row.low_52w = indicator.low_52w || null;
          row.dividend_yield = indicator.dividend_yield || null;
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
    lap(`가격+지표 업데이트: ${updated}성공 ${failed}실패 ${skipped}스킵`);

    // Step 5: AI 신호 집계 (배치 처리)
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

    const { data: signalCounts } = await supabase
      .from('signals')
      .select('symbol, signal_type, timestamp')
      .in('signal_type', ['BUY', 'BUY_FORECAST'])
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

    // Step 6: 즐겨찾기 상태 동기화
    if (favs && favs.length > 0) {
      const favSymbols = favs.map((f) => f.symbol);
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
      indicators: indicatorMap.size,
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
