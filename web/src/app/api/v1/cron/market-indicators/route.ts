import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase';
import { getQuote, getHistorical } from '@/lib/yahoo-finance';
import { calculateMarketScore, calculateEventRiskScore, calculateCombinedScore } from '@/lib/market-score';
import { YAHOO_TICKERS, type IndicatorType, type IndicatorWeight } from '@/types/market';
import { calculateRiskIndex, RISK_THRESHOLDS } from '@/lib/market-thresholds';
import type { SignalSource, ExecutionType } from '@/types/signal';
import { getPortfolioValue } from '@/lib/strategy-engine/portfolio';
import { PORTFOLIO_CONFIG } from '@/lib/strategy-engine';

export const dynamic = 'force-dynamic';
export const maxDuration = 180;

/**
 * FRED API에서 최신값 조회
 * series: BAMLH0A0HYM2 (HY Spread), T10Y2Y (Yield Curve) 등
 * 실패 시 null 반환
 */
async function fetchFredLatest(seriesId: string): Promise<number | null> {
  const apiKey = process.env.FRED_API_KEY;
  if (!apiKey) {
    console.warn(`[market-indicators] FRED_API_KEY not set, skipping ${seriesId}`);
    return null;
  }
  try {
    const url = `https://api.stlouisfed.org/fred/series/observations?series_id=${seriesId}&api_key=${apiKey}&file_type=json&sort_order=desc&limit=5`;
    const res = await fetch(url, { signal: AbortSignal.timeout(10000) });
    if (!res.ok) return null;
    const json = await res.json();
    const observations = json?.observations;
    if (!Array.isArray(observations)) return null;
    // 최신 유효값 (FRED는 "."을 결측으로 표시)
    for (const obs of observations) {
      if (obs.value !== '.' && !isNaN(Number(obs.value))) {
        return Number(obs.value);
      }
    }
    return null;
  } catch {
    console.error(`[market-indicators] FRED fetch failed for ${seriesId}`);
    return null;
  }
}

/**
 * CNN Fear & Greed Index 조회 (비공식 API)
 * 실패 시 null 반환
 */
