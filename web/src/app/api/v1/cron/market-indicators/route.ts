import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase';
import { getQuote, getHistorical } from '@/lib/yahoo-finance';
import { calculateMarketScore, calculateEventRiskScore, calculateCombinedScore } from '@/lib/market-score';
import { YAHOO_TICKERS, type IndicatorType, type IndicatorWeight } from '@/types/market';

export const dynamic = 'force-dynamic';
export const maxDuration = 120;

export async function POST(request: NextRequest) {
  // Cron 인증
  const authHeader = request.headers.get('authorization');
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const supabase = createServiceClient();
  const today = new Date().toISOString().slice(0, 10);
  const results: Record<string, number> = {};

  // Step 1: Yahoo Finance 지표 수집 (병렬화)
  const tickerEntries = Object.entries(YAHOO_TICKERS);
  const indicatorTypes = tickerEntries.map(([type]) => type);

  // 1a) 전일 값 일괄 조회
  const { data: prevRows } = await supabase
    .from('market_indicators')
    .select('indicator_type, value, date')
    .in('indicator_type', indicatorTypes)
    .lt('date', today)
    .order('date', { ascending: false });

  // 각 타입별 최신 전일 값 추출
  const prevMap: Record<string, number> = {};
  if (prevRows) {
    for (const row of prevRows) {
      if (!prevMap[row.indicator_type]) {
        prevMap[row.indicator_type] = Number(row.value);
      }
    }
  }

  // 1b) Yahoo 호출 병렬화
  const quoteResults = await Promise.allSettled(
    tickerEntries.map(async ([type, ticker]) => {
      const quote = await getQuote(ticker);
      return { type, quote };
    })
  );

  // 1c) 결과 수집 및 bulk upsert
  const upsertRows: Array<Record<string, unknown>> = [];
  for (const r of quoteResults) {
    if (r.status !== 'fulfilled' || !r.value.quote) continue;
    const { type, quote } = r.value;
    const prevValue = prevMap[type] ?? null;
    const changePct = prevValue ? ((quote.price - prevValue) / prevValue) * 100 : null;

    upsertRows.push({
      date: today,
      indicator_type: type,
      value: quote.price,
      prev_value: prevValue,
      change_pct: changePct,
      raw_data: { name: quote.name, previousClose: quote.previousClose },
    });
    results[type] = quote.price;
  }

  if (upsertRows.length > 0) {
    await supabase.from('market_indicators').upsert(upsertRows, { onConflict: 'date,indicator_type' });
  }

  // Step 1.5: 히스토리 데이터가 부족하면 Yahoo Finance 90일 백필
  const ninetyDaysAgo = new Date();
  ninetyDaysAgo.setDate(ninetyDaysAgo.getDate() - 90);
  const sinceDate = ninetyDaysAgo.toISOString().slice(0, 10);
  const resultTypes = Object.keys(results);

  const { data: existingHistory } = await supabase
    .from('market_indicators')
    .select('indicator_type')
    .gte('date', sinceDate)
    .in('indicator_type', resultTypes);

  const countByType: Record<string, number> = {};
  for (const row of existingHistory || []) {
    countByType[row.indicator_type] = (countByType[row.indicator_type] || 0) + 1;
  }

  const needsBackfill = resultTypes.filter(type => (countByType[type] || 0) < 5);

  if (needsBackfill.length > 0) {
    console.log(`[market-indicators] Backfilling ${needsBackfill.length} indicators: ${needsBackfill.join(', ')}`);
    const backfillResults = await Promise.allSettled(
      needsBackfill.map(async (type) => {
        const ticker = YAHOO_TICKERS[type as keyof typeof YAHOO_TICKERS];
        if (!ticker) return { type, data: [] };
        const history = await getHistorical(ticker, 90);
        return { type, data: history };
      })
    );

    const backfillRows: Array<Record<string, unknown>> = [];
    for (const r of backfillResults) {
      if (r.status !== 'fulfilled') continue;
      const { type, data } = r.value;
      for (const d of data) {
        backfillRows.push({
          date: d.date,
          indicator_type: type,
          value: d.close,
          raw_data: { source: 'backfill' },
        });
      }
    }

    if (backfillRows.length > 0) {
      // 50개씩 배치 upsert (Supabase 제한 대응)
      for (let i = 0; i < backfillRows.length; i += 50) {
        const batch = backfillRows.slice(i, i + 50);
        await supabase.from('market_indicators')
          .upsert(batch, { onConflict: 'date,indicator_type', ignoreDuplicates: true });
      }
      console.log(`[market-indicators] Backfilled ${backfillRows.length} rows`);
    }
  }

  // Step 2: 종합 점수 계산
  const { data: weights } = await supabase
    .from('indicator_weights')
    .select('*');

  const indicatorData: Record<string, { current: number; min90d: number; max90d: number }> = {};
  const { data: allHistory } = await supabase
    .from('market_indicators')
    .select('indicator_type, value')
    .in('indicator_type', resultTypes)
    .gte('date', sinceDate);

  if (allHistory && allHistory.length > 0) {
    // JS에서 타입별 그룹핑
    const historyByType: Record<string, number[]> = {};
    for (const row of allHistory) {
      if (!historyByType[row.indicator_type]) {
        historyByType[row.indicator_type] = [];
      }
      historyByType[row.indicator_type].push(Number(row.value));
    }

    for (const type of resultTypes) {
      const values = historyByType[type];
      if (values && values.length > 0) {
        indicatorData[type] = {
          current: results[type],
          min90d: Math.min(...values),
          max90d: Math.max(...values),
        };
      }
    }
  }

  const { totalScore, breakdown } = calculateMarketScore(
    indicatorData,
    (weights || []) as IndicatorWeight[]
  );

  // Step 3: 이벤트 리스크 스코어 계산
  const sevenDaysLater = new Date();
  sevenDaysLater.setDate(sevenDaysLater.getDate() + 7);

  const { data: upcomingEvents } = await supabase
    .from('market_events')
    .select('*')
    .gte('event_date', today)
    .lte('event_date', sevenDaysLater.toISOString().slice(0, 10));

  const eventRiskScore = calculateEventRiskScore(upcomingEvents || []);
  const combinedScore = calculateCombinedScore(totalScore, eventRiskScore);

  // Step 4: 점수 히스토리 저장
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
      event_risk_score: eventRiskScore,
      combined_score: combinedScore,
    },
    { onConflict: 'date' }
  );

  // Step 5: 공포탐욕 지수 저장
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
    event_risk_score: eventRiskScore,
    combined_score: combinedScore,
  });
}
