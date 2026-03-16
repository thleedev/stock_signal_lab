import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase';

export const dynamic = 'force-dynamic';

export interface StockRankItem {
  symbol: string;
  name: string;
  market: string;
  current_price: number | null;
  price_change_pct: number | null;
  per: number | null;
  pbr: number | null;
  roe: number | null;
  foreign_net_qty: number | null;
  institution_net_qty: number | null;
  short_sell_ratio: number | null;
  short_sell_updated_at: string | null;
  signal_count_30d: number | null;
  latest_signal_type: string | null;
  latest_signal_date: string | null;
  high_52w: number | null;
  low_52w: number | null;
  // 기본 점수 (stock_cache 기반)
  score_total: number;
  score_valuation: number;
  score_supply: number;
  score_signal: number;
  score_momentum: number;
  // AI 추천 데이터 (ai_recommendations 있는 경우)
  ai?: {
    total_score: number;
    signal_score: number;
    technical_score: number;
    valuation_score: number;
    supply_score: number;
    rsi: number | null;
    golden_cross: boolean;
    bollinger_bottom: boolean;
    phoenix_pattern: boolean;
    macd_cross: boolean;
    volume_surge: boolean;
    week52_low_near: boolean;
    double_top: boolean;
    foreign_buying: boolean;
    institution_buying: boolean;
    volume_vs_sector: boolean;
    low_short_sell: boolean;
  };
}

function calcScore(
  stock: Omit<StockRankItem, 'score_total' | 'score_valuation' | 'score_supply' | 'score_signal' | 'score_momentum' | 'ai'>,
  todayStr: string
) {
  let score_valuation = 0;
  if (stock.per !== null && stock.per > 0 && stock.per < 10) score_valuation += 7;
  if (stock.pbr !== null && stock.pbr > 0 && stock.pbr < 1) score_valuation += 7;
  if (stock.roe !== null && stock.roe > 10) score_valuation += 6;

  let score_supply = 0;
  if (stock.foreign_net_qty !== null && stock.foreign_net_qty > 0) score_supply += 8;
  if (stock.institution_net_qty !== null && stock.institution_net_qty > 0) score_supply += 8;
  const shortSellFresh = stock.short_sell_updated_at?.slice(0, 10) === todayStr;
  if (shortSellFresh && stock.short_sell_ratio !== null && stock.short_sell_ratio >= 0 && stock.short_sell_ratio < 1) score_supply += 4;

  let score_signal = 0;
  const cnt = stock.signal_count_30d ?? 0;
  if (cnt >= 3) score_signal += 15;
  else if (cnt >= 2) score_signal += 10;
  else if (cnt >= 1) score_signal += 5;
  if (stock.latest_signal_type === 'BUY' || stock.latest_signal_type === 'BUY_FORECAST') {
    if (stock.latest_signal_date) {
      const days = (new Date(todayStr).getTime() - new Date(stock.latest_signal_date).getTime()) / 86400000;
      if (days <= 1) score_signal += 15;
      else if (days <= 3) score_signal += 10;
      else if (days <= 7) score_signal += 5;
    }
  }
  score_signal = Math.min(score_signal, 30);

  let score_momentum = 0;
  if (stock.current_price && stock.low_52w && stock.low_52w > 0) {
    const ratio = stock.current_price / stock.low_52w;
    if (ratio >= 0.95 && ratio <= 1.1) score_momentum += 10;
  }
  if (stock.price_change_pct !== null) {
    if (stock.price_change_pct > 5) score_momentum += 20;
    else if (stock.price_change_pct > 3) score_momentum += 14;
    else if (stock.price_change_pct > 1) score_momentum += 8;
    else if (stock.price_change_pct > 0) score_momentum += 4;
  }
  score_momentum = Math.min(score_momentum, 30);

  const score_total = score_valuation + score_supply + score_signal + score_momentum;
  return { score_total, score_valuation, score_supply, score_signal, score_momentum };
}