async function fetchCnnFearGreed(): Promise<number | null> {
  const urls = [
    'https://production.dataviz.cnn.io/index/fearandgreed/graphdata',
    'https://production.dataviz.cnn.io/index/fearandgreed/graphdata/',
  ];
  for (const url of urls) {
    try {
      const res = await fetch(url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
          'Accept': 'application/json',
          'Referer': 'https://edition.cnn.com/',
        },
        signal: AbortSignal.timeout(8000),
      });
      if (!res.ok) {
        console.warn(`[market-indicators] CNN Fear & Greed ${url} returned ${res.status}`);
        continue;
      }
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const json: any = await res.json();
      const score = json?.fear_and_greed?.score ?? json?.score;
      if (typeof score !== 'number' || score < 0 || score > 100) continue;
      return Math.round(score * 100) / 100;
    } catch {
      continue;
    }
  }
  return null;
}

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

  // Step 1d: CNN Fear & Greed 수집
  const cnnScore = await fetchCnnFearGreed();
  if (cnnScore !== null) {
    results['CNN_FEAR_GREED'] = cnnScore;
    try {
      await supabase.from('market_indicators').upsert(
        { date: today, indicator_type: 'CNN_FEAR_GREED' as IndicatorType, value: cnnScore, raw_data: { source: 'cnn', method: 'api' } },
        { onConflict: 'date,indicator_type' }
      );
    } catch (error) {
      console.error('[market-indicators] Failed to upsert CNN_FEAR_GREED:', error);
    }
  } else {
    console.warn('[market-indicators] CNN Fear & Greed fetch returned null, using fallback');
  }

  // Step 1e: FRED 데이터 수집 (HY Spread, Yield Curve)
  const fredSeries: Record<string, string> = {
    HY_SPREAD: 'BAMLH0A0HYM2',
    YIELD_CURVE: 'T10Y2Y',
  };

  const fredResults = await Promise.allSettled(
    Object.entries(fredSeries).map(async ([type, seriesId]) => {
      const value = await fetchFredLatest(seriesId);
      return { type, value };
    })
  );

  for (const r of fredResults) {
    if (r.status !== 'fulfilled' || r.value.value === null) continue;
    const { type, value } = r.value;
    // HY Spread는 bps 단위 (FRED 원본이 bps), Yield Curve는 % 단위 → bps 변환
    const storedValue = type === 'YIELD_CURVE' ? value * 100 : value;
    results[type] = storedValue;
    try {
      await supabase.from('market_indicators').upsert(
        { date: today, indicator_type: type as IndicatorType, value: storedValue, raw_data: { source: 'fred', series_id: fredSeries[type] } },
        { onConflict: 'date,indicator_type' }
      );
    } catch (error) {
      console.error(`[market-indicators] Failed to upsert ${type}:`, error);
    }
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

  // 60일분 이상 있으면 백필 불필요 (초기 구축 후에는 스킵됨)
  const needsBackfill = resultTypes.filter(type => (countByType[type] || 0) < 60);

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

  // Step 5: VIX 기반 공포탐욕 폴백 계산 (CNN 실패 시에만 사용)
  const vixData = indicatorData['VIX'];
  let fearGreed: number | null = null;
  if (vixData) {
    const vixNormalized = vixData.max90d !== vixData.min90d
      ? ((vixData.current - vixData.min90d) / (vixData.max90d - vixData.min90d)) * 100
      : 50;
    fearGreed = 100 - vixNormalized;
  }

  // risk_index 계산 (Step 5의 fearGreed가 이미 계산된 이후)
  const riskValues: Record<string, number | null> = {};
  for (const type of Object.keys(RISK_THRESHOLDS)) {
    riskValues[type] = results[type] ?? null;
  }
  // CNN_FEAR_GREED 누락 시 Step 5에서 계산된 fearGreed 폴백
  if (riskValues['CNN_FEAR_GREED'] == null && vixData) {
    riskValues['CNN_FEAR_GREED'] = fearGreed;
  }
  const riskIndexResult = calculateRiskIndex(riskValues);
  const riskIndex = riskIndexResult.validCount > 0 ? riskIndexResult.riskIndex : null;

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
      risk_index: riskIndex,
    },
    { onConflict: 'date' }
  );

  // ═══════════════════════════════════════════════════════════
  // daily-stats 통합: 포트폴리오 스냅샷 + 신호 통계
  // ═══════════════════════════════════════════════════════════
  const statsResult = await runDailyStats(supabase, today);

  // ═══════════════════════════════════════════════════════════
  // 마감 작업: 관리종목/유통주식수 + DART + 스냅샷 정리
  // ═══════════════════════════════════════════════════════════
  let extraUpdated = 0;
  let dartUpdated = 0;

  // 관리종목/유통주식수 갱신 — 신호 있는 종목만
  try {
    const { fetchBatchStockExtra } = await import('@/lib/naver-stock-extra');
    const { data: signalStocks } = await supabase
      .from('stock_cache')
      .select('symbol')
      .gt('signal_count_30d', 0);

    const targetSymbols = (signalStocks ?? []).map((s: { symbol: string }) => s.symbol);
    if (targetSymbols.length > 0) {
      const extraMap = await fetchBatchStockExtra(targetSymbols, 10);
      for (const [symbol, info] of extraMap.entries()) {
        await supabase
          .from('stock_cache')
          .update({ float_shares: info.floatShares, is_managed: info.isManaged })
          .eq('symbol', symbol);
      }
      extraUpdated = extraMap.size;
    }
  } catch (e) {
    console.error('네이버 추가 데이터 수집 실패:', e);
  }

  // DART 재무 데이터 수집
  try {
    const { fetchDartInfo } = await import('@/lib/dart-api');
    const { data: existingDart } = await supabase
      .from('stock_dart_info')
      .select('symbol, updated_at');

    const todayStart = new Date(Date.now() + 9 * 3600000);
    todayStart.setHours(0, 0, 0, 0);

    const alreadyUpdated = new Set(
      (existingDart ?? [])
        .filter((d: { symbol: string; updated_at: string | null }) =>
          d.updated_at && new Date(d.updated_at) > todayStart,
        )
        .map((d: { symbol: string; updated_at: string | null }) => d.symbol),
    );

    const { data: symbols } = await supabase
      .from('stock_cache')
      .select('symbol, dart_corp_code')
      .not('dart_corp_code', 'is', null);

    const targets = (symbols ?? []).filter(
      (s: { symbol: string; dart_corp_code: string }) => !alreadyUpdated.has(s.symbol),
    );

    for (let i = 0; i < targets.length; i += 10) {
      const batch = targets.slice(i, i + 10);
      type DartResult = { symbol: string; info: Awaited<ReturnType<typeof fetchDartInfo>> };
      const dartResults = await Promise.allSettled(
        batch.map(async (s: { symbol: string; dart_corp_code: string }): Promise<DartResult> => ({
          symbol: s.symbol,
          info: await fetchDartInfo(s.dart_corp_code),
        })),
      );

      const dartRows = dartResults
        .filter((r): r is PromiseFulfilledResult<DartResult> => r.status === 'fulfilled')
        .map((r) => ({
          symbol: r.value.symbol,
          ...r.value.info,
          updated_at: new Date().toISOString(),
        }));

      if (dartRows.length > 0) {
        await supabase
          .from('stock_dart_info')
          .upsert(dartRows, { onConflict: 'symbol', ignoreDuplicates: false });
        dartUpdated += dartRows.length;
      }
    }
  } catch (e) {
    console.error('DART 데이터 수집 실패:', e);
  }

  // 30일 초과 스냅샷 삭제
  const thirtyDaysAgo = new Date(Date.now() + 9 * 3600000);
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
  await supabase
    .from('stock_ranking_snapshot')
    .delete()
    .lt('snapshot_date', thirtyDaysAgo.toISOString().slice(0, 10));

  return NextResponse.json({
    success: true,
    date: today,
    indicators: Object.keys(results).length,
    score: totalScore,
    event_risk_score: eventRiskScore,
    combined_score: combinedScore,
    stats: statsResult,
    closing: { extra: extraUpdated, dart: dartUpdated },
  });
}

