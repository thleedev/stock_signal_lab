import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase';
import { fetchAllStockPrices, StockPriceData } from '@/lib/naver-stock-api';

export const dynamic = 'force-dynamic';

// 서버 메모리 캐시 (60초) - 같은 인스턴스 내 중복 호출 방지
let naverCache: { data: Map<string, StockPriceData>; ts: number } | null = null;
const CACHE_TTL = 60_000;

/** 실시간 가격 조회 (메모리 캐시 → 네이버 API) */
async function getLivePrices(): Promise<{ source: 'memory' | 'naver'; data: Map<string, StockPriceData> }> {
  if (naverCache && Date.now() - naverCache.ts < CACHE_TTL) {
    return { source: 'memory', data: naverCache.data };
  }

  const data = await fetchAllStockPrices();
  naverCache = { data, ts: Date.now() };

  // stock_cache 업데이트 (fire-and-forget)
  updateStockCache(data).catch(() => {});

  return { source: 'naver', data };
}

async function updateStockCache(priceMap: Map<string, StockPriceData>) {
  const supabase = createServiceClient();
  const now = new Date().toISOString();
  const entries = Array.from(priceMap.values());
  const BATCH = 500;

  for (let i = 0; i < entries.length; i += BATCH) {
    const batch = entries.slice(i, i + BATCH);
    const rows = batch.map((price) => {
      const row: Record<string, unknown> = {
        symbol: price.symbol,
        current_price: price.current_price,
        market_cap: price.market_cap,
        updated_at: now,
      };
      if (price.name) {
        row.name = price.name;
      }
      if (price.volume > 0) {
        row.volume = price.volume;
        row.price_change = price.price_change;
        row.price_change_pct = price.price_change_pct;
      }
      return row;
    });

    await supabase
      .from('stock_cache')
      .upsert(rows, { onConflict: 'symbol', ignoreDuplicates: false });
  }
}

/**
 * GET /api/v1/prices?symbols=005930,000660
 *   → stock_cache에서 조회 (빠름)
 *
 * GET /api/v1/prices?symbols=005930,000660&live=true
 *   → 네이버에서 실시간 조회 (2-5초, 60초 캐시)
 *
 * POST /api/v1/prices/refresh (body 없음)
 *   → 네이버 전종목 실시간 조회 + stock_cache 업데이트
 */
export async function GET(request: NextRequest) {
  const symbolsParam = request.nextUrl.searchParams.get('symbols');
  const live = request.nextUrl.searchParams.get('live') === 'true';

  if (!symbolsParam) {
    return NextResponse.json({ error: 'symbols parameter required' }, { status: 400 });
  }

  const symbols = symbolsParam.split(',').filter(Boolean).slice(0, 200);
  if (symbols.length === 0) {
    return NextResponse.json({ data: {} });
  }

  if (live) {
    const liveResult = await getLivePrices();
    const priceMap = liveResult.data;
    const result: Record<string, {
      current_price: number | null;
      price_change: number | null;
      price_change_pct: number | null;
      volume: number | null;
      market_cap: number | null;
    }> = {};

    for (const sym of symbols) {
      const price = priceMap.get(sym);
      if (price) {
        result[sym] = {
          current_price: price.current_price,
          price_change: price.price_change,
          price_change_pct: price.price_change_pct,
          volume: price.volume,
          market_cap: price.market_cap,
        };
      }
    }

    return NextResponse.json({ data: result, source: liveResult.source, cached: liveResult.source === 'memory' });
  }

  // stock_cache에서 조회
  const supabase = createServiceClient();
  const { data, error } = await supabase
    .from('stock_cache')
    .select('symbol, current_price, price_change, price_change_pct, volume, market_cap')
    .in('symbol', symbols);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const priceMap: Record<string, {
    current_price: number | null;
    price_change: number | null;
    price_change_pct: number | null;
    volume: number | null;
    market_cap: number | null;
  }> = {};

  for (const row of data ?? []) {
    priceMap[row.symbol] = {
      current_price: row.current_price,
      price_change: row.price_change,
      price_change_pct: row.price_change_pct,
      volume: row.volume,
      market_cap: row.market_cap,
    };
  }

  return NextResponse.json({ data: priceMap });
}

/**
 * POST /api/v1/prices
 * 네이버 전종목 실시간 조회 → 메모리 캐시 갱신 → stock_cache는 fire-and-forget
 * 클라이언트는 이후 GET ?live=true로 메모리 캐시에서 즉시 읽기
 */
export async function POST() {
  // 캐시 무시하고 강제로 네이버에서 조회
  const data = await fetchAllStockPrices();
  naverCache = { data, ts: Date.now() };

  // stock_cache 업데이트 (fire-and-forget, 사용자 응답 차단 안 함)
  updateStockCache(data).catch(() => {});

  return NextResponse.json({
    success: true,
    count: data.size,
    source: 'naver',
  });
}
