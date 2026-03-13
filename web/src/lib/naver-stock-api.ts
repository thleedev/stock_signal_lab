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

      const sign = item.compareToPreviousPrice?.name === 'FALLING' ? -1 : 1;
      const priceChange = parseNumber(item.compareToPreviousClosePrice) * sign;

      result.set(item.itemCode, {
        symbol: item.itemCode,
        name: item.stockName,
        market,
        current_price: price,
        price_change: priceChange,
        price_change_pct: parseFloat(item.fluctuationsRatio) * sign || 0,
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
  foreign_net: number;     // 외국인 순매수 수량 (양수=순매수, 음수=순매도)
  institution_net: number; // 기관 순매수 수량
  individual_net: number;  // 개인 순매수 수량
}

/**
 * 종목별 당일 투자자별 매매동향 (외국인/기관/개인 순매수)
 */
export async function fetchStockInvestorData(symbol: string): Promise<StockInvestorData | null> {
  try {
    const res = await fetch(`${NAVER_STOCK_API}/stock/${symbol}/investor`, {
      headers: { 'User-Agent': 'Mozilla/5.0' },
    });
    if (!res.ok) return null;

    const data = await res.json();
    const list = data.investorList as Array<{
      investorType: string;
      tradingVolume: { buy: string; sell: string; net: string };
    }> | undefined;
    if (!list || list.length === 0) return null;

    const parseNet = (str: string | undefined): number => {
      if (!str) return 0;
      return parseInt(str.replace(/,/g, ''), 10) || 0;
    };

    const find = (type: string) => list.find((i) => i.investorType === type);
    const foreign = find('외국인');
    const institution = find('기관');
    const individual = find('개인');

    return {
      foreign_net: parseNet(foreign?.tradingVolume?.net),
      institution_net: parseNet(institution?.tradingVolume?.net),
      individual_net: parseNet(individual?.tradingVolume?.net),
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
