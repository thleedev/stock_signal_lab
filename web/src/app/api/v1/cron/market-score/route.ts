import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase';
import {
  calculateEventRiskScore,
  calculateCombinedScore,
  calculateMarketScore,
} from '@/lib/market-score';
import { calculateRiskIndex } from '@/lib/market-thresholds';
import type { MarketEvent } from '@/types/market-event';
import type { IndicatorWeight } from '@/types/market';

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

  // 1) 90일 윈도우 지표 (현재값 + min/max 산정)
  const since = new Date();
  since.setDate(since.getDate() - 90);
  const sinceStr = since.toISOString().slice(0, 10);

  const { data: rawIndicators, error: indError } = await supabase
    .from('market_indicators')
    .select('indicator_type, value, date')
    .gte('date', sinceStr)
    .order('date', { ascending: false });

  if (indError) {
    return NextResponse.json({ error: indError.message }, { status: 500 });
  }

  const valueMap: Record<string, number> = {};
  const minMaxMap: Record<string, { current: number; min90d: number; max90d: number }> = {};
  for (const row of rawIndicators ?? []) {
    const t = row.indicator_type as string;
    const v = Number(row.value);
    if (!Number.isFinite(v)) continue;
    if (!(t in valueMap)) valueMap[t] = v; // 첫 행이 가장 최근(desc 정렬)
    const cur = minMaxMap[t];
    if (!cur) {
      minMaxMap[t] = { current: v, min90d: v, max90d: v };
    } else {
      cur.min90d = Math.min(cur.min90d, v);
      cur.max90d = Math.max(cur.max90d, v);
    }
  }
  // current 보정: 첫 row가 desc 첫 행이므로 valueMap[t] 가 곧 current
  for (const t of Object.keys(minMaxMap)) {
    minMaxMap[t].current = valueMap[t];
  }

  const { riskIndex, breakdown: riskBreakdown, dangerCount, validCount } = calculateRiskIndex(valueMap);

  // 1-1) total_score 계산 (가중치 + 90일 정규화)
  const { data: weightRows } = await supabase.from('indicator_weights').select('*');
  const weights = ((weightRows ?? []) as IndicatorWeight[]);
  const { totalScore: computedTotal, breakdown: scoreBreakdown } =
    calculateMarketScore(minMaxMap, weights);
  const weightsSnapshot: Record<string, number> = {};
  for (const w of weights) weightsSnapshot[w.indicator_type] = w.weight;

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

  // 3) 오늘자 행: 항상 새로 계산한 total_score / breakdown 사용
  const totalScore = weights.length > 0 ? computedTotal : 50;
  const finalBreakdown = weights.length > 0 ? scoreBreakdown : riskBreakdown;
  const combinedScore = calculateCombinedScore(Number(totalScore), eventRiskScore);

  // 4) Upsert (breakdown / weights_snapshot NOT NULL)
  const { error: upsertError } = await supabase
    .from('market_score_history')
    .upsert(
      {
        date: today,
        total_score: totalScore,
        breakdown: finalBreakdown,
        weights_snapshot: weightsSnapshot,
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
