import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase';
import { calculateEventRiskScore, calculateCombinedScore } from '@/lib/market-score';
import { calculateRiskIndex } from '@/lib/market-thresholds';
import type { MarketEvent } from '@/types/market-event';

export const dynamic = 'force-dynamic';
export const maxDuration = 30;

/**
 * 시황 점수 보강 cron
 * - calculateRiskIndex(절대 임계값 기반 위험 지수)
 * - calculateEventRiskScore(향후 7일 이벤트 가중)
 * - calculateCombinedScore(total_score × 0.7 + event_risk × 0.3)
 *
 * fetch-market-indicators 스크립트가 total_score/breakdown을 먼저 채우고,
 * 본 cron은 그 위에 event_risk_score/risk_index/combined_score를 덮어쓴다.
 */
export async function GET(request: NextRequest) {
  const authHeader = request.headers.get('authorization');
  if (process.env.CRON_SECRET && authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const supabase = createServiceClient();
  const today = new Date().toISOString().slice(0, 10);
  const in30 = new Date();
  in30.setDate(in30.getDate() + 30);
  const in30Str = in30.toISOString().slice(0, 10);

  // 1) 최신 지표 값 (각 indicator_type 의 가장 최근 값)
  const { data: rawIndicators, error: indError } = await supabase
    .from('market_indicators')
    .select('indicator_type, value, date')
    .order('date', { ascending: false });

  if (indError) {
    return NextResponse.json({ error: indError.message }, { status: 500 });
  }

  const valueMap: Record<string, number> = {};
  const seen = new Set<string>();
  for (const row of rawIndicators ?? []) {
    if (seen.has(row.indicator_type)) continue;
    seen.add(row.indicator_type);
    valueMap[row.indicator_type] = Number(row.value);
  }

  const { riskIndex, dangerCount, validCount } = calculateRiskIndex(valueMap);

  // 2) 향후 30일 이벤트 → event_risk_score
  const { data: events, error: evError } = await supabase
    .from('market_events')
    .select('*')
    .gte('event_date', today)
    .lte('event_date', in30Str);

  if (evError) {
    return NextResponse.json({ error: evError.message }, { status: 500 });
  }

  const eventRiskScore = calculateEventRiskScore((events ?? []) as MarketEvent[]);

  // 3) 오늘자 market_score_history 행 (total_score 기존값 활용)
  const { data: existing } = await supabase
    .from('market_score_history')
    .select('date, total_score')
    .eq('date', today)
    .maybeSingle();

  const totalScore = existing?.total_score ?? 50;
  const combinedScore = calculateCombinedScore(Number(totalScore), eventRiskScore);

  // 4) Upsert
  const { error: upsertError } = await supabase
    .from('market_score_history')
    .upsert(
      {
        date: today,
        total_score: totalScore,
        event_risk_score: eventRiskScore,
        combined_score: combinedScore,
        risk_index: riskIndex,
      },
      { onConflict: 'date' }
    );

  if (upsertError) {
    return NextResponse.json({ error: upsertError.message }, { status: 500 });
  }

  return NextResponse.json({
    success: true,
    date: today,
    risk_index: riskIndex,
    event_risk_score: eventRiskScore,
    combined_score: combinedScore,
    total_score: totalScore,
    indicator_count: validCount,
    danger_count: dangerCount,
    upcoming_events: events?.length ?? 0,
  });
}
