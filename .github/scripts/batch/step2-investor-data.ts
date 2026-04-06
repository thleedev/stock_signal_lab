import { supabase } from '../shared/supabase.js';
import { log } from '../shared/logger.js';

const NAVER_API = 'https://m.stock.naver.com/api';

interface InvestorRow {
  symbol: string;
  foreign_net_qty: number | null;
  institution_net_qty: number | null;
  investor_updated_at: string;
}

/** 네이버 수급 API에서 특정 시장·페이지 데이터를 가져온다 */
async function fetchInvestorPage(market: 'KOSPI' | 'KOSDAQ', page: number): Promise<InvestorRow[]> {
  const url = `${NAVER_API}/stocks/invest/${market}?page=${page}&pageSize=100&sosok=&period=1`;
  const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
  if (!res.ok) return [];
  const json = await res.json() as { stocks?: Record<string, unknown>[] };
  const now = new Date().toISOString();

  return (json.stocks ?? [])
    .filter(item => typeof item.itemCode === 'string' && (item.itemCode as string).length === 6)
    .map(item => ({
      symbol: item.itemCode as string,
      foreign_net_qty: typeof item.foreignPurchaseQuantity === 'string'
        ? parseFloat((item.foreignPurchaseQuantity as string).replace(/,/g, '')) || null
        : null,
      institution_net_qty: typeof item.institutionPurchaseQuantity === 'string'
        ? parseFloat((item.institutionPurchaseQuantity as string).replace(/,/g, '')) || null
        : null,
      investor_updated_at: now,
    }));
}

/**
 * Step 2: 네이버 수급 데이터 수집
 * KOSPI·KOSDAQ 전 종목의 외국인/기관 순매수량을 stock_cache 에 upsert 한다.
 */
export async function runStep2InvestorData(opts: { date: string }): Promise<{ errors: string[] }> {
  log('step2', '수급 데이터 수집 시작');
  const errors: string[] = [];

  try {
    // 첫 페이지를 병렬로 요청하고 totalCount 로 전체 페이지 수 계산
    const [k1, kq1] = await Promise.all([
      fetch(`${NAVER_API}/stocks/invest/KOSPI?page=1&pageSize=100&sosok=&period=1`, {
        headers: { 'User-Agent': 'Mozilla/5.0' },
      }).then(r => r.json() as Promise<{ totalCount: number; stocks: Record<string, unknown>[] }>),
      fetch(`${NAVER_API}/stocks/invest/KOSDAQ?page=1&pageSize=100&sosok=&period=1`, {
        headers: { 'User-Agent': 'Mozilla/5.0' },
      }).then(r => r.json() as Promise<{ totalCount: number; stocks: Record<string, unknown>[] }>),
    ]);

    const kospiPages = Math.ceil((k1.totalCount ?? 0) / 100);
    const kosdaqPages = Math.ceil((kq1.totalCount ?? 0) / 100);
    const now = new Date().toISOString();

    // 2페이지 이후 병렬 수집
    const pagePromises: Promise<InvestorRow[]>[] = [];
    for (let p = 2; p <= kospiPages; p++) pagePromises.push(fetchInvestorPage('KOSPI', p));
    for (let p = 2; p <= kosdaqPages; p++) pagePromises.push(fetchInvestorPage('KOSDAQ', p));
    const pages = await Promise.all(pagePromises);

    // 1페이지 데이터를 InvestorRow 형태로 변환
    const firstRows: InvestorRow[] = [
      ...(k1.stocks ?? []).filter(i => typeof i.itemCode === 'string' && (i.itemCode as string).length === 6).map(i => ({
        symbol: i.itemCode as string,
        foreign_net_qty: typeof i.foreignPurchaseQuantity === 'string' ? parseFloat((i.foreignPurchaseQuantity as string).replace(/,/g, '')) || null : null,
        institution_net_qty: typeof i.institutionPurchaseQuantity === 'string' ? parseFloat((i.institutionPurchaseQuantity as string).replace(/,/g, '')) || null : null,
        investor_updated_at: now,
      })),
      ...(kq1.stocks ?? []).filter(i => typeof i.itemCode === 'string' && (i.itemCode as string).length === 6).map(i => ({
        symbol: i.itemCode as string,
        foreign_net_qty: typeof i.foreignPurchaseQuantity === 'string' ? parseFloat((i.foreignPurchaseQuantity as string).replace(/,/g, '')) || null : null,
        institution_net_qty: typeof i.institutionPurchaseQuantity === 'string' ? parseFloat((i.institutionPurchaseQuantity as string).replace(/,/g, '')) || null : null,
        investor_updated_at: now,
      })),
    ];

    const allRows: InvestorRow[] = [...firstRows, ...pages.flat()];
    log('step2', `${allRows.length}종목 수급 수집, upsert 시작`);

    // 500건 단위 청크로 upsert
    const CHUNK = 500;
    for (let i = 0; i < allRows.length; i += CHUNK) {
      const chunk = allRows.slice(i, i + CHUNK);
      const { error } = await supabase
        .from('stock_cache')
        .upsert(chunk, { onConflict: 'symbol', ignoreDuplicates: false });
      if (error) errors.push(`step2 upsert ${i}: ${error.message}`);
    }

    log('step2', `완료: ${allRows.length}종목 수급 갱신`);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    errors.push(`step2 오류: ${msg}`);
  }

  return { errors };
}
