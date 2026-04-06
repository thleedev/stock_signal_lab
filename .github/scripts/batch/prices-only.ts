import { supabase } from '../shared/supabase.js';
import { log } from '../shared/logger.js';

const NAVER_API = 'https://api.stock.naver.com/api/stock';
const PAGE_SIZE = 100;

interface NaverStockItem {
  itemCode: string;
  stockName: string;
  closePrice: string;
  compareToPreviousClosePrice: string;
  fluctuationsRatio: string;
  accumulatedTradingVolume: string;
  marketValue: string;
}

interface NaverListResponse {
  stocks: NaverStockItem[];
  totalCount: number;
}

function parseNum(s: string): number {
  return parseFloat(s.replace(/,/g, '')) || 0;
}

async function fetchPage(market: 'KOSPI' | 'KOSDAQ', page: number): Promise<NaverStockItem[]> {
  const url = `${NAVER_API}/stocks/marketValue/${market}?page=${page}&pageSize=${PAGE_SIZE}`;
  const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
  if (!res.ok) throw new Error(`Naver API ${market} p${page} 실패: ${res.status}`);
  const json = await res.json() as NaverListResponse;
  return json.stocks ?? [];
}

export async function runPricesOnly(): Promise<{ collected: number }> {
  log('prices-only', '네이버 전종목 현재가 fetch 시작');

  const [kospiFirst, kosdaqFirst] = await Promise.all([
    fetch(`${NAVER_API}/stocks/marketValue/KOSPI?page=1&pageSize=${PAGE_SIZE}`, {
      headers: { 'User-Agent': 'Mozilla/5.0' },
    }).then(r => r.json() as Promise<NaverListResponse>),
    fetch(`${NAVER_API}/stocks/marketValue/KOSDAQ?page=1&pageSize=${PAGE_SIZE}`, {
      headers: { 'User-Agent': 'Mozilla/5.0' },
    }).then(r => r.json() as Promise<NaverListResponse>),
  ]);

  const kospiPages = Math.ceil((kospiFirst.totalCount ?? 0) / PAGE_SIZE);
  const kosdaqPages = Math.ceil((kosdaqFirst.totalCount ?? 0) / PAGE_SIZE);

  const pagePromises: Promise<{ items: NaverStockItem[]; market: string }>[] = [];
  for (let p = 2; p <= kospiPages; p++) {
    pagePromises.push(fetchPage('KOSPI', p).then(items => ({ items, market: 'KOSPI' })));
  }
  for (let p = 2; p <= kosdaqPages; p++) {
    pagePromises.push(fetchPage('KOSDAQ', p).then(items => ({ items, market: 'KOSDAQ' })));
  }
  const pages = await Promise.all(pagePromises);

  const allItems: NaverStockItem[] = [
    ...(kospiFirst.stocks ?? []),
    ...(kosdaqFirst.stocks ?? []),
    ...pages.flatMap(p => p.items),
  ];

  log('prices-only', `${allItems.length}종목 수집 완료, DB upsert 시작`);

  const now = new Date().toISOString();
  const CHUNK = 500;
  for (let i = 0; i < allItems.length; i += CHUNK) {
    const chunk = allItems.slice(i, i + CHUNK);
    const rows = chunk
      .filter(item => item.itemCode && item.itemCode.length === 6)
      .map(item => ({
        symbol: item.itemCode,
        current_price: parseNum(item.closePrice),
        price_change: parseNum(item.compareToPreviousClosePrice),
        price_change_pct: parseFloat(item.fluctuationsRatio) || 0,
        volume: parseNum(item.accumulatedTradingVolume),
        market_cap: parseNum(item.marketValue) * 1_000_000,
        updated_at: now,
      }));

    const { error } = await supabase
      .from('stock_cache')
      .upsert(rows, { onConflict: 'symbol', ignoreDuplicates: false });

    if (error) log('prices-only', `upsert 오류 (chunk ${i}): ${error.message}`);
  }

  log('prices-only', `완료: ${allItems.length}종목 stock_cache 갱신`);
  return { collected: allItems.length };
}
