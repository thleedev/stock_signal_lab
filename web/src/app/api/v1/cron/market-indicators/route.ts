import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase';
import { getQuote } from '@/lib/yahoo-finance';
import { calculateMarketScore } from '@/lib/market-score';
import { YAHOO_TICKERS, type IndicatorType, type IndicatorWeight } from '@/types/market';

export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  // Cron 인증
  const authHeader = request.headers.get('authorization');
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const supabase = createServiceClient();
  const today = new Date().toISOString().slice(0, 10);
  const results: Record<string, number> = {};

  // Step 1: Yahoo Finance 지표 수집
  for (const [type, ticker] of Object.entries(YAHOO_TICKERS)) {
    const quote = await getQuote(ticker);
    if (!quote) continue;

    // 전일 값 조회
    const { data: prev } = await supabase
      .from('market_indicators')
      .select('value')
      .eq('indicator_type', type)
      .lt('date', today)
      .order('date', { ascending: false })
      .limit(1)
      .single();

    const prevValue = prev ? Number(prev.value) : null;
    const changePct = prevValue ? ((quote.price - prevValue) / prevValue) * 100 : null;

    await supabase.from('market_indicators').upsert(
      {
        date: today,
        indicator_type: type,
        value: quote.price,
        prev_value: prevValue,
        change_pct: changePct,
        raw_data: { name: quote.name, previousClose: quote.previousClose },
      },
      { onConflict: 'date,indicator_type' }
    );

    results[type] = quote.price;
  }

  // Step 2: 종합 점수 계산
  const { data: weights } = await supabase
    .from('indicator_weights')
    .select('*');

  const ninetyDaysAgo = new Date();
  ninetyDaysAgo.setDate(ninetyDaysAgo.getDate() - 90);
  const sinceDate = ninetyDaysAgo.toISOString().slice(0, 10);

  const indicatorData: Record<string, { current: number; min90d: number; max90d: number }> = {};

  for (const type of Object.keys(results)) {
    const { data: history } = await supabase
      .from('market_indicators')
      .select('value')
      .eq('indicator_type', type)
      .gte('date', sinceDate);

    if (history && history.length > 0) {
      const values = history.map((h: { value: number }) => Number(h.value));
      indicatorData[type] = {
        current: results[type],
        min90d: Math.min(...values),
        max90d: Math.max(...values),
      };
    }
  }

  const { totalScore, breakdown } = calculateMarketScore(
    indicatorData,
    (weights || []) as IndicatorWeight[]
  );

  // Step 3: 점수 히스토리 저장
  const weightsSnapshot: Record<string, number> = {};
  for (const w of (weights || []) as IndicatorWeight[]) {
    weightsSnapshot[w.indicator_type] = w.weight;
  }

  await supabase.from('market_score_history').upsert(
    {
      date: today,
      total_score: totalScore,
      breakdown,
      weights_snapshot: weightsSnapshot,
    },
    { onConflict: 'date' }
  );

  // Step 4: 공포탐욕 지수 저장
  const vixData = indicatorData['VIX'];
  if (vixData) {
    const vixNormalized = vixData.max90d !== vixData.min90d
      ? ((vixData.current - vixData.min90d) / (vixData.max90d - vixData.min90d)) * 100
      : 50;
    const fearGreed = 100 - vixNormalized; // 간단 버전

    await supabase.from('market_indicators').upsert(
      {
        date: today,
        indicator_type: 'FEAR_GREED' as IndicatorType,
        value: fearGreed,
        raw_data: { method: 'vix_based' },
      },
      { onConflict: 'date,indicator_type' }
    );
  }

  return NextResponse.json({
    success: true,
    date: today,
    indicators: Object.keys(results).length,
    score: totalScore,
  });
}
