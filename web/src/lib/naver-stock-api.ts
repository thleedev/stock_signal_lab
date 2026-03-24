/**
 * 네이버 증권 전종목 시세 API
 *
 * KIS API 대비 장점:
 * - 전종목 시세를 병렬 페이지 요청으로 2~5초 내 조회
 * - 인증 불필요, Rate limit 거의 없음
 * - 3000종목 × 1.1초 배치 → 2~5초로 단축
 *
 * 제공 데이터: 현재가, 전일대비, 등락률, 거래량, 시가총액
 * (PER/PBR/EPS/BPS/배당수익률/52주 최고최저는 개별 종목 API에서만 제공)
 */

const NAVER_STOCK_API = 'https://m.stock.naver.com/api';
const PAGE_SIZE = 100;

interface NaverStockItem {
  itemCode: string;
  stockName: string;
  closePrice: string;
  compareToPreviousClosePrice: string;
  compareToPreviousPrice: {
    code: string; // "2"=상승, "5"=하락, "3"=보합
    name: string;
  };
  fluctuationsRatio: string;
  accumulatedTradingVolume: string;
  marketValue: string;
  stockExchangeType: {
    nameEng: string; // "KOSPI" | "KOSDAQ"
  };
}

interface NaverListResponse {
  stocks: NaverStockItem[];
  totalCount: number;
}

export interface StockPriceData {
  symbol: string;
  name: string;
  market: string;
  current_price: number;
  price_change: number;
  price_change_pct: number;
  volume: number;
  market_cap: number;
}

function parseNumber(str: string): number {
  if (!str || str === '-') return 0;
  return parseInt(str.replace(/,/g, ''), 10) || 0;
}

function parseMarketCap(str: string): number {
  if (!str) return 0;
  // "1,124조 7,312억" → 억 단위로 변환
  // 또는 "11,247,312" (순수 숫자) → 그대로 사용
  return parseNumber(str);
}

async function fetchPage(market: 'KOSPI' | 'KOSDAQ', page: number): Promise<NaverStockItem[]> {
  try {
    const res = await fetch(
      `${NAVER_STOCK_API}/stocks/marketValue/${market}?page=${page}&pageSize=${PAGE_SIZE}`,
      { headers: { 'User-Agent': 'Mozilla/5.0' } }
    );
    if (!res.ok) return [];
    const data: NaverListResponse = await res.json();
    return data.stocks || [];
  } catch {
    return [];
  }
}

/**
 * 네이버 증권 전종목 시세 조회 (KOSPI + KOSDAQ)
 * 병렬 페이지 요청으로 2~5초 내 전종목 데이터 반환
 */
export async function fetchAllStockPrices(): Promise<Map<string, StockPriceData>> {
  const result = new Map<string, StockPriceData>();

  // 1. 먼저 totalCount 확인
  const [kospiFirst, kosdaqFirst] = await Promise.all([
    fetch(`${NAVER_STOCK_API}/stocks/marketValue/KOSPI?page=1&pageSize=${PAGE_SIZE}`, {
      headers: { 'User-Agent': 'Mozilla/5.0' },
    }).then(r => r.json() as Promise<NaverListResponse>),
    fetch(`${NAVER_STOCK_API}/stocks/marketValue/KOSDAQ?page=1&pageSize=${PAGE_SIZE}`, {
      headers: { 'User-Agent': 'Mozilla/5.0' },
    }).then(r => r.json() as Promise<NaverListResponse>),
  ]);

  // 첫 페이지 데이터 처리
  const processItems = (items: NaverStockItem[], market: string) => {
    for (const item of items) {
      if (!item.itemCode || item.itemCode.length !== 6) continue;
      const price = parseNumber(item.closePrice);
      if (price <= 0) continue;

      // API가 이미 부호 포함 값을 반환함 (하락 시 음수)
      // compareToPreviousClosePrice: "-4,900", fluctuationsRatio: "-2.61"
      const priceChange = parseNumber(item.compareToPreviousClosePrice);

      result.set(item.itemCode, {
        symbol: item.itemCode,
        name: item.stockName,
        market,
        current_price: price,
        price_change: priceChange,
        price_change_pct: parseFloat(item.fluctuationsRatio) || 0,
        volume: parseNumber(item.accumulatedTradingVolume),
        market_cap: parseMarketCap(item.marketValue),
      });
    }
  };

  processItems(kospiFirst.stocks || [], 'KOSPI');
  processItems(kosdaqFirst.stocks || [], 'KOSDAQ');

  // 2. 나머지 페이지 병렬 요청
  const kospiPages = Math.ceil((kospiFirst.totalCount || 0) / PAGE_SIZE);
  const kosdaqPages = Math.ceil((kosdaqFirst.totalCount || 0) / PAGE_SIZE);

  const pagePromises: Promise<{ items: NaverStockItem[]; market: string }>[] = [];

  for (let p = 2; p <= kospiPages; p++) {
    pagePromises.push(
      fetchPage('KOSPI', p).then(items => ({ items, market: 'KOSPI' }))
    );
  }
  for (let p = 2; p <= kosdaqPages; p++) {
    pagePromises.push(
      fetchPage('KOSDAQ', p).then(items => ({ items, market: 'KOSDAQ' }))
    );
  }

  const pageResults = await Promise.all(pagePromises);
  for (const { items, market } of pageResults) {
    processItems(items, market);
  }

  return result;
}

