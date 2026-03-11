import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase';

export const dynamic = 'force-dynamic';

const SOURCE_LABELS: Record<string, string> = {
  lassi: '라씨매매',
  stockbot: '스톡봇',
  quant: '퀀트',
};

/**
 * 일간 리포트 요약 생성 + Gemini AI 분석
 * 매일 장 마감 후 15:30 KST 실행
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

  const dateStart = `${today}T00:00:00+09:00`;
  const dateEnd = `${today}T23:59:59+09:00`;

  // 오늘 신호 조회
  const { data: signals } = await supabase
    .from('signals')
    .select('symbol, name, source, signal_type, signal_price, timestamp')
    .gte('timestamp', dateStart)
    .lt('timestamp', dateEnd);

  if (!signals || signals.length === 0) {
    return NextResponse.json({ success: true, message: '오늘 신호 없음' });
  }

  // 집계
  const sourceBreakdown: Record<string, { buy: number; sell: number }> = {};
  const buyStocks: Record<string, { name: string; count: number }> = {};
  const sellStocks: Record<string, { name: string; count: number }> = {};
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
    } else {
      sellCount++;
      sourceBreakdown[src].sell++;
      if (!sellStocks[s.symbol]) sellStocks[s.symbol] = { name: s.name, count: 0 };
      sellStocks[s.symbol].count++;
    }
  }

  // 상위 종목
  const topBuy = Object.entries(buyStocks)
    .sort(([, a], [, b]) => b.count - a.count)
    .slice(0, 10)
    .map(([symbol, info]) => ({ symbol, name: info.name, count: info.count }));

  const topSell = Object.entries(sellStocks)
    .sort(([, a], [, b]) => b.count - a.count)
    .slice(0, 10)
    .map(([symbol, info]) => ({ symbol, name: info.name, count: info.count }));

  // 시황 점수
  const { data: scoreData } = await supabase
    .from('market_score_history')
    .select('total_score, component_scores')
    .eq('date', today)
    .single();

  // 시장 지표 조회
  const { data: indicators } = await supabase
    .from('market_indicators')
    .select('indicator_type, value, change_pct')
    .eq('date', today);

  // Gemini AI 요약 생성
  let aiSummary: string | null = null;
  const geminiApiKey = process.env.GEMINI_API_KEY;

  if (geminiApiKey) {
    try {
      aiSummary = await generateAiSummary({
        apiKey: geminiApiKey,
        date: today,
        signals: { total: signals.length, buy: buyCount, sell: sellCount },
        sourceBreakdown,
        topBuy,
        topSell,
        marketScore: scoreData?.total_score ?? null,
        componentScores: scoreData?.component_scores ?? null,
        indicators: indicators ?? [],
      });
    } catch (e) {
      console.error('Gemini AI 요약 생성 실패:', e);
    }
  }

  const { error } = await supabase.from('daily_report_summary').upsert({
    date: today,
    total_signals: signals.length,
    buy_signals: buyCount,
    sell_signals: sellCount,
    source_breakdown: sourceBreakdown,
    top_buy_stocks: topBuy,
    top_sell_stocks: topSell,
    market_score: scoreData?.total_score ?? null,
    ai_summary: aiSummary,
  }, { onConflict: 'date' });

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
  });
}

interface SummaryInput {
  apiKey: string;
  date: string;
  signals: { total: number; buy: number; sell: number };
  sourceBreakdown: Record<string, { buy: number; sell: number }>;
  topBuy: { symbol: string; name: string; count: number }[];
  topSell: { symbol: string; name: string; count: number }[];
  marketScore: number | null;
  componentScores: Record<string, number> | null;
  indicators: { indicator_type: string; value: number; change_pct: number | null }[];
}

async function generateAiSummary(input: SummaryInput): Promise<string> {
  const indicatorLabels: Record<string, string> = {
    VIX: 'VIX (공포지수)',
    USDKRW: '원/달러 환율',
    US10Y: '미국 10년물 금리',
    WTI: 'WTI 유가',
    KOSPI: 'KOSPI',
    KOSDAQ: 'KOSDAQ',
    GOLD: '금',
    DXY: '달러인덱스',
    KR3Y: '한국 3년물 금리',
    FEAR_GREED: 'Fear & Greed Index',
  };

  const indicatorText = input.indicators
    .map((i) => {
      const label = indicatorLabels[i.indicator_type] || i.indicator_type;
      const change = i.change_pct != null ? ` (${i.change_pct >= 0 ? '+' : ''}${i.change_pct.toFixed(2)}%)` : '';
      return `- ${label}: ${Number(i.value).toLocaleString()}${change}`;
    })
    .join('\n');

  const sourceText = Object.entries(input.sourceBreakdown)
    .map(([src, counts]) => `- ${SOURCE_LABELS[src] || src}: 매수 ${counts.buy}건, 매도 ${counts.sell}건`)
    .join('\n');

  const topBuyText = input.topBuy
    .map((s) => `- ${s.name}(${s.symbol}): ${s.count}건`)
    .join('\n');

  const topSellText = input.topSell
    .map((s) => `- ${s.name}(${s.symbol}): ${s.count}건`)
    .join('\n');

  const prompt = `당신은 한국 주식시장 전문 AI 애널리스트입니다.
아래 데이터를 바탕으로 오늘(${input.date})의 시장 일간 리포트를 작성해주세요.

## 오늘의 시장 지표
${indicatorText || '(데이터 없음)'}

## 시장 건강도 점수
총점: ${input.marketScore != null ? `${input.marketScore}점/100점` : '(미산출)'}
${input.componentScores ? `세부: ${JSON.stringify(input.componentScores)}` : ''}

## AI 매매신호 요약
총 ${input.signals.total}건 (매수 ${input.signals.buy}건 / 매도 ${input.signals.sell}건)

### 소스별 현황
${sourceText}

### 매수 상위 종목
${topBuyText || '(없음)'}

### 매도 상위 종목
${topSellText || '(없음)'}

---

다음 형식으로 리포트를 작성해주세요:
1. **시장 동향 요약** (2-3문장): 오늘 시장 지표의 전반적인 흐름
2. **매매 신호 분석** (2-3문장): AI 신호의 매수/매도 비율과 특징적인 패턴
3. **주목 종목** (2-3문장): 여러 소스에서 공통으로 추천된 종목 분석
4. **투자 전략 제안** (2-3문장): 현재 시장 상황에 맞는 전략적 조언

한국어로 작성하되, 간결하고 핵심적인 내용만 담아주세요. 각 섹션 제목은 ## 마크다운 헤더로 표시하세요.`;

  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${input.apiKey}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: {
          temperature: 0.7,
          maxOutputTokens: 1024,
        },
      }),
    }
  );

  if (!response.ok) {
    throw new Error(`Gemini API error: ${response.status} ${response.statusText}`);
  }

  const data = await response.json();
  const text = data?.candidates?.[0]?.content?.parts?.[0]?.text;

  if (!text) {
    throw new Error('Gemini API 응답에 텍스트가 없습니다');
  }

  return text;
}
