// .github/scripts/batch/step6-market-data.ts
import { supabase } from '../shared/supabase.js';
import { log } from '../shared/logger.js';

type IndicatorType = 'VIX' | 'USD_KRW' | 'US_10Y' | 'WTI' | 'KOSPI' | 'KOSDAQ' | 'GOLD' | 'DXY' | 'KR_3Y' | 'FEAR_GREED' | 'KORU' | 'EWY';

const YAHOO_TICKERS: Record<IndicatorType, string> = {
  VIX: '^VIX',
  USD_KRW: 'KRW=X',
  US_10Y: '^TNX',
  WTI: 'CL=F',
  KOSPI: '^KS11',
  KOSDAQ: '^KQ11',
  GOLD: 'GC=F',
  DXY: 'DX-Y.NYB',
  KR_3Y: '^IRX',
  KORU: 'KORU',
  EWY: 'EWY',
  FEAR_GREED: '', // CNN 별도 처리
};

async function fetchYahooQuote(ticker: string): Promise<number | null> {
  try {
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ticker)}?interval=1d&range=1d`;
    const res = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0' },
      signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) return null;
    const json = await res.json() as { chart?: { result?: { meta?: { regularMarketPrice?: number } }[] } };
    return json?.chart?.result?.[0]?.meta?.regularMarketPrice ?? null;
  } catch {
    return null;
  }
}

async function fetchFred(seriesId: string): Promise<number | null> {
  const apiKey = process.env.FRED_API_KEY;
  if (!apiKey) return null;
  try {
    const url = `https://api.stlouisfed.org/fred/series/observations?series_id=${seriesId}&api_key=${apiKey}&file_type=json&sort_order=desc&limit=5`;
    const res = await fetch(url, { signal: AbortSignal.timeout(10000) });
    if (!res.ok) return null;
    const json = await res.json() as { observations?: { value: string }[] };
    for (const obs of json.observations ?? []) {
      const v = parseFloat(obs.value);
      if (!isNaN(v)) return v;
    }
    return null;
  } catch {
    return null;
  }
}

async function fetchFearGreed(): Promise<number | null> {
  try {
    const res = await fetch('https://production.dataviz.cnn.io/index/fearandgreed/graphdata', {
      headers: {
        'User-Agent': 'Mozilla/5.0',
        'Referer': 'https://edition.cnn.com/',
      },
      signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) return null;
    const json = await res.json() as { fear_and_greed?: { score?: number } };
    return json?.fear_and_greed?.score ?? null;
  } catch {
    return null;
  }
}

export async function runStep6MarketData(): Promise<void> {
  log('step6', '시황 지표 수집 시작');
  const now = new Date().toISOString();
  const rows: { indicator_type: string; value: number; updated_at: string }[] = [];

  // Yahoo Finance 병렬 fetch
  const yahooEntries = Object.entries(YAHOO_TICKERS).filter(([, ticker]) => ticker !== '');
  const yahooResults = await Promise.all(
    yahooEntries.map(([type, ticker]) => fetchYahooQuote(ticker).then(v => ({ type, value: v })))
  );
  for (const { type, value } of yahooResults) {
    if (value !== null) rows.push({ indicator_type: type, value, updated_at: now });
  }

  // FRED: HY스프레드, 수익률곡선
  const [hySpread, yieldCurve] = await Promise.all([
    fetchFred('BAMLH0A0HYM2'),
    fetchFred('T10Y2Y'),
  ]);
  if (hySpread !== null) rows.push({ indicator_type: 'HY_SPREAD', value: hySpread, updated_at: now });
  if (yieldCurve !== null) rows.push({ indicator_type: 'YIELD_CURVE', value: yieldCurve, updated_at: now });

  // CNN Fear & Greed
  const fg = await fetchFearGreed();
  if (fg !== null) rows.push({ indicator_type: 'FEAR_GREED', value: fg, updated_at: now });

  log('step6', `${rows.length}개 지표 수집, upsert 시작`);

  if (rows.length > 0) {
    const { error } = await supabase
      .from('market_indicators')
      .upsert(rows, { onConflict: 'indicator_type' });
    if (error) log('step6', `upsert 오류: ${error.message}`);
  }

  log('step6', `완료: ${rows.length}개 시황 지표 갱신`);
}