export interface StockInvestorData {
  foreign_net: number;     // 외국인 순매수 수량 (가장 최근 1일)
  institution_net: number; // 기관 순매수 수량 (가장 최근 1일)
  individual_net: number;  // 개인 순매수 수량 (가장 최근 1일)
  // 5일 누적 데이터
  foreign_net_5d: number;      // 외국인 5일 누적 순매수
  institution_net_5d: number;  // 기관 5일 누적 순매수
  foreign_streak: number;      // 외국인 연속 순매수 일수 (음수면 연속 순매도)
  institution_streak: number;  // 기관 연속 순매수 일수
}

/**
 * 종목별 최근 5영업일 투자자별 매매동향
 * integration API의 dealTrendInfos (최근 5일) 사용
 */
export async function fetchStockInvestorData(symbol: string): Promise<StockInvestorData | null> {
  try {
    const res = await fetch(`${NAVER_STOCK_API}/stock/${symbol}/integration`, {
      headers: { 'User-Agent': 'Mozilla/5.0' },
    });
    if (!res.ok) return null;

    const data = await res.json();
    const trends = data.dealTrendInfos as Array<{
      bizdate: string;
      foreignerPureBuyQuant: string;
      organPureBuyQuant: string;
      individualPureBuyQuant: string;
    }> | undefined;
    if (!trends || trends.length === 0) return null;

    const parseNet = (str: string | undefined): number => {
      if (!str) return 0;
      return parseInt(str.replace(/,/g, ''), 10) || 0;
    };

    // 최근 5일 (또는 가용한 만큼)
    const days = trends.slice(0, 5);
    const latest = days[0];

    // 5일 누적
    let foreign5d = 0, inst5d = 0;
    for (const d of days) {
      foreign5d += parseNet(d.foreignerPureBuyQuant);
      inst5d += parseNet(d.organPureBuyQuant);
    }

    // 연속 매수/매도 일수 계산 (최근일부터)
    const calcStreak = (getter: (d: typeof days[0]) => number): number => {
      if (days.length === 0) return 0;
      const first = getter(days[0]);
      if (first === 0) return 0;
      const isPositive = first > 0;
      let streak = 0;
      for (const d of days) {
        const v = getter(d);
        if ((isPositive && v > 0) || (!isPositive && v < 0)) streak++;
        else break;
      }
      return isPositive ? streak : -streak;
    };

    return {
      foreign_net: parseNet(latest.foreignerPureBuyQuant),
      institution_net: parseNet(latest.organPureBuyQuant),
      individual_net: parseNet(latest.individualPureBuyQuant),
      foreign_net_5d: foreign5d,
      institution_net_5d: inst5d,
      foreign_streak: calcStreak(d => parseNet(d.foreignerPureBuyQuant)),
      institution_streak: calcStreak(d => parseNet(d.organPureBuyQuant)),
    };
  } catch {
    return null;
  }
}

