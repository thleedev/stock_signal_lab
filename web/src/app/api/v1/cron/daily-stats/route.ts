import { NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase';
import type { SignalSource, ExecutionType } from '@/types/signal';
import { getPortfolioValue } from '@/lib/strategy-engine/portfolio';
import { PORTFOLIO_CONFIG } from '@/lib/strategy-engine';

/**
 * Vercel Cron: 평일 18:00 KST (UTC 09:00)
 *
 * 1) 6개 포트폴리오 스냅샷 (3 AI × 2 전략)
 * 2) 통합 포트폴리오 스냅샷
 * 3) 일간 신호 통계 집계
 */
export async function GET(request: Request) {
  const authHeader = request.headers.get('authorization');
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const supabase = createServiceClient();
  const today = new Date().toISOString().slice(0, 10);

  try {
    const sources: SignalSource[] = ['lassi', 'stockbot', 'quant'];
    const execTypes: ExecutionType[] = ['lump', 'split'];

    // === 1. 포트폴리오 스냅샷 (6개) ===
    const combined: Record<ExecutionType, {
      total: number;
      breakdown: Record<string, { value: number; return_pct: number }>;
    }> = {
      lump: { total: 0, breakdown: {} },
      split: { total: 0, breakdown: {} },
    };

    for (const source of sources) {
      for (const execType of execTypes) {
        const pv = await getPortfolioValue(supabase, source, execType);
        const initialCash = PORTFOLIO_CONFIG.CASH_PER_STRATEGY;

        // 전일 스냅샷 조회
        const { data: prevSnapshot } = await supabase
          .from('portfolio_snapshots')
          .select('total_value')
          .eq('source', source)
          .eq('execution_type', execType)
          .lt('date', today)
          .order('date', { ascending: false })
          .limit(1)
          .single();

        const prevValue = prevSnapshot?.total_value ?? initialCash;
        const dailyReturn = prevValue > 0
          ? ((pv.total_value - prevValue) / prevValue) * 100
          : 0;
        const cumReturn = ((pv.total_value - initialCash) / initialCash) * 100;

        await supabase
          .from('portfolio_snapshots')
          .upsert({
            date: today,
            source,
            execution_type: execType,
            holdings: pv.holdings,
            cash: pv.cash,
            total_value: pv.total_value,
            daily_return_pct: Math.round(dailyReturn * 100) / 100,
            cumulative_return_pct: Math.round(cumReturn * 100) / 100,
          }, { onConflict: 'date,source,execution_type' });

        // 통합 집계용
        combined[execType].total += pv.total_value;
        combined[execType].breakdown[source] = {
          value: pv.total_value,
          return_pct: Math.round(cumReturn * 100) / 100,
        };
      }
    }

    // === 2. 통합 포트폴리오 스냅샷 (2개) ===
    const totalInitial = PORTFOLIO_CONFIG.INITIAL_CASH_PER_SOURCE * sources.length;

    for (const execType of execTypes) {
      const { data: prevCombined } = await supabase
        .from('combined_portfolio_snapshots')
        .select('total_value')
        .eq('execution_type', execType)
        .lt('date', today)
        .order('date', { ascending: false })
        .limit(1)
        .single();

      const prevTotal = prevCombined?.total_value ?? (PORTFOLIO_CONFIG.CASH_PER_STRATEGY * sources.length);
      const dailyReturn = prevTotal > 0
        ? ((combined[execType].total - prevTotal) / prevTotal) * 100
        : 0;
      const cumReturn = ((combined[execType].total - (PORTFOLIO_CONFIG.CASH_PER_STRATEGY * sources.length)) /
        (PORTFOLIO_CONFIG.CASH_PER_STRATEGY * sources.length)) * 100;

      await supabase
        .from('combined_portfolio_snapshots')
        .upsert({
          date: today,
          execution_type: execType,
          total_value: combined[execType].total,
          daily_return_pct: Math.round(dailyReturn * 100) / 100,
          cumulative_return_pct: Math.round(cumReturn * 100) / 100,
          breakdown: combined[execType].breakdown,
        }, { onConflict: 'date,execution_type' });
    }

    // === 3. 일간 신호 통계 ===
    for (const source of sources) {
      const { data: todaySignals } = await supabase
        .from('signals')
        .select('signal_type')
        .eq('source', source)
        .gte('timestamp', `${today}T00:00:00+09:00`)
        .lte('timestamp', `${today}T23:59:59+09:00`);

      const buyCount = todaySignals?.filter((s) =>
        s.signal_type === 'BUY' || s.signal_type === 'BUY_FORECAST'
      ).length ?? 0;
      const sellCount = todaySignals?.filter((s) =>
        s.signal_type === 'SELL' || s.signal_type === 'SELL_COMPLETE'
      ).length ?? 0;

      for (const execType of execTypes) {
        // 완결 거래(매수→매도 사이클) 수 + 적중률
        const stats = await calculateTradeStats(supabase, source, execType);

        await supabase
          .from('daily_signal_stats')
          .upsert({
            date: today,
            source,
            execution_type: execType,
            total_signals: todaySignals?.length ?? 0,
            buy_count: buyCount,
            sell_count: sellCount,
            realized_trades: stats.realizedTrades,
            hit_rate: stats.hitRate,
            avg_return: stats.avgReturn,
          }, { onConflict: 'date,source,execution_type' });
      }
    }

    return NextResponse.json({
      success: true,
      date: today,
      snapshots: 8, // 6 individual + 2 combined
    });
  } catch (e) {
    console.error('[daily-stats] Cron error:', e);
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}

/**
 * 완결된 매수→매도 사이클 통계
 */
async function calculateTradeStats(
  supabase: ReturnType<typeof createServiceClient>,
  source: string,
  execType: string
): Promise<{ realizedTrades: number; hitRate: number; avgReturn: number }> {
  // trade_group_id가 있는 거래에서 매수+매도가 모두 존재하는 그룹
  const { data: trades } = await supabase
    .from('virtual_trades')
    .select('symbol, side, price, quantity')
    .eq('source', source)
    .eq('execution_type', execType);

  if (!trades || trades.length === 0) {
    return { realizedTrades: 0, hitRate: 0, avgReturn: 0 };
  }

  // 종목별 매수/매도 집계
  const bySymbol = new Map<string, {
    buyAmount: number; buyQty: number;
    sellAmount: number; sellQty: number;
  }>();

  for (const t of trades) {
    const s = bySymbol.get(t.symbol) ?? {
      buyAmount: 0, buyQty: 0,
      sellAmount: 0, sellQty: 0,
    };
    if (t.side === 'BUY') {
      s.buyAmount += t.price * t.quantity;
      s.buyQty += t.quantity;
    } else {
      s.sellAmount += t.price * t.quantity;
      s.sellQty += t.quantity;
    }
    bySymbol.set(t.symbol, s);
  }

  // 완결 사이클: 매도 수량 > 0인 종목
  let realized = 0;
  let wins = 0;
  let totalReturn = 0;

  for (const [, s] of bySymbol) {
    if (s.sellQty > 0 && s.buyQty > 0) {
      realized++;
      const avgBuy = s.buyAmount / s.buyQty;
      const avgSell = s.sellAmount / s.sellQty;
      const ret = ((avgSell - avgBuy) / avgBuy) * 100;
      totalReturn += ret;
      if (ret > 0) wins++;
    }
  }

  return {
    realizedTrades: realized,
    hitRate: realized > 0 ? Math.round((wins / realized) * 10000) / 100 : 0,
    avgReturn: realized > 0 ? Math.round((totalReturn / realized) * 100) / 100 : 0,
  };
}
