import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error('Missing Supabase environment variables.');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

const SYMBOL_PAGE_SIZE = 1000;
const FETCH_CONCURRENCY = 20;
const UPSERT_BATCH_SIZE = 1000;
const NAVER_DAYS = 90;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchAllSymbols() {
  const symbols = [];
  let from = 0;

  while (true) {
    const { data, error } = await supabase
      .from('stock_cache')
      .select('symbol')
      .order('symbol', { ascending: true })
      .range(from, from + SYMBOL_PAGE_SIZE - 1);

    if (error) throw error;
    if (!data || data.length === 0) break;

    for (const row of data) {
      if (row.symbol) symbols.push(row.symbol);
    }

    if (data.length < SYMBOL_PAGE_SIZE) break;
    from += SYMBOL_PAGE_SIZE;
  }

  return symbols;
}

async function fetchNaverDailyPrices(symbol, days = NAVER_DAYS) {
  const res = await fetch(
    `https://fchart.stock.naver.com/sise.nhn?symbol=${symbol}&timeframe=day&count=${days}&requestType=0`,
    { headers: { 'User-Agent': 'Mozilla/5.0' } },
  );

  if (!res.ok) {
    throw new Error(`HTTP ${res.status}`);
  }

  const xml = await res.text();
  const matches = xml.matchAll(/<item data="([^"]+)"/g);
  const rows = [];

  for (const match of matches) {
    const parts = match[1].split('|');
    if (parts.length < 6) continue;

    const [rawDate, open, high, low, close, volume] = parts;
    if (!rawDate || rawDate.length !== 8) continue;

    const closeVal = parseInt(close, 10);
    if (!Number.isFinite(closeVal) || closeVal <= 0) continue;

    rows.push({
      symbol,
      date: `${rawDate.slice(0, 4)}-${rawDate.slice(4, 6)}-${rawDate.slice(6, 8)}`,
      open: parseInt(open, 10) || closeVal,
      high: parseInt(high, 10) || closeVal,
      low: parseInt(low, 10) || closeVal,
      close: closeVal,
      volume: parseInt(volume, 10) || 0,
    });
  }

  return rows;
}

async function upsertRows(rows) {
  for (let i = 0; i < rows.length; i += UPSERT_BATCH_SIZE) {
    const batch = rows.slice(i, i + UPSERT_BATCH_SIZE);
    const { error } = await supabase
      .from('daily_prices')
      .upsert(batch, { onConflict: 'symbol,date' });

    if (error) {
      throw error;
    }
  }
}

async function main() {
  const startedAt = Date.now();
  const symbols = await fetchAllSymbols();
  const failures = [];
  let processedSymbols = 0;
  let savedRows = 0;

  console.log(`[backfill] symbols=${symbols.length}`);

  for (let i = 0; i < symbols.length; i += FETCH_CONCURRENCY) {
    const chunk = symbols.slice(i, i + FETCH_CONCURRENCY);
    const results = await Promise.allSettled(
      chunk.map(async (symbol) => ({
        symbol,
        rows: await fetchNaverDailyPrices(symbol),
      })),
    );

    const upsertPayload = [];

    for (const result of results) {
      if (result.status === 'fulfilled') {
        processedSymbols += 1;
        upsertPayload.push(...result.value.rows);
        savedRows += result.value.rows.length;
      } else {
        processedSymbols += 1;
        const reason = result.reason instanceof Error ? result.reason.message : String(result.reason);
        failures.push(reason);
      }
    }

    if (upsertPayload.length > 0) {
      await upsertRows(upsertPayload);
    }

    const elapsedSec = ((Date.now() - startedAt) / 1000).toFixed(1);
    console.log(
      `[backfill] ${processedSymbols}/${symbols.length} symbols, rows=${savedRows}, failures=${failures.length}, elapsed=${elapsedSec}s`,
    );

    if (i + FETCH_CONCURRENCY < symbols.length) {
      await sleep(200);
    }
  }

  const elapsedSec = ((Date.now() - startedAt) / 1000).toFixed(1);
  console.log(
    JSON.stringify(
      {
        success: true,
        symbols: symbols.length,
        savedRows,
        failures: failures.length,
        elapsedSec,
      },
      null,
      2,
    ),
  );
}

main().catch((error) => {
  console.error('[backfill] failed:', error);
  process.exit(1);
});
