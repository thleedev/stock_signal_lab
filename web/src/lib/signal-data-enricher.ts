/**
 * 신호 수신 시 해당 종목의 수급/일봉/forward 데이터를 사전 조회하여 stock_cache + daily_prices에 저장
 *
 * Android Collector → signals/batch POST → 이 함수 비동기 호출
 * 크론에 의존하지 않고 신호 시점에 즉시 데이터를 확보하여 점수 계산 정확도 향상
 */

import { SupabaseClient } from '@supabase/supabase-js';
import { fetchBulkInvestorData, fetchNaverDailyPrices } from '@/lib/naver-stock-api';
import { fetchBulkIndicators } from '@/lib/krx-api';

export async function enrichSignalStocks(
  supabase: SupabaseClient,
  symbols: string[],
): Promise<void> {
  if (symbols.length === 0) return;

  const unique = [...new Set(symbols)];
  const nowKst = new Date(Date.now() + 9 * 60 * 60 * 1000);
  const todayStr = nowKst.toISOString().slice(0, 10);

  // 수급 + 지표(forward 포함) + 일봉을 병렬 조회
  const [investorMap, indicatorMap, dailyPricesMap] = await Promise.all([
    fetchBulkInvestorData(unique, 20),
    fetchBulkIndicators(unique, 20),
    fetchAllDailyPrices(unique),
  ]);

  // 1. stock_cache 수급 + 지표 업데이트
  const cacheUpdates: Record<string, unknown>[] = [];
  for (const symbol of unique) {
    const inv = investorMap.get(symbol);
    const ind = indicatorMap.get(symbol);
    if (!inv && !ind) continue;

    const update: Record<string, unknown> = { symbol };

    if (inv) {
      update.foreign_net_qty = inv.foreign_net;
      update.institution_net_qty = inv.institution_net;
      update.foreign_net_5d = inv.foreign_net_5d;
      update.institution_net_5d = inv.institution_net_5d;
      update.foreign_streak = inv.foreign_streak;
      update.institution_streak = inv.institution_streak;
      update.investor_updated_at = nowKst.toISOString();
    }

    if (ind) {
      update.per = ind.per || undefined;
      update.pbr = ind.pbr || undefined;
      update.roe = ind.roe || undefined;
      update.high_52w = ind.high_52w || undefined;
      update.low_52w = ind.low_52w || undefined;
      update.dividend_yield = ind.dividend_yield || undefined;
      if (ind.forward_per !== null) update.forward_per = ind.forward_per;
      if (ind.target_price !== null) update.target_price = ind.target_price;
      if (ind.invest_opinion !== null) update.invest_opinion = ind.invest_opinion;
      update.consensus_updated_at = nowKst.toISOString();
    }

    // undefined 제거
    for (const key of Object.keys(update)) {
      if (update[key] === undefined) delete update[key];
    }

    cacheUpdates.push(update);
  }

  if (cacheUpdates.length > 0) {
    await supabase
      .from('stock_cache')
      .upsert(cacheUpdates, { onConflict: 'symbol' });
  }

  // 2. daily_prices 일봉 저장
  const allPrices: { symbol: string; date: string; open: number; high: number; low: number; close: number; volume: number }[] = [];
  for (const symbol of unique) {
    const prices = dailyPricesMap.get(symbol);
    if (!prices || prices.length === 0) continue;
    allPrices.push(...prices.map(p => ({ symbol, ...p })));
  }

  if (allPrices.length > 0) {
    // 500개씩 배치 upsert
    for (let i = 0; i < allPrices.length; i += 500) {
      await supabase
        .from('daily_prices')
        .upsert(allPrices.slice(i, i + 500), { onConflict: 'symbol,date' });
    }
  }

  // 3. 신호 집계 업데이트 (30일 BUY 신호 카운트)
  const thirtyDaysAgo = new Date(nowKst.getTime() - 30 * 86400000).toISOString().slice(0, 10);
  const { data: signalRows } = await supabase
    .from('signals')
    .select('symbol, timestamp, signal_type')
    .in('symbol', unique)
    .in('signal_type', ['BUY', 'BUY_FORECAST'])
    .gte('timestamp', `${thirtyDaysAgo}T00:00:00+09:00`);

  if (signalRows && signalRows.length > 0) {
    const countMap = new Map<string, { count: number; latestDate: string; latestType: string }>();
    for (const row of signalRows) {
      const sym = row.symbol as string;
      const existing = countMap.get(sym);
      if (!existing) {
        countMap.set(sym, { count: 1, latestDate: row.timestamp as string, latestType: row.signal_type as string });
      } else {
        existing.count++;
        if ((row.timestamp as string) > existing.latestDate) {
          existing.latestDate = row.timestamp as string;
          existing.latestType = row.signal_type as string;
        }
      }
    }

    const signalUpdates = [...countMap.entries()].map(([symbol, info]) => ({
      symbol,
      signal_count_30d: info.count,
      latest_signal_date: info.latestDate,
      latest_signal_type: info.latestType,
    }));

    if (signalUpdates.length > 0) {
      await supabase
        .from('stock_cache')
        .upsert(signalUpdates, { onConflict: 'symbol' });
    }
  }
}

/**
 * 여러 종목의 일봉을 네이버 fchart로 병렬 조회
 */
async function fetchAllDailyPrices(
  symbols: string[],
): Promise<Map<string, { date: string; open: number; high: number; low: number; close: number; volume: number }[]>> {
  const result = new Map<string, { date: string; open: number; high: number; low: number; close: number; volume: number }[]>();
  const CHUNK = 20;

  for (let i = 0; i < symbols.length; i += CHUNK) {
    const batch = symbols.slice(i, i + CHUNK);
    const results = await Promise.allSettled(
      batch.map(async (sym) => {
        const prices = await fetchNaverDailyPrices(sym, 90);
        return { sym, prices };
      })
    );
    for (const res of results) {
      if (res.status === 'fulfilled' && res.value.prices.length > 0) {
        result.set(res.value.sym, res.value.prices);
      }
    }
  }

  return result;
}
