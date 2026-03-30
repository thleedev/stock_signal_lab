import { NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase';
import { fetchNaverDailyPrices } from '@/lib/naver-stock-api';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

const MIN_REQUIRED_HISTORY = 60;
const SYMBOL_PAGE_SIZE = 200;
const FETCH_CONCURRENCY = 20;
const NAVER_HISTORY_DAYS = 90;
const UPSERT_BATCH_SIZE = 1000;

export async function GET(request: Request) {
  const authHeader = request.headers.get('authorization');
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const supabase = createServiceClient();
  const startedAt = Date.now();
  const lap = (label: string) =>
    console.log(`[daily-repair] ${label} (${((Date.now() - startedAt) / 1000).toFixed(1)}초)`);

  try {
    const allSymbols = await fetchAllSymbols(supabase);
    lap(`심볼 ${allSymbols.length}개 로드`);

    let inspected = 0;
    let repairedSymbols = 0;
    let savedRows = 0;

    for (let i = 0; i < allSymbols.length; i += SYMBOL_PAGE_SIZE) {
      const chunk = allSymbols.slice(i, i + SYMBOL_PAGE_SIZE);
      const historyCounts = await fetchRecentHistoryCounts(supabase, chunk);
      const missingSymbols = chunk.filter((symbol) => (historyCounts.get(symbol) ?? 0) < MIN_REQUIRED_HISTORY);

      inspected += chunk.length;

      if (missingSymbols.length === 0) {
        continue;
      }

      for (let j = 0; j < missingSymbols.length; j += FETCH_CONCURRENCY) {
        const fetchChunk = missingSymbols.slice(j, j + FETCH_CONCURRENCY);
        const results = await Promise.allSettled(
          fetchChunk.map(async (symbol) => ({
            symbol,
            prices: await fetchNaverDailyPrices(symbol, NAVER_HISTORY_DAYS),
          })),
        );

        const rows: Array<{
          symbol: string;
          date: string;
          open: number;
          high: number;
          low: number;
          close: number;
          volume: number;
        }> = [];

        for (const result of results) {
          if (result.status !== 'fulfilled') continue;
          if (result.value.prices.length === 0) continue;

          repairedSymbols += 1;
          rows.push(
            ...result.value.prices.map((price) => ({
              symbol: result.value.symbol,
              date: price.date,
              open: price.open,
              high: price.high,
              low: price.low,
              close: price.close,
              volume: price.volume,
            })),
          );
        }

        for (let k = 0; k < rows.length; k += UPSERT_BATCH_SIZE) {
          const batch = rows.slice(k, k + UPSERT_BATCH_SIZE);
          const { error } = await supabase
            .from('daily_prices')
            .upsert(batch, { onConflict: 'symbol,date' });

          if (error) {
            throw error;
          }

          savedRows += batch.length;
        }
      }
    }

    lap(`점검 ${inspected}개, 보정 ${repairedSymbols}개 종목`);

    return NextResponse.json({
      success: true,
      inspected_symbols: inspected,
      repaired_symbols: repairedSymbols,
      saved_rows: savedRows,
      min_required_history: MIN_REQUIRED_HISTORY,
      elapsed: `${((Date.now() - startedAt) / 1000).toFixed(1)}초`,
    });
  } catch (e) {
    console.error('[daily-repair] error:', e);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

async function fetchAllSymbols(
  supabase: ReturnType<typeof createServiceClient>,
): Promise<string[]> {
  const symbols: string[] = [];
  let from = 0;

  while (true) {
    const { data, error } = await supabase
      .from('stock_cache')
      .select('symbol')
      .order('symbol', { ascending: true })
      .range(from, from + 999);

    if (error) {
      throw error;
    }

    if (!data || data.length === 0) {
      break;
    }

    for (const row of data) {
      if (row.symbol) symbols.push(row.symbol);
    }

    if (data.length < 1000) {
      break;
    }

    from += 1000;
  }

  return symbols;
}

async function fetchRecentHistoryCounts(
  supabase: ReturnType<typeof createServiceClient>,
  symbols: string[],
): Promise<Map<string, number>> {
  const counts = new Map<string, number>();
  if (symbols.length === 0) return counts;

  let from = 0;

  while (true) {
    const { data, error } = await supabase
      .from('daily_prices')
      .select('symbol, date')
      .in('symbol', symbols)
      .order('symbol', { ascending: true })
      .order('date', { ascending: false })
      .range(from, from + 999);

    if (error) {
      throw error;
    }

    if (!data || data.length === 0) {
      break;
    }

    for (const row of data) {
      const symbol = row.symbol as string;
      counts.set(symbol, (counts.get(symbol) ?? 0) + 1);
    }

    if (data.length < 1000) {
      break;
    }

    from += 1000;
  }

  return counts;
}
