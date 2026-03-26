/**
 * 신호 수신 시 해당 종목의 수급/일봉/forward 데이터를 사전 조회하여 stock_cache + daily_prices에 저장
 *
 * Android Collector → signals/batch POST → 이 함수 비동기 호출
 * 크론에 의존하지 않고 신호 시점에 즉시 데이터를 확보하여 점수 계산 정확도 향상
 */

import { SupabaseClient } from '@supabase/supabase-js';
import { fetchBulkInvestorData, fetchNaverDailyPrices } from '@/lib/naver-stock-api';
import { fetchBulkIndicators } from '@/lib/krx-api';
import { extractSignalPrice } from '@/lib/signal-constants';
import { fetchBatchStockExtra } from '@/lib/naver-stock-extra';
import { fetchDartInfo } from '@/lib/dart-api';

export async function enrichSignalStocks(
  supabase: SupabaseClient,
  symbols: string[],
): Promise<void> {
  if (symbols.length === 0) return;

  const unique = [...new Set(symbols)];
  const nowKst = new Date(Date.now() + 9 * 60 * 60 * 1000);
  const todayStr = nowKst.toISOString().slice(0, 10);

  console.log(`[signal-enricher] 시작: ${unique.length}종목 (${unique.join(', ')})`);

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
      // null이면 API에서 데이터 없음 → 기존 값 유지. 값이 있으면(음수 포함) 저장
      if (ind.per !== null) update.per = ind.per;
      if (ind.pbr !== null) update.pbr = ind.pbr;
      if (ind.roe !== null) update.roe = ind.roe;
      if (ind.high_52w !== null) update.high_52w = ind.high_52w;
      if (ind.low_52w !== null) update.low_52w = ind.low_52w;
      if (ind.dividend_yield !== null) update.dividend_yield = ind.dividend_yield;
      if (ind.forward_per !== null) update.forward_per = ind.forward_per;
      if (ind.target_price !== null) update.target_price = ind.target_price;
      if (ind.invest_opinion !== null) update.invest_opinion = ind.invest_opinion;
      update.consensus_updated_at = nowKst.toISOString();
    }

    cacheUpdates.push(update);
  }

  if (cacheUpdates.length > 0) {
    const { error } = await supabase
      .from('stock_cache')
      .upsert(cacheUpdates, { onConflict: 'symbol' });
    if (error) console.error('[signal-enricher] stock_cache upsert 실패:', error.message);
    else console.log(`[signal-enricher] stock_cache 갱신: ${cacheUpdates.length}종목 (investor:${investorMap.size}, indicator:${indicatorMap.size})`);
  }

  // 1-b. 네이버 상장주식수/관리종목 + DART 재무 데이터
  try {
    const extraMap = await fetchBatchStockExtra(unique, 10);
    for (const [symbol, info] of extraMap.entries()) {
      await supabase
        .from('stock_cache')
        .update({ float_shares: info.floatShares, is_managed: info.isManaged })
        .eq('symbol', symbol);
    }
    console.log(`[signal-enricher] 네이버 추가: ${extraMap.size}종목`);

    // DART — dart_corp_code가 있는 종목만
    const { data: dartTargets } = await supabase
      .from('stock_cache')
      .select('symbol, dart_corp_code')
      .in('symbol', unique)
      .not('dart_corp_code', 'is', null);

    if (dartTargets && dartTargets.length > 0) {
      const dartResults = await Promise.allSettled(
        dartTargets.map(async (s: { symbol: string; dart_corp_code: string }) => ({
          symbol: s.symbol,
          info: await fetchDartInfo(s.dart_corp_code),
        })),
      );

      for (const r of dartResults) {
        if (r.status === 'fulfilled') {
          await supabase
            .from('stock_dart_info')
            .upsert({
              symbol: r.value.symbol,
              ...r.value.info,
              updated_at: new Date().toISOString(),
            }, { onConflict: 'symbol', ignoreDuplicates: false });
        }
      }
      console.log(`[signal-enricher] DART: ${dartTargets.length}종목`);
    }
  } catch (e) {
    console.error('[signal-enricher] 네이버/DART 보강 실패:', e);
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

  // 3. 신호 집계 업데이트 (30일 BUY 신호 카운트 + 최근 매수가)
  const thirtyDaysAgo = new Date(nowKst.getTime() - 30 * 86400000).toISOString().slice(0, 10);
  const { data: signalRows } = await supabase
    .from('signals')
    .select('symbol, timestamp, signal_type, raw_data')
    .in('symbol', unique)
    .in('signal_type', ['BUY', 'BUY_FORECAST'])
    .gte('timestamp', `${thirtyDaysAgo}T00:00:00+09:00`);

  if (signalRows && signalRows.length > 0) {
    const countMap = new Map<string, {
      count: number; latestDate: string; latestType: string; latestPrice: number | null;
    }>();
    for (const row of signalRows) {
      const sym = row.symbol as string;
      const existing = countMap.get(sym);
      if (!existing) {
        const price = extractSignalPrice(row.raw_data as Record<string, unknown> | null);
        countMap.set(sym, {
          count: 1, latestDate: row.timestamp as string,
          latestType: row.signal_type as string, latestPrice: price,
        });
      } else {
        existing.count++;
        if ((row.timestamp as string) > existing.latestDate) {
          existing.latestDate = row.timestamp as string;
          existing.latestType = row.signal_type as string;
          existing.latestPrice = extractSignalPrice(row.raw_data as Record<string, unknown> | null);
        }
      }
    }

    const signalUpdates = [...countMap.entries()].map(([symbol, info]) => ({
      symbol,
      signal_count_30d: info.count,
      latest_signal_date: info.latestDate,
      latest_signal_type: info.latestType,
      latest_signal_price: info.latestPrice,
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
