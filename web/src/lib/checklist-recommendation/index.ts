import { SupabaseClient } from '@supabase/supabase-js';
import { getTodayKst } from '@/lib/ai-recommendation/index';
import { getLastNWeekdays } from '@/lib/date-utils';
import type { DailyPrice } from '@/lib/ai-recommendation/technical-score';
import { evaluateConditions } from './checklist-conditions';
import type { ChecklistItem, ChecklistGrade } from './types';

function calcGrade(ratio: number): { grade: ChecklistGrade; gradeLabel: string } {
  if (ratio >= 0.8) return { grade: 'A', gradeLabel: '적극매수' };
  if (ratio >= 0.6) return { grade: 'B', gradeLabel: '매수 고려' };
  if (ratio >= 0.4) return { grade: 'C', gradeLabel: '관망' };
  return { grade: 'D', gradeLabel: '주의' };
}

/** 날짜 모드별 매수 신호 종목 조회 */
async function fetchCandidates(
  supabase: SupabaseClient,
  dateMode: 'today' | 'signal_all' | 'all',
  market: string,
): Promise<{ symbol: string; name: string; market?: string }[]> {
  const todayKst = getTodayKst();

  if (dateMode === 'all') {
    // 종목전체: stock_cache의 모든 종목 (신호 무관) — 페이지네이션으로 전체 조회
    const allRows: { symbol: string; name: string; market?: string }[] = [];
    let from = 0;
    while (true) {
      let query = supabase
        .from('stock_cache')
        .select('symbol, name, market')
        .not('current_price', 'is', null)
        .range(from, from + 999);
      if (market !== 'all') query = query.eq('market', market);
      const { data } = await query;
      if (!data || data.length === 0) break;
      allRows.push(...data.map(r => ({ symbol: r.symbol, name: r.name, market: r.market })));
      if (data.length < 1000) break;
      from += 1000;
    }
    return allRows;
  }

  // today / signal_all: 신호 기반
  let startDate: string;
  let endDate: string;

  if (dateMode === 'signal_all') {
    const last7 = getLastNWeekdays(7);
    startDate = `${last7[last7.length - 1]}T00:00:00+09:00`;
    endDate = `${last7[0]}T23:59:59+09:00`;
  } else {
    startDate = `${todayKst}T00:00:00+09:00`;
    endDate = `${todayKst}T23:59:59+09:00`;
  }

  // 신호 조회 (limit 충분히 확보)
  const { data } = await supabase
    .from('signals')
    .select('symbol, name')
    .in('signal_type', ['BUY', 'BUY_FORECAST'])
    .gte('timestamp', startDate)
    .lte('timestamp', endDate)
    .limit(5000);

  if (!data) return [];

  // 중복 제거
  const seen = new Set<string>();
  const unique = data.filter(s => {
    if (seen.has(s.symbol)) return false;
    seen.add(s.symbol);
    return true;
  });

  // stock_cache에서 name/market 보강 (signals의 name이 null일 수 있으므로)
  const symbols = unique.map(s => s.symbol);
  const { data: cacheRows } = await supabase
    .from('stock_cache')
    .select('symbol, name, market')
    .in('symbol', symbols);
  const cacheNameMap = new Map((cacheRows ?? []).map(r => [r.symbol, { name: r.name as string, market: r.market as string }]));

  let enriched = unique.map(s => ({
    symbol: s.symbol,
    name: cacheNameMap.get(s.symbol)?.name ?? s.name ?? s.symbol,
    market: cacheNameMap.get(s.symbol)?.market,
  }));

  // 시장 필터 적용
  if (market !== 'all') {
    enriched = enriched.filter(s => s.market === market);
  }

  return enriched;
}

