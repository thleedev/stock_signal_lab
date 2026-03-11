import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase';
import { getStockIndicators, delay } from '@/lib/kis-api';

export const dynamic = 'force-dynamic';
export const maxDuration = 300; // 5분 타임아웃

export async function POST(request: NextRequest) {
  const authHeader = request.headers.get('authorization');
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  // 장 운영시간 체크 (KST 08:00~20:00)
  const now = new Date();
  const kstHour = (now.getUTCHours() + 9) % 24;
  if (kstHour < 8 || kstHour >= 20) {
    return NextResponse.json({ skipped: true, reason: '장 운영시간 외 (08~20시)' });
  }

  const supabase = createServiceClient();
  const startTime = Date.now();

  // Step 1: 전체 종목 symbol 조회
  const { data: stocks, error } = await supabase
    .from('stock_cache')
    .select('symbol')
    .order('symbol');

  if (error || !stocks) {
    return NextResponse.json({ error: error?.message || 'No stocks' }, { status: 500 });
  }

  let updated = 0;
  let failed = 0;

  // Step 2: 배치 처리 (10건/초)
  const BATCH_SIZE = 10;
  for (let i = 0; i < stocks.length; i += BATCH_SIZE) {
    const batch = stocks.slice(i, i + BATCH_SIZE);

    const results = await Promise.allSettled(
      batch.map(async (s) => {
        const data = await getStockIndicators(s.symbol);
        if (!data) throw new Error(`Failed: ${s.symbol}`);

        // 변동 감지: 가격/거래량 변동 없으면 스킵
        const { data: cached } = await supabase
          .from('stock_cache')
          .select('current_price, volume')
          .eq('symbol', s.symbol)
          .single();

        if (cached && cached.current_price === data.price && cached.volume === data.volume) {
          return { symbol: s.symbol, action: 'skipped' as const };
        }

        await supabase.from('stock_cache').update({
          current_price: data.price,
          price_change: data.price_change,
          price_change_pct: data.price_change_pct,
          volume: data.volume,
          market_cap: data.market_cap,
          per: data.per,
          pbr: data.pbr,
          eps: data.eps,
          bps: data.bps,
          high_52w: data.high_52w,
          low_52w: data.low_52w,
          dividend_yield: data.dividend_yield,
          updated_at: new Date().toISOString(),
        }).eq('symbol', s.symbol);

        return { symbol: s.symbol, action: 'updated' as const };
      })
    );

    for (const r of results) {
      if (r.status === 'fulfilled') updated++;
      else failed++;
    }

    // Rate limit 대기
    if (i + BATCH_SIZE < stocks.length) {
      await delay(1100);
    }
  }

  // Step 3: AI 신호 집계
  const thirtyDaysAgo = new Date();
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
  const since30d = thirtyDaysAgo.toISOString();

  const { data: signalCounts } = await supabase
    .from('signals')
    .select('symbol, signal_type, timestamp')
    .gte('timestamp', since30d)
    .order('timestamp', { ascending: false });

  if (signalCounts) {
    const symbolSignals: Record<string, { count: number; latestType: string; latestDate: string }> = {};
    for (const s of signalCounts) {
      if (!s.symbol) continue;
      if (!symbolSignals[s.symbol]) {
        symbolSignals[s.symbol] = { count: 0, latestType: s.signal_type, latestDate: s.timestamp };
      }
      symbolSignals[s.symbol].count++;
    }

    for (const [symbol, info] of Object.entries(symbolSignals)) {
      await supabase.from('stock_cache').update({
        signal_count_30d: info.count,
        latest_signal_type: info.latestType,
        latest_signal_date: info.latestDate,
      }).eq('symbol', symbol);
    }
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

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);

  return NextResponse.json({
    success: true,
    updated,
    failed,
    total: stocks.length,
    elapsed: `${elapsed}초`,
  });
}
