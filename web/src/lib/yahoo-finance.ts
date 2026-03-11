/**
 * Yahoo Finance API 래퍼
 * yahoo-finance2 패키지를 사용하여 시황 지표 데이터 수집
 */
import yahooFinance from 'yahoo-finance2';

export interface QuoteResult {
  price: number;
  previousClose: number;
  changePct: number;
  name: string;
}

/**
 * 단일 티커 현재 시세 조회
 */
export async function getQuote(ticker: string): Promise<QuoteResult | null> {
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result: any = await yahooFinance.quote(ticker);
    if (!result || !result.regularMarketPrice) return null;

    return {
      price: result.regularMarketPrice,
      previousClose: result.regularMarketPreviousClose ?? result.regularMarketPrice,
      changePct: result.regularMarketChangePercent ?? 0,
      name: result.shortName ?? result.longName ?? ticker,
    };
  } catch (e) {
    console.error(`Yahoo Finance quote(${ticker}) failed:`, e);
    return null;
  }
}

/**
 * 다수 티커 일괄 조회
 */
export async function getQuotes(tickers: string[]): Promise<Record<string, QuoteResult>> {
  const results: Record<string, QuoteResult> = {};

  for (const ticker of tickers) {
    const quote = await getQuote(ticker);
    if (quote) {
      results[ticker] = quote;
    }
  }

  return results;
}

/**
 * 히스토리컬 데이터 조회 (최근 N일)
 */
export async function getHistorical(
  ticker: string,
  days: number = 90
): Promise<Array<{ date: string; close: number }>> {
  try {
    const endDate = new Date();
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - days);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result: any[] = await yahooFinance.historical(ticker, {
      period1: startDate,
      period2: endDate,
      interval: '1d',
    });

    return result.map((d: any) => ({
      date: d.date.toISOString().slice(0, 10),
      close: d.close ?? 0,
    }));
  } catch (e) {
    console.error(`Yahoo Finance historical(${ticker}) failed:`, e);
    return [];
  }
}
