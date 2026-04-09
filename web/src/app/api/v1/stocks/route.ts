import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase';
import { extractSignalPrice } from '@/lib/signal-constants';

export const dynamic = 'force-dynamic';

type SignalEntry = { type: string; price: number | null };
type SignalMap = Record<string, Record<string, SignalEntry>>;
const EMPTY_SIGNAL: SignalEntry = { type: null as unknown as string, price: null };

function buildSignalMap(rows: Array<Record<string, unknown>> | null): SignalMap {
  const map: SignalMap = {};
  if (!rows) return map;
  for (const row of rows) {
    const sym = row.symbol as string;
    const src = row.source as string;
    if (!sym) continue;
    if (!map[sym]) map[sym] = {};
    if (!map[sym][src]) {
      map[sym][src] = {
        type: row.signal_type as string,
        price: extractSignalPrice(row.raw_data as Record<string, unknown> | null),
      };
    }
  }
  return map;
}

function addSignals(stocks: Record<string, unknown>[], signalMap: SignalMap) {
  return stocks.map((stock) => ({
    ...stock,
    signals: {
      lassi: signalMap[(stock as { symbol: string }).symbol]?.lassi ?? EMPTY_SIGNAL,
      stockbot: signalMap[(stock as { symbol: string }).symbol]?.stockbot ?? EMPTY_SIGNAL,
      quant: signalMap[(stock as { symbol: string }).symbol]?.quant ?? EMPTY_SIGNAL,
    },
  }));
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function applyFilters(q: any, { market, query, minPer, maxPer, minPbr, maxPbr }: {
  market: string | null; query: string | null;
  minPer: string | null; maxPer: string | null;
  minPbr: string | null; maxPbr: string | null;
}) {
  if (market === 'ETF') q = q.eq('market', 'ETF');
  else if (market) q = q.eq('market', market);
  if (query) q = q.or(`name.ilike.%${query}%,symbol.ilike.%${query}%`);
  if (minPer) q = q.gte('per', parseFloat(minPer));
  if (maxPer) q = q.lte('per', parseFloat(maxPer));
  if (minPbr) q = q.gte('pbr', parseFloat(minPbr));
  if (maxPbr) q = q.lte('pbr', parseFloat(maxPbr));
  return q;
}

export async function GET(request: NextRequest) {
  const supabase = createServiceClient();
  const { searchParams } = new URL(request.url);

  const market = searchParams.get('market');
  const query = searchParams.get('q');
  const sortBy = searchParams.get('sortBy') || 'name';
  const sortDir = searchParams.get('sortDir') === 'desc';
  const page = parseInt(searchParams.get('page') || '1');
  const limit = Math.min(parseInt(searchParams.get('limit') || '50'), 1000); // 1000으로 늘림 (gap,signal 한 번 로딩용)
  const offset = (page - 1) * limit;
  const withSignals = searchParams.get('withSignals') === 'true';
  const hasSignal = searchParams.get('hasSignal') === 'true';
  const minPer = searchParams.get('minPer');
  const maxPer = searchParams.get('maxPer');
  const minPbr = searchParams.get('minPbr');
  const maxPbr = searchParams.get('maxPbr');

  const filters = { market, query, minPer, maxPer, minPbr, maxPbr };
  const isGapSort = sortBy === 'gap';

  // ── 매수 신호 데이터 사전 로드 (hasSignal 또는 gap 정렬 시) ──
  let preSignalMap: SignalMap | null = null;
  let buySymbols: string[] = [];

  if (hasSignal || isGapSort) {
    const { data: buySignalRows } = await supabase
      .from('signals')
      .select('symbol, source, signal_type, raw_data, timestamp')
      .in('source', ['lassi', 'stockbot', 'quant'])
      .in('signal_type', ['BUY', 'BUY_FORECAST'])
      .order('timestamp', { ascending: false });

    preSignalMap = buildSignalMap(buySignalRows as Record<string, unknown>[] | null);
    buySymbols = Object.keys(preSignalMap);
  }

  // ══════════════════════════════════════════════
  // Gap 정렬: 신호 종목(gap순) → 나머지 종목(이름순)
  // ══════════════════════════════════════════════
  if (isGapSort) {
    if (hasSignal && buySymbols.length === 0) {
      return NextResponse.json({ data: [], total: 0, page, limit, totalPages: 0 });
    }

    // 1) 신호 종목 stock_cache + 전체 수 카운트를 병렬 조회
    const stockPromise = buySymbols.length > 0
      ? applyFilters(
          supabase.from('stock_cache').select('*').in('symbol', buySymbols),
          filters
        )
      : Promise.resolve({ data: [] });

    const countPromise = applyFilters(
      supabase.from('stock_cache').select('*', { count: 'exact', head: true }),
      filters
    );

    const [stockResult, countResult] = await Promise.all([stockPromise, countPromise]);
    const stockData = (stockResult.data ?? []) as Record<string, unknown>[];
    const total = (countResult.count as number) || 0;

    // gap 계산 + 정렬
    const withGap = stockData.map((stock) => {
      const sym = stock.symbol as string;
      const sigs = preSignalMap![sym] ?? {};
      const signals = {
        lassi: sigs.lassi ?? EMPTY_SIGNAL,
        stockbot: sigs.stockbot ?? EMPTY_SIGNAL,
        quant: sigs.quant ?? EMPTY_SIGNAL,
      };
      let bestGap: number | null = null;
      for (const src of ['quant', 'lassi', 'stockbot'] as const) {
        const sig = signals[src];
        if (sig.type && ['BUY', 'BUY_FORECAST'].includes(sig.type) && sig.price && sig.price > 0 && (stock.current_price as number)) {
          const gap = (((stock.current_price as number) - sig.price) / sig.price) * 100;
          if (bestGap === null || gap < bestGap) bestGap = gap;
        }
      }
      return { ...stock, signals, _gap: bestGap };
    });

    const gapSorted = withGap
      .filter((s) => s._gap !== null)
      .sort((a, b) => sortDir ? ((b._gap as number) - (a._gap as number)) : ((a._gap as number) - (b._gap as number)))
      .map(({ _gap, ...rest }) => rest as Record<string, unknown>);

    const gapCount = gapSorted.length;
    const gapSymbolSet = new Set(gapSorted.map((s) => s.symbol as string));

    // 2) 2단계 페이지네이션
    const result: Record<string, unknown>[] = [];
    if (offset < gapCount) {
      result.push(...gapSorted.slice(offset, offset + limit));
    }

    const remaining = limit - result.length;
    if (remaining > 0 && !hasSignal) {
      const restOffset = Math.max(0, offset - gapCount);
      let rq = applyFilters(supabase.from('stock_cache').select('*'), filters);
      if (gapSymbolSet.size > 0) {
        rq = rq.not('symbol', 'in', `(${[...gapSymbolSet].join(',')})`);
      }
      rq = rq.order('name', { ascending: true }).range(restOffset, restOffset + remaining - 1);
      const { data: restData } = await rq;

      if (restData && restData.length > 0) {
        const restSymbols = restData.map((s: Record<string, unknown>) => s.symbol);
        const { data: restSignalRows } = await supabase
          .from('signals')
          .select('symbol, source, signal_type, raw_data, timestamp')
          .in('symbol', restSymbols)
          .in('source', ['lassi', 'stockbot', 'quant'])
          .order('timestamp', { ascending: false })
          .limit(restSymbols.length * 9);
        result.push(...addSignals(restData, buildSignalMap(restSignalRows as Record<string, unknown>[] | null)));
      }
    }

    return NextResponse.json({
      data: result,
      total: hasSignal ? gapCount : total,
      page,
      limit,
      totalPages: Math.ceil((hasSignal ? gapCount : total) / limit),
    }, {
      headers: { 'Cache-Control': 'public, s-maxage=10, stale-while-revalidate=30' },
    });
  }

  // ══════════════════════════════════════════════
  // 일반 정렬
  // ══════════════════════════════════════════════
  let q = applyFilters(
    supabase.from('stock_cache').select('*', { count: 'exact' }),
    filters
  );

  if (hasSignal) {
    if (buySymbols.length === 0) {
      return NextResponse.json({ data: [], total: 0, page, limit, totalPages: 0 });
    }
    q = q.in('symbol', buySymbols);
  }

  const dbColumn = (sortBy === 'high90d' || sortBy === 'change_1m') ? 'high_90d_pct' : sortBy;
  q = q.order(dbColumn, { ascending: !sortDir }).range(offset, offset + limit - 1);
  const { data, count, error } = await q;
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  let mergedData = (data || []) as Record<string, unknown>[];

  if (mergedData.length > 0) {
    const badSymbols = mergedData
      .filter((s) => s.name === s.symbol || /^\d{6}$/.test(s.name as string))
      .map((s) => s.symbol);
    const pageSymbols = mergedData.map((s) => s.symbol);

    // 이름 보완 + 신호 조인을 병렬 처리
    const [infoResult, signalResult] = await Promise.all([
      badSymbols.length > 0
        ? supabase.from('stock_info').select('symbol, name').in('symbol', badSymbols)
        : Promise.resolve({ data: null }),
      withSignals && !preSignalMap
        ? supabase
            .from('signals')
            .select('symbol, source, signal_type, raw_data, timestamp')
            .in('symbol', pageSymbols)
            .in('source', ['lassi', 'stockbot', 'quant'])
            .order('timestamp', { ascending: false })
            .limit(pageSymbols.length * 9)
        : Promise.resolve({ data: null }),
    ]);

    // 이름 보완
    if (infoResult.data && infoResult.data.length > 0) {
      const infoMap = Object.fromEntries(infoResult.data.map((s: Record<string, unknown>) => [s.symbol, s.name]));
      mergedData = mergedData.map((s) =>
        infoMap[s.symbol as string] ? { ...s, name: infoMap[s.symbol as string] } : s
      );
      if (sortBy === 'name') {
        mergedData = [...mergedData].sort((a, b) =>
          sortDir
            ? (b.name as string).localeCompare(a.name as string, 'ko')
            : (a.name as string).localeCompare(b.name as string, 'ko')
        );
      }
    }

    // 신호 조인
    if (withSignals) {
      const sigMap = preSignalMap ?? buildSignalMap(signalResult.data as Record<string, unknown>[] | null);
      mergedData = addSignals(mergedData, sigMap);
    }
  }

  return NextResponse.json({
    data: mergedData,
    total: count || 0,
    page,
    limit,
    totalPages: Math.ceil((count || 0) / limit),
  });
}