/**
 * 여러 종목 투자자 데이터 배치 조회 (병렬)
 */
export async function fetchBulkInvestorData(
  symbols: string[],
  concurrency = 20
): Promise<Map<string, StockInvestorData>> {
  const result = new Map<string, StockInvestorData>();
  if (symbols.length === 0) return result;

  for (let i = 0; i < symbols.length; i += concurrency) {
    const batch = symbols.slice(i, i + concurrency);
    await Promise.allSettled(
      batch.map(async (symbol) => {
        const data = await fetchStockInvestorData(symbol);
        if (data) result.set(symbol, data);
      })
    );
  }

  return result;
}

export interface NaverDailyPrice {
  date: string;  // YYYY-MM-DD
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

/**
 * 네이버 fchart API로 일봉 차트 데이터 조회
 * KIS API 없이 전 종목 차트 데이터 제공 가능
 *
 * @param symbol 종목 코드 (6자리)
 * @param days 조회 일수 (기본 90)
 */
export async function fetchNaverDailyPrices(
  symbol: string,
  days = 90
): Promise<NaverDailyPrice[]> {
  try {
    const res = await fetch(
      `https://fchart.stock.naver.com/sise.nhn?symbol=${symbol}&timeframe=day&count=${days}&requestType=0`,
      { headers: { 'User-Agent': 'Mozilla/5.0' } }
    );
    if (!res.ok) return [];
    const xml = await res.text();

    // <item data="20250313|73400|74100|72600|73200|1234567" /> 파싱
    const matches = xml.matchAll(/<item data="([^"]+)"/g);
    const result: NaverDailyPrice[] = [];

    for (const match of matches) {
      const parts = match[1].split('|');
      if (parts.length < 6) continue;
      const [rawDate, open, high, low, close, volume] = parts;
      if (!rawDate || rawDate.length !== 8) continue;
      const date = `${rawDate.slice(0, 4)}-${rawDate.slice(4, 6)}-${rawDate.slice(6, 8)}`;
      const closeVal = parseInt(close, 10);
      if (!closeVal || closeVal <= 0) continue;
      result.push({
        date,
        open: parseInt(open, 10) || closeVal,
        high: parseInt(high, 10) || closeVal,
        low: parseInt(low, 10) || closeVal,
        close: closeVal,
        volume: parseInt(volume, 10) || 0,
      });
    }

    return result;
  } catch {
    return [];
  }
}

/**
 * 개별 종목 투자지표 조회 (PER, PBR, EPS, BPS, 52주 최고/최저, 배당수익률)
 * 전종목 조회에는 부적합 - 우선순위 종목에만 사용
 */
export async function fetchStockIndicators(symbol: string): Promise<{
  per: number;
  pbr: number;
  eps: number;
  bps: number;
  high_52w: number;
  low_52w: number;
  dividend_yield: number;
} | null> {
  try {
    const res = await fetch(`${NAVER_STOCK_API}/stock/${symbol}/integration`, {
      headers: { 'User-Agent': 'Mozilla/5.0' },
    });
    if (!res.ok) return null;

    const data = await res.json();
    const infos = data.totalInfos as Array<{ code: string; value: string }>;
    if (!infos) return null;

    const getValue = (code: string): number => {
      const info = infos.find((i: { code: string }) => i.code === code);
      if (!info?.value) return 0;
      // "28.95배" → 28.95, "6,564원" → 6564
      return parseFloat(info.value.replace(/[,배원%조억백만]/g, '')) || 0;
    };

    return {
      per: getValue('per'),
      pbr: getValue('pbr'),
      eps: getValue('eps'),
      bps: getValue('bps'),
      high_52w: getValue('highPriceOf52Weeks'),
      low_52w: getValue('lowPriceOf52Weeks'),
      dividend_yield: getValue('dividendYield'),
    };
  } catch {
    return null;
  }
}
