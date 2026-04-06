import { supabase } from '../shared/supabase.js';
import { log } from '../shared/logger.js';

const FCHART_URL = 'https://fchart.stock.naver.com/sise.nhn';
const CHUNK_SIZE = 50;
const CHUNK_DELAY_MS = 100;

interface NaverCandle {
  date: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

async function fetchCandles(symbol: string, days: number): Promise<NaverCandle[]> {
  const url = `${FCHART_URL}?symbol=${symbol}&timeframe=day&count=${days}&requestType=0`;
  const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
  if (!res.ok) return [];
  const text = await res.text();

  const candles: NaverCandle[] = [];
  const matches = text.matchAll(/data="(\d{8})\|(\d+)\|(\d+)\|(\d+)\|(\d+)\|(\d+)"/g);
  for (const m of matches) {
    candles.push({
      date: m[1],
      open: parseInt(m[2]),
      high: parseInt(m[3]),
      low: parseInt(m[4]),
      close: parseInt(m[5]),
      volume: parseInt(m[6]),
    });
  }
  return candles;
}

async function fetchAndUpsertChunk(
  symbols: string[],
  date: string,
): Promise<{ ok: number; fail: number }> {
  let ok = 0, fail = 0;
  const dateCompact = date.replace(/-/g, '');

  const results = await Promise.allSettled(
    symbols.map(sym => fetchCandles(sym, 5))
  );

  const rows: Record<string, unknown>[] = [];
  results.forEach((r, i) => {
    if (r.status === 'rejected') { fail++; return; }
    const today = r.value.find(c => c.date === dateCompact);
    if (!today) { fail++; return; }
    ok++;
    rows.push({
      symbol: symbols[i],
      date,
      open: today.open,
      high: today.high,
      low: today.low,
      close: today.close,
      volume: today.volume,
      is_provisional: false,
    });
  });

  if (rows.length > 0) {
    const { error } = await supabase
      .from('daily_prices')
      .upsert(rows, { onConflict: 'symbol,date' });
    if (error) log('step1', `upsert 오류: ${error.message}`);
  }

  return { ok, fail };
}

export async function runStep1DailyPrices(opts: {
  mode: 'full' | 'repair';
  date: string;
}): Promise<{ collected: number; errors: string[] }> {
  const { mode, date } = opts;
  log('step1', `일봉 수집 시작 mode=${mode} date=${date}`);

  let symbols: string[];

  if (mode === 'repair') {
    // repair 모드: stock_cache에 있지만 daily_prices에 없는 종목만 수집
    const { data: allSymbols } = await supabase
      .from('stock_cache')
      .select('symbol')
      .not('current_price', 'is', null);
    const { data: existing } = await supabase
      .from('daily_prices')
      .select('symbol')
      .eq('date', date);
    const existingSet = new Set((existing ?? []).map(r => r.symbol as string));
    symbols = (allSymbols ?? []).map(r => r.symbol as string).filter(s => !existingSet.has(s));
    log('step1', `repair 대상: ${symbols.length}종목`);
  } else {
    // full 모드: stock_cache 전종목 수집
    const { data } = await supabase
      .from('stock_cache')
      .select('symbol')
      .not('current_price', 'is', null);
    symbols = (data ?? []).map(r => r.symbol as string);
    log('step1', `full 대상: ${symbols.length}종목`);
  }

  let totalOk = 0, totalFail = 0;
  for (let i = 0; i < symbols.length; i += CHUNK_SIZE) {
    const chunk = symbols.slice(i, i + CHUNK_SIZE);
    const { ok, fail } = await fetchAndUpsertChunk(chunk, date);
    totalOk += ok;
    totalFail += fail;

    // 10청크마다 진행 상황 로깅
    if ((i / CHUNK_SIZE) % 10 === 0) {
      log('step1', `진행 ${i + chunk.length}/${symbols.length} (성공:${totalOk} 실패:${totalFail})`);
    }
    if (i + CHUNK_SIZE < symbols.length) {
      await new Promise(r => setTimeout(r, CHUNK_DELAY_MS));
    }
  }

  log('step1', `완료: 성공=${totalOk} 실패=${totalFail}`);
  return {
    collected: totalOk,
    errors: totalFail > 0 ? [`일봉 누락 ${totalFail}종목`] : [],
  };
}
