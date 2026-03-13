import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase';
import { extractSignalPrice } from '@/lib/signal-constants';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const supabase = createServiceClient();
  const { searchParams } = new URL(request.url);

  const market = searchParams.get('market');
  const signal = searchParams.get('signal');
  const minPer = searchParams.get('minPer');
  const maxPer = searchParams.get('maxPer');
  const minPbr = searchParams.get('minPbr');
  const maxPbr = searchParams.get('maxPbr');
  const query = searchParams.get('q');
  const sortBy = searchParams.get('sortBy') || 'name';
  const sortDir = searchParams.get('sortDir') === 'desc';
  const page = parseInt(searchParams.get('page') || '1');
  const limit = Math.min(parseInt(searchParams.get('limit') || '50'), 100);
  const offset = (page - 1) * limit;
  const withSignals = searchParams.get('withSignals') === 'true';

  let q = supabase.from('stock_cache').select('*', { count: 'exact' });

  // 필터 적용
  if (market === 'ETF') {
    q = q.eq('market', 'ETF');
  } else if (market) {
    q = q.eq('market', market);
  }
  if (signal) {
    if (signal === 'BUY') {
      q = q.in('latest_signal_type', ['BUY', 'BUY_FORECAST']);
    } else if (signal === 'SELL') {
      q = q.in('latest_signal_type', ['SELL', 'SELL_COMPLETE']);
    } else if (signal === 'NONE') {
      q = q.is('latest_signal_type', null);
    }
  }
  if (minPer) q = q.gte('per', parseFloat(minPer));
  if (maxPer) q = q.lte('per', parseFloat(maxPer));
  if (minPbr) q = q.gte('pbr', parseFloat(minPbr));
  if (maxPbr) q = q.lte('pbr', parseFloat(maxPbr));

  if (query) {
    q = q.or(`name.ilike.%${query}%,symbol.ilike.%${query}%`);
  }

  // 정렬 및 페이지네이션
  q = q.order(sortBy, { ascending: !sortDir })
    .range(offset, offset + limit - 1);

  const { data, count, error } = await q;

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  let mergedData = data || [];

  // stock_info에서 이름 보완 (name이 코드값으로 잘못 저장된 종목 수정)
  if (mergedData.length > 0) {
    const badSymbols = mergedData
      .filter((s) => s.name === s.symbol || /^\d{6}$/.test(s.name))
      .map((s) => s.symbol);
    if (badSymbols.length > 0) {
      const { data: infoNames } = await supabase
        .from('stock_info')
        .select('symbol, name')
        .in('symbol', badSymbols);
      if (infoNames && infoNames.length > 0) {
        const infoMap = Object.fromEntries(infoNames.map((s) => [s.symbol, s.name]));
        mergedData = mergedData.map((s) =>
          infoMap[s.symbol] ? { ...s, name: infoMap[s.symbol] } : s
        );
        // 이름이 수정된 경우 정렬 재적용 (DB 정렬이 구 이름 기준이었으므로)
        if (sortBy === 'name') {
          mergedData = [...mergedData].sort((a, b) =>
            sortDir
              ? b.name.localeCompare(a.name, 'ko')
              : a.name.localeCompare(b.name, 'ko')
          );
        }
      }
    }
  }

  // withSignals: 소스별 최신 신호를 조인
  if (withSignals && mergedData.length > 0) {
    const symbols = mergedData.map((s) => s.symbol);

    // 각 소스별 최신 신호를 가져옴 (symbol + source 조합으로 최신 1건씩)
    // Supabase에서 distinct on을 직접 지원하지 않으므로,
    // 최근 신호를 소스별로 한 번에 가져온 뒤 JS에서 최신만 필터
    const { data: signalRows } = await supabase
      .from('signals')
      .select('symbol, source, signal_type, raw_data, timestamp')
      .in('symbol', symbols)
      .in('source', ['lassi', 'stockbot', 'quant'])
      .order('timestamp', { ascending: false })
      .limit(symbols.length * 3 * 3); // 종목수 x 소스3 x 여유3

    // symbol+source별 최신 신호만 추출
    const signalMap: Record<string, Record<string, { type: string; price: number | null }>> = {};
    if (signalRows) {
      for (const row of signalRows) {
        const sym = row.symbol as string;
        const src = row.source as string;
        if (!sym) continue;
        if (!signalMap[sym]) signalMap[sym] = {};
        if (!signalMap[sym][src]) {
          signalMap[sym][src] = {
            type: row.signal_type,
            price: extractSignalPrice(row.raw_data as Record<string, unknown> | null),
          };
        }
      }
    }

    const emptySignal = { type: null, price: null };

    mergedData = mergedData.map((stock) => ({
      ...stock,
      signals: {
        lassi: signalMap[stock.symbol]?.lassi ?? emptySignal,
        stockbot: signalMap[stock.symbol]?.stockbot ?? emptySignal,
        quant: signalMap[stock.symbol]?.quant ?? emptySignal,
      },
    }));
  }

  return NextResponse.json({
    data: mergedData,
    total: count || 0,
    page,
    limit,
    totalPages: Math.ceil((count || 0) / limit),
  });
}
