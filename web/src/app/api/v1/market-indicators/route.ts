import { NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase';
import { calculateMarketScore } from '@/lib/market-score';
import type { IndicatorWeight } from '@/types/market';

export const dynamic = 'force-dynamic';

export async function GET() {
  const supabase = createServiceClient();

  // 최신 지표 데이터 조회
  const { data: latestIndicators, error: indError } = await supabase
    .from('market_indicators')
    .select('indicator_type, value, change_pct, prev_value, date')
    .order('date', { ascending: false })
    .limit(20);

  if (indError) {
    return NextResponse.json({ error: indError.message }, { status: 500 });
  }

  // 가중치 조회
  const { data: weights, error: wError } = await supabase
    .from('indicator_weights')
    .select('*');

  if (wError) {
    return NextResponse.json({ error: wError.message }, { status: 500 });
  }

  // 각 지표별 최근 90일 min/max 조회 (단일 배치 쿼리)
  const indicatorData: Record<string, { current: number; min90d: number; max90d: number }> = {};

  const ninetyDaysAgo = new Date();
  ninetyDaysAgo.setDate(ninetyDaysAgo.getDate() - 90);
  const sinceDate = ninetyDaysAgo.toISOString().slice(0, 10);

  const indicatorTypes = (latestIndicators || []).map((ind) => ind.indicator_type);
  if (indicatorTypes.length > 0) {
    const { data: allHistory } = await supabase
      .from('market_indicators')
      .select('indicator_type, value')
      .in('indicator_type', indicatorTypes)
      .gte('date', sinceDate);

    // 타입별 그룹핑 후 min/max 계산
    const historyByType: Record<string, number[]> = {};
    for (const row of allHistory || []) {
      if (!historyByType[row.indicator_type]) historyByType[row.indicator_type] = [];
      historyByType[row.indicator_type].push(Number(row.value));
    }

    for (const ind of latestIndicators || []) {
      const values = historyByType[ind.indicator_type];
      if (values && values.length > 0) {
        indicatorData[ind.indicator_type] = {
          current: Number(ind.value),
          min90d: Math.min(...values),
          max90d: Math.max(...values),
        };
      }
    }
  }

  // 종합 점수 계산
  const { totalScore, breakdown } = calculateMarketScore(
    indicatorData,
    (weights || []) as IndicatorWeight[]
  );

  // 최신 점수 히스토리
  const { data: scoreHistory } = await supabase
    .from('market_score_history')
    .select('date, total_score, combined_score, event_risk_score, risk_index, breakdown')
    .order('date', { ascending: false })
    .limit(90);

  return NextResponse.json({
    indicators: latestIndicators,
    weights,
    score: totalScore,
    breakdown,
    history: scoreHistory || [],
  }, {
    headers: { 'Cache-Control': 'public, s-maxage=300, stale-while-revalidate=600' },
  });
}
