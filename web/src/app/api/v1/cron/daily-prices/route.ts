import { NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase';
import { getDailyPrices, delay } from '@/lib/kis-api';
import { fetchKrxShortSell } from '@/lib/krx-shortsell-api';
import { fetchBulkInvestorData } from '@/lib/naver-stock-api';

/**
 * Vercel Cron: 평일 16:00 KST (UTC 07:00)
 *
 * 1) 오늘 신호 종목 + 보유 종목의 일봉 수집
 * 2) 분할매매 예약 실행 (pending → executed)
 */
export async function GET(request: Request) {
  // Vercel Cron 인증
  const authHeader = request.headers.get('authorization');
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const supabase = createServiceClient();
  const today = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
  const todayCompact = today.replace(/-/g, '');         // YYYYMMDD
  // 30일 전
  const d30 = new Date(Date.now() - 30 * 86400000);
  const startDate = d30.toISOString().slice(0, 10).replace(/-/g, '');

  try {
    // === 1. 수집 대상 종목 추출 ===

    // 오늘 신호 종목
    const { data: todaySignals } = await supabase
      .from('signals')
      .select('symbol')
      .gte('timestamp', `${today}T00:00:00+09:00`)
      .not('symbol', 'is', null);

    // 현재 보유 종목 (virtual_trades에서 미청산)
    const { data: openTrades } = await supabase
      .from('virtual_trades')
      .select('symbol')
      .eq('side', 'BUY');

    // 분할매매 예약 종목
    const { data: pendingSchedule } = await supabase
      .from('split_trade_schedule')
      .select('symbol')
      .eq('status', 'pending');

    // 중복 제거
    const symbols = new Set<string>();
    todaySignals?.forEach((s) => s.symbol && symbols.add(s.symbol));
    openTrades?.forEach((t) => symbols.add(t.symbol));
    pendingSchedule?.forEach((s) => symbols.add(s.symbol));

    console.log(`[daily-prices] ${symbols.size} symbols to fetch`);

    // === 2. KIS API로 일봉 수집 ===
    let savedCount = 0;

    for (const symbol of symbols) {
      const prices = await getDailyPrices(symbol, startDate, todayCompact);
      if (prices.length === 0) {
        console.warn(`[daily-prices] No data for ${symbol}`);
        continue;
      }

      const rows = prices.map((p) => ({
        symbol,
        date: p.date,
        open: p.open,
        high: p.high,
        low: p.low,
        close: p.close,
        volume: p.volume,
      }));

      const { error } = await supabase
        .from('daily_prices')
        .upsert(rows, { onConflict: 'symbol,date' });

      if (error) {
        console.error(`[daily-prices] Upsert failed for ${symbol}:`, error);
      } else {
        savedCount += rows.length;
      }

      // KIS API rate limit: 초당 20건 → 500ms 딜레이
      await delay(500);
    }

    // === 3. 공매도 비율 수집 (KRX) → stock_cache 업데이트 ===
    const symbolsArr = [...symbols];
    const shortSellMap = await fetchKrxShortSell();
    let shortSellUpdated = 0;
    if (shortSellMap.size > 0 && symbolsArr.length > 0) {
      const now = new Date().toISOString();
      const shortSellUpdates = symbolsArr
        .filter((sym) => shortSellMap.has(sym))
        .map((sym) => ({
          symbol: sym,
          short_sell_ratio: shortSellMap.get(sym)!,
          short_sell_updated_at: now,
        }));
      if (shortSellUpdates.length > 0) {
        // update only (기존 행이 없는 경우 무시 — stock_cache는 별도 프로세스에서 채워짐)
        for (const row of shortSellUpdates) {
          await supabase
            .from('stock_cache')
            .update({ short_sell_ratio: row.short_sell_ratio, short_sell_updated_at: row.short_sell_updated_at })
            .eq('symbol', row.symbol);
        }
        shortSellUpdated = shortSellUpdates.length;
        console.log(`[daily-prices] Short-sell updated: ${shortSellUpdated} symbols`);
      }
    }

    // === 4. 투자자별 매매동향 (Naver) → stock_cache 업데이트 ===
    let investorUpdated = 0;
    if (symbolsArr.length > 0) {
      const investorMap = await fetchBulkInvestorData(symbolsArr);
      const now = new Date().toISOString();
      for (const [sym, d] of investorMap) {
        await supabase
          .from('stock_cache')
          .update({
            foreign_net_qty: d.foreign_net,
            institution_net_qty: d.institution_net,
            investor_updated_at: now,
          })
          .eq('symbol', sym);
      }
      investorUpdated = investorMap.size;
      console.log(`[daily-prices] Investor data updated: ${investorUpdated} symbols`);
    }

    // === 5. 분할매매 예약 실행 ===
    const splitResult = await executePendingSplitTrades(supabase, today);

    return NextResponse.json({
      success: true,
      date: today,
      symbols: symbols.size,
      prices_saved: savedCount,
      short_sell_updated: shortSellUpdated,
      investor_updated: investorUpdated,
      splits_executed: splitResult,
    });
  } catch (e) {
    console.error('[daily-prices] Cron error:', e);
    return NextResponse.json(
      { error: String(e) },
      { status: 500 }
    );
  }
}

/**
 * 오늘 예정된 분할매매 예약을 실행
 */
async function executePendingSplitTrades(
  supabase: ReturnType<typeof createServiceClient>,
  today: string
): Promise<number> {
  const { data: pending } = await supabase
    .from('split_trade_schedule')
    .select('*')
    .eq('scheduled_date', today)
    .eq('status', 'pending');

  if (!pending || pending.length === 0) return 0;

  let executed = 0;

  for (const schedule of pending) {
    // 해당 종목의 오늘 종가 조회
    const { data: priceData } = await supabase
      .from('daily_prices')
      .select('close')
      .eq('symbol', schedule.symbol)
      .eq('date', today)
      .single();

    const price = priceData?.close;
    if (!price) {
      console.warn(`[split] No price for ${schedule.symbol} on ${today}`);
      continue;
    }

    // virtual_trades에 거래 기록
    const { error: tradeError } = await supabase
      .from('virtual_trades')
      .insert({
        source: schedule.source,
        execution_type: 'split',
        symbol: schedule.symbol,
        side: schedule.side,
        price,
        quantity: schedule.quantity,
        split_seq: schedule.split_seq,
        signal_id: schedule.signal_id,
        trade_group_id: schedule.trade_group_id,
        note: `분할 ${schedule.split_seq}회차 (${today} 종가)`,
      });

    if (tradeError) {
      console.error(`[split] Trade insert failed:`, tradeError);
      continue;
    }

    // 스케줄 상태 업데이트
    await supabase
      .from('split_trade_schedule')
      .update({
        status: 'executed',
        executed_price: price,
        executed_at: new Date().toISOString(),
      })
      .eq('id', schedule.id);

    executed++;
  }

  console.log(`[split] Executed ${executed}/${pending.length} schedules`);
  return executed;
}
