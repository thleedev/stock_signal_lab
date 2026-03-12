import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase';
import { createAiProvider } from '@/lib/ai';
import { getInvestorTrends } from '@/lib/kis/investor-trends';

export const dynamic = 'force-dynamic';
export const maxDuration = 120;

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
 * 일간 리포트 생성 (장 마감 후 15:30 KST 실행)
 * 7섹션 AI 분석 리포트
 */
export async function POST(request: NextRequest) {
  const authHeader = request.headers.get('authorization');
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const supabase = createServiceClient();

  // KST 오늘 날짜
  const now = new Date();
  const kst = new Date(now.getTime() + 9 * 60 * 60 * 1000);
  const today = kst.toISOString().slice(0, 10);
  const todayCompact = today.replace(/-/g, '');

  const dateStart = `${today}T00:00:00+09:00`;
  const dateEnd = `${today}T23:59:59+09:00`;

  // 1. 병렬 데이터 수집
  const [
    { data: signals },
    { data: indicators },
    { data: scoreData },
    { data: scoreHistory },
    kospiTrends,
    kosdaqTrends,
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
    getInvestorTrends('KOSPI', todayCompact).catch(() => null),
    getInvestorTrends('KOSDAQ', todayCompact).catch(() => null),
  ]);

  if (!signals || signals.length === 0) {
    return NextResponse.json({ success: true, message: '오늘 신호 없음' });
  }

  // 2. 신호 집계
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
    .sort(([, a], [, b]) => b.count - a.count)
    .slice(0, 10)
    .map(([symbol, info]) => ({ symbol, ...info }));

  const topSell = Object.entries(sellStocks)
    .sort(([, a], [, b]) => b.count - a.count)
    .slice(0, 10)
    .map(([symbol, info]) => ({ symbol, ...info }));

  // 3. AI 리포트 생성
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
      kospiTrends,
      kosdaqTrends,
    });

    aiSummary = await ai.generateText(prompt, { temperature: 0.7, maxTokens: 3000 });
  } catch (e) {
    console.error('AI 리포트 생성 실패:', e);
  }

  // 4. DB 저장 (investor_trends 컬럼이 없으면 무시)
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

  // investor_trends 컬럼이 있으면 추가
  const { error: firstError } = await supabase.from('daily_report_summary').upsert(
    { ...upsertData, investor_trends: { kospi: kospiTrends, kosdaq: kosdaqTrends } },
    { onConflict: 'date' }
  );

  // investor_trends 컬럼이 없으면 해당 필드 없이 재시도
  let error = firstError;
  if (firstError?.message?.includes('investor_trends')) {
    const { error: retryError } = await supabase.from('daily_report_summary').upsert(
      upsertData, { onConflict: 'date' }
    );
    error = retryError;
  }

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({
    success: true,
    date: today,
    total: signals.length,
    buy: buyCount,
    sell: sellCount,
    hasAiSummary: !!aiSummary,
    hasTrends: !!(kospiTrends || kosdaqTrends),
  });
}

// ─── 프롬프트 빌더 ─────────────────────────────────────

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
  kospiTrends: { foreign_net: number; institution_net: number; individual_net: number } | null;
  kosdaqTrends: { foreign_net: number; institution_net: number; individual_net: number } | null;
}

function buildReportPrompt(input: ReportInput): string {
  // 지표 텍스트
  const indicatorText = input.indicators
    .map((i) => {
      const label = INDICATOR_LABELS[i.indicator_type] || i.indicator_type;
      const change = i.change_pct != null ? ` (${i.change_pct >= 0 ? '+' : ''}${i.change_pct.toFixed(2)}%)` : '';
      return `- ${label}: ${Number(i.value).toLocaleString()}${change}`;
    })
    .join('\n');

  // 소스별 현황
  const sourceText = Object.entries(input.sourceBreakdown)
    .map(([src, counts]) => `- ${SOURCE_LABELS[src] || src}: 매수 ${counts.buy}건, 매도 ${counts.sell}건`)
    .join('\n');

  // 상위 종목
  const topBuyText = input.topBuy
    .map((s) => `- ${s.name}(${s.symbol})${s.price ? ` @${s.price.toLocaleString()}원` : ''}: ${s.count}건`)
    .join('\n');

  const topSellText = input.topSell
    .map((s) => `- ${s.name}(${s.symbol})${s.price ? ` @${s.price.toLocaleString()}원` : ''}: ${s.count}건`)
    .join('\n');

  // 매매동향
  const trendsText = buildTrendsText(input.kospiTrends, input.kosdaqTrends);

  // 점수 추이
  const scoreTrend = input.scoreHistory
    .map((s) => `${s.date}: 시장점수 ${s.total_score?.toFixed(1) ?? '-'}점${s.combined_score != null ? `, 통합 ${s.combined_score.toFixed(1)}점` : ''}`)
    .join('\n');

  // breakdown 요약
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

function buildTrendsText(
  kospi: { foreign_net: number; institution_net: number; individual_net: number } | null,
  kosdaq: { foreign_net: number; institution_net: number; individual_net: number } | null
): string {
  if (!kospi && !kosdaq) return '(매매동향 데이터 없음)';

  const lines: string[] = [];
  if (kospi) {
    lines.push('KOSPI:');
    lines.push(`- 외국인: ${kospi.foreign_net >= 0 ? '순매수' : '순매도'} ${Math.abs(kospi.foreign_net).toLocaleString()}주`);
    lines.push(`- 기관: ${kospi.institution_net >= 0 ? '순매수' : '순매도'} ${Math.abs(kospi.institution_net).toLocaleString()}주`);
    lines.push(`- 개인: ${kospi.individual_net >= 0 ? '순매수' : '순매도'} ${Math.abs(kospi.individual_net).toLocaleString()}주`);
  }
  if (kosdaq) {
    lines.push('KOSDAQ:');
    lines.push(`- 외국인: ${kosdaq.foreign_net >= 0 ? '순매수' : '순매도'} ${Math.abs(kosdaq.foreign_net).toLocaleString()}주`);
    lines.push(`- 기관: ${kosdaq.institution_net >= 0 ? '순매수' : '순매도'} ${Math.abs(kosdaq.institution_net).toLocaleString()}주`);
    lines.push(`- 개인: ${kosdaq.individual_net >= 0 ? '순매수' : '순매도'} ${Math.abs(kosdaq.individual_net).toLocaleString()}주`);
  }
  return lines.join('\n');
}