// ─── daily-stats 로직 ──────────────────────────────────────

async function runDailyStats(
  supabase: ReturnType<typeof createServiceClient>,
  today: string
) {
  const sources: SignalSource[] = ['lassi', 'stockbot', 'quant'];
  const execTypes: ExecutionType[] = ['lump', 'split'];

  // 1. 포트폴리오 스냅샷 (6개) - 병렬 실행
  const combined: Record<ExecutionType, {
    total: number;
    breakdown: Record<string, { value: number; return_pct: number }>;
  }> = {
    lump: { total: 0, breakdown: {} },
    split: { total: 0, breakdown: {} },
  };

  const snapshotTasks = sources.flatMap((source) =>
    execTypes.map(async (execType) => {
      const [pv, { data: prevSnapshot }] = await Promise.all([
        getPortfolioValue(supabase, source, execType),
        supabase
          .from('portfolio_snapshots')
          .select('total_value')
          .eq('source', source)
          .eq('execution_type', execType)
          .lt('date', today)
          .order('date', { ascending: false })
          .limit(1)
          .single(),
      ]);

      const initialCash = PORTFOLIO_CONFIG.CASH_PER_STRATEGY;
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

      return { source, execType, pv, cumReturn };
    })
  );

  const snapshotResults = await Promise.all(snapshotTasks);
  for (const { source, execType, pv, cumReturn } of snapshotResults) {
    combined[execType].total += pv.total_value;
    combined[execType].breakdown[source] = {
      value: pv.total_value,
      return_pct: Math.round(cumReturn * 100) / 100,
    };
  }

  // 2. 통합 포트폴리오 스냅샷 (2개)
  await Promise.all(execTypes.map(async (execType) => {
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
  }));

  // 3. 일간 신호 통계
  await Promise.all(sources.map(async (source) => {
    const [{ data: todaySignals }, ...tradeStats] = await Promise.all([
      supabase
        .from('signals')
        .select('signal_type')
        .eq('source', source)
        .gte('timestamp', `${today}T00:00:00+09:00`)
        .lte('timestamp', `${today}T23:59:59+09:00`),
      ...execTypes.map((execType) => calculateTradeStats(supabase, source, execType)),
    ]);

    const buyCount = todaySignals?.filter((s) =>
      s.signal_type === 'BUY' || s.signal_type === 'BUY_FORECAST'
    ).length ?? 0;
    const sellCount = todaySignals?.filter((s) =>
      s.signal_type === 'SELL' || s.signal_type === 'SELL_COMPLETE'
    ).length ?? 0;

    await Promise.all(execTypes.map((execType, idx) => {
      const stats = tradeStats[idx];
      return supabase
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
    }));
  }));

  return { snapshots: 8 };
}

async function calculateTradeStats(
  supabase: ReturnType<typeof createServiceClient>,
  source: string,
  execType: string
): Promise<{ realizedTrades: number; hitRate: number; avgReturn: number }> {
  const { data: trades } = await supabase
    .from('virtual_trades')
    .select('symbol, side, price, quantity')
    .eq('source', source)
    .eq('execution_type', execType);

  if (!trades || trades.length === 0) {
    return { realizedTrades: 0, hitRate: 0, avgReturn: 0 };
  }

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
