import { NextResponse } from 'next/server';
import { getQuote } from '@/lib/yahoo-finance';
import { YAHOO_TICKERS } from '@/types/market';

export const dynamic = 'force-dynamic';
export const maxDuration = 30;

/**
 * 실시간 시황 지표 조회 API
 * Yahoo Finance에서 현재 시세를 직접 가져옴
 */
export async function GET() {
  const results: Record<string, {
    value: number;
    prev_value: number | null;
    change_pct: number;
    name: string;
  }> = {};

  // CNN Fear & Greed 비동기 fetch
  const cnnPromise = fetch(
    'https://production.dataviz.cnn.io/index/fearandgreed/graphdata/',
    { signal: AbortSignal.timeout(5000) }
  ).then(async (res) => {
    if (!res.ok) return null;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const json: any = await res.json();
    const score = json?.fear_and_greed?.score;
    if (typeof score === 'number' && score >= 0 && score <= 100) {
      return Math.round(score * 100) / 100;
    }
    return null;
  }).catch(() => null);

  // Yahoo Finance 병렬 호출
  const entries = Object.entries(YAHOO_TICKERS);
  const quoteResults = await Promise.allSettled(
    entries.map(async ([type, ticker]) => {
      const quote = await getQuote(ticker);
      return { type, quote };
    })
  );

  for (const r of quoteResults) {
    if (r.status !== 'fulfilled' || !r.value.quote) continue;
    const { type, quote } = r.value;
    results[type] = {
      value: quote.price,
      prev_value: quote.previousClose,
      change_pct: quote.changePct,
      name: quote.name,
    };
  }

  // CNN Fear & Greed 결과 추가
  const cnnScore = await cnnPromise;
  if (cnnScore !== null) {
    results['CNN_FEAR_GREED'] = {
      value: cnnScore,
      prev_value: null,
      change_pct: 0,
      name: 'CNN Fear & Greed Index',
    };
  }

  // VIX 기반 Fear & Greed 계산
  if (results['VIX']) {
    const vix = results['VIX'].value;
    // 간단 역정규화: VIX 10~50 → Fear&Greed 100~0
    const fearGreed = Math.max(0, Math.min(100, 100 - ((vix - 10) / 40) * 100));
    results['FEAR_GREED'] = {
      value: Math.round(fearGreed * 100) / 100,
      prev_value: null,
      change_pct: 0,
      name: 'Fear & Greed (VIX기반)',
    };
  }

  return NextResponse.json({
    success: true,
    timestamp: new Date().toISOString(),
    indicators: results,
  }, {
    headers: { 'Cache-Control': 'public, s-maxage=60, stale-while-revalidate=120' },
  });
}
