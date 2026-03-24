import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase';
import { fetchAllStockPrices, StockPriceData, fetchBulkInvestorData } from '@/lib/naver-stock-api';
import { fetchBulkIndicators } from '@/lib/krx-api';

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

  // stock_cache 가격 업데이트 (fire-and-forget)
  updateStockCache(data).catch(() => {});

  // 우선순위 종목 수급+지표 갱신 (fire-and-forget, 10분마다)
  refreshPriorityData().catch(() => {});

  return { source: 'naver', data };
}

// 우선순위 종목 수급+지표 갱신 (10분 쿨다운)
let lastPriorityRefresh = 0;
const PRIORITY_COOLDOWN = 10 * 60 * 1000; // 10분

async function refreshPriorityData() {
  if (Date.now() - lastPriorityRefresh < PRIORITY_COOLDOWN) return;
  lastPriorityRefresh = Date.now();

  const supabase = createServiceClient();
  const ts = new Date().toISOString();

  // 우선순위 종목 수집 (즐겨찾기 + 관심 + 최근 7일 신호)
  const [{ data: favs }, { data: watchlist }, { data: recentSigs }] = await Promise.all([
    supabase.from('favorite_stocks').select('symbol'),
    supabase.from('watchlist').select('symbol'),
    supabase.from('signals').select('symbol').gte('timestamp', new Date(Date.now() - 7 * 86400000).toISOString()),
  ]);

  const symbols = new Set<string>();
  for (const f of favs ?? []) symbols.add(f.symbol);
  for (const w of watchlist ?? []) symbols.add(w.symbol);
  for (const s of recentSigs ?? []) if (s.symbol) symbols.add(s.symbol);

  const symArr = Array.from(symbols);
  if (symArr.length === 0) return;

  // 수급 + 지표 병렬 조회 (최대 50종목으로 제한)
  const limited = symArr.slice(0, 50);
  const [investorMap, indicatorMap] = await Promise.all([
    fetchBulkInvestorData(limited, 10),
    fetchBulkIndicators(limited, 10),
  ]);

  // stock_cache 배치 업데이트
  const rows = limited.map((symbol) => {
    const investor = investorMap.get(symbol);
    const indicator = indicatorMap.get(symbol);
    const row: Record<string, unknown> = { symbol };

    if (investor) {
      row.foreign_net_qty = investor.foreign_net;
      row.institution_net_qty = investor.institution_net;
      row.foreign_net_5d = investor.foreign_net_5d;
      row.institution_net_5d = investor.institution_net_5d;
      row.foreign_streak = investor.foreign_streak;
      row.institution_streak = investor.institution_streak;
      row.investor_updated_at = ts;
    }
    if (indicator) {
      row.per = indicator.per || null;
      row.pbr = indicator.pbr || null;
      row.roe = indicator.roe || null;
      row.high_52w = indicator.high_52w || null;
      row.low_52w = indicator.low_52w || null;
      row.dividend_yield = indicator.dividend_yield || null;
      row.forward_per = indicator.forward_per;
      row.forward_eps = indicator.forward_eps;
      row.target_price = indicator.target_price;
      row.invest_opinion = indicator.invest_opinion;
      row.consensus_updated_at = ts;
    }
    return row;
  }).filter((r) => Object.keys(r).length > 1); // symbol만 있으면 스킵

  for (let i = 0; i < rows.length; i += 500) {
    await supabase.from('stock_cache').upsert(rows.slice(i, i + 500), { onConflict: 'symbol', ignoreDuplicates: false });
  }
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

    return NextResponse.json(
      { data: result, source: liveResult.source, cached: liveResult.source === 'memory' },
      { headers: { 'Cache-Control': 'public, s-maxage=30, stale-while-revalidate=60' } }
    );
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

  return NextResponse.json(
    { data: priceMap },
    { headers: { 'Cache-Control': 'public, s-maxage=60, stale-while-revalidate=120' } }
  );
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

  // 가격 데이터를 직접 반환 (서버리스 인스턴스 간 메모리 캐시 미공유 문제 해결)
  const prices: Record<string, {
    current_price: number;
    price_change: number;
    price_change_pct: number;
    volume: number;
    market_cap: number;
  }> = {};
  for (const [sym, price] of data) {
    prices[sym] = {
      current_price: price.current_price,
      price_change: price.price_change,
      price_change_pct: price.price_change_pct,
      volume: price.volume,
      market_cap: price.market_cap,
    };
  }

  return NextResponse.json({
    success: true,
    count: data.size,
    source: 'naver',
    data: prices,
  });
}
