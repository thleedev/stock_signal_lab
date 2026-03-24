import { NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase';
import { getDailyPrices, delay } from '@/lib/kis-api';
import { fetchKrxShortSell } from '@/lib/krx-shortsell-api';
import { fetchBulkInvestorData } from '@/lib/naver-stock-api';
import { createAiProvider } from '@/lib/ai';

export const dynamic = 'force-dynamic';
export const maxDuration = 180;

const SOURCE_LABELS: Record<string, string> = {
  lassi: '라씨매매',
  stockbot: '스톡봇',
  quant: '퀀트',
};

const INDICATOR_LABELS: Record<string, string> = {
  VIX: 'VIX (공포지수)',
  USD_KRW: '원/달러 환율',
  US_10Y: '미국 10년물 금리',
  WTI: 'WTI 유가',
  KOSPI: 'KOSPI',
  KOSDAQ: 'KOSDAQ',
  GOLD: '금',
  DXY: '달러인덱스',
  KR_3Y: '한국 3년물 금리',
  FEAR_GREED: 'Fear & Greed Index',
  KORU: 'KORU (한국 3x ETF)',
  EWY: 'EWY (한국 ETF)',
};

/**
 * Vercel Cron: 평일 16:00 KST (UTC 07:00)
 *
 * 1) 오늘 신호 종목 + 보유 종목의 일봉 수집 (KIS)
 * 2) 공매도 비율 수집 (KRX) — 배치 upsert
 * 3) 투자자별 매매동향 (Naver) — 배치 upsert
 * 4) 분할매매 예약 실행
 * 5) AI 일간 리포트 생성 (기존 daily-report 통합)
 */
export async function GET(request: Request) {
  const authHeader = request.headers.get('authorization');
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const supabase = createServiceClient();
  const now = new Date();
  const kst = new Date(now.getTime() + 9 * 60 * 60 * 1000);
  const today = kst.toISOString().slice(0, 10);
  const todayCompact = today.replace(/-/g, '');
  const d30 = new Date(Date.now() - 30 * 86400000);
  const startDate = d30.toISOString().slice(0, 10).replace(/-/g, '');

  try {
    // === 1. 수집 대상 종목 추출 (병렬) ===
    const [{ data: todaySignals }, { data: openTrades }, { data: pendingSchedule }] = await Promise.all([
      supabase.from('signals').select('symbol').gte('timestamp', `${today}T00:00:00+09:00`).not('symbol', 'is', null),
      supabase.from('virtual_trades').select('symbol').eq('side', 'BUY'),
      supabase.from('split_trade_schedule').select('symbol').eq('status', 'pending'),
    ]);

    const symbols = new Set<string>();
    todaySignals?.forEach((s) => s.symbol && symbols.add(s.symbol));
    openTrades?.forEach((t) => symbols.add(t.symbol));
    pendingSchedule?.forEach((s) => symbols.add(s.symbol));

    // === 2. KIS API 일봉 수집 (5병렬 + 1초 딜레이) ===
    let savedCount = 0;
    const symbolsArr = [...symbols];
    const KIS_CONCURRENCY = 5;

    for (let i = 0; i < symbolsArr.length; i += KIS_CONCURRENCY) {
      const chunk = symbolsArr.slice(i, i + KIS_CONCURRENCY);
      const results = await Promise.allSettled(
        chunk.map(async (symbol) => {
          const prices = await getDailyPrices(symbol, startDate, todayCompact);
          if (prices.length === 0) return 0;
          const rows = prices.map((p) => ({
            symbol, date: p.date, open: p.open, high: p.high,
            low: p.low, close: p.close, volume: p.volume,
          }));
          const { error } = await supabase
            .from('daily_prices')
            .upsert(rows, { onConflict: 'symbol,date' });
          if (error) {
            console.error(`[daily-prices] Upsert failed for ${symbol}:`, error);
            return 0;
          }
          return rows.length;
        })
      );
      for (const r of results) {
        if (r.status === 'fulfilled') savedCount += r.value;
      }
      if (i + KIS_CONCURRENCY < symbolsArr.length) await delay(1000);
    }

    // === 3. 공매도 + 투자자 동향 (병렬 수집, 배치 upsert) ===
    const [shortSellMap, investorMap] = await Promise.all([
      fetchKrxShortSell(),
      symbolsArr.length > 0 ? fetchBulkInvestorData(symbolsArr) : Promise.resolve(new Map()),
    ]);

    let shortSellUpdated = 0;
    if (shortSellMap.size > 0 && symbolsArr.length > 0) {
      const ts = new Date().toISOString();
      const shortSellRows = symbolsArr
        .filter((sym) => shortSellMap.has(sym))
        .map((sym) => ({
          symbol: sym,
          short_sell_ratio: shortSellMap.get(sym)!,
          short_sell_updated_at: ts,
        }));
      // 배치 upsert (500건씩)
      for (let i = 0; i < shortSellRows.length; i += 500) {
        const batch = shortSellRows.slice(i, i + 500);
        await supabase.from('stock_cache').upsert(batch, { onConflict: 'symbol', ignoreDuplicates: false });
      }
      shortSellUpdated = shortSellRows.length;
    }

    let investorUpdated = 0;
    if (investorMap.size > 0) {
      const ts = new Date().toISOString();
      const investorRows = Array.from(investorMap.entries()).map(([sym, d]) => ({
        symbol: sym,
        foreign_net_qty: d.foreign_net,
        institution_net_qty: d.institution_net,
        foreign_net_5d: d.foreign_net_5d,
        institution_net_5d: d.institution_net_5d,
        foreign_streak: d.foreign_streak,
        institution_streak: d.institution_streak,
        investor_updated_at: ts,
      }));
      for (let i = 0; i < investorRows.length; i += 500) {
        const batch = investorRows.slice(i, i + 500);
        await supabase.from('stock_cache').upsert(batch, { onConflict: 'symbol', ignoreDuplicates: false });
      }
      investorUpdated = investorRows.length;
    }

    // === 4. 분할매매 예약 실행 ===
    const splitResult = await executePendingSplitTrades(supabase, today);

    // === 5. AI 일간 리포트 생성 (기존 daily-report 통합) ===
    const reportResult = await generateDailyReport(supabase, today, todayCompact);

    return NextResponse.json({
      success: true,
      date: today,
      symbols: symbols.size,
      prices_saved: savedCount,
      short_sell_updated: shortSellUpdated,
      investor_updated: investorUpdated,
      splits_executed: splitResult,
      report: reportResult,
    });
  } catch (e) {
    console.error('[daily-prices] Cron error:', e);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

// ─── 분할매매 실행 ──────────────────────────────────────

async function executePendingSplitTrades(
  supabase: ReturnType<typeof createServiceClient>,
  today: string
): Promise<number> {
  const { data: pending } = await supabase
    .from('split_trade_schedule')
    .select('*')
    .eq('scheduled_date', today)
    .eq('status', 'pending');

  if (!pending || pending.length === 0) return 0;

  let executed = 0;
  for (const schedule of pending) {
    const { data: priceData } = await supabase
      .from('daily_prices')
      .select('close')
      .eq('symbol', schedule.symbol)
      .eq('date', today)
      .single();

    const price = priceData?.close;
    if (!price) continue;

    const { error: tradeError } = await supabase
      .from('virtual_trades')
      .insert({
        source: schedule.source,
        execution_type: 'split',
        symbol: schedule.symbol,
        side: schedule.side,
        price,
        quantity: schedule.quantity,
        split_seq: schedule.split_seq,
        signal_id: schedule.signal_id,
        trade_group_id: schedule.trade_group_id,
        note: `분할 ${schedule.split_seq}회차 (${today} 종가)`,
      });

    if (tradeError) {
      console.error(`[split] Trade insert failed:`, tradeError);
      continue;
    }

    await supabase
      .from('split_trade_schedule')
      .update({ status: 'executed', executed_price: price, executed_at: new Date().toISOString() })
      .eq('id', schedule.id);

    executed++;
  }
  return executed;
}

// ─── AI 일간 리포트 (기존 daily-report 통합) ──────────────

async function generateDailyReport(
  supabase: ReturnType<typeof createServiceClient>,
  today: string,
  _todayCompact: string
): Promise<{ generated: boolean; total?: number }> {
  const dateStart = `${today}T00:00:00+09:00`;
  const dateEnd = `${today}T23:59:59+09:00`;

  // 데이터 병렬 수집 (stock_cache의 투자자 동향 활용 — KIS 직접 호출 제거)
  const [
    { data: signals },
    { data: indicators },
    { data: scoreData },
    { data: scoreHistory },
    { data: investorData },
  ] = await Promise.all([
    supabase.from('signals')
      .select('symbol, name, source, signal_type, signal_price, timestamp')
      .gte('timestamp', dateStart).lt('timestamp', dateEnd),
    supabase.from('market_indicators')
      .select('indicator_type, value, change_pct')
      .eq('date', today),
    supabase.from('market_score_history')
      .select('total_score, breakdown, event_risk_score, combined_score')
      .eq('date', today).single(),
    supabase.from('market_score_history')
      .select('date, total_score, combined_score')
      .order('date', { ascending: false }).limit(5),
    // stock_cache에서 투자자 동향 재활용 (KIS API 호출 제거)
    supabase.from('stock_cache')
      .select('symbol, foreign_net_qty, institution_net_qty')
      .not('investor_updated_at', 'is', null)
      .order('investor_updated_at', { ascending: false })
      .limit(100),
  ]);

  if (!signals || signals.length === 0) {
    return { generated: false };
  }

  // 신호 집계
  const sourceBreakdown: Record<string, { buy: number; sell: number }> = {};
  const buyStocks: Record<string, { name: string; count: number; price?: number }> = {};
  const sellStocks: Record<string, { name: string; count: number; price?: number }> = {};
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
      if (s.signal_price) buyStocks[s.symbol].price = Number(s.signal_price);
    } else {
      sellCount++;
      sourceBreakdown[src].sell++;
      if (!sellStocks[s.symbol]) sellStocks[s.symbol] = { name: s.name, count: 0 };
      sellStocks[s.symbol].count++;
      if (s.signal_price) sellStocks[s.symbol].price = Number(s.signal_price);
    }
  }

  const topBuy = Object.entries(buyStocks)
    .sort(([, a], [, b]) => b.count - a.count).slice(0, 10)
    .map(([symbol, info]) => ({ symbol, ...info }));
  const topSell = Object.entries(sellStocks)
    .sort(([, a], [, b]) => b.count - a.count).slice(0, 10)
    .map(([symbol, info]) => ({ symbol, ...info }));

  // 투자자 동향 집계 (stock_cache 데이터 활용)
  let investorTrends: { foreign_total: number; institution_total: number } | null = null;
  if (investorData && investorData.length > 0) {
    let foreignTotal = 0;
    let institutionTotal = 0;
    for (const row of investorData) {
      foreignTotal += row.foreign_net_qty ?? 0;
      institutionTotal += row.institution_net_qty ?? 0;
    }
    investorTrends = { foreign_total: foreignTotal, institution_total: institutionTotal };
  }

  // AI 리포트 생성
  let aiSummary: string | null = null;
  try {
    const ai = createAiProvider();
    const prompt = buildReportPrompt({
      date: today,
      signals: { total: signals.length, buy: buyCount, sell: sellCount },
      sourceBreakdown,
      topBuy,
      topSell,
      marketScore: scoreData?.total_score ?? null,
      combinedScore: scoreData?.combined_score ?? null,
      eventRiskScore: scoreData?.event_risk_score ?? null,
      breakdown: scoreData?.breakdown ?? null,
      scoreHistory: scoreHistory ?? [],
      indicators: indicators ?? [],
      investorTrends,
    });
    aiSummary = await ai.generateText(prompt, { temperature: 0.7, maxTokens: 3000 });
  } catch (e) {
    console.error('[daily-report] AI 리포트 생성 실패:', e);
  }

  // DB 저장
  const upsertData: Record<string, unknown> = {
    date: today,
    total_signals: signals.length,
    buy_signals: buyCount,
    sell_signals: sellCount,
    source_breakdown: sourceBreakdown,
    top_buy_stocks: topBuy,
    top_sell_stocks: topSell,
    market_score: scoreData?.total_score ?? null,
    ai_summary: aiSummary,
  };

  if (investorTrends) {
    const { error: firstError } = await supabase.from('daily_report_summary').upsert(
      { ...upsertData, investor_trends: investorTrends },
      { onConflict: 'date' }
    );
    if (firstError?.message?.includes('investor_trends')) {
      await supabase.from('daily_report_summary').upsert(upsertData, { onConflict: 'date' });
    } else if (firstError) {
      console.error('[daily-report] Upsert error:', firstError);
    }
  } else {
    await supabase.from('daily_report_summary').upsert(upsertData, { onConflict: 'date' });
  }

  return { generated: !!aiSummary, total: signals.length };
}

// ─── 프롬프트 빌더 ──────────────────────────────────────

interface ReportInput {
  date: string;
  signals: { total: number; buy: number; sell: number };
  sourceBreakdown: Record<string, { buy: number; sell: number }>;
  topBuy: { symbol: string; name: string; count: number; price?: number }[];
  topSell: { symbol: string; name: string; count: number; price?: number }[];
  marketScore: number | null;
  combinedScore: number | null;
  eventRiskScore: number | null;
  breakdown: Record<string, { normalized: number; weighted_score: number }> | null;
  scoreHistory: { date: string; total_score: number; combined_score: number | null }[];
  indicators: { indicator_type: string; value: number; change_pct: number | null }[];
  investorTrends: { foreign_total: number; institution_total: number } | null;
}

function buildReportPrompt(input: ReportInput): string {
  const indicatorText = input.indicators
    .map((i) => {
      const label = INDICATOR_LABELS[i.indicator_type] || i.indicator_type;
      const change = i.change_pct != null ? ` (${i.change_pct >= 0 ? '+' : ''}${i.change_pct.toFixed(2)}%)` : '';
      return `- ${label}: ${Number(i.value).toLocaleString()}${change}`;
    })
    .join('\n');

  const sourceText = Object.entries(input.sourceBreakdown)
    .map(([src, counts]) => `- ${SOURCE_LABELS[src] || src}: 매수 ${counts.buy}건, 매도 ${counts.sell}건`)
    .join('\n');

  const topBuyText = input.topBuy
    .map((s) => `- ${s.name}(${s.symbol})${s.price ? ` @${s.price.toLocaleString()}원` : ''}: ${s.count}건`)
    .join('\n');
  const topSellText = input.topSell
    .map((s) => `- ${s.name}(${s.symbol})${s.price ? ` @${s.price.toLocaleString()}원` : ''}: ${s.count}건`)
    .join('\n');

  const trendsText = input.investorTrends
    ? `외국인 순매매: ${input.investorTrends.foreign_total >= 0 ? '순매수' : '순매도'} ${Math.abs(input.investorTrends.foreign_total).toLocaleString()}주\n기관 순매매: ${input.investorTrends.institution_total >= 0 ? '순매수' : '순매도'} ${Math.abs(input.investorTrends.institution_total).toLocaleString()}주`
    : '(매매동향 데이터 없음)';

  const scoreTrend = input.scoreHistory
    .map((s) => `${s.date}: 시장점수 ${s.total_score?.toFixed(1) ?? '-'}점${s.combined_score != null ? `, 통합 ${s.combined_score.toFixed(1)}점` : ''}`)
    .join('\n');

  let breakdownText = '';
  if (input.breakdown) {
    breakdownText = Object.entries(input.breakdown)
      .map(([type, v]) => `- ${INDICATOR_LABELS[type] || type}: 정규화 ${v.normalized?.toFixed(1)}`)
      .join('\n');
  }

  return `당신은 30년 경력의 한국 주식시장 수석 애널리스트입니다.
아래 데이터를 바탕으로 ${input.date}자 일간 종합 리포트를 작성하세요.
전문적이되 이해하기 쉽게, 구체적인 수치를 인용하며 작성합니다.

═══════════════════════════════════
📊 시장 지표 데이터
═══════════════════════════════════
${indicatorText || '(데이터 없음)'}

═══════════════════════════════════
📈 시장 건강도 점수
═══════════════════════════════════
시장 심리: ${input.marketScore != null ? `${input.marketScore.toFixed(1)}점/100점` : '(미산출)'}
이벤트 리스크: ${input.eventRiskScore != null ? `${input.eventRiskScore.toFixed(1)}점/100점` : '(미산출)'}
통합 스코어: ${input.combinedScore != null ? `${input.combinedScore.toFixed(1)}점/100점` : '(미산출)'}

지표별 상세:
${breakdownText || '(없음)'}

최근 5일 추이:
${scoreTrend || '(없음)'}

═══════════════════════════════════
🤖 AI 매매신호 요약
═══════════════════════════════════
총 ${input.signals.total}건 (매수 ${input.signals.buy}건 / 매도 ${input.signals.sell}건)
매수비율: ${(input.signals.buy / input.signals.total * 100).toFixed(1)}%

소스별:
${sourceText}

매수 상위:
${topBuyText || '(없음)'}

매도 상위:
${topSellText || '(없음)'}

═══════════════════════════════════
💰 투자자별 매매동향
═══════════════════════════════════
${trendsText}

═══════════════════════════════════

다음 7개 섹션으로 리포트를 작성하세요. 각 섹션은 ## 마크다운 헤더를 사용합니다.

## 시장 동향 종합
(3-4문장) 오늘 주요 지표의 전반적 흐름과 핵심 변동 요인을 분석합니다.

## AI 매매신호 분석
(3-4문장) 매수/매도 비율, 소스별 특징, 특이 패턴을 분석합니다.

## 주목 종목
(4-5문장) 여러 소스에서 공통으로 나타난 종목을 깊이 분석합니다. 가격 정보가 있으면 함께 언급합니다.

## 투자자 동향
(3-4문장) 외국인/기관/개인의 매매 패턴과 그 의미를 해석합니다. 데이터가 없으면 시장 지표로부터 간접 추론합니다.

## 섹터 분석
(3-4문장) 매매신호 종목의 업종 분포와 섹터 로테이션 시사점을 분석합니다.

## 리스크 평가
(2-3문장) 현재 시장의 주요 리스크 요인과 주의점을 짚습니다.

## 전략 제안
(3-4문장) 30년 경력의 관점에서 구체적인 투자 전략과 포지션 조언을 제시합니다.

한국어로 작성하되, 간결하고 핵심적인 내용만 담아주세요.`;
}
