import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase';

export const dynamic = 'force-dynamic';

/**
 * 일간 리포트 요약 생성
 * 매일 장 마감 후 1회 실행 (20:00)
 */
export async function POST(request: NextRequest) {
  const authHeader = request.headers.get('authorization');
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const supabase = createServiceClient();

  // KST 오늘 날짜
  const now = new Date();
  const kst = new Date(now.getTime() + 9 * 60 * 60 * 1000);
  const today = kst.toISOString().slice(0, 10);

  const dateStart = `${today}T00:00:00+09:00`;
  const dateEnd = `${today}T23:59:59+09:00`;

  // 오늘 신호 조회
  const { data: signals } = await supabase
    .from('signals')
    .select('symbol, name, source, signal_type, timestamp')
    .gte('timestamp', dateStart)
    .lt('timestamp', dateEnd);

  if (!signals || signals.length === 0) {
    return NextResponse.json({ success: true, message: '오늘 신호 없음' });
  }

  // 집계
  const sourceBreakdown: Record<string, { buy: number; sell: number }> = {};
  const buyStocks: Record<string, { name: string; count: number }> = {};
  const sellStocks: Record<string, { name: string; count: number }> = {};
  let buyCount = 0;
  let sellCount = 0;

  for (const s of signals) {
    const src = s.source;
    if (!sourceBreakdown[src]) sourceBreakdown[src] = { buy: 0, sell: 0 };

    const isBuy = ['BUY', 'BUY_FORECAST'].includes(s.signal_type);
    if (isBuy) {
      buyCount++;
      sourceBreakdown[src].buy++;
      if (!buyStocks[s.symbol]) buyStocks[s.symbol] = { name: s.name, count: 0 };
      buyStocks[s.symbol].count++;
    } else {
      sellCount++;
      sourceBreakdown[src].sell++;
      if (!sellStocks[s.symbol]) sellStocks[s.symbol] = { name: s.name, count: 0 };
      sellStocks[s.symbol].count++;
    }
  }

  // 상위 종목 (다소스 매수/매도)
  const topBuy = Object.entries(buyStocks)
    .sort(([, a], [, b]) => b.count - a.count)
    .slice(0, 10)
    .map(([symbol, info]) => ({ symbol, name: info.name, count: info.count }));

  const topSell = Object.entries(sellStocks)
    .sort(([, a], [, b]) => b.count - a.count)
    .slice(0, 10)
    .map(([symbol, info]) => ({ symbol, name: info.name, count: info.count }));

  // 시황 점수
  const { data: scoreData } = await supabase
    .from('market_score_history')
    .select('total_score')
    .eq('date', today)
    .single();

  const { error } = await supabase.from('daily_report_summary').upsert({
    date: today,
    total_signals: signals.length,
    buy_signals: buyCount,
    sell_signals: sellCount,
    source_breakdown: sourceBreakdown,
    top_buy_stocks: topBuy,
    top_sell_stocks: topSell,
    market_score: scoreData?.total_score ?? null,
  }, { onConflict: 'date' });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({
    success: true,
    date: today,
    total: signals.length,
    buy: buyCount,
    sell: sellCount,
  });
}
