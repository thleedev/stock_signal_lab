import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase';

/**
 * GET /api/v1/performance
 *
 * 전략 성과 비교 (일시 vs 분할, 소스별)
 * Query: source, period (7d/30d/90d/all)
 */
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const source = searchParams.get('source');
  const period = searchParams.get('period') ?? '30d';

  const supabase = createServiceClient();

  // 기간 계산
  let dateFrom: string | null = null;
  if (period !== 'all') {
    const days = parseInt(period) || 30;
    const d = new Date(Date.now() - days * 86400000);
    dateFrom = d.toISOString().slice(0, 10);
  }

  try {
    // 포트폴리오 스냅샷 히스토리
    let query = supabase
      .from('portfolio_snapshots')
      .select('date, source, execution_type, total_value, daily_return_pct, cumulative_return_pct')
      .order('date', { ascending: true });

    if (source) query = query.eq('source', source);
    if (dateFrom) query = query.gte('date', dateFrom);

    const { data: snapshots } = await query;

    // 일간 통계
    let statsQuery = supabase
      .from('daily_signal_stats')
      .select('date, source, execution_type, total_signals, buy_count, sell_count, realized_trades, hit_rate, avg_return')
      .order('date', { ascending: false });

    if (source) statsQuery = statsQuery.eq('source', source);
    if (dateFrom) statsQuery = statsQuery.gte('date', dateFrom);

    const { data: stats } = await statsQuery;

    // 통합 스냅샷
    let combinedQuery = supabase
      .from('combined_portfolio_snapshots')
      .select('date, execution_type, total_value, daily_return_pct, cumulative_return_pct, breakdown')
      .order('date', { ascending: true });

    if (dateFrom) combinedQuery = combinedQuery.gte('date', dateFrom);

    const { data: combinedSnapshots } = await combinedQuery;

    // 최신 성과 요약
    const latest = snapshots?.reduce((acc, s) => {
      const key = `${s.source}_${s.execution_type}`;
      if (!acc[key] || s.date > acc[key].date) {
        acc[key] = s;
      }
      return acc;
    }, {} as Record<string, typeof snapshots[0]>);

    return NextResponse.json({
      period,
      source: source ?? 'all',
      latest_performance: latest ? Object.values(latest) : [],
      snapshots: snapshots ?? [],
      combined_snapshots: combinedSnapshots ?? [],
      signal_stats: stats ?? [],
    }, {
      headers: { 'Cache-Control': 'public, s-maxage=300, stale-while-revalidate=600' },
    });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
