import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase';
import { fetchAllStockPrices, type StockPriceData } from '@/lib/naver-stock-api';

export const dynamic = 'force-dynamic';

/**
 * 가격 조회 라우트.
 *
 * 이 라우트는 e9ce2a4 "Vercel Cron 라우트 전체 삭제" 커밋에서 크론으로 오인되어
 * 함께 삭제됐습니다. 클라이언트 조회 경로가 사라져 use-price-refresh 를 쓰는
 * 8개 화면과 SnapshotTracker 의 실시간 갱신이 404 를 받고 조용히 실패했습니다.
 *
 * 복구하면서 stock_cache 갱신과 우선순위 지표 갱신은 걷어냈습니다. 그 작업은
 * GitHub Actions 의 daily-batch 가 장중 15분 주기로 이미 담당합니다.
 * 이 라우트는 조회만 합니다.
 */

/** 응답에 담는 가격 정보 */
type PriceInfo = {
  current_price: number | null;
  price_change: number | null;
  price_change_pct: number | null;
  volume: number | null;
  market_cap: number | null;
};

/**
 * 네이버 전종목 조회 결과를 담는 서버 메모리 캐시입니다.
 * 같은 인스턴스로 들어온 연속 요청이 외부 API 를 반복 호출하지 않게 막습니다.
 * 서버리스에서는 인스턴스마다 따로 존재하므로 적중률을 기대하지 않습니다.
 */
let naverCache: { data: Map<string, StockPriceData>; ts: number } | null = null;
const CACHE_TTL = 60_000;

async function getLivePrices(): Promise<{ source: 'memory' | 'naver'; data: Map<string, StockPriceData> }> {
  if (naverCache && Date.now() - naverCache.ts < CACHE_TTL) {
    return { source: 'memory', data: naverCache.data };
  }

  const data = await fetchAllStockPrices();
  naverCache = { data, ts: Date.now() };
  return { source: 'naver', data };
}

function toPriceInfo(p: StockPriceData): PriceInfo {
  return {
    current_price: p.current_price,
    price_change: p.price_change,
    price_change_pct: p.price_change_pct,
    volume: p.volume,
    market_cap: p.market_cap,
  };
}

/**
 * GET /api/v1/prices?symbols=005930,000660[&live=true]
 *
 * live=true 이면 네이버 실시간 시세를, 아니면 stock_cache 에 저장된 값을 돌려줍니다.
 * 응답은 { data: { 심볼: PriceInfo } } 형태이며 호출처가 data 만 꺼내 씁니다.
 */
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const symbolsParam = searchParams.get('symbols');
  const live = searchParams.get('live') === 'true';

  const symbols = (symbolsParam ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

  if (symbols.length === 0) {
    return NextResponse.json({ error: 'symbols 파라미터가 필요합니다' }, { status: 400 });
  }

  if (live) {
    try {
      const { source, data } = await getLivePrices();
      const result: Record<string, PriceInfo> = {};
      for (const sym of symbols) {
        const price = data.get(sym);
        if (price) result[sym] = toPriceInfo(price);
      }
      return NextResponse.json(
        { data: result, source, cached: source === 'memory' },
        { headers: { 'Cache-Control': 'public, s-maxage=30, stale-while-revalidate=60' } }
      );
    } catch (e) {
      // 네이버 조회가 실패해도 화면이 멈추지 않도록 stock_cache 로 넘어갑니다.
      console.error('[prices] 실시간 조회 실패, stock_cache 로 대체합니다:', e);
    }
  }

  const supabase = createServiceClient();
  const { data, error } = await supabase
    .from('stock_cache')
    .select('symbol, current_price, price_change, price_change_pct, volume, market_cap')
    .in('symbol', symbols);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const result: Record<string, PriceInfo> = {};
  for (const row of data ?? []) {
    result[row.symbol] = {
      current_price: row.current_price,
      price_change: row.price_change,
      price_change_pct: row.price_change_pct,
      volume: row.volume,
      market_cap: row.market_cap,
    };
  }

  return NextResponse.json(
    { data: result },
    { headers: { 'Cache-Control': 'public, s-maxage=60, stale-while-revalidate=120' } }
  );
}

/**
 * POST /api/v1/prices
 *
 * 메모리 캐시를 무시하고 네이버에서 전종목을 다시 받아옵니다. 사용자가 갱신
 * 버튼을 눌렀을 때 쓰며, 받은 값을 그대로 응답에 실어 서버리스 인스턴스가
 * 달라도 클라이언트가 최신 값을 얻게 합니다.
 *
 * stock_cache 갱신은 하지 않습니다. GitHub Actions 의 daily-batch 가 담당합니다.
 */
export async function POST() {
  try {
    const data = await fetchAllStockPrices();
    naverCache = { data, ts: Date.now() };

    const prices: Record<string, PriceInfo> = {};
    for (const [sym, price] of data) {
      prices[sym] = toPriceInfo(price);
    }

    return NextResponse.json({ success: true, count: data.size, source: 'naver', data: prices });
  } catch (e) {
    console.error('[prices] 강제 갱신 실패:', e);
    return NextResponse.json({ error: '네이버 시세 조회에 실패했습니다' }, { status: 502 });
  }
}
