/**
 * 시세 수집 — Yahoo chart v8 과 네이버 siseJson.
 *
 * Yahoo 는 쿠키 없이 호출하면 HTTP 429 로 차단되며 재현성이 불안정합니다.
 * fc.yahoo.com 에서 A3 쿠키를 받아 붙이면 통과하지만 배치에서 신뢰하기 어려워,
 * 한국 지수는 네이버를 주 소스로 두고 Yahoo 를 폴백으로 씁니다.
 * 두 소스의 KOSPI 종가가 2015-01-02 부터 완전히 일치하는 것을 확인했습니다.
 */

export interface QuotePoint {
  date: string;
  close: number;
}

interface YahooChartShape {
  chart?: {
    result?: {
      meta?: { gmtoffset?: number };
      timestamp?: number[];
      indicators?: { quote?: { close?: (number | null)[] }[] };
    }[];
  };
}

/** epoch 초를 KST 날짜 문자열로 변환 */
function toKstDate(epochSec: number): string {
  return new Date((epochSec + 9 * 3600) * 1000).toISOString().slice(0, 10);
}

export function parseYahooChart(json: unknown): QuotePoint[] {
  const shape = json as YahooChartShape | null;
  const result = shape?.chart?.result?.[0];
  const stamps = result?.timestamp;
  const closes = result?.indicators?.quote?.[0]?.close;
  if (!stamps || !closes) return [];

  const out: QuotePoint[] = [];
  for (let i = 0; i < stamps.length; i++) {
    const close = closes[i];
    if (close == null || !Number.isFinite(close)) continue;
    out.push({ date: toKstDate(stamps[i]), close });
  }
  return out;
}

/**
 * 네이버 siseJson 응답 파싱.
 * 응답이 순수 JSON 이 아니라 작은따옴표 JS 리터럴이라 정규식으로 행을 뽑습니다.
 */
export function parseNaverSiseJson(text: string): QuotePoint[] {
  if (!text || text.includes('<html')) return [];
  const out: QuotePoint[] = [];
  // ['20150102', 1914.24, 1929.15, 1909.67, 1926.44, 258775, 0.0]
  const rowRe = /\[\s*['"](\d{8})['"]\s*,\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)/g;
  let m: RegExpExecArray | null;
  while ((m = rowRe.exec(text)) !== null) {
    const ymd = m[1];
    const close = Number(m[5]);
    if (!Number.isFinite(close)) continue;
    out.push({
      date: `${ymd.slice(0, 4)}-${ymd.slice(4, 6)}-${ymd.slice(6, 8)}`,
      close,
    });
  }
  return out;
}

/** 날짜 문자열(YYYY-MM-DD)을 epoch 초로 */
function toEpoch(date: string): number {
  return Math.floor(new Date(`${date}T00:00:00Z`).getTime() / 1000);
}

export async function fetchYahooDaily(
  ticker: string,
  from: string,
  to: string,
): Promise<QuotePoint[]> {
  const url =
    `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ticker)}` +
    `?period1=${toEpoch(from)}&period2=${toEpoch(to) + 86400}&interval=1d`;
  const res = await fetch(url, {
    headers: { 'User-Agent': 'Mozilla/5.0' },
    signal: AbortSignal.timeout(20000),
  });
  if (!res.ok) throw new Error(`Yahoo ${ticker} HTTP ${res.status}`);
  const points = parseYahooChart(await res.json());
  if (points.length === 0) throw new Error(`Yahoo ${ticker} 관측치 0건`);
  return points;
}

export async function fetchNaverIndexDaily(
  symbol: string,
  from: string,
  to: string,
): Promise<QuotePoint[]> {
  const url =
    `https://api.finance.naver.com/siseJson.naver` +
    `?symbol=${encodeURIComponent(symbol)}&requestType=1` +
    `&startTime=${from.replace(/-/g, '')}&endTime=${to.replace(/-/g, '')}&timeframe=day`;
  const res = await fetch(url, {
    headers: { 'User-Agent': 'Mozilla/5.0', Referer: 'https://finance.naver.com/' },
    signal: AbortSignal.timeout(20000),
  });
  if (!res.ok) throw new Error(`네이버 ${symbol} HTTP ${res.status}`);
  const points = parseNaverSiseJson(await res.text());
  if (points.length === 0) throw new Error(`네이버 ${symbol} 관측치 0건`);
  return points;
}