export async function generateChecklist(
  supabase: SupabaseClient,
  activeConditionIds: string[],
  dateMode: 'today' | 'signal_all' | 'all' = 'today',
  market = 'all',
  limit = 0, // 0 = 전체 반환
): Promise<{ items: ChecklistItem[]; total_candidates: number }> {
  const candidates = await fetchCandidates(supabase, dateMode, market);
  if (candidates.length === 0) return { items: [], total_candidates: 0 };

  const symbols = candidates.map(c => c.symbol);

  // ── 청크 단위 데이터 조회 ──
  // stock_cache: .in() URL 제한만 고려 → 80개씩
  // daily_prices: Supabase max rows 1000 제한 → 종목당 65행 필요 → 15개씩
  const CACHE_CHUNK = 80;
  const PRICE_CHUNK = 15;
  const cacheMap = new Map<string, Record<string, unknown>>();
  const priceMap = new Map<string, DailyPrice[]>();

  // stock_cache 조회 (밸류/수급 데이터)
  for (let i = 0; i < symbols.length; i += CACHE_CHUNK) {
    const chunk = symbols.slice(i, i + CACHE_CHUNK);
    const { data: cacheData } = await supabase
      .from('stock_cache')
      .select('symbol, per, pbr, roe, volume, current_price, high_52w, low_52w, short_sell_ratio, foreign_net_qty, institution_net_qty, investor_updated_at, foreign_net_5d, institution_net_5d, foreign_streak, institution_streak, market_cap, forward_per, target_price, invest_opinion')
      .in('symbol', chunk);
    for (const c of cacheData ?? []) cacheMap.set(c.symbol, c);
  }

  // daily_prices 조회 (추세 데이터) — 15개씩 병렬
  const priceChunks: string[][] = [];
  for (let i = 0; i < symbols.length; i += PRICE_CHUNK) {
    priceChunks.push(symbols.slice(i, i + PRICE_CHUNK));
  }
  const priceResults = await Promise.all(
    priceChunks.map(chunk =>
      supabase
        .from('daily_prices')
        .select('symbol, date, open, high, low, close, volume')
        .in('symbol', chunk)
        .order('date', { ascending: false })
        .limit(chunk.length * 65)
    )
  );
  for (const { data: priceRows } of priceResults) {
    for (const row of priceRows ?? []) {
      const sym = row.symbol as string;
      if (!priceMap.has(sym)) priceMap.set(sym, []);
      priceMap.get(sym)!.push(row as DailyPrice);
    }
  }
  for (const [sym, rows] of priceMap) {
    priceMap.set(sym, rows.reverse().slice(-65));
  }

  // stock_cache에 크론이 이미 수급/밸류 데이터를 저장해둠 — live fetch 불필요

  // 각 종목 조건 평가
  const items: ChecklistItem[] = candidates.map(({ symbol, name }) => {
    const cache = cacheMap.get(symbol);
    const prices = priceMap.get(symbol) ?? [];
    const volumes = prices.map(p => p.volume);
    const closes = prices.map(p => p.close);

    // cache 필드 추출 (Record<string, unknown> → 명시적 캐스트)
    const n = (v: unknown): number | null => (typeof v === 'number' ? v : null);

    const foreignNet = n(cache?.foreign_net_qty);
    const institutionNet = n(cache?.institution_net_qty);
    const foreignStreak = n(cache?.foreign_streak);
    const institutionStreak = n(cache?.institution_streak);

    const avgVol20 = volumes.length >= 21
      ? volumes.slice(-21, -1).reduce((a: number, b: number) => a + b, 0) / 20
      : null;

    const pct5d = closes.length >= 6
      ? ((closes[closes.length - 1] - closes[closes.length - 6]) / closes[closes.length - 6]) * 100
      : 0;

    const allConditions = evaluateConditions({
      prices,
      high52w: n(cache?.high_52w),
      low52w: n(cache?.low_52w),
      foreignNet,
      institutionNet,
      foreignStreak,
      institutionStreak,
      currentVolume: n(cache?.volume),
      avgVolume20d: avgVol20,
      per: n(cache?.per),
      forwardPer: n(cache?.forward_per),
      pbr: n(cache?.pbr),
      roe: n(cache?.roe),
      targetPrice: n(cache?.target_price),
      currentPrice: n(cache?.current_price),
      investOpinion: n(cache?.invest_opinion),
      rsi: null,
      pct5d,
      shortSellRatio: n(cache?.short_sell_ratio),
    });

    const activeConditions = allConditions.filter(c => activeConditionIds.includes(c.id));
    const naCount = activeConditions.filter(c => c.na).length;
    const judgeable = activeConditions.filter(c => !c.na);
    const metCount = judgeable.filter(c => c.met).length;
    const activeCount = judgeable.length;
    // 판정 가능 조건이 전체의 절반 미만이면 데이터 부족 → 비율 0 처리
    const dataInsufficient = activeConditions.length > 0 && activeCount < activeConditions.length / 2;
    const metRatio = dataInsufficient ? 0 : (activeCount > 0 ? metCount / activeCount : 0);
    const { grade, gradeLabel } = dataInsufficient
      ? { grade: 'D' as const, gradeLabel: '데이터 부족' }
      : calcGrade(metRatio);

    return {
      symbol,
      name: name ?? symbol,
      currentPrice: (cache?.current_price as number) ?? null,
      grade, gradeLabel, metCount, activeCount, metRatio,
      conditions: allConditions,
    };
  });

  items.sort((a, b) => b.metRatio - a.metRatio);
  return { items: limit > 0 ? items.slice(0, limit) : items, total_candidates: candidates.length };
}
