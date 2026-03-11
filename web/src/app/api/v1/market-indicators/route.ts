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
    .select('*')
    .order('date', { ascending: false })
    .limit(10);

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

  // 각 지표별 최근 90일 min/max 조회
  const indicatorData: Record<string, { current: number; min90d: number; max90d: number }> = {};

  const ninetyDaysAgo = new Date();
  ninetyDaysAgo.setDate(ninetyDaysAgo.getDate() - 90);
  const sinceDate = ninetyDaysAgo.toISOString().slice(0, 10);

  for (const ind of latestIndicators || []) {
    const { data: history } = await supabase
      .from('market_indicators')
      .select('value')
      .eq('indicator_type', ind.indicator_type)
      .gte('date', sinceDate)
      .order('date', { ascending: true });

    if (history && history.length > 0) {
      const values = history.map((h: { value: number }) => Number(h.value));
      indicatorData[ind.indicator_type] = {
        current: Number(ind.value),
        min90d: Math.min(...values),
        max90d: Math.max(...values),
      };
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
    .select('*')
    .order('date', { ascending: false })
    .limit(90);

  return NextResponse.json({
    indicators: latestIndicators,
    weights,
    score: totalScore,
    breakdown,
    history: scoreHistory || [],
  });
}