function kstDayRange(dateStr: string) {
  return {
    start: `${dateStr}T00:00:00+09:00`,
    end: `${dateStr}T23:59:59+09:00`,
  };
}

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const page = Math.max(1, parseInt(searchParams.get('page') ?? '1'));
    const limit = Math.min(100, Math.max(10, parseInt(searchParams.get('limit') ?? '50')));
    const q = searchParams.get('q')?.trim().toLowerCase() ?? '';
    const market = searchParams.get('market') ?? 'all';

    const supabase = createServiceClient();
    const now = new Date();
    const todayStr = new Date(now.getTime() + 9 * 60 * 60 * 1000).toISOString().slice(0, 10);
    const dateParam = searchParams.get('date');
    const showAll = !dateParam || dateParam === 'all';
    const showWeek = dateParam === 'week';
    const showSignalAll = dateParam === 'signal_all'; // 신호전체: 최근 30일 신호 있는 종목

    // 이번주(월~오늘) 범위 계산
    const weekStart = (() => {
      const day = now.getUTCDay(); // UTC 기준 요일 (KST +9h 반영된 now)
      const kstDay = new Date(now.getTime() + 9 * 60 * 60 * 1000).getDay();
      const daysFromMonday = kstDay === 0 ? 6 : kstDay - 1;
      return new Date(now.getTime() + 9 * 60 * 60 * 1000 - daysFromMonday * 86400000)
        .toISOString().slice(0, 10);
    })();

    const dateStr = showAll || showWeek || showSignalAll ? todayStr : dateParam;

    // ── 날짜 지정 시: 해당 날짜/기간 BUY 신호 심볼 먼저 조회
    let dateSymbols: Set<string> | null = null;
    if (!showAll && !showSignalAll) {
      const start = showWeek ? `${weekStart}T00:00:00+09:00` : kstDayRange(dateStr).start;
      const end = showWeek ? `${todayStr}T23:59:59+09:00` : kstDayRange(dateStr).end;
      const { data: sigRows } = await supabase
        .from('signals')
        .select('symbol')
        .gte('timestamp', start)
        .lte('timestamp', end)
        .in('signal_type', ['BUY', 'BUY_FORECAST']);
      if (sigRows && sigRows.length > 0) {
        dateSymbols = new Set(sigRows.map((r) => r.symbol as string));
      } else {
        // 해당 날짜/기간 신호 없음 → 빈 결과 반환
        return NextResponse.json({ items: [], total: 0, page, limit, today: todayStr });
      }
    }

    // ── stock_cache + ai_recommendations 병렬 조회
    const allRows: Record<string, unknown>[] = [];
    let from = 0;

    const [, aiRecsResult] = await Promise.all([
      (async () => {
        while (true) {
          let query = supabase
            .from('stock_cache')
            .select('symbol, name, market, current_price, price_change_pct, per, pbr, roe, foreign_net_qty, institution_net_qty, short_sell_ratio, short_sell_updated_at, signal_count_30d, latest_signal_type, latest_signal_date, high_52w, low_52w')
            .not('current_price', 'is', null)
            .range(from, from + 999);
          if (market !== 'all') query = query.eq('market', market);
          if (showSignalAll) query = query.gt('signal_count_30d', 0);
          const { data } = await query;
          if (!data || data.length === 0) break;
          allRows.push(...data);
          if (data.length < 1000) break;
          from += 1000;
        }
      })(),
      supabase
        .from('ai_recommendations')
        .select('symbol, total_score, signal_score, technical_score, valuation_score, supply_score, rsi, golden_cross, bollinger_bottom, phoenix_pattern, macd_cross, volume_surge, week52_low_near, double_top, foreign_buying, institution_buying, volume_vs_sector, low_short_sell')
        .eq('date', dateStr),
    ]);

    const aiRecMap = new Map(
      (aiRecsResult.data ?? []).map((r) => [r.symbol as string, r])
    );

    // ── 점수 계산 + ai 병합 + 날짜 필터
    const scored: StockRankItem[] = allRows
      .filter((r) => r.symbol && r.name)
      .filter((r) => !dateSymbols || dateSymbols.has(r.symbol as string))
      .map((r) => {
        const base = r as Omit<StockRankItem, 'score_total' | 'score_valuation' | 'score_supply' | 'score_signal' | 'score_momentum' | 'ai'>;
        const scores = calcScore(base, todayStr);
        const aiRec = aiRecMap.get(base.symbol);
        const item: StockRankItem = { ...base, ...scores };
        if (aiRec) {
          item.ai = {
            total_score: aiRec.total_score ?? 0,
            signal_score: aiRec.signal_score ?? 0,
            technical_score: aiRec.technical_score ?? 0,
            valuation_score: aiRec.valuation_score ?? 0,
            supply_score: aiRec.supply_score ?? 0,
            rsi: aiRec.rsi ?? null,
            golden_cross: aiRec.golden_cross ?? false,
            bollinger_bottom: aiRec.bollinger_bottom ?? false,
            phoenix_pattern: aiRec.phoenix_pattern ?? false,
            macd_cross: aiRec.macd_cross ?? false,
            volume_surge: aiRec.volume_surge ?? false,
            week52_low_near: aiRec.week52_low_near ?? false,
            double_top: aiRec.double_top ?? false,
            foreign_buying: aiRec.foreign_buying ?? false,
            institution_buying: aiRec.institution_buying ?? false,
            volume_vs_sector: aiRec.volume_vs_sector ?? false,
            low_short_sell: aiRec.low_short_sell ?? false,
          };
        }
        return item;
      });

    // ── 검색 필터
    const filtered = q
      ? scored.filter((s) => s.name?.toLowerCase().includes(q) || s.symbol?.toLowerCase().includes(q))
      : scored;

    // ── 정렬: AI 우선, 그 다음 score_total 내림차순
    filtered.sort((a, b) => {
      const aHasAi = a.ai ? 1 : 0;
      const bHasAi = b.ai ? 1 : 0;
      if (aHasAi !== bHasAi) return bHasAi - aHasAi;
      return b.score_total - a.score_total;
    });

    const total = filtered.length;
    const offset = (page - 1) * limit;
    const items = filtered.slice(offset, offset + limit);

    return NextResponse.json({ items, total, page, limit, today: todayStr });
  } catch (e) {
    console.error('[stock-ranking]', e);
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
